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

/**
 * `crit_up`: +20 percentage points to this move's crit chance, uncapped by the normal 30% crit
 * ceiling up to `CRIT_UP_MAX` (tuned by simulation on 2026-09-13, see docs/design/progression.md
 * Move pool and effects: against the shared 30% ceiling, a flat +20pp bonus was very often fully
 * wasted -- most matchups' base crit chance already sits well above 10%, so the bonus just hit the
 * same cap the base roll would have anyway, making crit_up nearly worthless next to a sustained
 * effect like `def_down`. Giving it its own, higher ceiling is what makes it a comparable pick).
 */
export const CRIT_UP_BONUS = 0.2;
export const CRIT_UP_MAX = 0.5;
/** `drain`: heals the user this fraction of the damage dealt. */
export const DRAIN_FRACTION = 0.5;
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
export const BURN_FRACTION = 0.08;
/** `burn` duration in turns; a second application while active is ignored (no stacking). */
export const BURN_TURNS = 3;
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
  burn: `Target loses ${Math.round(BURN_FRACTION * 100)}% max HP at the end of each turn for ${BURN_TURNS} turns (one instance at a time).`,
  true_hit: "Ignores the target's dodge chance.",
  charge: `Telegraphs for 0 damage this turn, then auto-releases at ${CHARGE_MULTIPLIER}x power next turn.`,
};

/**
 * Per-side, per-battle effect bookkeeping: shield/finisher one-shot flags, `def_down`/`burn` turn
 * counters, the move pending a forced `charge` release, and (Phase C) the talent-tree state that
 * rides along with them -- a resolved tree's stat/move-upgrade/capstone/passive data is static for
 * the whole battle (`packages/shared/src/game/tree.ts:resolveTree`, computed once in
 * `simulateBattle`), but several of its effects need per-battle, per-turn bookkeeping same as the
 * move effects above (a one-shot consumed flag, an active-until-cleared multiplier, a turn
 * counter). Generic over the move type so this module never needs to import
 * `packages/shared/src/game/species.ts` (which imports this module for `EffectId`) --
 * `simulateBattle` instantiates it as `SideEffectState<Move>`.
 */
export interface SideEffectState<TMove> {
  /** `def_down` turns remaining on this mon (0 = inactive). */
  defDownTurns: number;
  /** Effective DEF multiplier while `defDownTurns > 0`; recomputed on every (re)application so a
   * move-upgrade's +25% magnitude is captured at the moment `def_down` lands. */
  defDownMult: number;
  /** Extra fractional ATK/SPD cut riding along with `defDownTurns` (Earth's Fissure Reckoning /
   * Water's Abyssal Pull capstones); 0 when the attacker has neither. */
  defDownExtraAtkFrac: number;
  defDownExtraSpdFrac: number;
  /** `burn` turns remaining on this mon (0 = inactive); primary instance. */
  burnTurns: number;
  /** Effective per-tick fraction of max HP while `burnTurns > 0` (captures move-upgrade/Wildfire
   * magnitude at the moment `burn` was applied). */
  burnFraction: number;
  /** Fire's Ashen Cascade capstone lets a second `burn` instance stack instead of only refreshing;
   * these two fields are that second, independent instance. */
  burnStackTurns: number;
  burnStackFraction: number;
  /** Whether this mon's loadout carries a `shield_first` move (fixed for the whole battle), and
   * which loadout slot it's in (for move-upgrade lookups when it fires). */
  hasShieldFirst: boolean;
  shieldFirstSlot: 1 | 2 | 3 | null;
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
  /** Whether this mon was hit by a direct action during the turn just completed (Air's Eye of the
   * Storm capstone reads this to decide next turn's order); reset and recomputed every turn. */
  tookDamageLastTurn: boolean;
  /** Shared passive "Ember Heart": still eligible to trigger (one-shot per battle). */
  emberHeartArmed: boolean;
  /** Ember Heart has triggered and its crit-chance bonus is armed for this mon's very next move. */
  emberHeartPending: boolean;
  /** One-shot consumed flags for the once-per-battle capstones/passives. */
  phoenixConsumed: boolean;
  secondBreathConsumed: boolean;
  unmovableConsumed: boolean;
  damageCapConsumed: boolean;
}

export interface SideEffectStateInit {
  hasShieldFirst: boolean;
  shieldFirstSlot: 1 | 2 | 3 | null;
  hasStoneSkin: boolean;
}

export function initSideEffectState<TMove>(init: SideEffectStateInit): SideEffectState<TMove> {
  return {
    defDownTurns: 0,
    defDownMult: DEF_DOWN_MULT,
    defDownExtraAtkFrac: 0,
    defDownExtraSpdFrac: 0,
    burnTurns: 0,
    burnFraction: BURN_FRACTION,
    burnStackTurns: 0,
    burnStackFraction: BURN_FRACTION,
    hasShieldFirst: init.hasShieldFirst,
    shieldFirstSlot: init.shieldFirstSlot,
    shieldConsumed: false,
    hasStoneSkin: init.hasStoneSkin,
    stoneSkinConsumed: false,
    finisherUsed: false,
    chargePending: null,
    deepRootsActive: false,
    tookDamageLastTurn: false,
    emberHeartArmed: true,
    emberHeartPending: false,
    phoenixConsumed: false,
    secondBreathConsumed: false,
    unmovableConsumed: false,
    damageCapConsumed: false,
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

/**
 * Tier-5 move-upgrade node: the equipped move in its branch's loadout slot gets either bonus.
 * Tuned by simulation on 2026-09-13 (down from the design doc's literal +25%/+10%, see
 * docs/design/talent-tree.md Balance targets): the doc's own numbers, combined with the stat
 * nodes and a capstone, made a near-budget-maxed tree beat an empty one ~89% of the time at level
 * 50 against a 60-70% target. Kept proportional to each other (effect magnitude still roughly
 * 2x the power-only bonus) while both shrink.
 */
export const MOVE_UPGRADE_EFFECT_MULT = 1.06;
export const MOVE_UPGRADE_POWER_MULT = 1.03;

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
/**
 * Fire's Phoenix Reborn capstone: chance the once/battle KO-prevention actually triggers. Tuned
 * by simulation on 2026-09-13 (docs/design/talent-tree.md Balance targets, see the trigger site's
 * own comment in `packages/shared/src/battle/battle.ts`): a *guaranteed* save, even shrunk to a
 * minimal HP fraction, still won this capstone's branch ~75% of its branch-vs-branch matchup
 * (40-60% target) -- merely surviving to act again is what wins short battles, regardless of how
 * much HP it survives at, so probability (not magnitude) is the lever that actually works.
 */
export const PHOENIX_TRIGGER_CHANCE = 0.22;
/**
 * Air's Eye of the Storm capstone: chance the "always acts first the turn after taking damage"
 * effect actually triggers on a turn where it would otherwise apply. Tuned by simulation on
 * 2026-09-13 (docs/design/talent-tree.md Balance targets, see the trigger site's own comment in
 * `packages/shared/src/battle/battle.ts`): a *guaranteed* version fires most turns of a real
 * fight (a mon rarely goes a whole turn unhit), beating both sibling branches well above the
 * 40-60% target.
 */
export const EYE_OF_STORM_CHANCE = 0.4;
