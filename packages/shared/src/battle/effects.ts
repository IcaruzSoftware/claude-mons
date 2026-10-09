/**
 * Move effects (docs/design/progression.md Move pool and effects, Phase B). Exactly 8 effects;
 * every move in a species' `movePool` (`packages/shared/src/game/species.ts`) carries exactly one.
 * Magnitudes here are the ones `simulateBattle` (`packages/shared/src/battle/battle.ts`) reads;
 * if a rebalance is needed, tune these numbers (and document it in `docs/design/progression.md`
 * with a "tuned by simulation" note) rather than loosening `packages/shared/test/balance.test.ts`.
 */
export type EffectId =
  'priority' | 'crit_up' | 'drain' | 'shield_first' | 'def_down' | 'burn' | 'true_hit' | 'charge';

export const EFFECT_IDS: readonly EffectId[] = [
  'priority',
  'crit_up',
  'drain',
  'shield_first',
  'def_down',
  'burn',
  'true_hit',
  'charge',
] as const;

export function isEffectId(value: unknown): value is EffectId {
  return typeof value === 'string' && (EFFECT_IDS as readonly string[]).includes(value);
}

// --- magnitudes (docs/design/progression.md Move pool and effects) ----------------------------

/** `crit_up`: +20pp, capped at 60%; tuned alongside defense and reduced crit damage in protocol 7. */
export const CRIT_UP_BONUS = 0.2;
export const CRIT_UP_MAX = 0.6;
/** `drain`: heals the user this fraction of the damage dealt. */
export const DRAIN_FRACTION = 0.3;
/** `shield_first`: reduces the first hit taken by this fraction. */
export const SHIELD_FIRST_REDUCTION = 0.5;
/**
 * `def_down`: multiplies the target's effective DEF while active. Tuned by simulation on
 * 2026-09-13 (down from -25%/0.75, see docs/design/progression.md Move pool and effects): the
 * loadout policy's 80%-slot-2 weighting keeps a refreshing 3-turn `def_down` up almost permanently,
 * so -25% DEF (a +33% damage multiplier, sustained essentially every turn) dwarfed the other slot-2
 * effects (`crit_up`, `drain`, `burn`) it's meant to sit alongside -- e.g. pebblet (def_down) beat
 * same-level sparkit (crit_up) roughly 70% of the time. -12% DEF (a +14% damage multiplier) keeps
 * the mechanic (sustained pressure via a debuff) while landing it in the same range as the other
 * slot-2 effects; see the balance harness's archetype matrix.
 */
export const DEF_DOWN_MULT = 0.88;
/** `def_down` duration in turns; reapplying refreshes rather than stacking. */
export const DEF_DOWN_TURNS = 3;
/** `burn`: end-of-turn damage as a fraction of the burned mon's max HP. */
export const BURN_FRACTION = 0.025;
/** `burn` duration in turns; a second application while active is ignored (no stacking). */
export const BURN_TURNS = 3;
/** Automatic nation traits. Kept below a move's primary effect so loadout choices still matter. */
export const AIR_SPEED_MULT = 1.12;
export const EARTH_DAMAGE_MULT = 0.96;
export const FIRE_IGNITE_CHANCE = 0.12;
export const WATER_SOAK_CHANCE = 0.28;
export const WATER_SOAK_SPEED_MULT = 0.72;
export const WATER_SOAK_TURNS = 2;
/** `charge`: the release turn's power multiplier. */
export const CHARGE_MULTIPLIER = 2.2;

/**
 * One-line descriptions for the loadout editor's move dropdown. Built from the magnitude
 * constants above so the text can never drift from the tuned values again.
 */
export const EFFECT_DESCRIPTIONS: Record<EffectId, string> = {
  priority: 'Acts first this turn, overriding the normal speed roll.',
  crit_up: `+${Math.round(CRIT_UP_BONUS * 100)}pp critical-hit chance on this move.`,
  drain: `Heals the user ${Math.round(DRAIN_FRACTION * 100)}% of the damage this move deals.`,
  shield_first: `The first hit this mon takes in the battle is reduced ${Math.round(SHIELD_FIRST_REDUCTION * 100)}% (once per battle).`,
  def_down: `Target's DEF -${Math.round((1 - DEF_DOWN_MULT) * 100)}% for ${DEF_DOWN_TURNS} turns; reapplying refreshes the duration, does not stack.`,
  burn: `Target loses ${BURN_FRACTION * 100}% max HP at the end of each turn for ${BURN_TURNS} turns (one instance at a time).`,
  true_hit: "Ignores the target's dodge chance.",
  charge: `Telegraphs for 0 damage this turn, then auto-releases at ${CHARGE_MULTIPLIER}x power next turn.`,
};

