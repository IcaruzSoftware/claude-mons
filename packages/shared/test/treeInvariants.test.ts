import { describe, expect, it } from 'vitest';
import {
  simulateBattle,
  type BattleResult,
  type BattleTraceEvent,
  type MonSnapshot,
  type Side,
} from '../src/battle/battle.ts';
import { makeRng } from '../src/battle/rng.ts';
import {
  AIR_SPEED_MULT,
  BRINE_HP_LINE,
  CLAMP_HOLD_LINE,
  CLAMP_PULSE_LINE,
  GUST_LINE_SPD_RATIO,
  KINDLING_MULT,
  LEE_SHORE_SPD_RATIO,
  LIFT_SPD_RATIO,
  PYRE_LORD_MULT,
  ROOTWORK_HP_LINE,
  TECTONIC_HP_LINE,
  TERRACE_HP_LINE,
  initSideEffectState,
} from '../src/battle/effects.ts';
import {
  BOOL_SOURCES,
  CLAMP_RULES,
  FIZZLE_RULES,
  MULTIPLIER_RULES,
  NOCRIT_RULES,
  ORDER_RUNG_LATE_RULES,
  ORDER_RUNG_RULES,
  REFUSE_RULES,
  SKIP_TICK_RULES,
  SUPPRESS_3C_RULES,
  VOID_RULES,
  spdLead,
  type TreeAct,
  type TreeBattle,
} from '../src/battle/treeRules.ts';
import { SPECIES, speciesForNation, type Move } from '../src/game/species.ts';
import { TREE_NODES, nationNodes, validateTree } from '../src/game/tree.ts';
import type { Nation } from '../src/types.ts';
import { readFileSync } from 'node:fs';
import {
  callSiteMismatches,
  entries,
  findBattle,
  matches,
  mon,
  moveOf,
  tracedCallSites,
  randomMon,
} from './treeTestUtils.ts';
import { NATION_ROWS, ROWS, own } from './treeScenarios.ts';

const SEEDS = 1000;
/** Extra random battles for the coverage gate only: several nodes, shared and nation (Iron Tide,
 * Charge Focus, Ignition Chain, Cloud Bank, Fuel Line, Quarry), fire in well under 1% of the
 * battles their owner fights, so 1,000 seeds alone make the gate fragile. */
const COVERAGE_EXTRA = 4000;

/** `n` random battles (random species, legal trees incl. the nation column, loadouts, stances
 * and levels). */
function randomBattles(tag: string, n: number) {
  const r = makeRng(tag);
  return Array.from({ length: n }, (_, i) => {
    // Many level-50 battles, so full 47-point routes and tiers 10 to 12 are common.
    const level = r() < 0.4 ? 50 : 4 + Math.floor(r() * 47);
    const gap = Math.floor(r() * 7) - 3;
    const levelB = Math.max(4, Math.min(50, level + gap));
    return { a: randomMon(r, 'a', level), b: randomMon(r, 'b', levelB), seed: `${tag}-${i}` };
  });
}
/** The same 1,000 random battles for every gated invariant below. */
const RANDOM: Array<{ a: MonSnapshot; b: MonSnapshot; seed: string }> = randomBattles(
  'tree-invariants',
  SEEDS,
);
/** Per battle: the result and, per action, the shared-boolean credits the engine made. */
const traced = RANDOM.map(({ a, b, seed }) => {
  const credits: Array<Array<Extract<BattleTraceEvent, { kind: 'credit' }>>> = [];
  const res = simulateBattle(a, b, seed, (e) => {
    if (e.kind === 'action') credits.push([]);
    if (e.kind === 'credit') credits.at(-1)!.push(e);
  });
  return { res, credits };
});
const results: BattleResult[] = traced.map((x) => x.res);

/** Nodes the coverage check skips: none, every one of the 136 nodes must fire. */
const COVERAGE_EXEMPT: ReadonlySet<string> = new Set<string>();
/** Nodes no legal tree can fire (none since Long Haul reads the 50% line). */
const DEAD_IN_LEGAL_TREES: ReadonlySet<string> = new Set<string>();

/** The legal route to `id`: the node and its prerequisite chain through the centre nodes. */
function routeTo(id: string): string[] {
  const out: string[] = [];
  for (let n = TREE_NODES[id]; n; n = n.prereqId ? TREE_NODES[n.prereqId] : undefined)
    out.unshift(n.id);
  return out;
}
const SCENARIOS = new Map([...ROWS, ...NATION_ROWS].map((r) => [r[0], r] as const));
const focused = new Map<string, boolean>();
/** Focused pass for one node: its per-node scenario (`treeScenarios.ts`) at level 50 with side a's
 * tree replaced by the node's legal route; true if a seeded battle makes it write its entry. */
