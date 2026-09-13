import { describe, expect, it } from 'vitest';
import {
  MAX_SHARED_PASSIVE_POINTS,
  SHARED_PASSIVE_NODES,
  TREE_NODES,
  defaultBotTree,
  isRespec,
  nationNodes,
  pointsAvailable,
  resolveTree,
  sharedPassivePoints,
  treeSpent,
  treeSummary,
  validateTree,
} from '../src/game/tree.ts';
import { NATIONS } from '../src/types.ts';

describe('tree data', () => {
  it('every nation has exactly 3 branches of 6 tiered nodes', () => {
    for (const nation of NATIONS) {
      const nodes = nationNodes(nation);
      expect(nodes).toHaveLength(18);
      const branches = new Set(nodes.map((n) => n.branch));
      expect(branches.size).toBe(3);
      for (const branch of branches) {
        const tiers = nodes.filter((n) => n.branch === branch).map((n) => n.tier);
        expect(tiers.sort()).toEqual([1, 2, 3, 4, 5, 6]);
      }
    }
  });

  it('every tier-2..6 node requires the previous tier of the same branch', () => {
    for (const node of Object.values(TREE_NODES)) {
      if (node.tier === 1) {
        expect(node.prereqId).toBeNull();
      } else {
        expect(node.prereqId).toBe(`${node.nation}:${node.id.split(':')[1]}:${node.tier - 1}`);
      }
    }
  });

  it('maxing a full nation costs 54 points (47-point budget forces specialization)', () => {
    for (const nation of NATIONS) {
      const total = nationNodes(nation).reduce((sum, n) => sum + n.cost * n.maxRank, 0);
      expect(total).toBe(54);
    }
    expect(pointsAvailable(50)).toBe(47);
  });

  it('has exactly 10 shared passives, each costing 1 point with maxRank 1', () => {
    expect(SHARED_PASSIVE_NODES).toHaveLength(10);
    for (const p of SHARED_PASSIVE_NODES) {
      expect(p.cost).toBe(1);
      expect(p.maxRank).toBe(1);
      expect(p.id.startsWith('shared:')).toBe(true);
    }
  });
});

describe('pointsAvailable / sharedPassivePoints', () => {
  it('grants 1 nation point/level from level 4 (level 3 only unlocks the tree)', () => {
    expect(pointsAvailable(1)).toBe(0);
    expect(pointsAvailable(3)).toBe(0);
    expect(pointsAvailable(4)).toBe(1);
    expect(pointsAvailable(10)).toBe(7);
    expect(pointsAvailable(50)).toBe(47);
    expect(pointsAvailable(999)).toBe(47);
  });

  it('grants shared-passive points every 15 levels, capped at 3', () => {
    expect(sharedPassivePoints(14)).toBe(0);
    expect(sharedPassivePoints(15)).toBe(1);
    expect(sharedPassivePoints(30)).toBe(2);
    expect(sharedPassivePoints(45)).toBe(3);
    expect(sharedPassivePoints(50)).toBe(MAX_SHARED_PASSIVE_POINTS);
  });
});

describe('validateTree', () => {
  it('accepts an empty tree at any level', () => {
    expect(validateTree('water', 50, {})).toEqual({ ok: true });
  });

  it('rejects an unknown node id', () => {
    const r = validateTree('water', 50, { 'water:not-a-branch:1': 1 });
    expect(r).toMatchObject({ ok: false, code: 'TREE_UNKNOWN_NODE' });
  });

  it("rejects a node from a different nation than the mon's own", () => {
    const r = validateTree('water', 50, { 'fire:blaze:1': 1 });
    expect(r).toMatchObject({ ok: false, code: 'TREE_UNKNOWN_NODE' });
  });

  it('rejects a rank above maxRank, and a negative/non-integer rank', () => {
    expect(validateTree('water', 50, { 'water:current:1': 4 })).toMatchObject({
      ok: false,
      code: 'TREE_RANK',
    });
    expect(validateTree('water', 50, { 'water:current:1': -1 })).toMatchObject({
      ok: false,
      code: 'TREE_RANK',
    });
    expect(validateTree('water', 50, { 'water:current:1': 1.5 })).toMatchObject({
      ok: false,
      code: 'TREE_RANK',
    });
  });

  it('rejects a tier-2+ node with no rank in the previous tier', () => {
    const r = validateTree('water', 50, { 'water:current:2': 1 });
    expect(r).toMatchObject({ ok: false, code: 'TREE_PREREQ' });
  });

  it('accepts a valid prereq chain and rejects spending over the level budget', () => {
    const ok = validateTree('water', 50, { 'water:current:1': 3, 'water:current:2': 3 });
    expect(ok).toEqual({ ok: true });
    // Two full branches (18 pts each = 36) plus a 3rd branch's tiers 1-5 (3+3+2+2+3 = 13) = 49,
    // two over the 47-point budget at level 50 -- deterministically over, not just close to it.
    const tooMuch = {
      'water:current:1': 3,
      'water:current:2': 3,
      'water:current:3': 1,
      'water:current:4': 1,
      'water:current:5': 1,
      'water:current:6': 1,
      'water:undertow:1': 3,
      'water:undertow:2': 3,
      'water:undertow:3': 1,
      'water:undertow:4': 1,
      'water:undertow:5': 1,
      'water:undertow:6': 1,
      'water:reservoir:1': 3,
      'water:reservoir:2': 3,
      'water:reservoir:3': 1,
      'water:reservoir:4': 1,
      'water:reservoir:5': 1,
    };
    expect(validateTree('water', 50, tooMuch)).toMatchObject({
      ok: false,
      code: 'TREE_OVER_BUDGET',
    });
  });

  it('validates the shared-passive pool independently of the nation budget', () => {
    const ok = validateTree('fire', 15, { 'shared:stone-skin': 1 });
    expect(ok).toEqual({ ok: true });
    const over = validateTree('fire', 15, {
      'shared:stone-skin': 1,
      'shared:deep-roots': 1,
    });
    expect(over).toMatchObject({ ok: false, code: 'TREE_OVER_BUDGET' });
  });
});

