/**
 * Protocol-14 talent-tree rules (talent-tree spec sections 1 to 4, nation addendum sections 2
 * and 3). `simulateBattle` (`battle.ts`) owns the step order and calls into the ordered rule
 * tables below; every table is plain data, so the nation columns add rules by inserting entries
 * at their listed position, never by touching the engine. No rule here calls `rng()`: rules
 * only read state and overwrite or defer results of draws the base rules make (spec 1.4).
 */
import {
  AIR_SPEED_MULT,
  ANCHOR_SPD_RATIO,
  BRINE_HP_LINE,
  CLAMP_HOLD_LINE,
  CLAMP_PULSE_LINE,
  CONTINENT_MULT,
  GUST_LINE_SPD_RATIO,
  INITIATIVE_ACTED_SECOND_TURNS,
  INITIATIVE_READ_RATIO,
  KINDLING_MULT,
  LEE_SHORE_SPD_RATIO,
  LIFT_SPD_RATIO,
  ORDER_SNAP_TURNS,
  PYRE_LORD_MULT,
  ROOTWORK_HP_LINE,
  STRATOSPHERE_MULT,
  STRATOSPHERE_SPD_RATIO,
  TECTONIC_HP_LINE,
  TERRACE_HP_LINE,
  PAYOFF_KINDS,
  PENDING_EXPIRY_TURNS,
  type ArmedPayoff,
  type PayoffKind,
  type SideEffectState,
} from './effects.ts';
import type { Move } from '../game/species.ts';
import { TREE_NODES, type TreeCap, type TreeEffect, type TreeStep } from '../game/tree.ts';
import type { MonSnapshot, Side, TreeTrigger, TreeTriggerEffect } from './battle.ts';

export const SIDES: readonly Side[] = ['a', 'b'];

// Node HP lines and magnitudes (spec section 3 and 4 node tables) the engine reads directly.
/** `bastion:3` Quartermaster: own HP at turn-2 pick time. */
export const QUARTERMASTER_HP = 0.7;
/** `bastion:7:left` Hard Edge: own HP at the end of a turn. */
export const HARD_EDGE_HP = 0.8;
/** `ward:11` Recovery Cycle: the line HP must fall below during a turn, and the heal. */
export const RECOVERY_LINE = 0.35;
export const RECOVERY_CYCLE_HEAL = 0.03;
/** `bastion:1` Keel: own HP share must lead the foe's by at least this many points. */
export const KEEL_LEAD = 0.15;
/** `ward:1` Brace Reflex: works only at or below this HP line. */
export const BRACE_LINE = 0.3;
/** `ward:6` Lastline: only a knockout from above this HP line is held. */
export const LASTLINE_FROM = 0.3;
/** `strike:6` Coup Rule crit multiplier. */
export const COUP_RULE_MULT = 2.0;
/** `nation.air:12` Sovereign Wind: foe HP line. */
export const SOVEREIGN_WIND_LINE = 0.3;
/** `tempo:7` Tempo Lock: a DEF-down arms it only against a foe below this line. */
export const TEMPO_LOCK_DEF_DOWN_LINE = 0.25;
/** `bastion:7` Tough Hide, `bastion:8` Low Tide: own HP lines; `bastion:11` Holdfast: own HP floor;
 * `bastion:10:left` Long Haul: own HP line. */
export const TOUGH_HIDE_LINE = 0.6;
export const LOW_TIDE_LINE = 0.25;
export const HOLDFAST_LINE = 0.85;
export const LONG_HAUL_LINE = 0.6;
/** `ward:10` Iron Tide: own HP line. */
export const IRON_TIDE_LINE = 0.4;
/** `nation.water:10` Deep Current: own HP line (works without soak at or below it). */
export const DEEP_CURRENT_LINE = 0.15;
/** `nation.fire:6` Inferno and `nation.water:6` Tidal Lock also pierce against a foe below this line. */
export const CAPSTONE_PIERCE_LINE = 0.2;
/** `nation.earth:7:left` Grounding and `nation.earth:7:right` Fault Line: foe HP lines. */
export const GROUNDING_LINE = 0.15;
export const FAULT_LINE_LINE = 0.2;
/** `nation.earth:1` Stand Firm: the owner trails the foe's HP share by at least this. */
export const STAND_FIRM_GAP = 0.1;
/** `bastion:2` Ballast, `ward:5` Hard Shell and `strike:1` Hunter's Eye HP lines. */
export const BALLAST_LINE = 0.6;
export const HARD_SHELL_LINE = 0.35;
export const HUNTERS_EYE_LINE = 0.4;
/** `bastion:6` Keystone: own HP line. */
export const KEYSTONE_LINE = 0.7;
/** `strike:8` Heavy Hand: foe HP line and crit multiplier. */
export const HEAVY_HAND_LINE = 0.6;
export const HEAVY_HAND_MULT = 2.0;
/** `strike:7` Pressure Cascade: HP-share gap behind the foe. */
export const PRESSURE_CASCADE_GAP = 0.1;
/** `bastion:10` Iron Chin: own HP line. */
export const IRON_CHIN_LINE = 0.25;
/** `ward:8` Second Skin: a hit worth at least this share of max HP heals half, capped. */
export const SECOND_SKIN_HIT = 0.2;
export const SECOND_SKIN_MAX = 0.05;
/** `tempo:1` Opening Setup combo: 1.2x at equal level plus 0.4 per level the foe is higher (gap
 * clamped to 3): 1.2x, 1.6x, 2.0x, 2.4x (docs/design/progression.md, Automatic opening combo). */
export const FOLLOW_THROUGH_MULT = 1.2;
export const FOLLOW_THROUGH_GAP_STEP = 0.4;
export const other = (side: Side): Side => (side === 'a' ? 'b' : 'a');

/** The battle state tree rules read and write (built once per `simulateBattle`). */
export interface TreeBattle {
  t: number;
  mons: Record<Side, MonSnapshot>;
  hp: Record<Side, number>;
  fx: Record<Side, SideEffectState<Move>>;
  nodes: Record<Side, ReadonlySet<string>>;
  actedFirst: Record<Side, boolean>;
  /** Moves both sides picked this turn (null before PICK). */
  picks: Record<Side, Move | null>;
  /** Loadout slot of each equipped move id (1 opener, 2 default, 3 finisher). */
  slotOf: Record<Side, Record<string, 1 | 2 | 3>>;
  /** Live SPD as the engine uses it for order (air trait, soak). */
  liveSpd: (side: Side) => number;
  /** `BattleTurn.treeTriggers` of the current turn. */
  turnLog: TreeTrigger[];
}

/** One action (a main move or its double strike) as it passes steps 4 to 12. */
export interface TreeAct {
  me: Side;
  foe: Side;
  move: Move;
  charge: 'telegraph' | 'release' | null;
  /** Double strike: no offensive tree effects, applies no status, arms no payoff. */
  ds: boolean;
  slot: 1 | 2 | 3 | undefined;
  /** Unique per action; a 1/turn cap used by this action stays usable within it. */
  serial: number;
  /** `BattleAction.treeTriggers` of this action. */
  log: TreeTrigger[];
  /** HP before the action. */
  meHp0: number;
  foeHp0: number;
  /** Node that fizzled / voided this action. */
  fizzled: string | null;
  voided: string | null;
  /** Credited shared booleans (node ids). */
  pierce: string | null;
  undodge: string | null;
  gcrit: string | null;
  /** Same-action 1/battle sources credited here, spent only if the action lands. */
  spendOnLand: string[];
  crit: boolean;
  /** Damage of this hit at the base 1.75x crit with no tree factor (Coup Rule's line). */
  baseCritDamage: number;
  /** `bastion:11` Holdfast changed an outcome on this action (flag spent at its end). */
  holdfast: boolean;
}

export type TreeStatus = 'burn' | 'def_down';
export interface StatusEvent {
  status: TreeStatus;
  source: 'move' | 'aftershock' | 'ignite';
  /** Not active on the target before (a DEF-down refresh is not new; a Burn on a burned target
   * never reaches the status step). */
  isNew: boolean;
}

// --- small helpers -----------------------------------------------------------------------------

