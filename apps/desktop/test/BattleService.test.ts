import { describe, expect, it } from 'vitest';
import { BATTLE_RULES, xpForLevel } from '@claude-mons/shared';
import { BattleService } from '../src/main/game/BattleService.ts';
import { defaultState, type LocalState } from '../src/main/persistence/state.ts';

function setup(opts: { hatched?: boolean; level?: number } = {}) {
  const state = defaultState();
  state.profile.nation = 'fire';
  if (opts.hatched !== false) {
    state.pet.speciesId = 'sparkit';
    state.progress.stage = 'baby';
  }
  let clock = Date.UTC(2026, 8, 4, 12, 0, 0);
  const xp = xpForLevel(opts.level ?? 5);
  const access = {
    get: () => state,
    update(fn: (s: LocalState) => void) {
      fn(state);
      return state;
    },
  };
  const service = new BattleService({
    state: access,
    totalXp: () => xp,
    backend: null,
    now: () => clock,
    random: () => 0.42,
  });
  return { state, service, advance: (ms: number) => (clock += ms) };
}

describe('BattleService (offline / wild mon)', () => {
  it('refuses eggs', async () => {
    const { service } = setup({ hatched: false });
    expect(await service.request()).toEqual({ ok: false, reason: 'egg' });
  });

  it('fights a wild mon from another nation at the same level and credits xp on finish', async () => {
    const { service, state } = setup({ level: 7 });
    const r = await service.request();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.play.isBot).toBe(true);
    expect(r.play.me.level).toBe(7);
    expect(r.play.opponent.level).toBe(7);
    expect(r.play.opponent.nation).not.toBe('fire');
    expect(r.play.opponent.playerId).toBeNull();
    expect(r.play.result.turns.length).toBeGreaterThan(0);
    expect([5, 20]).toContain(r.play.reward);

    // finishing an unknown id does nothing
    expect(service.finish('nope')).toBeNull();
    const summary = service.finish(r.play.id);
    expect(summary?.id).toBe(r.play.id);
    expect(summary?.won).toBe(r.play.result.winner === 'a');
    expect(state.battles.history).toHaveLength(1);
    expect(state.battles.history[0]?.opponent.nation).toBe(r.play.opponent.nation);
  });

  it('enforces the cooldown and the daily cap locally', async () => {
    const { service, advance } = setup();
    const first = await service.request();
    expect(first.ok).toBe(true);
    if (first.ok) service.finish(first.play.id);
    const again = await service.request();
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('cooldown');
    expect(service.cooldownUntil()).not.toBeNull();

    for (let i = 1; i < BATTLE_RULES.challengesPerDay; i++) {
      advance(BATTLE_RULES.cooldownMs + 1);
      const r = await service.request();
      expect(r.ok).toBe(true);
      if (r.ok) service.finish(r.play.id);
    }
    expect(service.remainingToday()).toBe(0);
    advance(BATTLE_RULES.cooldownMs + 1);
    const capped = await service.request();
    expect(capped).toEqual({ ok: false, reason: 'daily_cap' });
    // next day resets the cap
    advance(24 * 3600_000);
    expect(service.remainingToday()).toBe(BATTLE_RULES.challengesPerDay);
  });

  it('refuses a second request while one battle is being played', async () => {
    const { service, advance } = setup();
    const first = await service.request();
    expect(first.ok).toBe(true);
    advance(BATTLE_RULES.cooldownMs + 1);
    expect(await service.request()).toEqual({ ok: false, reason: 'busy' });
  });
});
