import { statAtLevel } from '../game/levels.ts';
import { effectiveness } from '../game/nations.ts';
import {
  DEFAULT_STANCE,
  STANCE_COUNTER_DEALT_MULT,
  STANCE_COUNTER_TAKEN_MULT,
  applyStanceModifiers,
  stanceBeats,
  type MonLoadout,
} from '../game/progression.ts';
import { speciesOf } from '../game/species.ts';
import type { Nation, Stage, Stats } from '../types.ts';
import { makeRng } from './rng.ts';

export type Side = 'a' | 'b';

export interface MonSnapshot {
  monId: string;
  /** null = Wild Mon (bot) */
  playerId: string | null;
  nickname: string;
  nation: Nation;
  speciesId: string;
  stage: Exclude<Stage, 'egg'>;
  level: number;
  /** already scaled to `level`; stored so old logs replay after rebalances */
  stats: Stats;
  /**
   * Optional so pre-Phase-A stored snapshots keep replaying: a snapshot with no `loadout` (or no
   * `loadout.stance`) uses `DEFAULT_STANCE`. See `packages/shared/src/game/progression.ts`.
   */
  loadout?: MonLoadout;
}

export type MoveKind = 'normal' | 'typed' | 'special';

export interface BattleAction {
  actor: Side;
  move: string;
  kind: MoveKind;
  dodged: boolean;
  damage: number;
  crit: boolean;
  effectiveness: 0.5 | 1 | 2;
  targetHpAfter: number;
}

export interface BattleTurn {
  turn: number;
  first: Side;
  actions: BattleAction[];
}

export interface BattleResult {
  seed: string;
  winner: Side;
  reason: 'ko' | 'timeout_hp' | 'timeout_coin';
  turns: BattleTurn[];
  finalHp: Record<Side, number>;
  maxHp: Record<Side, number>;
}

export const MAX_TURNS = 10;
export const POWER: Record<MoveKind, number> = { normal: 45, typed: 40, special: 75 };

/**
 * Bumped whenever a formula or RNG-call-order change in `simulateBattle` would make a fresh replay
 * of an old log diverge (docs/design/progression.md "Any change to simulateBattle's RNG call
 * order..."). Stored per battle in `battles.protocol_version`; old logs are replayed from their
 * stored `log`, never recomputed from the snapshot at the current code version. v2 = Phase A
 * (stances, evolution multipliers).
 */
export const BATTLE_PROTOCOL_VERSION = 2;

const levelScale = (l: number): number => (l + 49) / 50;

export function statsAtLevel(base: Stats, level: number): Stats {
  return {
    hp: statAtLevel(base.hp, level),
    atk: statAtLevel(base.atk, level),
    def: statAtLevel(base.def, level),
    spd: statAtLevel(base.spd, level),
  };
}

/** Convenience for building a snapshot from species + level. */
export function snapshotFor(input: {
  monId: string;
  playerId: string | null;
  nickname: string;
  speciesId: string;
  stage: Exclude<Stage, 'egg'>;
  level: number;
  loadout?: MonLoadout;
}): MonSnapshot {
  const { loadout, ...rest } = input;
  const species = speciesOf(input.speciesId);
  return {
    ...rest,
    nation: species.nation,
    stats: statsAtLevel(species.baseStats, input.level),
    loadout: loadout ?? { stance: DEFAULT_STANCE },
  };
}

function stanceOf(m: MonSnapshot) {
  return m.loadout?.stance ?? DEFAULT_STANCE;
}

/**
 * Deterministic auto-battle. Same snapshots + same seed => same log, on client and server.
 * The RNG call order is part of the protocol: do not reorder calls.
 */
