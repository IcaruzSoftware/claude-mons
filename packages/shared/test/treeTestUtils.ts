import {
  simulateBattle,
  snapshotFor,
  type BattleAction,
  type BattleResult,
  type BattleTraceEvent,
  type MonSnapshot,
  type Side,
  type TreeTrigger,
} from '../src/battle/battle.ts';
import type { Rng } from '../src/battle/rng.ts';
import type { Stance } from '../src/game/progression.ts';
import { SPECIES, findMove, type Move } from '../src/game/species.ts';
import {
  SHARED_PASSIVE_NODES,
  nodesByBranch,
  pointsAvailable,
  treeChoiceConflict,
  treeNodesFor,
  treePrerequisiteMet,
  type TreeNode,
} from '../src/game/tree.ts';
import type { Nation, Stats } from '../src/types.ts';

export interface MonOpts {
  level?: number;
  moves?: string[];
  tree?: string[];
  passive?: string;
  stance?: Stance | null;
  stats?: Partial<Stats>;
}

/** A level-30 player mon with neutral stats (unless overridden), no stance and the given tree. */
export function mon(speciesId: string, o: MonOpts = {}): MonSnapshot {
  const tree: Record<string, number> = Object.fromEntries((o.tree ?? []).map((id) => [id, 1]));
  if (o.passive) tree[`shared:${o.passive}`] = 1;
  const snap = snapshotFor({
    monId: speciesId,
    playerId: 'p',
    nickname: speciesId,
    speciesId,
    stage: 'adult',
    level: o.level ?? 30,
    loadout: {
      ...(o.moves ? { moves: o.moves } : {}),
      tree,
      stance: o.stance === undefined ? null : o.stance,
    },
  });
  snap.stats = { hp: 200, atk: 60, def: 50, spd: 50, ...o.stats };
  return snap;
}

export type Entry = TreeTrigger & { turn: number; host: 'turn' | 'action' };

export function entries(res: BattleResult): Entry[] {
  const out: Entry[] = [];
  for (const t of res.turns) {
    for (const e of t.treeTriggers ?? []) out.push({ ...e, turn: t.turn, host: 'turn' });
    for (const a of t.actions)
      for (const e of a.treeTriggers ?? []) out.push({ ...e, turn: t.turn, host: 'action' });
  }
  return out;
}

export type Match = Partial<Pick<TreeTrigger, 'side' | 'node' | 'step' | 'effect'>>;
export const matches = (e: TreeTrigger, m: Match) =>
  (m.side === undefined || e.side === m.side) &&
  (m.node === undefined || e.node === m.node) &&
  (m.step === undefined || e.step === m.step) &&
  (m.effect === undefined || e.effect === m.effect);

/** Runs a battle with the draw trace and fails on any call-site mismatch (spec 1.4), so every
 * battle the tree tests simulate is also a call-site check. */
export function checkedBattle(a: MonSnapshot, b: MonSnapshot, seed: string): BattleResult {
  const { res, errors } = tracedCallSites(a, b, seed);
  if (errors.length) throw new Error(`call-site mismatch: ${errors.slice(0, 3).join(' | ')}`);
  return res;
}

/** First seed `${tag}-i` (i < max) whose battle satisfies `pred`. */
export function findBattle(
  a: MonSnapshot,
  b: MonSnapshot,
  tag: string,
  pred: (res: BattleResult) => boolean,
  max = 400,
): BattleResult | null {
  for (let i = 0; i < max; i++) {
    const res = checkedBattle(a, b, `${tag}-${i}`);
    if (pred(res)) return res;
  }
  return null;
}

export const SPECIES_LIST = Object.values(SPECIES);

/**
 * A random legal tree for `nation` at `level`: one or two branches (shared or the nation column,
 * which leads half the time) bought depth-first with a random alternative at every fork, so tiers 10 to 12 and full 47-point
 * routes are common, then a random fill of the remaining budget; sometimes a main passive.
 */
