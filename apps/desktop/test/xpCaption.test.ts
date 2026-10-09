import { describe, expect, it } from 'vitest';
import { HATCH_XP, levelProgress, xpForLevel } from '@claude-mons/shared';
import { xpCaption } from '../src/common/xpCaption.ts';

describe('xpCaption', () => {
  it('shows "Max level" at level 50 instead of "X / X XP"', () => {
    expect(xpCaption({ ...levelProgress(xpForLevel(50) + 3000), stage: 'adult' })).toBe(
      'Max level',
    );
  });

  it('uses HATCH_XP as the egg denominator, also while the hatch awaits confirmation', () => {
    expect(xpCaption({ ...levelProgress(130), stage: 'egg' })).toBe(
      `130 / ${HATCH_XP} XP to hatch`,
    );
  });

  it('shows progress inside the level otherwise', () => {
    const p = levelProgress(xpForLevel(5) + 10);
    expect(xpCaption({ ...p, stage: 'baby' })).toBe(`10 / ${10 + p.xpToNext} XP`);
  });
});
