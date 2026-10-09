/**
 * Route, archetype and mirror-match helpers for `balance.test.ts` (talent-tree spec section 7 and
 * addendum section 8). Test-only; the protocol-14 roster lives in `src/game/tree.ts`.
 */
import { simulateBattle, snapshotFor, type BattleResult, type Side } from '../src/battle/battle.ts';
import type { EffectId } from '../src/battle/effects.ts';
import { stageForLevel } from '../src/game/levels.ts';
import type { MonLoadout, Stance } from '../src/game/progression.ts';
import { SPECIES, defaultLoadoutMoveIds, unlockedMoves } from '../src/game/species.ts';
import {
  TREE_NODES,
  pointsAvailable,
  treeChoiceConflict,
  treePrerequisiteMet,
  type TreeNode,
} from '../src/game/tree.ts';
import type { Nation } from '../src/types.ts';
import { entries } from './treeTestUtils.ts';

export const SHARED_BRANCHES = ['bastion', 'strike', 'ward', 'tempo'] as const;
export type BranchKey = (typeof SHARED_BRANCHES)[number] | `nation.${Nation}`;

/** A branch's nodes (centre and alternatives), sorted by tier. */
export function branchNodes(key: BranchKey): TreeNode[] {
  return Object.values(TREE_NODES)
    .filter((n) => n.id.startsWith(`${key}:`))
    .sort((a, b) => a.tier - b.tier);
}

/** The five branches a mon of `nation` can buy: the shared four and `nation.X`. */
export function nodesByBranch(nation: Nation): Map<BranchKey, TreeNode[]> {
  const keys: BranchKey[] = [...SHARED_BRANCHES, `nation.${nation}`];
  return new Map(keys.map((k) => [k, branchNodes(k)]));
}

/** Buys one branch's centre ids in tier order, stopping at the first that does not fit. */
export function branchOnlyTree(branch: BranchKey, level: number): Record<string, number> {
  const ranks: Record<string, number> = {};
  let remaining = pointsAvailable(level);
  for (const node of branchNodes(branch).filter((n) => !n.choiceOffset)) {
    if (node.cost > remaining) break;
    ranks[node.id] = 1;
    remaining -= node.cost;
  }
  return ranks;
}

export interface ForkPick {
  3?: 'alt';
  7?: 'left' | 'right';
  10?: 'left' | 'right';
}
/** Line-530 routes: centre, left (`:alt`, `:left`, `:left`), right (centre, `:right`, `:right`). */
export const FORK_ROUTES = {
  centre: {},
  left: { 3: 'alt', 7: 'left', 10: 'left' },
  right: { 7: 'right', 10: 'right' },
} as const satisfies Record<string, ForkPick>;

/** Tiers 1 to `maxTier` of one branch, centre ids except where `picks` names an alternative. */
export function route(key: BranchKey, picks: ForkPick = {}, maxTier = 12): Record<string, number> {
  const ranks: Record<string, number> = {};
  for (let t = 1; t <= maxTier; t++) {
    const pick = picks[t as keyof ForkPick];
    ranks[pick ? `${key}:${t}:${pick}` : `${key}:${t}`] = 1;
  }
  return ranks;
}

/** The cheapest legal route that owns `node`: its branch from tier 1 up to the node. */
export function routeTo(node: TreeNode): Record<string, number> {
  const [key, tier, alt] = node.id.split(':') as [BranchKey, string, ForkPick[3 | 7 | 10]?];
  return route(key, alt ? { [Number(tier)]: alt } : {}, node.tier);
}

export function treeCost(tree: Record<string, number>): number {
  return Object.keys(tree).reduce((sum, id) => sum + (TREE_NODES[id]?.cost ?? 0), 0);
}

