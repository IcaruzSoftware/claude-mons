import {
  BURN_TURNS,
  CHARGE_MULTIPLIER,
  CRIT_UP_BONUS,
  CRIT_UP_MAX,
  DEF_DOWN_MULT,
  DEF_DOWN_TURNS,
  DRAIN_FRACTION,
  SHIELD_FIRST_REDUCTION,
  burnTickDamage,
  initSideEffectState,
  type EffectId,
  type SideEffectState,
} from './effects.ts';
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
import { defaultLoadoutMoveIds, findMove, speciesOf, type Move } from '../game/species.ts';
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
   * `stance` defaults to `DEFAULT_STANCE` and `moves` to `defaultLoadoutMoveIds` (see
   * `snapshotFor`) so every snapshot this module builds always has both -- but the field stays
   * optional on the type because pre-Phase-A/B stored snapshots (`battles.*_snapshot`) predate one
   * or both and must keep replaying from their own stored log, never recomputed.
   */
  loadout?: MonLoadout;
}

export interface BattleAction {
  actor: Side;
  move: string;
  /** null for a synthetic action (currently only an end-of-turn burn tick). */
  moveId: string | null;
  dodged: boolean;
  damage: number;
  crit: boolean;
  effectiveness: 0.5 | 1 | 2;
  targetHpAfter: number;
  /** the effect this action applied/expressed, if any (docs/design/progression.md Move pool). */
  effect: EffectId | null;
  /** present when `effect === 'charge'`: whether this action telegraphed or released. */
  charge?: 'telegraph' | 'release';
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

/**
 * Bumped whenever a formula or RNG-call-order change in `simulateBattle` would make a fresh replay
 * of an old log diverge (docs/design/progression.md "Any change to simulateBattle's RNG call
 * order..."). Stored per battle in `battles.protocol_version`; old logs are replayed from their
 * stored `log`, never recomputed at a newer version. v2 = Phase A (stances, evolution multipliers).
 * v3 = Phase B (6-move pools, loadout policy, move effects: the `special`-at-half-HP rule and the
 * fixed `normal`/`typed` power table are gone, replaced by each mon's own `movePool`/`loadout`).
 */
export const BATTLE_PROTOCOL_VERSION = 3;

const levelScale = (l: number): number => (l + 49) / 50;

export function statsAtLevel(base: Stats, level: number): Stats {
  return {
    hp: statAtLevel(base.hp, level),
    atk: statAtLevel(base.atk, level),
    def: statAtLevel(base.def, level),
    spd: statAtLevel(base.spd, level),
  };
}

/**
 * Convenience for building a snapshot from species + level. Always fills in a full `loadout`
 * (`stance` defaulting to `DEFAULT_STANCE`, `moves` defaulting to `defaultLoadoutMoveIds`) so the
 * snapshot stored in `battles.*_snapshot` always carries the loadout that was actually equipped,
 * even for a mon (or Wild Mon) that never called `set-loadout`.
 */
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
  const moves =
    loadout?.moves && loadout.moves.length === 3
      ? loadout.moves
      : defaultLoadoutMoveIds(species, input.level);
  return {
    ...rest,
    nation: species.nation,
    stats: statsAtLevel(species.baseStats, input.level),
    loadout: { ...loadout, stance: loadout?.stance ?? DEFAULT_STANCE, moves },
  };
}

function stanceOf(m: MonSnapshot) {
  return m.loadout?.stance ?? DEFAULT_STANCE;
}

/** Resolves a snapshot's 3 equipped moves as `Move` objects, defaulting/repairing as needed. */
function resolveLoadoutMoves(mon: MonSnapshot): [Move, Move, Move] {
  const species = speciesOf(mon.speciesId);
  const ids = mon.loadout?.moves?.length === 3 ? mon.loadout.moves : null;
  const resolved = ids?.map((id) => findMove(species, id));
  if (resolved && resolved.every((m): m is Move => m !== undefined)) {
    return resolved as [Move, Move, Move];
  }
  // Missing, malformed, or a move id the pool no longer has (e.g. a stale stored id) -- fall back
  // to the level-appropriate default rather than throwing mid-battle.
  const fallback = defaultLoadoutMoveIds(species, mon.level).map((id) => findMove(species, id)!);
  return fallback as [Move, Move, Move];
}