export const has = (B: TreeBattle, side: Side, id: string): boolean => B.nodes[side].has(id);
/** Exact HP-share lead: `ahead`'s share minus `behind`'s share is at least `points` (a fraction
 * with two decimals, e.g. 0.15), compared with integer cross-products so 120/200 vs 100/200 is
 * exactly 10 points. */
export const leadAtLeast = (B: TreeBattle, ahead: Side, behind: Side, points: number): boolean => {
  const maxA = B.mons[ahead].stats.hp;
  const maxB = B.mons[behind].stats.hp;
  return 100 * (B.hp[ahead] * maxB - B.hp[behind] * maxA) >= Math.round(points * 100) * maxA * maxB;
};
/** HP fraction; used only for HP-lead comparisons between the two sides. */
export const frac = (B: TreeBattle, side: Side): number => B.hp[side] / B.mons[side].stats.hp;
/**
 * The integer HP of an X% line for `side`: `floor(maxHp * x)`. Every HP-line rule uses it, for the
 * clamp target and for the test alike: "at or below X%" is `hp <= line`, "below" `hp < line`,
 * "above" `hp > line`, "at least" `hp >= line`. A clamp to the 50% line therefore lands exactly on
 * "at or below 50%" (Pulse turns on Ballast and Keystone, spec 5.1) and never re-fires from there.
 */
/** Kiln Skin also refuses while its owner is below this HP share. */
export const KILN_SKIN_LINE = 0.5;
export const lineHp = (B: TreeBattle, side: Side, x: number): number =>
  Math.floor(B.mons[side].stats.hp * x);
export const hasStatus = (st: SideEffectState<Move>): boolean =>
  st.burnTurns > 0 || st.defDownTurns > 0;
const capOf = (id: string): TreeCap => TREE_NODES[id]?.cap ?? 'battle';
const nameOf = (id: string): string => TREE_NODES[id]?.name ?? id;

/** Air speed lead (addendum 2 item 7): own live SPD over the foe's live SPD without the foe's
 * air trait. Order (step 3) still uses plain live SPD. */
export function spdLead(B: TreeBattle, side: Side): number {
  const foe = other(side);
  const foeAir = B.mons[foe].nation === 'air' ? AIR_SPEED_MULT : 1;
  return B.liveSpd(side) / (B.liveSpd(foe) / foeAir);
}

// Nation-column state reads (addendum 2 items 1 and 2). `foeSoaked` is the only read of
// `soakTurns` in this file and only `nation.water:*` rules call it.
/** The owner's foe carries heat (fire column): any Burn, or a DEF-down a move applied (tuning
 * deviation, step D2: Sparkit has no Burn move). Trait DEF-down (Aftershock) never counts. */
const foeBurned = (B: TreeBattle, owner: Side): boolean => {
  const st = B.fx[other(owner)];
  return st.burnTurns > 0 || (st.defDownTurns > 0 && st.defDownFromMove);
};
/** The owner's foe is soaked (water column only). */
const foeSoaked = (B: TreeBattle, owner: Side): boolean => B.fx[other(owner)].soakTurns > 0;

/** `serial` of a spend or check made outside an action (ORDER, TURN_END). */
export const NO_ACTION = -1;

/** Whether a node's cap still allows it (`turn`: unused this turn, or used by this very action;
 * a use outside an action never counts as "this action"). */
export function available(B: TreeBattle, side: Side, id: string, serial = NO_ACTION): boolean {
  const cap = capOf(id);
  const st = B.fx[side];
  if (cap === 'battle') return !st.onceFlags.has(id);
  if (cap === 'turn' || cap === 'pending') {
    const used = st.turnUsed.get(id);
    return used === undefined || (serial !== NO_ACTION && used === serial);
  }
  return true;
}

export function spend(B: TreeBattle, side: Side, id: string, serial = NO_ACTION): void {
  const cap = capOf(id);
  if (cap === 'battle') B.fx[side].onceFlags.add(id);
  else if (cap === 'turn' || cap === 'pending') B.fx[side].turnUsed.set(id, serial);
}

const EFFECT_KINDS: Partial<Record<TreeTriggerEffect, readonly TreeEffect[]>> = {
  void: ['VOID'],
  refused: ['REFUSE'],
  noncrit: ['NOCRIT'],
  clamp: ['CLAMP', 'CAP'],
  undodge: ['UNDODGE'],
  guaranteed_crit: ['GUARANTEED_CRIT'],
  pierced: ['PIERCE'],
  multiplier: ['MULTIPLIER'],
  fizzled: ['FIZZLE'],
  order_override: ['ORDER'],
  order_suppressed: ['ORDER'],
  finisher_early: ['ORDER'],
  burn_tick_skipped: ['SKIP_TICK'],
  status_refreshed: ['EXTEND'],
  heal: ['HEAL'],
  status_cleared: ['CLEANSE'],
};
/** Fixed text for entries that are not the node's own effect (arming, consumption, denial). */
const META_TEXT: Record<TreeTriggerEffect, string> = {
  void: 'hit voided',
  refused: 'refused {status}',
  noncrit: 'crit cancelled',
  clamp: 'held at {hp} HP',
  undodge: 'cannot be dodged',
  guaranteed_crit: 'guaranteed crit',
  pierced: 'pierced {defense}',
  multiplier: 'multiplier {factor}x',
  fizzled: "foe's move fizzled",
  order_override: 'you act first',
  order_suppressed: "foe's Priority suppressed (SPD {spd})",
  finisher_early: 'finisher played early ({detail})',
  burn_tick_skipped: 'burn tick skipped',
  status_refreshed: 'status kept through the next turn',
  payoff_armed: 'armed{cause}',
  payoff_consumed: 'used',
  payoff_lost: 'lost (no direct move)',
  payoff_expired: 'expired unused',
  heal: 'healed {amount} HP',
  status_cleared: 'cleared {statuses}',
  denied: 'denied ({reason})',
};
export type TriggerVars = Partial<
  Record<
    | 'defense'
    | 'status'
    | 'amount'
    | 'hp'
    | 'factor'
    | 'statuses'
    | 'turns'
    | 'detail'
    | 'blocked'
    | 'spd'
    | 'reason'
    | 'cause',
    string | number
  >
>;

/** Writes one tree log entry; `detail` is the node's fixed `logText` (or the fixed meta text for
 * arming, consumption and denial entries) with its placeholders filled in. */
export function trig(
  list: TreeTrigger[],
  side: Side,
  node: string,
  step: TreeStep,
  effect: TreeTriggerEffect,
  vars: TriggerVars = {},
): void {
  const def = TREE_NODES[node];
  const kinds = EFFECT_KINDS[effect];
  // A node with two effects (Kill Clock, Holdfast) logs the fixed text of the effect it applied.
  const own = def && kinds && !def.extraEffect && kinds.includes(def.effect);
  const template = own ? def.logText : `${nameOf(node)}: ${META_TEXT[effect]}`;
  const detail = template.replace(/\{(\w+)\}/g, (_, k: string) =>
    String(vars[k as keyof TriggerVars] ?? ''),
  );
  list.push({ side, node, step, effect, detail });
}

/** Arms a pending payoff (spec 1.2): one per kind; an armed kind refreshes its expiry. */
export function arm(
  B: TreeBattle,
  side: Side,
  kind: PayoffKind,
  node: string,
  list: TreeTrigger[],
  step: TreeStep,
  cause = '',
): void {
  const st = B.fx[side];
  const cur = st.armed[kind];
  st.armed[kind] = cur ? { node: cur.node, turn: B.t } : { node, turn: B.t };
  trig(list, side, node, step, 'payoff_armed', { cause: cause ? ` (${cause})` : '' });
}

/** TURN_START: expire payoffs armed `PENDING_EXPIRY_TURNS` or more turns ago. */
export function expirePayoffs(B: TreeBattle, side: Side): void {
  const st = B.fx[side];
  for (const kind of PAYOFF_KINDS) {
    const p: ArmedPayoff | null = st.armed[kind];
    if (p && p.turn <= B.t - PENDING_EXPIRY_TURNS) {
      st.armed[kind] = null;
      trig(B.turnLog, side, p.node, 'turn_start', 'payoff_expired');
    }
  }
}

