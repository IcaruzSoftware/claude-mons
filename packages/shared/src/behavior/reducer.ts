import type { Stage } from '../types.ts';
import { nextRandom, randomBetween, seedFrom } from '../util/prng.ts';
import { DECAY_TARGET, DURATIONS, PRIORITY, SCHEDULE } from './priorities.ts';
import { isAirborneState, isBattleState, type PetState } from './states.ts';
import type { Stimulus } from './stimuli.ts';

/**
 * World DIP coordinates: the pet's anchor (foot point) x lies in [minX, maxX] and y == groundY
 * while standing. y grows downwards (screen coordinates), so "above ground" means y < groundY.
 */
export interface World {
  minX: number;
  maxX: number;
  groundY: number;
}

export interface Activity {
  inFlightTools: number;
  midTurnSessions: number;
  lastEventAt: number;
}

/** Plain, JSON-serialisable snapshot of the pet. No classes, no functions, no Dates. */
export interface BehaviorModel {
  stage: Stage;
  state: PetState;
  stateSince: number;
  expiresAt: number | null;
  /** 1 = facing right. */
  facing: 1 | -1;
  /** Anchor position in world DIPs. */
  pos: { x: number; y: number };
  /** DIP/s. */
  vel: { x: number; y: number };
  world: World;
  activity: Activity;
  /** For the sleep timer; hook events and input both count. */
  lastInteractionAt: number;
  /** `pos - grabPoint` while dragged, so the sprite keeps its offset under the pointer. */
  grabOffset: { x: number; y: number } | null;
  /** PRNG state (mulberry32). */
  rng: number;
  /** DIP/s. */
  walkSpeed: number;
  /** `now` of the last `stepBehavior` call; used to derive dt for integration. */
  updatedAt: number;
}

export type Effect =
  | { type: 'state-changed'; from: PetState; to: PetState }
  /** Emitted when `input:shake` is accepted (non-egg only). */
  | { type: 'request-battle' }
  /** Falling finished. */
  | { type: 'landed' }
  /** Left `sleep`. */
  | { type: 'wake' };

export interface StepResult {
  model: BehaviorModel;
  effects: Effect[];
}

export const DEFAULT_WALK_SPEED = 40;
/** DIP/s^2 */
export const GRAVITY = 1200;
/** Longest integration step in seconds; longer gaps (suspended tab) are clamped. */
const MAX_DT = 0.25;

export function createModel(init: {
  stage: Stage;
  world: World;
  now: number;
  seed: number;
  x?: number;
}): BehaviorModel {
  const { stage, world, now } = init;
  const x = init.x ?? (world.minX + world.maxX) / 2;
  const model: BehaviorModel = {
    stage,
    state: stage === 'egg' ? 'egg_idle' : 'idle',
    stateSince: now,
    expiresAt: null,
    facing: 1,
    pos: { x: clamp(x, world.minX, world.maxX), y: world.groundY },
    vel: { x: 0, y: 0 },
    world: { minX: world.minX, maxX: world.maxX, groundY: world.groundY },
    activity: { inFlightTools: 0, midTurnSessions: 0, lastEventAt: now },
    lastInteractionAt: now,
    grabOffset: null,
    rng: seedFrom(init.seed),
    walkSpeed: DEFAULT_WALK_SPEED,
    updatedAt: now,
  };
  // Schedule the first base-state expiry so the idle/walk/sit cycle starts.
  return enter(model, model.state, now, undefined);
}

/**
 * Pure step: apply stimuli in order, then expiry, decay, sleep check and physics integration.
 */
export function stepBehavior(
  model: BehaviorModel,
  stimuli: readonly Stimulus[],
  now: number,
): StepResult {
  const effects: Effect[] = [];
  let m = model;
  for (const stimulus of stimuli) m = applyStimulus(m, stimulus, now, effects);
  m = handleExpiry(m, now, effects);
  m = handleDecay(m, now, effects);
  m = handleSleep(m, now, effects);
  m = integrate(m, now, effects);
  if (m.updatedAt !== now) m = { ...m, updatedAt: now };
  return { model: m, effects };
}

