/**
 * Phase A of the progression system (docs/design/progression.md): battle stances and the loadout
 * shape that future phases (move pool, talent tree) extend without breaking stored snapshots.
 */
import type { Nation, Stats } from '../types.ts';

/** Battle stance: a rock-paper-scissors triangle of +-18% stat trade-offs. */
export type Stance = 'fury' | 'bulwark' | 'gale';
export const STANCES: readonly Stance[] = ['fury', 'bulwark', 'gale'] as const;

/**
 * Default stance for a mon with no loadout set yet (existing mons predating this migration, and
 * brand-new mons before their first `set-loadout` call). The design doc's Stances table does not
 * name a default; Bulwark is used per CLAUDE.md's Phase A instructions.
 */
export const DEFAULT_STANCE: Stance = 'bulwark';

export function isStance(value: unknown): value is Stance {
  return typeof value === 'string' && (STANCES as readonly string[]).includes(value);
}

interface StanceInfo {
  /** Multiplicative modifiers applied to the mon's level-scaled stats for the whole battle. */
  modifiers: { atk: number; def: number; spd: number };
  /** The stance this one beats (grants the counter bonus against it). */
  beats: Stance;
}

/**
 * Grant/cost magnitudes, tuned by simulation on 2026-09-13 (see docs/design/progression.md Stances
 * and CLAUDE.md's Phase A tuning task). Decoupled on purpose: the grant (what a stance boosts) and
 * the cost (what it gives up) no longer have to be equal and opposite, which is what let the sweep
 * find a much smaller, working pair instead of the original +-18%.
 */
const STANCE_GRANT = 1.02; // +2% to the stance's boosted stat
const STANCE_COST = 0.94; // -6% to the stance's traded-off stat

/**
 * docs/design/progression.md Stances table. Bulwark's cost stat was moved from SPD to ATK (Gale's
 * stays ATK) during the same tuning pass: with the original SPD cost, Bulwark and Gale were the only
 * two stances that never touched the ATK/DEF axis the damage formula actually uses, while Fury
 * touched both (ATK grant *and* DEF cost) -- so pairings involving Fury swung far harder than
 * Bulwark-vs-Gale, no matter how the magnitudes were scaled. Moving Bulwark's cost onto ATK makes
 * all three pairings touch ATK/DEF symmetrically (Fury costs DEF, Bulwark and Gale both cost ATK),
 * which is what let the sweep hit a tight, evenly-spread band. Flavor still reads cleanly: Bulwark
 * and Gale both give up raw power for their specialty (bulk or speed); Fury gives up survivability
 * for power.
 */
export const STANCE_INFO: Record<Stance, StanceInfo> = {
  fury: { modifiers: { atk: STANCE_GRANT, def: STANCE_COST, spd: 1 }, beats: 'gale' },
  bulwark: { modifiers: { atk: STANCE_COST, def: STANCE_GRANT, spd: 1 }, beats: 'fury' },
  gale: { modifiers: { atk: STANCE_COST, def: 1, spd: STANCE_GRANT }, beats: 'bulwark' },
};

/** True when `a` counters `b` (grants `a` the counter bonus for the whole battle). */
export function stanceBeats(a: Stance, b: Stance): boolean {
  return STANCE_INFO[a].beats === b;
}

/**
 * Counter bonus: +2% damage dealt / -2% damage taken for the whole battle, tuned by simulation on
 * 2026-09-13 (down from +-10%; see docs/design/progression.md Stances). Combined with the smaller
 * STANCE_GRANT/STANCE_COST above, this is what lands every stance-counter pairing in the 55-62% band
 * the design doc targets, instead of the 80-97% (and, for one pairing, sub-50%) the original +-18%
 * stat swing plus +-10% counter bonus produced.
 */
export const STANCE_COUNTER_DEALT_MULT = 1.02;
export const STANCE_COUNTER_TAKEN_MULT = 0.98;

/** Applies a stance's stat modifiers. HP is never affected by stance. */
export function applyStanceModifiers(stats: Stats, stance: Stance): Stats {
  const m = STANCE_INFO[stance].modifiers;
  return {
    hp: stats.hp,
    atk: Math.round(stats.atk * m.atk),
    def: Math.round(stats.def * m.def),
    spd: Math.round(stats.spd * m.spd),
  };
}

/**
 * A mon's prepared loadout. Only `stance` is validated/used in Phase A; `moves` (Phase B) and
 * `tree` (Phase C) are already part of the shape so stored snapshots (`battles.*_snapshot`) and the
 * `mons.loadout` column do not need a breaking shape change when those phases ship.
 */
export interface MonLoadout {
  stance?: Stance;
  moves?: string[];
  tree?: Record<string, number>;
}

export type ValidateLoadoutResult =
  { ok: true; loadout: MonLoadout } | { ok: false; reason: string };

/**
 * Pure validation for the `set-loadout` Edge Function. Phase A only accepts `stance`; `moves` and
 * `tree` are deliberately rejected for now rather than silently ignored, so a Phase-B/C client
 * can't be fooled into thinking an unimplemented field took effect. `context` (mon level, nation)
 * is unused today but is already threaded through for the Phase B/C move-pool and talent-budget
 * checks that will need it.
 */
export function validateLoadout(
  input: unknown,
  context: { level: number; nation: Nation },
): ValidateLoadoutResult {
  void context;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'loadout must be an object' };
  }
  const body = input as Record<string, unknown>;
  const loadout: MonLoadout = {};
  if (body.stance !== undefined) {
    if (!isStance(body.stance)) return { ok: false, reason: 'invalid stance' };
    loadout.stance = body.stance;
  }
  if (body.moves !== undefined) return { ok: false, reason: 'moves are not settable yet' };
  if (body.tree !== undefined) return { ok: false, reason: 'talent tree is not settable yet' };
  return { ok: true, loadout };
}
