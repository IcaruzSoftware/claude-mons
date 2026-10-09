import { describe, expect, it } from 'vitest';
import type { Side, TreeTrigger } from '../src/battle/battle.ts';
import { initSideEffectState } from '../src/battle/effects.ts';
import {
  CLAMP_RULES,
  FIZZLE_RULES,
  GUARANTEED_CRIT_SOURCES,
  MULTIPLIER_RULES,
  NOCRIT_RULES,
  ON_CRIT_DRAW,
  ON_DODGE,
  ON_HIT,
  ON_HIT_TAKEN,
  ON_SOAK,
  ON_STATUS_APPLIED,
  ORDER_RUNG_LATE_RULES,
  PIERCE_SOURCES,
  REFUSE_RULES,
  SKIP_TICK_RULES,
  SUPPRESS_3C_RULES,
  TURN_END_B2,
  TURN_END_D,
  UNDODGE_SOURCES,
  VOID_RULES,
  bleedLineHolds,
  clampedDamage,
  creditBoolean,
  initiativeArms,
  lineHp,
  longHaulHolds,
  orderSnapArms,
  quartermasterSwaps,
  readHolds,
  recoveryCycleHeal,
  secondSkinHeal,
  type StatusEvent,
  type TreeAct,
  type TreeBattle,
} from '../src/battle/treeRules.ts';
import { SPECIES, type Move } from '../src/game/species.ts';
import { mon } from './treeTestUtils.ts';

// Boundary and negative cases for every threshold or condition node: each case sits exactly on
// the line and one step past it, so a wrong comparison (< vs <=, a fraction instead of the
// integer line) fails. Max HP is 201 (odd), so floor(201 x) differs from 201 x.
const MAX = 201;
const L = (x: number) => Math.floor(MAX * x);
const move = (speciesId: string, id: string): Move =>
  SPECIES[speciesId]!.movePool.find((m) => m.id === id)!;
const PRIORITY = move('pebblet', 'pebble-toss');
const CRIT_UP = move('pebblet', 'monolith-drop');
const TRUE_HIT = move('pebblet', 'landslide');
const CHARGE = move('sparkit', 'kindling-surge');

function battle(
  hp: Partial<Record<Side, number>> = {},
  spd: Record<Side, number> = { a: 100, b: 100 },
): TreeBattle {
  const fx = {
    a: initSideEffectState<Move>({ hasShieldFirst: false, hasStoneSkin: false }),
    b: initSideEffectState<Move>({ hasShieldFirst: false, hasStoneSkin: false }),
  };
  return {
    t: 2,
    mons: { a: mon('pebblet', { stats: { hp: MAX } }), b: mon('pebblet', { stats: { hp: MAX } }) },
    hp: { a: hp.a ?? MAX, b: hp.b ?? MAX },
    fx,
    nodes: { a: new Set(), b: new Set() },
    actedFirst: { a: true, b: false },
    picks: { a: CRIT_UP, b: CRIT_UP },
    slotOf: { a: {}, b: {} },
    liveSpd: (s) => spd[s],
    turnLog: [],
  };
}
function act(B: TreeBattle, o: Partial<TreeAct> = {}): TreeAct {
  return {
    me: 'a',
    foe: 'b',
    move: CRIT_UP,
    charge: null,
    ds: false,
    slot: 2,
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
    crit: false,
    baseCritDamage: 0,
    holdfast: false,
    ...o,
  };
}
const rule = <T extends { node: string }>(rules: T[], node: string) =>
  rules.find((r) => r.node === node)!;
const ev = (
  status: StatusEvent['status'],
  source: StatusEvent['source'] = 'move',
): StatusEvent => ({ status, source, isNew: true });
/** Runs one ON_HIT hook for `node` owned by side a and returns the entries it wrote. */
function hit(node: string, B: TreeBattle, o: Partial<TreeAct> = {}): TreeTrigger[] {
  B.nodes.a = new Set([node]);
  const ac = act(B, o);
  for (const h of ON_HIT) h(B, ac);
  return ac.log.filter((e) => e.node === node);
}

describe('integer HP lines', () => {
  it('uses floor(maxHp x) for every line', () => {
    expect(lineHp(battle(), 'a', 0.5)).toBe(100);
    expect(L(0.25)).toBe(50);
  });
  it('clamps land exactly on the line and never re-fire from it', () => {
    expect(clampedDamage(150, 80, L(0.5))).toBe(50); // 150 -> 100
    expect(clampedDamage(L(0.5), 30, L(0.5))).toBeNull(); // already at the line
    expect(clampedDamage(101, 1, L(0.5))).toBeNull(); // lands on the line, not below
    expect(clampedDamage(101, 2, L(0.5))).toBe(1);
    expect(clampedDamage(60, 20, L(0.25))).toBe(10); // Hold the Line: 60 -> 50
  });
});

