import { describe, expect, it } from 'vitest';
import { BATTLE_RULES, xpForLevel } from '@claude-mons/shared';
import { BattleService, type BattleServiceDeps } from '../src/main/game/BattleService.ts';
import { defaultState, type LocalState } from '../src/main/persistence/state.ts';

function setup(
  opts: { hatched?: boolean; level?: number; backend?: BattleServiceDeps['backend'] } = {},
) {
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
    backend: opts.backend ?? null,
    now: () => clock,
    random: () => 0.42,
  });
  return { state, service, advance: (ms: number) => (clock += ms) };
}

describe('BattleService (offline / wild mon)', () => {
  it('persists the resolved battle immediately and keeps its time across animation completion', async () => {
    const { service, state, advance } = setup();
    const result = await service.request();
    if (!result.ok) throw new Error('Expected a battle');
    expect(state.battles.history).toHaveLength(1);
    const at = state.battles.history[0]!.at;
    advance(60_000);
    expect(service.finish(result.play.id)?.at).toBe(at);
    expect(service.finish(result.play.id)).toBeNull();
    expect(state.battles.history).toHaveLength(1);
  });
  it('reports readiness only for an eligible hatched mon, recovering after cooldown and day reset', async () => {
    expect(setup({ hatched: false }).service.isReady()).toBe(false);
    const { service, state, advance } = setup();
    expect(service.isReady()).toBe(true);
    state.profile.nation = null;
    expect(service.isReady()).toBe(false);
    state.profile.nation = 'fire';
    const result = await service.request();
    expect(result.ok).toBe(true);
    expect(service.isReady()).toBe(false);
    if (result.ok) service.finish(result.play.id);
    expect(service.isReady()).toBe(false);
    advance(BATTLE_RULES.cooldownMs);
    expect(service.isReady()).toBe(true);
    state.battles.today.count = BATTLE_RULES.challengesPerDay;
    expect(service.isReady()).toBe(false);
    advance(24 * 3600_000);
    expect(service.isReady()).toBe(true);
  });

  it('refuses eggs', async () => {
    const { service } = setup({ hatched: false });
    expect(await service.request()).toEqual({ ok: false, reason: 'egg' });
  });

  it('fights a varied NPC from another nation and credits xp on finish', async () => {
    const { service, state } = setup({ level: 7 });
    const r = await service.request();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.play.isBot).toBe(true);
    expect(r.play.me.level).toBe(7);
    expect(r.play.opponent.level).toBe(6);
    expect(r.play.opponent.nation).not.toBe('fire');
    expect(r.play.opponent.playerId).toBeNull();
    expect(r.play.result.turns.length).toBeGreaterThan(0);
    expect(r.play.reward).toBeGreaterThanOrEqual(10);

    // finishing an unknown id does nothing
    expect(service.finish('nope')).toBeNull();
    const summary = service.finish(r.play.id);
    expect(summary?.id).toBe(r.play.id);
    expect(summary?.won).toBe(r.play.result.winner === 'a');
    expect(state.battles.history).toHaveLength(1);
    expect(state.battles.history[0]?.opponent.nation).toBe(r.play.opponent.nation);
    // Phase D (docs/design/progression.md recent-opponent intel): the opponent's loadout at battle
    // time is recorded alongside the rest of the summary, for `explainMatchup` to read back later.
    expect(state.battles.history[0]?.opponent.loadout.stance).toBe(r.play.opponent.loadout?.stance);
    expect(state.battles.history[0]?.opponent.loadout.moves).toEqual(
      r.play.opponent.loadout?.moves,
    );
  });

  it('does not repeat the previous wild element when other elements are available', async () => {
    const { service, advance } = setup({ level: 7 });
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await service.request();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      seen.push(result.play.opponent.nation);
      service.finish(result.play.id);
      advance(BATTLE_RULES.cooldownMs + 1);
    }
    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[2]).not.toBe(seen[1]);
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

  it('leaves the win streak untouched in NPC battles (only rival wins count)', async () => {
    const { service, state, advance } = setup({ level: 7 });
    state.battles.streak = 3;
    let won = false;
    let lost = false;
    for (let i = 0; i < 20 && !(won && lost); i++) {
      const r = await service.request();
      if (!r.ok) throw new Error('Expected a battle');
      if (r.play.result.winner === 'a') won = true;
      else lost = true;
      expect(r.play.winStreak).toBe(3);
      service.finish(r.play.id);
      advance(BATTLE_RULES.cooldownMs + 1);
    }
    expect(won).toBe(true);
    expect(state.battles.streak).toBe(3);
  });

  it('pays nothing for a fallback battle when the backend failed (the server never saw it)', async () => {
    const { service } = setup({ level: 7, backend: { request: async () => null } });
    const r = await service.request();
    if (!r.ok) throw new Error('Expected a battle');
    expect(r.play.isBot).toBe(true);
    expect(r.play.reward).toBe(0);
    expect(r.play.practice).toBe(true);
  });

  it('records a practice battle without using the cooldown or the daily count', async () => {
    const { service, state } = setup({ level: 7, backend: { request: async () => null } });
    const r = await service.request();
    if (!r.ok) throw new Error('Expected a battle');
    expect(state.battles.history[0]?.practice).toBe(true);
    expect(service.cooldownUntil()).toBeNull();
    expect(service.remainingToday()).toBe(BATTLE_RULES.challengesPerDay);
    service.finish(r.play.id);
    expect(service.isReady()).toBe(true);
  });

  it('refuses a second request while one battle is being played', async () => {
    const { service, advance } = setup();
    const first = await service.request();
    expect(first.ok).toBe(true);
    advance(BATTLE_RULES.cooldownMs + 1);
    expect(await service.request()).toEqual({ ok: false, reason: 'busy' });
  });
});