/**
 * Per-side, per-battle effect bookkeeping: shield/finisher one-shot flags, `def_down`/`burn` turn
 * counters, the move pending a forced `charge` release, and the main-passive state that rides
 * along with them -- a resolved tree is static for the whole battle
 * (`packages/shared/src/game/tree.ts:resolveTree`, computed once in `simulateBattle`), but the
 * passives need per-battle bookkeeping same as the move effects above (a one-shot consumed flag,
 * an active-until-cleared buff). Generic over the move type so this module never needs to import
 * `packages/shared/src/game/species.ts` (which imports this module for `EffectId`) --
 * `simulateBattle` instantiates it as `SideEffectState<Move>`.
 */
export interface SideEffectState<TMove> {
  /** Water's innate soak: remaining *future* turns of reduced speed. */
  soakTurns: number;
  /** `def_down` turns remaining on this mon (0 = inactive). */
  defDownTurns: number;
  /** Effective DEF multiplier while `defDownTurns > 0`, set on every (re)application. */
  defDownMult: number;
  /** `burn` turns remaining on this mon (0 = inactive). */
  burnTurns: number;
  /** Effective per-tick fraction of max HP while `burnTurns > 0` (captures the Wildfire
   * magnitude at the moment `burn` was applied). */
  burnFraction: number;
  /** Whether this mon's loadout carries a `shield_first` move (fixed for the whole battle). */
  hasShieldFirst: boolean;
  /** Whether the once-per-battle `shield_first` reduction has already been consumed. */
  shieldConsumed: boolean;
  /** Shared passive "Stone Skin": independent of `shield_first`, consumed on the same first hit. */
  hasStoneSkin: boolean;
  stoneSkinConsumed: boolean;
  /** Whether this mon's once-per-battle finisher (loadout slot 3) has fired yet. */
  finisherUsed: boolean;
  /** A `charge` move telegraphed last turn, pending its forced release this turn. */
  chargePending: TMove | null;
  /** Shared passive "Deep Roots": latched true once this mon first drops below the HP threshold;
   * stays true (a permanent DEF buff) for the rest of the battle once triggered. */
  deepRootsActive: boolean;
  /** Shared passive "Ember Heart": still eligible to trigger (one-shot per battle). */
  emberHeartArmed: boolean;
  /** Ember Heart has triggered and its crit-chance bonus is armed for this mon's very next move. */
  emberHeartPending: boolean;
  /** One-shot consumed flag for the Second Breath passive. */
  secondBreathConsumed: boolean;

