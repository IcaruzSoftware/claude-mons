import { describe, expect, it } from 'vitest';
import {
  MAX_SHARED_PASSIVE_POINTS,
  SHARED_PASSIVE_NODES,
  TREE_BRANCHES,
  TREE_NODES,
  defaultBotTree,
  equippedMainPassive,
  isRespec,
  nationNodes,
  nodesByBranch,
  normalizeTree,
  pointsAvailable,
  resolveTree,
  sharedNodes,
  sharedPassivePoints,
  singlePurchaseTree,
  treeNodesFor,
  treeSpent,
  treeSummary,
  validateTree,
  type TreeNode,
} from '../src/game/tree.ts';
import { NATIONS } from '../src/types.ts';
import { validateLoadout } from '../src/game/progression.ts';

const COSTS = [1, 1, 2, 2, 3, 5, 4, 5, 5, 6, 6, 7];

/** Every complete route through one 17-node column: one node per tier. */
function routes(column: TreeNode[]): Record<string, number>[] {
  let out: Record<string, number>[] = [{}];
  for (let tier = 1; tier <= 12; tier++) {
    const options = column.filter((n) => n.tier === tier);
    out = out.flatMap((route) => options.map((n) => ({ ...route, [n.id]: 1 })));
  }
  return out;
}

const columns = (): TreeNode[][] => [
  ...(['bastion', 'strike', 'ward', 'tempo'] as const).map((b) =>
    sharedNodes().filter((n) => n.branch === b),
  ),
  ...NATIONS.map((nation) => nationNodes(nation)),
];