/**
 * One-denial and control-rest rules (spec 1.3) for a rule that would deny `victim`'s action this
 * turn. Writes the `denied` entry itself when it loses and keeps the rule unspent.
 */
export function tryDeny(
  B: TreeBattle,
  victim: Side,
  node: string,
  owner: Side,
  list: TreeTrigger[],
  step: TreeStep,
): boolean {
  const vf = B.fx[victim];
  if (vf.deniedThisTurn) {
    trig(list, owner, node, step, 'denied', { reason: nameOf(vf.deniedThisTurn) });
    return false;
  }
  if (vf.deniedLastTurn) {
    trig(list, owner, node, step, 'denied', { reason: 'control rest' });
    return false;
  }
  vf.deniedThisTurn = node;
  return true;
}

// --- shared booleans: UNDODGE, GUARANTEED_CRIT, PIERCE (spec 1.2) -------------------------------

/** A same-action source of one shared boolean, owned by the actor (`ac.me`). Pending payoffs are
 * not listed: they come from `SideEffectState.armed`. */
export interface BoolSource {
  node: string;
  holds: (B: TreeBattle, ac: TreeAct) => boolean;
}

const foeOf = (B: TreeBattle, ac: TreeAct) => B.fx[ac.foe];

export const PIERCE_SOURCES: BoolSource[] = [
  { node: 'strike:2', holds: (B, ac) => B.actedFirst[ac.me] },
  {
    node: 'strike:5',
    holds: (B, ac) => ac.foeHp0 < lineHp(B, ac.foe, 0.4),
  },
  {
    node: 'strike:7',
    holds: (B, ac) =>
      foeOf(B, ac).burnTurns > 0 || leadAtLeast(B, ac.foe, ac.me, PRESSURE_CASCADE_GAP),
  },
  { node: 'tempo:3', holds: (_B, ac) => ac.move.effect === 'priority' },
  { node: 'tempo:5', holds: (B, ac) => B.actedFirst[ac.me] },
  { node: 'tempo:7:left', holds: (B, ac) => !B.actedFirst[ac.me] },
  // nation: Inferno and Tidal Lock 1/turn ("your first direct hit each turn"), Gust Line 1/battle
  {
    node: 'nation.fire:6',
    holds: (B, ac) => foeBurned(B, ac.me) || ac.foeHp0 < lineHp(B, ac.foe, CAPSTONE_PIERCE_LINE),
  },
  {
    node: 'nation.water:6',
    holds: (B, ac) => foeSoaked(B, ac.me) || ac.foeHp0 < lineHp(B, ac.foe, CAPSTONE_PIERCE_LINE),
  },
  {
    node: 'nation.air:4',
    holds: (B, ac) => B.actedFirst[ac.me] && spdLead(B, ac.me) >= GUST_LINE_SPD_RATIO,
  },
];

export const UNDODGE_SOURCES: BoolSource[] = [
  {
    node: 'bastion:2',
    holds: (B, ac) => ac.meHp0 <= lineHp(B, ac.me, BALLAST_LINE) && ac.slot === 2,
  },
  // Keystone (deviation): any direct move while your HP is at or below 70% and below the foe's.
  {
    node: 'bastion:6',
    holds: (B, ac) =>
      ac.meHp0 <= lineHp(B, ac.me, KEYSTONE_LINE) && frac(B, ac.me) < frac(B, ac.foe),
  },
  { node: 'strike:7:right', holds: (B) => B.t <= 3 },
  { node: 'tempo:3:alt', holds: (B, ac) => B.actedFirst[ac.me] },
  { node: 'tempo:9', holds: (_B, ac) => ac.charge === 'release' },
  // nation
  {
    node: 'nation.air:2',
    holds: (B, ac) => spdLead(B, ac.me) >= LIFT_SPD_RATIO && B.actedFirst[ac.me],
  },
];

export const GUARANTEED_CRIT_SOURCES: BoolSource[] = [
  {
    node: 'strike:10',
    holds: (B, ac) => ac.foeHp0 < lineHp(B, ac.foe, 0.25) && hasStatus(foeOf(B, ac)),
  },
  // nation (1/battle flags, spent only when the forced crit survives)
  {
    node: 'nation.fire:10',
    holds: (B, ac) => ac.foeHp0 < lineHp(B, ac.foe, 0.5),
  },
  {
    node: 'nation.water:12',
    holds: (B, ac) => foeSoaked(B, ac.me) && ac.foeHp0 < lineHp(B, ac.foe, 0.5),
  },
  {
    node: 'nation.earth:7:right',
    holds: (B, ac) =>
      B.fx[ac.me].hitStreak >= 2 &&
      frac(B, ac.me) < frac(B, ac.foe) &&
      ac.foeHp0 <= lineHp(B, ac.foe, FAULT_LINE_LINE),
  },
  {
    node: 'nation.earth:10',
    holds: (B, ac) => B.fx[ac.foe].hitStreak >= 4 && ac.foeHp0 <= lineHp(B, ac.foe, 0.2),
  },
  { node: 'nation.earth:10:left', holds: (B, ac) => ac.foeHp0 <= lineHp(B, ac.foe, 0.3) },
  {
    node: 'nation.air:12',
    holds: (B, ac) =>
      spdLead(B, ac.me) >= LIFT_SPD_RATIO && ac.foeHp0 < lineHp(B, ac.foe, SOVEREIGN_WIND_LINE),
  },
];

export const BOOL_SOURCES: Record<PayoffKind, BoolSource[]> = {
  UNDODGE: UNDODGE_SOURCES,
  GUARANTEED_CRIT: GUARANTEED_CRIT_SOURCES,
  PIERCE: PIERCE_SOURCES,
};

const CAP_RANK: Record<TreeCap, number> = { state: 0, turn: 1, pending: 2, battle: 3 };
const PENDING_RANK = 2;
const tierOf = (id: string) => TREE_NODES[id]?.tier ?? 99;
const isNation = (id: string) => id.startsWith('nation.');

/**
 * Credits one source for a shared boolean on this action (spec 1.2; addendum 3.2 tie rule):
 * least restrictive cap first (state, 1/turn, pending, 1/battle), then shared before nation,
 * then the lower tier. Only the credited source is consumed and logs; the rest keep their caps
 * and their pending arm.
 */
export function creditBoolean(
  B: TreeBattle,
  ac: TreeAct,
  kind: PayoffKind,
): { node: string; pending: boolean } | null {
  let best: { node: string; pending: boolean; key: number } | null = null;
  const consider = (node: string, rank: number, pending: boolean) => {
    const key = rank * 1000 + (isNation(node) ? 100 : 0) + tierOf(node);
    if (!best || key < best.key) best = { node, pending, key };
  };
  for (const src of BOOL_SOURCES[kind]) {
    if (!has(B, ac.me, src.node) || !available(B, ac.me, src.node, ac.serial)) continue;
    if (src.holds(B, ac)) consider(src.node, CAP_RANK[capOf(src.node)], false);
  }
  const armed = B.fx[ac.me].armed[kind];
  if (armed) consider(armed.node, PENDING_RANK, true);
  return best;
}

// --- denial: FIZZLE (4.1) and VOID (7) ---------------------------------------------------------

/** Owner is the defender; `victim` acts with `move`. Fizzle rung order: `tempo:7`, then nation. */
export interface FizzleRule {
  node: string;
  holds: (B: TreeBattle, owner: Side, victim: Side, move: Move) => boolean;
  onSpend?: (B: TreeBattle, owner: Side) => void;
}
export const FIZZLE_RULES: FizzleRule[] = [
  {
    node: 'tempo:7',
    holds: (B, owner, _victim, move) => move.effect === 'priority' && B.fx[owner].burnApplied,
  },
  {
    node: 'nation.earth:7:left',
    holds: (B, owner, _victim, move) =>
      move.effect === 'priority' &&
      B.fx[owner].hitStreak >= 2 &&
      B.hp[other(owner)] <= lineHp(B, other(owner), GROUNDING_LINE),
  },
  {
    node: 'nation.air:7:left',
    holds: (B, owner, _victim, move) => move.effect === 'priority' && B.fx[owner].dustDevilArmed,
    onSpend: (B, owner) => {
      B.fx[owner].dustDevilArmed = false;
    },
  },
];