describe('bastion conditions', () => {
  it('bastion:1 Keel needs a lead of at least 15 points of HP share', () => {
    const r = rule(NOCRIT_RULES, 'bastion:1');
    const B = battle({ a: 100, b: 131 }); // 31/201 = 15.4 points
    expect(r.holds(B, act(B))).toBe(true);
    const C = battle({ a: 100, b: 130 }); // 30/201 = 14.9 points
    expect(r.holds(C, act(C))).toBe(false); // Exact integer math: 130/200 vs 100/200 is exactly 15 points.
    const D = battle({ a: 100, b: 130 });
    D.mons = {
      a: mon('pebblet', { stats: { hp: 200 } }),
      b: mon('pebblet', { stats: { hp: 200 } }),
    };
    expect(r.holds(D, act(D))).toBe(true);
  });
  it('bastion:2 Ballast: slot 2 at or below the 60% line; bastion:6 Keystone: any move at or below 70% while behind', () => {
    const ballast = rule(UNDODGE_SOURCES, 'bastion:2');
    expect(ballast.holds(battle({ a: L(0.6) }), act(battle({ a: L(0.6) }), { slot: 2 }))).toBe(
      true,
    );
    expect(
      ballast.holds(battle({ a: L(0.6) + 1 }), act(battle({ a: L(0.6) + 1 }), { slot: 2 })),
    ).toBe(false);
    expect(ballast.holds(battle({ a: 10 }), act(battle({ a: 10 }), { slot: 1 }))).toBe(false);
    const keystone = rule(UNDODGE_SOURCES, 'bastion:6');
    const behind = battle({ a: L(0.7), b: L(0.7) + 1 });
    expect(keystone.holds(behind, act(behind, { slot: 3 }))).toBe(true);
    const higher = battle({ a: L(0.7) + 1, b: MAX });
    expect(keystone.holds(higher, act(higher))).toBe(false);
    const level = battle({ a: 50, b: 50 });
    expect(keystone.holds(level, act(level))).toBe(false);
  });
  it('bastion:3 Quartermaster: at least 70%, a strict lead, no Charge/Priority/true-hit move', () => {
    expect(quartermasterSwaps(battle({ a: L(0.7), b: 100 }), 'a', CRIT_UP, CRIT_UP)).toBe(true);
    expect(quartermasterSwaps(battle({ a: L(0.7) - 1, b: 100 }), 'a', CRIT_UP, CRIT_UP)).toBe(
      false,
    );
    expect(quartermasterSwaps(battle({ a: 180, b: 180 }), 'a', CRIT_UP, CRIT_UP)).toBe(false);
    for (const bad of [PRIORITY, TRUE_HIT, CHARGE]) {
      expect(quartermasterSwaps(battle({ a: 180, b: 100 }), 'a', bad, CRIT_UP)).toBe(false);
      expect(quartermasterSwaps(battle({ a: 180, b: 100 }), 'a', CRIT_UP, bad)).toBe(false);
    }
  });
  it('bastion:3:alt Hold the Line: a non-crit hit from above the 50% line', () => {
    const r = rule(CLAMP_RULES, 'bastion:3:alt');
    expect(r.line).toBe(0.25);
    expect(r.holds(battle(), act(battle(), { crit: false, foeHp0: L(0.5) + 1 }))).toBe(true);
    expect(r.holds(battle(), act(battle(), { crit: false, foeHp0: L(0.5) }))).toBe(false);
    expect(r.holds(battle(), act(battle(), { crit: true, foeHp0: MAX }))).toBe(false);
  });
  it('bastion:4 Stonewall: strictly above the 75% line', () => {
    const r = rule(SKIP_TICK_RULES, 'bastion:4');
    expect(r.holds(battle({ a: L(0.75) }), 'a')).toBe(false);
    expect(r.holds(battle({ a: L(0.75) + 1 }), 'a')).toBe(true);
  });
  it('bastion:7:left Hard Edge arms a pierce at a turn end at or above the 80% line', () => {
    expect(armed(turnEnd(TURN_END_B2, 'bastion:7:left', battle({ a: L(0.8) })))).toBe(1);
    expect(turnEnd(TURN_END_B2, 'bastion:7:left', battle({ a: L(0.8) - 1 }))).toEqual([]);
  });
  it('bastion:7 Tough Hide refuses only at or below the 60% line', () => {
    const r = rule(REFUSE_RULES, 'bastion:7');
    expect(r.holds(battle({ b: L(0.6) }), act(battle({ b: L(0.6) })), ev('burn'))).toBe(true);
    expect(r.holds(battle({ b: L(0.6) + 1 }), act(battle({ b: L(0.6) + 1 })), ev('burn'))).toBe(
      false,
    );
  });
  it('bastion:9 Sea Legs arms an undodge at the end of a turn the owner acted second', () => {
    const B = battle();
    expect(turnEnd(TURN_END_B2, 'bastion:9', B)).toEqual([]); // a acted first
    B.actedFirst = { a: false, b: true };
    expect(armed(turnEnd(TURN_END_B2, 'bastion:9', B))).toBe(1);
  });
  it('bastion:10 Iron Chin: at or below the 25% line', () => {
    const r = rule(NOCRIT_RULES, 'bastion:10');
    expect(r.pierceable).toBe(false);
    expect(r.holds(battle({ b: L(0.25) }), act(battle({ b: L(0.25) })))).toBe(true);
    expect(r.holds(battle({ b: L(0.25) + 1 }), act(battle({ b: L(0.25) + 1 })))).toBe(false);
  });
  it('bastion:10:left Long Haul: a crit while the owner is above the 60% line', () => {
    const lh = (hp: number, crit: boolean) =>
      longHaulHolds(battle({ a: 10, b: hp }), act(battle({ a: 10, b: hp }), { crit }));
    expect(lh(L(0.6), true)).toBe(false);
    expect(lh(L(0.6) + 1, true)).toBe(true);
    expect(lh(MAX, false)).toBe(false);
  });
  it('bastion:10:right Overwatch: only the status of the foe slot-1 move itself', () => {
    const r = rule(REFUSE_RULES, 'bastion:10:right');
    expect(r.holds(battle(), act(battle(), { slot: 1 }), ev('burn'))).toBe(true);
    expect(r.holds(battle(), act(battle(), { slot: 2 }), ev('burn'))).toBe(false);
    expect(r.holds(battle(), act(battle(), { slot: 1 }), ev('def_down', 'aftershock'))).toBe(false);
  });
  it('bastion:11 Holdfast: owner at least the 85% line before the action', () => {
    for (const r of [rule(NOCRIT_RULES, 'bastion:11'), rule(REFUSE_RULES, 'bastion:11')]) {
      expect(r.holds(battle(), act(battle(), { foeHp0: L(0.85) }), ev('burn'))).toBe(true);
      expect(r.holds(battle(), act(battle(), { foeHp0: L(0.85) - 1 }), ev('burn'))).toBe(false);
    }
  });
  it('bastion:12 Ascendance needs a strict lead', () => {
    const r = rule(REFUSE_RULES, 'bastion:12');
    expect(r.holds(battle({ a: 150, b: 151 }), act(battle({ a: 150, b: 151 })), ev('burn'))).toBe(
      true,
    );
    expect(r.holds(battle({ a: 150, b: 150 }), act(battle({ a: 150, b: 150 })), ev('burn'))).toBe(
      false,
    );
  });
});

