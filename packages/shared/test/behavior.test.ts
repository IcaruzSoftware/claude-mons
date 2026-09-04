import { describe, expect, it } from 'vitest';
import {
  DURATIONS,
  animationFor,
  createModel,
  stepBehavior,
  transition,
  type BehaviorModel,
  type Effect,
  type PetState,
  type Stimulus,
  type World,
} from '../src/index.ts';

const WORLD: World = { minX: 0, maxX: 1000, groundY: 500 };

function baby(now = 0, seed = 1, world: World = WORLD): BehaviorModel {
  return createModel({ stage: 'baby', world, now, seed });
}

/** Steps the model with a fixed tick until `until` (inclusive), collecting effects and states. */
function run(
  model: BehaviorModel,
  from: number,
  until: number,
  stepMs: number,
  stimuliAt: (t: number) => Stimulus[] = () => [],
): { model: BehaviorModel; effects: Effect[]; states: Set<PetState> } {
  const effects: Effect[] = [];
  const states = new Set<PetState>([model.state]);
  let m = model;
  for (let t = from + stepMs; t <= until; t += stepMs) {
    const res = stepBehavior(m, stimuliAt(t), t);
    m = res.model;
    effects.push(...res.effects);
    states.add(m.state);
  }
  return { model: m, effects, states };
}

describe('priority gating', () => {
  it('working cannot be replaced by walk', () => {
    const m0 = baby();
    const { model: working } = stepBehavior(m0, [{ type: 'hook:tool_start' }], 10);
    expect(working.state).toBe('working');
    const attempt = transition(working, 'walk', 20);
    expect(attempt).toBe(working);
    expect(attempt.state).toBe('working');
  });

  it('dragged replaces working', () => {
    const { model: working } = stepBehavior(baby(), [{ type: 'hook:tool_start' }], 10);
    const { model, effects } = stepBehavior(working, [{ type: 'input:grab', x: 500, y: 490 }], 20);
    expect(model.state).toBe('dragged');
    expect(model.grabOffset).toEqual({ x: 0, y: 10 });
    expect(effects).toContainEqual({ type: 'state-changed', from: 'working', to: 'dragged' });
  });

  it('expiry lowers priority', () => {
    const { model: success } = stepBehavior(baby(), [{ type: 'hook:stop' }], 10);
    expect(success.state).toBe('success');
    // Before expiry a lower state is rejected...
    expect(transition(success, 'idle', 1000)).toBe(success);
    // ...after expiry it is accepted.
    expect(transition(success, 'idle', 10 + DURATIONS.SUCCESS).state).toBe('idle');
  });

  it('battle states block dragging', () => {
    const { model: battle } = stepBehavior(baby(), [{ type: 'battle:play' }], 10);
    expect(battle.state).toBe('battle_intro');
    const { model } = stepBehavior(battle, [{ type: 'input:grab', x: 500, y: 500 }], 20);
    expect(model.state).toBe('battle_intro');
    const done = stepBehavior(model, [{ type: 'battle:done' }], 30).model;
    expect(done.state).toBe('idle');
  });
});

describe('decay chain', () => {
  it('working -> thinking -> idle with a fake clock', () => {
    const t = 1000;
    let m = stepBehavior(baby(), [{ type: 'hook:tool_start' }], t).model;
    expect(m.state).toBe('working');

    // Activity tracker reports no tools in flight and no live turn; working should hold for 400 ms.
    m = stepBehavior(
      m,
      [{ type: 'activity:update', inFlightTools: 0, midTurnSessions: 0, lastEventAt: t }],
      t,
    ).model;
    m = stepBehavior(m, [], t + DURATIONS.WORKING_DECAY).model;
    expect(m.state).toBe('working');
    m = stepBehavior(m, [], t + DURATIONS.WORKING_DECAY + 1).model;
    expect(m.state).toBe('thinking');

    m = stepBehavior(m, [], t + DURATIONS.THINKING_DECAY).model;
    expect(m.state).toBe('thinking');
    const res = stepBehavior(m, [], t + DURATIONS.THINKING_DECAY + 1);
    expect(res.model.state).toBe('idle');
    expect(res.effects).toContainEqual({ type: 'state-changed', from: 'thinking', to: 'idle' });
  });

  it('tool_end with tools still in flight stays working', () => {
    let m = stepBehavior(
      baby(),
      [{ type: 'hook:tool_start' }, { type: 'hook:tool_start' }],
      1,
    ).model;
    m = stepBehavior(m, [{ type: 'hook:tool_end' }], 2).model;
    expect(m.state).toBe('working');
    expect(m.activity.inFlightTools).toBe(1);
    m = stepBehavior(m, [{ type: 'hook:tool_end' }], 3).model;
    expect(m.state).toBe('thinking');
  });
});