/** Whether one of `owner`'s fizzle rules would fizzle `victim`'s pick this turn (Anchor and
 * Order Snap yield to it, spec 1.1 3b). */
export function fizzleWould(B: TreeBattle, owner: Side, victim: Side): string | null {
  const move = B.picks[victim];
  if (!move || B.fx[victim].deniedLastTurn) return null;
  for (const r of FIZZLE_RULES) {
    if (has(B, owner, r.node) && available(B, owner, r.node) && r.holds(B, owner, victim, move))
      return r.node;
  }
  return null;
}

/** Owner is the defender (`ac.foe`). VOID rung order: `ward:3`, nation, `ward:10`, `bastion:8`. */
export interface VoidRule {
  node: string;
  holds: (B: TreeBattle, ac: TreeAct) => boolean;
}
export const VOID_RULES: VoidRule[] = [
  {
    node: 'ward:3',
    holds: (_B, ac) => (ac.move.effect === 'priority' || ac.charge === 'release') && ac.crit,
  },
  // Mantle: a Priority crit while the owner's `hitStreak` (previous TURN_END) is at least 2.
  {
    node: 'nation.earth:5',
    holds: (B, ac) => ac.move.effect === 'priority' && ac.crit && B.fx[ac.foe].hitStreak >= 2,
  },
  {
    node: 'nation.water:10',
    holds: (B, ac) =>
      ac.move.effect === 'priority' &&
      (foeSoaked(B, ac.foe) || B.hp[ac.foe] <= lineHp(B, ac.foe, DEEP_CURRENT_LINE)),
  },
  {
    node: 'ward:10',
    holds: (B, ac) =>
      (ac.charge === 'release' || ac.slot === 3) &&
      B.hp[ac.foe] <= lineHp(B, ac.foe, IRON_TIDE_LINE),
  },
  {
    node: 'bastion:8',
    holds: (B, ac) =>
      ac.move.effect === 'priority' &&
      B.fx[ac.me].defDownTurns > 0 &&
      B.fx[ac.me].defDownFromMove &&
      B.hp[ac.foe] <= lineHp(B, ac.foe, LOW_TIDE_LINE),
  },
];

// --- ORDER (step 3) ------------------------------------------------------------------------------

/** 3b order rung: the owner acts first and the foe's action counts as denied. Order: `bastion:5`
 * Anchor, then nation rules (addendum 3.2). */
export interface OrderRule {
  node: string;
  holds: (B: TreeBattle, owner: Side) => boolean;
}
export const ORDER_RUNG_RULES: OrderRule[] = [
  {
    node: 'bastion:5',
    holds: (B, owner) => {
      const foe = other(owner);
      return (
        B.picks[foe]?.effect === 'priority' &&
        B.picks[owner]?.effect !== 'priority' &&
        frac(B, owner) < frac(B, foe) &&
        B.liveSpd(owner) >= ANCHOR_SPD_RATIO * B.liveSpd(foe)
      );
    },
  },
];

/** Order-rung rules after 3c (addendum 3.2 rung order: Anchor, Order Snap, Undercurrent, then
 * Undertow Pull): same semantics as the 3b rung, evaluated on the order 3a to 3c left. */
export const ORDER_RUNG_LATE_RULES: OrderRule[] = [
  { node: 'nation.water:10:left', holds: (B, owner) => foeSoaked(B, owner) },
];

/** 3c suppression: the single Priority side `pri` is the owner's foe. Order: `tempo:10:right`
 * Order Snap, then nation rules (addendum 3.2, Undercurrent). */
export interface SuppressRule {
  node: string;
  holds: (B: TreeBattle, owner: Side, pri: Side) => boolean;
}
export const SUPPRESS_3C_RULES: SuppressRule[] = [
  { node: 'tempo:10:right', holds: (B, owner) => B.fx[owner].orderSnapDue },
  { node: 'nation.water:3', holds: (B, owner) => foeSoaked(B, owner) },
];

// --- CRIT (6): NOCRIT order (addendum 3.2) -------------------------------------------------------

/** Owner is the defender (`ac.foe`). */
export interface NocritRule {
  node: string;
  /** Iron Chin is never bypassed by PIERCE. */
  pierceable: boolean;
  holds: (B: TreeBattle, ac: TreeAct) => boolean;
  onSpend?: (B: TreeBattle, owner: Side) => void;
}
export const NOCRIT_RULES: NocritRule[] = [
  {
    node: 'bastion:10',
    pierceable: false,
    holds: (B, ac) => B.hp[ac.foe] <= lineHp(B, ac.foe, IRON_CHIN_LINE),
  },
  // state rules (Keel and Headwind are 1/battle since step D2; their order position is kept)
  {
    node: 'bastion:1',
    pierceable: true,
    holds: (B, ac) => leadAtLeast(B, ac.foe, ac.me, KEEL_LEAD),
  },
  { node: 'bastion:7:right', pierceable: true, holds: (B, ac) => !hasStatus(B.fx[ac.foe]) },
  // The attacker (`ac.me`) is the owner's foe.
  { node: 'nation.fire:3:alt', pierceable: true, holds: (B, ac) => foeBurned(B, ac.foe) },
  { node: 'nation.water:2', pierceable: true, holds: (B, ac) => foeSoaked(B, ac.foe) },
  {
    node: 'nation.air:3',
    pierceable: true,
    holds: (B, ac) => spdLead(B, ac.foe) >= LIFT_SPD_RATIO && B.actedFirst[ac.foe],
  },
  // flags
  {
    node: 'bastion:11',
    pierceable: true,
    holds: (B, ac) => ac.foeHp0 >= lineHp(B, ac.foe, HOLDFAST_LINE),
  },
  {
    node: 'ward:7:right',
    pierceable: true,
    holds: (B, ac) => B.fx[ac.foe].evasionPlanArmed,
    onSpend: (B, owner) => {
      B.fx[owner].evasionPlanArmed = false;
    },
  },
  {
    node: 'ward:1',
    pierceable: true,
    holds: (B, ac) => B.hp[ac.foe] <= lineHp(B, ac.foe, BRACE_LINE),
  },
  { node: 'nation.fire:7', pierceable: true, holds: (B, ac) => !foeBurned(B, ac.foe) },
  {
    node: 'nation.air:7',
    pierceable: true,
    holds: (B, ac) =>
      spdLead(B, ac.foe) >= LIFT_SPD_RATIO && B.hp[ac.foe] <= lineHp(B, ac.foe, 0.5),
  },
  {
    node: 'nation.earth:6',
    pierceable: false,
    holds: (B, ac) => B.fx[ac.foe].hitStreak >= 3 && B.hp[ac.foe] <= lineHp(B, ac.foe, 0.35),
  },
];

// --- DAMAGE (7): one-factor rule (spec 1.2, addendum 3.3) ----------------------------------------

/** Offensive tree damage factors owned by the attacker. A `crit` rule replaces the 1.75x crit
 * multiplier (factor = value / 1.75); a `combo` rule multiplies the hit. The largest factor wins;
 * the others stay unspent. */