  // --- talent tree, protocol 14 (talent-tree spec 8.2, addendum 3.1) ---------------------------
  /** Pending payoffs this side holds: at most one per kind, each with its source node and the
   * turn it was armed (expires at TURN_START of `turn + PENDING_EXPIRY_TURNS`). */
  armed: Record<PayoffKind, ArmedPayoff | null>;
  /** Spent once-per-battle caps (node ids). */
  onceFlags: Set<string>;
  /** Once-per-turn caps used this turn: node id -> serial of the action that used it (an action
   * may use its own cap again, e.g. two statuses of one hit). Cleared at TURN_START. */
  turnUsed: Map<string, number>;
  /** `tempo:7` Tempo Lock is armed (a move Burn, or a DEF-down on a low foe, on an acted-first turn). */
  burnApplied: boolean;
  /** On the target: whether its current Burn / DEF-down came from a move's own effect. */
  burnFromMove: boolean;
  defDownFromMove: boolean;
  /** Due flags (spec 1.3): read at ORDER of the next turn. */
  orderSnapDue: boolean;
  /** Acted-first turns counted towards the next Order Snap arming (reset when it arms or clears). */
  orderSnapCount: number;
  initiativeDue: boolean;
  actedSecondCount: number;
  actedFirstStreak: number;
  /** Control rest: this side's action was denied by a tree rule last turn / this turn (node). */
  deniedLastTurn: boolean;
  deniedThisTurn: string | null;
  /** Quartermaster swap (spec 1.4): the forced-finisher flag of the base rule and the turn-2 pick
   * deferred to the base finisher turn. */
  baseFinisherUsed: boolean;
  deferredPick: TMove | null;
  /** `tempo:1` Opening Setup armed by this side's opener status. */
  combo: { status: 'burn' | 'def_down'; moveId: string } | null;
  /** Move ids of this side's consecutive landed actions (last three). */
  landedMoves: string[];
  /** Consecutive landed Priority actions. */
  priorityStreak: number;
  evasionPlanArmed: boolean;
  dodgeLedgerArmed: boolean;
  /** `nation.air:11` Cloud Bank armed by a dodge. */
  cloudBankArmed: boolean;
  /** `nation.air:7:left` Dust Devil armed by a dodge until it fizzles a Priority move. */
  dustDevilArmed: boolean;
  // per-turn facts, reset at TURN_START
  hitThisTurn: boolean;
  landedDirectThisTurn: boolean;
  fellBelowRecoveryLine: boolean;
  maxHitTakenThisTurn: number;
  causedTickThisTurn: boolean;
  burnEndedThisTurn: boolean;
  soakExpiredThisTurn: boolean;
  // battle counters
  directHitsTaken: number;
  // streaks, written at TURN_END (b) only
  hitStreak: number;
  burnStreak: number;
}

/** The three shared booleans a pending payoff can carry (spec 1.2). */
export type PayoffKind = 'UNDODGE' | 'GUARANTEED_CRIT' | 'PIERCE';
export const PAYOFF_KINDS: readonly PayoffKind[] = ['UNDODGE', 'GUARANTEED_CRIT', 'PIERCE'];
export interface ArmedPayoff {
  node: string;
  turn: number;
}

export interface SideEffectStateInit {
  hasShieldFirst: boolean;
  hasStoneSkin: boolean;
}

export function initSideEffectState<TMove>(init: SideEffectStateInit): SideEffectState<TMove> {
  return {
    soakTurns: 0,
    defDownTurns: 0,
    defDownMult: DEF_DOWN_MULT,
    burnTurns: 0,
    burnFraction: BURN_FRACTION,
    hasShieldFirst: init.hasShieldFirst,
    shieldConsumed: false,
    hasStoneSkin: init.hasStoneSkin,
    stoneSkinConsumed: false,
    finisherUsed: false,
    chargePending: null,
    deepRootsActive: false,
    emberHeartArmed: true,
    emberHeartPending: false,
    secondBreathConsumed: false,
    armed: { UNDODGE: null, GUARANTEED_CRIT: null, PIERCE: null },
    onceFlags: new Set(),
    turnUsed: new Map(),
    burnApplied: false,
    burnFromMove: false,
    defDownFromMove: false,
    orderSnapDue: false,
    orderSnapCount: 0,
    initiativeDue: false,
    actedSecondCount: 0,
    actedFirstStreak: 0,
    deniedLastTurn: false,
    deniedThisTurn: null,
    baseFinisherUsed: false,
    deferredPick: null,
    combo: null,
    landedMoves: [],
    priorityStreak: 0,
    evasionPlanArmed: false,
    dodgeLedgerArmed: false,
    cloudBankArmed: false,
    dustDevilArmed: false,
    hitThisTurn: false,
    landedDirectThisTurn: false,
    fellBelowRecoveryLine: false,
    maxHitTakenThisTurn: 0,
    causedTickThisTurn: false,
    burnEndedThisTurn: false,
    soakExpiredThisTurn: false,
    directHitsTaken: 0,
    hitStreak: 0,
    burnStreak: 0,
  };
}

/** Damage dealt by one end-of-turn burn tick, given the burned mon's max HP and the effective
 * per-tick fraction (defaults to the base `BURN_FRACTION` for a caller with no upgrade/passive). */
export function burnTickDamage(maxHp: number, fraction: number = BURN_FRACTION): number {
  return Math.max(0, Math.floor(maxHp * fraction));
}

// --- talent tree magnitudes (docs/design/talent-tree.md; Phase C) -----------------------------
// Wired in packages/shared/src/battle/battle.ts. Node structure/budget/prereqs live in
// packages/shared/src/game/tree.ts; these are only the numbers `simulateBattle` reads.