function focusedFires(id: string): boolean {
  const hit = focused.get(id);
  if (hit !== undefined) return hit;
  const [, a0, b0, m] = SCENARIOS.get(id)!;
  const tree = Object.fromEntries(routeTo(id).map((n) => [n, 1]));
  expect(validateTree(a0.nation, 50, tree)).toEqual({ ok: true });
  const a = { ...a0, level: 50, loadout: { ...a0.loadout, tree } };
  const b = { ...b0, level: 50 };
  const match = own(id, m);
  const fired =
    findBattle(a, b, `focus-${id}`, (r) => entries(r).some((e) => matches(e, match)), 400) !== null;
  focused.set(id, fired);
  return fired;
}

const deniedVictims = (res: BattleResult) =>
  res.turns.map((t) => {
    const victims = new Set<Side>();
    const opp = (s: Side): Side => (s === 'a' ? 'b' : 'a');
    for (const e of t.treeTriggers ?? []) {
      if (
        e.effect === 'order_override' &&
        [...ORDER_RUNG_RULES, ...ORDER_RUNG_LATE_RULES].some((r) => r.node === e.node)
      )
        victims.add(opp(e.side));
      if (e.effect === 'order_suppressed' && t.first === e.side) victims.add(opp(e.side));
    }
    for (const x of t.actions)
      for (const e of x.treeTriggers ?? [])
        if (e.effect === 'fizzled' || e.effect === 'void') victims.add(opp(e.side));
    return victims;
  });

