/** Single-purchase talent trees: three nation branches and one combination branch.
 * Stored legacy ranks resolve as one purchase; surplus rank points become available again.
 * Pure validation and resolution are shared by the client and server. */
import {
  DEF_DOWN_MULT,
  MOVE_UPGRADE_EFFECT_MULT,
  MOVE_UPGRADE_POWER_MULT,
} from '../battle/effects.ts';
import type { Nation } from '../types.ts';

export type TreeNodeKind = 'stat' | 'passive' | 'moveUpgrade' | 'capstone';
export type StatKey = 'hp' | 'atk' | 'def' | 'spd';
export type LoadoutSlot = 1 | 2 | 3;

/** Stat bonus for one tier-1/2 purchase. Low because every branch also grants tactical effects. */
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
  tier: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  name: string;
  kind: TreeNodeKind;
  maxRank: number;
  /** Points for this one-time purchase. */
  cost: number;
  description: string;
  /** id of the node in the previous tier of the same branch; null for tier 1. */
  prereqId: string | null;
  /** Merge after a three-way fork: any one prerequisite is sufficient. */
  prereqIds?: readonly string[];
  /** At most one alternative in each fork may be purchased. */
  choiceGroup?: string;
  /** -1/+1 for side alternatives; original ids are the central route. */
  choiceOffset?: -1 | 1;
  /** present only for `kind: 'stat'`. */
  stat?: StatKey;
  /** Larger late-path stat purchases; early nodes keep STAT_PCT_PER_RANK. */
  statBonusPct?: number;
  /** Passive behavior key consumed by the battle simulator. */
  passive?: string;
  /** Present only for `kind: 'capstone'`. */
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
  tier3: { name: string; description: string };
  tier4: { name: string; description: string };
  tier5: string;
  tier6: { name: string; description: string; capstone: CapstoneEffect };
}

const statName: Record<StatKey, string> = {
  hp: 'max HP',
  atk: 'attack',
  def: 'defense',
  spd: 'speed',
};

/** Two three-way mastery forks, each route retaining the full 47-point level-50 budget. */
function masteryNodes(
  nation: Nation,
  branch: string,
  slot: LoadoutSlot,
  identity: StatKey,
): TreeNode[] {
  const stats: StatKey[] = [identity, 'hp', 'def', 'spd', 'atk', identity];
  const baseId = (tier: number) => `${nation}:${slugify(branch)}:${tier}`;
  const forkIds = (tier: number) => [baseId(tier), `${baseId(tier)}:left`, `${baseId(tier)}:right`];
  return [4, 5, 5, 6, 6, 7].flatMap((cost, index) => {
    const tier = (index + 7) as TreeNode['tier'];
    const fork = tier === 7 || tier === 10;
    const baseStat = stats[index]!;
    const defense: StatKey = baseStat === 'hp' ? 'hp' : 'def';
    const alternatives = (['atk', defense, 'spd'] as StatKey[]).filter((stat) => stat !== baseStat);
    const make = (stat: StatKey, offset?: -1 | 1): TreeNode => {
      const pct = cost * 0.0015;
      const role = stat === 'atk' ? 'Offense' : stat === 'spd' ? 'Tempo' : 'Defense';
      const trait = fork
        ? `mastery-${tier}-${stat}-${slugify(branch)}`
        : `mastery-${tier}-${slugify(branch)}`;
      const effect =
        tier === 7
          ? stat === 'atk'
            ? 'Crit chance rises 2% against healthy foes.'
            : stat === 'spd'
              ? 'Dodge chance rises 2% after you act first.'
              : 'Take 3% less damage from strong element hits.'
          : tier === 8
            ? 'Once per battle, after a turn in which you were hit, heal 3% max HP.'
            : tier === 9
              ? 'Strong element hits deal 5% more damage.'
              : tier === 10
                ? stat === 'atk'
                  ? 'Deal 3% more damage to foes below half HP.'
                  : stat === 'spd'
                    ? 'Crit chance rises 2% when you act first.'
                    : 'Critical hits against you deal 3% less damage.'
                : tier === 11
                  ? 'Once per battle below half HP, heal 3% max HP after a turn.'
                  : 'Your first landed hit each battle deals 6% more damage.';
      return {
        id: offset ? `${baseId(tier)}:${offset === -1 ? 'left' : 'right'}` : baseId(tier),
        nation,
        branch,
        slot,
        tier,
        name: offset
          ? `${branch} ${role}`
          : tier === 12
            ? `${branch} Ascendance`
            : `${branch} ${['Instinct', 'Second Wind', 'Elemental Edge', 'Surge', 'Last Light'][index]}`,
        kind:
          tier === 12 ? 'capstone' : tier === 8 || tier === 9 || tier === 11 ? 'passive' : 'stat',
        maxRank: 1,
        cost,
        description: `${tier === 8 || tier === 9 || tier === 11 ? '' : `+${(pct * 100).toFixed(2)}% ${statName[stat]}. `}${effect}`,
        prereqId: baseId(tier - 1),
        ...(tier === 8 || tier === 11 ? { prereqIds: forkIds(tier - 1) } : {}),
        ...(fork ? { choiceGroup: baseId(tier) } : {}),
        ...(offset ? { choiceOffset: offset } : {}),
        passive: trait,
        ...(tier === 12
          ? { capstone: { kind: 'flatStat' as const, stat, pct } }
          : { stat, statBonusPct: pct }),
      };
    };
    return fork
      ? [make(baseStat), make(alternatives[0]!, -1), make(alternatives[1]!, 1)]
      : [make(baseStat)];
  });
}

