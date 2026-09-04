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

/** Linear stat growth: 4 % of base per level. L1 = base, L26 = 2x, L50 ~ 3x. */
export function statAtLevel(base: number, level: number): number {
  return Math.floor((base * (clampLevel(level) + 24)) / 25);
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
}