/** Line 437's fixed 46-point list (spec section 7, "Refusal and void walls"). */
export const GREEDY_MAX_IDS: readonly string[] = [
  ...[1, 2, 3, 4, 5, 6].flatMap((t) => [`bastion:${t}`, `ward:${t}`, `strike:${t}`]),
  'tempo:1',
  'tempo:2',
  'tempo:3',
];

/** Buys `ids` in order, skipping any that does not fit the budget, misses its prerequisite or
 * conflicts with a bought alternative (archetypes above the level-30 budget). */
export function fitTree(ids: readonly string[], level: number): Record<string, number> {
  const ranks: Record<string, number> = {};
  let remaining = pointsAvailable(level);
  for (const id of ids) {
    const node = TREE_NODES[id]!;
    if (
      node.cost > remaining ||
      !treePrerequisiteMet(node, ranks) ||
      treeChoiceConflict(node, ranks)
    )
      continue;
    ranks[id] = 1;
    remaining -= node.cost;
  }
  return ranks;
}

const span = (branch: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${branch}:${from + i}`);

const STATUS: readonly EffectId[] = ['burn', 'def_down'];
const PRIORITY: readonly EffectId[] = ['priority'];

export interface Archetype {
  name: string;
  ids: readonly string[];
  stance: Stance;
  /** Wanted effects for slots 1 and 2; null = no preference. */
  slots: [readonly EffectId[] | null, readonly EffectId[] | null];
}

/** The six build archetypes of spec section 6. */
export const SIX_ARCHETYPES: readonly Archetype[] = [
  {
    name: 'Early Pressure',
    ids: [
      ...span('strike', 1, 4),
      'tempo:1',
      'tempo:2',
      ...span('bastion', 1, 3),
      'ward:1',
      'ward:2',
    ],
    stance: 'fury',
    slots: [['burn'], PRIORITY],
  },
  {
    name: 'Tempo Lock',
    ids: [...span('tempo', 1, 7), ...span('strike', 1, 3), 'bastion:1', 'bastion:2'],
    stance: 'fury',
    slots: [['burn'], ['crit_up']],
  },
  {
    name: 'Counterfire Ward',
    ids: [...span('ward', 1, 6), 'ward:7:right', 'ward:8', 'ward:9', 'ward:10:right'],
    stance: 'bulwark',
    slots: [null, PRIORITY],
  },
  {
    name: 'Strike Burst',
    ids: span('strike', 1, 10),
    stance: 'fury',
    slots: [PRIORITY, ['crit_up']],
  },
  {
    name: 'Bastion Wall',
    ids: [...span('bastion', 1, 6), ...span('ward', 1, 7)],
    stance: 'bulwark',
    slots: [PRIORITY, null],
  },
  {
    name: 'Initiative Max',
    ids: [
      ...span('tempo', 1, 6),
      'tempo:7:right',
      'tempo:8',
      'tempo:9',
      'tempo:10:right',
      'tempo:11',
      'tempo:12',
    ],
    stance: 'gale',
    slots: [STATUS, PRIORITY],
  },
];

/** Three moves from the unlocked pool: slot 1 and 2 by wanted effect (else highest power), slot 3
 * the highest-power remaining move. */
export function roleLoadout(
  speciesId: string,
  level: number,
  slots: Archetype['slots'],
): [string, string, string] {
  const pool = [...unlockedMoves(SPECIES[speciesId]!, level)].sort((a, b) => b.power - a.power);
  const picks: string[] = [];
  for (const wanted of [...slots, null]) {
    const free = pool.filter((m) => !picks.includes(m.id));
    const m = (wanted && free.find((x) => x.effect && wanted.includes(x.effect))) ?? free[0];
    picks.push(m?.id ?? picks[picks.length - 1]!);
  }
  return picks as [string, string, string];
}

export function archetypeLoadout(arch: Archetype, speciesId: string, level: number): MonLoadout {
  return {
    tree: fitTree(arch.ids, level),
    stance: arch.stance,
    moves: roleLoadout(speciesId, level, arch.slots),
  };
}

/** The default loadout with an unlocked Priority move moved into `slot` (0 or 1); null if the
 * species has none unlocked. */
export function prioritySlotMoves(speciesId: string, level: number, slot: 0 | 1): string[] | null {
  const pri = unlockedMoves(SPECIES[speciesId]!, level).find((m) => m.effect === 'priority');
  if (!pri) return null;
  const rest = defaultLoadoutMoveIds(SPECIES[speciesId]!, level).filter((id) => id !== pri.id);
  rest.splice(slot, 0, pri.id);
  return rest.slice(0, 3);
}

export function hasStatusMove(moves: readonly string[], speciesId: string): boolean {
  return SPECIES[speciesId]!.movePool.some(
    (m) => moves.includes(m.id) && m.effect !== null && STATUS.includes(m.effect),
  );
}

export function snap(speciesId: string, level: number, loadout: MonLoadout = {}, id: Side = 'a') {
  return snapshotFor({
    monId: id,
    playerId: id,
    nickname: id,
    speciesId,
    stage: stageForLevel(level) as 'baby' | 'teen' | 'adult',
    level,
    loadout,
  });
}

/** Nodes `side` wrote an entry for (a `denied` entry is a rule that lost, not a firing). */
export function firedNodes(r: BattleResult, side: Side): Set<string> {
  return new Set(
    entries(r)
      .filter((e) => e.side === side && e.effect !== 'denied')
      .map((e) => e.node),
  );
}

export type LoadoutFor = (speciesId: string) => MonLoadout;

export interface PairStats {
  /** X's win share over both side orders. */
  rate: number;
  battles: number;
  turns: number;
  timeouts: number;
  /** species -> node -> battles in which X's side fired the node. */
  xFired: Map<string, Map<string, number>>;
  /** species -> battles and X wins. */
  perSpecies: Map<string, { n: number; wins: number }>;
}

/**
 * Same-species mirror of build X against build Y, `n` seeds per species and side order. `seed`
 * receives whether X is side 'a'. Averaging both orders cancels the per-species position bias.
 */
export function mirrorPair(
  x: LoadoutFor,
  y: LoadoutFor,
  speciesIds: readonly string[],
  level: number,
  n: number,
  seed: (xFirst: boolean, speciesId: string, k: number) => string,
  each?: (r: BattleResult, xSide: Side, speciesId: string) => void,
): PairStats {
  const out: PairStats = {
    rate: 0,
    battles: 0,
    turns: 0,
    timeouts: 0,
    xFired: new Map(),
    perSpecies: new Map(),
  };
  let wins = 0;
  for (const speciesId of speciesIds) {
    const fired = new Map<string, number>();
    const sp = { n: 0, wins: 0 };
    const xa = snap(speciesId, level, x(speciesId), 'a');
    const yb = snap(speciesId, level, y(speciesId), 'b');
    const ya = snap(speciesId, level, y(speciesId), 'a');
    const xb = snap(speciesId, level, x(speciesId), 'b');
    for (const xFirst of [true, false]) {
      for (let k = 0; k < n; k++) {
        const r = xFirst
          ? simulateBattle(xa, yb, seed(true, speciesId, k))
          : simulateBattle(ya, xb, seed(false, speciesId, k));
        const xSide: Side = xFirst ? 'a' : 'b';
        const won = r.winner === xSide;
        wins += Number(won);
        sp.wins += Number(won);
        sp.n++;
        out.battles++;
        out.turns += r.turns.length;
        if (r.reason !== 'ko') out.timeouts++;
        for (const node of firedNodes(r, xSide)) fired.set(node, (fired.get(node) ?? 0) + 1);
        each?.(r, xSide, speciesId);
      }
    }
    out.xFired.set(speciesId, fired);
    out.perSpecies.set(speciesId, sp);
  }
  out.rate = wins / out.battles;
  return out;
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