describe('strike conditions', () => {
  it("strike:1 Hunter's Eye arms on a crit leaving a live foe below the 40% line", () => {
    expect(hit('strike:1', battle({ b: L(0.4) }), { crit: true })).toEqual([]);
    expect(hit('strike:1', battle({ b: L(0.4) - 1 }), { crit: false })).toEqual([]);
    expect(hit('strike:1', battle({ b: L(0.4) - 1 }), { crit: true })[0]).toMatchObject({
      effect: 'payoff_armed',
      step: 'hit',
    });
    expect(hit('strike:1', battle({ b: 0 }), { crit: true })).toEqual([]);
  });
  it('strike:3:alt Cut Short arms below the 50% line on a live foe, crit or not', () => {
    expect(hit('strike:3:alt', battle({ b: L(0.5) }))).toEqual([]);
    expect(hit('strike:3:alt', battle({ b: L(0.5) - 1 }))[0]).toMatchObject({
      effect: 'payoff_armed',
      step: 'hit',
    });
    expect(hit('strike:3:alt', battle({ b: 0 }))).toEqual([]);
  });
  it.each(['strike:9', 'strike:12'])('%s arms at or below the 25% line on a live foe', (node) => {
    expect(hit(node, battle({ b: L(0.25) })).length).toBeGreaterThan(0);
    expect(hit(node, battle({ b: L(0.25) + 1 }))).toEqual([]);
    expect(hit(node, battle({ b: 0 }))).toEqual([]);
  });
  it('strike:12 Kill Clock arms UNDODGE and PIERCE', () => {
    const B = battle({ b: 10 });
    hit('strike:12', B);
    expect(B.fx.a.armed.UNDODGE?.node).toBe('strike:12');
    expect(B.fx.a.armed.PIERCE?.node).toBe('strike:12');
  });
  it('strike:5 Execution Window: any direct hit against a foe below the 40% line', () => {
    const r = rule(PIERCE_SOURCES, 'strike:5');
    expect(r.holds(battle(), act(battle(), { move: PRIORITY, foeHp0: L(0.4) - 1 }))).toBe(true);
    expect(r.holds(battle(), act(battle(), { move: CRIT_UP, foeHp0: L(0.4) - 1 }))).toBe(true);
    expect(r.holds(battle(), act(battle(), { move: PRIORITY, foeHp0: L(0.4) }))).toBe(false);
  });
  it('strike:6 Coup Rule: a crit leaving the foe at or below the 35% line', () => {
    const r = rule(MULTIPLIER_RULES, 'strike:6');
    const B = battle({ b: 150 });
    expect(r.value(B, act(B, { crit: true, baseCritDamage: 150 - L(0.35) }))).toBe(2.0);
    expect(r.value(B, act(B, { crit: true, baseCritDamage: 150 - L(0.35) - 1 }))).toBeNull();
    expect(r.value(B, act(B, { crit: false, baseCritDamage: 150 }))).toBeNull();
  });
  it('strike:7 Pressure Cascade: the foe carries Burn, or the owner trails by at least 10 points', () => {
    const r = rule(PIERCE_SOURCES, 'strike:7');
    const B = battle();
    expect(r.holds(B, act(B))).toBe(false);
    B.fx.b.defDownTurns = 1; // DEF-down alone does not count
    expect(r.holds(B, act(B))).toBe(false);
    B.fx.b.burnTurns = 1;
    expect(r.holds(B, act(B))).toBe(true);
    const behind = battle({ a: 100, b: 121 }); // 21/201 = 10.4 points
    expect(r.holds(behind, act(behind))).toBe(true);
    const close = battle({ a: 100, b: 120 }); // 9.95 points
    expect(r.holds(close, act(close))).toBe(false);
    // Exact integer math: 120/200 vs 100/200 is exactly 10 points (0.6 - 0.5 < 0.1 in floats).
    const exact = battle({ a: 100, b: 120 });
    exact.mons = {
      a: mon('pebblet', { stats: { hp: 200 } }),
      b: mon('pebblet', { stats: { hp: 200 } }),
    };
    expect(r.holds(exact, act(exact))).toBe(true);
    exact.hp.b = 119;
    expect(r.holds(exact, act(exact))).toBe(false);
  });
  it('strike:8 Heavy Hand: a 2.0x crit against a foe below the 60% line', () => {
    const r = rule(MULTIPLIER_RULES, 'strike:8');
    expect(r.value(battle(), act(battle(), { crit: true, foeHp0: L(0.6) - 1 }))).toBe(2.0);
    expect(r.value(battle(), act(battle(), { crit: true, foeHp0: L(0.6) }))).toBeNull();
    expect(r.value(battle(), act(battle(), { crit: false, foeHp0: 1 }))).toBeNull();
  });
  it('strike:10 Executioner Prep: foe below the 25% line and carrying a status', () => {
    const r = rule(GUARANTEED_CRIT_SOURCES, 'strike:10');
    const B = battle();
    B.fx.b.burnTurns = 2;
    expect(r.holds(B, act(B, { foeHp0: L(0.25) - 1 }))).toBe(true);
    expect(r.holds(B, act(B, { foeHp0: L(0.25) }))).toBe(false);
    B.fx.b.burnTurns = 0;
    expect(r.holds(B, act(B, { foeHp0: 1 }))).toBe(false);
  });
});

describe('ward conditions', () => {
  it('ward:5 Hard Shell: below the 35% line', () => {
    const r = rule(REFUSE_RULES, 'ward:5');
    expect(r.holds(battle({ b: L(0.35) - 1 }), act(battle({ b: L(0.35) - 1 })), ev('burn'))).toBe(
      true,
    );
    expect(r.holds(battle({ b: L(0.35) }), act(battle({ b: L(0.35) })), ev('burn'))).toBe(false);
  });
  it('ward:8 Second Skin: a hit worth at least the 20% line heals half, capped at 5%', () => {
    const B = battle();
    B.fx.a.maxHitTakenThisTurn = L(0.2);
    expect(secondSkinHeal(B, 'a')).toBe(Math.min(Math.floor(L(0.2) / 2), L(0.05)));
    B.fx.a.maxHitTakenThisTurn = L(0.2) - 1;
    expect(secondSkinHeal(B, 'a')).toBe(0);
    B.fx.a.maxHitTakenThisTurn = 120;
    expect(secondSkinHeal(B, 'a')).toBe(L(0.05));
  });
  it('ward:10 Iron Tide: the foe finisher (slot 3) or a charge release at or below the 40% line', () => {
    const r = rule(VOID_RULES, 'ward:10');
    const at = (hp: number, o: Partial<TreeAct>) =>
      r.holds(battle({ b: hp }), act(battle({ b: hp }), o));
    expect(at(L(0.4), { charge: 'release' })).toBe(true);
    expect(at(L(0.4), { slot: 3 })).toBe(true);
    expect(at(L(0.4) + 1, { slot: 3 })).toBe(false);
    expect(at(10, { slot: 2 })).toBe(false);
  });
  it('ward:10:left Slipstream Guard: only when the owner acted first', () => {
    const r = rule(REFUSE_RULES, 'ward:10:left');
    const B = battle();
    expect(r.holds(B, act(B), ev('burn'))).toBe(false); // owner b acted second
    B.actedFirst = { a: false, b: true };
    expect(r.holds(B, act(B), ev('burn'))).toBe(true);
  });
  it('ward:11 Recovery Cycle heals 3% only after falling below the line', () => {
    const B = battle();
    expect(recoveryCycleHeal(B, 'a')).toBe(0);
    B.fx.a.fellBelowRecoveryLine = true;
    expect(recoveryCycleHeal(B, 'a')).toBe(L(0.03));
  });
});

