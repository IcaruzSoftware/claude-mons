import { statAtLevel } from '../game/levels.ts';
import { effectiveness } from '../game/nations.ts';
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
}): MonSnapshot {
  const species = speciesOf(input.speciesId);
  return {
    ...input,
    nation: species.nation,
    stats: statsAtLevel(species.baseStats, input.level),
  };
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

  const act = (me: Side, foe: Side): BattleAction => {
    const M = mons[me];
    const F = mons[foe];
    const species = speciesOf(M.speciesId);
    const eff = effectiveness(M.nation, F.nation);

    let kind: MoveKind;
    if (!specialUsed[me] && hp[me] <= M.stats.hp / 2) {
      kind = 'special';
      specialUsed[me] = true;
    } else {
      const best: MoveKind = POWER.typed * eff > POWER.normal ? 'typed' : 'normal';
      kind = rng() < 0.75 ? best : best === 'typed' ? 'normal' : 'typed';
    }
    const moveEff: 0.5 | 1 | 2 = kind === 'normal' ? 1 : eff;
    const move = species.moves[kind];

    const dodge = Math.min(0.2, Math.max(0, (F.stats.spd - M.stats.spd) / 250));
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
    const critChance = Math.min(0.3, Math.max(0.03, 0.08 + (M.stats.spd - F.stats.spd) / 250));
    const crit = rng() < critChance;
    const variance = 0.7 + rng() * 0.6;
    const raw =
      ((((POWER[kind] * M.stats.atk) / F.stats.def) * scale) / 4) *
      moveEff *
      (crit ? 2 : 1) *
      variance;
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
  const pFirstA = a.stats.spd / (a.stats.spd + b.stats.spd);
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
  cooldownMs: 5 * 60 * 1000,
  challengesPerDay: 10,
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