describe('hook:stop', () => {
  it('shows success for 2 s and then idles', () => {
    const t0 = 5000;
    let m = stepBehavior(baby(), [{ type: 'hook:prompt' }], t0).model;
    expect(m.state).toBe('thinking');
    const res = stepBehavior(m, [{ type: 'hook:stop' }], t0 + 100);
    m = res.model;
    expect(m.state).toBe('success');
    expect(res.effects).toContainEqual({ type: 'state-changed', from: 'thinking', to: 'success' });
    m = stepBehavior(m, [], t0 + 100 + DURATIONS.SUCCESS - 1).model;
    expect(m.state).toBe('success');
    m = stepBehavior(m, [], t0 + 100 + DURATIONS.SUCCESS).model;
    expect(m.state).toBe('idle');
  });
});

describe('sleep', () => {
  it('falls asleep after 10 min without interaction and wakes on input', () => {
    const { model, states } = run(baby(), 0, DURATIONS.SLEEP_AFTER + 2000, 1000);
    expect(model.state).toBe('sleep');
    expect(model.expiresAt).toBeNull();
    // Only base states before falling asleep.
    for (const s of states) expect(['idle', 'walk', 'sit', 'sleep']).toContain(s);

    const woke = stepBehavior(model, [{ type: 'input:any' }], DURATIONS.SLEEP_AFTER + 3000);
    expect(woke.model.state).toBe('idle');
    expect(woke.effects).toContainEqual({ type: 'wake' });
    expect(woke.effects).toContainEqual({ type: 'state-changed', from: 'sleep', to: 'idle' });
  });

  it('does not sleep while hook events keep arriving', () => {
    const { model } = run(baby(), 0, DURATIONS.SLEEP_AFTER + 2000, 1000, (t) =>
      t % 300000 === 0 ? [{ type: 'hook:session_start' }] : [],
    );
    expect(model.state).not.toBe('sleep');
  });
});

describe('egg stage', () => {
  it('never walks or sits', () => {
    const egg = createModel({ stage: 'egg', world: WORLD, now: 0, seed: 7 });
    expect(egg.state).toBe('egg_idle');
    const { model, states } = run(egg, 0, 300000, 50);
    for (const s of states) expect(['egg_idle', 'egg_wobble']).toContain(s);
    expect(states.has('egg_wobble')).toBe(true);
    expect(model.pos).toEqual({ x: 500, y: 500 });
    expect(transition(egg, 'walk', 10).state).toBe('egg_idle');
  });

  it('shake on an egg emits no request-battle', () => {
    const egg = createModel({ stage: 'egg', world: WORLD, now: 0, seed: 7 });
    const { model, effects } = stepBehavior(egg, [{ type: 'input:shake' }], 10);
    expect(model.state).toBe('shaking');
    expect(effects.filter((e) => e.type === 'request-battle')).toHaveLength(0);
  });

  it('hatches into idle once the host sets the stage', () => {
    const egg = createModel({ stage: 'egg', world: WORLD, now: 0, seed: 7 });
    let m = stepBehavior(egg, [{ type: 'game:hatch' }], 10).model;
    expect(m.state).toBe('hatching');
    expect(animationFor(m.state, m.stage)).toEqual({ anim: 'crack', fx: null });
    m = stepBehavior(m, [{ type: 'stage:set', stage: 'baby' }], 20).model;
    expect(m.state).toBe('hatching');
    m = stepBehavior(m, [], 10 + DURATIONS.HATCHING).model;
    expect(m.state).toBe('idle');
    expect(m.stage).toBe('baby');
  });
});

describe('shake', () => {
  it('non-egg shake emits request-battle exactly once', () => {
    const { model, effects } = stepBehavior(baby(), [{ type: 'input:shake' }], 10);
    expect(model.state).toBe('shaking');
    expect(effects.filter((e) => e.type === 'request-battle')).toHaveLength(1);
    // Following steps do not re-emit.
    const after = run(model, 10, 500, 16);
    expect(after.effects.filter((e) => e.type === 'request-battle')).toHaveLength(0);
  });

  it('shake-progress while dragged shows shaking and falls back to dragged', () => {
    let m = stepBehavior(baby(), [{ type: 'input:grab', x: 500, y: 500 }], 0).model;
    const res = stepBehavior(m, [{ type: 'input:shake-progress' }], 16);
    m = res.model;
    expect(m.state).toBe('shaking');
    expect(res.effects.filter((e) => e.type === 'request-battle')).toHaveLength(0);
    m = stepBehavior(m, [], 16 + DURATIONS.SHAKING).model;
    expect(m.state).toBe('dragged');
  });
});

