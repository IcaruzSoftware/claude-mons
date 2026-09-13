import { describe, expect, it } from 'vitest';
import {
  ADULT_LEVEL,
  HATCH_XP,
  MAX_LEVEL,
  TEEN_LEVEL,
  levelFromXp,
  levelProgress,
  stageForLevel,
  stageForXp,
  statAtLevel,
  xpForLevel,
  xpToNext,
} from '../src/game/levels.ts';

describe('level curve', () => {
  it('matches the design table', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(HATCH_XP);
    expect(xpForLevel(TEEN_LEVEL)).toBe(4500);
    expect(xpForLevel(ADULT_LEVEL)).toBe(30000);
    expect(xpForLevel(MAX_LEVEL)).toBe(122500);
  });

  it('xpToNext is the difference between consecutive levels', () => {
    for (let n = 1; n < MAX_LEVEL; n++) {
      expect(xpForLevel(n + 1) - xpForLevel(n)).toBe(xpToNext(n));
    }
  });

  it('levelFromXp inverts xpForLevel at and just below each threshold', () => {
    for (let n = 1; n <= MAX_LEVEL; n++) {
      expect(levelFromXp(xpForLevel(n))).toBe(n);
      if (n > 1) expect(levelFromXp(xpForLevel(n) - 1)).toBe(n - 1);
    }
  });

  it('is monotonic and capped', () => {
    let prev = 1;
    for (let xp = 0; xp <= 130000; xp += 37) {
      const level = levelFromXp(xp);
      expect(level).toBeGreaterThanOrEqual(prev);
      expect(level).toBeLessThanOrEqual(MAX_LEVEL);
      prev = level;
    }
    expect(levelFromXp(10_000_000)).toBe(MAX_LEVEL);
    expect(levelFromXp(-5)).toBe(1);
    expect(levelFromXp(Number.NaN)).toBe(1);
  });
});

describe('stages', () => {
  it('derive from level', () => {
    expect(stageForLevel(1)).toBe('egg');
    expect(stageForLevel(2)).toBe('baby');
    expect(stageForLevel(9)).toBe('baby');
    expect(stageForLevel(10)).toBe('teen');
    expect(stageForLevel(24)).toBe('teen');
    expect(stageForLevel(25)).toBe('adult');
    expect(stageForLevel(50)).toBe('adult');
  });

  it('hatch happens exactly at HATCH_XP', () => {
    expect(stageForXp(HATCH_XP - 1)).toBe('egg');
    expect(stageForXp(HATCH_XP)).toBe('baby');
  });
});

describe('levelProgress', () => {
  it('reports progress inside a level', () => {
    const p = levelProgress(150);
    expect(p.level).toBe(2);
    expect(p.xpIntoLevel).toBe(50);
    expect(p.xpToNext).toBe(150);
    expect(p.fraction).toBeCloseTo(0.25);
  });

  it('saturates at max level', () => {
    const p = levelProgress(200000);
    expect(p.level).toBe(MAX_LEVEL);
    expect(p.xpToNext).toBe(0);
    expect(p.fraction).toBe(1);
  });
});

describe('statAtLevel', () => {
  // Evolution-stage multipliers tuned by simulation on 2026-09-13 (down from 1.15/1.30 to 1.03/
  // 1.06; see docs/design/progression.md Evolution multipliers) -- the larger originals made a
  // stage-boundary matchup (e.g. level 9 vs. 11) win only ~27-28 % for the low side, well outside
  // the design doc's 35-65 % band.
  it('grows 2 % per level before the evolution multiplier: ~1.5x at 26, ~2x at 50', () => {
    // Level 1 is egg (multiplier 1.00): pure level scaling.
    expect(statAtLevel(100, 1)).toBe(100);
    // Level 26 and 50 are adult (x1.06): 1.5x and ~2x level scaling, then x1.06.
    expect(statAtLevel(100, 26)).toBe(159);
    expect(statAtLevel(100, 50)).toBe(209);
  });

  it('applies the evolution-stage multiplier keyed off stageForLevel (docs/design/progression.md)', () => {
    // Baby (x1.00): unchanged from pure level scaling.
    expect(statAtLevel(100, 9)).toBe(Math.floor((100 * (9 + 49)) / 50));
    // Teen (x1.03) right at the threshold.
    expect(statAtLevel(100, 10)).toBe(Math.floor(((100 * (10 + 49)) / 50) * 1.03));
    // Adult (x1.06) right at the threshold.
    expect(statAtLevel(100, 25)).toBe(Math.floor(((100 * (25 + 49)) / 50) * 1.06));
  });
});