export function simulateBattle(a: MonSnapshot, b: MonSnapshot, seed: string): BattleResult {
  const rng = makeRng(seed);
  const mons: Record<Side, MonSnapshot> = { a, b };
  const hp: Record<Side, number> = { a: a.stats.hp, b: b.stats.hp };
  const specialUsed: Record<Side, boolean> = { a: false, b: false };
  const scale = levelScale((a.level + b.level) / 2);
  const turns: BattleTurn[] = [];

  // Stances (docs/design/progression.md): fixed for the whole battle, so computed once here rather
  // than per-turn. They do not add an RNG draw (no new call inserted into the protocol below), but
  // they do change the stats/damage formula, hence BATTLE_PROTOCOL_VERSION.
  const stance: Record<Side, ReturnType<typeof stanceOf>> = { a: stanceOf(a), b: stanceOf(b) };
  const effStats: Record<Side, Stats> = {
    a: applyStanceModifiers(a.stats, stance.a),
    b: applyStanceModifiers(b.stats, stance.b),
  };
  // At most one side counters the other's stance (a rock-paper-scissors triangle never ties two
  // distinct stances); if both picked the same stance, neither counters.
  const counters: Record<Side, boolean> = {
    a: stanceBeats(stance.a, stance.b),
    b: stanceBeats(stance.b, stance.a),
  };

  const act = (me: Side, foe: Side): BattleAction => {
    const M = mons[me];
    const F = mons[foe];
    const species = speciesOf(M.speciesId);
    const nationEff = effectiveness(M.nation, F.nation);
    const meStats = effStats[me];
    const foeStats = effStats[foe];

    let kind: MoveKind;
    if (!specialUsed[me] && hp[me] <= M.stats.hp / 2) {
      kind = 'special';
      specialUsed[me] = true;
    } else {
      const best: MoveKind = POWER.typed * nationEff > POWER.normal ? 'typed' : 'normal';
      kind = rng() < 0.75 ? best : best === 'typed' ? 'normal' : 'typed';
    }
    const moveEff: 0.5 | 1 | 2 = kind === 'normal' ? 1 : nationEff;
    const move = species.moves[kind];

    const dodge = Math.min(0.2, Math.max(0, (foeStats.spd - meStats.spd) / 250));
    if (rng() < dodge) {
      return {
        actor: me,
        move,
        kind,
        dodged: true,
        damage: 0,
        crit: false,
        effectiveness: moveEff,
        targetHpAfter: hp[foe],
      };
    }
    const critChance = Math.min(0.3, Math.max(0.03, 0.08 + (meStats.spd - foeStats.spd) / 250));
    const crit = rng() < critChance;
    const variance = 0.7 + rng() * 0.6;
    const raw =
      ((((POWER[kind] * meStats.atk) / foeStats.def) * scale) / 4) *
      moveEff *
      (crit ? 2 : 1) *
      variance *
      (counters[me] ? STANCE_COUNTER_DEALT_MULT : 1) *
      (counters[foe] ? STANCE_COUNTER_TAKEN_MULT : 1);
    const damage = Math.max(1, Math.floor(raw));
    hp[foe] = Math.max(0, hp[foe] - damage);
    return {
      actor: me,
      move,
      kind,
      dodged: false,
      damage,
      crit,
      effectiveness: moveEff,
      targetHpAfter: hp[foe],
    };
  };

  // Turn order is probabilistic by speed (P(a first) = spd_a / (spd_a + spd_b)) so a one-point
  // speed edge does not decide every turn; a hard "faster always first" rule made +1 level ≈ 90 %.
  // Uses stance-modified speed, same as in-battle dodge/crit/turn-order math above.
  const pFirstA = effStats.a.spd / (effStats.a.spd + effStats.b.spd);
  for (let t = 1; t <= MAX_TURNS && hp.a > 0 && hp.b > 0; t++) {
    const first: Side = rng() < pFirstA ? 'a' : 'b';
    const second: Side = first === 'a' ? 'b' : 'a';
    const actions = [act(first, second)];
    if (hp[second] > 0) actions.push(act(second, first));
    turns.push({ turn: t, first, actions });
  }

  let winner: Side;
  let reason: BattleResult['reason'];
  if (hp.a <= 0) {
    winner = 'b';
    reason = 'ko';
  } else if (hp.b <= 0) {
    winner = 'a';
    reason = 'ko';
  } else {
    const pa = hp.a / a.stats.hp;
    const pb = hp.b / b.stats.hp;
    if (pa !== pb) {
      winner = pa > pb ? 'a' : 'b';
      reason = 'timeout_hp';
    } else {
      winner = rng() < 0.5 ? 'a' : 'b';
      reason = 'timeout_coin';
    }
  }
  return {
    seed,
    winner,
    reason,
    turns,
    finalHp: { ...hp },
    maxHp: { a: a.stats.hp, b: b.stats.hp },
  };
}

export const BATTLE_RULES = {
  cooldownMs: 10 * 60 * 1000,
  challengesPerDay: 50,
  defensesPerDay: 10,
} as const;

/** XP awarded to the challenger for a battle result. */
export function challengerReward(input: {
  won: boolean;
  isBot: boolean;
  myLevel: number;
  oppLevel: number;
}): number {
  if (input.isBot) return input.won ? 20 : 5;
  if (!input.won) return 10;
  const diff = Math.max(-3, Math.min(3, input.oppLevel - input.myLevel));
  return 30 + 5 * diff;
}

/** XP credited to the snapshot owner who was challenged. */
export function defenderReward(defenderWon: boolean): number {
  return defenderWon ? 8 : 3;
}

/**
 * Win-streak XP multiplier (docs/design/progression.md Matchmaking and streaks): +10% per
 * consecutive win, capped at +50% (5 wins). `streak` is the streak count *after* this win (0 for a
 * loss). Applied server-side in `settle_battle` (SQL mirror), which is authoritative for
 * `mons.win_streak`; exported here for the balance test harness and any client-side preview.
 */
export function winStreakMultiplier(streak: number): number {
  return 1 + 0.1 * Math.min(Math.max(0, Math.floor(streak)), 5);
}