describe('walking', () => {
  it('reverses at world edges and stays within bounds over 60 s', () => {
    const world: World = { minX: 0, maxX: 100, groundY: 300 };
    let m = createModel({ stage: 'baby', world, now: 0, seed: 3, x: 50 });
    let flips = 0;
    let walked = false;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let t = 16; t <= 60000; t += 16) {
      const prev = m;
      m = stepBehavior(m, [], t).model;
      if (m.state === 'walk') walked = true;
      if (m.state === 'walk' && prev.state === 'walk' && prev.facing !== m.facing) flips++;
      minX = Math.min(minX, m.pos.x);
      maxX = Math.max(maxX, m.pos.x);
      expect(m.pos.x).toBeGreaterThanOrEqual(world.minX);
      expect(m.pos.x).toBeLessThanOrEqual(world.maxX);
      expect(m.pos.y).toBe(world.groundY);
    }
    expect(walked).toBe(true);
    expect(flips).toBeGreaterThan(0);
    expect(minX).toBe(world.minX);
    expect(maxX).toBe(world.maxX);
  });

  it('moves at walkSpeed in the facing direction', () => {
    let m = baby();
    m = transition({ ...m, expiresAt: 0 }, 'walk', 0, 10000);
    expect(m.state).toBe('walk');
    const before = m.pos.x;
    for (let t = 100; t <= 1000; t += 100) m = stepBehavior(m, [], t).model;
    expect(m.pos.x - before).toBeCloseTo(m.facing * m.walkSpeed, 5);
  });

  it('clamps very long integration gaps (suspended tab)', () => {
    let m = baby();
    m = transition({ ...m, expiresAt: 0 }, 'walk', 0, 60000);
    const before = m.pos.x;
    m = stepBehavior(m, [], 30000).model;
    // 0.25 s worth of movement at most, never a teleport.
    expect(Math.abs(m.pos.x - before)).toBeLessThanOrEqual(m.walkSpeed * 0.25 + 1e-9);
  });
});

describe('drag and fall', () => {
  it('falls after release above ground, lands and emits landed', () => {
    let m = stepBehavior(baby(), [{ type: 'input:grab', x: 500, y: 500 }], 0).model;
    m = stepBehavior(m, [{ type: 'input:drag', x: 600, y: 300 }], 16).model;
    expect(m.state).toBe('dragged');
    expect(m.pos).toEqual({ x: 600, y: 300 });

    const rel = stepBehavior(m, [{ type: 'input:release', x: 600, y: 300 }], 32);
    m = rel.model;
    expect(m.state).toBe('falling');
    expect(m.grabOffset).toBeNull();

    const landedEffects: Effect[] = [];
    let t = 32;
    while (m.state === 'falling' && t < 5000) {
      t += 16;
      const res = stepBehavior(m, [], t);
      m = res.model;
      landedEffects.push(...res.effects.filter((e) => e.type === 'landed'));
    }
    expect(m.state).toBe('idle');
    expect(m.pos.y).toBe(WORLD.groundY);
    expect(m.pos.x).toBe(600);
    expect(landedEffects).toHaveLength(1);
    // 200 DIP at 1200 DIP/s^2 takes ~577 ms.
    expect(t - 32).toBeGreaterThan(500);
    expect(t - 32).toBeLessThan(700);
  });

  it('releasing on the ground goes straight to idle', () => {
    let m = stepBehavior(baby(), [{ type: 'input:grab', x: 500, y: 500 }], 0).model;
    m = stepBehavior(m, [{ type: 'input:drag', x: 700, y: 500 }], 16).model;
    const res = stepBehavior(m, [{ type: 'input:release', x: 700, y: 500 }], 32);
    expect(res.model.state).toBe('idle');
    expect(res.model.pos).toEqual({ x: 700, y: 500 });
    expect(res.effects.some((e) => e.type === 'landed')).toBe(false);
  });
});

describe('determinism and serialisation', () => {
  const script = (t: number): Stimulus[] => {
    if (t === 160) return [{ type: 'hook:prompt' }];
    if (t === 800) return [{ type: 'hook:tool_start' }];
    if (t === 2400) return [{ type: 'hook:tool_end' }];
    if (t === 4000) return [{ type: 'hook:stop' }];
    if (t === 9600) return [{ type: 'game:levelup', level: 3 }];
    return [];
  };

  it('same seed + same stimuli give identical models after 1000 steps', () => {
    const a = run(baby(0, 42), 0, 16000, 16, script);
    const b = run(baby(0, 42), 0, 16000, 16, script);
    expect(a.model).toEqual(b.model);
    expect(a.effects).toEqual(b.effects);
    const c = run(baby(0, 43), 0, 16000, 16, script);
    expect(c.model).not.toEqual(a.model);
  });

  it('survives JSON round-trips mid-run', () => {
    const direct = run(baby(0, 42), 0, 16000, 16, script);
    const half = run(baby(0, 42), 0, 8000, 16, script);
    const revived = JSON.parse(JSON.stringify(half.model)) as BehaviorModel;
    expect(revived).toEqual(half.model);
    const rest = run(revived, 8000, 16000, 16, script);
    expect(rest.model).toEqual(direct.model);
  });
});