/**
 * Deterministic auto-battle. Same snapshots + same seed => same log, on client and server.
 * The RNG call order is part of the protocol: do not reorder calls.
 */
export function simulateBattle(a: MonSnapshot, b: MonSnapshot, seed: string): BattleResult {
  const rng = makeRng(seed);
  const mons: Record<Side, MonSnapshot> = { a, b };
  const hp: Record<Side, number> = { a: a.stats.hp, b: b.stats.hp };
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

  const loadoutMoves: Record<Side, [Move, Move, Move]> = {
    a: resolveLoadoutMoves(a),
    b: resolveLoadoutMoves(b),
  };
  const fx: Record<Side, SideEffectState<Move>> = {
    a: initSideEffectState(loadoutMoves.a.some((m) => m.effect === 'shield_first')),
    b: initSideEffectState(loadoutMoves.b.some((m) => m.effect === 'shield_first')),
  };

  /**
   * Loadout policy (docs/design/progression.md Loadout policy): turn 1 always the opener (slot 1);
   * the finisher (slot 3) fires once per battle the first turn target HP < 35% or own HP < 40%;
   * otherwise slot 2 w.p. 0.8, slot 1 w.p. 0.2 (one rng draw); a pending `charge` release always
   * overrides all of the above.
   */
  const pickMove = (
    side: Side,
    turnNum: number,
  ): { move: Move; charge: 'telegraph' | 'release' | null } => {
    const state = fx[side];
    if (state.chargePending) {
      const move = state.chargePending;
      state.chargePending = null;
      return { move, charge: 'release' };
    }
    const [opener, standard, finisher] = loadoutMoves[side];
    const chargeOf = (m: Move) => (m.effect === 'charge' ? ('telegraph' as const) : null);
    if (turnNum === 1) return { move: opener, charge: chargeOf(opener) };
    const foeSide: Side = side === 'a' ? 'b' : 'a';
    const ownFrac = hp[side] / mons[side].stats.hp;
    const foeFrac = hp[foeSide] / mons[foeSide].stats.hp;
    if (!state.finisherUsed && (foeFrac < 0.35 || ownFrac < 0.4)) {
      state.finisherUsed = true;
      return { move: finisher, charge: chargeOf(finisher) };
    }
    const move = rng() < 0.8 ? standard : opener;
    return { move, charge: chargeOf(move) };
  };

  const act = (
    me: Side,
    foe: Side,
    move: Move,
    charge: 'telegraph' | 'release' | null,
  ): BattleAction => {
    const M = mons[me];
    const nationEff = effectiveness(M.nation, mons[foe].nation);
    const meStats = effStats[me];
    const foeStats = effStats[foe];
    const moveEff: 0.5 | 1 | 2 = move.type === 'neutral' ? 1 : nationEff;

    if (charge === 'telegraph') {
      return {
        actor: me,
        move: move.name,
        moveId: move.id,
        dodged: false,
        damage: 0,
        crit: false,
        effectiveness: moveEff,
        targetHpAfter: hp[foe],
        effect: move.effect,
        charge,
      };
    }

    // `true_hit` ignores the target's dodge chance entirely -- no roll is made for it, same as no
    // roll is made for a battle that never reaches this action (both are new v3 branch points; the
    // protocol version bump means the old "every action rolls dodge" call order does not need
    // preserving).
    let dodged = false;
    if (move.effect !== 'true_hit') {
      const dodge = Math.min(0.2, Math.max(0, (foeStats.spd - meStats.spd) / 250));
      dodged = rng() < dodge;
    }
    if (dodged) {
      return {
        actor: me,
        move: move.name,
        moveId: move.id,
        dodged: true,
        damage: 0,
        crit: false,
        effectiveness: moveEff,
        targetHpAfter: hp[foe],
        effect: move.effect,
        ...(charge ? { charge } : {}),
      };
    }

    let critChance = Math.min(0.3, Math.max(0.03, 0.08 + (meStats.spd - foeStats.spd) / 250));
    if (move.effect === 'crit_up') critChance = Math.min(CRIT_UP_MAX, critChance + CRIT_UP_BONUS);
    const crit = rng() < critChance;
    const variance = 0.7 + rng() * 0.6;
    const power = charge === 'release' ? move.power * CHARGE_MULTIPLIER : move.power;
    const foeDef = foeStats.def * (fx[foe].defDownTurns > 0 ? DEF_DOWN_MULT : 1);
    const raw =
      ((power * meStats.atk) / foeDef) *
      scale *
      0.25 *
      moveEff *
      (crit ? 2 : 1) *
      variance *
      (counters[me] ? STANCE_COUNTER_DEALT_MULT : 1) *
      (counters[foe] ? STANCE_COUNTER_TAKEN_MULT : 1);
    let damage = Math.max(1, Math.floor(raw));

    // `shield_first`: the first hit this mon takes in the whole battle is reduced (once/battle).
    const foeState = fx[foe];
    if (foeState.hasShieldFirst && !foeState.shieldConsumed) {
      damage = Math.max(1, Math.floor(damage * (1 - SHIELD_FIRST_REDUCTION)));
      foeState.shieldConsumed = true;
    }
    hp[foe] = Math.max(0, hp[foe] - damage);

    if (move.effect === 'drain') {
      hp[me] = Math.min(M.stats.hp, hp[me] + Math.floor(damage * DRAIN_FRACTION));
    }
    if (move.effect === 'def_down') {
      foeState.defDownTurns = DEF_DOWN_TURNS; // refreshes rather than stacking
    }
    if (move.effect === 'burn' && foeState.burnTurns === 0) {
      foeState.burnTurns = BURN_TURNS; // only one instance active at a time
    }

    return {
      actor: me,
      move: move.name,
      moveId: move.id,
      dodged: false,
      damage,
      crit,
      effectiveness: moveEff,
      targetHpAfter: hp[foe],
      effect: move.effect,
      ...(charge ? { charge } : {}),
    };
  };

  for (let t = 1; t <= MAX_TURNS && hp.a > 0 && hp.b > 0; t++) {
    const pickA = pickMove('a', t);
    const pickB = pickMove('b', t);
    const priorityA = pickA.move.effect === 'priority';
    const priorityB = pickB.move.effect === 'priority';
    let first: Side;
    if (priorityA !== priorityB) {
      first = priorityA ? 'a' : 'b';
    } else {
      // Turn order is probabilistic by speed (P(a first) = spd_a / (spd_a + spd_b)) so a one-point
      // speed edge does not decide every turn; a hard "faster always first" rule made +1 level ≈
      // 90 %. Uses stance-modified speed, same as in-battle dodge/crit math above. `def_down` never
      // touches SPD, so this does not need to account for it.
      const pFirstA = effStats.a.spd / (effStats.a.spd + effStats.b.spd);
      first = rng() < pFirstA ? 'a' : 'b';
    }
    const second: Side = first === 'a' ? 'b' : 'a';
    const firstPick = first === 'a' ? pickA : pickB;
    const secondPick = second === 'a' ? pickA : pickB;

    const actions = [act(first, second, firstPick.move, firstPick.charge)];
    if (firstPick.charge === 'telegraph') fx[first].chargePending = firstPick.move;
    if (hp[second] > 0) {
      actions.push(act(second, first, secondPick.move, secondPick.charge));
      if (secondPick.charge === 'telegraph') fx[second].chargePending = secondPick.move;
    }

    // End-of-turn burn ticks, then decrement both timed effects. A tick that KOs a mon ends the
    // battle at the top of the next loop iteration (hp.a > 0 && hp.b > 0 fails), reported as
    // reason: 'ko' below, same as any other KO.
    for (const side of ['a', 'b'] as const) {
      if (hp[side] <= 0) continue;
      const state = fx[side];
      if (state.burnTurns > 0) {
        const tick = burnTickDamage(mons[side].stats.hp);
        const after = Math.max(0, hp[side] - tick);
        hp[side] = after;
        actions.push({
          actor: side,
          move: 'Burn',
          moveId: null,
          dodged: false,
          damage: tick,
          crit: false,
          effectiveness: 1,
          targetHpAfter: after,
          effect: 'burn',
        });
        state.burnTurns--;
      }
      if (state.defDownTurns > 0) state.defDownTurns--;
    }

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