/**
 * Priority-gated transition. Succeeds when the target has at least the current state's priority,
 * when the current state has expired, or when the target is the natural decay of the current
 * state. Returns the *same object* when gated, so callers can detect rejection by identity.
 *
 * `durationMs`: `undefined` = default for the target state (random for base states),
 * `null` = no expiry, number = explicit expiry.
 */
export function transition(
  model: BehaviorModel,
  to: PetState,
  now: number,
  durationMs?: number | null,
): BehaviorModel {
  const target = remapForStage(to, model.stage);
  if (!canTransition(model, target, now)) return model;
  return enter(model, target, now, durationMs);
}

export function canTransition(model: BehaviorModel, to: PetState, now: number): boolean {
  const target = remapForStage(to, model.stage);
  const from = model.state;
  if (PRIORITY[target] >= PRIORITY[from]) return true;
  if (model.expiresAt !== null && model.expiresAt <= now) return true;
  return DECAY_TARGET[from] === target;
}

/** Eggs never idle/walk/sit/sleep; hatched pets never use egg states. */
export function remapForStage(state: PetState, stage: Stage): PetState {
  if (stage === 'egg') {
    if (state === 'idle' || state === 'walk' || state === 'sit' || state === 'sleep') {
      return 'egg_idle';
    }
    return state;
  }
  if (state === 'egg_idle' || state === 'egg_wobble') return 'idle';
  return state;
}

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

/** Enter a state unconditionally (the caller has already decided). */
function enter(
  model: BehaviorModel,
  requested: PetState,
  now: number,
  durationMs: number | null | undefined,
): BehaviorModel {
  const to = remapForStage(requested, model.stage);
  let rng = model.rng;
  let expiresAt: number | null;
  if (durationMs === undefined) {
    [expiresAt, rng] = defaultExpiry(to, now, rng);
  } else {
    expiresAt = durationMs === null ? null : now + durationMs;
  }

  let facing = model.facing;
  let vel = { x: 0, y: 0 };
  if (to === 'walk') {
    let roll: number;
    [roll, rng] = nextRandom(rng);
    facing = roll < 0.5 ? -1 : 1;
    vel = { x: facing * model.walkSpeed, y: 0 };
  } else if (to === 'falling') {
    vel = { x: 0, y: model.vel.y > 0 ? model.vel.y : 0 };
  }

  const airborne = isAirborneState(to);
  const pos = airborne
    ? { x: clamp(model.pos.x, model.world.minX, model.world.maxX), y: model.pos.y }
    : { x: clamp(model.pos.x, model.world.minX, model.world.maxX), y: model.world.groundY };

  return {
    ...model,
    state: to,
    stateSince: to === model.state ? model.stateSince : now,
    expiresAt,
    facing,
    vel,
    pos,
    grabOffset: to === 'dragged' || to === 'shaking' ? model.grabOffset : null,
    rng,
  };
}

function defaultExpiry(state: PetState, now: number, rng: number): [number | null, number] {
  switch (state) {
    case 'idle':
    case 'egg_idle':
      return rangeExpiry(now, rng, DURATIONS.IDLE_MIN, DURATIONS.IDLE_MAX);
    case 'walk':
      return rangeExpiry(now, rng, DURATIONS.WALK_MIN, DURATIONS.WALK_MAX);
    case 'sit':
      return rangeExpiry(now, rng, DURATIONS.SIT_MIN, DURATIONS.SIT_MAX);
    case 'egg_wobble':
      return [now + DURATIONS.EGG_WOBBLE, rng];
    case 'success':
      return [now + DURATIONS.SUCCESS, rng];
    case 'error':
      return [now + DURATIONS.ERROR, rng];
    case 'celebrate':
      return [now + DURATIONS.CELEBRATE, rng];
    case 'hatching':
      return [now + DURATIONS.HATCHING, rng];
    case 'evolving':
      return [now + DURATIONS.EVOLVING, rng];
    case 'shaking':
      return [now + DURATIONS.SHAKING, rng];
    default:
      return [null, rng];
  }
}