export interface MultiplierRule {
  node: string;
  kind: 'crit' | 'combo';
  value: (B: TreeBattle, ac: TreeAct) => number | null;
}
export const MULTIPLIER_RULES: MultiplierRule[] = [
  {
    node: 'tempo:1',
    kind: 'combo',
    value: (B, ac) => {
      const combo = B.fx[ac.me].combo;
      if (!combo || ac.move.id === combo.moveId) return null;
      const e = ac.move.effect;
      if (!(e === 'priority' || e === 'true_hit' || e === 'crit_up' || ac.charge === 'release'))
        return null;
      const foe = B.fx[ac.foe];
      if (combo.status === 'burn' ? foe.burnTurns === 0 : foe.defDownTurns === 0) return null;
      const gap = Math.max(-3, Math.min(3, B.mons[ac.me].level - B.mons[ac.foe].level));
      return FOLLOW_THROUGH_MULT + FOLLOW_THROUGH_GAP_STEP * Math.max(0, -gap);
    },
  },
  {
    node: 'strike:6',
    kind: 'crit',
    value: (B, ac) =>
      ac.crit && B.hp[ac.foe] - ac.baseCritDamage <= lineHp(B, ac.foe, 0.35)
        ? COUP_RULE_MULT
        : null,
  },
  {
    node: 'strike:8',
    kind: 'crit',
    value: (B, ac) =>
      ac.crit && ac.foeHp0 < lineHp(B, ac.foe, HEAVY_HAND_LINE) ? HEAVY_HAND_MULT : null,
  },
  // nation (addendum 3.3): crit multipliers under the same one-factor rule
  {
    node: 'nation.fire:1',
    kind: 'crit',
    value: (B, ac) => (ac.crit && foeBurned(B, ac.me) ? KINDLING_MULT : null),
  },
  {
    node: 'nation.fire:12',
    kind: 'crit',
    value: (B, ac) =>
      ac.crit && (foeBurned(B, ac.me) || ac.foeHp0 < lineHp(B, ac.foe, 0.5))
        ? PYRE_LORD_MULT
        : null,
  },
  {
    node: 'nation.earth:12',
    kind: 'crit',
    value: (B, ac) => (ac.crit && B.fx[ac.me].hitStreak >= 3 ? CONTINENT_MULT : null),
  },
  {
    node: 'nation.air:8',
    kind: 'crit',
    value: (B, ac) =>
      ac.crit && spdLead(B, ac.me) >= STRATOSPHERE_SPD_RATIO ? STRATOSPHERE_MULT : null,
  },
];

// --- CLAMP (9) (addendum 3.2: one list, descending HP line) ---------------------------------------

/** Owner is the hit's target. Applies when it holds, HP before the hit is above the line and the
 * damage would take HP below it; it then leaves HP at exactly the line (`clampedDamage`). */
export interface ClampRule {
  node: string;
  line: number;
  holds: (B: TreeBattle, ac: TreeAct) => boolean;
}
export const CLAMP_RULES: ClampRule[] = [
  {
    node: 'ward:4',
    line: CLAMP_PULSE_LINE,
    holds: (_B, ac) => ac.move.effect === 'priority' || ac.charge === 'release',
  },
  { node: 'nation.water:11', line: BRINE_HP_LINE, holds: (B, ac) => foeSoaked(B, ac.foe) },
  {
    node: 'nation.earth:11',
    line: TERRACE_HP_LINE,
    holds: (B, ac) => B.fx[ac.foe].hitStreak >= 1 && ac.foeHp0 > lineHp(B, ac.foe, 0.6),
  },
  {
    node: 'nation.earth:7',
    line: TECTONIC_HP_LINE,
    holds: (B, ac) => ac.foeHp0 > lineHp(B, ac.foe, 0.4),
  },
  {
    node: 'bastion:3:alt',
    line: CLAMP_HOLD_LINE,
    holds: (B, ac) => !ac.crit && ac.foeHp0 > lineHp(B, ac.foe, 0.5),
  },
  {
    node: 'nation.earth:3',
    line: ROOTWORK_HP_LINE,
    holds: (_B, ac) => ac.crit,
  },
];

/** The damage a clamp at integer line `line` leaves, or null when it does not apply. */
export function clampedDamage(before: number, damage: number, line: number): number | null {
  return before > line && before - damage < line ? before - line : null;
}

// --- STATUS (11): REFUSE order (addendum 3.2) ------------------------------------------------------

/** Owner is the target (`ac.foe`). */
export interface RefuseRule {
  node: string;
  holds: (B: TreeBattle, ac: TreeAct, ev: StatusEvent) => boolean;
  onSpend?: (B: TreeBattle, owner: Side) => void;
}
export const REFUSE_RULES: RefuseRule[] = [
  // state
  { node: 'bastion:12', holds: (B, ac) => frac(B, ac.foe) > frac(B, ac.me) },
  // 1/turn rules (Hard Shell is 1/battle since step D2; its order position is kept)
  { node: 'bastion:10:right', holds: (_B, ac, ev) => ev.source === 'move' && ac.slot === 1 },
  { node: 'ward:10:left', holds: (B, ac) => B.actedFirst[ac.foe] },
  { node: 'ward:5', holds: (B, ac) => B.hp[ac.foe] < lineHp(B, ac.foe, HARD_SHELL_LINE) },
  {
    node: 'ward:7',
    holds: (B, ac) => hasStatus(B.fx[ac.foe]),
  },
  // The attacker (`ac.me`) is the owner's foe.
  {
    node: 'nation.fire:7:left',
    holds: (B, ac) => foeBurned(B, ac.foe) || B.hp[ac.foe] < lineHp(B, ac.foe, KILN_SKIN_LINE),
  },
  { node: 'nation.water:7', holds: (B, ac) => foeSoaked(B, ac.foe) },
  { node: 'nation.earth:9', holds: (B, ac) => B.fx[ac.foe].hitStreak >= 1 },
  {
    node: 'nation.air:10',
    holds: (B, ac) => spdLead(B, ac.foe) >= LEE_SHORE_SPD_RATIO && B.fx[ac.foe].hitStreak === 0,
  },
  { node: 'nation.air:6', holds: (B, ac) => spdLead(B, ac.foe) >= LIFT_SPD_RATIO },
  // flags
  { node: 'bastion:11', holds: (B, ac) => ac.foeHp0 >= lineHp(B, ac.foe, HOLDFAST_LINE) },
  { node: 'bastion:7', holds: (B, ac) => B.hp[ac.foe] <= lineHp(B, ac.foe, TOUGH_HIDE_LINE) },
  { node: 'ward:7:left', holds: (_B, _ac, ev) => ev.status === 'burn' },
  {
    node: 'ward:3:alt',
    holds: (B, ac) => B.fx[ac.foe].dodgeLedgerArmed,
    onSpend: (B, owner) => {
      B.fx[owner].dodgeLedgerArmed = false;
    },
  },
  { node: 'ward:9', holds: (_B, _ac, ev) => ev.status === 'def_down' },
  { node: 'nation.water:3:alt', holds: (B, ac) => foeSoaked(B, ac.foe) },
  { node: 'nation.earth:3:alt', holds: (B, ac) => B.fx[ac.foe].hitStreak >= 1 },
  {
    node: 'nation.air:11',
    holds: (B, ac) => B.fx[ac.foe].cloudBankArmed,
    onSpend: (B, owner) => {
      B.fx[owner].cloudBankArmed = false;
    },
  },
];

// --- TURN_END (13a): burn tick skips -----------------------------------------------------------

/** Owner is the burned side. First match wins; the other keeps its flag. */
export interface SkipTickRule {
  node: string;
  holds: (B: TreeBattle, side: Side) => boolean;
}
export const SKIP_TICK_RULES: SkipTickRule[] = [
  { node: 'bastion:4', holds: (B, side) => B.hp[side] > lineHp(B, side, 0.75) },
  {
    node: 'tempo:8',
    holds: (B, side) => B.actedFirst[side] && B.fx[side].landedDirectThisTurn,
  },
];

// --- arming hooks ---------------------------------------------------------------------------------

const threeDifferent = (moves: string[]) => moves.length === 3 && new Set(moves).size === 3;
const alive = (B: TreeBattle, side: Side) => B.hp[side] > 0;

/** HIT (10), attacker side, after a landed main action (a VOIDed hit counts). `ac.me` owns. */
export type HitHook = (B: TreeBattle, ac: TreeAct) => void;
const ownHit =
  (node: string, fn: (B: TreeBattle, ac: TreeAct) => void): HitHook =>
  (B, ac) => {
    if (has(B, ac.me, node) && available(B, ac.me, node, ac.serial)) fn(B, ac);
  };
