import { describe, expect, it } from 'vitest';
import {
  MAX_SHARED_PASSIVE_POINTS,
  SHARED_PASSIVE_NODES,
  TREE_NODES,
  defaultBotTree,
  equippedMainPassive,
  isRespec,
  nationNodes,
  pointsAvailable,
  resolveTree,
  sharedPassivePoints,
  singlePurchaseTree,
  treeSpent,
  treeSummary,
  validateTree,
} from '../src/game/tree.ts';
import { NATIONS } from '../src/types.ts';
import { validateLoadout } from '../src/game/progression.ts';

describe('tree data', () => {
  it('every nation has 4 paths with two three-way forks and 12 purchases per route', () => {
    for (const nation of NATIONS) {
      const nodes = nationNodes(nation);
      expect(nodes).toHaveLength(64);
      const branches = new Set(nodes.map((n) => n.branch));
      expect(branches.size).toBe(4);
      expect(nodes.every((node) => node.maxRank === 1)).toBe(true);
      for (const branch of branches) {
        const tiers = nodes
          .filter((n) => n.branch === branch && !n.choiceOffset)
          .map((n) => n.tier);
        expect(tiers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
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

  it('all four paths each support spending the entire 47-point budget', () => {
    for (const nation of NATIONS) {
      const total = nationNodes(nation).reduce((sum, n) => sum + n.cost * n.maxRank, 0);
      expect(total).toBe(268);
    }
    expect(pointsAvailable(50)).toBe(47);
  });

  it('has exactly 10 shared passives, each costing 3 points with maxRank 1', () => {
    expect(SHARED_PASSIVE_NODES).toHaveLength(10);
    for (const p of SHARED_PASSIVE_NODES) {
      expect(p.cost).toBe(3);
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

  it('grants one main-passive budget at level 10, capped at 3', () => {
    expect(sharedPassivePoints(9)).toBe(0);
    expect(sharedPassivePoints(10)).toBe(3);
    expect(sharedPassivePoints(30)).toBe(3);
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
    const ok = validateTree('water', 50, { 'water:current:1': 1, 'water:current:2': 1 });
    expect(ok).toEqual({ ok: true });
    const tooMuch = Object.fromEntries(
      nationNodes('water')
        .filter((node) => !node.choiceOffset)
        .map((node) => [node.id, 1]),
    );
    expect(validateTree('water', 50, tooMuch)).toMatchObject({
      ok: false,
      code: 'TREE_OVER_BUDGET',
    });
  });

  it('unlocks one independent main passive at level 10', () => {
    expect(validateTree('fire', 9, { 'shared:stone-skin': 1 })).toMatchObject({
      ok: false,
      code: 'TREE_OVER_BUDGET',
    });
    expect(validateTree('fire', 10, { 'shared:stone-skin': 1 })).toEqual({ ok: true });
    expect(
      validateTree('fire', 50, { 'shared:stone-skin': 1, 'shared:deep-roots': 1 }),
    ).toMatchObject({ ok: false, code: 'TREE_PASSIVE_LIMIT' });
  });
  it('every combination of fork choices spends all level-50 points within one path', () => {
    for (const nation of NATIONS) {
      const nodes = nationNodes(nation);
      for (const branch of new Set(nodes.map((node) => node.branch))) {
        for (const first of [0, -1, 1])
          for (const second of [0, -1, 1]) {
            const path = nodes
              .filter(
                (node) =>
                  node.branch === branch &&
                  (node.tier === 7
                    ? (node.choiceOffset ?? 0) === first
                    : node.tier === 10
                      ? (node.choiceOffset ?? 0) === second
                      : !node.choiceOffset),
              )
              .sort((a, b) => a.tier - b.tier);
            expect(path).toHaveLength(12);
            for (let level = 4; level <= 50; level++) {
              const ranks: Record<string, number> = {};
              let remaining = pointsAvailable(level);
              for (const node of path) {
                if (remaining < node.cost) break;
                ranks[node.id] = 1;
                remaining -= node.cost;
              }
              expect(validateTree(nation, level, ranks)).toEqual({ ok: true });
              if (level === 50) {
                expect(remaining).toBe(0);
                expect(Object.keys(ranks)).toHaveLength(12);
              }
            }
          }
      }
    }
  });
  it('accepts a side choice as the merge prerequisite and rejects two choices at a fork', () => {
    const core = Object.fromEntries(
      nationNodes('water')
        .filter((n) => n.branch === 'Current' && n.tier <= 6)
        .map((n) => [n.id, 1]),
    );
    const side = { ...core, 'water:current:7:left': 1, 'water:current:8': 1 };
    expect(validateTree('water', 50, side)).toEqual({ ok: true });
    expect(validateTree('water', 50, { ...side, 'water:current:7': 1 })).toMatchObject({
      ok: false,
      code: 'TREE_CHOICE_LIMIT',
    });
    expect(validateTree('water', 50, { ...side, 'water:current:7:left': 0 })).toMatchObject({
      ok: false,
      code: 'TREE_PREREQ',
    });
    expect(resolveTree('water', side).statBonusPct.def).toBeCloseTo(0.006);
  });
  it('keeps only one legacy main passive in UI, budgets and fresh battle resolution', () => {
    const legacy = { 'shared:bedrock': 1, 'shared:aftershock': 1 };
    expect(equippedMainPassive(legacy)).toBe('shared:bedrock');
    expect(singlePurchaseTree(legacy)).toEqual({ 'shared:bedrock': 1 });
    expect(treeSpent('fire', legacy).shared).toBe(3);
    expect([...resolveTree('fire', legacy).sharedPassives]).toEqual(['bedrock']);
    expect(
      validateLoadout(
        { tree: legacy },
        { nation: 'fire', speciesId: 'sparkit', level: 50, existingTree: legacy },
      ),
    ).toMatchObject({ ok: true, loadout: { tree: { 'shared:bedrock': 1 } } });
    expect(
      validateLoadout({ tree: legacy }, { nation: 'fire', speciesId: 'sparkit', level: 50 }),
    ).toMatchObject({ ok: false, code: 'TREE_PASSIVE_LIMIT' });
  });
  // Regression guard: the validator must accept a real, legal allocation for EVERY nation's own
  // tree, not just water/fire. A legal allocation is built the way the loadout editor builds one --
  // walking each branch tier by tier so prereqs are always satisfied -- and spent right up to the
  // level's budget. This locks in that no nation's node ids/branches drift out of what the shared
  // validator accepts (see docs/design/talent-tree.md).
  it('accepts a legal allocation for every nation, spanning all 4 branches', () => {
    const level = 30;
    const budget = pointsAvailable(level);
    for (const nation of NATIONS) {
      const nodes = nationNodes(nation);
      const branches: string[] = [];
      for (const n of nodes) if (!branches.includes(n.branch)) branches.push(n.branch);
      const ranks: Record<string, number> = {};
      let remaining = budget;
      // Round-robin tier 1..6 across the 3 branches so prereqs hold and all branches get spend.
      for (let tier = 1; tier <= 6 && remaining > 0; tier++) {
        for (const branch of branches) {
          const node = nodes.find((n) => n.branch === branch && n.tier === tier);
          if (!node) continue;
          while ((ranks[node.id] ?? 0) < node.maxRank && remaining >= node.cost) {
            ranks[node.id] = (ranks[node.id] ?? 0) + 1;
            remaining -= node.cost;
          }
        }
      }
      const spent = treeSpent(nation, ranks).nation;
      expect(spent, `${nation} should spend under budget`).toBeLessThanOrEqual(budget);
      expect(spent, `${nation} should actually spend points`).toBeGreaterThan(0);
      expect(validateTree(nation, level, ranks), `${nation} allocation rejected`).toEqual({
        ok: true,
      });
    }
  });
});

describe('isRespec', () => {
  it('does not charge a respec for legacy rank consolidation', () => {
    expect(isRespec({}, { 'water:current:1': 1 })).toBe(false);
    expect(isRespec({ 'water:current:1': 2 }, { 'water:current:1': 2 })).toBe(false);
    expect(isRespec({ 'water:current:1': 2 }, { 'water:current:1': 1 })).toBe(false);
    expect(isRespec({ 'water:current:1': 1 }, {})).toBe(true);
  });

  it('allows reset at any level even after a recent respec', () => {
    expect(
      validateLoadout(
        { tree: {} },
        {
          level: 30,
          nation: 'water',
          speciesId: 'dripple',
          existingTree: { 'water:current:1': 1 },
        },
      ),
    ).toMatchObject({ ok: true, isRespec: true, loadout: { tree: {} } });
  });
});

it('accepts an old client resending existing multi-ranks but rejects new duplicate purchases', () => {
  const context = {
    level: 30,
    nation: 'water' as const,
    speciesId: 'dripple',
    existingTree: { 'water:current:1': 3 },
  };
  const oldClient = validateLoadout(
    { tree: { 'water:current:1': 3, 'water:current:2': 1 } },
    context,
  );
  expect(oldClient).toMatchObject({
    ok: true,
    isRespec: false,
    loadout: { tree: { 'water:current:1': 1, 'water:current:2': 1 } },
  });
  expect(
    validateLoadout(
      { tree: { 'water:current:1': 3 } },
      { ...context, existingTree: { 'water:current:1': 1 } },
    ),
  ).toMatchObject({
    ok: false,
    code: 'TREE_RANK',
  });
});

describe('treeSpent / treeSummary', () => {
  it('sums nation and shared spend separately', () => {
    const ranks = { 'water:current:1': 3, 'water:current:2': 2, 'shared:bedrock': 1 };
    expect(treeSpent('water', ranks)).toEqual({ nation: 2, shared: 3 });
  });

  it('groups a tree by branch (and "Shared" for shared passives)', () => {
    const ranks = { 'water:current:1': 3, 'shared:bedrock': 1 };
    const summary = treeSummary('water', ranks);
    expect(summary.Current).toEqual({ Riverrun: 1 });
    expect(summary.Shared).toEqual({ Bedrock: 1 });
  });
  it('converts saved multi-rank allocations without deleting selected talents', () => {
    expect(
      singlePurchaseTree({ 'water:current:1': 3, 'water:current:2': 2, 'shared:bedrock': 0 }),
    ).toEqual({ 'water:current:1': 1, 'water:current:2': 1 });
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