function rangeExpiry(now: number, rng: number, min: number, max: number): [number, number] {
  const [ms, next] = randomBetween(rng, min, max);
  return [now + Math.round(ms), next];
}

function pushChange(from: BehaviorModel, to: BehaviorModel, effects: Effect[]): void {
  if (from.state === to.state) return;
  effects.push({ type: 'state-changed', from: from.state, to: to.state });
  if (from.state === 'sleep') effects.push({ type: 'wake' });
}

/** Gated transition + effects. */
function go(
  model: BehaviorModel,
  to: PetState,
  now: number,
  effects: Effect[],
  durationMs?: number | null,
): BehaviorModel {
  const next = transition(model, to, now, durationMs);
  pushChange(model, next, effects);
  return next;
}

/** Ungated transition + effects (expiry, decay, landing, host-driven resets). */
function force(
  model: BehaviorModel,
  to: PetState,
  now: number,
  effects: Effect[],
  durationMs?: number | null,
): BehaviorModel {
  const next = enter(model, to, now, durationMs);
  pushChange(model, next, effects);
  return next;
}

function touch(model: BehaviorModel, now: number): BehaviorModel {
  return { ...model, lastInteractionAt: Math.max(model.lastInteractionAt, now) };
}

function withActivity(model: BehaviorModel, now: number, patch: Partial<Activity>): BehaviorModel {
  return {
    ...model,
    activity: { ...model.activity, lastEventAt: now, ...patch },
    lastInteractionAt: Math.max(model.lastInteractionAt, now),
  };
}