describe('tempo conditions', () => {
  it('tempo:2 Initiative Read: at least the foe live SPD (ties go to the owner)', () => {
    expect(readHolds(battle({}, { a: 100, b: 100 }), 'a')).toBe(true);
    expect(readHolds(battle({}, { a: 99.9, b: 100 }), 'a')).toBe(false);
  });
  it('tempo:3 Chain Priority: any Priority move', () => {
    const r = rule(PIERCE_SOURCES, 'tempo:3');
    const B = battle();
    expect(r.holds(B, act(B, { move: PRIORITY }))).toBe(true);
    expect(r.holds(B, act(B, { move: CRIT_UP }))).toBe(false);
  });
  it('tempo:5 Tempo Edge / tempo:7:left Momentum read acted-first / acted-second', () => {
    const B = battle();
    expect(rule(PIERCE_SOURCES, 'tempo:5').holds(B, act(B))).toBe(true);
    expect(rule(PIERCE_SOURCES, 'tempo:7:left').holds(B, act(B))).toBe(false);
    B.actedFirst = { a: false, b: true };
    expect(rule(PIERCE_SOURCES, 'tempo:5').holds(B, act(B))).toBe(false);
    expect(rule(PIERCE_SOURCES, 'tempo:7:left').holds(B, act(B))).toBe(true);
  });
  it('tempo:7 Tempo Lock: a foe Priority after the owner applied a move Burn', () => {
    const r = rule(FIZZLE_RULES, 'tempo:7');
    const B = battle();
    expect(r.holds(B, 'a', 'b', PRIORITY)).toBe(false);
    B.fx.a.burnApplied = true;
    expect(r.holds(B, 'a', 'b', PRIORITY)).toBe(true);
    expect(r.holds(B, 'a', 'b', CRIT_UP)).toBe(false);
  });
  it('tempo:10 arms on the second consecutive landed Priority; tempo:11 after two acted-first turns', () => {
    const B = battle({ b: 100 });
    B.fx.a.priorityStreak = 1;
    expect(hit('tempo:10', B)).toEqual([]);
    B.fx.a.priorityStreak = 2;
    expect(hit('tempo:10', B).length).toBe(1);
    const C = battle({ b: 100 });
    C.fx.a.actedFirstStreak = 1;
    expect(hit('tempo:11', C)).toEqual([]);
    C.fx.a.actedFirstStreak = 2;
    expect(hit('tempo:11', C).length).toBe(1);
  });
  it('tempo:10:right Order Snap arms after two acted-first turns, tempo:12 after two acted-second', () => {
    const B = battle();
    B.fx.a.orderSnapCount = 1;
    expect(orderSnapArms(B, 'a')).toBe(false);
    B.fx.a.orderSnapCount = 2;
    expect(orderSnapArms(B, 'a')).toBe(true);
    B.fx.a.actedSecondCount = 1;
    expect(initiativeArms(B, 'a')).toBe(false);
    B.fx.a.actedSecondCount = 2;
    expect(initiativeArms(B, 'a')).toBe(true);
  });
});

// --- nation columns (addendum section 5) -------------------------------------------------------

type Hook = (B: TreeBattle, ac: TreeAct, ev: StatusEvent) => void;
/** Runs every hook of a table with only `node` owned by `owner` and returns its entries. */
function fire(
  hooks: readonly Hook[],
  node: string,
  B: TreeBattle,
  o: Partial<TreeAct> = {},
  owner: Side = 'a',
  e: StatusEvent = ev('burn'),
): TreeTrigger[] {
  B.nodes[owner] = new Set([node]);
  const ac = act(B, o);
  for (const h of hooks) h(B, ac, e);
  return ac.log.filter((x) => x.node === node);
}
function turnEnd(
  hooks: readonly ((B: TreeBattle, s: Side) => void)[],
  node: string,
  B: TreeBattle,
) {
  B.nodes.a = new Set([node]);
  B.turnLog = [];
  for (const h of hooks) h(B, 'a');
  return B.turnLog.filter((x) => x.node === node);
}
const armed = (es: TreeTrigger[]) => es.filter((x) => x.effect === 'payoff_armed').length;