describe('isRespec', () => {
  it("is true only when some node's rank goes down", () => {
    expect(isRespec({}, { 'water:current:1': 1 })).toBe(false);
    expect(isRespec({ 'water:current:1': 2 }, { 'water:current:1': 2 })).toBe(false);
    expect(isRespec({ 'water:current:1': 2 }, { 'water:current:1': 1 })).toBe(true);
    expect(isRespec({ 'water:current:1': 1 }, {})).toBe(true);
  });
});

describe('treeSpent / treeSummary', () => {
  it('sums nation and shared spend separately', () => {
    const ranks = { 'water:current:1': 3, 'water:current:2': 2, 'shared:bedrock': 1 };
    expect(treeSpent('water', ranks)).toEqual({ nation: 5, shared: 1 });
  });

  it('groups a tree by branch (and "Shared" for shared passives)', () => {
    const ranks = { 'water:current:1': 3, 'shared:bedrock': 1 };
    const summary = treeSummary('water', ranks);
    expect(summary.Current).toEqual({ Riverrun: 3 });
    expect(summary.Shared).toEqual({ Bedrock: 1 });
  });
});

describe('resolveTree', () => {
  it('resolves an undefined/empty tree to no bonuses', () => {
    const resolved = resolveTree('water', undefined);
    expect(resolved.statBonusPct).toEqual({});
    expect(resolved.capstones).toEqual([]);
    expect(resolved.sharedPassives.size).toBe(0);
  });

  it('sums stat-node ranks into statBonusPct for the right stat', () => {
    const resolved = resolveTree('water', { 'water:current:1': 3, 'water:current:2': 2 });
    expect(resolved.statBonusPct.atk).toBeGreaterThan(0);
    expect(resolved.statBonusPct.def).toBeUndefined();
  });

  it('collects a move-upgrade node into the right loadout slot', () => {
    const resolved = resolveTree('water', { 'water:current:5': 1 });
    expect(resolved.moveUpgradeBySlot[2]).toBeDefined();
    expect(resolved.moveUpgradeBySlot[1]).toBeUndefined();
  });

  it('collects a capstone node', () => {
    const resolved = resolveTree('water', { 'water:current:6': 1 });
    expect(resolved.capstones).toHaveLength(1);
    expect(resolved.capstones[0]!.kind).toBe('critMultiplier');
  });

  it('ignores an id from a different nation than requested', () => {
    const resolved = resolveTree('water', { 'fire:blaze:1': 3 });
    expect(resolved.statBonusPct).toEqual({});
  });

  it('resolves shared passives regardless of nation', () => {
    const resolved = resolveTree('air', { 'shared:tailwind': 1 });
    expect(resolved.sharedPassives.has('tailwind')).toBe(true);
  });
});

describe('defaultBotTree', () => {
  it('returns an empty tree below the point-earning level', () => {
    expect(defaultBotTree('water', 3)).toEqual({});
  });

  it('spends down the first branch in tier order without exceeding the budget', () => {
    const tree = defaultBotTree('water', 20);
    const budget = pointsAvailable(20);
    const spent = treeSpent('water', tree).nation;
    expect(spent).toBeLessThanOrEqual(budget);
    expect(spent).toBeGreaterThan(0);
    // Every spent node belongs to the same (first) branch.
    const branches = new Set(
      Object.keys(tree).map((id) => nationNodes('water').find((n) => n.id === id)!.branch),
    );
    expect(branches.size).toBe(1);
    // Prereqs are respected (tier 2 only spent because tier 1 has a rank).
    const validation = validateTree('water', 20, tree);
    expect(validation).toEqual({ ok: true });
  });
});
