/**
 * Talent tree (Phase C of docs/design/progression.md; full node tables and rules live in
 * docs/design/talent-tree.md). Pure data + pure validation only; battle-effect wiring for the
 * nodes this phase actually implements (stat nodes, the 10 shared passives, move-upgrade and
 * capstone nodes) lives in packages/shared/src/battle/battle.ts and .../effects.ts.
 *
 * Two independent point pools, both spent via the same `Record<nodeId, rank>` map
 * (`MonLoadout.tree`):
 *  - the mon's own nation's 3 branches x 6 tiers (18 nodes/nation, 72 total), id shape
 *    `${nation}:${branchSlug}:${tier}`, budget `pointsAvailable(level)`;
 *  - 10 nation-agnostic shared passives, id shape `shared:${slug}`, budget
 *    `sharedPassivePoints(level)` (docs/design/progression.md "occupying their own small pool of
 *    points... exact slotting is a Phase C implementation detail" -- this is that detail).
 *
 * Simplification, disclosed here and in docs/design/talent-tree.md: the design doc's tier-2
 * "rank 3 may instead be +2pp crit/dodge" alternative is not modeled (no per-rank choice storage
 * exists in `Record<nodeId, rank>`); tier 2's 3rd rank always grants the stat bonus. Tier-3/4
 * per-branch nodes are spendable (validated, prereq-gated, budgeted) but their unique flavor
 * effects are not wired into `simulateBattle` this phase -- same "structural now, wired later"
 * pattern already used for move renaming in docs/design/progression.md.
 */
import {
  DEF_DOWN_MULT,
  MOVE_UPGRADE_EFFECT_MULT,
  MOVE_UPGRADE_POWER_MULT,
} from '../battle/effects.ts';
import type { Nation } from '../types.ts';

export type TreeNodeKind = 'stat' | 'passive' | 'moveUpgrade' | 'capstone';
export type StatKey = 'hp' | 'atk' | 'def' | 'spd';
export type LoadoutSlot = 1 | 2 | 3;

/**
 * Per-rank stat bonus for every tier-1/2 stat node. Tuned by simulation on 2026-09-13 (down from
 * the design doc's literal 1.5%, see docs/design/talent-tree.md Balance targets): at 1.5%/rank, a
 * near-budget-maxed tree (6 ranks across the primary stat alone, all 3 branches' move-upgrade
 * nodes, and one capstone) beat an empty tree ~89% of the time at level 50 against a 60-70%
 * target for "+15-20% effective power" -- shrinking this alone only ever inched the maxed side
 * down a couple of points at a time (move-upgrade, applied to every one of the mon's 3 equipped
 * moves at once, turned out to be the dominant term); `MOVE_UPGRADE_EFFECT_MULT`/
 * `MOVE_UPGRADE_POWER_MULT` (`packages/shared/src/battle/effects.ts`) needed shrinking alongside
 * it. See `packages/shared/test/balance.test.ts`'s talent-tree matrix for the numbers that
 * confirmed the combination (~67% maxed-vs-empty, every branch pair 40-60%).
 */
export const STAT_PCT_PER_RANK = 0.0033;

/** Capstone effect payloads wired into `simulateBattle`/`effects.ts`. */
export type CapstoneEffect =
  | { kind: 'flatStat'; stat: StatKey; pct: number }
  | { kind: 'critMultiplier'; multiplier: number }
  | { kind: 'defDownAlsoSpd'; fraction: number }
  | { kind: 'defDownAlsoAtk'; fraction: number }
  | { kind: 'critIgnoresGuards' }
  | { kind: 'burnStacks' }
  | { kind: 'phoenix'; hpFraction: number }
  | { kind: 'hitFloor'; floorPct: number }
  | { kind: 'chargeInstant' }
  | { kind: 'actFirstAfterDamage' }
  | { kind: 'damageCap'; capPct: number };

