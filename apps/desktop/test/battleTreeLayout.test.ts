import { describe, expect, it } from 'vitest';
import { NATIONS, nationNodes } from '@claude-mons/shared';
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

  // Regression guard: TalentTree (Battles.tsx) derives one column per branch (in nationNodes order,
  // capped at 3) and positions each node with treeNodePosition(columnIndex, tier). This asserts the
  // layout yields a finite, in-range coordinate for EVERY node of EVERY nation -- so the editor can
  // never fail to place a non-earth node (see docs/design/talent-tree.md).
  it('positions every node of every nation on the tree canvas', () => {
    for (const nation of NATIONS) {
      const nodes = nationNodes(nation);
      const branches: string[] = [];
      for (const n of nodes) if (!branches.includes(n.branch)) branches.push(n.branch);
      expect(branches.length, `${nation} branch count`).toBe(3);
      for (const node of nodes) {
        const ci = branches.indexOf(node.branch);
        const { x, y } = treeNodePosition(ci, node.tier);
        expect(Number.isFinite(x), `${node.id} x`).toBe(true);
        expect(Number.isFinite(y), `${node.id} y`).toBe(true);
        expect(BRANCH_X).toContain(x);
        expect(TIER_Y as readonly number[]).toContain(y);
      }
    }
  });
});