describe('nation.fire conditions (the foe carries heat: any Burn or a move DEF-down)', () => {
  it('fire:1 Kindling 2.1x on a heated foe; fire:12 Pyre Lord 2.4x on a heated foe or below the 50% line', () => {
    const kindling = rule(MULTIPLIER_RULES, 'nation.fire:1');
    const pyre = rule(MULTIPLIER_RULES, 'nation.fire:12');
    const B = battle();
    expect(kindling.value(B, act(B, { crit: true }))).toBeNull();
    expect(pyre.value(B, act(B, { crit: true, foeHp0: L(0.5) }))).toBeNull();
    expect(pyre.value(B, act(B, { crit: true, foeHp0: L(0.5) - 1 }))).toBe(2.4);
    B.fx.b.burnTurns = 1;
    expect(kindling.value(B, act(B, { crit: true }))).toBe(2.1);
    expect(kindling.value(B, act(B, { crit: false }))).toBeNull();
    expect(pyre.value(B, act(B, { crit: true, foeHp0: MAX }))).toBe(2.4);
    B.fx.b.burnTurns = 0;
    B.fx.b.defDownTurns = 2; // an Aftershock DEF-down is not heat
    expect(kindling.value(B, act(B, { crit: true }))).toBeNull();
    B.fx.b.defDownFromMove = true;
    expect(kindling.value(B, act(B, { crit: true }))).toBe(2.1);
  });
  it('fire:2 Fuel Line arms an undodge at a turn end with the foe heated', () => {
    const B = battle();
    expect(turnEnd(TURN_END_B2, 'nation.fire:2', B)).toEqual([]);
    B.fx.b.burnTurns = 2;
    expect(armed(turnEnd(TURN_END_B2, 'nation.fire:2', B))).toBe(1);
  });
  it('fire:3 Kindle Chain arms on an ignite Burn only; fire:4 on any Burn; fire:9 on a move status against a foe below 50%', () => {
    expect(
      armed(fire(ON_STATUS_APPLIED, 'nation.fire:3', battle(), {}, 'a', ev('burn', 'ignite'))),
    ).toBe(1);
    expect(fire(ON_STATUS_APPLIED, 'nation.fire:3', battle(), {}, 'a', ev('burn', 'move'))).toEqual(
      [],
    );
    expect(fire(ON_STATUS_APPLIED, 'nation.fire:4', battle(), {}, 'a', ev('def_down'))).toEqual([]);
    const spread = fire(
      ON_STATUS_APPLIED,
      'nation.fire:4',
      battle(),
      {},
      'a',
      ev('burn', 'ignite'),
    );
    expect(spread[0]!.detail).toContain('ignite');
    expect(armed(fire(ON_STATUS_APPLIED, 'nation.fire:4', battle(), {}, 'a', ev('burn')))).toBe(1);
    const chain = (hp: number, e: StatusEvent) =>
      armed(fire(ON_STATUS_APPLIED, 'nation.fire:9', battle({ b: hp }), {}, 'a', e));
    expect(chain(L(0.5) - 1, ev('def_down'))).toBe(1);
    expect(chain(L(0.5) - 1, ev('burn'))).toBe(1);
    expect(chain(L(0.5), ev('burn'))).toBe(0);
    expect(chain(10, ev('burn', 'ignite'))).toBe(0);
  });
  it('fire:3:alt Burn-Hardened / fire:7 Forge / fire:7:left Kiln Skin read the attacker Burn', () => {
    const hardened = rule(NOCRIT_RULES, 'nation.fire:3:alt');
    const forge = rule(NOCRIT_RULES, 'nation.fire:7');
    const kiln = rule(REFUSE_RULES, 'nation.fire:7:left');
    const B = battle(); // the owner is b, the attacker a
    expect([
      hardened.holds(B, act(B)),
      forge.holds(B, act(B)),
      kiln.holds(B, act(B), ev('burn')),
    ]).toEqual([false, true, false]);
    B.fx.a.burnTurns = 1;
    expect([
      hardened.holds(B, act(B)),
      forge.holds(B, act(B)),
      kiln.holds(B, act(B), ev('burn')),
    ]).toEqual([true, false, true]);
    B.fx.a.burnTurns = 0;
    B.hp.b = Math.floor(B.mons.b.stats.hp * 0.5);
    expect(kiln.holds(B, act(B), ev('burn'))).toBe(false);
    B.hp.b -= 1; // the owner below 50% HP
    expect(kiln.holds(B, act(B), ev('burn'))).toBe(true);
  });
  it('fire:5 Heat Tithe arms once per battle on a crit taken while the foe is heated', () => {
    const B = battle();
    B.nodes.b = new Set(['nation.fire:5']);
    const run = (serial: number, crit: boolean) => {
      const ac = act(B, { serial, crit });
      for (const h of ON_HIT_TAKEN) h(B, ac);
      return armed(ac.log);
    };
    expect(run(1, true)).toBe(0); // the attacker a is not heated
    B.fx.a.burnTurns = 2;
    expect(run(2, false)).toBe(0);
    expect(run(3, true)).toBe(1);
    expect(run(4, true)).toBe(0); // 1/battle
  });
  it('fire:6 Inferno (heated foe or below 20%) and fire:10 Crucible (foe below 50%)', () => {
    const inferno = rule(PIERCE_SOURCES, 'nation.fire:6');
    const crucible = rule(GUARANTEED_CRIT_SOURCES, 'nation.fire:10');
    const B = battle();
    expect(inferno.holds(B, act(B))).toBe(false);
    expect(inferno.holds(B, act(B, { foeHp0: L(0.2) - 1 }))).toBe(true);
    expect(crucible.holds(B, act(B, { foeHp0: L(0.5) - 1 }))).toBe(true);
    expect(crucible.holds(B, act(B, { foeHp0: L(0.5) }))).toBe(false);
    B.fx.b.burnTurns = 1;
    expect(inferno.holds(B, act(B))).toBe(true);
  });
  it('fire:7:right Sear: a crit on a foe burned when the hit lands', () => {
    const B = battle({ b: 100 });
    expect(fire(ON_HIT, 'nation.fire:7:right', B, { crit: true })).toEqual([]);
    B.fx.b.burnTurns = 1;
    expect(fire(ON_HIT, 'nation.fire:7:right', B, { crit: false })).toEqual([]);
    expect(armed(fire(ON_HIT, 'nation.fire:7:right', B, { crit: true }))).toBe(1);
  });
  it('fire:8 Ash Cloud on the foe Burn ending; fire:10:left Bellows at the foe burnStreak 2', () => {
    const B = battle();
    expect(turnEnd(TURN_END_D, 'nation.fire:8', B)).toEqual([]);
    B.fx.b.burnEndedThisTurn = true;
    expect(armed(turnEnd(TURN_END_D, 'nation.fire:8', B))).toBe(1);
    for (const [streak, n] of [
      [1, 0],
      [2, 1],
    ] as const) {
      const C = battle();
      C.fx.b.burnStreak = streak;
      expect(armed(turnEnd(TURN_END_B2, 'nation.fire:10:left', C))).toBe(n);
    }
  });
  it('fire:10:right Afterheat arms on a drawn crit of a burned attacker, owned by the defender', () => {
    const run = (crit: boolean, burned: boolean) => {
      const B = battle();
      B.fx.a.burnTurns = burned ? 1 : 0;
      return armed(fire(ON_CRIT_DRAW, 'nation.fire:10:right', B, { crit }, 'b'));
    };
    expect([run(true, true), run(false, true), run(true, false)]).toEqual([1, 0, 0]);
  });
  it('fire:11 Hot Streak: a hit on a heated foe arms UNDODGE and PIERCE', () => {
    const B = battle({ b: 100 });
    expect(fire(ON_HIT, 'nation.fire:11', B)).toEqual([]);
    B.fx.b.burnTurns = 1;
    const es = fire(ON_HIT, 'nation.fire:11', B);
    expect(armed(es)).toBe(2);
    expect([B.fx.a.armed.UNDODGE?.node, B.fx.a.armed.PIERCE?.node]).toEqual([
      'nation.fire:11',
      'nation.fire:11',
    ]);
  });
});

describe('nation.water conditions (the foe is soaked)', () => {
  it('soak reads: Drag, Undercurrent, Slack Tide, Tidal Lock, Waterlogged, Cold Current, Deep Current, Undertow Pull, Brine Skin', () => {
    const B = battle();
    const reads = () => [
      rule(NOCRIT_RULES, 'nation.water:2').holds(B, act(B)), // owner b, attacker a soaked
      rule(SUPPRESS_3C_RULES, 'nation.water:3').holds(B, 'b', 'a'),
      rule(REFUSE_RULES, 'nation.water:3:alt').holds(B, act(B), ev('burn')),
      rule(REFUSE_RULES, 'nation.water:7').holds(B, act(B), ev('def_down')),
      rule(VOID_RULES, 'nation.water:10').holds(B, act(B, { move: PRIORITY })),
      rule(CLAMP_RULES, 'nation.water:11').holds(B, act(B)),
      rule(ORDER_RUNG_LATE_RULES, 'nation.water:10:left').holds(B, 'b'),
    ];
    expect(reads().every((x) => !x)).toBe(true);
    B.fx.a.soakTurns = 1;
    expect(reads().every(Boolean)).toBe(true);
    expect(rule(VOID_RULES, 'nation.water:10').holds(B, act(B, { move: CRIT_UP }))).toBe(false);
    expect(rule(CLAMP_RULES, 'nation.water:11').line).toBe(0.5);
    // Owner a reads the soaked foe b.
    const C = battle();
    expect(rule(PIERCE_SOURCES, 'nation.water:6').holds(C, act(C))).toBe(false);
    C.fx.b.soakTurns = 3;
    expect(rule(PIERCE_SOURCES, 'nation.water:6').holds(C, act(C))).toBe(true);
    expect(armed(turnEnd(TURN_END_B2, 'nation.water:7:right', C))).toBe(1);
    // Deep Current also works while the owner is at or below 15%, and Tidal Lock against a foe
    // below 20%.
    const D = battle({ b: L(0.15) });
    expect(rule(VOID_RULES, 'nation.water:10').holds(D, act(D, { move: PRIORITY }))).toBe(true);
    const E = battle();
    expect(rule(PIERCE_SOURCES, 'nation.water:6').holds(E, act(E, { foeHp0: L(0.2) - 1 }))).toBe(
      true,
    );
  });
  it('water:12 Maelstrom: a soaked foe below the 50% line', () => {
    const r = rule(GUARANTEED_CRIT_SOURCES, 'nation.water:12');
    const B = battle();
    B.fx.b.soakTurns = 2;
    expect(r.holds(B, act(B, { foeHp0: L(0.5) - 1 }))).toBe(true);
    expect(r.holds(B, act(B, { foeHp0: L(0.5) }))).toBe(false);
    B.fx.b.soakTurns = 0;
    expect(r.holds(B, act(B, { foeHp0: 1 }))).toBe(false);
  });
  it('water:1 / water:4 arm on every soak landing, water:10:right on one on a foe below 50%', () => {
    for (const [hp, n] of [
      [L(0.5), 0],
      [L(0.5) - 1, 1],
    ] as const) {
      const B = battle({ b: hp });
      expect(armed(fire(ON_SOAK, 'nation.water:10:right', B))).toBe(n);
      expect(armed(fire(ON_SOAK, 'nation.water:1', B))).toBe(1);
      expect(fire(ON_SOAK, 'nation.water:4', B)[0]!.detail).toContain('soak');
    }
  });
  it('water:5 Release / water:7:left Surge on the foe soak expiry; water:8 / water:9 at a soaked turn end', () => {
    for (const node of ['nation.water:5', 'nation.water:7:left']) {
      const B = battle();
      expect(turnEnd(TURN_END_D, node, B)).toEqual([]);
      B.fx.b.soakExpiredThisTurn = true;
      expect(armed(turnEnd(TURN_END_D, node, B))).toBe(1);
    }
    const B = battle({ b: L(0.2) - 1 });
    expect(turnEnd(TURN_END_B2, 'nation.water:8', B)).toEqual([]);
    expect(turnEnd(TURN_END_B2, 'nation.water:9', B)).toEqual([]);
    B.fx.b.soakTurns = 1; // the soak that expires at this TURN_END still counts
    expect(armed(turnEnd(TURN_END_B2, 'nation.water:8', B))).toBe(1);
    expect(armed(turnEnd(TURN_END_B2, 'nation.water:9', B))).toBe(1);
    const C = battle({ b: L(0.2) });
    C.fx.b.soakTurns = 1;
    expect(turnEnd(TURN_END_B2, 'nation.water:9', C)).toEqual([]);
  });
});