export const ON_HIT: HitHook[] = [
  ownHit('strike:1', (B, ac) => {
    if (ac.crit && alive(B, ac.foe) && B.hp[ac.foe] < lineHp(B, ac.foe, HUNTERS_EYE_LINE)) {
      arm(B, ac.me, 'GUARANTEED_CRIT', 'strike:1', ac.log, 'hit');
      spend(B, ac.me, 'strike:1');
    }
  }),
  ownHit('strike:3:alt', (B, ac) => {
    // The first time your hit (crit or not) leaves the foe below 50%.
    if (alive(B, ac.foe) && B.hp[ac.foe] < lineHp(B, ac.foe, 0.5)) {
      arm(B, ac.me, 'UNDODGE', 'strike:3:alt', ac.log, 'hit');
      spend(B, ac.me, 'strike:3:alt');
    }
  }),
  ownHit('strike:4', (B, ac) => {
    if (ac.crit && alive(B, ac.foe)) {
      arm(B, ac.me, 'PIERCE', 'strike:4', ac.log, 'hit');
      spend(B, ac.me, 'strike:4', ac.serial);
    }
  }),
  ownHit('strike:9', (B, ac) => {
    if (alive(B, ac.foe) && B.hp[ac.foe] <= lineHp(B, ac.foe, 0.25)) {
      arm(B, ac.me, 'GUARANTEED_CRIT', 'strike:9', ac.log, 'hit');
      spend(B, ac.me, 'strike:9');
    }
  }),
  ownHit('strike:12', (B, ac) => {
    if (alive(B, ac.foe) && B.hp[ac.foe] <= lineHp(B, ac.foe, 0.25)) {
      arm(B, ac.me, 'UNDODGE', 'strike:12', ac.log, 'hit');
      arm(B, ac.me, 'PIERCE', 'strike:12', ac.log, 'hit');
      spend(B, ac.me, 'strike:12');
    }
  }),
  ownHit('tempo:4', (B, ac) => {
    if (alive(B, ac.foe) && threeDifferent(B.fx[ac.me].landedMoves)) {
      arm(B, ac.me, 'GUARANTEED_CRIT', 'tempo:4', ac.log, 'hit');
      spend(B, ac.me, 'tempo:4');
    }
  }),
  ownHit('tempo:6', (B, ac) => {
    const st = B.fx[ac.me];
    if (!alive(B, ac.foe) || !threeDifferent(st.landedMoves) || !hasStatus(st)) return;
    const cleared = [st.burnTurns > 0 && 'Burn', st.defDownTurns > 0 && 'DEF-down']
      .filter(Boolean)
      .join(' and ');
    st.burnTurns = 0;
    st.burnFromMove = false;
    st.defDownTurns = 0;
    st.defDownFromMove = false;
    trig(ac.log, ac.me, 'tempo:6', 'hit', 'status_cleared', { statuses: cleared });
    spend(B, ac.me, 'tempo:6');
  }),
  ownHit('tempo:10', (B, ac) => {
    if (alive(B, ac.foe) && B.fx[ac.me].priorityStreak >= 2) {
      arm(B, ac.me, 'UNDODGE', 'tempo:10', ac.log, 'hit');
      spend(B, ac.me, 'tempo:10');
    }
  }),
  ownHit('tempo:11', (B, ac) => {
    if (alive(B, ac.foe) && B.fx[ac.me].actedFirstStreak >= 2) {
      arm(B, ac.me, 'GUARANTEED_CRIT', 'tempo:11', ac.log, 'hit');
      spend(B, ac.me, 'tempo:11');
    }
  }),
  // nation.fire: this hit's own Burn is applied later (step 11), so "burned" is the Burn the foe
  // carried when the hit landed.
  ownHit('nation.fire:7:right', (B, ac) => {
    if (ac.crit && alive(B, ac.foe) && foeBurned(B, ac.me)) {
      arm(B, ac.me, 'UNDODGE', 'nation.fire:7:right', ac.log, 'hit', 'crit on a burned foe');
      spend(B, ac.me, 'nation.fire:7:right', ac.serial);
    }
  }),
  ownHit('nation.fire:11', (B, ac) => {
    if (alive(B, ac.foe) && foeBurned(B, ac.me)) {
      const cause = 'heated foe hit';
      arm(B, ac.me, 'UNDODGE', 'nation.fire:11', ac.log, 'hit', cause);
      arm(B, ac.me, 'PIERCE', 'nation.fire:11', ac.log, 'hit', cause);
      spend(B, ac.me, 'nation.fire:11');
    }
  }),
];

/** A defender-side hook (`ac.foe` owns, alive): `fn` arms and returns whether it did, which
 * spends the node's cap. */
const ownTaken =
  (node: string, fn: (B: TreeBattle, ac: TreeAct) => boolean): HitHook =>
  (B, ac) => {
    if (!has(B, ac.foe, node) || !available(B, ac.foe, node, ac.serial) || !alive(B, ac.foe))
      return;
    if (fn(B, ac)) spend(B, ac.foe, node, ac.serial);
  };

/** HIT_TAKEN (10), defender side (`ac.foe` owns), after any landed direct hit incl. a double
 * strike (addendum 2 item 6). */
export const ON_HIT_TAKEN: HitHook[] = [
  (B, ac) => {
    if (has(B, ac.foe, 'strike:10:right') && available(B, ac.foe, 'strike:10:right', ac.serial)) {
      arm(B, ac.foe, 'PIERCE', 'strike:10:right', ac.log, 'hit');
      spend(B, ac.foe, 'strike:10:right', ac.serial);
    }
  },
  ownTaken('nation.fire:5', (B, ac) => {
    if (!foeBurned(B, ac.foe)) return false;
    if (!ac.crit) return false;
    arm(B, ac.foe, 'GUARANTEED_CRIT', 'nation.fire:5', ac.log, 'hit', 'crit taken on a heated foe');
    return true;
  }),
  ownTaken('nation.earth:8', (B, ac) => {
    if (B.fx[ac.foe].directHitsTaken !== 6) return false;
    arm(B, ac.foe, 'UNDODGE', 'nation.earth:8', ac.log, 'hit', 'six hits taken');
    return true;
  }),
];

/** DODGE (5), defender side (`ac.foe` owns), after it dodged a direct hit. */
export const ON_DODGE: HitHook[] = [
  (B, ac) => {
    if (has(B, ac.foe, 'ward:2') && available(B, ac.foe, 'ward:2', ac.serial)) {
      arm(B, ac.foe, 'UNDODGE', 'ward:2', ac.log, 'dodge');
      spend(B, ac.foe, 'ward:2', ac.serial);
    }
  },
  (B, ac) => {
    const st = B.fx[ac.foe];
    if (
      has(B, ac.foe, 'ward:3:alt') &&
      available(B, ac.foe, 'ward:3:alt') &&
      !st.dodgeLedgerArmed
    ) {
      st.dodgeLedgerArmed = true;
      trig(ac.log, ac.foe, 'ward:3:alt', 'dodge', 'payoff_armed');
    }
  },
  (B, ac) => {
    const st = B.fx[ac.foe];
    if (
      has(B, ac.foe, 'ward:7:right') &&
      available(B, ac.foe, 'ward:7:right') &&
      !st.evasionPlanArmed
    ) {
      st.evasionPlanArmed = true;
      trig(ac.log, ac.foe, 'ward:7:right', 'dodge', 'payoff_armed');
    }
  },
  (B, ac) => counterSetup(B, ac, 'dodge'),
  // nation.air (the dodger `ac.foe` owns)
  ownTaken('nation.air:1', (B, ac) => {
    arm(B, ac.foe, 'PIERCE', 'nation.air:1', ac.log, 'dodge', 'dodge');
    return true;
  }),
  // Priority-keyed dodge arms read the foe's Priority move, not its double strike.
  ownTaken('nation.air:3:alt', (B, ac) => {
    if (ac.ds) return false;
    arm(B, ac.foe, 'GUARANTEED_CRIT', 'nation.air:3:alt', ac.log, 'dodge', 'dodge');
    return true;
  }),
  (B, ac) => {
    const st = B.fx[ac.foe];
    if (has(B, ac.foe, 'nation.air:7:left') && !st.dustDevilArmed) {
      st.dustDevilArmed = true;
      trig(ac.log, ac.foe, 'nation.air:7:left', 'dodge', 'payoff_armed');
    }
  },
  (B, ac) => {
    const st = B.fx[ac.foe];
    if (
      has(B, ac.foe, 'nation.air:11') &&
      available(B, ac.foe, 'nation.air:11') &&
      !st.cloudBankArmed
    ) {
      st.cloudBankArmed = true;
      trig(ac.log, ac.foe, 'nation.air:11', 'dodge', 'payoff_armed');
    }
  },
  ownTaken('nation.air:9', (B, ac) => {
    if (!B.actedFirst[ac.foe]) return false;
    arm(B, ac.foe, 'GUARANTEED_CRIT', 'nation.air:9', ac.log, 'dodge', 'dodge after acting first');
    return true;
  }),
  ownTaken('nation.air:10:right', (B, ac) => {
    arm(B, ac.foe, 'PIERCE', 'nation.air:10:right', ac.log, 'dodge', 'dodge');
    return true;
  }),
];