/** Shared passive "Stone Skin": reduces the first hit taken each battle (stacks multiplicatively
 * with a `shield_first` move's own reduction, since they are independent sources). */
export const STONE_SKIN_REDUCTION = 0.25;
/** Shared passive "Deep Roots": DEF bonus once below the HP threshold, for the rest of the battle. */
export const DEEP_ROOTS_DEF_BONUS = 0.2;
export const DEEP_ROOTS_HP_THRESHOLD = 0.25;
/** Shared passive "Wildfire": bonus to a burn *this mon inflicts* (extra fraction of max HP per
 * tick, on top of BURN_FRACTION) and its extra duration in turns. */
export const WILDFIRE_BURN_BONUS_FRACTION = BURN_FRACTION * 0.3;
export const WILDFIRE_BURN_EXTRA_TURNS = 1;
/** Shared passive "Tidal Recovery": heal this fraction of max HP on landing a crit. */
export const TIDAL_RECOVERY_HEAL_FRACTION = 0.1;
/** Shared passive "Ember Heart": crit-chance bonus on the first move after dropping below the
 * threshold (one-shot per battle). */
export const EMBER_HEART_HP_THRESHOLD = 0.5;
export const EMBER_HEART_CRIT_BONUS = 0.2;
/** Shared passive "Second Breath": HP left after surviving the one KO-preventing hit per battle. */
export const SECOND_BREATH_HP = 1;

// --- protocol-14 talent tree magnitudes (talent-tree spec 8.2) -------------------------------
// Node-specific HP lines (50%, 40%, 35%, 25%, 15%, 80%, 75%) live with the node rules in
// packages/shared/src/battle/treeRules.ts.

/** A pending payoff expires if not consumed within this many turns of arming. */
export const PENDING_EXPIRY_TURNS = 2;
/** `ward:4` Bulwark Pulse and `bastion:3:alt` Hold the Line clamp lines (fraction of max HP). */
export const CLAMP_PULSE_LINE = 0.5;
export const CLAMP_HOLD_LINE = 0.25;
/** `ward:6` Lastline: HP left (fraction of max HP) instead of a knockout. */
export const LASTLINE_HP = 0.08;
/** `ward:12` Bulwark Cap: one direct hit is capped at this fraction of max HP. */
export const BULWARK_CAP = 0.5;
/** `bastion:5` Anchor: own live SPD must be at least this fraction of the foe's. */
export const ANCHOR_SPD_RATIO = 0.9;
/** `tempo:2` Initiative Read: own live SPD must be at least this multiple of the foe's. */
export const INITIATIVE_READ_RATIO = 1.0;
/** `tempo:12` Initiative: acted-second turns needed to arm. */
export const INITIATIVE_ACTED_SECOND_TURNS = 2;
/** `tempo:10:right` Order Snap: consecutive acted-first turns needed to arm. */
export const ORDER_SNAP_TURNS = 2;

// --- nation column magnitudes (nation addendum 9.2) -------------------------------------------
// Read by the nation rules in packages/shared/src/battle/treeRules.ts; constants so the balance
// harness can read them. Clamp lines must stay strictly ordered (addendum 8.2).

/** Crit multipliers that replace 1.75x under the one-factor rule (addendum 3.3). */
export const KINDLING_MULT = 2.1;
export const PYRE_LORD_MULT = 2.4;
export const CONTINENT_MULT = 1.8;
export const STRATOSPHERE_MULT = 1.9;
/** Clamp lines (fraction of max HP): Rootwork, Tectonic, Terrace, Brine Skin. */
export const ROOTWORK_HP_LINE = 0.2;
export const TECTONIC_HP_LINE = 0.28;
export const TERRACE_HP_LINE = 0.4;
export const BRINE_HP_LINE = 0.5;
/** Air speed-lead gates (`spdLead`, addendum 2 item 7). `LIFT_SPD_RATIO` is read by Lift,
 * Headwind, Tailwind Crown, Ridge and Sovereign Wind. */
export const LIFT_SPD_RATIO = 1.1;
export const LEE_SHORE_SPD_RATIO = 1.05;
export const GUST_LINE_SPD_RATIO = 1.1;
export const STRATOSPHERE_SPD_RATIO = 1.12;