describe('nation.earth conditions (streaks from the previous TURN_END)', () => {
  it('streak reads: Hardpan, Silt, Terrace at 1; Grounding, Fault Line at 2; Monolith, Continent at 3; Hardrock at 4', () => {
    const B = battle();
    const atOwnerB = () => [
      rule(REFUSE_RULES, 'nation.earth:3:alt').holds(B, act(B), ev('burn')),
      rule(REFUSE_RULES, 'nation.earth:9').holds(B, act(B), ev('burn')),
      rule(CLAMP_RULES, 'nation.earth:11').holds(B, act(B, { foeHp0: L(0.6) + 1 })),
    ];
    expect(atOwnerB()).toEqual([false, false, false]);
    B.fx.b.hitStreak = 1;
    expect(atOwnerB()).toEqual([true, true, true]);
    expect(rule(CLAMP_RULES, 'nation.earth:11').holds(B, act(B, { foeHp0: L(0.6) }))).toBe(false);
    // Monolith (owner b): three hit turns and at or below the 35% line, never pierced.
    const mono = rule(NOCRIT_RULES, 'nation.earth:6');
    expect(mono.pierceable).toBe(false);
    const M = battle({ b: L(0.35) });
    M.fx.b.hitStreak = 2;
    expect(mono.holds(M, act(M))).toBe(false);
    M.fx.b.hitStreak = 3;
    expect(mono.holds(M, act(M))).toBe(true);
    const M2 = battle({ b: L(0.35) + 1 });
    M2.fx.b.hitStreak = 3;
    expect(mono.holds(M2, act(M2))).toBe(false);
    // Grounding (owner b) needs two hit turns and the foe a at or below the 15% line.
    const ground = rule(FIZZLE_RULES, 'nation.earth:7:left');
    const G = battle({ a: L(0.15) });
    G.fx.b.hitStreak = 2;
    expect(ground.holds(G, 'b', 'a', PRIORITY)).toBe(true);
    expect(ground.holds(G, 'b', 'a', CRIT_UP)).toBe(false);
    G.hp.a = L(0.15) + 1;
    expect(ground.holds(G, 'b', 'a', PRIORITY)).toBe(false);
    // Hardrock (owner a) reads b's streak and HP; Quarry only b's HP.
    const hard = rule(GUARANTEED_CRIT_SOURCES, 'nation.earth:10');
    const quarry = rule(GUARANTEED_CRIT_SOURCES, 'nation.earth:10:left');
    const H = battle();
    H.fx.b.hitStreak = 3;
    expect(hard.holds(H, act(H, { foeHp0: L(0.2) }))).toBe(false);
    H.fx.b.hitStreak = 4;
    expect(hard.holds(H, act(H, { foeHp0: L(0.2) }))).toBe(true);
    expect(hard.holds(H, act(H, { foeHp0: L(0.2) + 1 }))).toBe(false);
    expect(quarry.holds(H, act(H, { foeHp0: L(0.3) }))).toBe(true);
    expect(quarry.holds(H, act(H, { foeHp0: L(0.3) + 1 }))).toBe(false);
    // Fault Line (owner a): two hit turns, behind on HP, the foe at or below 20%.
    const fault = rule(GUARANTEED_CRIT_SOURCES, 'nation.earth:7:right');
    const F = battle({ a: 30, b: L(0.2) });
    F.fx.a.hitStreak = 2;
    expect(fault.holds(F, act(F))).toBe(true);
    F.fx.a.hitStreak = 1;
    expect(fault.holds(F, act(F))).toBe(false);
    const F2 = battle({ a: L(0.2), b: L(0.2) }); // not behind
    F2.fx.a.hitStreak = 2;
    expect(fault.holds(F2, act(F2))).toBe(false);
    const cont = rule(MULTIPLIER_RULES, 'nation.earth:12');
    const C = battle();
    C.fx.a.hitStreak = 2;
    expect(cont.value(C, act(C, { crit: true }))).toBeNull();
    C.fx.a.hitStreak = 3;
    expect(cont.value(C, act(C, { crit: true }))).toBe(1.8);
    expect(cont.value(C, act(C, { crit: false }))).toBeNull();
  });
  it('earth:3 Rootwork holds a crit; the clamp lines are 20%, 28%, 40%; Tectonic needs a start above 40%', () => {
    const r = rule(CLAMP_RULES, 'nation.earth:3');
    expect(r.holds(battle(), act(battle(), { crit: false }))).toBe(false);
    expect(r.holds(battle(), act(battle(), { crit: true }))).toBe(true);
    const tect = rule(CLAMP_RULES, 'nation.earth:7');
    expect([r.line, tect.line, rule(CLAMP_RULES, 'nation.earth:11').line]).toEqual([
      0.2, 0.28, 0.4,
    ]);
    expect(tect.holds(battle(), act(battle(), { foeHp0: L(0.4) + 1 }))).toBe(true);
    expect(tect.holds(battle(), act(battle(), { foeHp0: L(0.4) }))).toBe(false);
    expect(clampedDamage(L(0.28) + 1, 5, L(0.28))).toBe(1);
  });
  it('earth:5 Mantle: a Priority crit while the owner was hit two turns in a row', () => {
    const r = rule(VOID_RULES, 'nation.earth:5');
    const B = battle();
    for (const [streak, mv, crit, holds] of [
      [1, PRIORITY, true, false],
      [2, PRIORITY, true, true],
      [2, PRIORITY, false, false],
      [2, CRIT_UP, true, false],
      [3, PRIORITY, true, true],
    ] as const) {
      B.fx.b.hitStreak = streak;
      expect(r.holds(B, act(B, { move: mv, crit }))).toBe(holds);
    }
  });
  it('earth:1 at hitStreak 4+ while behind and at or below 50%; earth:2 at 2+; earth:4 at 2; earth:10:right at 3', () => {
    const at = (node: string, v: number, hp: Partial<Record<Side, number>> = {}) => {
      const B = battle(hp);
      B.fx.a.hitStreak = v;
      return armed(turnEnd(TURN_END_B2, node, B));
    };
    const low = { a: L(0.5), b: L(0.5) + 21 }; // 21/201 = 10.4 points behind
    expect([3, 4, 5].map((v) => at('nation.earth:1', v, low))).toEqual([0, 1, 1]);
    expect(at('nation.earth:1', 4, { a: L(0.5) + 1, b: MAX })).toBe(0);
    expect(at('nation.earth:1', 4, { a: 50, b: 70 })).toBe(0); // 9.95 points behind
    expect([1, 2, 3].map((v) => at('nation.earth:2', v))).toEqual([0, 1, 1]);
    expect([1, 2, 3].map((v) => at('nation.earth:4', v))).toEqual([0, 1, 0]);
    expect([2, 3, 4].map((v) => at('nation.earth:10:right', v))).toEqual([0, 2, 0]);
  });
  it('earth:8 Sediment arms at the sixth direct hit taken', () => {
    for (const [taken, n] of [
      [5, 0],
      [6, 1],
      [7, 0],
    ] as const) {
      const B = battle();
      B.fx.b.directHitsTaken = taken;
      B.nodes.b = new Set(['nation.earth:8']);
      const ac = act(B);
      for (const h of ON_HIT_TAKEN) h(B, ac);
      expect(armed(ac.log)).toBe(n);
    }
  });
});