export interface TreeNode {
  /** `${nation}:${branchSlug}:${tier}` for a nation node. */
  id: string;
  nation: Nation;
  branch: string;
  /** loadout slot this branch's move-upgrade node (tier 5) applies to. */
  slot: LoadoutSlot;
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  name: string;
  kind: TreeNodeKind;
  maxRank: number;
  /** points per rank. */
  cost: number;
  description: string;
  /** id of the node in the previous tier of the same branch; null for tier 1. */
  prereqId: string | null;
  /** present only for `kind: 'stat'`. */
  stat?: StatKey;
  /** present only for `kind: 'capstone'`, and only for the ones wired into simulateBattle. */
  capstone?: CapstoneEffect;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface BranchSpec {
  nation: Nation;
  branch: string;
  slot: LoadoutSlot;
  stat: StatKey;
  tier1: string;
  tier2: string;
  /** docs/design/talent-tree.md's tier-2 rank-3 alternative, per branch (not a simple function of
   * `stat` -- e.g. earth's Tremor is an ATK branch whose alt is dodge, not crit, unlike water's
   * Current). Not implemented (see the module doc comment); kept only for tooltip fidelity. */
  tier2Rank3Alt: 'crit' | 'dodge';
  tier3: { name: string; description: string };
  tier4: { name: string; description: string };
  tier5: string;
  tier6: { name: string; description: string; capstone: CapstoneEffect };
}

function buildBranch(spec: BranchSpec): TreeNode[] {
  const branchSlug = slugify(spec.branch);
  const idFor = (tier: number) => `${spec.nation}:${branchSlug}:${tier}`;
  const rank3AltLabel = spec.tier2Rank3Alt === 'crit' ? '+2pp crit chance' : '+2pp dodge chance';
  const statDesc = (rank3Alt: string) =>
    `+${(STAT_PCT_PER_RANK * 100).toFixed(2)}%/rank ${spec.stat.toUpperCase()}, 3 ranks (rank 3 may instead be ${rank3Alt} -- deferred, see docs/design/talent-tree.md).`;
  const nodes: TreeNode[] = [
    {
      id: idFor(1),
      nation: spec.nation,
      branch: spec.branch,
      slot: spec.slot,
      tier: 1,
      name: spec.tier1,
      kind: 'stat',
      maxRank: 3,
      cost: 1,
      description: `+${(STAT_PCT_PER_RANK * 100).toFixed(2)}%/rank ${spec.stat.toUpperCase()}, 3 ranks.`,
      prereqId: null,
      stat: spec.stat,
    },
    {
      id: idFor(2),
      nation: spec.nation,
      branch: spec.branch,
      slot: spec.slot,
      tier: 2,
      name: spec.tier2,
      kind: 'stat',
      maxRank: 3,
      cost: 1,
      description: statDesc(rank3AltLabel),
      prereqId: idFor(1),
      stat: spec.stat,
    },
    {
      id: idFor(3),
      nation: spec.nation,
      branch: spec.branch,
      slot: spec.slot,
      tier: 3,
      name: spec.tier3.name,
      kind: 'passive',
      maxRank: 1,
      cost: 2,
      description: `${spec.tier3.description} (not yet wired into battle simulation -- see docs/design/talent-tree.md).`,
      prereqId: idFor(2),
    },
    {
      id: idFor(4),
      nation: spec.nation,
      branch: spec.branch,
      slot: spec.slot,
      tier: 4,
      name: spec.tier4.name,
      kind: 'passive',
      maxRank: 1,
      cost: 2,
      description: `${spec.tier4.description} (not yet wired into battle simulation -- see docs/design/talent-tree.md).`,
      prereqId: idFor(3),
    },
    {
      id: idFor(5),
      nation: spec.nation,
      branch: spec.branch,
      slot: spec.slot,
      tier: 5,
      name: spec.tier5,
      kind: 'moveUpgrade',
      maxRank: 1,
      cost: 3,
      description: `Loadout slot ${spec.slot} move: +${Math.round((MOVE_UPGRADE_EFFECT_MULT - 1) * 100)}% effect magnitude, or +${Math.round((MOVE_UPGRADE_POWER_MULT - 1) * 100)}% power if that move has no scaling effect.`,
      prereqId: idFor(4),
    },
    {
      id: idFor(6),
      nation: spec.nation,
      branch: spec.branch,
      slot: spec.slot,
      tier: 6,
      name: spec.tier6.name,
      kind: 'capstone',
      maxRank: 1,
      cost: 5,
      description: spec.tier6.description,
      prereqId: idFor(5),
      capstone: spec.tier6.capstone,
    },
  ];
  return nodes;
}

/** `1 - DEF_DOWN_MULT`: the flat fraction a mon's own `def_down` cuts DEF by (docs/design/
 * progression.md Move pool and effects). Water's Abyssal Pull and Earth's Fissure Reckoning
 * capstones both piggyback on this same magnitude ("also cuts target SPD/ATK by the same/half
 * that %"), so it is derived here rather than re-declared as a separate magic number. */
const DEF_DOWN_FRACTION = 1 - DEF_DOWN_MULT;

const BRANCHES: BranchSpec[] = [
  // --- water --------------------------------------------------------------------------------
  {
    nation: 'water',
    branch: 'Current',
    slot: 2,
    stat: 'atk',
    tier1: 'Riverrun',
    tier2: 'Millrace',
    tier2Rank3Alt: 'crit',
    tier3: {
      name: 'Pressure Head',
      description: 'Nation-type moves deal +5% vs. targets above 50% HP',
    },
    tier4: {
      name: 'Spillway',
      description: "This mon's def_down also cuts target SPD 10% for its duration",
    },
    tier5: 'Jetstream Coupling',
    tier6: {
      name: 'Maelstrom',
      description: "This mon's nation-type crits deal 2.5x instead of 2x.",
      capstone: { kind: 'critMultiplier', multiplier: 2.15 },
    },
  },
  {
    nation: 'water',
    branch: 'Undertow',
    slot: 3,
    stat: 'def',
    tier1: 'Backwash',
    tier2: 'Riptide Step',
    tier2Rank3Alt: 'dodge',
    tier3: { name: 'Silt Cloud', description: "This mon's def_down lasts 1 extra turn" },
    tier4: {
      name: 'Undercurrent',
      description: "+5pp dodge chance while target is under this mon's def_down",
    },
    tier5: 'Drift Anchor',
    tier6: {
      name: 'Abyssal Pull',
      description: "This mon's def_down also cuts target SPD by the same %.",
      capstone: { kind: 'defDownAlsoSpd', fraction: DEF_DOWN_FRACTION },
    },
  },
  {
    nation: 'water',
    branch: 'Reservoir',
    slot: 1,
    stat: 'hp',
    tier1: 'Cistern',
    tier2: 'Aquifer',
    tier2Rank3Alt: 'dodge',
    tier3: {
      name: 'Slow Leak',
      description: "This mon's drain moves heal +10% more of damage dealt",
    },
    tier4: {
      name: 'Watershed',
      description:
        'Once/battle, damage that would drop this mon below 20% HP heals 10% max HP first',
    },
    tier5: 'Sluice Control',
    tier6: {
      name: 'Deep Reserve',
      description: 'Max HP +8% flat, stacks with tier 1/2.',
      capstone: { kind: 'flatStat', stat: 'hp', pct: 0.04 },
    },
  },
  // --- fire ---------------------------------------------------------------------------------
  {
    nation: 'fire',
    branch: 'Blaze',
    slot: 2,
    stat: 'atk',
    tier1: 'Flarelight',
    tier2: 'Firebrand',
    tier2Rank3Alt: 'crit',
    tier3: { name: 'Scorchmark', description: 'Crits vs. a burning target deal +10% damage' },
    tier4: { name: 'Detonation', description: "This mon's crit_up moves gain +5pp crit chance" },
    tier5: 'Forge Temper',
    tier6: {
      name: 'Supernova',
      description: "This mon's crits ignore shield_first/def_down on the target.",
      capstone: { kind: 'critIgnoresGuards' },
    },
  },
  {
    nation: 'fire',
    branch: 'Kindling',
    slot: 3,
    stat: 'atk',
    tier1: 'Spark Catch',
    tier2: 'Smolder',
    tier2Rank3Alt: 'crit',
    tier3: {
      name: 'Ashfall',
      description: "This mon's burn deals +2% max HP per tick (10% total)",
    },
    tier4: { name: 'Slow Burn', description: "This mon's burn duration +1 turn" },
    tier5: 'Tinder Box',
    tier6: {
      name: 'Ashen Cascade',
      description: "This mon's burn may stack a second instance instead of only refreshing.",
      capstone: { kind: 'burnStacks' },
    },
  },
  {
    nation: 'fire',
    branch: 'Backdraft',
    slot: 1,
    stat: 'def',
    tier1: 'Firebreak',
    tier2: 'Ember Ward',
    tier2Rank3Alt: 'dodge',
    tier3: {
      name: 'Flashover',
      description: "This mon's shield_first reduces the first hit 60% instead of 50%",
    },
    tier4: {
      name: 'Rekindle Surge',
      description: "The turn after taking a crit, this mon's next hit deals +15%",
    },
    tier5: 'Heat Shield',
    tier6: {
      name: 'Phoenix Reborn',
      description:
        // Tuned by simulation on 2026-09-13 (docs/design/talent-tree.md Balance targets): the
        // design doc's literal "...with its next hit a guaranteed crit" made this branch beat
        // its sibling Blaze 85-95% of the time in the branch-vs-branch matrix (40-60% target);
        // the guaranteed-crit follow-up is dropped (see packages/shared/src/battle/battle.ts).
        'Once/battle, a KO instead leaves this mon at 5% HP.',
      capstone: { kind: 'phoenix', hpFraction: 0.05 },
    },
  },
  // --- earth --------------------------------------------------------------------------------
  {
    nation: 'earth',
    branch: 'Tremor',
    slot: 2,
    stat: 'atk',
    tier1: 'Fault Crack',
    tier2: 'Shockwave Step',
    tier2Rank3Alt: 'dodge',
    tier3: { name: 'Ground Shatter', description: "This mon's def_down cuts an extra 5pp DEF" },
    tier4: {
      name: 'Resonant Crack',
      description: "Landing a crit refreshes this mon's active def_down on the target",
    },
    tier5: 'Seismic Brace',
    tier6: {
      name: 'Fissure Reckoning',
      description: "This mon's def_down also cuts target ATK by half that %.",
      capstone: { kind: 'defDownAlsoAtk', fraction: DEF_DOWN_FRACTION / 2 },
    },
  },
  {
    nation: 'earth',
    branch: 'Canopy',
    slot: 3,
    stat: 'hp',
    tier1: 'Undergrowth',
    tier2: 'Root Lattice',
    tier2Rank3Alt: 'crit',
    tier3: {
      name: 'Canopy Cover',
      description: "This mon's drain moves heal +10% more of damage dealt",
    },
    tier4: {
      name: 'Mulch Layer',
      description: 'While above 50% HP, incoming def_down lasts 1 fewer turn',
    },
    tier5: 'Grafted Bough',
    tier6: {
      // Tuned by simulation on 2026-09-13 (docs/design/talent-tree.md Balance targets): matching
      // water's Deep Reserve pct exactly (both are flat-HP capstones) left Canopy the weakest of
      // earth's 3 branches (~37% vs Foundation, ~40% vs Tremor, against the 40-60% target) even
      // though water's own HP branch (Reservoir/Deep Reserve) landed in-band at the same pct --
      // earth's other two branches (Tremor's Fissure Reckoning, Foundation's Unmovable) are
      // simply stronger secondary effects than water's, so Canopy needed a larger flat bonus to
      // compensate, not a nation-wide change to the shared Deep-Reserve-style magnitude.
      name: 'Old Growth',
      description: 'Max HP +9% flat, stacks with tier 1/2.',
      capstone: { kind: 'flatStat', stat: 'hp', pct: 0.09 },
    },
  },
  {
    nation: 'earth',
    branch: 'Foundation',
    slot: 1,
    stat: 'def',
    tier1: 'Stoneframe',
    tier2: 'Ironvein',
    tier2Rank3Alt: 'crit',
    tier3: {
      name: 'Load Bearing',
      description: "This mon's shield_first reduces the first hit 60% instead of 50%",
    },
    tier4: {
      name: 'Reinforced Crust',
      description: "After taking a hit, the next hit's damage is reduced 5% (once/battle)",
    },
    tier5: 'Retaining Wall',
    tier6: {
      name: 'Unmovable',
      description: 'A single hit cannot take this mon below 10% max HP (once/battle).',
      capstone: { kind: 'hitFloor', floorPct: 0.1 },
    },
  },
  // --- air ----------------------------------------------------------------------------------
  {
    nation: 'air',
    branch: 'Cyclone',
    slot: 2,
    stat: 'atk',
    tier1: 'Squall Line',
    tier2: 'Downburst',
    tier2Rank3Alt: 'crit',
    tier3: { name: 'Wind Shear', description: "This mon's true_hit moves deal +10% damage" },
    tier4: {
      name: 'Funnel Force',
      description: "This mon's charge release deals +15% additional damage",
    },
    tier5: 'Vortex Edge',
    tier6: {
      name: 'Tempest',
      description: "This mon's charge moves release the same turn, skipping the telegraph.",
      capstone: { kind: 'chargeInstant' },
    },
  },
  {
    nation: 'air',
    branch: 'Cirrus',
    slot: 3,
    stat: 'spd',
    tier1: 'Windrise',
    tier2: 'Jetstream Wing',
    tier2Rank3Alt: 'dodge',
    tier3: {
      name: 'Slipstream',
      description: "This mon's priority moves also grant +5% SPD that turn",
    },
    tier4: {
      name: 'Thermal Lift',
      description: 'When this mon acts first in a turn, its damage +5%',
    },
    tier5: 'Wingtip Trim',
    tier6: {
      name: 'Eye of the Storm',
      description: 'This mon always acts first the turn after it took damage.',
      capstone: { kind: 'actFirstAfterDamage' },
    },
  },
  {
    nation: 'air',
    branch: 'Stratus',
    slot: 1,
    stat: 'def',
    tier1: 'Cloudbank',
    tier2: 'High Pressure',
    tier2Rank3Alt: 'dodge',
    tier3: {
      name: 'Fog Bank',
      description: "This mon's shield_first reduces the first hit 60% instead of 50%",
    },
    tier4: {
      name: 'Static Charge',
      description: 'Being crit grants this mon +10% dodge chance for 1 turn',
    },
    tier5: 'Overcast Veil',
    tier6: {
      name: 'Ceiling Break',
      description:
        "Once/battle, a hit exceeding 40% of this mon's max HP in damage is capped at 40%.",
      capstone: { kind: 'damageCap', capPct: 0.4 },
    },
  },
];

/** All 72 nation nodes (18/nation), keyed by id. Built once at module load. */
export const TREE_NODES: Record<string, TreeNode> = Object.fromEntries(
  BRANCHES.flatMap(buildBranch).map((n) => [n.id, n]),
);

export function nationNodes(nation: Nation): TreeNode[] {
  return Object.values(TREE_NODES).filter((n) => n.nation === nation);
}

// --- shared passives (docs/design/talent-tree.md Shared passives) -------------------------------

export interface SharedPassiveNode {
  /** `shared:${slug}` */
  id: string;
  name: string;
  description: string;
  cost: number;
  /** Always 1 -- a shared passive is either taken or not, no ranks. */
  maxRank: 1;
}

function sharedPassive(name: string, description: string): SharedPassiveNode {
  return { id: `shared:${slugify(name)}`, name, description, cost: 1, maxRank: 1 };
}

export const SHARED_PASSIVE_NODES: readonly SharedPassiveNode[] = [
  sharedPassive('Stone Skin', 'First hit taken each battle is reduced 25%.'),
  sharedPassive('Deep Roots', '+20% DEF once this mon drops below 25% HP.'),
  sharedPassive('Bedrock', 'Immune to critical hits.'),
  sharedPassive('Wildfire', "This mon's burn deals +30% damage and lasts +1 turn."),
  sharedPassive('Aftershock', "This mon's crits also apply def_down."),
  sharedPassive('Tailwind', 'Loadout slot 1 always crits.'),
  sharedPassive('Tidal Recovery', 'Heal 10% max HP on landing a crit.'),
  sharedPassive('Updraft', 'Guaranteed to act first on turn 1.'),
  sharedPassive('Second Breath', 'Survive one KO per battle at 1 HP.'),
  sharedPassive(
    'Ember Heart',
    "The first time this mon's HP drops below 50%, its next move gets +20pp crit chance.",
  ),
];

const SHARED_PASSIVE_BY_ID: Record<string, SharedPassiveNode> = Object.fromEntries(
  SHARED_PASSIVE_NODES.map((n) => [n.id, n]),
);

export function isSharedPassiveId(id: string): boolean {
  return id.startsWith('shared:');
}

// --- point budgets --------------------------------------------------------------------------

/**
 * Nation-tree points: 1/level from level 3 to 50, but the first point lands at level 4 (level 3
 * only unlocks the tree) so the level-50 total is 47, matching docs/design/talent-tree.md.
 */
export function pointsAvailable(level: number): number {
  return Math.max(0, Math.min(level, 50) - 3);
}

/**
 * Shared-passive points: a small, separate pool (docs/design/progression.md notes the exact
 * slotting is a Phase C implementation detail). One pick every 15 levels starting at 15, capped
 * at the full 10-passive roster's realistic budget of 3 -- enough to matter without dwarfing the
 * nation tree's 47-point budget.
 */
export const MAX_SHARED_PASSIVE_POINTS = 3;
export function sharedPassivePoints(level: number): number {
  return Math.min(MAX_SHARED_PASSIVE_POINTS, Math.floor(Math.max(0, level) / 15));
}

/** Points already spent in each pool (ignores unknown/wrong-nation ids rather than throwing, same
 * as `resolveTree` -- used to report `MonState.treePoints`/`sharedPassivePoints` without
 * re-validating a stored tree that was valid when it was written). */
export function treeSpent(
  nation: Nation,
  ranks: Record<string, number> | undefined,
): { nation: number; shared: number } {
  let nationSpent = 0;
  let sharedSpent = 0;
  if (!ranks) return { nation: 0, shared: 0 };
  for (const [id, rank] of Object.entries(ranks)) {
    if (!rank || rank < 1) continue;
    if (isSharedPassiveId(id)) {
      const node = SHARED_PASSIVE_BY_ID[id];
      if (node) sharedSpent += rank * node.cost;
      continue;
    }
    const node = TREE_NODES[id];
    if (node && node.nation === nation) nationSpent += rank * node.cost;
  }
  return { nation: nationSpent, shared: sharedSpent };
}

// --- validation -------------------------------------------------------------------------------

export type TreeErrorCode = 'TREE_UNKNOWN_NODE' | 'TREE_RANK' | 'TREE_PREREQ' | 'TREE_OVER_BUDGET';
export type ValidateTreeResult = { ok: true } | { ok: false; code: TreeErrorCode; reason: string };

function findNode(nation: Nation, id: string): TreeNode | SharedPassiveNode | undefined {
  if (isSharedPassiveId(id)) return SHARED_PASSIVE_BY_ID[id];
  const node = TREE_NODES[id];
  return node && node.nation === nation ? node : undefined;
}

/**
 * Pure validation for `set-loadout`: every node exists (for this mon's nation, or the shared
 * pool), every rank is a non-negative integer within the node's `maxRank`, every node's prereq
 * (>=1 rank in the previous tier of the same branch) is met, and the total spent in each pool
 * stays within its budget for `level`.
 */
export function validateTree(
  nation: Nation,
  level: number,
  ranks: Record<string, number>,
): ValidateTreeResult {
  let nationSpent = 0;
  let sharedSpent = 0;
  for (const [id, rank] of Object.entries(ranks)) {
    if (rank === 0) continue;
    if (!Number.isInteger(rank) || rank < 0) {
      return { ok: false, code: 'TREE_RANK', reason: `${id}: rank must be a non-negative integer` };
    }
    const node = findNode(nation, id);
    if (!node)
      return { ok: false, code: 'TREE_UNKNOWN_NODE', reason: `unknown talent node: ${id}` };
    if (rank > node.maxRank) {
      return {
        ok: false,
        code: 'TREE_RANK',
        reason: `${id}: rank ${rank} exceeds max ${node.maxRank}`,
      };
    }
    if ('prereqId' in node && node.prereqId) {
      const prereqRank = ranks[node.prereqId] ?? 0;
      if (prereqRank < 1) {
        return {
          ok: false,
          code: 'TREE_PREREQ',
          reason: `${id} requires at least 1 rank in ${node.prereqId} first`,
        };
      }
    }
    if (isSharedPassiveId(id)) sharedSpent += rank * node.cost;
    else nationSpent += rank * node.cost;
  }
  const nationBudget = pointsAvailable(level);
  if (nationSpent > nationBudget) {
    return {
      ok: false,
      code: 'TREE_OVER_BUDGET',
      reason: `spent ${nationSpent} nation talent points, only ${nationBudget} available at level ${level}`,
    };
  }
  const sharedBudget = sharedPassivePoints(level);
  if (sharedSpent > sharedBudget) {
    return {
      ok: false,
      code: 'TREE_OVER_BUDGET',
      reason: `spent ${sharedSpent} shared passive points, only ${sharedBudget} available at level ${level}`,
    };
  }
  return { ok: true };
}

/**
 * True when going from `prev` to `next` lowers any node's rank -- the design doc's respec
 * definition ("a respec is any change that lowers a node's rank"), checked by `validateLoadout`
 * against the free-below-level-10 / once-per-7-days rule.
 */
export function isRespec(prev: Record<string, number>, next: Record<string, number>): boolean {
  for (const [id, prevRank] of Object.entries(prev)) {
    if ((next[id] ?? 0) < prevRank) return true;
  }
  return false;
}

/** `{ branch: { nodeName: rank } }` grouping for a snapshot/UI summary of a spent tree. */
export function treeSummary(
  nation: Nation,
  ranks: Record<string, number>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [id, rank] of Object.entries(ranks)) {
    if (!rank) continue;
    const node = findNode(nation, id);
    if (!node) continue;
    const branch = isSharedPassiveId(id) ? 'Shared' : (node as TreeNode).branch;
    (out[branch] ??= {})[node.name] = rank;
  }
  return out;
}