export function treePrerequisiteMet(node: TreeNode, ranks: Record<string, number>): boolean {
  return !node.prereqId || (node.prereqIds ?? [node.prereqId]).some((id) => (ranks[id] ?? 0) > 0);
}

/** Selected alternative, if buying this node would conflict with a learned choice. */
export function treeChoiceConflict(
  node: TreeNode,
  ranks: Record<string, number>,
): TreeNode | undefined {
  return node.choiceGroup
    ? nationNodes(node.nation).find(
        (other) =>
          other.id !== node.id &&
          other.choiceGroup === node.choiceGroup &&
          (ranks[other.id] ?? 0) > 0,
      )
    : undefined;
}

function buildBranch(spec: BranchSpec): TreeNode[] {
  const branchSlug = slugify(spec.branch);
  const idFor = (tier: number) => `${spec.nation}:${branchSlug}:${tier}`;
  const nodes: TreeNode[] = [
    {
      id: idFor(1),
      nation: spec.nation,
      branch: spec.branch,
      slot: spec.slot,
      tier: 1,
      name: spec.tier1,
      kind: 'stat',
      maxRank: 1,
      cost: 1,
      description: `+${(STAT_PCT_PER_RANK * 100).toFixed(2)}% ${statName[spec.stat]}.`,
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
      maxRank: 1,
      cost: 1,
      description: `+${(STAT_PCT_PER_RANK * 100).toFixed(2)}% ${statName[spec.stat]}.`,
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
      description: spec.tier3.description,
      passive: slugify(spec.tier3.name),
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
      description: spec.tier4.description,
      passive: slugify(spec.tier4.name),
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
      description: `Your ${['first', 'main', 'finisher'][spec.slot - 1]} move gets a stronger effect, or more damage if it has no effect to boost.`,
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
  return [...nodes, ...masteryNodes(spec.nation, spec.branch, spec.slot, spec.stat)];
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
    tier3: {
      name: 'Pressure Head',
      description: 'Element attacks deal 3% more damage to healthy foes.',
    },
    tier4: {
      name: 'Spillway',
      description: 'Lowering a foe’s defense also slows it by 5%.',
    },
    tier5: 'Jetstream Coupling',
    tier6: {
      name: 'Maelstrom',
      description: 'Critical element attacks hit 1.9× as hard instead of 1.75×.',
      capstone: { kind: 'critMultiplier', multiplier: 1.9 },
    },
  },
  {
    nation: 'water',
    branch: 'Undertow',
    slot: 3,
    stat: 'def',
    tier1: 'Backwash',
    tier2: 'Riptide Step',
    tier3: { name: 'Silt Cloud', description: 'Your defense-lowering effects last one more turn.' },
    tier4: {
      name: 'Undercurrent',
      description: 'Dodge 2.5% more often while the foe has lowered defense.',
    },
    tier5: 'Drift Anchor',
    tier6: {
      name: 'Abyssal Pull',
      description: 'Lowering a foe’s defense also slows it by the same amount.',
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
    tier3: {
      name: 'Slow Leak',
      description: 'Draining attacks heal 4% more of the damage they deal.',
    },
    tier4: {
      name: 'Watershed',
      description: 'Once per battle, heal 3% max HP just before a hit drops you below 20% HP.',
    },
    tier5: 'Sluice Control',
    tier6: {
      name: 'Deep Reserve',
      description: '+4% max HP.',
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
    tier3: {
      name: 'Scorchmark',
      description: 'Critical hits deal 5% more damage to burning foes.',
    },
    tier4: {
      name: 'Detonation',
      description: 'Moves that boost critical hits gain another 3% crit chance.',
    },
    tier5: 'Forge Temper',
    tier6: {
      name: 'Supernova',
      description: 'Your critical hits ignore first-hit shields and lowered defense.',
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
    tier3: {
      name: 'Ashfall',
      description: 'Your burns deal an extra 0.25% max HP each turn.',
    },
    tier4: { name: 'Slow Burn', description: 'Your burns last one more turn.' },
    tier5: 'Tinder Box',
    tier6: {
      name: 'Ashen Cascade',
      description: 'Burning a foe again adds a second burn instead of refreshing it.',
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
    tier3: {
      name: 'Flashover',
      description: 'Your first-hit shield blocks 55% damage instead of 50%.',
    },
    tier4: {
      name: 'Rekindle Surge',
      description: 'After taking a critical hit, your next turn deals 3% more damage.',
    },
    tier5: 'Heat Shield',
    tier6: {
      name: 'Phoenix Reborn',
      description:
        // Tuned by simulation on 2026-09-13 (docs/design/talent-tree.md Balance targets): the
        // design doc's literal "...with its next hit a guaranteed crit" made this branch beat
        // its sibling Blaze 85-95% of the time in the branch-vs-branch matrix (40-60% target);
        // the guaranteed-crit follow-up is dropped (see packages/shared/src/battle/battle.ts).
        'Once per battle, a knockout has a 22% chance to leave you at 5% HP.',
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
    tier3: {
      name: 'Ground Shatter',
      description: 'Your defense-lowering moves cut another 2.5% defense.',
    },
    tier4: {
      name: 'Resonant Crack',
      description: 'A critical hit refreshes lowered defense on the foe.',
    },
    tier5: 'Seismic Brace',
    tier6: {
      name: 'Fissure Reckoning',
      description: 'Lowering a foe’s defense also lowers its attack by half as much.',
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
    tier3: {
      name: 'Canopy Cover',
      description: 'Draining attacks heal 2% more of the damage they deal.',
    },
    tier4: {
      name: 'Mulch Layer',
      description: 'Above half HP, lowered defense wears off one turn sooner.',
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
      description: '+9% max HP.',
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
    tier3: {
      name: 'Load Bearing',
      description: 'Your first-hit shield blocks 55% damage instead of 50%.',
    },
    tier4: {
      name: 'Reinforced Crust',
      description: 'Once per battle, the second hit against you deals 5% less damage.',
    },
    tier5: 'Retaining Wall',
    tier6: {
      name: 'Unmovable',
      description: 'Once per battle, a hit cannot drop you below 10% max HP.',
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
    tier3: { name: 'Wind Shear', description: 'Unavoidable attacks deal 5% more damage.' },
    tier4: {
      name: 'Funnel Force',
      description: 'Charged attacks deal 7% more damage when released.',
    },
    tier5: 'Vortex Edge',
    tier6: {
      name: 'Tempest',
      description: 'Charged attacks hit immediately instead of waiting a turn.',
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
    tier3: {
      name: 'Slipstream',
      description: 'Fast attacks give you 3% more speed for that turn.',
    },
    tier4: {
      name: 'Thermal Lift',
      description: 'When you act first, deal 2.5% more damage.',
    },
    tier5: 'Wingtip Trim',
    tier6: {
      name: 'Eye of the Storm',
      description: 'After taking damage, you have a 40% chance to act first next turn.',
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
    tier3: {
      name: 'Fog Bank',
      description: 'Your first-hit shield blocks 55% damage instead of 50%.',
    },
    tier4: {
      name: 'Static Charge',
      description: 'After taking a critical hit, dodge 5% more often next turn.',
    },
    tier5: 'Overcast Veil',
    tier6: {
      name: 'Ceiling Break',
      description: 'Once per battle, a huge hit cannot deal more than 40% of your max HP.',
      capstone: { kind: 'damageCap', capPct: 0.4 },
    },
  },
];

/** Combo branch uses the same nation-point budget and single-purchase prerequisites. */
const COMBO_BRANCHES = [
  {
    branch: 'Flow',
    slot: 2 as const,
    nodes: [
      [
        'Quick Setup',
        'Unlocks setup combos: Burn or Defense Down, then a different attack, deals 20% more damage. Once per battle, Priority into Burn or Defense Down cannot miss.',
      ],
      [
        'Expose Weakness',
        'Once per battle, an unavoidable hit against a foe with lowered defense deals 4% more damage.',
      ],
      [
        'Kindled Recovery',
        'Once per battle, a draining hit against a burning foe heals 3% max HP.',
      ],
      ['Rhythm', 'Once per battle, land three different moves in a row to deal 5% more damage.'],
      [
        'Patient Followup',
        'Once per battle, a charged hit against a burning or weakened foe deals 5% more damage.',
      ],
      ['Flow State', 'Once per battle, land three different moves in a row to heal 4% max HP.'],
    ],
  },
] as const;
const comboNodes: TreeNode[] = (['water', 'fire', 'earth', 'air'] as const).flatMap((nation) =>
  COMBO_BRANCHES.flatMap(({ branch, slot, nodes }) => [
    ...nodes.map(([name, description], i) => ({
      id: `${nation}:${slugify(branch)}:${i + 1}`,
      nation,
      branch,
      slot,
      tier: (i + 1) as TreeNode['tier'],
      name,
      description,
      kind: 'passive' as const,
      maxRank: 1,
      cost: [1, 1, 2, 2, 3, 5][i]!,
      passive: slugify(name),
      prereqId: i === 0 ? null : `${nation}:${slugify(branch)}:${i}`,
    })),
    ...masteryNodes(nation, branch, slot, 'spd'),
  ]),
);

/** 64 nodes per nation: four paths, two three-way forks each, 47 points per complete route. */
export const TREE_NODES: Record<string, TreeNode> = Object.fromEntries(
  [...BRANCHES.flatMap(buildBranch), ...comboNodes].map((n) => [n.id, n]),
);

/** Read old saved trees without discarding purchases or charging a respec for rank consolidation. */
export function singlePurchaseTree(ranks: Record<string, number> = {}): Record<string, number> {
  const main = equippedMainPassive(ranks);
  return Object.fromEntries(
    Object.entries(ranks)
      .filter(([id, rank]) => rank > 0 && (!isSharedPassiveId(id) || id === main))
      .map(([id]) => [id, 1]),
  );
}

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
  return { id: `shared:${slugify(name)}`, name, description, cost: 3, maxRank: 1 };
}

export const SHARED_PASSIVE_NODES: readonly SharedPassiveNode[] = [
  sharedPassive('Stone Skin', 'The first hit against you deals 25% less damage.'),
  sharedPassive('Deep Roots', 'Below 25% HP, gain 20% defense for the rest of the battle.'),
  sharedPassive('Bedrock', 'Critical hits against you become normal hits.'),
  sharedPassive('Wildfire', 'Your burns deal 30% more damage and last one extra turn.'),
  sharedPassive('Aftershock', 'Your critical hits also lower the foe’s defense.'),
  sharedPassive('Tailwind', 'Your first equipped move always lands a critical hit.'),
  sharedPassive('Tidal Recovery', 'Critical hits you land heal 10% max HP.'),
  sharedPassive('Updraft', 'Act first on the opening turn.'),
  sharedPassive('Second Breath', 'Once per battle, survive a knockout with 1 HP.'),
  sharedPassive(
    'Ember Heart',
    'The first time you fall below half HP, your next move gains 20% crit chance.',
  ),
];

const SHARED_PASSIVE_BY_ID: Record<string, SharedPassiveNode> = Object.fromEntries(
  SHARED_PASSIVE_NODES.map((n) => [n.id, n]),
);

export function isSharedPassiveId(id: string): boolean {
  return id.startsWith('shared:');
}

/** One main passive slot. Stable roster order makes old multi-passive trees deterministic. */
export function equippedMainPassive(ranks: Record<string, number> = {}): string | null {
  return SHARED_PASSIVE_NODES.find((node) => (ranks[node.id] ?? 0) > 0)?.id ?? null;
}

// --- point budgets --------------------------------------------------------------------------

/**
 * Nation-tree points: 1/level from level 3 to 50, but the first point lands at level 4 (level 3
 * only unlocks the tree) so the level-50 total is 47, matching docs/design/talent-tree.md.
 */
export function pointsAvailable(level: number): number {
  return Math.max(0, Math.min(level, 50) - 3);
}

/** One main-passive purchase, unlocked from level 10. Refunds are always free. */
export const MAX_SHARED_PASSIVE_POINTS = 3;
export function sharedPassivePoints(level: number): number {
  return level >= 10 ? MAX_SHARED_PASSIVE_POINTS : 0;
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
      if (node && id === equippedMainPassive(ranks)) sharedSpent += node.cost;
      continue;
    }
    const node = TREE_NODES[id];
    if (node && node.nation === nation) nationSpent += node.cost;
  }
  return { nation: nationSpent, shared: sharedSpent };
}

// --- validation -------------------------------------------------------------------------------

export type TreeErrorCode =
  | 'TREE_UNKNOWN_NODE'
  | 'TREE_RANK'
  | 'TREE_PREREQ'
  | 'TREE_OVER_BUDGET'
  | 'TREE_PASSIVE_LIMIT'
  | 'TREE_CHOICE_LIMIT';
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
  _existingTree: Record<string, number> = {},
): ValidateTreeResult {
  let nationSpent = 0;
  let sharedSpent = 0;
  const mainPassives = SHARED_PASSIVE_NODES.filter((node) => (ranks[node.id] ?? 0) > 0);
  if (mainPassives.length > 1)
    return {
      ok: false,
      code: 'TREE_PASSIVE_LIMIT',
      reason: 'Only one main passive may be learned. Refund the current passive first.',
    };
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
    if ('prereqId' in node) {
      if (treeChoiceConflict(node, ranks))
        return {
          ok: false,
          code: 'TREE_CHOICE_LIMIT',
          reason: `${node.name}: choose only one alternative at this fork.`,
        };
      if (!treePrerequisiteMet(node, ranks))
        return {
          ok: false,
          code: 'TREE_PREREQ',
          reason: `${id} requires one of ${(node.prereqIds ?? [node.prereqId]).join(', ')} first`,
        };
    }
    if (isSharedPassiveId(id)) {
      sharedSpent += node.cost;
    } else nationSpent += node.cost;
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
    if (prevRank > 0 && (next[id] ?? 0) < 1) return true;
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
    (out[branch] ??= {})[node.name] = 1;
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

/** A mon's purchased stats, upgrades, capstones and nation/shared passives for battle. */
export interface ResolvedTree {
  statBonusPct: Partial<Record<StatKey, number>>;
  moveUpgradeBySlot: Partial<Record<LoadoutSlot, MoveUpgrade>>;
  capstones: CapstoneEffect[];
  sharedPassives: ReadonlySet<SharedPassiveSlug>;
  passives: ReadonlySet<string>;
}

const EMPTY_RESOLVED_TREE: ResolvedTree = {
  statBonusPct: {},
  moveUpgradeBySlot: {},
  capstones: [],
  sharedPassives: new Set(),
  passives: new Set(),
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
  const passives = new Set<string>();
  for (const [id, rank] of Object.entries(ranks)) {
    if (!rank || rank < 1) continue;
    if (isSharedPassiveId(id)) {
      if (SHARED_PASSIVE_BY_ID[id] && id === equippedMainPassive(ranks))
        sharedPassives.add(id.slice('shared:'.length) as SharedPassiveSlug);
      continue;
    }
    const node = TREE_NODES[id];
    if (!node || node.nation !== nation) continue;
    if (node.passive) passives.add(node.passive);
    if (node.kind === 'stat' && node.stat) {
      statBonusPct[node.stat] =
        (statBonusPct[node.stat] ?? 0) + (node.statBonusPct ?? STAT_PCT_PER_RANK);
    } else if (node.kind === 'moveUpgrade') {
      moveUpgradeBySlot[node.slot] = {
        effectMult: MOVE_UPGRADE_EFFECT_MULT,
        powerMult: MOVE_UPGRADE_POWER_MULT,
      };
    } else if (node.kind === 'capstone' && node.capstone) {
      capstones.push(node.capstone);
    }
  }
  return { statBonusPct, moveUpgradeBySlot, capstones, sharedPassives, passives };
}

/** Wild Mons invest in one identity branch; their unspent points keep fallback fights forgiving. */
export function defaultBotTree(nation: Nation, level: number): Record<string, number> {
  const budget = pointsAvailable(level);
  const ranks: Record<string, number> = {};
  if (budget <= 0) return ranks;
  const branch = nationNodes(nation)
    .filter((n) => n.tier <= 6 && n.branch === nationNodes(nation)[0]!.branch)
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
