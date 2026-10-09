import {
  BULWARK_CAP,
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
  LASTLINE_HP,
  PAYOFF_KINDS,
  SECOND_BREATH_HP,
  SHIELD_FIRST_REDUCTION,
  STONE_SKIN_REDUCTION,
  TIDAL_RECOVERY_HEAL_FRACTION,
  WILDFIRE_BURN_BONUS_FRACTION,
  WILDFIRE_BURN_EXTRA_TURNS,
  AIR_SPEED_MULT,
  EARTH_DAMAGE_MULT,
  FIRE_IGNITE_CHANCE,
  WATER_SOAK_CHANCE,
  WATER_SOAK_SPEED_MULT,
  WATER_SOAK_TURNS,
  burnTickDamage,
  initSideEffectState,
  type EffectId,
  type PayoffKind,
  type SideEffectState,
} from './effects.ts';
import { statAtLevel } from '../game/levels.ts';
import { effectiveness } from '../game/nations.ts';
import {
  DEFAULT_STANCE,
  FURY_DAMAGE_MULT,
  BULWARK_DAMAGE_MULT,
  BULWARK_HP_THRESHOLD,
  GALE_DAMAGE_MULT,
  type Stance,
  type MonLoadout,
} from '../game/progression.ts';
import { defaultLoadoutMoveIds, findMove, speciesOf, type Move } from '../game/species.ts';
import {
  SHARED_PASSIVE_NODES,
  TREE_NODES,
  defaultBotTree,
  isSharedPassiveId,
  resolveTree,
  type ResolvedTree,
  type SharedPassiveSlug,
  type TreeStep,
} from '../game/tree.ts';
import type { Nation, Stage, Stats } from '../types.ts';
import {
  CLAMP_RULES,
  FIZZLE_RULES,
  MULTIPLIER_RULES,
  NOCRIT_RULES,
  ON_CRIT_DRAW,
  ON_DODGE,
  ON_FIZZLE,
  ON_HIT,
  ON_HIT_TAKEN,
  ON_SOAK,
  ON_STATUS_APPLIED,
  ORDER_RUNG_LATE_RULES,
  ORDER_RUNG_RULES,
  RECOVERY_LINE,
  REFUSE_RULES,
  SIDES,
  SKIP_TICK_RULES,
  SPEND_ON_LAND,
  SUPPRESS_3C_RULES,
  TURN_END_B2,
  TURN_END_D,
  VOID_RULES,
  arm,
  available,
  bleedLineHolds,
  clampedDamage,
  creditBoolean,
  expirePayoffs,
  fizzleWould,
  initiativeArms,
  lineHp,
  longHaulHolds,
  nameOf,
  orderSnapArms,
  other,
  quartermasterSwaps,
  readHolds,
  recoveryCycleHeal,
  secondSkinHeal,
  spend,
  statusLabel,
  trig,
  tryDeny,
  type MultiplierRule,
  type OrderRule,
  type StatusEvent,
  type TreeAct,
  type TreeBattle,
  LASTLINE_FROM,
} from './treeRules.ts';
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
  /** already scaled to `level` (stage multiplier; pre-v14 snapshots also folded tree stat nodes)
   * and stored so old logs replay after rebalances. */
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
  /** A reduced-power second strike; cannot crit, combo, chain or apply move effects. */
  doubleStrike?: boolean;
  /** Innate elemental trait triggered by this hit. */
  nationPassive?: 'ignite' | 'soak';
  /** Name of a talent combo activated by this action; only in pre-v14 logs. */
  comboTalent?: string;
  /** Conditional stances that affected this direct hit; absent in pre-v12 logs. */
  stancePassives?: Array<{ side: Side; stance: Stance }>;
  /** Synthetic end-of-turn recovery, shown on the owner's HP bar. */
  healing?: number;
  /** Tree rules that fired on this action (steps `act_pre` to `status`); v14+. */
  treeTriggers?: TreeTrigger[];
}

/** What a tree rule did; replay clients key on `node` and `effect` (a closed set). */
export type TreeTriggerEffect =
  | 'void'
  | 'refused'
  | 'noncrit'
  | 'clamp'
  | 'undodge'
  | 'guaranteed_crit'
  | 'pierced'
  | 'multiplier'
  | 'fizzled'
  | 'order_override'
  | 'order_suppressed'
  | 'finisher_early'
  | 'burn_tick_skipped'
  | 'status_refreshed'
  | 'payoff_armed'
  | 'payoff_consumed'
  | 'payoff_lost'
  | 'payoff_expired'
  | 'heal'
  | 'status_cleared'
  | 'denied';

/** One tree log entry (talent-tree spec section 1.5). */
export interface TreeTrigger {
  side: Side;
  /** Tree node id, e.g. `ward:3`. */
  node: string;
  step: TreeStep;
  effect: TreeTriggerEffect;
  /** One line, generated from the node's fixed `logText`. */
  detail: string;
}

export interface BattleTurn {
  turn: number;
  first: Side;
  actions: BattleAction[];
  /** Tree rules of steps `turn_start`, `pick`, `order` and `turn_end`; v14+. */
  treeTriggers?: TreeTrigger[];
}

export interface BattleResult {
  seed: string;
  winner: Side;
  reason: 'ko' | 'timeout_hp' | 'timeout_coin';
  turns: BattleTurn[];
  finalHp: Record<Side, number>;
  maxHp: Record<Side, number>;
}

export const MAX_TURNS = 12;

/** Opening Setup (`tempo:1`) combo factor at equal level (lives with the node rules). */
export { FOLLOW_THROUGH_MULT } from './treeRules.ts';

/**
 * Bumped whenever a formula or RNG-call-order change in `simulateBattle` would make a fresh replay
 * of an old log diverge (docs/design/progression.md "Any change to simulateBattle's RNG call
 * order..."). Stored per battle in `battles.protocol_version`; old logs are replayed from their
 * stored `log`, never recomputed at a newer version. v2 = Phase A (stances, evolution multipliers).
 * v3 = Phase B (6-move pools, loadout policy, move effects). v4 = Phase C (talent tree: stat nodes
 * folded into snapshot stats, move-upgrade/capstone nodes and the 10 shared passives change the
 * damage formula and add several new deterministic branch points -- Bedrock's forced non-crit,
 * Updraft's turn-order override and the Second Breath KO interception -- none of which add or
 * remove an `rng()` call by themselves, but the golden log's *values* change because the formula
 * does). v14 = the protocol-14 talent tree (docs/design/battle-steps.md).
 */
// v12: conditional build passives replace stance counters and unconditional stat modifiers.
// v14: shared and nation talent branches replace the v13 tree; its stat folding and draws go.
export const BATTLE_PROTOCOL_VERSION = 14;

const levelScale = (l: number): number => (l + 24) / 25;
export const DOUBLE_STRIKE_CHANCE = 0.08;
export const DOUBLE_STRIKE_POWER = 0.4;
export const CRIT_MULTIPLIER = 1.75;

/** DEF / (DEF + K) damage reduction. K scales with encounter level to preserve DEF value. */
export function defenseReduction(defense: number, encounterLevel: number): number {
  const def = Math.max(0, defense);
  const k = 25 * levelScale(Math.min(50, Math.max(1, encounterLevel)));
  return def / (def + k);
}

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
  const stats = statsAtLevel(species.baseStats, input.level);
  return {
    ...rest,
    nation: species.nation,
    stats,
    loadout: {
      ...loadout,
      stance: loadout?.stance === undefined ? DEFAULT_STANCE : loadout.stance,
      moves,
      ...(tree ? { tree } : {}),
    },
  };
}