// --- resolved tree (battle-ready summary) ------------------------------------------------------

export interface MoveUpgrade {
  effectMult: number;
  powerMult: number;
}

/** Every shared-passive slug this phase wires into `simulateBattle` (docs/design/talent-tree.md
 * Shared passives); matches `SHARED_PASSIVE_NODES`' slugs 1:1. */
export type SharedPassiveSlug =
  | 'stone-skin'
  | 'deep-roots'
  | 'bedrock'
  | 'wildfire'
  | 'aftershock'
  | 'tailwind'
  | 'tidal-recovery'
  | 'updraft'
  | 'second-breath'
  | 'ember-heart';

/** A mon's tree, reduced to exactly what `simulateBattle` needs: summed stat bonuses, at most one
 * move-upgrade per loadout slot, the active capstone(s), and the set of active shared passives. */
export interface ResolvedTree {
  statBonusPct: Partial<Record<StatKey, number>>;
  moveUpgradeBySlot: Partial<Record<LoadoutSlot, MoveUpgrade>>;
  capstones: CapstoneEffect[];
  sharedPassives: ReadonlySet<SharedPassiveSlug>;
}

const EMPTY_RESOLVED_TREE: ResolvedTree = {
  statBonusPct: {},
  moveUpgradeBySlot: {},
  capstones: [],
  sharedPassives: new Set(),
};