function applyStimulus(
  model: BehaviorModel,
  s: Stimulus,
  now: number,
  effects: Effect[],
): BehaviorModel {
  let m = model;
  switch (s.type) {
    case 'hook:session_start':
      return withActivity(m, now, {});

    case 'hook:session_end':
      return withActivity(m, now, {
        midTurnSessions: Math.max(0, m.activity.midTurnSessions - 1),
        inFlightTools: 0,
      });

    case 'hook:prompt':
      m = withActivity(m, now, { midTurnSessions: Math.max(1, m.activity.midTurnSessions) });
      return go(m, 'thinking', now, effects);

    case 'hook:tool_start':
      m = withActivity(m, now, {
        inFlightTools: m.activity.inFlightTools + 1,
        midTurnSessions: Math.max(1, m.activity.midTurnSessions),
      });
      return go(m, 'working', now, effects);

    case 'hook:tool_end':
      m = withActivity(m, now, { inFlightTools: Math.max(0, m.activity.inFlightTools - 1) });
      return go(m, m.activity.inFlightTools > 0 ? 'working' : 'thinking', now, effects);

    case 'hook:stop':
      m = withActivity(m, now, {
        midTurnSessions: Math.max(0, m.activity.midTurnSessions - 1),
        inFlightTools: 0,
      });
      return go(m, 'success', now, effects);

    case 'hook:notification':
      m = withActivity(m, now, {});
      return go(m, 'error', now, effects);

    case 'activity:update': {
      m = {
        ...m,
        activity: {
          inFlightTools: Math.max(0, s.inFlightTools),
          midTurnSessions: Math.max(0, s.midTurnSessions),
          lastEventAt: s.lastEventAt,
        },
        lastInteractionAt: Math.max(m.lastInteractionAt, s.lastEventAt),
      };
      // The snapshot is authoritative: tools in flight means working, a live turn means thinking.
      if (m.activity.inFlightTools > 0) return go(m, 'working', now, effects);
      if (m.activity.midTurnSessions > 0 && PRIORITY[m.state] < PRIORITY.thinking) {
        return go(m, 'thinking', now, effects);
      }
      return m;
    }

    case 'input:grab': {
      m = touch(m, now);
      const next = transition(m, 'dragged', now);
      if (next === m) return m;
      pushChange(m, next, effects);
      return { ...next, grabOffset: { x: m.pos.x - s.x, y: m.pos.y - s.y } };
    }

    case 'input:drag': {
      m = touch(m, now);
      if (m.state !== 'dragged' && m.state !== 'shaking') return m;
      const off = m.grabOffset ?? { x: 0, y: 0 };
      return {
        ...m,
        pos: {
          x: clamp(s.x + off.x, m.world.minX, m.world.maxX),
          y: Math.min(s.y + off.y, m.world.groundY),
        },
      };
    }

    case 'input:release': {
      m = touch(m, now);
      if (m.state !== 'dragged' && m.state !== 'shaking') return m;
      const above = m.pos.y < m.world.groundY - 1;
      const next = force(m, above ? 'falling' : 'idle', now, effects);
      // `landed` means "now resting on the ground", which is just as true for a release right at
      // ground level as it is for a completed fall (the falling branch of `integrate` emits it for
      // that case). The host only ever switches `PetWindow` back out of follow mode in reaction to
      // this effect (`PetHost.onLanded`) — without it here, a drop that doesn't go through
      // `falling` leaves the window stuck in its small follow square forever, and the pet
      // (continuing to walk in strip-sized world coordinates) visibly walks outside that square
      // almost immediately. Bug: reported as "mon walks out of frame and is hard to recover".
      if (!above) effects.push({ type: 'landed' });
      return next;
    }

    case 'input:shake-progress':
      m = touch(m, now);
      if (m.state !== 'dragged' && m.state !== 'shaking') return m;
      return go(m, 'shaking', now, effects);

    case 'input:shake': {
      m = touch(m, now);
      const next = transition(m, 'shaking', now);
      if (next === m) return m;
      pushChange(m, next, effects);
      if (m.stage !== 'egg') effects.push({ type: 'request-battle' });
      return next;
    }

    case 'input:click':
    case 'input:any':
      m = touch(m, now);
      if (m.state === 'sleep') return go(m, 'idle', now, effects);
      return m;

    case 'game:levelup':
      return go(m, 'celebrate', now, effects);

    case 'game:hatch':
      return go(m, 'hatching', now, effects);

    case 'game:evolve':
      m = { ...m, stage: s.stage };
      return go(m, 'evolving', now, effects);

    case 'battle:play':
      return go(m, 'battle_intro', now, effects);
    case 'battle:attack':
      return go(m, 'battle_attack', now, effects);
    case 'battle:hit':
      return go(m, 'battle_hit', now, effects);
    case 'battle:win':
      return go(m, 'battle_win', now, effects);
    case 'battle:lose':
      return go(m, 'battle_lose', now, effects);
    case 'battle:done':
      if (!isBattleState(m.state)) return m;
      return force(m, 'idle', now, effects);

    case 'world:bounds': {
      const world = { minX: s.minX, maxX: s.maxX, groundY: s.groundY };
      const airborne = isAirborneState(m.state);
      return {
        ...m,
        world,
        pos: {
          x: clamp(m.pos.x, world.minX, world.maxX),
          y: airborne ? Math.min(m.pos.y, world.groundY) : world.groundY,
        },
      };
    }

    case 'world:recenter': {
      // Recovery action ("Bring pet back"): snap to the center of the current world, back on the
      // ground, cancelling any drag/fall/walk in progress. Left alone mid-battle so an in-progress
      // battle animation is not derailed.
      const center = (m.world.minX + m.world.maxX) / 2;
      m = { ...m, pos: { x: center, y: m.pos.y }, vel: { x: 0, y: 0 }, grabOffset: null };
      if (isBattleState(m.state)) return m;
      return force(m, 'idle', now, effects);
    }

    case 'stage:set': {
      m = { ...m, stage: s.stage };
      const mapped = remapForStage(m.state, s.stage);
      return mapped === m.state ? m : force(m, mapped, now, effects);
    }
  }
}