/** CRIT (6), right after the crit draw and before GUARANTEED_CRIT, Bedrock and NOCRIT;
 * `ac.crit` holds the drawn result. Either side may own the rule (nation: Afterheat belongs to the
 * defender `ac.foe`). Not called for fizzled actions or double strikes. */
export const ON_CRIT_DRAW: HitHook[] = [
  // Afterheat: the drawn crit, before GUARANTEED_CRIT, Bedrock and the NOCRIT order.
  ownTaken('nation.fire:10:right', (B, ac) => {
    if (!ac.crit || !foeBurned(B, ac.foe)) return false;
    arm(B, ac.foe, 'GUARANTEED_CRIT', 'nation.fire:10:right', ac.log, 'crit', 'crit drawn');
    return true;
  }),
];

/** Soak landed (addendum 9.3: applied at step 10, logged at `hit`), actor side, after the actor's
 * Soak landed on an unsoaked foe. */
const ownSoak = (node: string, kind: PayoffKind, when: (B: TreeBattle, ac: TreeAct) => boolean) =>
  ownHit(node, (B, ac) => {
    if (!when(B, ac)) return;
    arm(B, ac.me, kind, node, ac.log, 'hit', 'soak landed');
    spend(B, ac.me, node);
  });
export const ON_SOAK: HitHook[] = [
  ownSoak('nation.water:1', 'UNDODGE', () => true),
  ownSoak('nation.water:4', 'PIERCE', () => true),
  ownSoak(
    'nation.water:10:right',
    'GUARANTEED_CRIT',
    (B, ac) => B.hp[ac.foe] < lineHp(B, ac.foe, 0.5),
  ),
];

/** ACT_PRE (4.1), defender side, after the actor's action fizzled. */
export const ON_FIZZLE: HitHook[] = [(B, ac) => counterSetup(B, ac, 'act_pre')];

function counterSetup(B: TreeBattle, ac: TreeAct, step: TreeStep) {
  if (
    !ac.ds &&
    ac.move.effect === 'priority' &&
    has(B, ac.foe, 'tempo:10:left') &&
    available(B, ac.foe, 'tempo:10:left', ac.serial)
  ) {
    arm(B, ac.foe, 'PIERCE', 'tempo:10:left', ac.log, step);
    spend(B, ac.foe, 'tempo:10:left', ac.serial);
  }
}

/** STATUS_APPLIED (11), attacker side (`ac.me` owns), for a newly applied, unrefused status. */
export type StatusHook = (B: TreeBattle, ac: TreeAct, ev: StatusEvent) => void;
const statusLabel = (status: TreeStatus) => (status === 'burn' ? 'Burn' : 'DEF-down');
export const ON_STATUS_APPLIED: StatusHook[] = [
  (B, ac, ev) => {
    const st = B.fx[ac.me];
    if (
      ev.source === 'move' &&
      ac.slot === 1 &&
      !st.combo &&
      has(B, ac.me, 'tempo:1') &&
      available(B, ac.me, 'tempo:1')
    ) {
      // Arms on any landed slot-1 Burn or DEF-down ("opener" reads the loadout slot, spec
      // Assumptions); spent only when the combo is consumed (1/battle), so it can re-arm after an
      // unused combo is discarded.
      st.combo = { status: ev.status, moveId: ac.move.id };
      trig(ac.log, ac.me, 'tempo:1', 'status', 'payoff_armed', {
        cause: ` (move ${statusLabel(ev.status)})`,
      });
    }
  },
  (B, ac, ev) => {
    if (ev.source === 'move' && has(B, ac.me, 'strike:3') && available(B, ac.me, 'strike:3')) {
      arm(B, ac.me, 'UNDODGE', 'strike:3', ac.log, 'status', `move ${statusLabel(ev.status)}`);
      spend(B, ac.me, 'strike:3');
    }
  },
  (B, ac, ev) => {
    const st = B.fx[ac.me];
    if (
      // Tuning (step D2): only on a turn the owner acted first; DEF-down only on a foe below 25%.
      ev.source === 'move' &&
      (ev.status === 'burn' || B.hp[ac.foe] < lineHp(B, ac.foe, TEMPO_LOCK_DEF_DOWN_LINE)) &&
      !st.burnApplied &&
      B.actedFirst[ac.me] &&
      has(B, ac.me, 'tempo:7') &&
      available(B, ac.me, 'tempo:7')
    ) {
      st.burnApplied = true;
      trig(ac.log, ac.me, 'tempo:7', 'status', 'payoff_armed', {
        cause: ` (move ${statusLabel(ev.status)})`,
      });
    }
  },
  (B, ac, ev) => {
    if (
      ev.source === 'move' &&
      has(B, ac.me, 'tempo:7:right') &&
      available(B, ac.me, 'tempo:7:right', ac.serial)
    ) {
      arm(
        B,
        ac.me,
        'GUARANTEED_CRIT',
        'tempo:7:right',
        ac.log,
        'status',
        `move ${statusLabel(ev.status)}`,
      );
      spend(B, ac.me, 'tempo:7:right', ac.serial);
    }
  },
  (B, ac, ev) => {
    if (
      ev.status === 'def_down' &&
      ev.source === 'move' &&
      has(B, ac.me, 'strike:10:left') &&
      available(B, ac.me, 'strike:10:left')
    ) {
      arm(B, ac.me, 'PIERCE', 'strike:10:left', ac.log, 'status', 'move DEF-down');
      spend(B, ac.me, 'strike:10:left');
    }
  },
  // nation.fire: a Burn this side applied to an unburned foe after the REFUSE order (move or
  // ignite). Only these rules cite an ignite.
  ...(
    [
      ['nation.fire:3', 'GUARANTEED_CRIT', (ev) => ev.source === 'ignite'],
      ['nation.fire:4', 'PIERCE', () => true],
    ] as Array<[string, PayoffKind, (ev: StatusEvent, B: TreeBattle, ac: TreeAct) => boolean]>
  ).map(([node, kind, when]): StatusHook => (B, ac, ev) => {
    if (ev.status !== 'burn' || !has(B, ac.me, node) || !available(B, ac.me, node)) return;
    if (!when(ev, B, ac)) return;
    arm(B, ac.me, kind, node, ac.log, 'status', ev.source === 'ignite' ? 'ignite' : 'move Burn');
    spend(B, ac.me, node);
  }),
  // Ignition Chain (tuning redesign, step D2): a Burn or DEF-down from your move on a foe below
  // 50% HP.
  (B, ac, ev) => {
    if (ev.source !== 'move' || !has(B, ac.me, 'nation.fire:9')) return;
    if (!available(B, ac.me, 'nation.fire:9') || B.hp[ac.foe] >= lineHp(B, ac.foe, 0.5)) return;
    const cause = `move ${statusLabel(ev.status)}`;
    arm(B, ac.me, 'GUARANTEED_CRIT', 'nation.fire:9', ac.log, 'status', cause);
    spend(B, ac.me, 'nation.fire:9');
  },
];

/** TURN_END sub-phases for the nation columns (addendum 2 item 5): (b2) counter and state arming
 * after the streak counters are written, (d) expiry arming right after the decrements. Called
 * per side, side A then side B. */
export type TurnEndHook = (B: TreeBattle, side: Side) => void;
/** A turn-end arming for a living owner (the node's cap: 1/battle, or pending for Strata, Fuel
 * Line and Sea Legs): arms each kind with one cause. */
const turnEndArm =
  (
    node: string,
    kinds: PayoffKind[],
    cause: string,
    holds: (B: TreeBattle, side: Side) => boolean,
  ): TurnEndHook =>
  (B, side) => {
    if (!has(B, side, node) || !available(B, side, node) || !alive(B, side) || !holds(B, side))
      return;
    for (const kind of kinds) arm(B, side, kind, node, B.turnLog, 'turn_end', cause);
    spend(B, side, node);
  };