/**
 * Reduces a mon's raw `{ [nodeId]: rank }` tree into the shape `simulateBattle` reads. Pure and
 * cheap enough to call once per side per battle; ignores unknown ids and ids from the wrong
 * nation rather than throwing, since a stored tree should never invalidate an otherwise-playable
 * battle (mirrors `resolveLoadoutMoves`'s "repair, don't throw" stance for stale move ids).
 */
export function resolveTree(
  nation: Nation,
  ranks: Record<string, number> | undefined,
): ResolvedTree {
  if (!ranks) return EMPTY_RESOLVED_TREE;
  const statBonusPct: Partial<Record<StatKey, number>> = {};
  const moveUpgradeBySlot: Partial<Record<LoadoutSlot, MoveUpgrade>> = {};
  const capstones: CapstoneEffect[] = [];
  const sharedPassives = new Set<SharedPassiveSlug>();
  for (const [id, rank] of Object.entries(ranks)) {
    if (!rank || rank < 1) continue;
    if (isSharedPassiveId(id)) {
      if (SHARED_PASSIVE_BY_ID[id])
        sharedPassives.add(id.slice('shared:'.length) as SharedPassiveSlug);
      continue;
    }
    const node = TREE_NODES[id];
    if (!node || node.nation !== nation) continue;
    if (node.kind === 'stat' && node.stat) {
      statBonusPct[node.stat] = (statBonusPct[node.stat] ?? 0) + rank * STAT_PCT_PER_RANK;
    } else if (node.kind === 'moveUpgrade') {
      moveUpgradeBySlot[node.slot] = {
        effectMult: MOVE_UPGRADE_EFFECT_MULT,
        powerMult: MOVE_UPGRADE_POWER_MULT,
      };
    } else if (node.kind === 'capstone' && node.capstone) {
      capstones.push(node.capstone);
    }
  }
  return { statBonusPct, moveUpgradeBySlot, capstones, sharedPassives };
}

/**
 * A plausible default tree for a Wild Mon (bot) at `level`, so bots scale like players instead of
 * always fighting bare: spend points down the mon's first branch (by tier) until the budget is
 * exhausted, respecting prereqs by construction (this walks tiers 1-6 in order).
 */
export function defaultBotTree(nation: Nation, level: number): Record<string, number> {
  const budget = pointsAvailable(level);
  const ranks: Record<string, number> = {};
  if (budget <= 0) return ranks;
  const branch = nationNodes(nation)
    .filter((n) => n.branch === nationNodes(nation)[0]!.branch)
    .sort((a, b) => a.tier - b.tier);
  let remaining = budget;
  for (const node of branch) {
    if (remaining <= 0) break;
    const affordableRanks = Math.min(node.maxRank, Math.floor(remaining / node.cost));
    if (affordableRanks <= 0) continue;
    ranks[node.id] = affordableRanks;
    remaining -= affordableRanks * node.cost;
  }
  return ranks;
}
