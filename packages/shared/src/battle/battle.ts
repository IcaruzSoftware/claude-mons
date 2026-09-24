import {
  BURN_FRACTION,
  BURN_TURNS,
  CHARGE_MULTIPLIER,
  CRIT_UP_BONUS,
  CRIT_UP_MAX,
  DEEP_ROOTS_DEF_BONUS,
  DEEP_ROOTS_HP_THRESHOLD,
  DEF_DOWN_MULT,
  DEF_DOWN_TURNS,
  DRAIN_FRACTION,
  EMBER_HEART_CRIT_BONUS,
  EMBER_HEART_HP_THRESHOLD,
  EYE_OF_STORM_CHANCE,
  PHOENIX_TRIGGER_CHANCE,
  SECOND_BREATH_HP,
  SHIELD_FIRST_REDUCTION,
  STONE_SKIN_REDUCTION,
  TIDAL_RECOVERY_HEAL_FRACTION,
  WILDFIRE_BURN_BONUS_FRACTION,
  WILDFIRE_BURN_EXTRA_TURNS,
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
import {
  defaultBotTree,
  resolveTree,
  type CapstoneEffect,
  type LoadoutSlot,
  type MoveUpgrade,
  type ResolvedTree,
  type SharedPassiveSlug,
} from '../game/tree.ts';
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
  /** already scaled to `level` -- stage multiplier and (Phase C) the mon's tree stat nodes, in
   * that order, both before stance -- and stored so old logs replay after rebalances. */
  stats: Stats;
  /**
   * `stance` defaults to `DEFAULT_STANCE` and `moves` to `defaultLoadoutMoveIds` (see
   * `snapshotFor`) so every snapshot this module builds always has both -- but the field stays
   * optional on the type because pre-Phase-A/B stored snapshots (`battles.*_snapshot`) predate one
   * or both and must keep replaying from their own stored log, never recomputed. `tree` similarly
   * defaults to a Wild Mon's `defaultBotTree` (Phase C); a real player's stored `tree` (or its
   * absence, for an empty/unspent tree) is always passed through as-is.
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
  effectiveness: number; // Includes multipliers in older stored battle logs.
  targetHpAfter: number;
  /** the effect this action applied/expressed, if any (docs/design/progression.md Move pool). */
  effect: EffectId | null;
  /** present when `effect === 'charge'`: whether this action telegraphed or released. */
  charge?: 'telegraph' | 'release';
  /** Optional so pre-v5 logs remain readable. */
  followThrough?: boolean;
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

/** Once per battle: a landed setup opener empowers a different hit while its debuff lasts. */
export const FOLLOW_THROUGH_MULT = 1.2;

/**
 * Bumped whenever a formula or RNG-call-order change in `simulateBattle` would make a fresh replay
 * of an old log diverge (docs/design/progression.md "Any change to simulateBattle's RNG call
 * order..."). Stored per battle in `battles.protocol_version`; old logs are replayed from their
 * stored `log`, never recomputed at a newer version. v2 = Phase A (stances, evolution multipliers).
 * v3 = Phase B (6-move pools, loadout policy, move effects). v4 = Phase C (talent tree: stat nodes
 * folded into snapshot stats, move-upgrade/capstone nodes and the 10 shared passives change the
 * damage formula and add several new deterministic branch points -- Bedrock's forced non-crit,
 * Updraft/Eye of the Storm's turn-order overrides, Tempest's instant charge release, and the
 * Phoenix Reborn/Second Breath KO interceptions -- none of which add or remove an `rng()` call by
 * themselves, but the golden log's *values* change because the formula does).
 */
export const BATTLE_PROTOCOL_VERSION = 5;

const levelScale = (l: number): number => (l + 49) / 50;

export function statsAtLevel(base: Stats, level: number): Stats {
  return {
    hp: statAtLevel(base.hp, level),
    atk: statAtLevel(base.atk, level),
    def: statAtLevel(base.def, level),
    spd: statAtLevel(base.spd, level),
  };
}

/** Folds a resolved tree's summed stat-node bonuses -- plus any `flatStat` capstone (Water's Deep
 * Reserve, Earth's Old Growth: "Max HP +N% flat, stacks with tier 1/2") -- into already
 * level-scaled stats (docs/design/talent-tree.md: "after stage multiplier, before stance"). Rounds
 * the same way `applyStanceModifiers` does. */
function applyTreeStatBonus(stats: Stats, resolved: ResolvedTree): Stats {
  const pct: Partial<Record<keyof Stats, number>> = { ...resolved.statBonusPct };
  for (const capstone of resolved.capstones) {
    if (capstone.kind === 'flatStat') pct[capstone.stat] = (pct[capstone.stat] ?? 0) + capstone.pct;
  }
  const mult = (key: keyof Stats) => 1 + (pct[key] ?? 0);
  return {
    hp: Math.round(stats.hp * mult('hp')),
    atk: Math.round(stats.atk * mult('atk')),
    def: Math.round(stats.def * mult('def')),
    spd: Math.round(stats.spd * mult('spd')),
  };
}

/**
 * Convenience for building a snapshot from species + level. Always fills in a full `loadout`
 * (`stance` defaulting to `DEFAULT_STANCE`, `moves` defaulting to `defaultLoadoutMoveIds`) so the
 * snapshot stored in `battles.*_snapshot` always carries the loadout that was actually equipped,
 * even for a mon (or Wild Mon) that never called `set-loadout`. A Wild Mon (`playerId: null`) with
 * no stored `tree` gets `defaultBotTree` (docs/design/talent-tree.md) so bots scale like players
 * instead of always fighting bare-tree; a real player's tree (including an intentionally empty
 * one) is passed through untouched.
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
  const tree =
    loadout?.tree ??
    (input.playerId === null ? defaultBotTree(species.nation, input.level) : undefined);
  const resolved = resolveTree(species.nation, tree);
  const stats = applyTreeStatBonus(statsAtLevel(species.baseStats, input.level), resolved);
  return {
    ...rest,
    nation: species.nation,
    stats,
    loadout: {
      ...loadout,
      stance: loadout?.stance ?? DEFAULT_STANCE,
      moves,
      ...(tree ? { tree } : {}),
    },
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

function hasCapstoneOf<K extends CapstoneEffect['kind']>(
  capstones: CapstoneEffect[],
  kind: K,
): Extract<CapstoneEffect, { kind: K }> | undefined {
  return capstones.find((c): c is Extract<CapstoneEffect, { kind: K }> => c.kind === kind);
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

  // Talent tree (docs/design/talent-tree.md, Phase C): resolved once per side, same as stances
  // above -- pure, no RNG. `slotOf` maps a mon's own equipped move ids to their loadout slot
  // (1 = opener, 2 = default, 3 = finisher) so move-upgrade lookups can key off the move actually
  // being used rather than re-deriving loadout order every action.
  const treeOf: Record<Side, ResolvedTree> = {
    a: resolveTree(a.nation, a.loadout?.tree),
    b: resolveTree(b.nation, b.loadout?.tree),
  };
  const slotOf: Record<Side, Record<string, LoadoutSlot>> = { a: {}, b: {} };
  for (const side of ['a', 'b'] as const) {
    const [opener, standard, finisher] = loadoutMoves[side];
    slotOf[side][opener.id] = 1;
    slotOf[side][standard.id] = 2;
    slotOf[side][finisher.id] = 3;
  }
  const hasPassive = (side: Side, slug: SharedPassiveSlug) => treeOf[side].sharedPassives.has(slug);
  const hasCapstone = <K extends CapstoneEffect['kind']>(side: Side, kind: K) =>
    hasCapstoneOf(treeOf[side].capstones, kind);
  const moveUpgradeFor = (side: Side, move: Move): MoveUpgrade | undefined => {
    const slot = slotOf[side][move.id];
    return slot ? treeOf[side].moveUpgradeBySlot[slot] : undefined;
  };
  const shieldFirstSlotOf = (side: Side): LoadoutSlot | null => {
    const idx = loadoutMoves[side].findIndex((m) => m.effect === 'shield_first');
    return idx === -1 ? null : ((idx + 1) as LoadoutSlot);
  };

  const fx: Record<Side, SideEffectState<Move>> = {
    a: initSideEffectState({
      hasShieldFirst: loadoutMoves.a.some((m) => m.effect === 'shield_first'),
      shieldFirstSlot: shieldFirstSlotOf('a'),
      hasStoneSkin: hasPassive('a', 'stone-skin'),
    }),
    b: initSideEffectState({
      hasShieldFirst: loadoutMoves.b.some((m) => m.effect === 'shield_first'),
      shieldFirstSlot: shieldFirstSlotOf('b'),
      hasStoneSkin: hasPassive('b', 'stone-skin'),
    }),
  };

  /** Effective ATK/SPD for `side` right now: base (stance-modified) stats, minus any active
   * `def_down`-riding ATK/SPD cut from Earth's Fissure Reckoning / Water's Abyssal Pull capstones
   * (docs/design/talent-tree.md). DEF is handled separately at the point of use, since a
   * Supernova crit (Fire's capstone) needs to see the *un-debuffed* DEF for that one action. */
  const liveStats = (side: Side): { atk: number; spd: number } => {
    const base = effStats[side];
    const st = fx[side];
    const atkMult = st.defDownTurns > 0 ? 1 - st.defDownExtraAtkFrac : 1;
    const spdMult = st.defDownTurns > 0 ? 1 - st.defDownExtraSpdFrac : 1;
    return { atk: base.atk * atkMult, spd: base.spd * spdMult };
  };

  /** Deep Roots (shared passive) latches on once `side` first drops below the threshold; Ember
   * Heart (shared passive) arms its one-shot crit bonus the same way. Called after every HP
   * change so both trigger the instant they're eligible, not just at end of turn. */
  const checkThresholdPassives = (side: Side) => {
    const frac = hp[side] / mons[side].stats.hp;
    const st = fx[side];
    if (!st.deepRootsActive && hasPassive(side, 'deep-roots') && frac < DEEP_ROOTS_HP_THRESHOLD) {
      st.deepRootsActive = true;
    }
    if (st.emberHeartArmed && hasPassive(side, 'ember-heart') && frac < EMBER_HEART_HP_THRESHOLD) {
      st.emberHeartArmed = false;
      st.emberHeartPending = true;
    }
  };

  /** Applies (or refreshes) `def_down` on `foe`, capturing the attacker's move-upgrade magnitude
   * and Earth's Fissure Reckoning / Water's Abyssal Pull capstones at the moment it lands. Shared
   * by the `def_down` move effect itself and Fire's Aftershock passive (crits also apply it). */
  const applyDefDown = (me: Side, foe: Side, upgrade: MoveUpgrade | undefined) => {
    const foeState = fx[foe];
    const cutFraction = (1 - DEF_DOWN_MULT) * (upgrade ? upgrade.effectMult : 1);
    foeState.defDownTurns = DEF_DOWN_TURNS;
    foeState.defDownMult = 1 - cutFraction;
    const spdCap = hasCapstone(me, 'defDownAlsoSpd');
    const atkCap = hasCapstone(me, 'defDownAlsoAtk');
    foeState.defDownExtraSpdFrac = spdCap ? spdCap.fraction : 0;
    foeState.defDownExtraAtkFrac = atkCap ? atkCap.fraction : 0;
  };

  // Reset every turn, set true in `act()` whenever a direct hit connects; copied into
  // `tookDamageLastTurn` at the end of the turn for Air's Eye of the Storm capstone to read next.
  const tookDamageThisTurn: Record<Side, boolean> = { a: false, b: false };
  const openingSetup: Record<Side, EffectId | null> = { a: null, b: null };

  /**
   * Loadout policy (docs/design/progression.md Loadout policy): turn 1 always the opener (slot 1);
   * the finisher (slot 3) fires once per battle the first turn target HP < 35% or own HP < 40%;
   * otherwise slot 2 w.p. 0.8, slot 1 w.p. 0.2 (one rng draw); a pending `charge` release always
   * overrides all of the above. Air's Tempest capstone (docs/design/talent-tree.md) skips the
   * telegraph turn entirely: a `charge` move resolves as an immediate `release`, never enters
   * `chargePending`, and so never costs the extra turn a normal charge move does.
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
    const tempest = hasCapstone(side, 'chargeInstant') !== undefined;
    const chargeOf = (m: Move) =>
      m.effect === 'charge' ? (tempest ? ('release' as const) : ('telegraph' as const)) : null;
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
    turnNum: number,
  ): BattleAction => {
    const M = mons[me];
    const nationEff = effectiveness(M.nation, mons[foe].nation);
    const meStats = liveStats(me);
    const foeStats = liveStats(foe);
    const moveEff = move.type === 'neutral' ? 1 : nationEff;
    const upgrade = moveUpgradeFor(me, move);

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
    // roll is made for a battle that never reaches this action.
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
    if (move.effect === 'crit_up') {
      critChance = Math.min(
        CRIT_UP_MAX,
        critChance + CRIT_UP_BONUS * (upgrade ? upgrade.effectMult : 1),
      );
    }
    // Ember Heart (shared passive): armed bonus applies to this mon's very next move, one-shot.
    if (fx[me].emberHeartPending) {
      critChance = Math.min(1, critChance + EMBER_HEART_CRIT_BONUS);
      fx[me].emberHeartPending = false;
    }
    let crit = rng() < critChance;
    // Bedrock (shared passive): absolute crit immunity for the defender, wins over the above.
    if (hasPassive(foe, 'bedrock')) crit = false;
    // Tailwind (shared passive): this mon's own slot-1 move always crits.
    if (!crit && hasPassive(me, 'tailwind') && slotOf[me][move.id] === 1) crit = true;

    const variance = 0.7 + rng() * 0.6;
    let power = move.power;
    if (charge === 'release') {
      power = move.power * CHARGE_MULTIPLIER * (upgrade ? upgrade.effectMult : 1);
    } else if (!move.effect || move.effect === 'priority' || move.effect === 'true_hit') {
      // Move-upgrade's "+10% power if the move has no scaling effect" branch (docs/design/
      // talent-tree.md): priority/true_hit have nothing to scale, and null is defensive (every
      // shipped move carries one of the 8 effects, but the type allows it).
      if (upgrade) power = move.power * upgrade.powerMult;
    }

    // Fire's Supernova capstone: a crit ignores the target's shield_first/def_down for this hit
    // only (deepRoots is a separate, unrelated buff and is not ignored).
    const supernova = crit && hasCapstone(me, 'critIgnoresGuards') !== undefined;
    const foeState = fx[foe];
    const defDownMult = foeState.defDownTurns > 0 && !supernova ? foeState.defDownMult : 1;
    const deepRootsMult = foeState.deepRootsActive ? 1 + DEEP_ROOTS_DEF_BONUS : 1;
    const defTerm = effStats[foe].def * defDownMult * deepRootsMult;

    const maelstrom = hasCapstone(me, 'critMultiplier');
    const critMultiplier = crit
      ? move.type === 'nation' && maelstrom
        ? maelstrom.multiplier
        : 2
      : 1;

    const setup = openingSetup[me];
    const followThrough =
      move.id !== loadoutMoves[me][0].id &&
      (move.effect === 'priority' ||
        move.effect === 'true_hit' ||
        move.effect === 'crit_up' ||
        move.effect === 'charge') &&
      ((setup === 'def_down' && foeState.defDownTurns > 0) ||
        (setup === 'burn' && foeState.burnTurns > 0));
    if (followThrough) openingSetup[me] = null;

    const raw =
      ((power * meStats.atk) / defTerm) *
      scale *
      0.25 *
      moveEff *
      (followThrough ? FOLLOW_THROUGH_MULT : 1) *
      critMultiplier *
      variance *
      (counters[me] ? STANCE_COUNTER_DEALT_MULT : 1) *
      (counters[foe] ? STANCE_COUNTER_TAKEN_MULT : 1);
    let damage = Math.max(1, Math.floor(raw));

    // `shield_first` / Stone Skin: the first hit this mon takes in the whole battle is reduced,
    // once each per battle (independent sources, so they stack multiplicatively); a Supernova crit
    // ignores both.
    if (!supernova) {
      if (foeState.hasShieldFirst && !foeState.shieldConsumed) {
        const shieldUpgrade = foeState.shieldFirstSlot
          ? treeOf[foe].moveUpgradeBySlot[foeState.shieldFirstSlot]
          : undefined;
        const reduction = SHIELD_FIRST_REDUCTION * (shieldUpgrade ? shieldUpgrade.effectMult : 1);
        damage = Math.max(1, Math.floor(damage * (1 - reduction)));
        foeState.shieldConsumed = true;
      }
      if (foeState.hasStoneSkin && !foeState.stoneSkinConsumed) {
        damage = Math.max(1, Math.floor(damage * (1 - STONE_SKIN_REDUCTION)));
        foeState.stoneSkinConsumed = true;
      }
    }

    // Air's Ceiling Break capstone: once/battle, a hit exceeding the cap is clamped down to it.
    const ceilingBreak = hasCapstone(foe, 'damageCap');
    if (ceilingBreak && !foeState.damageCapConsumed) {
      const cap = Math.floor(mons[foe].stats.hp * ceilingBreak.capPct);
      if (damage > cap) {
        damage = cap;
        foeState.damageCapConsumed = true;
      }
    }

    // Earth's Unmovable capstone: once/battle, a hit cannot take this mon below the floor.
    const unmovable = hasCapstone(foe, 'hitFloor');
    if (unmovable && !foeState.unmovableConsumed) {
      const floor = Math.ceil(mons[foe].stats.hp * unmovable.floorPct);
      if (hp[foe] - damage < floor) {
        damage = Math.max(0, hp[foe] - floor);
        foeState.unmovableConsumed = true;
      }
    }

    hp[foe] = Math.max(0, hp[foe] - damage);
    tookDamageThisTurn[foe] = true;

    // Fire's Phoenix Reborn capstone, then the shared Second Breath passive (in that order --
    // both are once/battle KO interceptions, and a mon's own nation-locked capstone takes
    // precedence over the nation-agnostic passive when it somehow has both routes available).
    if (hp[foe] === 0) {
      const phoenix = hasCapstone(foe, 'phoenix');
      // Tuned by simulation on 2026-09-13 (docs/design/talent-tree.md Balance targets): even
      // stripped of the design doc's "guaranteed crit" follow-up and shrunk to a minimal 5% HP
      // (see the node's own comment in packages/shared/src/game/tree.ts), a *guaranteed* once-
      // per-battle save from a KO still won Fire's Backdraft ~75% of its branch-vs-branch matrix
      // against sibling branch Blaze (40-60% target) -- merely surviving to act again, at any HP,
      // is what wins short battles, not how much HP it survives at. Making the save probabilistic
      // (rather than shrinking its magnitude further, which the above showed doesn't move the
      // needle) is what actually lands it in band; this costs one extra rng() call exactly when a
      // Phoenix-capable mon would otherwise be KO'd (a rare event), which is why it's not gated
      // behind a broader "does this mon have Phoenix" check made every action.
      const phoenixTriggered =
        phoenix && !foeState.phoenixConsumed && rng() < PHOENIX_TRIGGER_CHANCE;
      if (phoenixTriggered) {
        foeState.phoenixConsumed = true;
        hp[foe] = Math.max(1, Math.ceil(mons[foe].stats.hp * phoenix.hpFraction));
      } else if (hasPassive(foe, 'second-breath') && !foeState.secondBreathConsumed) {
        foeState.secondBreathConsumed = true;
        hp[foe] = SECOND_BREATH_HP;
      }
    }
    checkThresholdPassives(foe);

    if (move.effect === 'drain') {
      const heal = Math.floor(damage * DRAIN_FRACTION * (upgrade ? upgrade.effectMult : 1));
      hp[me] = Math.min(M.stats.hp, hp[me] + heal);
    }
    if (turnNum === 1 && (move.effect === 'def_down' || move.effect === 'burn')) {
      openingSetup[me] = move.effect;
    }
    if (move.effect === 'def_down') applyDefDown(me, foe, upgrade);
    if (crit && hasPassive(me, 'aftershock') && move.effect !== 'def_down') {
      applyDefDown(me, foe, undefined);
    }
    if (crit && hasPassive(me, 'tidal-recovery')) {
      hp[me] = Math.min(M.stats.hp, hp[me] + Math.floor(M.stats.hp * TIDAL_RECOVERY_HEAL_FRACTION));
    }
    if (move.effect === 'burn') {
      const wildfire = hasPassive(me, 'wildfire');
      const fraction =
        BURN_FRACTION * (upgrade ? upgrade.effectMult : 1) +
        (wildfire ? WILDFIRE_BURN_BONUS_FRACTION : 0);
      const turnsFor = BURN_TURNS + (wildfire ? WILDFIRE_BURN_EXTRA_TURNS : 0);
      if (foeState.burnTurns === 0) {
        foeState.burnTurns = turnsFor;
        foeState.burnFraction = fraction;
      } else if (hasCapstone(me, 'burnStacks') && foeState.burnStackTurns === 0) {
        // Ashen Cascade (Fire capstone): a second, independent instance instead of a no-op.
        foeState.burnStackTurns = turnsFor;
        foeState.burnStackFraction = fraction;
      }
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
      ...(followThrough ? { followThrough: true } : {}),
      ...(charge ? { charge } : {}),
    };
  };

  for (let t = 1; t <= MAX_TURNS && hp.a > 0 && hp.b > 0; t++) {
    tookDamageThisTurn.a = false;
    tookDamageThisTurn.b = false;
    const pickA = pickMove('a', t);
    const pickB = pickMove('b', t);
    const priorityA = pickA.move.effect === 'priority';
    const priorityB = pickB.move.effect === 'priority';
    let first: Side;
    if (priorityA !== priorityB) {
      first = priorityA ? 'a' : 'b';
    } else {
      // Air's Eye of the Storm capstone (acted on last turn's damage) takes precedence over the
      // shared Updraft passive (turn 1 only), which takes precedence over the normal probabilistic
      // roll. Tuned by simulation on 2026-09-13 (docs/design/talent-tree.md Balance targets): a
      // *guaranteed* "always acts first the turn after it took damage" fires most turns in a real
      // fight (a mon rarely goes a whole turn unhit), making this capstone's branch (Cirrus) beat
      // both its siblings well above the 40-60% target (~67% and ~63%) -- rolling it, same fix as
      // Phoenix Reborn's KO-save above, is what actually lands it in band.
      const eyeA = hasCapstone('a', 'actFirstAfterDamage') !== undefined && fx.a.tookDamageLastTurn;
      const eyeB = hasCapstone('b', 'actFirstAfterDamage') !== undefined && fx.b.tookDamageLastTurn;
      const eyeTriggered = eyeA !== eyeB && rng() < EYE_OF_STORM_CHANCE;
      const updraftA = t === 1 && hasPassive('a', 'updraft');
      const updraftB = t === 1 && hasPassive('b', 'updraft');
      if (eyeTriggered) {
        first = eyeA ? 'a' : 'b';
      } else if (updraftA !== updraftB) {
        first = updraftA ? 'a' : 'b';
      } else {
        // Turn order is probabilistic by speed (P(a first) = spd_a / (spd_a + spd_b)) so a
        // one-point speed edge does not decide every turn; a hard "faster always first" rule made
        // +1 level ≈ 90 %. Uses stance-modified (and, Phase C, def_down-debuffed) speed, same as
        // in-battle dodge/crit math above.
        const spdA = liveStats('a').spd;
        const spdB = liveStats('b').spd;
        const pFirstA = spdA / (spdA + spdB);
        first = rng() < pFirstA ? 'a' : 'b';
      }
    }
    const second: Side = first === 'a' ? 'b' : 'a';
    const firstPick = first === 'a' ? pickA : pickB;
    const secondPick = second === 'a' ? pickA : pickB;

    const actions = [act(first, second, firstPick.move, firstPick.charge, t)];
    if (firstPick.charge === 'telegraph') fx[first].chargePending = firstPick.move;
    if (hp[second] > 0) {
      actions.push(act(second, first, secondPick.move, secondPick.charge, t));
      if (secondPick.charge === 'telegraph') fx[second].chargePending = secondPick.move;
    }

    // End-of-turn burn ticks (primary instance, then Ashen Cascade's stacked second instance),
    // then decrement the timed effects. A tick that KOs a mon ends the battle at the top of the
    // next loop iteration (hp.a > 0 && hp.b > 0 fails), reported as reason: 'ko' below, same as any
    // other KO -- Phoenix Reborn/Second Breath only intercept a direct hit in `act()`, not a tick.
    for (const side of ['a', 'b'] as const) {
      if (hp[side] <= 0) continue;
      const state = fx[side];
      if (state.burnTurns > 0) {
        const tick = burnTickDamage(mons[side].stats.hp, state.burnFraction);
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
        checkThresholdPassives(side);
      }
      if (hp[side] > 0 && state.burnStackTurns > 0) {
        const tick = burnTickDamage(mons[side].stats.hp, state.burnStackFraction);
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
        state.burnStackTurns--;
        checkThresholdPassives(side);
      }
      if (state.defDownTurns > 0) state.defDownTurns--;
    }
    // A later reapplication must not revive an unused opening combo.
    for (const side of ['a', 'b'] as const) {
      const target = fx[side === 'a' ? 'b' : 'a'];
      if (
        (openingSetup[side] === 'burn' && target.burnTurns === 0) ||
        (openingSetup[side] === 'def_down' && target.defDownTurns === 0)
      ) {
        openingSetup[side] = null;
      }
    }
    fx.a.tookDamageLastTurn = tookDamageThisTurn.a;
    fx.b.tookDamageLastTurn = tookDamageThisTurn.b;

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
  if (!input.won) return 10;
  const diff = Math.max(-3, Math.min(3, input.oppLevel - input.myLevel));
  if (input.isBot) return 20 + 15 * Math.max(0, diff);
  return 30 + (diff > 0 ? 15 : 5) * diff;
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