const foeFx = (B: TreeBattle, side: Side) => B.fx[other(side)];
/** (b2), tier order within a side: reads the counters (b) just wrote and the soak present at this
 * TURN_END (before the decrement), and the foe's HP after the burn tick. */
export const TURN_END_B2: TurnEndHook[] = [
  turnEndArm(
    'nation.earth:1',
    ['GUARANTEED_CRIT'],
    'hit four turns running while behind',
    (B, s) =>
      B.fx[s].hitStreak >= 4 &&
      B.hp[s] <= lineHp(B, s, 0.5) &&
      leadAtLeast(B, other(s), s, STAND_FIRM_GAP),
  ),
  turnEndArm(
    'nation.earth:4',
    ['PIERCE'],
    'hit two turns running',
    (B, s) => B.fx[s].hitStreak === 2,
  ),
  turnEndArm(
    'nation.air:7:right',
    ['PIERCE'],
    'acted first two turns running',
    (B, s) => B.fx[s].actedFirstStreak === 2,
  ),
  turnEndArm('nation.water:8', ['PIERCE'], 'turn ended with the foe soaked', (B, s) =>
    foeSoaked(B, s),
  ),
  turnEndArm(
    'nation.water:9',
    ['GUARANTEED_CRIT'],
    'foe soaked and below 20%',
    (B, s) => foeSoaked(B, s) && alive(B, other(s)) && B.hp[other(s)] < lineHp(B, other(s), 0.2),
  ),
  turnEndArm(
    'nation.earth:2',
    ['UNDODGE'],
    'hit two turns running',
    (B, s) => B.fx[s].hitStreak >= 2,
  ),
  turnEndArm('nation.fire:2', ['UNDODGE'], 'turn ended with the foe heated', (B, s) =>
    foeBurned(B, s),
  ),
  turnEndArm('nation.water:7:right', ['UNDODGE'], 'turn ended with the foe soaked', (B, s) =>
    foeSoaked(B, s),
  ),
  turnEndArm('nation.air:5', ['UNDODGE'], 'acted first', (B, s) => B.fx[s].actedFirstStreak >= 1),
  turnEndArm('bastion:9', ['UNDODGE'], 'acted second', (B, s) => !B.actedFirst[s]),
  turnEndArm(
    'bastion:7:left',
    ['PIERCE'],
    'HP at least 80%',
    (B, s) => B.hp[s] >= lineHp(B, s, HARD_EDGE_HP),
  ),
  turnEndArm(
    'nation.earth:10:right',
    ['UNDODGE', 'PIERCE'],
    'hit three turns running',
    (B, s) => B.fx[s].hitStreak === 3,
  ),
  turnEndArm(
    'nation.fire:10:left',
    ['PIERCE'],
    'foe burned two turn ends',
    (B, s) => foeFx(B, s).burnStreak === 2,
  ),
  turnEndArm(
    'nation.air:10:left',
    ['UNDODGE', 'PIERCE'],
    'acted first two turns running',
    (B, s) => B.fx[s].actedFirstStreak === 2,
  ),
];
/** (d): right after the decrements, on the foe's expiry flags. */
export const TURN_END_D: TurnEndHook[] = [
  turnEndArm(
    'nation.water:5',
    ['GUARANTEED_CRIT'],
    'soak expired',
    (B, s) => foeFx(B, s).soakExpiredThisTurn,
  ),
  turnEndArm(
    'nation.water:7:left',
    ['UNDODGE'],
    'soak expired',
    (B, s) => foeFx(B, s).soakExpiredThisTurn,
  ),
  turnEndArm(
    'nation.fire:8',
    ['GUARANTEED_CRIT'],
    'foe Burn ended',
    (B, s) => foeFx(B, s).burnEndedThisTurn,
  ),
];

// --- conditions the engine evaluates at fixed points (exported for boundary tests) -------------

/** 1/battle same-action sources whose own row says "spent only if the action lands"; every other
 * 1/battle source is spent only when it changes an outcome (spec 1.3). */
export const SPEND_ON_LAND: ReadonlySet<string> = new Set(['tempo:7:left']);

/** `bastion:3` Quartermaster (spec 1.4): at turn-2 pick time own HP at least 70% and above the
 * foe's; neither the finisher nor the drawn move is a Charge, Priority or true-hit move (charge
 * telegraph, speed roll and dodge draw), and both share the move type and the Burn effect (the
 * ignite and soak draws), so the swap never changes which draws the turn makes. */
export function quartermasterSwaps(
  B: TreeBattle,
  side: Side,
  drawn: Move,
  finisher: Move,
): boolean {
  const drawFree = (m: Move) =>
    m.effect !== 'charge' && m.effect !== 'priority' && m.effect !== 'true_hit';
  return (
    B.hp[side] >= lineHp(B, side, QUARTERMASTER_HP) &&
    frac(B, side) > frac(B, other(side)) &&
    drawFree(drawn) &&
    drawFree(finisher) &&
    drawn.type === finisher.type &&
    (drawn.effect === 'burn') === (finisher.effect === 'burn')
  );
}

/** `tempo:2` Initiative Read (3e): both sides picked Priority (checked by the engine) and the
 * owner's live SPD is at least the foe's (`INITIATIVE_READ_RATIO`); a tie of two readers reads
 * nothing (the engine checks it). */
export const readHolds = (B: TreeBattle, owner: Side): boolean =>
  B.liveSpd(owner) >= INITIATIVE_READ_RATIO * B.liveSpd(other(owner));

/** `bastion:10:left` Long Haul (owner `ac.foe`): a crit while the owner's HP is above the
 * `LONG_HAUL_LINE` (60%) line. Deliberate deviation from the spec's "above the foe's HP", which
 * Keel (same condition, earlier, on its prerequisite chain) always pre-empted. */
export const longHaulHolds = (B: TreeBattle, ac: TreeAct): boolean =>
  ac.crit && B.hp[ac.foe] > lineHp(B, ac.foe, LONG_HAUL_LINE);

/** `strike:7:left` Bleed Line (tuning redesign, step D2): the owner landed a direct hit this turn
 * and its move DEF-down on the foe would run out at this turn's decrement. */
export const bleedLineHolds = (B: TreeBattle, foe: Side): boolean => {
  const st = B.fx[foe];
  return (
    B.fx[other(foe)].landedDirectThisTurn &&
    st.defDownTurns > 0 &&
    st.defDownFromMove &&
    st.defDownTurns < 2
  );
};

/** `ward:8` Second Skin: half the largest direct hit taken this turn, capped at `SECOND_SKIN_MAX`,
 * when that hit was worth at least `SECOND_SKIN_HIT`; 0 otherwise. */
export function secondSkinHeal(B: TreeBattle, side: Side): number {
  const hit = B.fx[side].maxHitTakenThisTurn;
  if (hit < lineHp(B, side, SECOND_SKIN_HIT) || hit <= 0) return 0;
  return Math.min(Math.floor(hit / 2), lineHp(B, side, SECOND_SKIN_MAX));
}

/** `ward:11` Recovery Cycle: a hit or tick this turn left HP below 35%; heals
 * `RECOVERY_CYCLE_HEAL` of max HP. */
export const recoveryCycleHeal = (B: TreeBattle, side: Side): number =>
  B.fx[side].fellBelowRecoveryLine ? Math.max(1, lineHp(B, side, RECOVERY_CYCLE_HEAL)) : 0;

/** `tempo:10:right` Order Snap arms after two consecutive acted-first turns (counted at (b)). */
export const orderSnapArms = (B: TreeBattle, side: Side): boolean =>
  B.fx[side].orderSnapCount >= ORDER_SNAP_TURNS;

/** `tempo:12` Initiative arms after `INITIATIVE_ACTED_SECOND_TURNS` acted-second turns in total. */
export const initiativeArms = (B: TreeBattle, side: Side): boolean =>
  B.fx[side].actedSecondCount >= INITIATIVE_ACTED_SECOND_TURNS;

export { statusLabel, nameOf };