describe('tree data', () => {
  it('holds 68 shared nodes, 17 per nation column and 136 unique ids', () => {
    expect(sharedNodes()).toHaveLength(68);
    for (const nation of NATIONS) {
      expect(nationNodes(nation)).toHaveLength(17);
      expect(nationNodes(nation).every((n) => n.nation === nation && n.branch === 'nation')).toBe(
        true,
      );
      expect(treeNodesFor(nation)).toHaveLength(85);
      const byBranch = nodesByBranch(nation);
      expect(Object.keys(byBranch)).toEqual([...TREE_BRANCHES]);
      for (const branch of TREE_BRANCHES) expect(byBranch[branch]).toHaveLength(17);
    }
    expect(sharedNodes().every((n) => n.nation === undefined)).toBe(true);
    const all = [...sharedNodes(), ...NATIONS.flatMap(nationNodes)];
    expect(new Set(all.map((n) => n.id)).size).toBe(136);
    expect(Object.keys(TREE_NODES)).toHaveLength(136);
  });

  it('follows the 12-tier skeleton with forks at tiers 3, 7 and 10', () => {
    for (const column of columns()) {
      for (let tier = 1; tier <= 12; tier++) {
        const options = column.filter((n) => n.tier === tier);
        expect(options).toHaveLength(tier === 3 ? 2 : tier === 7 || tier === 10 ? 3 : 1);
        for (const n of options) {
          expect(n.cost).toBe(COSTS[tier - 1]);
          expect(n.maxRank).toBe(1);
          expect(n.kind).toBe(
            tier === 6 || tier === 12 ? 'capstone' : n.branch === 'bastion' ? 'passive' : 'active',
          );
          expect(n.description.length).toBeGreaterThan(20);
          expect(n.logText.startsWith(`${n.name}: `)).toBe(true);
          if (options.length > 1) expect(n.choiceGroup).toBe(options[0]!.id);
          else expect(n.choiceGroup).toBeUndefined();
        }
        const offsets = options.map((n) => n.choiceOffset ?? 0).sort();
        expect(offsets).toEqual(tier === 3 ? [0, 1] : options.length === 3 ? [-1, 0, 1] : [0]);
      }
    }
  });

  it('resolves every prerequisite inside its own column; tiers 4, 8 and 11 accept any fork pick', () => {
    for (const node of Object.values(TREE_NODES)) {
      const prefix = node.id.split(':')[0]!;
      if (node.tier === 1) {
        expect(node.prereqId).toBeNull();
        continue;
      }
      expect(node.prereqId).toBe(`${prefix}:${node.tier - 1}`);
      const prereqs = node.prereqIds ?? [node.prereqId!];
      for (const id of prereqs) expect(TREE_NODES[id]?.tier).toBe(node.tier - 1);
      expect(prereqs).toHaveLength(
        node.tier === 4 ? 2 : node.tier === 8 || node.tier === 11 ? 3 : 1,
      );
    }
  });

  it('every complete route of every column costs 47 and validates at level 50', () => {
    for (const column of columns()) {
      const all = routes(column);
      expect(all).toHaveLength(18);
      for (const route of all) {
        expect(Object.keys(route).reduce((sum, id) => sum + TREE_NODES[id]!.cost, 0)).toBe(47);
        expect(validateTree(column[0]!.nation ?? 'water', 50, route)).toEqual({ ok: true });
      }
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
  it('grants 1 tree point/level from level 4 (level 3 only unlocks the tree)', () => {
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
    expect(sharedPassivePoints(50)).toBe(MAX_SHARED_PASSIVE_POINTS);
  });
});

describe('validateTree', () => {
  it('accepts an empty tree at any level', () => {
    expect(validateTree('water', 50, {})).toEqual({ ok: true });
  });

  it('rejects unknown ids, including every v13 id', () => {
    for (const id of ['strike:13', 'water:current:1', 'fire:flow:2', 'nation.fire:13']) {
      expect(validateTree('fire', 50, { [id]: 1 })).toMatchObject({
        ok: false,
        code: 'TREE_UNKNOWN_NODE',
      });
    }
  });

  it("accepts the mon's own nation column and rejects another nation's with WRONG_NATION", () => {
    expect(validateTree('water', 50, { 'nation.water:1': 1 })).toEqual({ ok: true });
    expect(validateTree('water', 50, { 'nation.fire:1': 1 })).toMatchObject({
      ok: false,
      code: 'WRONG_NATION',
    });
  });

  it('rejects ranks above 1, negative or non-integer', () => {
    for (const rank of [2, -1, 1.5]) {
      expect(validateTree('water', 50, { 'strike:1': rank })).toMatchObject({
        ok: false,
        code: 'TREE_RANK',
      });
    }
  });

  it('rejects a node whose prerequisite is missing', () => {
    expect(validateTree('water', 50, { 'strike:2': 1 })).toMatchObject({
      ok: false,
      code: 'TREE_PREREQ',
    });
    expect(validateTree('water', 50, { 'strike:1': 1, 'strike:2': 1 })).toEqual({ ok: true });
  });

  it('allows one node per fork at tiers 3, 7 and 10 and merges after each fork', () => {
    const to = (prefix: string, tier: number, picks: Record<number, string>) =>
      Object.fromEntries(
        Array.from({ length: tier }, (_, i) => [`${prefix}:${i + 1}${picks[i + 1] ?? ''}`, 1]),
      );
    const side = to('ward', 11, { 3: ':alt', 7: ':left', 10: ':right' });
    expect(validateTree('earth', 50, side)).toEqual({ ok: true });
    for (const extra of ['ward:3', 'ward:7', 'ward:10:left']) {
      expect(validateTree('earth', 50, { ...side, [extra]: 1 })).toMatchObject({
        ok: false,
        code: 'TREE_CHOICE_LIMIT',
      });
    }
    const nation = to('nation.earth', 4, { 3: ':alt' });
    expect(validateTree('earth', 50, { ...nation, 'nation.earth:3': 1 })).toMatchObject({
      ok: false,
      code: 'TREE_CHOICE_LIMIT',
    });
  });

  it('counts shared and nation-column nodes against one pool', () => {
    const centre = (nodes: TreeNode[]) =>
      Object.fromEntries(nodes.filter((n) => n.tier <= 6 && !n.choiceOffset).map((n) => [n.id, 1]));
    const strike = centre(sharedNodes().filter((n) => n.branch === 'strike'));
    expect(treeSpent('air', strike).nation).toBe(14);
    const both = { ...strike, ...centre(nationNodes('air')) };
    expect(treeSpent('air', both).nation).toBe(28);
    expect(validateTree('air', 31, both)).toEqual({ ok: true });
    expect(validateTree('air', 30, both)).toMatchObject({
      ok: false,
      code: 'TREE_OVER_BUDGET',
    });
  });

  it('requires level 10 for a main passive and allows only one', () => {
    expect(validateTree('fire', 9, { 'shared:stone-skin': 1 })).toMatchObject({
      ok: false,
      code: 'TREE_OVER_BUDGET',
    });
    expect(validateTree('fire', 10, { 'shared:stone-skin': 1 })).toEqual({ ok: true });
    expect(
      validateTree('fire', 50, { 'shared:stone-skin': 1, 'shared:deep-roots': 1 }),
    ).toMatchObject({ ok: false, code: 'TREE_PASSIVE_LIMIT' });
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
});

describe('node data pins', () => {
  const all = [...sharedNodes(), ...NATIONS.flatMap(nationNodes)];
  it('pins name, effect, extraEffect, trigger, cap and flag for all 136 nodes', () => {
    const table = Object.fromEntries(
      all.map((n) => [n.id, [n.name, n.effect, n.extraEffect, n.trigger, n.cap, n.flag]]),
    );
    expect(table).toMatchInlineSnapshot(`
      {
        "bastion:1": [
          "Keel",
          "NOCRIT",
          undefined,
          "crit",
          "battle",
          false,
        ],
        "bastion:10": [
          "Iron Chin",
          "NOCRIT",
          undefined,
          "crit",
          "battle",
          false,
        ],
        "bastion:10:left": [
          "Long Haul",
          "MULTIPLIER",
          undefined,
          "damage",
          "state",
          false,
        ],
        "bastion:10:right": [
          "Overwatch",
          "REFUSE",
          undefined,
          "status",
          "turn",
          false,
        ],
        "bastion:11": [
          "Holdfast",
          "NOCRIT",
          "REFUSE",
          "crit",
          "battle",
          true,
        ],
        "bastion:12": [
          "Ascendance",
          "REFUSE",
          undefined,
          "status",
          "state",
          false,
        ],
        "bastion:2": [
          "Ballast",
          "UNDODGE",
          undefined,
          "dodge",
          "state",
          false,
        ],
        "bastion:3": [
          "Quartermaster",
          "ORDER",
          undefined,
          "pick",
          "battle",
          false,
        ],
        "bastion:3:alt": [
          "Hold the Line",
          "CLAMP",
          undefined,
          "clamp",
          "battle",
          true,
        ],
        "bastion:4": [
          "Stonewall",
          "SKIP_TICK",
          undefined,
          "turn_end",
          "battle",
          true,
        ],
        "bastion:5": [
          "Anchor",
          "ORDER",
          undefined,
          "order",
          "battle",
          true,
        ],
        "bastion:6": [
          "Keystone",
          "UNDODGE",
          undefined,
          "dodge",
          "state",
          false,
        ],
        "bastion:7": [
          "Tough Hide",
          "REFUSE",
          undefined,
          "status",
          "battle",
          true,
        ],
        "bastion:7:left": [
          "Hard Edge",
          "PIERCE",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "bastion:7:right": [
          "Cool Head",
          "NOCRIT",
          undefined,
          "crit",
          "turn",
          false,
        ],
        "bastion:8": [
          "Low Tide",
          "VOID",
          undefined,
          "damage",
          "battle",
          false,
        ],
        "bastion:9": [
          "Sea Legs",
          "UNDODGE",
          undefined,
          "turn_end",
          "pending",
          false,
        ],
        "nation.air:1": [
          "Glide Step",
          "PIERCE",
          undefined,
          "dodge",
          "battle",
          false,
        ],
        "nation.air:10": [
          "Lee Shore",
          "REFUSE",
          undefined,
          "status",
          "turn",
          false,
        ],
        "nation.air:10:left": [
          "Ascent",
          "UNDODGE",
          "PIERCE",
          "turn_end",
          "battle",
          false,
        ],
        "nation.air:10:right": [
          "Gale Shield",
          "PIERCE",
          undefined,
          "dodge",
          "pending",
          false,
        ],
        "nation.air:11": [
          "Cloud Bank",
          "REFUSE",
          undefined,
          "status",
          "battle",
          true,
        ],
        "nation.air:12": [
          "Sovereign Wind",
          "GUARANTEED_CRIT",
          undefined,
          "act_pre",
          "battle",
          true,
        ],
        "nation.air:2": [
          "Lift",
          "UNDODGE",
          undefined,
          "dodge",
          "state",
          false,
        ],
        "nation.air:3": [
          "Headwind",
          "NOCRIT",
          undefined,
          "crit",
          "battle",
          false,
        ],
        "nation.air:3:alt": [
          "Crosswind",
          "GUARANTEED_CRIT",
          undefined,
          "dodge",
          "battle",
          false,
        ],
        "nation.air:4": [
          "Gust Line",
          "PIERCE",
          undefined,
          "act_pre",
          "battle",
          false,
        ],
        "nation.air:5": [
          "Hover",
          "UNDODGE",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "nation.air:6": [
          "Tailwind Crown",
          "REFUSE",
          undefined,
          "status",
          "battle",
          false,
        ],
        "nation.air:7": [
          "Ridge",
          "NOCRIT",
          undefined,
          "crit",
          "battle",
          true,
        ],
        "nation.air:7:left": [
          "Dust Devil",
          "FIZZLE",
          undefined,
          "act_pre",
          "turn",
          false,
        ],
        "nation.air:7:right": [
          "Eddy",
          "PIERCE",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "nation.air:8": [
          "Stratosphere",
          "MULTIPLIER",
          undefined,
          "damage",
          "state",
          false,
        ],
        "nation.air:9": [
          "Thermal Column",
          "GUARANTEED_CRIT",
          undefined,
          "dodge",
          "battle",
          false,
        ],
        "nation.earth:1": [
          "Stand Firm",
          "GUARANTEED_CRIT",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "nation.earth:10": [
          "Hardrock",
          "GUARANTEED_CRIT",
          undefined,
          "act_pre",
          "battle",
          true,
        ],
        "nation.earth:10:left": [
          "Quarry",
          "GUARANTEED_CRIT",
          undefined,
          "act_pre",
          "battle",
          false,
        ],
        "nation.earth:10:right": [
          "Mudslide",
          "UNDODGE",
          "PIERCE",
          "turn_end",
          "battle",
          false,
        ],
        "nation.earth:11": [
          "Terrace",
          "CLAMP",
          undefined,
          "clamp",
          "battle",
          false,
        ],
        "nation.earth:12": [
          "Continent",
          "MULTIPLIER",
          undefined,
          "damage",
          "state",
          false,
        ],
        "nation.earth:2": [
          "Sod",
          "UNDODGE",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "nation.earth:3": [
          "Rootwork",
          "CLAMP",
          undefined,
          "clamp",
          "battle",
          true,
        ],
        "nation.earth:3:alt": [
          "Hardpan",
          "REFUSE",
          undefined,
          "status",
          "battle",
          true,
        ],
        "nation.earth:4": [
          "Strata",
          "PIERCE",
          undefined,
          "turn_end",
          "pending",
          false,
        ],
        "nation.earth:5": [
          "Mantle",
          "VOID",
          undefined,
          "damage",
          "battle",
          false,
        ],
        "nation.earth:6": [
          "Monolith",
          "NOCRIT",
          undefined,
          "crit",
          "battle",
          true,
        ],
        "nation.earth:7": [
          "Tectonic",
          "CLAMP",
          undefined,
          "clamp",
          "battle",
          true,
        ],
        "nation.earth:7:left": [
          "Grounding",
          "FIZZLE",
          undefined,
          "act_pre",
          "battle",
          false,
        ],
        "nation.earth:7:right": [
          "Fault Line",
          "GUARANTEED_CRIT",
          undefined,
          "act_pre",
          "battle",
          true,
        ],
        "nation.earth:8": [
          "Sediment",
          "UNDODGE",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "nation.earth:9": [
          "Silt",
          "REFUSE",
          undefined,
          "status",
          "battle",
          false,
        ],
        "nation.fire:1": [
          "Kindling",
          "MULTIPLIER",
          undefined,
          "damage",
          "state",
          false,
        ],
        "nation.fire:10": [
          "Crucible",
          "GUARANTEED_CRIT",
          undefined,
          "act_pre",
          "battle",
          true,
        ],
        "nation.fire:10:left": [
          "Bellows",
          "PIERCE",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "nation.fire:10:right": [
          "Afterheat",
          "GUARANTEED_CRIT",
          undefined,
          "crit",
          "battle",
          false,
        ],
        "nation.fire:11": [
          "Hot Streak",
          "UNDODGE",
          "PIERCE",
          "hit",
          "battle",
          false,
        ],
        "nation.fire:12": [
          "Pyre Lord",
          "MULTIPLIER",
          undefined,
          "damage",
          "state",
          false,
        ],
        "nation.fire:2": [
          "Fuel Line",
          "UNDODGE",
          undefined,
          "turn_end",
          "pending",
          false,
        ],
        "nation.fire:3": [
          "Kindle Chain",
          "GUARANTEED_CRIT",
          undefined,
          "status",
          "battle",
          false,
        ],
        "nation.fire:3:alt": [
          "Burn-Hardened",
          "NOCRIT",
          undefined,
          "crit",
          "turn",
          false,
        ],
        "nation.fire:4": [
          "Ember Spread",
          "PIERCE",
          undefined,
          "status",
          "battle",
          false,
        ],
        "nation.fire:5": [
          "Heat Tithe",
          "GUARANTEED_CRIT",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "nation.fire:6": [
          "Inferno",
          "PIERCE",
          undefined,
          "act_pre",
          "turn",
          false,
        ],
        "nation.fire:7": [
          "Forge",
          "NOCRIT",
          undefined,
          "crit",
          "turn",
          false,
        ],
        "nation.fire:7:left": [
          "Kiln Skin",
          "REFUSE",
          undefined,
          "status",
          "turn",
          false,
        ],
        "nation.fire:7:right": [
          "Sear",
          "UNDODGE",
          undefined,
          "hit",
          "pending",
          false,
        ],
        "nation.fire:8": [
          "Ash Cloud",
          "GUARANTEED_CRIT",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "nation.fire:9": [
          "Ignition Chain",
          "GUARANTEED_CRIT",
          undefined,
          "status",
          "battle",
          false,
        ],
        "nation.water:1": [
          "Undertow",
          "UNDODGE",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "nation.water:10": [
          "Deep Current",
          "VOID",
          undefined,
          "damage",
          "battle",
          false,
        ],
        "nation.water:10:left": [
          "Undertow Pull",
          "ORDER",
          undefined,
          "order",
          "battle",
          true,
        ],
        "nation.water:10:right": [
          "Wave Break",
          "GUARANTEED_CRIT",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "nation.water:11": [
          "Brine Skin",
          "CLAMP",
          undefined,
          "clamp",
          "battle",
          false,
        ],
        "nation.water:12": [
          "Maelstrom",
          "GUARANTEED_CRIT",
          undefined,
          "crit",
          "battle",
          true,
        ],
        "nation.water:2": [
          "Drag",
          "NOCRIT",
          undefined,
          "crit",
          "turn",
          false,
        ],
        "nation.water:3": [
          "Undercurrent",
          "ORDER",
          undefined,
          "order",
          "turn",
          false,
        ],
        "nation.water:3:alt": [
          "Slack Tide",
          "REFUSE",
          undefined,
          "status",
          "battle",
          true,
        ],
        "nation.water:4": [
          "Undertow Grip",
          "PIERCE",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "nation.water:5": [
          "Release",
          "GUARANTEED_CRIT",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "nation.water:6": [
          "Tidal Lock",
          "PIERCE",
          undefined,
          "act_pre",
          "turn",
          false,
        ],
        "nation.water:7": [
          "Waterlogged",
          "REFUSE",
          undefined,
          "status",
          "turn",
          false,
        ],
        "nation.water:7:left": [
          "Surge",
          "UNDODGE",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "nation.water:7:right": [
          "Cold Current",
          "UNDODGE",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "nation.water:8": [
          "Ebb Flow",
          "PIERCE",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "nation.water:9": [
          "Saturate",
          "GUARANTEED_CRIT",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "strike:1": [
          "Hunter's Eye",
          "GUARANTEED_CRIT",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "strike:10": [
          "Executioner Prep",
          "GUARANTEED_CRIT",
          undefined,
          "act_pre",
          "turn",
          false,
        ],
        "strike:10:left": [
          "Breaker",
          "PIERCE",
          undefined,
          "status",
          "battle",
          false,
        ],
        "strike:10:right": [
          "Retaliation Edge",
          "PIERCE",
          undefined,
          "hit",
          "pending",
          false,
        ],
        "strike:11": [
          "Afterburn",
          "GUARANTEED_CRIT",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "strike:12": [
          "Kill Clock",
          "UNDODGE",
          "PIERCE",
          "hit",
          "battle",
          false,
        ],
        "strike:2": [
          "Opening Volley",
          "PIERCE",
          undefined,
          "act_pre",
          "battle",
          false,
        ],
        "strike:3": [
          "Burn Ledger",
          "UNDODGE",
          undefined,
          "status",
          "battle",
          false,
        ],
        "strike:3:alt": [
          "Cut Short",
          "UNDODGE",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "strike:4": [
          "Shortfuse",
          "PIERCE",
          undefined,
          "hit",
          "pending",
          false,
        ],
        "strike:5": [
          "Execution Window",
          "PIERCE",
          undefined,
          "act_pre",
          "state",
          false,
        ],
        "strike:6": [
          "Coup Rule",
          "MULTIPLIER",
          undefined,
          "damage",
          "battle",
          false,
        ],
        "strike:7": [
          "Pressure Cascade",
          "PIERCE",
          undefined,
          "act_pre",
          "state",
          false,
        ],
        "strike:7:left": [
          "Bleed Line",
          "EXTEND",
          undefined,
          "turn_end",
          "turn",
          false,
        ],
        "strike:7:right": [
          "Opening Gambit",
          "UNDODGE",
          undefined,
          "dodge",
          "state",
          false,
        ],
        "strike:8": [
          "Heavy Hand",
          "MULTIPLIER",
          undefined,
          "damage",
          "state",
          false,
        ],
        "strike:9": [
          "Bloodscent",
          "GUARANTEED_CRIT",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "tempo:1": [
          "Opening Setup",
          "MULTIPLIER",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "tempo:10": [
          "Consecutive Priority",
          "UNDODGE",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "tempo:10:left": [
          "Counter Setup",
          "PIERCE",
          undefined,
          "act_pre",
          "pending",
          false,
        ],
        "tempo:10:right": [
          "Order Snap",
          "ORDER",
          undefined,
          "order",
          "battle",
          true,
        ],
        "tempo:11": [
          "Burst Window",
          "GUARANTEED_CRIT",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "tempo:12": [
          "Initiative",
          "ORDER",
          undefined,
          "order",
          "battle",
          true,
        ],
        "tempo:2": [
          "Initiative Read",
          "ORDER",
          undefined,
          "order",
          "turn",
          false,
        ],
        "tempo:3": [
          "Chain Priority",
          "PIERCE",
          undefined,
          "act_pre",
          "battle",
          false,
        ],
        "tempo:3:alt": [
          "Read the Board",
          "UNDODGE",
          undefined,
          "dodge",
          "turn",
          false,
        ],
        "tempo:4": [
          "Rhythm",
          "GUARANTEED_CRIT",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "tempo:5": [
          "Tempo Edge",
          "PIERCE",
          undefined,
          "act_pre",
          "battle",
          false,
        ],
        "tempo:6": [
          "Flow State",
          "CLEANSE",
          undefined,
          "hit",
          "battle",
          false,
        ],
        "tempo:7": [
          "Tempo Lock",
          "FIZZLE",
          undefined,
          "act_pre",
          "battle",
          false,
        ],
        "tempo:7:left": [
          "Momentum",
          "PIERCE",
          undefined,
          "act_pre",
          "battle",
          false,
        ],
        "tempo:7:right": [
          "Setup Chain",
          "GUARANTEED_CRIT",
          undefined,
          "status",
          "pending",
          false,
        ],
        "tempo:8": [
          "Quick Recovery",
          "SKIP_TICK",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "tempo:9": [
          "Charge Focus",
          "UNDODGE",
          undefined,
          "dodge",
          "state",
          false,
        ],
        "ward:1": [
          "Brace Reflex",
          "NOCRIT",
          undefined,
          "crit",
          "battle",
          false,
        ],
        "ward:10": [
          "Iron Tide",
          "VOID",
          undefined,
          "damage",
          "battle",
          false,
        ],
        "ward:10:left": [
          "Slipstream Guard",
          "REFUSE",
          undefined,
          "status",
          "turn",
          false,
        ],
        "ward:10:right": [
          "Counterfire",
          "GUARANTEED_CRIT",
          undefined,
          "damage",
          "battle",
          false,
        ],
        "ward:11": [
          "Recovery Cycle",
          "HEAL",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "ward:12": [
          "Bulwark Cap",
          "CAP",
          undefined,
          "clamp",
          "battle",
          false,
        ],
        "ward:2": [
          "Riposte Step",
          "UNDODGE",
          undefined,
          "dodge",
          "pending",
          false,
        ],
        "ward:3": [
          "Layered Shell",
          "VOID",
          undefined,
          "damage",
          "battle",
          false,
        ],
        "ward:3:alt": [
          "Dodge Ledger",
          "REFUSE",
          undefined,
          "status",
          "battle",
          false,
        ],
        "ward:4": [
          "Bulwark Pulse",
          "CLAMP",
          undefined,
          "clamp",
          "turn",
          false,
        ],
        "ward:5": [
          "Hard Shell",
          "REFUSE",
          undefined,
          "status",
          "battle",
          false,
        ],
        "ward:6": [
          "Lastline",
          "CLAMP",
          undefined,
          "lethal",
          "battle",
          false,
        ],
        "ward:7": [
          "Layered Plating",
          "REFUSE",
          undefined,
          "status",
          "turn",
          false,
        ],
        "ward:7:left": [
          "Thermal Break",
          "REFUSE",
          undefined,
          "status",
          "battle",
          false,
        ],
        "ward:7:right": [
          "Evasion Plan",
          "NOCRIT",
          undefined,
          "dodge",
          "battle",
          false,
        ],
        "ward:8": [
          "Second Skin",
          "HEAL",
          undefined,
          "turn_end",
          "battle",
          false,
        ],
        "ward:9": [
          "Debt Refusal",
          "REFUSE",
          undefined,
          "status",
          "battle",
          false,
        ],
      }
    `);
  });
  it('flags exactly the 20 once-per-battle ids and has five two-effect nodes', () => {
    expect(
      all
        .filter((n) => n.flag)
        .map((n) => n.id)
        .sort(),
    ).toEqual(
      [
        'bastion:3:alt',
        'bastion:4',
        'bastion:5',
        'bastion:7',
        'bastion:11',
        'tempo:10:right',
        'tempo:12',
        'nation.fire:10',
        'nation.water:3:alt',
        'nation.water:10:left',
        'nation.water:12',
        'nation.earth:3',
        'nation.earth:3:alt',
        'nation.earth:6',
        'nation.earth:7',
        'nation.earth:7:right',
        'nation.earth:10',
        'nation.air:7',
        'nation.air:11',
        'nation.air:12',
      ].sort(),
    );
    expect(
      all
        .filter((n) => n.extraEffect)
        .map((n) => n.id)
        .sort(),
    ).toEqual(
      [
        'strike:12',
        'bastion:11',
        'nation.fire:11',
        'nation.earth:10:right',
        'nation.air:10:left',
      ].sort(),
    );
  });
});

describe('normalizeTree', () => {
  it('flags legacyReset when only a refund happened', () => {
    expect(normalizeTree('water', { 'strike:2': 1 })).toEqual({ tree: {}, legacyReset: true });
  });

  it('pins the fork-conflict survivor', () => {
    const { tree } = normalizeTree('air', {
      'ward:1': 1,
      'ward:2': 1,
      'ward:3': 1,
      'ward:3:alt': 1,
    });
    expect(tree).toEqual({ 'ward:1': 1, 'ward:2': 1, 'ward:3:alt': 1 });
  });
  it('drops every v13 id and flags the legacy reset', () => {
    const v13 = { 'water:current:1': 1, 'water:current:2': 1, 'fire:flow:2': 1, 'air:x:1': 0 };
    expect(normalizeTree('water', v13)).toEqual({ tree: {}, legacyReset: true });
  });

  it("keeps the equipped passive and the own column, drops other nations' columns", () => {
    const stored = {
      'shared:bedrock': 1,
      'shared:aftershock': 1,
      'strike:1': 3,
      'nation.fire:1': 1,
      'nation.water:1': 1,
    };
    expect(normalizeTree('fire', stored)).toEqual({
      tree: { 'shared:bedrock': 1, 'strike:1': 1, 'nation.fire:1': 1 },
      legacyReset: true,
    });
  });

  it('leaves a valid tree untouched apart from clamping ranks', () => {
    const tree = { 'strike:1': 1, 'strike:2': 2, 'nation.earth:1': 1, 'shared:updraft': 1 };
    expect(normalizeTree('earth', tree)).toEqual({
      tree: { 'strike:1': 1, 'strike:2': 1, 'nation.earth:1': 1, 'shared:updraft': 1 },
      legacyReset: false,
    });
    expect(normalizeTree('earth', {})).toEqual({ tree: {}, legacyReset: false });
  });

  it('refunds nodes whose prerequisite was dropped, repeatedly, and resolves fork conflicts', () => {
    const stored = {
      'water:current:1': 1,
      'strike:2': 1,
      'strike:3': 1,
      'strike:4': 1,
      'ward:1': 1,
      'ward:2': 1,
      'ward:3': 1,
      'ward:3:alt': 1,
      'ward:4': 1,
    };
    const { tree, legacyReset } = normalizeTree('air', stored);
    expect(legacyReset).toBe(true);
    expect(Object.keys(tree).filter((id) => id.startsWith('strike'))).toEqual([]);
    expect(tree['ward:1']).toBe(1);
    expect(tree['ward:4']).toBe(1);
    expect(Number(tree['ward:3'] ?? 0) + Number(tree['ward:3:alt'] ?? 0)).toBe(1);
    expect(validateTree('air', 50, tree)).toEqual({ ok: true });
  });
});

describe('isRespec', () => {
  it('does not charge a respec for rank consolidation', () => {
    expect(isRespec({}, { 'strike:1': 1 })).toBe(false);
    expect(isRespec({ 'strike:1': 2 }, { 'strike:1': 1 })).toBe(false);
    expect(isRespec({ 'strike:1': 1 }, {})).toBe(true);
  });

  it('allows reset at any level even after a recent respec', () => {
    expect(
      validateLoadout(
        { tree: {} },
        { level: 30, nation: 'water', speciesId: 'dripple', existingTree: { 'strike:1': 1 } },
      ),
    ).toMatchObject({ ok: true, isRespec: true, loadout: { tree: {} } });
  });
});

it('accepts an old client resending existing multi-ranks but rejects new duplicate purchases', () => {
  const context = {
    level: 30,
    nation: 'water' as const,
    speciesId: 'dripple',
    existingTree: { 'strike:1': 3 },
  };
  expect(validateLoadout({ tree: { 'strike:1': 3, 'strike:2': 1 } }, context)).toMatchObject({
    ok: true,
    isRespec: false,
    loadout: { tree: { 'strike:1': 1, 'strike:2': 1 } },
  });
  expect(
    validateLoadout({ tree: { 'strike:1': 3 } }, { ...context, existingTree: { 'strike:1': 1 } }),
  ).toMatchObject({ ok: false, code: 'TREE_RANK' });
});

describe('treeSpent / treeSummary', () => {
  it('sums the tree pool (shared branches and own column) and the passive pool separately', () => {
    const ranks = {
      'strike:1': 1,
      'strike:2': 1,
      'nation.water:1': 1,
      'nation.fire:1': 1,
      'water:current:1': 1,
      'shared:bedrock': 1,
    };
    expect(treeSpent('water', ranks)).toEqual({ nation: 3, shared: 3 });
  });

  it('groups by branch label, the column under its nation and the passive under Shared', () => {
    const summary = treeSummary('water', {
      'strike:1': 1,
      'nation.water:1': 1,
      'nation.fire:1': 1,
      'shared:bedrock': 1,
    });
    expect(summary).toEqual({
      Strike: { "Hunter's Eye": 1 },
      Water: { Undertow: 1 },
      Shared: { Bedrock: 1 },
    });
  });
});

describe('resolveTree', () => {
  it('returns empty sets for a missing tree', () => {
    const resolved = resolveTree('water', undefined);
    expect(resolved.nodes.size).toBe(0);
    expect(resolved.sharedPassives.size).toBe(0);
  });

  it("keeps shared and own-column nodes, ignores unknown and other nations' ids", () => {
    const resolved = resolveTree('air', {
      'strike:1': 1,
      'nation.air:1': 1,
      'nation.fire:1': 1,
      'air:cyclone:1': 1,
      'ward:1': 0,
      'shared:tailwind': 1,
    });
    expect([...resolved.nodes]).toEqual(['strike:1', 'nation.air:1']);
    expect([...resolved.sharedPassives]).toEqual(['tailwind']);
  });
});

describe('defaultBotTree', () => {
  it('spends nothing before the tree unlocks', () => {
    expect(defaultBotTree('water', 3)).toEqual({});
  });

  it('buys strike:1 to strike:6 tier by tier and never a nation column', () => {
    expect(defaultBotTree('fire', 6)).toEqual({ 'strike:1': 1, 'strike:2': 1 });
    for (const level of [10, 20, 50]) {
      const tree = defaultBotTree('earth', level);
      expect(Object.keys(tree).every((id) => /^strike:[1-6]$/.test(id))).toBe(true);
      expect(treeSpent('earth', tree).nation).toBeLessThanOrEqual(
        Math.min(14, pointsAvailable(level)),
      );
      expect(validateTree('earth', level, tree)).toEqual({ ok: true });
    }
    expect(Object.keys(defaultBotTree('air', 50))).toHaveLength(6);
  });
});