describe('nation.air conditions (speed lead = own live SPD / foe live SPD without its air trait)', () => {
  const lead = (spdA: number, spdB: number) => battle({}, { a: spdA, b: spdB });
  it('110% gates (Lift, Gust Line, Sovereign Wind; Headwind, Tailwind Crown, Ridge as defender)', () => {
    for (const [spd, holds] of [
      [110, true],
      [109.9, false],
    ] as const) {
      const B = lead(spd, 100);
      expect(rule(UNDODGE_SOURCES, 'nation.air:2').holds(B, act(B))).toBe(holds);
      expect(rule(PIERCE_SOURCES, 'nation.air:4').holds(B, act(B))).toBe(holds);
      expect(
        rule(GUARANTEED_CRIT_SOURCES, 'nation.air:12').holds(B, act(B, { foeHp0: L(0.3) - 1 })),
      ).toBe(holds);
      const D = battle({ b: L(0.5) }, { a: 100, b: spd }); // owner b
      D.actedFirst = { a: false, b: true };
      expect(rule(NOCRIT_RULES, 'nation.air:3').holds(D, act(D))).toBe(holds);
      expect(rule(REFUSE_RULES, 'nation.air:6').holds(D, act(D), ev('burn'))).toBe(holds);
      expect(rule(NOCRIT_RULES, 'nation.air:7').holds(D, act(D))).toBe(holds);
    }
  });
  it('Lift, Headwind and Gust Line also need the first action; Ridge the 50% line; Sovereign Wind a foe below 30%', () => {
    const B = lead(120, 100);
    B.actedFirst = { a: false, b: true };
    expect(rule(PIERCE_SOURCES, 'nation.air:4').holds(B, act(B))).toBe(false);
    expect(rule(UNDODGE_SOURCES, 'nation.air:2').holds(B, act(B))).toBe(false);
    const D = lead(100, 120); // owner b leads but acted second
    expect(rule(NOCRIT_RULES, 'nation.air:3').holds(D, act(D))).toBe(false);
    expect(rule(NOCRIT_RULES, 'nation.air:7').holds(D, act(D))).toBe(false); // b above 50%
    const C = lead(120, 100);
    expect(
      rule(GUARANTEED_CRIT_SOURCES, 'nation.air:12').holds(C, act(C, { foeHp0: L(0.3) })),
    ).toBe(false);
  });
  it('Stratosphere at 112% (1.9x), Lee Shore at 105% with no hit taken last turn', () => {
    const strat = rule(MULTIPLIER_RULES, 'nation.air:8');
    expect(strat.value(lead(112, 100), act(lead(112, 100), { crit: true }))).toBe(1.9);
    expect(strat.value(lead(111.9, 100), act(lead(111.9, 100), { crit: true }))).toBeNull();
    const lee = rule(REFUSE_RULES, 'nation.air:10');
    const B = lead(100, 105); // owner b
    expect(lee.holds(B, act(B), ev('burn'))).toBe(true);
    B.fx.b.hitStreak = 1;
    expect(lee.holds(B, act(B), ev('burn'))).toBe(false);
    const C = lead(100, 104.9);
    expect(lee.holds(C, act(C), ev('burn'))).toBe(false);
  });
  it('Dust Devil and Cloud Bank arm on a dodge and are disarmed when used', () => {
    const B = battle();
    const dd = rule(FIZZLE_RULES, 'nation.air:7:left');
    expect(dd.holds(B, 'b', 'a', PRIORITY)).toBe(false);
    B.nodes.b = new Set(['nation.air:7:left', 'nation.air:11']);
    const ac = act(B);
    for (const h of ON_DODGE) h(B, ac);
    expect(armed(ac.log)).toBe(2);
    expect(dd.holds(B, 'b', 'a', PRIORITY)).toBe(true);
    expect(dd.holds(B, 'b', 'a', CRIT_UP)).toBe(false);
    dd.onSpend!(B, 'b');
    expect(dd.holds(B, 'b', 'a', PRIORITY)).toBe(false);
    const cb = rule(REFUSE_RULES, 'nation.air:11');
    expect(cb.holds(B, act(B), ev('burn'))).toBe(true);
    cb.onSpend!(B, 'b');
    expect(cb.holds(B, act(B), ev('burn'))).toBe(false);
  });
  it('dodge arming: Glide Step, Gale Shield any dodge, Crosswind a main-action dodge, Thermal Column after acting first; Hover at a turn end after acting first', () => {
    const dodge = (node: string, o: Partial<TreeAct>, set: (B: TreeBattle) => void = () => {}) => {
      const B = battle();
      set(B);
      return armed(fire(ON_DODGE, node, B, o, 'b'));
    };
    expect(dodge('nation.air:1', {})).toBe(1);
    expect(dodge('nation.air:3:alt', { move: CRIT_UP })).toBe(1);
    expect(dodge('nation.air:10:right', { move: CRIT_UP })).toBe(1);
    // A dodged double strike arms no Crosswind and no Counter Setup; Glide Step and Gale Shield
    // read any dodged direct hit.
    for (const node of ['nation.air:3:alt', 'tempo:10:left'])
      expect(dodge(node, { move: PRIORITY, ds: true })).toBe(0);
    expect(dodge('tempo:10:left', { move: PRIORITY })).toBe(1);
    expect(dodge('nation.air:1', { ds: true })).toBe(1);
    expect(dodge('nation.air:10:right', { ds: true })).toBe(1);
    expect(dodge('nation.air:9', {})).toBe(0); // b acted second
    expect(dodge('nation.air:9', {}, (B) => (B.actedFirst = { a: false, b: true }))).toBe(1);
    const H = battle();
    expect(turnEnd(TURN_END_B2, 'nation.air:5', H)).toEqual([]);
    H.fx.a.actedFirstStreak = 1;
    expect(armed(turnEnd(TURN_END_B2, 'nation.air:5', H))).toBe(1);
  });
  it('Eddy (PIERCE) and Ascent (UNDODGE and PIERCE) at actedFirstStreak 2', () => {
    for (const [streak, eddy, ascent] of [
      [1, 0, 0],
      [2, 1, 2],
      [3, 0, 0],
    ] as const) {
      const B = battle();
      B.fx.a.actedFirstStreak = streak;
      expect(armed(turnEnd(TURN_END_B2, 'nation.air:7:right', B))).toBe(eddy);
      const C = battle();
      C.fx.a.actedFirstStreak = streak;
      expect(armed(turnEnd(TURN_END_B2, 'nation.air:10:left', C))).toBe(ascent);
    }
  });
});