export function randomTree(nation: Nation, level: number, r: Rng): Record<string, number> {
  const tree: Record<string, number> = {};
  let budget = pointsAvailable(level);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const fits = (n: TreeNode) =>
    !tree[n.id] && n.cost <= budget && treePrerequisiteMet(n, tree) && !treeChoiceConflict(n, tree);
  const buy = (n: TreeNode) => {
    tree[n.id] = 1;
    budget -= n.cost;
  };
  const byBranch = nodesByBranch(nation);
  const columns = Object.values(byBranch);
  const focus = r() < 0.5 ? 1 : 2;
  for (let k = 0; k < focus; k++) {
    // The nation column is one of five but holds the rarest triggers, so it leads half the time.
    const column = k === 0 && r() < 0.5 ? byBranch.nation : pick(columns);
    for (let tier = 1; tier <= 12; tier++) {
      const options = column.filter((n) => n.tier === tier && fits(n));
      if (!options.length) break;
      buy(pick(options));
    }
  }
  for (;;) {
    const options = treeNodesFor(nation).filter(fits);
    if (!options.length || r() < 0.1) break;
    buy(pick(options));
  }
  if (level >= 10 && r() < 0.6) tree[pick([...SHARED_PASSIVE_NODES]).id] = 1;
  return tree;
}

/** A random mon of a random species with a random legal tree, loadout and stance. */
export function randomMon(r: Rng, side: Side, level: number): MonSnapshot {
  const species = SPECIES_LIST[Math.floor(r() * SPECIES_LIST.length)]!;
  const pool = [...species.movePool];
  const moves: string[] = [];
  while (moves.length < 3) {
    const m = pool.splice(Math.floor(r() * pool.length), 1)[0]!;
    moves.push(m.id);
  }
  const stances: Array<Stance | null> = ['fury', 'bulwark', 'gale', null];
  return snapshotFor({
    monId: side,
    playerId: side,
    nickname: side,
    speciesId: species.id,
    stage: 'adult',
    level,
    loadout: {
      moves,
      tree: randomTree(species.nation, level, r),
      stance: stances[Math.floor(r() * stances.length)]!,
    },
  });
}

export const moveOf = (snap: MonSnapshot, id: string): Move =>
  findMove(SPECIES[snap.speciesId]!, id)!;

/**
 * Call-site invariant (talent-tree spec 1.4, addendum 8.2 "trait draw reach"): every draw the
 * battle made equals the base-mechanics sequence, evaluated by this test from the log and the
 * pick-time HP, never from tree state. Returns a list of mismatches (empty = ok).
 */
export function callSiteMismatches(a: MonSnapshot, b: MonSnapshot, seed: string): string[] {
  return tracedCallSites(a, b, seed).errors;
}

export function tracedCallSites(
  a: MonSnapshot,
  b: MonSnapshot,
  seed: string,
): { res: BattleResult; errors: string[] } {
  const events: BattleTraceEvent[] = [];
  const res = simulateBattle(a, b, seed, (e) => {
    if (e.kind !== 'credit') events.push(e);
  });
  const errors = callSiteErrors(a, b, seed, res, events);
  return { res, errors };
}