/** NPCs have no invested talent tree; Wild stats are 20% below Trainer stats. */
export function npcSnapshot(snapshot: MonSnapshot, kind: 'wild' | 'trainer'): MonSnapshot {
  const factor = kind === 'wild' ? 0.72 : 0.9;
  const stats = snapshot.stats;
  return {
    ...snapshot,
    stats: {
      hp: Math.round(stats.hp * factor),
      atk: Math.round(stats.atk * factor),
      def: Math.round(stats.def * factor),
      spd: Math.round(stats.spd * factor),
    },
  };
}

function stanceOf(m: MonSnapshot) {
  return m.loadout?.stance === undefined ? DEFAULT_STANCE : m.loadout.stance;
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

/** Thrown by `simulateBattle` for a tree id that a normalized protocol-14 tree cannot hold. */
export class UnknownTreeIdError extends Error {
  readonly code = 'UNKNOWN_TREE_ID';
}

/**
 * Talent-tree spec 8.5: every read path normalizes a stored tree before it reaches a snapshot, so
 * a battle throws instead of fighting with a silently ignored id. Allowed with rank > 0: a known
 * `shared:*` main passive, a shared-branch node, or a node of the mon's own nation column.
 */
export function assertTreeIds(mon: MonSnapshot): void {
  for (const [id, rank] of Object.entries(mon.loadout?.tree ?? {})) {
    if (!(rank > 0)) continue;
    const node = TREE_NODES[id];
    const known = isSharedPassiveId(id)
      ? SHARED_PASSIVE_NODES.some((n) => n.id === id)
      : !!node && (!node.nation || node.nation === mon.nation);
    if (!known) throw new UnknownTreeIdError(`UNKNOWN_TREE_ID: ${id} on a ${mon.nation} mon`);
  }
}

/** Where `simulateBattle` draws (call-site invariant, talent-tree spec 1.4). */
export type DrawSite =
  'pick' | 'speed' | 'dodge' | 'crit' | 'variance' | 'ignite' | 'soak' | 'double' | 'coin';

/** Optional observer for tests: every draw with its call site, plus markers for turn starts (HP
 * at pick time), the picks and each action. Never changes the battle. */
export type BattleTraceEvent =
  | { kind: 'turn'; turn: number; hp: Record<Side, number> }
  | { kind: 'picks'; moves: Record<Side, string> }
  | { kind: 'action'; side: Side; ds: boolean }
  | { kind: 'credit'; side: Side; boolean: PayoffKind; node: string }
  | { kind: 'draw'; site: DrawSite; side: Side | null };
export type BattleTrace = (event: BattleTraceEvent) => void;

/**
 * Deterministic auto-battle. Same snapshots + same seed => same log, on client and server.
 * The RNG call order is part of the protocol: do not reorder calls. Talent-tree rules
 * (`treeRules.ts`) never add or skip a draw; they only overwrite or defer results.
 */
export function simulateBattle(
  a: MonSnapshot,
  b: MonSnapshot,
  seed: string,
  trace?: BattleTrace,
): BattleResult {
  // The generator is only reachable through `draw`, so every draw has a named call site.
  const draw = (
    (next: () => number) =>
    (site: DrawSite, side: Side | null): number => {
      trace?.({ kind: 'draw', site, side });
      return next();
    }
  )(makeRng(seed));
  const mons: Record<Side, MonSnapshot> = { a, b };
  const hp: Record<Side, number> = { a: a.stats.hp, b: b.stats.hp };
  const scale = levelScale((a.level + b.level) / 2);
  const turns: BattleTurn[] = [];

  const stance: Record<Side, Stance | null> = { a: stanceOf(a), b: stanceOf(b) };
  const effStats: Record<Side, Stats> = { a: a.stats, b: b.stats };
  const tempo: Record<Side, { turn: number; moveId: string } | null> = { a: null, b: null };
  // The entire telegraph turn is protected, independent of which side acts first.
  const charging: Record<Side, boolean> = { a: false, b: false };

  const loadoutMoves: Record<Side, [Move, Move, Move]> = {
    a: resolveLoadoutMoves(a),
    b: resolveLoadoutMoves(b),
  };

  assertTreeIds(a);
  assertTreeIds(b);
  // Talent tree: resolved once per side, same as stances above -- pure, no RNG. `slotOf` maps a
  // mon's own equipped move ids to their loadout slot (1 = opener, 2 = default, 3 = finisher).
  const treeOf: Record<Side, ResolvedTree> = {
    a: resolveTree(a.nation, a.loadout?.tree),
    b: resolveTree(b.nation, b.loadout?.tree),
  };
  const actedFirst: Record<Side, boolean> = { a: false, b: false };
  const slotOf: Record<Side, Record<string, 1 | 2 | 3>> = { a: {}, b: {} };
  for (const side of SIDES) {
    const [opener, standard, finisher] = loadoutMoves[side];
    slotOf[side][opener.id] = 1;
    slotOf[side][standard.id] = 2;
    slotOf[side][finisher.id] = 3;
  }
  const hasPassive = (side: Side, slug: SharedPassiveSlug) => treeOf[side].sharedPassives.has(slug);

  const fx: Record<Side, SideEffectState<Move>> = {
    a: initSideEffectState({
      hasShieldFirst: loadoutMoves.a.some((m) => m.effect === 'shield_first'),
      hasStoneSkin: hasPassive('a', 'stone-skin'),
    }),
    b: initSideEffectState({
      hasShieldFirst: loadoutMoves.b.some((m) => m.effect === 'shield_first'),
      hasStoneSkin: hasPassive('b', 'stone-skin'),
    }),
  };

  /** Effective ATK/SPD for `side` right now: snapshot stats with the air trait and soak applied.
   * DEF is handled separately at the point of use. */
  const liveStats = (side: Side): { atk: number; spd: number } => {
    const base = effStats[side];
    const st = fx[side];
    const airMult = mons[side].nation === 'air' ? AIR_SPEED_MULT : 1;
    const soakMult = st.soakTurns > 0 ? WATER_SOAK_SPEED_MULT : 1;
    return { atk: base.atk, spd: base.spd * airMult * soakMult };
  };

  const B: TreeBattle = {
    t: 0,
    mons,
    hp,
    fx,
    nodes: { a: treeOf.a.nodes, b: treeOf.b.nodes },
    actedFirst,
    picks: { a: null, b: null },
    slotOf,
    liveSpd: (side) => liveStats(side).spd,
    turnLog: [],
  };
  const has = (side: Side, id: string) => B.nodes[side].has(id);
  /** Whether a side owns any tree node; an empty tree skips every rule table. */
  const treeOn = (side: Side) => B.nodes[side].size > 0;
  const anyTree = treeOn('a') || treeOn('b');
  const frac = (side: Side) => hp[side] / mons[side].stats.hp;

  /** Deep Roots (shared passive) latches on once `side` first drops below the threshold; Ember
   * Heart (shared passive) arms its one-shot crit bonus the same way. Called after every HP
   * change so both trigger the instant they're eligible, not just at end of turn. */
  const checkThresholdPassives = (side: Side) => {
    const f = frac(side);
    const st = fx[side];
    if (!st.deepRootsActive && hasPassive(side, 'deep-roots') && f < DEEP_ROOTS_HP_THRESHOLD) {
      st.deepRootsActive = true;
    }
    if (st.emberHeartArmed && hasPassive(side, 'ember-heart') && f < EMBER_HEART_HP_THRESHOLD) {
      st.emberHeartArmed = false;
      st.emberHeartPending = true;
    }
  };

  /**
   * Loadout policy (docs/design/progression.md Loadout policy): turn 1 always the opener (slot 1);
   * the finisher (slot 3) fires once per battle when either side drops below 60% from turn 3,
   * or on turn 4 if the fight lasts that long;
   * otherwise slot 2 w.p. 0.8, slot 1 w.p. 0.2 (one rng draw); a pending `charge` release always
   * overrides all of the above. Whether a pick draw is made reads only `baseFinisherUsed`;
   * `bastion:3` Quartermaster swaps which move is played (talent-tree spec 1.4).
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
    const play = (m: Move) => ({
      move: m,
      charge: m.effect === 'charge' ? ('telegraph' as const) : null,
    });
    if (turnNum === 1) return play(opener);
    const ownFrac = frac(side);
    const foeFrac = frac(other(side));
    if (
      !state.baseFinisherUsed &&
      ((turnNum >= 3 && (foeFrac < 0.6 || ownFrac < 0.6)) || turnNum >= 4)
    ) {
      state.baseFinisherUsed = true;
      const deferred = state.deferredPick;
      if (deferred) {
        state.deferredPick = null;
        trig(B.turnLog, side, 'bastion:3', 'pick', 'finisher_early', {
          detail: `deferred slot ${slotOf[side][deferred.id]} played`,
        });
        return play(deferred);
      }
      state.finisherUsed = true;
      return play(finisher);
    }
    const drawn = draw('pick', side) < 0.8 ? standard : opener;
    if (
      turnNum === 2 &&
      has(side, 'bastion:3') &&
      !state.finisherUsed &&
      quartermasterSwaps(B, side, drawn, finisher)
    ) {
      state.finisherUsed = true;
      state.deferredPick = drawn;
      spend(B, side, 'bastion:3');
      trig(B.turnLog, side, 'bastion:3', 'pick', 'finisher_early', {
        detail: `finisher on turn 2, slot ${slotOf[side][drawn.id]} deferred`,
      });
      return play(finisher);
    }
    return play(drawn);
  };

  /** A side's own action ended: streak bookkeeping for Rhythm, Flow State, Chain Priority and
   * Consecutive Priority. */
  const recordAction = (side: Side, move: Move, landed: boolean) => {
    const st = fx[side];
    if (!treeOn(side)) return;
    if (!landed) {
      st.landedMoves = [];
      st.priorityStreak = 0;
      return;
    }
    st.landedMoves = [...st.landedMoves.slice(-2), move.id];
    st.priorityStreak = move.effect === 'priority' ? st.priorityStreak + 1 : 0;
  };

  /** `ward:10:right` Counterfire: the first direct hit a Ward rule voids or refuses. */
  const counterfire = (owner: Side, rule: string, ac: TreeAct, step: TreeStep) => {
    if (!rule.startsWith('ward:') || !has(owner, 'ward:10:right')) return;
    if (!available(B, owner, 'ward:10:right')) return;
    arm(B, owner, 'GUARANTEED_CRIT', 'ward:10:right', ac.log, step);
    spend(B, owner, 'ward:10:right');
  };

  /** A credited same-action 1/battle source changed an outcome: spend it now (spec 1.3), unless
   * its own row spends it on landing (`SPEND_ON_LAND`). 1/turn and pending sources are already
   * spent or consumed at crediting. */
  const changed = (side: Side, node: string) => {
    if (TREE_NODES[node]?.cap === 'battle' && !SPEND_ON_LAND.has(node)) spend(B, side, node);
  };

  /** STATUS (11) for one status the action would apply: REFUSE order, then application and
   * STATUS_APPLIED. Returns whether it was applied. */
  const applyStatus = (ac: TreeAct, ev: StatusEvent): boolean => {
    const { me, foe } = ac;
    const tgt = fx[foe];
    let refusedBy: string | null = null;
    for (const r of treeOn(foe) ? REFUSE_RULES : []) {
      if (!has(foe, r.node) || !available(B, foe, r.node, ac.serial) || !r.holds(B, ac, ev))
        continue;
      if (refusedBy) {
        trig(ac.log, foe, r.node, 'status', 'denied', {
          reason: `already refused by ${nameOf(refusedBy)}`,
        });
        continue;
      }
      const piercer = ac.pierce;
      if (piercer) {
        trig(ac.log, me, piercer, 'status', 'pierced', { defense: nameOf(r.node) });
        changed(me, piercer);
        continue;
      }
      refusedBy = r.node;
      const carried =
        r.node === 'ward:7' ? `; carries ${ev.status === 'burn' ? 'DEF-down' : 'Burn'}` : '';
      trig(ac.log, foe, r.node, 'status', 'refused', {
        status: `${statusLabel(ev.status)} (${ev.source})${carried}`,
        blocked: `${statusLabel(ev.status)} (${ev.source})`,
      });
      if (r.node === 'bastion:11') ac.holdfast = true;
      else spend(B, foe, r.node, ac.serial);
      r.onSpend?.(B, foe);
      counterfire(foe, r.node, ac, 'status');
    }
    if (refusedBy) return false;
    if (ev.status === 'def_down') {
      tgt.defDownTurns = DEF_DOWN_TURNS;
      tgt.defDownMult = DEF_DOWN_MULT;
      // A trait status never arms or sustains a move-keyed node, but an Aftershock refresh does
      // not switch off a move DEF-down either.
      tgt.defDownFromMove = ev.source === 'move' || (!ev.isNew && tgt.defDownFromMove);
    } else {
      const wildfire = ev.source === 'move' && hasPassive(me, 'wildfire');
      tgt.burnTurns = BURN_TURNS + (wildfire ? WILDFIRE_BURN_EXTRA_TURNS : 0);
      tgt.burnFraction = BURN_FRACTION + (wildfire ? WILDFIRE_BURN_BONUS_FRACTION : 0);
      tgt.burnFromMove = ev.source === 'move';
    }
    if (ev.isNew && treeOn(me)) for (const hook of ON_STATUS_APPLIED) hook(B, ac, ev);
    return true;
  };

  let serial = 0;
  /** One action, steps 4 to 11 (talent-tree spec 1.1). `parent` is the main action of a double
   * strike. */
  const act = (
    me: Side,
    foe: Side,
    move: Move,
    charge: 'telegraph' | 'release' | null,
    turnNum: number,
    parent: TreeAct | null = null,
  ): { action: BattleAction; ac: TreeAct } => {
    trace?.({ kind: 'action', side: me, ds: parent !== null });
    const doubleStrike = parent !== null;
    const ac: TreeAct = {
      me,
      foe,
      move,
      charge,
      ds: doubleStrike,
      slot: slotOf[me][move.id],
      serial: ++serial,
      log: [],
      meHp0: hp[me],
      foeHp0: hp[foe],
      fizzled: parent?.fizzled ?? null,
      voided: parent?.voided ?? null,
      pierce: null,
      undodge: null,
      gcrit: null,
      spendOnLand: [],
      crit: false,
      baseCritDamage: 0,
      holdfast: false,
    };
    const tempoReady =
      !doubleStrike && tempo[me]?.turn === turnNum - 1 && tempo[me]?.moveId !== move.id;
    if (!doubleStrike) {
      tempo[me] = null;
    }
    const M = mons[me];
    const nationEff = effectiveness(M.nation, mons[foe].nation);
    const meStats = liveStats(me);
    const foeStats = liveStats(foe);
    const moveEff = move.type === 'neutral' ? 1 : nationEff;
    const withLog = <T extends BattleAction>(x: T): T =>
      ac.log.length ? { ...x, treeTriggers: ac.log } : x;

    if (charge === 'telegraph') {
      // A payoff is consumed by the owner's next action; a telegraph is not a direct move.
      const st = fx[me];
      for (const kind of PAYOFF_KINDS) {
        const p = st.armed[kind];
        if (p) {
          st.armed[kind] = null;
          trig(ac.log, me, p.node, 'act_pre', 'payoff_lost');
        }
      }
      recordAction(me, move, false);
      return {
        ac,
        action: withLog({
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
        }),
      };
    }

    // 4.1 denial: fizzle rung (one-denial and control-rest rules inside `tryDeny`).
    if (!doubleStrike && treeOn(foe)) {
      for (const r of FIZZLE_RULES) {
        if (!has(foe, r.node) || !available(B, foe, r.node) || !r.holds(B, foe, me, move)) continue;
        if (ac.fizzled) {
          trig(ac.log, foe, r.node, 'act_pre', 'denied', { reason: nameOf(ac.fizzled) });
        } else if (tryDeny(B, me, r.node, foe, ac.log, 'act_pre')) {
          ac.fizzled = r.node;
          spend(B, foe, r.node);
          r.onSpend?.(B, foe);
          trig(ac.log, foe, r.node, 'act_pre', 'fizzled');
        }
      }
      if (ac.fizzled) for (const hook of ON_FIZZLE) hook(B, ac);
    }
    // 4.2 same-action PIERCE, 4.3 armed payoffs and state crits.
    if (!doubleStrike && !ac.fizzled && treeOn(me)) {
      for (const kind of PAYOFF_KINDS) {
        const credit = creditBoolean(B, ac, kind);
        if (!credit) continue;
        trace?.({ kind: 'credit', side: me, boolean: kind, node: credit.node });
        if (kind === 'PIERCE') ac.pierce = credit.node;
        else if (kind === 'UNDODGE') ac.undodge = credit.node;
        else ac.gcrit = credit.node;
        if (credit.pending) {
          fx[me].armed[kind] = null;
          trig(ac.log, me, credit.node, 'act_pre', 'payoff_consumed');
        } else if (SPEND_ON_LAND.has(credit.node)) ac.spendOnLand.push(credit.node);
        else if (TREE_NODES[credit.node]?.cap !== 'battle') spend(B, me, credit.node, ac.serial);
        // Other 1/battle sources are spent by `changed` when they change an outcome.
      }
    } else if (!doubleStrike && ac.fizzled && treeOn(me)) {
      // A fizzled action makes the same draws as unfizzled (spec 1.4), so it reads an UNDODGE it
      // would have been credited, without consuming, spending or logging it.
      ac.undodge = creditBoolean(B, ac, 'UNDODGE')?.node ?? null;
    }

    // 5 DODGE. `true_hit` ignores the target's dodge chance entirely -- no roll is made for it,
    // same as no roll is made for a battle that never reaches this action. UNDODGE overwrites a
    // dodged result; the draw is still made.
    let dodged = false;
    if (doubleStrike || move.effect !== 'true_hit') {
      const dodge = Math.min(
        0.15,
        Math.max(0.02, 0.04 + (foeStats.spd - meStats.spd) / (160 * scale)),
      );
      dodged = draw('dodge', me) < dodge;
      if (dodged && ac.undodge) {
        if (!ac.fizzled) {
          trig(ac.log, me, ac.undodge, 'dodge', 'undodge');
          changed(me, ac.undodge);
        }
        dodged = false;
      }
    }
    if (dodged) {
      if (!ac.fizzled) {
        if (treeOn(foe)) for (const hook of ON_DODGE) hook(B, ac);
      }
      if (!doubleStrike) recordAction(me, move, false);
      return {
        ac,
        action: withLog({
          actor: me,
          move: doubleStrike ? `${move.name} (double strike)` : move.name,
          moveId: move.id,
          dodged: true,
          damage: 0,
          crit: false,
          effectiveness: moveEff,
          targetHpAfter: hp[foe],
          effect: doubleStrike ? null : move.effect,
          ...(doubleStrike ? { doubleStrike: true } : {}),
          ...(charge ? { charge } : {}),
        }),
      };
    }

    // 6 CRIT: draw, GUARANTEED_CRIT, Bedrock, Tailwind, then the NOCRIT order.
    let critChance = Math.min(
      0.3,
      Math.max(0.03, 0.08 + (meStats.spd - foeStats.spd) / (250 * scale)),
    );
    if (!doubleStrike && move.effect === 'crit_up') {
      critChance = Math.min(CRIT_UP_MAX, critChance + CRIT_UP_BONUS);
    }
    // Ember Heart (shared passive): armed bonus applies to this mon's very next move, one-shot.
    if (!doubleStrike && fx[me].emberHeartPending) {
      critChance = Math.min(1, critChance + EMBER_HEART_CRIT_BONUS);
      if (!ac.fizzled) fx[me].emberHeartPending = false;
    }
    let crit = draw('crit', me) < critChance;
    if (!doubleStrike && !ac.fizzled && anyTree) {
      ac.crit = crit;
      for (const hook of ON_CRIT_DRAW) hook(B, ac);
    }
    const forced = !!ac.gcrit && !crit;
    if (forced) crit = true;
    // Bedrock (shared passive): absolute crit immunity for the defender, wins over the above.
    if (hasPassive(foe, 'bedrock')) crit = false;
    // Tailwind (shared passive): this mon's own slot-1 move always crits.
    if (!crit && hasPassive(me, 'tailwind') && slotOf[me][move.id] === 1) crit = true;
    if (doubleStrike || ac.fizzled) crit = false;
    if (crit && treeOn(foe)) {
      let cancelledBy: string | null = null;
      for (const r of NOCRIT_RULES) {
        if (!has(foe, r.node) || !available(B, foe, r.node, ac.serial) || !r.holds(B, ac)) continue;
        if (cancelledBy) {
          trig(ac.log, foe, r.node, 'crit', 'denied', {
            reason: `crit already cancelled by ${nameOf(cancelledBy)}`,
          });
          continue;
        }
        if (r.pierceable && ac.pierce) {
          trig(ac.log, me, ac.pierce, 'crit', 'pierced', { defense: nameOf(r.node) });
          changed(me, ac.pierce);
          continue;
        }
        cancelledBy = r.node;
        trig(ac.log, foe, r.node, 'crit', 'noncrit', { blocked: 'crit' });
        if (r.node === 'bastion:11') ac.holdfast = true;
        else spend(B, foe, r.node, ac.serial);
        r.onSpend?.(B, foe);
      }
      if (cancelledBy) crit = false;
    }
    // GUARANTEED_CRIT is logged only when its crit survived Bedrock and the NOCRIT order.
    if (forced && crit) {
      trig(ac.log, me, ac.gcrit!, 'crit', 'guaranteed_crit');
      changed(me, ac.gcrit!);
    }
    ac.crit = crit;
    const variance = 0.8 + draw('variance', me) * 0.4;
    const power = charge === 'release' ? move.power * CHARGE_MULTIPLIER : move.power;

    // 7 DAMAGE.
    const foeState = fx[foe];
    const defDownMult = foeState.defDownTurns > 0 ? foeState.defDownMult : 1;
    const deepRootsMult = foeState.deepRootsActive ? 1 + DEEP_ROOTS_DEF_BONUS : 1;
    const defTerm = effStats[foe].def * defDownMult * deepRootsMult;

    const foeDebuffed = foeState.defDownTurns > 0 || foeState.burnTurns > 0;
    const exploit =
      !doubleStrike && stance[me] === 'fury' && foeDebuffed && (crit || charge === 'release');
    const tempoHit = stance[me] === 'gale' && tempoReady && actedFirst[me];
    const brace =
      stance[foe] === 'bulwark' &&
      (charging[foe] || hp[foe] / mons[foe].stats.hp <= BULWARK_HP_THRESHOLD);
    const stancePassives: NonNullable<BattleAction['stancePassives']> = [];
    if (!ac.fizzled) {
      if (exploit || tempoHit) stancePassives.push({ side: me, stance: exploit ? 'fury' : 'gale' });
      if (brace) stancePassives.push({ side: foe, stance: 'bulwark' });
    }

    // A small, bounded level bonus leaves room for elemental counters.
    const levelGap = Math.max(-3, Math.min(3, M.level - mons[foe].level));
    const experience = 1 + 0.03 * levelGap;
    const hitDamage = (critMultiplier: number, treeFactor: number) => {
      const raw =
        power *
        (meStats.atk / 50) *
        (1 - defenseReduction(defTerm, (a.level + b.level) / 2)) *
        0.75 *
        (doubleStrike ? DOUBLE_STRIKE_POWER : 1) *
        moveEff *
        experience *
        critMultiplier *
        treeFactor *
        variance *
        (exploit ? FURY_DAMAGE_MULT : tempoHit ? GALE_DAMAGE_MULT : 1) *
        (brace ? BULWARK_DAMAGE_MULT : 1);
      let dmg = Math.max(1, Math.floor(raw));
      if (mons[foe].nation === 'earth') dmg = Math.max(1, Math.floor(dmg * EARTH_DAMAGE_MULT));
      return dmg;
    };

    // VOID rung (one-denial and control-rest rules); PIERCE bypasses every VOID.
    if (!doubleStrike && !ac.fizzled && treeOn(foe)) {
      for (const r of VOID_RULES) {
        if (!has(foe, r.node) || !available(B, foe, r.node, ac.serial) || !r.holds(B, ac)) continue;
        if (ac.voided) {
          trig(ac.log, foe, r.node, 'damage', 'denied', { reason: nameOf(ac.voided) });
          continue;
        }
        if (ac.pierce) {
          trig(ac.log, me, ac.pierce, 'damage', 'pierced', { defense: nameOf(r.node) });
          changed(me, ac.pierce);
          continue;
        }
        if (!tryDeny(B, me, r.node, foe, ac.log, 'damage')) continue;
        ac.voided = r.node;
        spend(B, foe, r.node, ac.serial);
        trig(ac.log, foe, r.node, 'damage', 'void');
        counterfire(foe, r.node, ac, 'damage');
      }
    }

    // One-factor rule: Long Haul (defense) first, then the largest offensive tree factor.
    let critMultiplier = crit ? CRIT_MULTIPLIER : 1;
    let treeFactor = 1;
    let followThrough = false;
    if (!doubleStrike && !ac.fizzled && !ac.voided) {
      let critOverridable = crit;
      if (has(foe, 'bastion:10:left') && longHaulHolds(B, ac)) {
        if (ac.pierce) {
          trig(ac.log, me, ac.pierce, 'damage', 'pierced', { defense: nameOf('bastion:10:left') });
          changed(me, ac.pierce);
        } else {
          critMultiplier = 1;
          critOverridable = false;
          trig(ac.log, foe, 'bastion:10:left', 'damage', 'multiplier', { factor: '1.0' });
        }
      }
      if (critOverridable && treeOn(me)) ac.baseCritDamage = hitDamage(CRIT_MULTIPLIER, 1);
      let best: { rule: MultiplierRule; value: number; factor: number } | null = null;
      for (const r of treeOn(me) ? MULTIPLIER_RULES : []) {
        if (!has(me, r.node) || !available(B, me, r.node, ac.serial)) continue;
        if (r.kind === 'crit' && !critOverridable) continue;
        const value = r.value(B, ac);
        if (value === null) continue;
        const factor = r.kind === 'crit' ? value / CRIT_MULTIPLIER : value;
        if (factor > 1 && (!best || factor > best.factor)) best = { rule: r, value, factor };
      }
      if (best) {
        const { rule, value } = best;
        if (rule.kind === 'crit') critMultiplier = value;
        else treeFactor = value;
        spend(B, me, rule.node, ac.serial);
        trig(ac.log, me, rule.node, 'damage', 'multiplier', { factor: value.toFixed(1) });
        if (rule.node === 'tempo:1') {
          fx[me].combo = null;
          followThrough = true;
          trig(ac.log, me, 'tempo:1', 'damage', 'payoff_consumed');
        }
      }
    }
    let damage = ac.fizzled || ac.voided ? 0 : hitDamage(critMultiplier, treeFactor);

    // 8 SHIELDS: `shield_first` / Stone Skin: the first hit this mon takes in the whole battle is
    // reduced, once each per battle (independent sources, so they stack multiplicatively).
    if (damage > 0 && foeState.hasShieldFirst && !foeState.shieldConsumed) {
      damage = Math.max(1, Math.floor(damage * (1 - SHIELD_FIRST_REDUCTION)));
      foeState.shieldConsumed = true;
    }
    if (damage > 0 && foeState.hasStoneSkin && !foeState.stoneSkinConsumed) {
      damage = Math.max(1, Math.floor(damage * (1 - STONE_SKIN_REDUCTION)));
      foeState.stoneSkinConsumed = true;
    }

    // 9 CAP, CLAMP, LETHAL (PIERCE bypasses each).
    if (damage > 0 && treeOn(foe)) {
      const before = hp[foe];
      const capHp = lineHp(B, foe, BULWARK_CAP);
      if (has(foe, 'ward:12') && available(B, foe, 'ward:12') && damage > capHp) {
        if (ac.pierce) {
          trig(ac.log, me, ac.pierce, 'clamp', 'pierced', { defense: nameOf('ward:12') });
          changed(me, ac.pierce);
        } else {
          trig(ac.log, foe, 'ward:12', 'clamp', 'clamp', { amount: damage - capHp });
          damage = capHp;
          spend(B, foe, 'ward:12');
        }
      }
      for (const r of CLAMP_RULES) {
        const line = lineHp(B, foe, r.line);
        const clamped = clampedDamage(before, damage, line);
        if (clamped === null) continue;
        if (!has(foe, r.node) || !available(B, foe, r.node, ac.serial) || !r.holds(B, ac)) continue;
        if (ac.pierce) {
          trig(ac.log, me, ac.pierce, 'clamp', 'pierced', { defense: nameOf(r.node) });
          changed(me, ac.pierce);
          continue;
        }
        damage = clamped;
        spend(B, foe, r.node, ac.serial);
        trig(ac.log, foe, r.node, 'clamp', 'clamp', { hp: line });
      }
      const lastHp = Math.max(1, lineHp(B, foe, LASTLINE_HP));
      if (
        before - damage <= 0 &&
        before > lastHp &&
        before > lineHp(B, foe, LASTLINE_FROM) &&
        has(foe, 'ward:6') &&
        available(B, foe, 'ward:6')
      ) {
        if (ac.pierce) {
          trig(ac.log, me, ac.pierce, 'lethal', 'pierced', { defense: nameOf('ward:6') });
          changed(me, ac.pierce);
        } else {
          damage = before - lastHp;
          spend(B, foe, 'ward:6');
          trig(ac.log, foe, 'ward:6', 'lethal', 'clamp', { hp: lastHp });
        }
      }
    }

    // 10 HIT.
    hp[foe] = Math.max(0, hp[foe] - damage);
    if (damage > 0 && hp[foe] < lineHp(B, foe, RECOVERY_LINE))
      foeState.fellBelowRecoveryLine = true;
    // Second Breath (shared passive): once per battle, a KO from a direct hit leaves 1 HP.
    if (hp[foe] === 0 && hasPassive(foe, 'second-breath') && !foeState.secondBreathConsumed) {
      foeState.secondBreathConsumed = true;
      hp[foe] = SECOND_BREATH_HP;
    }
    checkThresholdPassives(foe);

    if (!ac.fizzled) {
      // HIT_LANDED for the attacker first (spec 1.1 step 10), then HIT_TAKEN for the defender
      // (a VOIDed hit and a double strike count for HIT_TAKEN).
      if (!doubleStrike) {
        fx[me].landedDirectThisTurn = true;
        for (const node of ac.spendOnLand) spend(B, me, node);
        recordAction(me, move, true);
        // No tree rule fires after a knockout (step D2 fix): the battle is decided.
        if (treeOn(me) && hp[foe] > 0) for (const hook of ON_HIT) hook(B, ac);
      }
      foeState.hitThisTurn = true;
      foeState.directHitsTaken++;
      foeState.maxHitTakenThisTurn = Math.max(foeState.maxHitTakenThisTurn, damage);
      foeState.evasionPlanArmed = false;
      if (treeOn(foe) && hp[foe] > 0) for (const hook of ON_HIT_TAKEN) hook(B, ac);
    } else if (!doubleStrike) recordAction(me, move, false);

    // 11 STATUS (and the ungated trait draws, addendum 9.3).
    let nationPassive: BattleAction['nationPassive'];
    if (!doubleStrike) {
      // Statuses on a knocked-out target are skipped (draw-free; protocol 13 applied them
      // silently, with the tree they would arm nodes and log after the KO).
      const foeAlive = hp[foe] > 0;
      if (!ac.fizzled) {
        if (move.effect === 'priority') tempo[me] = { turn: turnNum, moveId: move.id };
        if (move.effect === 'drain') {
          hp[me] = Math.min(M.stats.hp, hp[me] + Math.floor(damage * DRAIN_FRACTION));
        }
        if (move.effect === 'def_down' && foeAlive) {
          applyStatus(ac, {
            status: 'def_down',
            source: 'move',
            isNew: foeState.defDownTurns === 0,
          });
        }
        if (crit && foeAlive && hasPassive(me, 'aftershock') && move.effect !== 'def_down') {
          applyStatus(ac, {
            status: 'def_down',
            source: 'aftershock',
            isNew: foeState.defDownTurns === 0,
          });
        }
        if (crit && hasPassive(me, 'tidal-recovery')) {
          hp[me] = Math.min(
            M.stats.hp,
            hp[me] + Math.floor(M.stats.hp * TIDAL_RECOVERY_HEAL_FRACTION),
          );
        }
        if (move.effect === 'burn' && foeState.burnTurns === 0 && foeAlive) {
          applyStatus(ac, { status: 'burn', source: 'move', isNew: true });
        }
      }
      // The trait draws are reached on every landed or fizzled nation-type action against a live
      // target; the result is discarded when the status is present (or the action fizzled).
      if (move.type === 'nation' && hp[foe] > 0) {
        if (M.nation === 'fire' && move.effect !== 'burn') {
          const ignites = draw('ignite', me) < FIRE_IGNITE_CHANCE;
          if (
            ignites &&
            !ac.fizzled &&
            foeState.burnTurns === 0 &&
            applyStatus(ac, { status: 'burn', source: 'ignite', isNew: true })
          ) {
            nationPassive = 'ignite';
          }
        }
        if (M.nation === 'water') {
          const soaks = draw('soak', me) < WATER_SOAK_CHANCE;
          if (soaks && !ac.fizzled && foeState.soakTurns === 0) {
            // +1 because active timers tick down at the end of the application turn.
            foeState.soakTurns = WATER_SOAK_TURNS + 1;
            nationPassive = 'soak';
            if (treeOn(me)) for (const hook of ON_SOAK) hook(B, ac);
          }
        }
      }
      if (ac.holdfast) spend(B, foe, 'bastion:11');
    }
    return {
      ac,
      action: withLog({
        actor: me,
        move: doubleStrike ? `${move.name} (double strike)` : move.name,
        moveId: move.id,
        dodged: false,
        damage,
        crit,
        effectiveness: moveEff,
        targetHpAfter: hp[foe],
        effect: doubleStrike ? null : move.effect,
        ...(doubleStrike ? { doubleStrike: true } : {}),
        ...(charge ? { charge } : {}),
        ...(followThrough ? { followThrough: true } : {}),
        ...(nationPassive ? { nationPassive } : {}),
        ...(stancePassives.length ? { stancePassives } : {}),
      }),
    };
  };

  /**
   * ORDER (step 3, talent-tree spec 1.1): 3a Initiative, 3b order rung, 3c Priority (with
   * suppression), 3d Updraft, 3e Initiative Read, 3f speed roll. The roll is drawn exactly when
   * protocol 13 draws it; 3a and 3e only overwrite its result. A rule that would give the order the
   * rest of the chain already gives writes nothing, denies nothing and keeps its flag (3a is still
   * consumed, spec 1.3).
   */
  const decideOrder = (t: number, priorityA: boolean, priorityB: boolean): Side => {
    const log = B.turnLog;
    const singlePri: Side | null = priorityA !== priorityB ? (priorityA ? 'a' : 'b') : null;
    const updraftA = t === 1 && hasPassive('a', 'updraft');
    const updraftB = t === 1 && hasPassive('b', 'updraft');
    const updraftDecides = !singlePri && updraftA !== updraftB;
    let roll: Side | null = null;
    if (!singlePri && !updraftDecides) {
      // Turn order is probabilistic by speed (P(a first) = spd_a / (spd_a + spd_b)) so a
      // one-point speed edge does not decide every turn; a hard "faster always first" rule made
      // +1 level ≈ 90 %. Uses live speed, same as in-battle dodge/crit math.
      const spdA = liveStats('a').spd;
      const spdB = liveStats('b').spd;
      roll = draw('speed', null) < spdA / (spdA + spdB) ? 'a' : 'b';
    }
    if (!anyTree) {
      // No tree on either side: 3c, 3d, 3f only.
      if (singlePri) return singlePri;
      if (updraftDecides) return updraftA ? 'a' : 'b';
      return roll!;
    }
    // 3e INITIATIVE READ (evaluated now, applied in chain order): both picked Priority and Updraft
    // did not decide; the roll was drawn and is overwritten.
    let read: Side | null = null;
    if (priorityA && priorityB && !updraftDecides) {
      // A tie (both sides hold, e.g. equal live SPD) reads nothing: the roll decides.
      const readers = SIDES.filter((owner) => has(owner, 'tempo:2') && readHolds(B, owner));
      read = readers.length === 1 ? readers[0]! : null;
    }
    // The order 3c to 3f choose without suppression: the baseline every override compares with.
    const natural: Side = singlePri ?? (updraftDecides ? (updraftA ? 'a' : 'b') : (read ?? roll!));

    let first: Side | null = null;
    let decidedBy = '';
    // 3a INITIATIVE: consumed in every case; logs only when it changes the order.
    const dueA = fx.a.initiativeDue;
    const dueB = fx.b.initiativeDue;
    fx.a.initiativeDue = fx.b.initiativeDue = false;
    if (dueA && dueB) {
      for (const side of SIDES)
        trig(log, side, 'tempo:12', 'order', 'denied', { reason: 'both armed' });
    } else if (dueA || dueB) {
      first = dueA ? 'a' : 'b';
      decidedBy = 'tempo:12';
      if (natural !== first) trig(log, first, 'tempo:12', 'order', 'order_override');
    }
    // ORDER RUNG: fires only when the order would otherwise put the owner second. Run at 3b
    // (Anchor) and again after 3c (Undertow Pull, addendum 3.2 rung order).
    const rung = (rules: readonly OrderRule[]) => {
      for (const r of rules) {
        for (const owner of SIDES) {
          if (!has(owner, r.node) || !available(B, owner, r.node) || !r.holds(B, owner)) continue;
          if ((first ?? natural) === owner) continue;
          const victim = other(owner);
          const lock = fizzleWould(B, owner, victim);
          if (first) trig(log, owner, r.node, 'order', 'denied', { reason: nameOf(decidedBy) });
          else if (lock) trig(log, owner, r.node, 'order', 'denied', { reason: nameOf(lock) });
          else if (tryDeny(B, victim, r.node, owner, log, 'order')) {
            first = owner;
            decidedBy = r.node;
            spend(B, owner, r.node);
            trig(log, owner, r.node, 'order', 'order_override');
          }
        }
      }
    };
    rung(ORDER_RUNG_RULES);
    // 3c PRIORITY, unless suppressed (Order Snap): live SPD decides, a tie goes to the owner. A
    // suppression that would not change the order is not one.
    const suppressedBy = new Set<string>();
    if (singlePri) {
      const owner = other(singlePri);
      for (const r of SUPPRESS_3C_RULES) {
        if (!has(owner, r.node) || !available(B, owner, r.node) || !r.holds(B, owner, singlePri))
          continue;
        if (first) {
          if (first !== owner) {
            trig(log, owner, r.node, 'order', 'denied', { reason: nameOf(decidedBy) });
            suppressedBy.add(r.node);
          }
          continue;
        }
        const spdOwn = liveStats(owner).spd;
        const spdPri = liveStats(singlePri).spd;
        if (spdOwn < spdPri) continue;
        const lock = fizzleWould(B, owner, singlePri);
        if (lock) {
          trig(log, owner, r.node, 'order', 'denied', { reason: nameOf(lock) });
          suppressedBy.add(r.node);
          continue;
        }
        if (!tryDeny(B, singlePri, r.node, owner, log, 'order')) {
          suppressedBy.add(r.node);
          continue;
        }
        first = owner;
        decidedBy = r.node;
        suppressedBy.add(r.node);
        spend(B, owner, r.node);
        trig(log, owner, r.node, 'order', 'order_suppressed', {
          spd: `${Math.round(spdOwn)} vs ${Math.round(spdPri)}`,
        });
      }
    }
    rung(ORDER_RUNG_LATE_RULES);
    // Order Snap due and not used this turn: it expires unspent.
    for (const side of SIDES) {
      if (fx[side].orderSnapDue && !suppressedBy.has('tempo:10:right')) {
        trig(log, side, 'tempo:10:right', 'order', 'payoff_expired');
      }
    }
    if (first) return first;
    if (read && read !== roll) trig(log, read, 'tempo:2', 'order', 'order_override');
    return natural;
  };

  for (let t = 1; t <= MAX_TURNS && hp.a > 0 && hp.b > 0; t++) {
    B.t = t;
    const turnLog: TreeTrigger[] = [];
    B.turnLog = turnLog;
    trace?.({ kind: 'turn', turn: t, hp: { ...hp } });

    // 1 TURN_START: per-turn flags, payoff expiry.
    for (const side of anyTree ? SIDES : []) {
      const st = fx[side];
      st.turnUsed.clear();
      st.deniedThisTurn = null;
      st.hitThisTurn = false;
      st.landedDirectThisTurn = false;
      st.fellBelowRecoveryLine = false;
      st.maxHitTakenThisTurn = 0;
      st.causedTickThisTurn = false;
      st.burnEndedThisTurn = false;
      st.soakExpiredThisTurn = false;
      expirePayoffs(B, side);
    }

    // 2 PICK.
    const pickA = pickMove('a', t);
    const pickB = pickMove('b', t);
    B.picks = { a: pickA.move, b: pickB.move };
    trace?.({ kind: 'picks', moves: { a: pickA.move.id, b: pickB.move.id } });
    charging.a = pickA.charge === 'telegraph';
    charging.b = pickB.charge === 'telegraph';

    // 3 ORDER.
    const first = decideOrder(
      t,
      pickA.move.effect === 'priority',
      pickB.move.effect === 'priority',
    );
    const second: Side = other(first);
    actedFirst.a = first === 'a';
    actedFirst.b = first === 'b';
    fx[second].actedSecondCount++;
    const firstPick = first === 'a' ? pickA : pickB;
    const secondPick = second === 'a' ? pickA : pickB;

    // 4-12 per action.
    const actions: BattleAction[] = [];
    const takeAction = (actor: Side, target: Side, pick: typeof firstPick) => {
      const { action: hit, ac } = act(actor, target, pick.move, pick.charge, t);
      actions.push(hit);
      if (pick.charge === 'telegraph') fx[actor].chargePending = pick.move;
      // One short follow-up, never on a charge or after a KO/miss. No recursive roll.
      if (
        !pick.charge &&
        !hit.dodged &&
        hp[target] > 0 &&
        draw('double', actor) < DOUBLE_STRIKE_CHANCE
      ) {
        actions.push(act(actor, target, pick.move, null, t, ac).action);
      }
    };
    takeAction(first, second, firstPick);
    if (hp[second] > 0) takeAction(second, first, secondPick);

    // 13 TURN_END (addendum 2 item 5). No draw here. A tick that KOs a mon ends the battle at the
    // top of the next loop iteration, reported as reason: 'ko' -- Second Breath only intercepts a
    // direct hit in `act()`, not a tick.
    // (a) burn tick (Stonewall, Quick Recovery may skip it), then Bleed Line. Once a side is
    // knocked out no tree rule fires or logs (step D2 fix; tree rules never draw).
    let treeEnd = anyTree && hp.a > 0 && hp.b > 0;
    for (const side of SIDES) {
      if (hp[side] <= 0) continue;
      const st = fx[side];
      let tick = 0;
      if (st.burnTurns > 0) {
        let skip: string | null = null;
        for (const r of treeEnd && hp.a > 0 && hp.b > 0 ? SKIP_TICK_RULES : []) {
          if (!has(side, r.node) || !available(B, side, r.node) || !r.holds(B, side)) continue;
          if (skip) {
            trig(turnLog, side, r.node, 'turn_end', 'denied', { reason: nameOf(skip) });
            continue;
          }
          skip = r.node;
          spend(B, side, r.node);
          trig(turnLog, side, r.node, 'turn_end', 'burn_tick_skipped');
        }
        tick = skip ? 0 : burnTickDamage(mons[side].stats.hp, st.burnFraction);
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
        if (tick >= 1 && hp[side] < lineHp(B, side, RECOVERY_LINE)) st.fellBelowRecoveryLine = true;
        if (tick >= 1 && st.burnFromMove) fx[other(side)].causedTickThisTurn = true;
        checkThresholdPassives(side);
      }
      const owner = other(side);
      if (
        treeEnd &&
        hp[owner] > 0 &&
        hp[side] > 0 &&
        has(owner, 'strike:7:left') &&
        available(B, owner, 'strike:7:left') &&
        bleedLineHolds(B, side)
      ) {
        // At least 1 turn remains after this turn's decrement: active through the next turn.
        st.defDownTurns = 2;
        spend(B, owner, 'strike:7:left');
        trig(turnLog, owner, 'strike:7:left', 'turn_end', 'status_refreshed');
      }
    }
    treeEnd = treeEnd && hp.a > 0 && hp.b > 0;
    // (b) streak counters, from the turn as it stood, before any decrement.
    for (const side of treeEnd ? SIDES : []) {
      const st = fx[side];
      st.hitStreak = st.hitThisTurn ? st.hitStreak + 1 : 0;
      st.burnStreak = st.burnTurns > 0 ? st.burnStreak + 1 : 0;
      st.actedFirstStreak = actedFirst[side] ? st.actedFirstStreak + 1 : 0;
      if (st.orderSnapDue) {
        // A due flag never carries across a second turn boundary (spec 1.3).
        st.orderSnapDue = false;
        st.orderSnapCount = 0;
      } else st.orderSnapCount = actedFirst[side] ? st.orderSnapCount + 1 : 0;
    }
    // (b2) nation counter and state arming.
    for (const side of treeEnd ? SIDES : []) for (const hook of TURN_END_B2) hook(B, side);
    // (c) duration decrements; (d) expiry flags.
    for (const side of SIDES) {
      if (hp[side] <= 0) continue;
      const st = fx[side];
      if (st.burnTurns > 0 && --st.burnTurns === 0) {
        st.burnEndedThisTurn = true;
        st.burnFromMove = false;
      }
      if (st.defDownTurns > 0 && --st.defDownTurns === 0) st.defDownFromMove = false;
      if (st.soakTurns > 0 && --st.soakTurns === 0) {
        st.soakExpiredThisTurn = true;
      }
    }
    // An unused Opening Setup combo is discarded once its status is gone.
    for (const side of treeEnd ? SIDES : []) {
      const combo = fx[side].combo;
      const foe = fx[other(side)];
      if (combo && (combo.status === 'burn' ? foe.burnTurns === 0 : foe.defDownTurns === 0)) {
        // Not spent: Opening Setup may re-arm on a later slot-1 status (1/battle on consumption).
        fx[side].combo = null;
        trig(turnLog, side, 'tempo:1', 'turn_end', 'payoff_expired');
      }
    }
    for (const side of treeEnd ? SIDES : []) for (const hook of TURN_END_D) hook(B, side);
    // (e) turn-end arming: Afterburn, Order Snap, Initiative.
    for (const side of treeEnd ? SIDES : []) {
      if (hp[side] <= 0) continue;
      const st = fx[side];
      if (st.causedTickThisTurn && has(side, 'strike:11') && available(B, side, 'strike:11')) {
        arm(B, side, 'GUARANTEED_CRIT', 'strike:11', turnLog, 'turn_end', 'move Burn tick');
        spend(B, side, 'strike:11');
      }
      if (
        orderSnapArms(B, side) &&
        has(side, 'tempo:10:right') &&
        available(B, side, 'tempo:10:right')
      ) {
        st.orderSnapDue = true;
        st.orderSnapCount = 0;
        trig(turnLog, side, 'tempo:10:right', 'turn_end', 'payoff_armed');
      }
      if (initiativeArms(B, side) && has(side, 'tempo:12') && available(B, side, 'tempo:12')) {
        st.initiativeDue = true;
        spend(B, side, 'tempo:12');
        trig(turnLog, side, 'tempo:12', 'turn_end', 'payoff_armed');
      }
    }
    // (f) queued heals (`ward:8`, `ward:11`), then flag finalisation.
    for (const side of treeEnd ? SIDES : []) {
      if (hp[side] <= 0) continue;
      const maxHp = mons[side].stats.hp;
      const heal = (node: string, amount: number) => {
        const healed = Math.min(amount, maxHp - hp[side]);
        if (healed <= 0) return;
        hp[side] += healed;
        spend(B, side, node);
        trig(turnLog, side, node, 'turn_end', 'heal', { amount: healed });
        actions.push({
          actor: side,
          move: TREE_NODES[node]!.name,
          moveId: null,
          dodged: false,
          damage: 0,
          crit: false,
          effectiveness: 1,
          targetHpAfter: hp[side],
          effect: null,
          healing: healed,
        });
      };
      if (has(side, 'ward:8') && available(B, side, 'ward:8'))
        heal('ward:8', secondSkinHeal(B, side));
      if (has(side, 'ward:11') && available(B, side, 'ward:11')) {
        heal('ward:11', recoveryCycleHeal(B, side));
      }
    }
    for (const side of SIDES) fx[side].deniedLastTurn = fx[side].deniedThisTurn !== null;

    turns.push({ turn: t, first, actions, ...(turnLog.length ? { treeTriggers: turnLog } : {}) });
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
      winner = draw('coin', null) < 0.5 ? 'a' : 'b';
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
  opponentKind?: 'wild' | 'trainer' | 'rival';
  myLevel: number;
  oppLevel: number;
}): number {
  if (!input.won) return 10;
  const diff = Math.max(-5, Math.min(5, input.oppLevel - input.myLevel));
  const kind = input.opponentKind ?? (input.isBot ? 'wild' : 'rival');
  const base = kind === 'wild' ? 20 : kind === 'trainer' ? 30 : 45;
  return Math.max(10, base + (diff > 0 ? 15 : 5) * diff);
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