describe('shared leftovers (B1 reviews)', () => {
  it('ward:7 Layered Plating: any status or refresh while the owner carries one', () => {
    const r = rule(REFUSE_RULES, 'ward:7');
    const B = battle();
    expect(r.holds(B, act(B), ev('burn'))).toBe(false); // carries nothing
    expect(r.holds(B, act(B), ev('def_down'))).toBe(false);
    B.fx.b.defDownTurns = 1; // a DEF-down refresh on a DEF-downed target
    expect(r.holds(B, act(B), { status: 'def_down', source: 'move', isNew: false })).toBe(true);
    expect(r.holds(B, act(B), ev('burn'))).toBe(true);
  });
  it('tempo:8 Quick Recovery: acted first and landed a direct hit, both needed', () => {
    const r = rule(SKIP_TICK_RULES, 'tempo:8');
    for (const [first, landed, holds] of [
      [true, true, true],
      [true, false, false],
      [false, true, false],
    ] as const) {
      const B = battle();
      B.actedFirst = { a: first, b: !first };
      B.fx.a.landedDirectThisTurn = landed;
      expect(r.holds(B, 'a')).toBe(holds);
    }
  });
  it('bastion:8 Low Tide needs a move-sourced DEF-down and the owner at or below the 25% line', () => {
    const r = rule(VOID_RULES, 'bastion:8');
    const B = battle({ b: L(0.25) });
    B.fx.a.defDownTurns = 2; // the attacker a carries the owner's DEF-down
    expect(r.holds(B, act(B, { move: PRIORITY }))).toBe(false); // an Aftershock DEF-down
    B.fx.a.defDownFromMove = true;
    expect(r.holds(B, act(B, { move: PRIORITY }))).toBe(true);
    expect(r.holds(B, act(B, { move: CRIT_UP }))).toBe(false);
    B.hp.b = L(0.25) + 1;
    expect(r.holds(B, act(B, { move: PRIORITY }))).toBe(false);
  });
  it('ward:3 Layered Shell: a Priority move or a charge release that would crit', () => {
    const r = rule(VOID_RULES, 'ward:3');
    const B = battle();
    expect(r.holds(B, act(B, { move: PRIORITY, crit: true }))).toBe(true);
    expect(r.holds(B, act(B, { move: PRIORITY, crit: false }))).toBe(false);
    expect(r.holds(B, act(B, { move: CHARGE, charge: 'release', crit: true }))).toBe(true);
    expect(r.holds(B, act(B, { move: CRIT_UP, crit: true }))).toBe(false);
    expect(r.holds(B, act(B, { move: TRUE_HIT, crit: true }))).toBe(false);
  });
  it('strike:7:left Bleed Line: a landed hit this turn and a move DEF-down with fewer than 2 turns left', () => {
    const B = battle();
    const st = B.fx.b;
    st.defDownFromMove = true;
    st.defDownTurns = 1;
    expect(bleedLineHolds(B, 'b')).toBe(false); // a landed nothing this turn
    B.fx.a.landedDirectThisTurn = true;
    expect(bleedLineHolds(B, 'b')).toBe(true);
    st.defDownTurns = 2;
    expect(bleedLineHolds(B, 'b')).toBe(false);
    st.defDownTurns = 1;
    st.defDownFromMove = false;
    expect(bleedLineHolds(B, 'b')).toBe(false);
  });
});

describe('shared booleans with nation sources (addendum 3.2 tie rule, 6.1 pairs)', () => {
  const credit = (
    nodes: string[],
    set: (B: TreeBattle) => void,
    kind: 'UNDODGE' | 'PIERCE' | 'GUARANTEED_CRIT',
    o: Partial<TreeAct> = {},
  ) => {
    const B = battle({ a: L(0.5), b: 60 }, { a: 120, b: 100 });
    B.nodes.a = new Set(nodes);
    set(B);
    return creditBoolean(B, act(B, o), kind)?.node ?? null;
  };
  it('Ballast x an armed Fuel Line: the shared state source is credited before the pending payoff', () => {
    const fuel = (B: TreeBattle) => (B.fx.a.armed.UNDODGE = { node: 'nation.fire:2', turn: 1 });
    expect(credit(['bastion:2', 'nation.fire:2'], fuel, 'UNDODGE', { slot: 2 })).toBe('bastion:2');
    expect(credit(['nation.fire:2'], fuel, 'UNDODGE', { slot: 2 })).toBe('nation.fire:2');
  });
  it('Gust Line x Tempo Edge: one PIERCE credit, the shared 1/turn source first', () => {
    expect(credit(['tempo:5', 'nation.air:4'], () => {}, 'PIERCE')).toBe('tempo:5');
    expect(credit(['nation.air:4'], () => {}, 'PIERCE')).toBe('nation.air:4');
  });
  it('Hardrock x Bloodscent: an armed Bloodscent (pending) is credited before the Hardrock flag', () => {
    const pinned = (B: TreeBattle) => {
      B.fx.b.hitStreak = 4;
      B.fx.a.armed.GUARANTEED_CRIT = { node: 'strike:9', turn: 1 };
    };
    const low = { foeHp0: L(0.2) };
    expect(credit(['strike:9', 'nation.earth:10'], pinned, 'GUARANTEED_CRIT', low)).toBe(
      'strike:9',
    );
    expect(credit(['nation.earth:10'], (B) => (B.fx.b.hitStreak = 4), 'GUARANTEED_CRIT', low)).toBe(
      'nation.earth:10',
    );
  });
});
