import type { Stage } from '../types.ts';

/** XP needed to hatch. Equals the cumulative XP for level 2, so "hatched" == "level >= 2". */
export const HATCH_XP = 100;
export const MAX_LEVEL = 50;
export const TEEN_LEVEL = 10;
export const ADULT_LEVEL = 25;

/** Cumulative XP required to *reach* level n (level 1 = 0 XP). xpForLevel(n) = 50 * n * (n - 1). */
export function xpForLevel(level: number): number {
  const n = clampLevel(level);
  return 50 * n * (n - 1);
}

/** XP needed to go from level n to n + 1. */
export function xpToNext(level: number): number {
  return 100 * clampLevel(level);
}

/** Closed-form inverse of xpForLevel, capped at MAX_LEVEL. */
export function levelFromXp(totalXp: number): number {
  if (!Number.isFinite(totalXp) || totalXp <= 0) return 1;
  const level = Math.floor((1 + Math.sqrt(1 + totalXp / 12.5)) / 2);
  return Math.min(MAX_LEVEL, Math.max(1, level));
}

export function stageForLevel(level: number): Stage {
  if (level < 2) return 'egg';
  if (level < TEEN_LEVEL) return 'baby';
  if (level < ADULT_LEVEL) return 'teen';
  return 'adult';
}

export function stageForXp(totalXp: number): Stage {
  return stageForLevel(levelFromXp(totalXp));
}

export interface LevelProgress {
  level: number;
  stage: Stage;
  totalXp: number;
  /** XP accumulated inside the current level. */
  xpIntoLevel: number;
  /** XP still needed to reach the next level (0 at MAX_LEVEL). */
  xpToNext: number;
  /** 0..1 progress inside the current level (1 at MAX_LEVEL). */
  fraction: number;
}

export function levelProgress(totalXp: number): LevelProgress {
  const xp = Math.max(0, Math.floor(totalXp));
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  if (level >= MAX_LEVEL) {
    return {
      level,
      stage: stageForLevel(level),
      totalXp: xp,
      xpIntoLevel: xp - base,
      xpToNext: 0,
      fraction: 1,
    };
  }
  const need = xpToNext(level);
  const into = xp - base;
  return {
    level,
    stage: stageForLevel(level),
    totalXp: xp,
    xpIntoLevel: into,
    xpToNext: need - into,
    fraction: Math.min(1, Math.max(0, into / need)),
  };
}

/**
 * Per-stage multiplier layered on top of the linear level scaling (docs/design/progression.md
 * Evolution multipliers). Keyed off `stageForLevel(level)`, not a snapshot's own `stage` field, so
 * it always reflects the level actually passed in. Mirrored in SQL by `recompute_mon`
 * (`supabase/migrations/20260904000000_init.sql`, multiplier added in
 * `supabase/migrations/20260913020000_progression_phase_a.sql`, retuned in
 * `supabase/migrations/20260913030000_progression_tuning.sql`) -- keep the two in sync.
 *
 * Tuned by simulation on 2026-09-13 (down from 1.15/1.30; see docs/design/progression.md Evolution
 * multipliers and Balance targets): the original values made the low-level side of a stage-boundary
 * matchup (level 9 vs. 11, level 24 vs. 26) win only ~27-28% of the time, well outside the 35-65%
 * band the design doc asks for. These smaller multipliers land both boundary matchups at ~40%.
 */
export const STAGE_STAT_MULTIPLIER: Record<Exclude<Stage, 'egg'>, number> = {
  baby: 1.0,
  teen: 1.03,
  adult: 1.06,
};

/** Linear stat growth (2 % of base per level) times the evolution-stage multiplier above. */
export function statAtLevel(base: number, level: number): number {
  const lvl = clampLevel(level);
  const stage = stageForLevel(lvl);
  const mult = stage === 'egg' ? 1 : STAGE_STAT_MULTIPLIER[stage];
  return Math.floor((base * (lvl + 49) * mult) / 50);
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
}
