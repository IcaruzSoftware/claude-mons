import { describe, expect, it } from 'vitest';
import {
  BRANCH_X,
  TIER_Y,
  treeNodePosition,
} from '../src/renderer/panel/views/battleTreeLayout.ts';

describe('treeNodePosition', () => {
  it('places tier 1 nearest the trunk and tier 6 (the capstone) at the top', () => {
    expect(treeNodePosition(0, 1).y).toBeGreaterThan(treeNodePosition(0, 6).y);
  });

  it('rises monotonically from tier 1 to tier 6 in every branch column', () => {
    for (let branch = 0; branch < BRANCH_X.length; branch++) {
      const ys = [1, 2, 3, 4, 5, 6].map((tier) => treeNodePosition(branch, tier).y);
      for (let i = 1; i < ys.length; i++) {
        expect(ys[i]).toBeLessThan(ys[i - 1]!);
      }
    }
  });

  it('keeps each branch column at its own fixed x', () => {
    expect(treeNodePosition(0, 3).x).toBe(BRANCH_X[0]);
    expect(treeNodePosition(1, 3).x).toBe(BRANCH_X[1]);
    expect(treeNodePosition(2, 3).x).toBe(BRANCH_X[2]);
  });

  it('matches the raw TIER_Y table', () => {
    for (let tier = 1; tier <= 6; tier++) {
      expect(treeNodePosition(1, tier).y).toBe(TIER_Y[tier - 1]);
    }
  });
});
