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

/** One-line descriptions for the loadout editor's move dropdown. */
export const EFFECT_DESCRIPTIONS: Record<EffectId, string> = {
  priority: 'Acts first this turn, overriding the normal speed roll.',
  crit_up: '+20pp critical-hit chance on this move.',
  drain: 'Heals the user 50% of the damage this move deals.',
  shield_first: 'The first hit this mon takes in the battle is reduced 50% (once per battle).',
  def_down: "Target's DEF -25% for 3 turns; reapplying refreshes the duration, does not stack.",
  burn: 'Target loses 8% max HP at the end of each turn for 3 turns (one instance at a time).',
  true_hit: "Ignores the target's dodge chance.",
  charge: 'Telegraphs for 0 damage this turn, then auto-releases at 2.2x power next turn.',
};

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
 * Per-side, per-battle effect bookkeeping: shield/finisher one-shot flags, `def_down`/`burn` turn
 * counters, and the move pending a forced `charge` release. Generic over the move type so this
 * module never needs to import `packages/shared/src/game/species.ts` (which imports this module
 * for `EffectId`) -- `simulateBattle` instantiates it as `SideEffectState<Move>`.
 */
export interface SideEffectState<TMove> {
  /** `def_down` turns remaining on this mon (0 = inactive). */
  defDownTurns: number;
  /** `burn` turns remaining on this mon (0 = inactive). */
  burnTurns: number;
  /** Whether this mon's loadout carries a `shield_first` move (fixed for the whole battle). */
  hasShieldFirst: boolean;
  /** Whether the once-per-battle `shield_first` reduction has already been consumed. */
  shieldConsumed: boolean;
  /** Whether this mon's once-per-battle finisher (loadout slot 3) has fired yet. */
  finisherUsed: boolean;
  /** A `charge` move telegraphed last turn, pending its forced release this turn. */
  chargePending: TMove | null;
}

export function initSideEffectState<TMove>(hasShieldFirst: boolean): SideEffectState<TMove> {
  return {
    defDownTurns: 0,
    burnTurns: 0,
    hasShieldFirst,
    shieldConsumed: false,
    finisherUsed: false,
    chargePending: null,
  };
}

/** Damage dealt by one end-of-turn burn tick, given the burned mon's max HP. */
export function burnTickDamage(maxHp: number): number {
  return Math.max(0, Math.floor(maxHp * BURN_FRACTION));
}