function handleExpiry(model: BehaviorModel, now: number, effects: Effect[]): BehaviorModel {
  if (model.expiresAt === null || model.expiresAt > now) return model;
  let m = model;
  switch (m.state) {
    case 'idle': {
      const [roll, rng] = nextRandom(m.rng);
      m = { ...m, rng };
      const next: PetState =
        roll < SCHEDULE.IDLE_TO_WALK
          ? 'walk'
          : roll < SCHEDULE.IDLE_TO_WALK + SCHEDULE.IDLE_TO_SIT
            ? 'sit'
            : 'idle';
      return force(m, next, now, effects);
    }
    case 'egg_idle': {
      const [roll, rng] = nextRandom(m.rng);
      m = { ...m, rng };
      return force(m, roll < SCHEDULE.EGG_WOBBLE ? 'egg_wobble' : 'egg_idle', now, effects);
    }
    case 'walk':
    case 'sit':
    case 'egg_wobble':
    case 'success':
    case 'error':
    case 'celebrate':
    case 'hatching':
    case 'evolving':
      // `idle` is remapped to `egg_idle` while the stage is still egg.
      return force(m, 'idle', now, effects);
    case 'shaking':
      if (m.grabOffset !== null) return force(m, 'dragged', now, effects);
      return force(m, m.pos.y < m.world.groundY - 1 ? 'falling' : 'idle', now, effects);
    default:
      return { ...m, expiresAt: null };
  }
}

function handleDecay(model: BehaviorModel, now: number, effects: Effect[]): BehaviorModel {
  const { state, activity } = model;
  if (
    state === 'working' &&
    activity.inFlightTools === 0 &&
    now - activity.lastEventAt > DURATIONS.WORKING_DECAY
  ) {
    return force(model, 'thinking', now, effects);
  }
  if (
    state === 'thinking' &&
    activity.midTurnSessions === 0 &&
    now - activity.lastEventAt > DURATIONS.THINKING_DECAY
  ) {
    return force(model, 'idle', now, effects);
  }
  return model;
}

function handleSleep(model: BehaviorModel, now: number, effects: Effect[]): BehaviorModel {
  const { state } = model;
  if (state !== 'idle' && state !== 'sit' && state !== 'walk') return model;
  if (now - model.lastInteractionAt <= DURATIONS.SLEEP_AFTER) return model;
  return force(model, 'sleep', now, effects, null);
}

function integrate(model: BehaviorModel, now: number, effects: Effect[]): BehaviorModel {
  const dt = clamp((now - model.updatedAt) / 1000, 0, MAX_DT);
  if (dt === 0) return model;
  const { world } = model;

  if (model.state === 'walk') {
    let x = model.pos.x + model.vel.x * dt;
    let facing = model.facing;
    let vx = model.vel.x;
    if (x <= world.minX) {
      x = world.minX;
      facing = 1;
      vx = model.walkSpeed;
    } else if (x >= world.maxX) {
      x = world.maxX;
      facing = -1;
      vx = -model.walkSpeed;
    }
    return { ...model, pos: { x, y: model.pos.y }, facing, vel: { x: vx, y: model.vel.y } };
  }

  if (model.state === 'falling') {
    const vy = model.vel.y + GRAVITY * dt;
    const y = model.pos.y + vy * dt;
    if (y >= world.groundY) {
      const landed = { ...model, pos: { x: model.pos.x, y: world.groundY }, vel: { x: 0, y: 0 } };
      const next = force(landed, 'idle', now, effects);
      effects.push({ type: 'landed' });
      return next;
    }
    return { ...model, pos: { x: model.pos.x, y }, vel: { x: model.vel.x, y: vy } };
  }

  return model;
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return min;
  return value < min ? min : value > max ? max : value;
}
