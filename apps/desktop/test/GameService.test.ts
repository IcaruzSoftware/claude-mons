import { describe, expect, it } from 'vitest';
import type { HookEnvelope } from '@claude-mons/shared';
import { HATCH_XP } from '@claude-mons/shared';
import { GameService, type StateAccess } from '../src/main/game/GameService.ts';
import { defaultState, type LocalState } from '../src/main/persistence/state.ts';

function access(): StateAccess & { state: LocalState } {
  const state = defaultState();
  state.profile.nation = 'fire';
  return {
    state,
    get: () => state,
    update(fn) {
      fn(state);
      return state;
    },
  };
}

function ev(event: HookEnvelope['event'], extra: Partial<HookEnvelope> = {}): HookEnvelope {
  return { v: 1, id: 'x', ts: 0, event, spooled: false, session_id: 's', ...extra };
}

/** A realistic Claude turn: prompt, N tools, stop. */
function turn(game: GameService, tools: string[]): void {
  game.ingest(ev('UserPromptSubmit'));
  for (const t of tools) game.ingest(ev('PostToolUse', { tool_name: t }));
  game.ingest(ev('Stop'));
}

describe('GameService', () => {
  it('credits provisional xp for a turn and fills the pending bucket', () => {
    const a = access();
    let clock = Date.UTC(2026, 8, 4, 12, 0, 0);
    const game = new GameService(a, {
      localGame: true,
      rollSpecies: () => 'sparkit',
      now: () => clock,
    });
    const xp: number[] = [];
    game.on('xp', (e) => xp.push(e.amount));
    turn(game, ['Read', 'Edit', 'Edit']);
    expect(a.state.progress.localXp).toBe(5 + 1 + 2 + 2 + 10);
    expect(xp).toEqual([5, 1, 2, 2, 10]);
    expect(a.state.ledger.pending).toHaveLength(1);
    expect(a.state.ledger.pending[0]).toMatchObject({
      prompts: 1,
      stops: 1,
      tools: { Read: 1, Edit: 2 },
    });
    clock += 60_000;
    turn(game, ['Bash']);
    expect(a.state.ledger.pending).toHaveLength(2);
  });

  it('hatches locally at HATCH_XP when authoritative and never regresses stage', () => {
    const a = access();
    let clock = Date.UTC(2026, 8, 4, 12, 0, 0);
    const game = new GameService(a, {
      localGame: true,
      rollSpecies: (nation) => `${nation}-mon`,
      now: () => clock,
    });
    const events: string[] = [];
    game.on('hatch', (e) => events.push(`hatch:${e.speciesId}`));
    game.on('levelup', (e) => events.push(`level:${e.to}`));
    // 26 xp per turn incl. tools; each turn in a new minute to dodge per-minute caps
    while (game.totalXp() < HATCH_XP) {
      turn(game, ['Edit', 'Read']);
      clock += 60_000;
    }
    expect(a.state.progress.stage).toBe('baby');
    expect(a.state.pet.speciesId).toBe('fire-mon');
    expect(events).toContain('hatch:fire-mon');
    expect(events).toContain('level:2');
    expect(game.snapshot().stage).toBe('baby');
  });

  it('does not hatch locally when the server is authoritative', () => {
    const a = access();
    let clock = Date.UTC(2026, 8, 4, 12, 0, 0);
    const game = new GameService(a, {
      localGame: false,
      rollSpecies: () => 'nope',
      now: () => clock,
    });
    for (let i = 0; i < 10; i++) {
      turn(game, ['Edit', 'Read']);
      clock += 60_000;
    }
    expect(game.totalXp()).toBeGreaterThan(HATCH_XP);
    expect(a.state.progress.stage).toBe('egg');
    expect(a.state.pet.speciesId).toBeNull();

    const hatched: string[] = [];
    game.on('hatch', (e) => hatched.push(e.speciesId));
    game.applyServerState({ totalXp: 150, speciesId: 'cinderpup', stage: 'baby' });
    expect(a.state.pet.speciesId).toBe('cinderpup');
    expect(a.state.progress.stage).toBe('baby');
    expect(a.state.progress.serverXp).toBe(150);
    expect(hatched).toEqual(['cinderpup']);
    expect(game.totalXp()).toBe(150);
  });

  it('pays the daily bonus once the day reaches 50 work xp', () => {
    const a = access();
    let clock = Date.UTC(2026, 8, 4, 12, 0, 0);
    const game = new GameService(a, {
      localGame: true,
      rollSpecies: () => 'sparkit',
      now: () => clock,
    });
    const sources: string[] = [];
    game.on('xp', (e) => sources.push(e.source));
    turn(game, ['Edit']); // 17
    clock += 60_000;
    turn(game, ['Edit']); // 34
    clock += 60_000;
    turn(game, ['Edit']); // 51 -> bonus
    expect(sources.filter((s) => s === 'bonus')).toHaveLength(1);
    expect(a.state.streak.streakDays).toBe(1);
    expect(a.state.bonusXp).toBe(25 + 10);
    clock += 60_000;
    turn(game, ['Edit']);
    expect(sources.filter((s) => s === 'bonus')).toHaveLength(1);
  });

  it('spooled events are credited at their original time', () => {
    const a = access();
    const now = Date.UTC(2026, 8, 4, 12, 0, 0);
    const game = new GameService(a, {
      localGame: true,
      rollSpecies: () => 'sparkit',
      now: () => now,
    });
    game.ingest(ev('UserPromptSubmit', { spooled: true, ts: now - 2 * 3600_000 }));
    expect(a.state.ledger.pending[0]?.minute).toBe(now - 2 * 3600_000);
    expect(a.state.progress.localXp).toBe(5);
    // too old: dropped as stale
    game.ingest(ev('UserPromptSubmit', { spooled: true, ts: now - 30 * 3600_000 }));
    expect(a.state.progress.localXp).toBe(5);
  });
});