describe('talent tree gated invariants (talent-tree spec 1.4 and 7)', () => {
  it('call-site invariant: every draw matches the base-mechanics sequence (1,000 random trees)', () => {
    const errors = RANDOM.flatMap(({ a, b, seed }) => callSiteMismatches(a, b, seed));
    expect(errors.slice(0, 5)).toEqual([]);
  });

  it('coverage: every one of the 136 roster nodes is owned often in random trees and fires', () => {
    // Owned at least 10 times in the random trees; fired in a random battle or, for a node too
    // rare to rely on a handful of random firings, in the focused pass on its legal route.
    const extra = randomBattles('tree-coverage', COVERAGE_EXTRA);
    const owners = new Map<string, number>();
    for (const { a, b } of [...RANDOM, ...extra])
      for (const m of [a, b])
        for (const id of Object.keys(m.loadout?.tree ?? {}))
          owners.set(id, (owners.get(id) ?? 0) + 1);
    // A `denied` entry is a rule that lost, not a firing (review finding, step D2).
    const fired = (r: BattleResult) =>
      entries(r)
        .filter((e) => e.effect !== 'denied')
        .map((e) => e.node);
    const writtenNodes = new Set(results.flatMap(fired));
    const errors: string[] = [];
    for (const { a, b, seed } of extra) {
      // The coverage-only battles are call-site checked too.
      const { res, errors: e } = tracedCallSites(a, b, seed);
      errors.push(...e);
      for (const node of fired(res)) writtenNodes.add(node);
    }
    expect(errors.slice(0, 5)).toEqual([]);
    const missing = Object.keys(TREE_NODES)
      .filter((id) => !COVERAGE_EXEMPT.has(id) && !DEAD_IN_LEGAL_TREES.has(id))
      .filter((id) => (owners.get(id) ?? 0) < 10 || !(writtenNodes.has(id) || focusedFires(id)))
      .map((id) => `${id} owned ${owners.get(id) ?? 0}`);
    expect(missing).toEqual([]);
  });

  it('focused pass: every node fires with its full legal route on one side (crafted loadout)', () => {
    const silent = Object.keys(TREE_NODES).filter((id) => !focusedFires(id));
    expect(silent).toEqual([]);
  });

  it('one credit per boolean: no action is credited twice for UNDODGE, PIERCE or GUARANTEED_CRIT', () => {
    let credited = 0;
    for (const { res, credits } of traced) {
      for (const perAction of credits) {
        const kinds = perAction.map((c) => c.boolean);
        expect(new Set(kinds).size).toBe(kinds.length);
        credited += kinds.length;
      }
      for (const t of res.turns)
        for (const x of t.actions) {
          const by = (effect: string) =>
            new Set((x.treeTriggers ?? []).filter((e) => e.effect === effect).map((e) => e.node));
          expect(by('undodge').size).toBeLessThanOrEqual(1);
          expect(by('guaranteed_crit').size).toBeLessThanOrEqual(1);
          expect(by('pierced').size).toBeLessThanOrEqual(1);
        }
    }
    expect(credited).toBeGreaterThan(0);
  });

  it('the generator has one call site: only `draw` can reach it', () => {
    const src = readFileSync(new URL('../src/battle/battle.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src.match(/makeRng\(/g)).toHaveLength(1);
    expect(src.match(/\bnext\(\)/g)).toHaveLength(1);
    expect(src.match(/\brng\s*\(/g)).toBeNull();
  });

  it('unknown tree ids throw UNKNOWN_TREE_ID (base 8.5)', () => {
    const ok = mon('pebblet');
    for (const tree of [
      { 'strike:99': 1 },
      { 'earth:stone:1': 1 },
      { 'nation.fire:1': 1 },
      { 'shared:nope': 1 },
    ]) {
      const bad = { ...ok, loadout: { ...ok.loadout, tree } };
      expect(() => simulateBattle(bad, ok, 'unknown')).toThrow(/UNKNOWN_TREE_ID/);
      expect(() => simulateBattle(ok, bad, 'unknown')).toThrow(/UNKNOWN_TREE_ID/);
    }
    const own = {
      ...ok,
      loadout: {
        ...ok.loadout,
        tree: { 'nation.earth:1': 1, 'strike:1': 1, 'shared:bedrock': 1, 'strike:99': 0 },
      },
    };
    expect(() => simulateBattle(own, ok, 'known')).not.toThrow();
  });

  it('determinism: same seed and snapshots give the same log (1,000 seeds)', () => {
    RANDOM.forEach(({ a, b, seed }, i) => {
      expect(simulateBattle(a, b, seed)).toEqual(results[i]);
    });
  });

  it('control rest: no side is denied on two consecutive turns (1,000 random trees)', () => {
    let denials = 0;
    for (const res of results) {
      const victims = deniedVictims(res);
      victims.forEach((set, t) => {
        denials += set.size;
        for (const s of set) expect(victims[t + 1]?.has(s) ?? false).toBe(false);
      });
    }
    expect(denials).toBeGreaterThan(0);
  });

  it('one-factor rule (static): a hit applies at most one offensive tree damage factor', () => {
    const offensive = new Set(MULTIPLIER_RULES.map((r) => r.node));
    for (const res of results)
      for (const t of res.turns)
        for (const x of t.actions) {
          const factors = (x.treeTriggers ?? []).filter(
            (e) => e.effect === 'multiplier' && offensive.has(e.node),
          );
          expect(factors.length).toBeLessThanOrEqual(1);
        }
  });

  it('one-factor rule (seeded): the largest hit with trees is at most 1.4x the largest without', () => {
    const tree = [
      'strike:1',
      'strike:2',
      'strike:3',
      'strike:4',
      'strike:5',
      'strike:6',
      'strike:7',
      'strike:8',
      'strike:9',
      'tempo:1',
    ];
    const moves = ['hotfix-howl', 'overclock', 'ember-maul'];
    const on = mon('cinderpup', { tree, moves, stance: 'fury', stats: { spd: 120 } });
    const off = mon('cinderpup', { moves, stance: 'fury', stats: { spd: 120 } });
    const foe = mon('pebblet', { stats: { hp: 400 } });
    const largest = (a: MonSnapshot) => {
      let max = 0;
      for (let i = 0; i < SEEDS; i++)
        for (const t of simulateBattle(a, foe, `bound-${i}`).turns)
          for (const x of t.actions)
            if (x.actor === 'a' && x.moveId && !x.doubleStrike) max = Math.max(max, x.damage);
      return max;
    };
    const maxOff = largest(off);
    const maxOn = largest(on);
    expect(maxOn).toBeGreaterThan(maxOff);
    expect(maxOn).toBeLessThanOrEqual(1.4 * maxOff);
  });

  it('main-passive status arming: Aftershock and ignite statuses never arm move-keyed nodes', () => {
    const moveKeyed = [
      'strike:3',
      'strike:7:left',
      'strike:10:left',
      'strike:11',
      'tempo:1',
      'tempo:7',
      'tempo:7:right',
      'bastion:8',
    ];
    // Sparkit is fire with no Burn or DEF-down move here: every status it causes is ignite or
    // Aftershock.
    const a = mon('sparkit', {
      tree: [...moveKeyed, 'strike:1', 'strike:2', 'strike:6', 'strike:7', 'strike:9', 'tempo:6'],
      moves: ['hot-reload', 'brushfire', 'spark-nip'],
      passive: 'aftershock',
      stats: { spd: 120 },
    });
    const r = makeRng('arming');
    let ignites = 0;
    for (let i = 0; i < SEEDS; i++) {
      const res = simulateBattle(a, randomMon(r, 'b', 30), `arming-${i}`);
      ignites += res.turns
        .flatMap((t) => t.actions)
        .filter((x) => x.nationPassive === 'ignite').length;
      for (const e of entries(res)) {
        if (e.side !== 'a' || !moveKeyed.includes(e.node)) continue;
        expect(['payoff_armed', 'status_refreshed', 'void', 'fizzled']).not.toContain(e.effect);
      }
    }
    expect(ignites).toBeGreaterThan(0);
  });
});

describe('call-site invariant: fixed cases (talent-tree spec 1.4)', () => {
  const traced = (a: MonSnapshot, b: MonSnapshot, seed: string) => {
    const events: BattleTraceEvent[] = [];
    const res = simulateBattle(a, b, seed, (e) => events.push(e));
    const perTurn = new Map<number, BattleTraceEvent[]>();
    let turn = 0;
    for (const e of events) {
      if (e.kind === 'turn') turn = e.turn;
      perTurn.set(turn, [...(perTurn.get(turn) ?? []), e]);
    }
    return { res, events, perTurn };
  };
  const picks = (evs: BattleTraceEvent[] | undefined, side: Side) =>
    (evs ?? []).filter((e) => e.kind === 'draw' && e.site === 'pick' && e.side === side).length;
  const hpAt = (evs: BattleTraceEvent[] | undefined) =>
    (evs ?? []).find((e): e is Extract<BattleTraceEvent, { kind: 'turn' }> => e.kind === 'turn')!
      .hp;

  it('(a) Quartermaster with no Charge move: one pick draw on turn 2, none on turn 3', () => {
    const a = mon('pebblet', {
      tree: ['bastion:3'],
      moves: ['monolith-drop', 'bedrock-slam', 'fault-line'],
      stats: { atk: 160, spd: 90 },
    });
    const b = mon('puffle', { stats: { atk: 15 } });
    let seen = 0;
    for (let i = 0; i < 400 && seen < 3; i++) {
      const { res, perTurn } = traced(a, b, `qm-a-${i}`);
      const hp = hpAt(perTurn.get(2));
      if (!hp || hp.a / 200 < 0.85 || hp.b / 200 >= 0.6 || hp.b / 200 < 0.5) continue;
      if (res.turns.length < 3) continue;
      seen++;
      expect(picks(perTurn.get(2), 'a')).toBe(1);
      expect(picks(perTurn.get(3), 'a')).toBe(0);
      const qm = (res.turns[1]!.treeTriggers ?? []).find((e) => e.node === 'bastion:3');
      expect(qm?.effect).toBe('finisher_early');
      expect(
        res.turns[2]!.treeTriggers?.some(
          (e) => e.node === 'bastion:3' && e.detail.includes('deferred slot'),
        ),
      ).toBe(true);
      expect(callSiteMismatches(a, b, `qm-a-${i}`)).toEqual([]);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('Quartermaster never swaps a Priority or true-hit move (draws stay base)', () => {
    // Slot 1 Priority, slot 3 true-hit: whichever move the turn-2 draw picks, no swap.
    const a = mon('pebblet', {
      tree: ['bastion:3'],
      moves: ['pebble-toss', 'bedrock-slam', 'landslide'],
      stats: { atk: 160, spd: 90 },
    });
    const b = mon('puffle', { stats: { atk: 15 } });
    for (let i = 0; i < 200; i++) {
      const res = simulateBattle(a, b, `qm-never-${i}`);
      expect(entries(res).filter((e) => e.node === 'bastion:3')).toEqual([]);
      expect(callSiteMismatches(a, b, `qm-never-${i}`)).toEqual([]);
    }
  });

  it('Quartermaster swaps only moves of one type and Burn effect, so turn 2 draws the same sites (fire, water)', () => {
    const sites = (evs: BattleTraceEvent[] | undefined) =>
      (evs ?? []).flatMap((e) => (e.kind === 'draw' ? [e.site] : []));
    const qm = (species: string, moves: string[]) => {
      const opts = { moves, stats: { atk: 160, spd: 90, hp: 400 } };
      const on = mon(species, { ...opts, tree: ['bastion:3'] });
      const off = mon(species, opts);
      const b = mon('puffle', { stats: { atk: 15, hp: 400 } });
      let swaps = 0;
      const turn2 = new Set<string>();
      for (let i = 0; i < 150; i++) {
        const seed = `qm-type-${species}-${i}`;
        const t = traced(on, b, seed);
        const swapped = (t.res.turns[1]?.treeTriggers ?? []).some((e) => e.node === 'bastion:3');
        const played = t.res.turns[1]?.actions.find((x) => x.actor === 'a' && !x.doubleStrike);
        if (played?.moveId) turn2.add(played.moveId);
        if (swapped) {
          swaps++;
          // The finisher replaced a move of its own type and Burn effect: the same draw sites.
          expect(sites(t.perTurn.get(2))).toEqual(sites(traced(off, b, seed).perTurn.get(2)));
        }
        expect(callSiteMismatches(on, b, seed)).toEqual([]);
      }
      return { swaps, turn2 };
    };
    // Fire: Hotfix Howl (Burn, no ignite draw) is never swapped for Ember Maul (ignite draw).
    const burn = qm('cinderpup', ['ember-bite', 'hotfix-howl', 'ember-maul']);
    expect(burn.swaps).toBe(0);
    expect(burn.turn2.has('hotfix-howl')).toBe(true);
    expect(qm('cinderpup', ['ember-bite', 'overclock', 'ember-maul']).swaps).toBeGreaterThan(0);
    // Water: two non-Burn nation moves swap (both draw soak); a Burn and a DEF-down move do not.
    expect(qm('dripple', ['drip-tap', 'stream-splash', 'backpressure']).swaps).toBeGreaterThan(0);
    expect(qm('bubblit', ['bubble-pop', 'scalding-current', 'brine-corrode']).swaps).toBe(0);
  });

  it('(b) turn 1, both Priority openers, Read at 110% SPD against Updraft: no roll, Updraft first', () => {
    const a = mon('pebblet', { tree: ['tempo:2'], stats: { spd: 55 } });
    const b = mon('dripple', { passive: 'updraft', stats: { spd: 50 } });
    for (let i = 0; i < 50; i++) {
      const { res, perTurn } = traced(a, b, `read-b-${i}`);
      expect((perTurn.get(1) ?? []).some((e) => e.kind === 'draw' && e.site === 'speed')).toBe(
        false,
      );
      expect(res.turns[0]!.first).toBe('b');
      expect(res.turns[0]!.treeTriggers ?? []).toEqual([]);
    }
  });

  it('(c) Quartermaster with a Charge move drawn on turn 2 does not fire; the release makes no pick draw', () => {
    const a = mon('sparkit', {
      tree: ['bastion:3'],
      moves: ['spark-nip', 'kindling-surge', 'hot-reload'],
      stats: { atk: 160, spd: 90 },
    });
    const b = mon('puffle', { stats: { atk: 15 } });
    const res = findBattle(a, b, 'qm-c', (r) => {
      const t2 = r.turns[1]?.actions.find((x) => x.actor === 'a');
      return t2?.charge === 'telegraph' && r.turns.length >= 3;
    });
    expect(res).not.toBeNull();
    const seed = res!.seed;
    const { perTurn } = traced(a, b, seed);
    expect(entries(res!).filter((e) => e.node === 'bastion:3')).toEqual([]);
    expect(picks(perTurn.get(2), 'a')).toBe(1);
    expect(picks(perTurn.get(3), 'a')).toBe(0);
    expect(res!.turns[2]!.actions.find((x) => x.actor === 'a')?.charge).toBe('release');
    expect(callSiteMismatches(a, b, seed)).toEqual([]);
  });

  it('trait draw reach: a refused Burn does not change whether the ignite draw is made', () => {
    // Cinderpup's opener Burn is refused by Thermal Break on one side and applied on the other;
    // its later nation hits draw ignite in both runs (addendum 9.3), so turns 1 and 2 draw the
    // same sites in the same order.
    const a = mon('cinderpup', { moves: ['hotfix-howl', 'overclock', 'ember-maul'] });
    const withTree = mon('dripple', { tree: ['ward:7:left'], stats: { hp: 400 } });
    const without = mon('dripple', { stats: { hp: 400 } });
    let checked = 0;
    for (let i = 0; i < 100; i++) {
      const sites = (b: MonSnapshot) => {
        const { perTurn } = traced(a, b, `reach-${i}`);
        return [1, 2].flatMap((t) =>
          (perTurn.get(t) ?? []).flatMap((e) => (e.kind === 'draw' ? [e.site] : [])),
        );
      };
      const s1 = sites(withTree);
      expect(s1).toEqual(sites(without));
      if (s1.includes('ignite')) checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

const NATIONS: Nation[] = ['water', 'fire', 'earth', 'air'];

describe('nation addendum invariants (addendum 8.2)', () => {
  it('nation gate: no mon simulates another nation column (1,000 random trees)', () => {
    let nationEntries = 0;
    RANDOM.forEach(({ a, b }, i) => {
      const mons = { a, b };
      for (const m of [a, b])
        for (const id of Object.keys(m.loadout?.tree ?? {}))
          if (TREE_NODES[id]?.nation) expect(TREE_NODES[id]!.nation).toBe(m.nation);
      for (const e of entries(results[i]!)) {
        const nation = TREE_NODES[e.node]?.nation;
        if (!nation) continue;
        nationEntries++;
        expect(nation).toBe(mons[e.side].nation);
      }
    });
    expect(nationEntries).toBeGreaterThan(0);
    // Every other nation's column id throws UNKNOWN_TREE_ID before a draw is made.
    for (const nation of NATIONS) {
      const own = mon(speciesForNation(nation)[0]!.id);
      for (const other of NATIONS.filter((n) => n !== nation))
        for (const node of nationNodes(other)) {
          const bad = { ...own, loadout: { ...own.loadout, tree: { [node.id]: 1 } } };
          expect(() => simulateBattle(bad, own, 'gate')).toThrow(/UNKNOWN_TREE_ID/);
        }
    }
  });

  it('trait arming invariant: an ignite arms only the igniting fire column, a soak only the soaking water column', () => {
    const ARMING = new Set(['payoff_armed', 'payoff_consumed', 'status_refreshed', 'void']);
    let ignites = 0;
    let soaks = 0;
    RANDOM.forEach(({ a, b }, i) => {
      const mons = { a, b };
      for (const t of results[i]!.turns) {
        const hosted = [
          ...(t.treeTriggers ?? []).map((e) => ({ e, x: null })),
          ...t.actions.flatMap((x) => (x.treeTriggers ?? []).map((e) => ({ e, x }))),
        ];
        for (const { e, x } of hosted) {
          if (!ARMING.has(e.effect)) continue;
          expect(e.detail).not.toMatch(/aftershock/i);
          if (/ignite/i.test(e.detail)) {
            ignites++;
            expect(e.node.startsWith('nation.fire:')).toBe(true);
            expect(x?.actor).toBe(e.side);
            expect(x?.nationPassive).toBe('ignite');
          }
          if (/soak/i.test(e.detail)) {
            soaks++;
            expect(e.node.startsWith('nation.water:')).toBe(true);
            expect(mons[e.side].nation).toBe('water');
            if (x) expect([x.actor, x.nationPassive]).toEqual([e.side, 'soak']);
          }
        }
        // (d) Behaviourally: on an action whose move applies no status of its own, every
        // status-step arming of the actor is a fire-column rule (its statuses are trait ones).
        for (const x of t.actions) {
          if (!x.moveId || x.doubleStrike) continue;
          const effect = moveOf(mons[x.actor], x.moveId).effect;
          if (effect === 'burn' || effect === 'def_down') continue;
          for (const e of x.treeTriggers ?? [])
            if (e.side === x.actor && e.step === 'status' && ARMING.has(e.effect))
              expect(e.node.startsWith('nation.fire:')).toBe(true);
        }
      }
    });
    expect(ignites).toBeGreaterThan(0);
    expect(soaks).toBeGreaterThan(0);
  });

  it('trait arming fixed cases: refused ignites arm nothing; Kindle Chain arms on its own ignite', () => {
    const refusedIgnite = (b: MonSnapshot, node: string, tag: string) => {
      const res = findBattle(mon('sparkit'), b, tag, (r) =>
        entries(r).some(
          (e) => e.node === node && e.effect === 'refused' && /ignite/.test(e.detail),
        ),
      );
      expect(res, tag).not.toBeNull();
      expect(entries(res!).filter((e) => e.effect === 'payoff_armed')).toEqual([]);
    };
    // (1) Tough Hide on a Cinderpup refuses Sparkit's ignite. (2) Thermal Break in a Sparkit mirror.
    refusedIgnite(
      mon('cinderpup', { tree: ['bastion:7'], stats: { hp: 400 } }),
      'bastion:7',
      'arm-1',
    );
    refusedIgnite(
      mon('sparkit', { tree: ['ward:7:left'], stats: { hp: 400 } }),
      'ward:7:left',
      'arm-2',
    );
    // (3) Kindle Chain arms on A's own ignite; the same entry from a shared node would fail above.
    const res = findBattle(
      mon('sparkit', { tree: ['nation.fire:3'] }),
      mon('sparkit'),
      'arm-3',
      (r) => entries(r).some((e) => e.node === 'nation.fire:3' && e.effect === 'payoff_armed'),
    );
    const armed = entries(res!).find((e) => e.node === 'nation.fire:3')!;
    expect(armed).toMatchObject({ side: 'a', step: 'status' });
    expect(armed.detail).toContain('ignite');
  });

  it('trait draw reach: a Burn Waterlogged refuses does not change the ignite draw of the next nation hit', () => {
    const a = mon('cinderpup', { moves: ['hotfix-howl', 'overclock', 'ember-maul'] });
    const withTree = mon('dripple', {
      tree: ['nation.water:7'],
      moves: ['pressure-jet', 'stream-splash', 'deep-current'],
      stats: { hp: 400, spd: 120 },
    });
    const without = { ...withTree, loadout: { ...withTree.loadout, tree: {} } };
    const perTurn = (b: MonSnapshot, seed: string) => {
      const sites: string[][] = [];
      const acts: Array<{ turn: number; draws: string[] }> = [];
      simulateBattle(a, b, seed, (e) => {
        if (e.kind === 'turn') sites.push([]);
        if (e.kind === 'action') acts.push({ turn: sites.length, draws: [] });
        if (e.kind === 'draw') {
          sites.at(-1)!.push(e.site);
          acts.at(-1)?.draws.push(e.site);
        }
      });
      return { sites, acts };
    };
    let checked = 0;
    for (let i = 0; i < 400 && checked < 3; i++) {
      const res = simulateBattle(a, withTree, `reach-wl-${i}`);
      const refusal = entries(res).find(
        (e) =>
          e.node === 'nation.water:7' && e.effect === 'refused' && e.detail.includes('Burn (move)'),
      );
      if (!refusal) continue;
      const on = perTurn(withTree, `reach-wl-${i}`);
      const off = perTurn(without, `reach-wl-${i}`);
      // Identical up to the first damage difference: the refused Burn's missing tick at the end of
      // the refusal turn.
      expect(on.sites.slice(0, refusal.turn)).toEqual(off.sites.slice(0, refusal.turn));
      // Cinderpup's next landed nation hit after the refusal makes exactly one ignite draw in both.
      const next = (r: typeof on) =>
        r.acts.find((x, k) => {
          const action = res.turns.flatMap((t) => t.actions.filter((y) => y.moveId))[k];
          return (
            x.turn > refusal.turn &&
            action?.actor === 'a' &&
            action.moveId !== 'hotfix-howl' &&
            !action.doubleStrike &&
            x.draws.includes('crit')
          );
        });
      const nOn = next(on);
      if (!nOn) continue;
      checked++;
      expect(nOn.draws.filter((d) => d === 'ignite')).toHaveLength(1);
      const nOff = off.acts.find((x) => x.turn === nOn.turn && x.draws.includes('ignite'));
      expect(nOff?.draws.filter((d) => d === 'ignite')).toHaveLength(1);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('static: clamp lines strictly ordered, CLAMP list descending, multiplier and air gate ceilings, no nation heal', () => {
    expect(ROOTWORK_HP_LINE).toBeLessThan(CLAMP_HOLD_LINE);
    expect(CLAMP_HOLD_LINE).toBeLessThan(TECTONIC_HP_LINE);
    expect(TECTONIC_HP_LINE).toBeLessThan(TERRACE_HP_LINE);
    expect(TERRACE_HP_LINE).toBeLessThan(BRINE_HP_LINE);
    expect(BRINE_HP_LINE).toBe(CLAMP_PULSE_LINE);
    const lines = CLAMP_RULES.map((r) => r.line);
    expect(lines).toEqual([...lines].sort((x, y) => y - x));
    // At an equal line the shared clamp runs first (addendum 3.2).
    expect(CLAMP_RULES.map((r) => r.node).slice(0, 2)).toEqual(['ward:4', 'nation.water:11']);
    expect(KINDLING_MULT).toBeLessThan(PYRE_LORD_MULT);
    expect(PYRE_LORD_MULT).toBeLessThanOrEqual(2.4);
    for (const gate of [LIFT_SPD_RATIO, GUST_LINE_SPD_RATIO, LEE_SHORE_SPD_RATIO])
      expect(gate).toBeLessThanOrEqual(AIR_SPEED_MULT);
    for (const node of Object.values(TREE_NODES).filter((n) => n.nation))
      expect(['HEAL', 'CLEANSE', 'SKIP_TICK', 'EXTEND']).not.toContain(node.effect);
  });

  it('air lead read: 1.12 at equal base SPD against every foe, 0.81 when soaked', () => {
    const lead = (own: string, foe: string, soaked = false) => {
      const mons = { a: mon(own, { stats: { spd: 50 } }), b: mon(foe, { stats: { spd: 50 } }) };
      // The engine's live SPD: base x air trait x soak.
      const live = (s: 'a' | 'b') =>
        50 * (mons[s].nation === 'air' ? AIR_SPEED_MULT : 1) * (s === 'a' && soaked ? 0.72 : 1);
      return spdLead({ mons, liveSpd: live } as unknown as TreeBattle, 'a');
    };
    expect(lead('puffle', 'wispit')).toBeCloseTo(1.12, 10);
    expect(lead('puffle', 'pebblet')).toBeCloseTo(1.12, 10);
    expect(lead('puffle', 'pebblet', true)).toBeCloseTo(1.12 * 0.72, 10);
    expect(lead('puffle', 'pebblet', true)).toBeLessThan(LEE_SHORE_SPD_RATIO);
  });

  it('no shared rule reads soak: toggling either side soaked never changes a shared rule', () => {
    const anyMove = SPECIES.pebblet!.movePool[0] as Move;
    const fake = (soakA: number, soakB: number): TreeBattle => {
      const fx = {
        a: initSideEffectState<Move>({ hasShieldFirst: false, hasStoneSkin: false }),
        b: initSideEffectState<Move>({ hasShieldFirst: false, hasStoneSkin: false }),
      };
      fx.a.soakTurns = soakA;
      fx.b.soakTurns = soakB;
      fx.b.burnTurns = 1;
      return {
        t: 2,
        mons: { a: mon('pebblet'), b: mon('dripple') },
        hp: { a: 90, b: 120 },
        fx,
        nodes: { a: new Set(), b: new Set() },
        actedFirst: { a: false, b: true },
        picks: { a: anyMove, b: anyMove },
        slotOf: { a: {}, b: {} },
        liveSpd: () => 50,
        turnLog: [],
      };
    };
    const ac = (B: TreeBattle): TreeAct => ({
      me: 'a',
      foe: 'b',
      move: anyMove,
      charge: null,
      ds: false,
      slot: 1,
      serial: 1,
      log: [],
      meHp0: B.hp.a,
      foeHp0: B.hp.b,
      fizzled: null,
      voided: null,
      pierce: null,
      undodge: null,
      gcrit: null,
      spendOnLand: [],
      crit: true,
      baseCritDamage: 60,
      holdfast: false,
    });
    const ev = { status: 'burn', source: 'move', isNew: true } as const;
    const read = (B: TreeBattle) => {
      const out: unknown[] = [];
      const shared = (n: { node: string }) => !n.node.startsWith('nation.');
      for (const r of Object.values(BOOL_SOURCES).flat().filter(shared))
        out.push(r.holds(B, ac(B)));
      for (const r of [...NOCRIT_RULES, ...VOID_RULES, ...CLAMP_RULES].filter(shared))
        out.push(r.holds(B, ac(B)));
      for (const r of REFUSE_RULES.filter(shared)) out.push(r.holds(B, ac(B), ev));
      for (const r of MULTIPLIER_RULES.filter(shared)) out.push(r.value(B, ac(B)));
      for (const r of FIZZLE_RULES.filter(shared)) out.push(r.holds(B, 'b', 'a', anyMove));
      for (const r of [...ORDER_RUNG_RULES, ...SKIP_TICK_RULES].filter(shared))
        out.push(r.holds(B, 'a'));
      for (const r of SUPPRESS_3C_RULES.filter(shared)) out.push(r.holds(B, 'a', 'b'));
      return out;
    };
    const base = read(fake(0, 0));
    expect(read(fake(3, 0))).toEqual(base);
    expect(read(fake(0, 3))).toEqual(base);
  });
});