function callSiteErrors(
  a: MonSnapshot,
  b: MonSnapshot,
  seed: string,
  res: BattleResult,
  events: BattleTraceEvent[],
): string[] {
  const mons: Record<Side, MonSnapshot> = { a, b };
  const updraft = (s: Side) => (mons[s].loadout?.tree?.['shared:updraft'] ?? 0) > 0;
  const baseUsed: Record<Side, boolean> = { a: false, b: false };
  const release: Record<Side, boolean> = { a: false, b: false };
  const errors: string[] = [];
  // The timeout coin is the last draw, after the last action.
  const last = events.at(-1);
  const coin = last?.kind === 'draw' && last.site === 'coin' ? (events.pop(), 'coin') : null;
  let i = 0;
  const takeDraws = () => {
    const out: string[] = [];
    while (i < events.length && events[i]!.kind === 'draw') {
      const e = events[i++] as Extract<BattleTraceEvent, { kind: 'draw' }>;
      out.push(e.site);
    }
    return out;
  };
  for (const turn of res.turns) {
    const te = events[i++];
    if (te?.kind !== 'turn' || te.turn !== turn.turn) return [`turn ${turn.turn}: no turn marker`];
    const frac = (s: Side) => te.hp[s] / mons[s].stats.hp;
    const expected: string[] = [];
    for (const s of ['a', 'b'] as const) {
      if (turn.turn === 1 || release[s]) continue;
      const forced =
        !baseUsed[s] &&
        ((turn.turn >= 3 && (frac('a') < 0.6 || frac('b') < 0.6)) || turn.turn >= 4);
      if (forced) baseUsed[s] = true;
      else expected.push('pick');
    }
    release.a = release.b = false;
    const picks = takeDraws();
    const pe = events[i++];
    if (pe?.kind !== 'picks') return [`turn ${turn.turn}: no picks marker`];
    const pri = (s: Side) => moveOf(mons[s], pe.moves[s]).effect === 'priority';
    if (pri('a') === pri('b') && !(turn.turn === 1 && updraft('a') !== updraft('b')))
      expected.push('speed');
    const got = [...picks, ...takeDraws()];
    if (got.join() !== expected.join())
      errors.push(`${seed} turn ${turn.turn} pick/speed: ${got.join()} vs ${expected.join()}`);
    const acts = turn.actions.filter((x) => x.moveId !== null);
    for (const action of acts) {
      const ae = events[i++];
      if (ae?.kind !== 'action' || ae.side !== action.actor) {
        errors.push(`${seed} turn ${turn.turn}: action marker mismatch`);
        return errors;
      }
      const ds = !!action.doubleStrike;
      const move = moveOf(mons[action.actor], action.moveId!);
      const nation = mons[action.actor].nation;
      const exp: string[] = [];
      if (action.charge === 'telegraph') {
        release[action.actor] = true;
      } else {
        if (ds || move.effect !== 'true_hit') exp.push('dodge');
        if (!action.dodged) {
          exp.push('crit', 'variance');
          if (!ds && move.type === 'nation' && action.targetHpAfter > 0) {
            if (nation === 'fire' && move.effect !== 'burn') exp.push('ignite');
            if (nation === 'water') exp.push('soak');
          }
        }
        if (!ds && !action.charge && !action.dodged && action.targetHpAfter > 0) exp.push('double');
      }
      // The double-strike gate is drawn after the action; it shows up before the next marker.
      const draws = takeDraws();
      if (draws.join() !== exp.join())
        errors.push(
          `${seed} turn ${turn.turn} ${action.actor} ${move.id}${ds ? ' (ds)' : ''}: ${draws.join()} vs ${exp.join()}`,
        );
    }
  }
  const tail = takeDraws();
  if (tail.length) errors.push(`${seed} end: ${tail.join()}`);
  if ((coin === 'coin') !== (res.reason === 'timeout_coin')) errors.push(`${seed}: coin draw`);
  if (i !== events.length) errors.push(`${seed}: ${events.length - i} unread trace events`);
  return errors;
}

/** A battle with each logged move action paired with the shared-boolean credits the engine made
 * for it (trace `credit` events), plus the call-site check. */
export function creditedBattle(
  a: MonSnapshot,
  b: MonSnapshot,
  seed: string,
): {
  res: BattleResult;
  actions: Array<{ turn: number; action: BattleAction; credits: string[] }>;
} {
  const perAction: string[][] = [];
  const res = simulateBattle(a, b, seed, (e) => {
    if (e.kind === 'action') perAction.push([]);
    if (e.kind === 'credit') perAction.at(-1)!.push(e.node);
  });
  checkedBattle(a, b, seed);
  const actions: Array<{ turn: number; action: BattleAction; credits: string[] }> = [];
  let i = 0;
  for (const t of res.turns)
    for (const action of t.actions)
      if (action.moveId !== null) actions.push({ turn: t.turn, action, credits: perAction[i++]! });
  return { res, actions };
}
