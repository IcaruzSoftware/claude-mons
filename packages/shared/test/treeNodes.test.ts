import { describe, expect, it } from 'vitest';
import { type BattleTurn, type MonSnapshot } from '../src/battle/battle.ts';
import { TREE_NODES, sharedNodes } from '../src/game/tree.ts';
import {
  checkedBattle,
  creditedBattle,
  entries,
  findBattle,
  matches,
  mon,
  type Entry,
  type Match,
} from './treeTestUtils.ts';
import {
  NO_PRIORITY,
  STATUSER,
  PRIORITY_SLOT2,
  BURN_OPENER,
  crit,
  strong,
  own,
  ROWS,
  CHARGE_OPENER,
  fire,
  water,
  earth,
  air,
  tank,
  fast,
  NATION_ROWS,
  DEF_KIT,
} from './treeScenarios.ts';

describe('talent tree nation nodes (one scenario per node)', () => {
  it('covers every nation node exactly once', () => {
    expect(NATION_ROWS.map((r) => r[0]).sort()).toEqual(
      Object.values(TREE_NODES)
        .filter((n) => n.nation)
        .map((n) => n.id)
        .sort(),
    );
  });

  it.each(NATION_ROWS)('%s fires and writes its treeTriggers entry', (node, a, b, m) => {
    expect(TREE_NODES[node]!.nation).toBe(a.nation);
    const match = own(node, m);
    const res = findBattle(a, b, `node-${node}`, (r) => entries(r).some((e) => matches(e, match)));
    expect(res, `no seed made ${node} write ${JSON.stringify(m)}`).not.toBeNull();
    const entry = entries(res!).find((e) => matches(e, match))!;
    const turnStep = ['turn_start', 'pick', 'order', 'turn_end'].includes(entry.step);
    expect(entry.host).toBe(turnStep ? 'turn' : 'action');
    expect(entry.detail.startsWith(`${TREE_NODES[node]!.name}:`)).toBe(true);
  });
});

describe('talent tree shared nodes (one scenario per node)', () => {
  it('covers every shared node exactly once', () => {
    expect(ROWS.map((r) => r[0]).sort()).toEqual(
      sharedNodes()
        .map((n) => n.id)
        .sort(),
    );
  });

  it.each(ROWS)('%s fires and writes its treeTriggers entry', (node, a, b, m) => {
    const match = own(node, m);
    const res = findBattle(a, b, `node-${node}`, (r) => entries(r).some((e) => matches(e, match)));
    expect(res, `no seed made ${node} write ${JSON.stringify(m)}`).not.toBeNull();
    const entry = entries(res!).find((e) => matches(e, match))!;
    // Turn-level steps live on the turn, action-level steps on the action (spec 1.5).
    const turnStep = ['turn_start', 'pick', 'order', 'turn_end'].includes(entry.step);
    expect(entry.host).toBe(turnStep ? 'turn' : 'action');
    expect(entry.detail.startsWith(`${TREE_NODES[node]!.name}:`)).toBe(true);
  });
});

describe('talent tree rule interactions', () => {
  const find = (a: MonSnapshot, b: MonSnapshot, tag: string, ...ms: Match[]) =>
    findBattle(a, b, tag, (r) => ms.every((m) => entries(r).some((e) => matches(e, m))), 600);

  it('a node outside the tree never writes anything (empty trees log nothing)', () => {
    for (let i = 0; i < 200; i++) {
      const res = checkedBattle(
        mon('cinderpup', { moves: BURN_OPENER }),
        mon('pebblet', { moves: STATUSER }),
        `empty-${i}`,
      );
      expect(entries(res)).toEqual([]);
    }
  });

  it('Keel is checked before Brace Reflex, so Brace keeps its flag and logs denied', () => {
    // Brace works only at or below 30% and Keel only with a 15-point lead: a low owner against an
    // even lower foe.
    const a = mon('pebblet', { tree: ['bastion:1', 'ward:1'], stats: { atk: 200, def: 10 } });
    const res = find(
      a,
      crit([]),
      'keel-brace',
      { side: 'a', node: 'bastion:1', effect: 'noncrit' },
      { side: 'a', node: 'ward:1', effect: 'denied' },
    );
    expect(res).not.toBeNull();
    const es = entries(res!);
    const keelIdx = es.findIndex((e) => e.node === 'bastion:1' && e.effect === 'noncrit');
    expect(es[keelIdx + 1]).toMatchObject({ node: 'ward:1', effect: 'denied' });
  });

  it('PIERCE bypasses Brace Reflex but never Iron Chin', () => {
    const b = mon('puffle', { tree: ['ward:1'] });
    expect(
      findBattle(
        crit(['strike:2']),
        b,
        'pierce-brace',
        (r) => has(entries(r), { side: 'a', node: 'strike:2', effect: 'pierced' }),
        2000,
      ),
    ).not.toBeNull();
    // Tempo Edge pierces Hard Shell on the same action on which Iron Chin still cancels the crit.
    const a = mon('cinderpup', {
      tree: ['tempo:5'],
      moves: ['hotfix-howl', 'overclock', 'ember-maul'],
      stats: { spd: 120, atk: 110 },
    });
    const chin = mon('pebblet', { tree: ['bastion:10', 'ward:5'], stats: { hp: 300, spd: 20 } });
    const res = findBattle(
      a,
      chin,
      'chin',
      (r) =>
        r.turns.some((t) =>
          t.actions.some(
            (x) =>
              x.treeTriggers?.some((e) => e.node === 'bastion:10' && e.effect === 'noncrit') &&
              x.treeTriggers.some((e) => e.node === 'tempo:5' && e.effect === 'pierced'),
          ),
        ),
      2000,
    );
    expect(res).not.toBeNull();
  });

  it('one-denial: Anchor takes the foe Priority, Layered Shell logs denied and stays unspent', () => {
    const a = mon('pebblet', { tree: ['bastion:5', 'ward:3'], moves: NO_PRIORITY });
    const b = mon('sparkit', { moves: PRIORITY_SLOT2 });
    const sameTurn = (t: BattleTurn) =>
      t.treeTriggers?.some((e) => e.node === 'bastion:5') &&
      t.actions.some((x) =>
        x.treeTriggers?.some((e) => e.node === 'ward:3' && e.effect === 'denied'),
      );
    const res = findBattle(a, b, 'anchor-shell', (r) => r.turns.some(sameTurn), 600);
    expect(res).not.toBeNull();
    const turn = res!.turns.find(sameTurn)!;
    const denied = turn.actions
      .flatMap((x) => x.treeTriggers ?? [])
      .find((e) => e.node === 'ward:3')!;
    expect(denied.detail).toContain('Anchor');
    // Layered Shell stayed unspent: it can still void a later Priority.
    expect(
      entries(res!).some((e) => e.node === 'ward:3' && e.effect === 'void' && e.turn < turn.turn),
    ).toBe(false);
  });

  it('Anchor yields to its own Tempo Lock on the same foe action', () => {
    const a = mon('cinderpup', {
      tree: ['bastion:5', 'tempo:7'],
      moves: ['hotfix-howl', 'overclock', 'ember-maul'],
    });
    const b = mon('pebblet', { moves: ['bedrock-slam', 'pebble-toss', 'monolith-drop'] });
    const res = find(
      a,
      b,
      'anchor-lock',
      { node: 'tempo:7', effect: 'fizzled' },
      { node: 'bastion:5', effect: 'denied' },
    );
    expect(res).not.toBeNull();
  });

  it('Low Tide voids at most once per battle, only while its owner is at or below 25%', () => {
    const a = mon('pebblet', { tree: ['bastion:8'], moves: STATUSER, stats: { def: 10 } });
    const b = mon('sparkit', { moves: ['spark-nip', 'flash-ignite', 'hot-reload'] });
    let voided = 0;
    for (let i = 0; i < 300; i++) {
      const res = checkedBattle(a, b, `rest-${i}`);
      const es = entries(res);
      const voids = es.filter((e) => e.node === 'bastion:8' && e.effect === 'void');
      expect(voids.length).toBeLessThanOrEqual(1);
      voided += voids.length;
    }
    expect(voided).toBeGreaterThan(0);
  });

  it('a fizzled action consumes nothing and the fizzler keeps the order (Counter Setup arms)', () => {
    const a = mon('cinderpup', {
      tree: ['tempo:7', 'tempo:10:left'],
      moves: ['hotfix-howl', 'overclock', 'ember-maul'],
    });
    const b = mon('pebblet', { moves: ['bedrock-slam', 'pebble-toss', 'monolith-drop'] });
    const res = find(a, b, 'fizzle', { node: 'tempo:7', effect: 'fizzled' });
    expect(res).not.toBeNull();
    const turn = res!.turns.find((t) =>
      t.actions.some((x) => x.treeTriggers?.some((e) => e.effect === 'fizzled')),
    )!;
    const fizzled = turn.actions.find((x) => x.treeTriggers?.some((e) => e.effect === 'fizzled'))!;
    expect(fizzled.actor).toBe('b');
    expect(fizzled.damage).toBe(0);
    expect(turn.first).toBe('b');
    expect(
      fizzled.treeTriggers!.some((e) => e.node === 'tempo:10:left' && e.effect === 'payoff_armed'),
    ).toBe(true);
  });

  it('a pending payoff expires two turns after arming when nothing credits it', () => {
    // Ballast (state) is credited before an armed Riposte Step, which then expires.
    const a = mon('puffle', { tree: ['ward:2', 'bastion:2'], stats: { spd: 160, hp: 120 } });
    const b = mon('pebblet', { stats: { spd: 30, atk: 120 } });
    expect(
      find(a, b, 'expire', {
        side: 'a',
        node: 'ward:2',
        effect: 'payoff_expired',
        step: 'turn_start',
      }),
    ).not.toBeNull();
  });

  it('one-factor rule: Coup Rule and the combo never apply to the same hit', () => {
    const a = mon('cinderpup', {
      tree: ['tempo:1', 'strike:6', 'strike:8'],
      moves: ['hotfix-howl', 'overclock', 'ember-bite'],
      stats: { atk: 120, spd: 120 },
      level: 27,
    });
    const b = mon('puffle', { level: 30 });
    let combos = 0;
    for (let i = 0; i < 400; i++) {
      for (const t of checkedBattle(a, b, `factor-${i}`).turns) {
        for (const x of t.actions) {
          const ms = (x.treeTriggers ?? []).filter(
            (e) => e.effect === 'multiplier' && e.side === 'a',
          );
          expect(ms.length).toBeLessThanOrEqual(1);
          if (ms[0]?.node === 'tempo:1') {
            combos++;
            // Underdog by 3 levels: 2.4x.
            expect(ms[0].detail).toContain('2.4x');
            expect(x.followThrough).toBe(true);
          }
        }
      }
    }
    expect(combos).toBeGreaterThan(0);
  });

  it('Initiative Read: two readers with equal SPD read nothing, so the roll decides', () => {
    const a = mon('sparkit', {
      tree: ['tempo:2'],
      moves: ['spark-nip', 'flash-ignite', 'hot-reload'],
    });
    const firsts = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const res = checkedBattle(a, a, `read-tie-${i}`);
      expect(entries(res).some((e) => e.node === 'tempo:2')).toBe(false);
      firsts.add(res.turns[0]!.first);
    }
    expect([...firsts].sort()).toEqual(['a', 'b']);
  });

  it('Opening Setup re-arms after an unused combo expires', () => {
    const a = mon('cinderpup', {
      tree: ['tempo:1'],
      moves: ['hotfix-howl', 'overclock', 'ember-maul'],
      stats: { hp: 400 },
    });
    const b = mon('pebblet', { moves: NO_PRIORITY, stats: { hp: 400, atk: 20 } });
    const res = findBattle(
      a,
      b,
      'setup-rearm',
      (r) => {
        const es = entries(r).filter((e) => e.node === 'tempo:1');
        const expired = es.findIndex((e) => e.effect === 'payoff_expired');
        return expired >= 0 && es.slice(expired + 1).some((e) => e.effect === 'payoff_armed');
      },
      2000,
    );
    expect(res).not.toBeNull();
  });

  it('Quartermaster defers the turn-2 pick and plays it on the base finisher turn', () => {
    const a = mon('pebblet', { tree: ['bastion:3'], stats: { ...strong, spd: 90 } });
    const b = mon('puffle', { stats: { atk: 30, hp: 600 } });
    const res = find(a, b, 'qm', { node: 'bastion:3', effect: 'finisher_early', step: 'pick' });
    const qm = entries(res!).filter((e) => e.node === 'bastion:3');
    expect(qm[0]!.turn).toBe(2);
    if (res!.turns.length >= 4) {
      expect(qm).toHaveLength(2);
      expect(qm[1]!.detail).toContain('deferred slot');
      const finisher = a.loadout!.moves![2];
      const aMoves = res!.turns.map(
        (t) => t.actions.find((x) => x.actor === 'a' && !x.doubleStrike)?.moveId,
      );
      expect(aMoves[1]).toBe(finisher);
      expect(aMoves.filter((id) => id === finisher)).toHaveLength(1);
    }
  });

  it('Bleed Line keeps a DEF-down alive for the next turn: Low Tide voids on turn N+1', () => {
    const a = mon('pebblet', {
      tree: ['strike:7:left', 'bastion:8'],
      moves: ['bedrock-slam', 'magma-vein', 'fault-line'],
      stats: { atk: 20, hp: 400 },
    });
    const b = mon('sparkit', {
      moves: ['spark-nip', 'flash-ignite', 'hot-reload'],
      stats: { hp: 400, atk: 160 },
    });
    const traced = (r: { turns: BattleTurn[] }) =>
      r.turns.some(
        (t) =>
          t.treeTriggers?.some(
            (e) => e.node === 'strike:7:left' && e.effect === 'status_refreshed',
          ) && turnHasVoid(r.turns[t.turn]),
      );
    const turnHasVoid = (t: BattleTurn | undefined) =>
      !!t?.actions.some((x) =>
        x.treeTriggers?.some((e) => e.node === 'bastion:8' && e.effect === 'void'),
      );
    const res = findBattle(a, b, 'bleed-tide', traced, 3000);
    expect(res).not.toBeNull();
    const refresh = entries(res!).find((e) => e.node === 'strike:7:left')!;
    expect(refresh).toMatchObject({ step: 'turn_end', host: 'turn' });
    expect(refresh.detail).toBe('Bleed Line: DEF-down kept through the next turn');
  });
});

describe('worked fights (talent-tree spec 5.2 to 5.4): key log lines', () => {
  const F1A = mon('cinderpup', {
    tree: [
      'tempo:1',
      'tempo:2',
      'tempo:3',
      'tempo:4',
      'tempo:5',
      'tempo:6',
      'tempo:7',
      'strike:1',
      'strike:2',
      'strike:3',
      'bastion:1',
      'bastion:2',
    ],
    moves: ['hotfix-howl', 'overclock', 'ember-maul'],
    stance: 'fury',
  });
  const F1B = mon('cinderpup', {
    moves: ['hotfix-howl', 'ember-bite', 'ashfang-strike'],
    stance: 'gale',
  });
  const F2A = mon('pebblet', {
    level: 40,
    tree: [
      'bastion:1',
      'bastion:2',
      'bastion:3',
      'bastion:4',
      'bastion:5',
      'bastion:6',
      'ward:1',
      'ward:2',
      'ward:3',
      'ward:4',
      'ward:5',
      'ward:6',
      'ward:7',
    ],
    moves: ['pebble-toss', 'landslide', 'monolith-drop'],
    stance: 'bulwark',
  });
  const F2B = mon('cinderpup', {
    level: 40,
    tree: [
      'strike:1',
      'strike:2',
      'strike:3',
      'strike:4',
      'strike:5',
      'strike:6',
      'strike:7',
      'strike:8',
      'strike:9',
      'strike:10',
    ],
    moves: ['ember-bite', 'overclock', 'ember-maul'],
    stance: 'fury',
  });
  const F3A = mon('cinderpup', {
    level: 50,
    tree: [
      'tempo:1',
      'tempo:2',
      'tempo:3',
      'tempo:4',
      'tempo:5',
      'tempo:6',
      'tempo:7:right',
      'tempo:8',
      'tempo:9',
      'tempo:10:right',
      'tempo:11',
      'tempo:12',
    ],
    moves: ['hotfix-howl', 'ember-bite', 'ember-maul'],
    stance: 'gale',
    stats: { hp: 300, atk: 30 },
  });
  const F3B = mon('cinderpup', {
    level: 50,
    tree: [
      'strike:1',
      'strike:2',
      'strike:3',
      'strike:4',
      'tempo:1',
      'tempo:2',
      'bastion:1',
      'bastion:2',
      'bastion:3',
      'ward:1',
      'ward:2',
    ],
    moves: ['hotfix-howl', 'ember-bite', 'ember-maul'],
    stance: 'fury',
    stats: { hp: 300, atk: 30 },
  });
  const turnHas = (t: BattleTurn | undefined, m: Match) =>
    !!t &&
    [...(t.treeTriggers ?? []), ...t.actions.flatMap((x) => x.treeTriggers ?? [])].some((e) =>
      matches(e, m),
    );

  it('Fight 1: Tempo Lock fizzles the foe Priority and the 1.2x combo lands on turn 2', () => {
    const res = findBattle(
      F1A,
      F1B,
      'fight1',
      (r) =>
        turnHas(r.turns[1], { node: 'tempo:7', effect: 'fizzled' }) &&
        turnHas(r.turns[1], { node: 'tempo:1', effect: 'multiplier' }),
      2000,
    );
    expect(res).not.toBeNull();
    const combo = entries(res!).find((e) => e.node === 'tempo:1' && e.effect === 'multiplier')!;
    expect(combo.detail).toContain('1.2x');
    expect(
      entries(res!).find((e) => e.node === 'tempo:1' && e.effect === 'payoff_armed')!.turn,
    ).toBe(1);
  });

  it('Fight 2: Opening Volley pierces a defense and Coup Rule hits 2.0x', () => {
    const res = findBattle(
      F2A,
      F2B,
      'fight2',
      (r) =>
        entries(r).some((e) => e.node === 'strike:2' && e.effect === 'pierced') &&
        entries(r).some((e) => e.node === 'strike:6' && e.effect === 'multiplier'),
      3000,
    );
    expect(res).not.toBeNull();
    expect(entries(res!).find((e) => e.node === 'strike:2')!.detail).toContain('pierced');
    expect(entries(res!).find((e) => e.node === 'strike:6')!.detail).toContain('2.0x');
  });

  it('Fight 3: Quick Recovery on turn 1, Order Snap suppresses, Initiative arms then overrides', () => {
    const res = findBattle(
      F3A,
      F3B,
      'fight3',
      (r) =>
        turnHas(r.turns[0], { side: 'a', node: 'tempo:8', effect: 'burn_tick_skipped' }) &&
        entries(r).some((e) => e.node === 'tempo:10:right' && e.effect === 'order_suppressed') &&
        entries(r).some((e) => e.node === 'tempo:12' && e.effect === 'order_override'),
      3000,
    );
    expect(res).not.toBeNull();
    const es = entries(res!);
    const armed = es.find((e) => e.node === 'tempo:12' && e.effect === 'payoff_armed')!;
    const override = es.find((e) => e.node === 'tempo:12' && e.effect === 'order_override')!;
    expect(armed).toMatchObject({ step: 'turn_end', host: 'turn' });
    expect(override).toMatchObject({ step: 'order', host: 'turn', turn: armed.turn + 1 });
    expect(res!.turns[override.turn - 1]!.first).toBe('a');
    const snapArm = es.find((e) => e.node === 'tempo:10:right' && e.effect === 'payoff_armed')!;
    const snap = es.find((e) => e.node === 'tempo:10:right' && e.effect === 'order_suppressed')!;
    expect(snap.turn).toBeGreaterThan(snapArm.turn);
    expect(snap.detail).toMatch(/SPD \d+ vs \d+/);
  });
});

const has = (es: Entry[], m: Match) => es.some((e) => matches(e, m));

describe('odd max HP: one integer line per clamp (201 HP)', () => {
  const ODD = 201;
  it('Bulwark Pulse lands on 100, never clamps from the line, and switches on Ballast/Keystone', () => {
    const a = mon('pebblet', { tree: ['ward:4', 'bastion:2', 'bastion:6'], stats: { hp: ODD } });
    const b = mon('puffle', { stats: { atk: 160, spd: 10 } });
    let pulses = 0;
    let credited = 0;
    for (let i = 0; i < 200; i++) {
      const { actions } = creditedBattle(a, b, `odd-pulse-${i}`);
      const pulseIdx = actions.findIndex((x) =>
        x.action.treeTriggers?.some((e) => e.node === 'ward:4' && e.effect === 'clamp'),
      );
      const all = actions.filter((x) =>
        x.action.treeTriggers?.some((e) => e.node === 'ward:4' && e.effect === 'clamp'),
      );
      expect(all.length).toBeLessThanOrEqual(1); // never re-fires from the line
      if (pulseIdx < 0) continue;
      pulses++;
      expect(actions[pulseIdx]!.action.targetHpAfter).toBe(100);
      expect(actions[pulseIdx]!.action.damage).toBeGreaterThan(0);
      const next = actions
        .slice(pulseIdx + 1)
        .find((x) => x.action.actor === 'a' && !x.action.doubleStrike);
      if (next && next.credits.some((n) => n === 'bastion:2' || n === 'bastion:6')) credited++;
    }
    expect(pulses).toBeGreaterThan(20);
    expect(credited).toBeGreaterThan(0);
  });
  it.each([
    ['bastion:3:alt', 'clamp', 50, 200],
    ['ward:6', 'lethal', 16, 400],
  ] as const)('%s leaves exactly floor(201 x line) HP', (node, step, left, atk) => {
    const a = mon('pebblet', { tree: [node], stats: { hp: ODD, def: 10 } });
    const b = mon('puffle', { stats: { atk, spd: 10 } });
    const res = findBattle(a, b, `odd-${node}`, (r) => has(entries(r), { node, effect: 'clamp' }));
    expect(res).not.toBeNull();
    const hit = res!.turns
      .flatMap((t) => t.actions)
      .find((x) => x.treeTriggers?.some((e) => e.node === node))!;
    expect(hit.targetHpAfter).toBe(left);
    expect(entries(res!).find((e) => e.node === node)).toMatchObject({ step });
  });
  it('Bulwark Cap caps a hit at floor(201 x 0.5) = 100', () => {
    const a = mon('pebblet', { tree: ['ward:12'], stats: { hp: ODD } });
    const b = mon('puffle', { stats: { atk: 400, spd: 10 } });
    const res = findBattle(a, b, 'odd-cap', (r) =>
      has(entries(r), { node: 'ward:12', effect: 'clamp' }),
    );
    const hit = res!.turns
      .flatMap((t) => t.actions)
      .find((x) => x.treeTriggers?.some((e) => e.node === 'ward:12'))!;
    expect(hit.damage).toBe(100);
  });
});

describe('interaction pairs (talent-tree spec 5.1)', () => {
  const runs = (a: MonSnapshot, b: MonSnapshot, tag: string, n = 200) =>
    Array.from({ length: n }, (_, i) => entries(checkedBattle(a, b, `${tag}-${i}`)));

  it('bastion:10:right Overwatch x foe tempo:1: the foe Opening Setup never arms', () => {
    const a = mon('pebblet', { tree: ['bastion:10:right'], stats: { hp: 400 } });
    const b = mon('cinderpup', { tree: ['tempo:1'], moves: BURN_OPENER });
    const all = runs(a, b, 'overwatch-combo');
    expect(all.some((es) => has(es, { node: 'bastion:10:right', effect: 'refused' }))).toBe(true);
    expect(all.some((es) => has(es, { node: 'tempo:1', effect: 'payoff_armed' }))).toBe(false);
  });

  it('ward:7 Layered Plating x foe strike:3: a refused status arms no Burn Ledger', () => {
    const a = mon('puffle', { tree: ['ward:7'], stats: { hp: 400 } });
    const b = mon('pebblet', {
      tree: ['strike:3'],
      moves: ['bedrock-slam', 'magma-vein', 'fault-line'],
    });
    let refused = 0;
    for (let i = 0; i < 200; i++)
      for (const t of checkedBattle(a, b, `plating-ledger-${i}`).turns)
        for (const x of t.actions) {
          if (!x.treeTriggers?.some((e) => e.node === 'ward:7' && e.effect === 'refused')) continue;
          refused++;
          expect(
            x.treeTriggers.some((e) => e.node === 'strike:3' && e.effect === 'payoff_armed'),
          ).toBe(false);
        }
    expect(refused).toBeGreaterThan(0);
  });

  it('tempo:8 Quick Recovery x foe strike:11: a skipped tick arms nothing', () => {
    const quick = mon('dripple', {
      tree: ['tempo:8'],
      moves: ['drip-tap', 'ripple-step', 'pressure-jet'],
      stats: { hp: 400, spd: 80 },
    });
    for (const [foe, node] of [
      [mon('cinderpup', { tree: ['strike:11'], moves: BURN_OPENER }), 'strike:11'],
    ] as const) {
      let skipped = 0;
      for (const es of runs(quick, foe, `quick-${node}`)) {
        const skip = es.find((e) => e.node === 'tempo:8' && e.effect === 'burn_tick_skipped');
        if (!skip) continue;
        skipped++;
        expect(
          es.some((e) => e.node === node && e.turn === skip.turn && e.step === 'turn_end'),
        ).toBe(false);
      }
      expect(skipped).toBeGreaterThan(0);
    }
  });

  it('Bedrock x pending crit: consumed as a normal hit, no guaranteed_crit entry', () => {
    const a = mon('pebblet', { tree: ['strike:9'], stats: strong });
    const b = mon('puffle', { passive: 'bedrock', stats: { hp: 400 } });
    const res = findBattle(a, b, 'bedrock', (r) =>
      has(entries(r), { node: 'strike:9', effect: 'payoff_consumed' }),
    );
    const x = res!.turns
      .flatMap((t) => t.actions)
      .find((y) => y.treeTriggers?.some((e) => e.effect === 'payoff_consumed'))!;
    expect(x.crit).toBe(false);
    expect(x.treeTriggers!.some((e) => e.effect === 'guaranteed_crit')).toBe(false);
  });

  it('a guaranteed crit cancelled by Brace Reflex writes no guaranteed_crit entry', () => {
    const a = mon('pebblet', { tree: ['strike:1'], stats: strong });
    const b = mon('puffle', { tree: ['ward:1'] });
    const res = findBattle(
      a,
      b,
      'gc-brace',
      (r) =>
        r.turns.some((t) =>
          t.actions.some(
            (x) =>
              x.treeTriggers?.some(
                (e) => e.node === 'strike:1' && e.effect === 'payoff_consumed',
              ) && x.treeTriggers.some((e) => e.node === 'ward:1' && e.effect === 'noncrit'),
          ),
        ),
      600,
    );
    expect(res).not.toBeNull();
    const x = res!.turns
      .flatMap((t) => t.actions)
      .find((y) => y.treeTriggers?.some((e) => e.node === 'ward:1'))!;
    expect(x.treeTriggers!.some((e) => e.effect === 'guaranteed_crit')).toBe(false);
  });

  it('Holdfast x Tough Hide: Holdfast refuses first, Tough Hide keeps its flag for a later status', () => {
    const a = mon('pebblet', { tree: ['bastion:11', 'bastion:7'], stats: { hp: 400 } });
    const b = mon('pebblet', { moves: STATUSER });
    const res = findBattle(a, b, 'holdfast-hide', (r) => {
      const es = entries(r);
      const hold = es.find((e) => e.node === 'bastion:11' && e.effect === 'refused');
      const hide = es.find((e) => e.node === 'bastion:7' && e.effect === 'refused');
      return !!hold && !!hide && hide.turn > hold.turn;
    });
    expect(res).not.toBeNull();
  });

  it('ward:9 Debt Refusal x foe strike:10:left: a refused DEF-down arms no Breaker', () => {
    const a = mon('puffle', { tree: ['ward:9'], stats: { hp: 400 } });
    const b = mon('pebblet', { tree: ['strike:10:left'], moves: STATUSER });
    let refused = 0;
    for (let i = 0; i < 200; i++) {
      for (const t of checkedBattle(a, b, `debt-${i}`).turns)
        for (const x of t.actions) {
          if (!x.treeTriggers?.some((e) => e.node === 'ward:9' && e.effect === 'refused')) continue;
          refused++;
          expect(x.treeTriggers.some((e) => e.node === 'strike:10:left')).toBe(false);
        }
    }
    expect(refused).toBeGreaterThan(0);
  });

  it('strike:12 Kill Clock x ward:5 Hard Shell: the pierce takes Hard Shell out', () => {
    const a = mon('pebblet', { tree: ['strike:12'], moves: STATUSER, stats: { atk: 120 } });
    const b = mon('puffle', { tree: ['ward:5'], stats: { hp: 300 } });
    const res = findBattle(
      a,
      b,
      'kill-shell',
      (r) => has(entries(r), { node: 'strike:12', effect: 'pierced' }),
      2000,
    );
    expect(res).not.toBeNull();
    const es = entries(res!);
    expect(es.find((e) => e.node === 'strike:12' && e.effect === 'pierced')!.detail).toBe(
      'Kill Clock: pierced Hard Shell',
    );
    const undodge = es.find((e) => e.node === 'strike:12' && e.effect === 'undodge');
    if (undodge) expect(undodge.detail).toBe('Kill Clock: cannot be dodged');
  });
});

describe('spend rules (spec 1.3)', () => {
  /** For a same-action source: every credit until the first landed credited action, none after. */
  const spentOnLand = (a: MonSnapshot, b: MonSnapshot, node: string, tag: string) => {
    let retried = 0;
    for (let i = 0; i < 300; i++) {
      const { actions } = creditedBattle(a, b, `${tag}-${i}`);
      const credited = actions.filter((x) => x.action.actor === 'a' && x.credits.includes(node));
      const firstLanded = credited.findIndex((x) => !x.action.dodged);
      if (firstLanded >= 0) expect(credited.length).toBe(firstLanded + 1);
      if (firstLanded > 0) retried++;
    }
    expect(retried).toBeGreaterThan(0);
  };
  it('strike:2 Opening Volley and tempo:3 Chain Priority are spent only when they bypass a defense', () => {
    for (const [a, node] of [
      [mon('pebblet', { tree: ['strike:2'], stats: { hp: 400, spd: 160 } }), 'strike:2'],
      [
        mon('cinderpup', {
          tree: ['tempo:3'],
          moves: ['ember-bite', 'overclock', 'ember-maul'],
          stats: { hp: 400 },
        }),
        'tempo:3',
      ],
    ] as const) {
      const b = mon('puffle', { tree: DEF_KIT, stats: { hp: 400 } });
      let bypassed = 0;
      for (let i = 0; i < 300; i++) {
        const { actions } = creditedBattle(a, b, `spend-${node}-${i}`);
        const credited = actions.filter((x) => x.action.actor === 'a' && x.credits.includes(node));
        const first = credited.findIndex((x) =>
          x.action.treeTriggers?.some((e) => e.node === node && e.effect === 'pierced'),
        );
        if (first < 0) continue;
        bypassed++;
        expect(credited.length).toBe(first + 1);
      }
      expect(bypassed).toBeGreaterThan(0);
    }
  });

  it('tempo:7:left Momentum is spent only when the action lands', () => {
    spentOnLand(
      mon('pebblet', { tree: ['tempo:7:left'], moves: NO_PRIORITY, stats: { hp: 400, spd: 20 } }),
      mon('sparkit', {
        moves: ['spark-nip', 'flash-ignite', 'hot-reload'],
        stats: { hp: 400, spd: 160 },
      }),
      'tempo:7:left',
      'spend-momentum',
    );
  });
  it('strike:7:right Opening Gambit only acts on turns 1 to 3 and logs only an overwritten dodge', () => {
    const a = mon('pebblet', { tree: ['strike:7:right'], stats: { spd: 30 } });
    const b = mon('puffle', { stats: { spd: 160 } });
    for (let i = 0; i < 200; i++) {
      const { actions } = creditedBattle(a, b, `gambit-${i}`);
      for (const x of actions) {
        if (x.credits.includes('strike:7:right')) expect(x.turn).toBeLessThanOrEqual(3);
        if (x.action.treeTriggers?.some((e) => e.node === 'strike:7:right'))
          expect(x.action.dodged).toBe(false);
      }
    }
  });
});

describe('fizzled actions (spec 1.4 fizzle row)', () => {
  it('a fizzled action reads its armed UNDODGE without consuming it, so it is never logged dodged', () => {
    // b's turn-1 hit drops a below 50%: Cut Short arms b's UNDODGE; a's Tempo Lock then fizzles
    // b's Priority, which must make the same draws as unfizzled (crit and variance follow).
    const a = mon('cinderpup', {
      tree: ['tempo:7'],
      moves: ['hotfix-howl', 'overclock', 'ember-maul'],
      stats: { hp: 300, spd: 160 },
    });
    const b = mon('pebblet', {
      tree: ['strike:3:alt'],
      moves: ['monolith-drop', 'pebble-toss', 'bedrock-slam'],
      stats: { atk: 260, hp: 400 },
    });
    let peeked = 0;
    for (let i = 0; i < 1000; i++) {
      const res = checkedBattle(a, b, `peek-${i}`);
      const es = entries(res);
      const armed = es.find((e) => e.node === 'strike:3:alt' && e.effect === 'payoff_armed');
      const fizzled = es.find((e) => e.node === 'tempo:7' && e.effect === 'fizzled');
      if (!armed || !fizzled || fizzled.turn !== armed.turn + 1) continue;
      peeked++;
      const turn = res.turns[fizzled.turn - 1]!;
      const action = turn.actions.find((x) => x.treeTriggers?.some((e) => e.effect === 'fizzled'))!;
      expect(action.dodged).toBe(false);
      expect(action.treeTriggers!.some((e) => e.effect === 'payoff_consumed')).toBe(false);
      // Still armed for the next action (or it expires two turns after arming).
      const later = es.filter((e) => e.node === 'strike:3:alt' && e.turn > fizzled.turn);
      if (res.turns.length > fizzled.turn) expect(later.length).toBeGreaterThan(0);
    }
    expect(peeked).toBeGreaterThan(0);
  });
});

describe('order overrides write only when they change the order', () => {
  it('tempo:2 Initiative Read logs order_override only when the roll disagreed', () => {
    const a = mon('pebblet', {
      tree: ['tempo:2'],
      moves: ['pebble-toss', 'pebble-toss', 'pebble-toss'],
      stats: { spd: 60, hp: 400 },
    });
    const b = mon('puffle', { moves: ['puff', 'puff', 'puff'], stats: { spd: 50, hp: 400 } });
    let decided = 0;
    let logged = 0;
    for (let i = 0; i < 200; i++) {
      for (const t of checkedBattle(a, b, `read-${i}`).turns) {
        expect(t.first).toBe('a');
        decided++;
        if (t.treeTriggers?.some((e) => e.node === 'tempo:2')) logged++;
      }
    }
    expect(logged).toBeGreaterThan(0);
    expect(logged).toBeLessThan(decided);
  });
});

describe('worked fights: more key lines (separate seeds where one seed cannot show all)', () => {
  const F2A = mon('pebblet', {
    level: 40,
    tree: [
      'bastion:1',
      'bastion:2',
      'bastion:3',
      'bastion:4',
      'bastion:5',
      'bastion:6',
      'ward:1',
      'ward:2',
      'ward:3',
      'ward:4',
      'ward:5',
      'ward:6',
      'ward:7',
    ],
    moves: ['pebble-toss', 'landslide', 'monolith-drop'],
    stance: 'bulwark',
  });
  const F2B = mon('cinderpup', {
    level: 40,
    tree: [
      'strike:1',
      'strike:2',
      'strike:3',
      'strike:4',
      'strike:5',
      'strike:6',
      'strike:7',
      'strike:8',
      'strike:9',
      'strike:10',
    ],
    moves: ['ember-bite', 'overclock', 'ember-maul'],
    stance: 'fury',
  });
  const F3A = mon('cinderpup', {
    level: 50,
    tree: [
      'tempo:1',
      'tempo:2',
      'tempo:3',
      'tempo:4',
      'tempo:5',
      'tempo:6',
      'tempo:7:right',
      'tempo:8',
      'tempo:9',
      'tempo:10:right',
      'tempo:11',
      'tempo:12',
    ],
    moves: ['hotfix-howl', 'ember-bite', 'ember-maul'],
    stance: 'gale',
    stats: { hp: 300, atk: 30 },
  });
  const F3B = mon('cinderpup', {
    level: 50,
    tree: [
      'strike:1',
      'strike:2',
      'strike:3',
      'strike:4',
      'tempo:1',
      'tempo:2',
      'bastion:1',
      'bastion:2',
      'bastion:3',
      'ward:1',
      'ward:2',
    ],
    moves: ['hotfix-howl', 'ember-bite', 'ember-maul'],
    stance: 'fury',
    stats: { hp: 300, atk: 30 },
  });
  const sameTurn = (r: { turns: BattleTurn[] }, ...ms: Match[]) =>
    r.turns.some((t) => {
      const es = [...(t.treeTriggers ?? []), ...t.actions.flatMap((x) => x.treeTriggers ?? [])];
      return ms.every((m) => es.some((e) => matches(e, m)));
    });
  it.each([
    [
      'Fight 2 Pressure Cascade pierces while behind',
      F2A,
      F2B,
      [{ side: 'b', node: 'strike:7', effect: 'pierced' }],
    ],
    [
      'Fight 2 Pulse holds a Priority hit at 50%',
      F2A,
      F2B,
      [{ side: 'a', node: 'ward:4', effect: 'clamp' }],
    ],
    [
      'Fight 2 Shortfuse pierces Lastline',
      F2A,
      F2B,
      [{ side: 'b', node: 'strike:4', effect: 'pierced', step: 'lethal' }],
    ],
    [
      'Fight 3 Setup Chain guaranteed crit',
      F3A,
      F3B,
      [{ side: 'a', node: 'tempo:7:right', effect: 'guaranteed_crit' }],
    ],
    [
      'Fight 3 Tempo Edge pierces Brace',
      F3A,
      F3B,
      [{ side: 'a', node: 'tempo:5', effect: 'pierced', step: 'crit' }],
    ],
    ['Fight 3 Rhythm arms', F3A, F3B, [{ side: 'a', node: 'tempo:4', effect: 'payoff_armed' }]],
    [
      'Fight 3 Burst Window arms',
      F3A,
      F3B,
      [{ side: 'a', node: 'tempo:11', effect: 'payoff_armed' }],
    ],
  ] as Array<[string, MonSnapshot, MonSnapshot, Match[]]>)('%s', (name, a, b, ms) => {
    expect(findBattle(a, b, name, (r) => sameTurn(r, ...ms), 2000)).not.toBeNull();
  });
});

describe('bastion:10:left Long Haul (50% line, deliberate deviation from the spec)', () => {
  it('erases Coup Rule while the owner is above 50% and fires in a legal Keel tree', () => {
    const a = crit(['strike:6', 'strike:8'], { atk: 140 });
    const legal = [
      'bastion:1',
      'bastion:2',
      'bastion:3',
      'bastion:4',
      'bastion:5',
      'bastion:6',
      'bastion:7',
      'bastion:8',
      'bastion:9',
      'bastion:10:left',
    ];
    const b = mon('pebblet', { tree: legal, stats: { hp: 300 } });
    let fired = 0;
    for (let i = 0; i < 300; i++) {
      for (const t of checkedBattle(a, b, `long-haul-${i}`).turns)
        for (const x of t.actions) {
          const es = x.treeTriggers ?? [];
          if (!es.some((e) => e.node === 'bastion:10:left' && e.effect === 'multiplier')) continue;
          fired++;
          expect(es.some((e) => e.side === 'a' && e.effect === 'multiplier')).toBe(false);
        }
    }
    expect(fired).toBeGreaterThan(0);
  });
});

// --- B1 review leftovers: battle-level checks ---------------------------------------------------

/** Side `side`'s main actions in order, with the engine's "landed three different moves in a row"
 * window evaluated from the log (a dodged, fizzled or telegraph action resets it). */
function windowHits(res: { turns: BattleTurn[] }, side: 'a' | 'b') {
  const out: Array<{
    turn: number;
    action: BattleTurn['actions'][number];
    window: boolean;
    reset: boolean;
  }> = [];
  let ids: string[] = [];
  for (const t of res.turns)
    for (const x of t.actions) {
      if (x.actor !== side || !x.moveId || x.doubleStrike) continue;
      const fizzled = x.treeTriggers?.some((e) => e.effect === 'fizzled') ?? false;
      const landed = !x.dodged && x.charge !== 'telegraph' && !fizzled;
      const reset = !landed && ids.length > 0;
      ids = landed ? [...ids.slice(-2), x.moveId] : [];
      out.push({
        turn: t.turn,
        action: x,
        window: ids.length === 3 && new Set(ids).size === 3,
        reset,
      });
    }
  return out;
}

describe('tempo:4 Rhythm / tempo:6 Flow State: the three-move streak and its reset', () => {
  it('Rhythm arms exactly at the first full window; a dodge or a charge telegraph resets it', () => {
    const a = mon('sparkit', {
      tree: ['tempo:4'],
      moves: CHARGE_OPENER,
      stats: { spd: 10, hp: 400 },
    });
    const b = mon('puffle', { stats: { spd: 160, hp: 600, atk: 20 } });
    let arms = 0;
    let resets = 0;
    for (let i = 0; i < 200; i++) {
      const res = checkedBattle(a, b, `rhythm-${i}`);
      const seq = windowHits(res, 'a');
      const first = seq.findIndex((x) => x.window && x.action.targetHpAfter > 0);
      const armedAt = seq.findIndex((x) =>
        x.action.treeTriggers?.some((e) => e.node === 'tempo:4' && e.effect === 'payoff_armed'),
      );
      expect(armedAt).toBe(first);
      if (armedAt >= 0) arms++;
      if (seq.slice(0, first < 0 ? seq.length : first).some((x) => x.reset)) resets++;
    }
    expect(arms).toBeGreaterThan(0);
    expect(resets).toBeGreaterThan(0);
  });

  it('Flow State clears only at a full window, never right after a dodge or telegraph reset', () => {
    const a = mon('sparkit', {
      tree: ['tempo:6'],
      moves: CHARGE_OPENER,
      stats: { spd: 10, hp: 400 },
    });
    const b = mon('pebblet', { moves: STATUSER, stats: { spd: 160, hp: 600, atk: 20 } });
    let cleared = 0;
    for (let i = 0; i < 300; i++) {
      const seq = windowHits(checkedBattle(a, b, `flow-${i}`), 'a');
      for (const x of seq)
        if (
          x.action.treeTriggers?.some((e) => e.node === 'tempo:6' && e.effect === 'status_cleared')
        ) {
          cleared++;
          expect(x.window).toBe(true);
        }
    }
    expect(cleared).toBeGreaterThan(0);
  });
});

describe('no tree rule fires after a knockout', () => {
  it('a finishing hit that applies a status, or a turn end after a KO, writes no tree entry', () => {
    const a = mon('cinderpup', {
      tree: ['strike:3', 'tempo:7:right', 'ward:11', 'nation.fire:2', 'nation.fire:4'],
      moves: BURN_OPENER,
      stats: { atk: 200 },
    });
    const b = mon('pebblet', { tree: ['strike:10:right', 'bastion:9'], stats: { hp: 120 } });
    let kos = 0;
    let statusKills = 0;
    for (let i = 0; i < 300; i++) {
      const res = checkedBattle(a, b, `ko-silence-${i}`);
      if (res.reason !== 'ko') continue;
      const last = res.turns.at(-1)!;
      const ko = last.actions.findIndex((x) => x.targetHpAfter === 0 && x.damage > 0);
      if (ko < 0) continue;
      kos++;
      const killing = last.actions[ko]!;
      if (killing.effect === 'burn') statusKills++;
      // The killing action may only log what happened before its hit (act_pre to clamp).
      for (const e of killing.treeTriggers ?? [])
        expect(['hit', 'status', 'turn_end']).not.toContain(e.step);
      for (const x of last.actions.slice(ko + 1)) expect(x.treeTriggers ?? []).toEqual([]);
      expect(last.treeTriggers?.filter((e) => e.step === 'turn_end') ?? []).toEqual([]);
    }
    expect(kos).toBeGreaterThan(0);
    expect(statusKills).toBeGreaterThan(0);
  });
});

describe('ward:11 Recovery Cycle: the integer 35% line (201 HP: below 70)', () => {
  it('heals at the end of a turn iff a hit or tick left HP below floor(201 x 0.35) = 70', () => {
    const a = mon('pebblet', { tree: ['ward:11'], stats: { hp: 201 } });
    const b = mon('cinderpup', { moves: BURN_OPENER, stats: { atk: 70 } });
    let heals = 0;
    let nearLine = 0;
    for (let i = 0; i < 300; i++) {
      const res = checkedBattle(a, b, `recovery-${i}`);
      let spent = false;
      for (const t of res.turns) {
        const lows = t.actions
          .filter((x) => x.damage > 0 && (x.actor === 'b' ? !!x.moveId : x.move === 'Burn'))
          .map((x) => x.targetHpAfter);
        const below = lows.some((h) => h < 70);
        if (lows.some((h) => h >= 70 && h <= 75)) nearLine++;
        const healed = t.actions.some((x) => x.actor === 'a' && x.move === 'Recovery Cycle');
        // No tree rule fires once either side is knocked out.
        const alive = res.turns.at(-1) !== t || (res.finalHp.a > 0 && res.finalHp.b > 0);
        if (!spent && alive && below && lows.every((h) => h > 0)) expect(healed).toBe(true);
        if (!below) expect(healed).toBe(false);
        if (healed) {
          heals++;
          spent = true;
        }
      }
    }
    expect(heals).toBeGreaterThan(0);
    expect(nearLine).toBeGreaterThan(0);
  });
});

// --- nation addendum 6.1: pairs that matter ------------------------------------------------------

type Action = BattleTurn['actions'][number];
const actionHas = (x: Action, ...ms: Match[]) =>
  ms.every((m) => (x.treeTriggers ?? []).some((e) => matches(e, m)));
const findAction = (
  a: MonSnapshot,
  b: MonSnapshot,
  tag: string,
  pred: (x: Action, t: BattleTurn) => boolean,
  max = 600,
) => {
  const res = findBattle(
    a,
    b,
    tag,
    (r) => r.turns.some((t) => t.actions.some((x) => pred(x, t))),
    max,
  );
  return res && res.turns.flatMap((t) => t.actions.filter((x) => pred(x, t)))[0]!;
};
/** Turns on which `side` is soaked at ORDER and at its actions (soak landed on an earlier turn,
 * within the two following turns), read from the log. */
const soakedTurns = (res: { turns: BattleTurn[] }, side: 'a' | 'b') => {
  const out = new Set<number>();
  for (const t of res.turns)
    if (t.actions.some((x) => x.actor !== side && x.nationPassive === 'soak'))
      for (const k of [1, 2]) out.add(t.turn + k);
  return out;
};

describe('nation interaction pairs (addendum 6.1)', () => {
  it('Kindling x Long Haul: Long Haul cancels the 2.0x while the defender is above 50%', () => {
    const a = fire(['nation.fire:1'], { stats: { spd: 120, atk: 120 } });
    const b = mon('pebblet', { tree: ['bastion:10:left'], stats: { hp: 300 } });
    let haul = 0;
    let kindling = 0;
    for (let i = 0; i < 300; i++)
      for (const t of checkedBattle(a, b, `kindling-haul-${i}`).turns)
        for (const x of t.actions) {
          if (actionHas(x, { node: 'bastion:10:left', effect: 'multiplier' })) {
            haul++;
            expect(actionHas(x, { node: 'nation.fire:1' })).toBe(false);
          }
          if (actionHas(x, { node: 'nation.fire:1', effect: 'multiplier' })) kindling++;
        }
    expect(haul).toBeGreaterThan(0);
    expect(kindling).toBeGreaterThan(0);
  });

  it('Inferno x Layered Plating: the burned foe Plating is pierced', () => {
    const a = mon('sparkit', {
      tree: ['nation.fire:6'],
      moves: ['hot-reload', 'force-push', 'inferno-impact'],
    });
    const b = mon('puffle', { tree: ['ward:7'], stats: { hp: 400 } });
    const x = findAction(a, b, 'inferno-plating', (y) =>
      actionHas(y, { node: 'nation.fire:6', effect: 'pierced', step: 'status' }),
    );
    expect(x!.treeTriggers!.find((e) => e.node === 'nation.fire:6')!.detail).toContain(
      'Layered Plating',
    );
  });

  it('Ember Spread x Breaker: Burn and DEF-down each arm, but they share the one PIERCE payoff', () => {
    // Sparkit: a DEF-down move (Breaker) and the ignite Burn (Ember Spread).
    const a = mon('sparkit', {
      tree: ['nation.fire:4', 'strike:10:left'],
      moves: ['hot-reload', 'force-push', 'inferno-impact'],
    });
    const res = findBattle(
      a,
      mon('puffle', { stats: { hp: 400 } }),
      'spread-breaker',
      (r) =>
        entries(r).some((e) => e.node === 'nation.fire:4' && e.effect === 'payoff_armed') &&
        entries(r).some((e) => e.node === 'strike:10:left' && e.effect === 'payoff_armed'),
      1000,
    );
    expect(res).not.toBeNull();
    for (const t of res!.turns)
      for (const x of t.actions) {
        const consumed = (x.treeTriggers ?? []).filter(
          (e) =>
            e.effect === 'payoff_consumed' &&
            (e.node === 'nation.fire:4' || e.node === 'strike:10:left'),
        );
        expect(consumed.length).toBeLessThanOrEqual(1);
      }
  });

  it('Kindle Chain x Ember Spread: one ignite arms a crit and a pierce, so Brace cannot cancel it', () => {
    const a = mon('sparkit', { tree: ['nation.fire:3', 'nation.fire:4'], stats: { hp: 400 } });
    const b = mon('puffle', { tree: ['ward:1'], stats: { hp: 400 } });
    const x = findAction(
      a,
      b,
      'chain-spread',
      (y) =>
        actionHas(
          y,
          { node: 'nation.fire:3', effect: 'payoff_consumed' },
          { node: 'nation.fire:4', effect: 'pierced', step: 'crit' },
        ),
      1000,
    );
    expect(x).not.toBeNull();
    expect(x!.crit).toBe(true);
    expect(actionHas(x!, { node: 'ward:1', effect: 'noncrit' })).toBe(false);
  });

  it('Undertow x Undertow Grip: one soak arms UNDODGE and PIERCE, consumed by the same next action', () => {
    const a = water(['nation.water:1', 'nation.water:4']);
    const res = findBattle(a, tank(), 'undertow-grip', (r) =>
      r.turns.some((t) =>
        t.actions.some((x) =>
          actionHas(
            x,
            { node: 'nation.water:1', effect: 'payoff_consumed' },
            { node: 'nation.water:4', effect: 'payoff_consumed' },
          ),
        ),
      ),
    );
    expect(res).not.toBeNull();
    const armedOn = res!.turns
      .flatMap((t) => t.actions)
      .find((x) => actionHas(x, { node: 'nation.water:1', effect: 'payoff_armed' }))!;
    expect(actionHas(armedOn, { node: 'nation.water:4', effect: 'payoff_armed' })).toBe(true);
    expect(armedOn.nationPassive).toBe('soak');
  });

  it('Undercurrent x Order Snap: both suppress 3c, never on two consecutive turns of one foe', () => {
    const a = water(['nation.water:3', 'tempo:10:right'], { stats: { hp: 400, spd: 60 } });
    const b = mon('sparkit', { moves: PRIORITY_SLOT2, stats: { hp: 400 } });
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const res = checkedBattle(a, b, `current-snap-${i}`);
      const turns = res.turns
        .filter((t) => t.treeTriggers?.some((e) => e.effect === 'order_suppressed'))
        .map((t) => t.turn);
      for (const t of turns) expect(turns).not.toContain(t + 1);
      for (const e of entries(res)) if (e.effect === 'order_suppressed') seen.add(e.node);
    }
    expect([...seen].sort()).toEqual(['nation.water:3', 'tempo:10:right']);
  });

  it('Release x Brace Reflex: the soak-expiry crit is cancelled by Brace without a pierce', () => {
    const a = water(['nation.water:5']);
    const b = mon('puffle', { tree: ['ward:1'], stats: { hp: 400 } });
    const x = findAction(
      a,
      b,
      'release-brace',
      (y) =>
        actionHas(
          y,
          { node: 'nation.water:5', effect: 'payoff_consumed' },
          { node: 'ward:1', effect: 'noncrit' },
        ),
      1000,
    );
    expect(x).not.toBeNull();
    expect(x!.crit).toBe(false);
  });

  it('Deep Current x Low Tide: one VOID per foe action, Deep Current first in the rung', () => {
    const a = water(['nation.water:10', 'bastion:8'], {
      moves: ['stream-splash', 'pressure-jet', 'deep-current'],
      stats: { def: 10 },
    });
    const b = mon('sparkit', {
      moves: ['spark-nip', 'flash-ignite', 'hot-reload'],
      stats: { hp: 400 },
    });
    const x = findAction(
      a,
      b,
      'deep-low',
      (y) =>
        actionHas(
          y,
          { node: 'nation.water:10', effect: 'void' },
          { node: 'bastion:8', effect: 'denied' },
        ),
      3000,
    );
    expect(x).not.toBeNull();
    expect(x!.treeTriggers!.find((e) => e.node === 'bastion:8')!.detail).toContain('Deep Current');
  });

  it('Undertow Pull x Anchor: Anchor is credited first on a soaked turn and Undertow Pull keeps its flag', () => {
    const a = water(['nation.water:10:left', 'bastion:5'], { stats: { hp: 400, spd: 46 } });
    const b = mon('sparkit', { moves: PRIORITY_SLOT2, stats: { hp: 400 } });
    let witnessed = 0;
    for (let i = 0; i < 600 && witnessed < 3; i++) {
      const res = checkedBattle(a, b, `pull-anchor-${i}`);
      const soaked = soakedTurns(res, 'b');
      const anchorTurn = entries(res).find(
        (e) => e.node === 'bastion:5' && e.effect === 'order_override',
      )?.turn;
      if (!anchorTurn || !soaked.has(anchorTurn)) continue;
      witnessed++;
      expect(
        entries(res).some((e) => e.node === 'nation.water:10:left' && e.turn === anchorTurn),
      ).toBe(false);
      // Its flag is intact: any later Undertow Pull override is its first.
      const pulls = entries(res).filter(
        (e) => e.node === 'nation.water:10:left' && e.effect === 'order_override',
      );
      expect(pulls.length).toBeLessThanOrEqual(1);
    }
    expect(witnessed).toBeGreaterThan(0);
  });

  it('Undercurrent before Undertow Pull: the 3c suppression is credited and Undertow Pull keeps its flag', () => {
    const a = water(['nation.water:3', 'nation.water:10:left'], { stats: { hp: 400, spd: 60 } });
    const b = mon('sparkit', { moves: PRIORITY_SLOT2, stats: { hp: 400 } });
    let witnessed = 0;
    let laterPull = 0;
    for (let i = 0; i < 400; i++) {
      const res = checkedBattle(a, b, `current-pull-${i}`);
      const es = entries(res);
      const sup = es.find((e) => e.node === 'nation.water:3' && e.effect === 'order_suppressed');
      if (!sup) continue;
      witnessed++;
      expect(res.turns[sup.turn - 1]!.first).toBe('a');
      expect(es.some((e) => e.node === 'nation.water:10:left' && e.turn === sup.turn)).toBe(false);
      const pulls = es.filter(
        (e) => e.node === 'nation.water:10:left' && e.effect === 'order_override',
      );
      expect(pulls.length).toBeLessThanOrEqual(1);
      if (pulls.some((e) => e.turn > sup.turn)) laterPull++;
    }
    expect(witnessed).toBeGreaterThan(0);
    expect(laterPull).toBeGreaterThan(0);
  });

  it('Order Snap before Undertow Pull: a turn Order Snap suppresses writes no Undertow Pull entry', () => {
    const a = water(['tempo:10:right', 'nation.water:10:left'], { stats: { hp: 400, spd: 60 } });
    const b = mon('sparkit', { moves: PRIORITY_SLOT2, stats: { hp: 400 } });
    let witnessed = 0;
    let laterPull = 0;
    for (let i = 0; i < 600; i++) {
      const res = checkedBattle(a, b, `snap-pull-${i}`);
      const es = entries(res);
      const snap = es.find((e) => e.node === 'tempo:10:right' && e.effect === 'order_suppressed');
      if (!snap || !soakedTurns(res, 'b').has(snap.turn)) continue;
      witnessed++;
      expect(es.some((e) => e.node === 'nation.water:10:left' && e.turn === snap.turn)).toBe(false);
      if (es.some((e) => e.node === 'nation.water:10:left' && e.turn > snap.turn)) laterPull++;
    }
    expect(witnessed).toBeGreaterThan(0);
    expect(laterPull).toBeGreaterThan(0);
  });

  it('Waterlogged x Debt Refusal: Waterlogged (1/turn) refuses first and Debt Refusal keeps its flag', () => {
    const a = water(['nation.water:7', 'ward:9'], { stats: { hp: 400 } });
    const b = mon('pebblet', { moves: STATUSER, stats: { hp: 400 } });
    const x = findAction(
      a,
      b,
      'logged-debt',
      (y) =>
        actionHas(
          y,
          { node: 'nation.water:7', effect: 'refused' },
          { node: 'ward:9', effect: 'denied' },
        ),
      1000,
    );
    expect(x).not.toBeNull();
  });

  it('Stand Firm x Strata: Strata arms at two hit turns, Stand Firm only at four (and while behind)', () => {
    const a = earth(['nation.earth:1', 'nation.earth:4'], { stats: { atk: 20 } });
    const res = findBattle(a, mon('puffle', { stats: { spd: 10 } }), 'firm-strata', (r) =>
      ['nation.earth:1', 'nation.earth:4'].every((n) =>
        has(entries(r), { node: n, effect: 'payoff_armed' }),
      ),
    );
    expect(res).not.toBeNull();
    const armTurn = (n: string) =>
      entries(res!).find((e) => e.node === n && e.effect === 'payoff_armed')!.turn;
    expect(armTurn('nation.earth:1')).toBeGreaterThan(armTurn('nation.earth:4'));
  });

  it('Monolith x Cool Head: Cool Head (state) cancels first and Monolith keeps its flag', () => {
    const a = earth(['nation.earth:6', 'bastion:7:right'], { stats: { hp: 400 } });
    const x = findAction(
      a,
      crit([]),
      'monolith-cool',
      (y) =>
        actionHas(
          y,
          { node: 'bastion:7:right', effect: 'noncrit' },
          { node: 'nation.earth:6', effect: 'denied' },
        ),
      1000,
    );
    expect(x).not.toBeNull();
  });

  it('Tectonic x Hold the Line: a hit crossing both lines stops at 28% and Hold the Line keeps its flag', () => {
    const a = earth(['nation.earth:7', 'bastion:3:alt'], { stats: { hp: 201, def: 10 } });
    const b = mon('puffle', { stats: { atk: 220, spd: 10 } });
    const x = findAction(
      a,
      b,
      'tectonic-hold',
      (y) => actionHas(y, { node: 'nation.earth:7', effect: 'clamp' }) && y.damage > 0,
    );
    expect(x!.targetHpAfter).toBe(Math.floor(201 * 0.28));
    expect(actionHas(x!, { node: 'bastion:3:alt' })).toBe(false);
  });

  it('Grounding x Tempo Lock: Tempo Lock fizzles first, Grounding logs denied', () => {
    const a = earth(['nation.earth:7:left', 'tempo:7'], {
      moves: ['magma-vein', 'bedrock-slam', 'monolith-drop'],
      stats: { hp: 400, atk: 120 },
    });
    const b = mon('sparkit', { moves: PRIORITY_SLOT2 });
    const x = findAction(
      a,
      b,
      'ground-lock',
      (y) =>
        actionHas(
          y,
          { node: 'tempo:7', effect: 'fizzled' },
          { node: 'nation.earth:7:left', effect: 'denied' },
        ),
      3000,
    );
    expect(x).not.toBeNull();
  });

  it('Glide Step x Riposte Step: one dodge arms a pierce and an undodge for one reply', () => {
    const a = air(['nation.air:1', 'ward:2'], { stats: { ...fast, hp: 400 } });
    const b = mon('pebblet', { stats: { spd: 10, hp: 400 } });
    const x = findAction(a, b, 'glide-riposte', (y) =>
      actionHas(
        y,
        { node: 'nation.air:1', effect: 'payoff_armed' },
        { node: 'ward:2', effect: 'payoff_armed' },
      ),
    );
    expect(x!.dodged).toBe(true);
  });

  it('Lift x Undertow: Lift never undodges for a soaked air mon; Undertow replies on those turns', () => {
    const a = air(['nation.air:2'], { stats: { hp: 400 } });
    const b = water(['nation.water:1'], { stats: { hp: 400, spd: 50 } });
    let lifts = 0;
    let undertows = 0;
    for (let i = 0; i < 300; i++) {
      const res = checkedBattle(a, b, `lift-undertow-${i}`);
      const soaked = soakedTurns(res, 'a');
      for (const t of res.turns) {
        let soakedNow = soaked.has(t.turn);
        for (const x of t.actions) {
          if (x.actor === 'b' && x.nationPassive === 'soak') soakedNow = true;
          if (actionHas(x, { node: 'nation.air:2', effect: 'undodge' })) {
            lifts++;
            expect(soakedNow).toBe(false);
          }
        }
      }
      undertows += entries(res).filter(
        (e) => e.node === 'nation.water:1' && e.effect === 'payoff_consumed',
      ).length;
    }
    expect(lifts).toBeGreaterThan(0);
    expect(undertows).toBeGreaterThan(0);
  });

  it('Tailwind Crown x Hard Shell: Hard Shell refuses first, Tailwind Crown keeps its turn use', () => {
    // The foe's only status move is its finisher, so Tailwind Crown is still unused when Hard
    // Shell (below 35%) can first refuse.
    const a = air(['nation.air:6', 'ward:5'], { stats: { hp: 300 } });
    const b = mon('pebblet', {
      moves: ['monolith-drop', 'landslide', 'fault-line'],
      stats: { atk: 200, spd: 10 },
    });
    const x = findAction(
      a,
      b,
      'crown-shell',
      (y) =>
        actionHas(
          y,
          { node: 'ward:5', effect: 'refused' },
          { node: 'nation.air:6', effect: 'denied' },
        ),
      3000,
    );
    expect(x).not.toBeNull();
  });

  it('Stance Fury x Kindling: the 2.0x crit on a burned foe also takes Exploit', () => {
    const a = fire(['nation.fire:1'], { stance: 'fury', stats: { spd: 120 } });
    const x = findAction(a, tank(), 'fury-kindling', (y) =>
      actionHas(y, { node: 'nation.fire:1', effect: 'multiplier' }),
    );
    expect(x!.stancePassives).toContainEqual({ side: 'a', stance: 'fury' });
  });

  it('Stance Bulwark x Drag: Drag cancels the crit and Bulwark still cuts that hit', () => {
    const a = water(['nation.water:2'], { stance: 'bulwark', stats: { hp: 300 } });
    const x = findAction(
      a,
      crit([], { atk: 90 }),
      'bulwark-drag',
      (y) =>
        actionHas(y, { node: 'nation.water:2', effect: 'noncrit' }) &&
        !!y.stancePassives?.some((p) => p.stance === 'bulwark'),
      1000,
    );
    expect(x).not.toBeNull();
    expect(x!.crit).toBe(false);
  });

  it('Main passive Wildfire delays Ash Cloud by one turn', () => {
    const armDelay = (passive?: string) => {
      const a = fire(['nation.fire:8'], { ...(passive ? { passive } : {}), stats: { atk: 20 } });
      const res = findBattle(a, tank({ atk: 20 }), `ash-${passive ?? 'none'}`, (r) =>
        entries(r).some((e) => e.node === 'nation.fire:8' && e.effect === 'payoff_armed'),
      );
      const burnTurn = res!.turns.find((t) =>
        t.actions.some((x) => x.actor === 'a' && x.moveId === 'hotfix-howl' && !x.dodged),
      )!.turn;
      return entries(res!).find((e) => e.node === 'nation.fire:8')!.turn - burnTurn;
    };
    expect(armDelay()).toBe(2);
    expect(armDelay('wildfire')).toBe(3);
  });

  it('Bedrock x nation crits: Stand Firm and Maelstrom are consumed as normal hits', () => {
    for (const [a, node] of [
      [earth(['nation.earth:1'], { stats: { hp: 400 } }), 'nation.earth:1'],
      [water(['nation.water:12'], { stats: { spd: 120 } }), 'nation.water:12'],
    ] as const) {
      const b = mon('puffle', { passive: 'bedrock', stats: { hp: 400 } });
      for (let i = 0; i < 150; i++)
        for (const t of checkedBattle(a, b, `bedrock-${node}-${i}`).turns)
          for (const x of t.actions)
            if (x.actor === 'a') {
              expect(x.crit).toBe(false);
              expect(actionHas(x, { node, effect: 'guaranteed_crit' })).toBe(false);
            }
    }
  });
});

// --- nation addendum 6.2: a water soak line against an air mon ----------------------------------

describe('example fight (addendum 6.2): water soak line against an air mon', () => {
  const A = mon('bubblit', {
    level: 14,
    tree: [
      'nation.water:1',
      'nation.water:2',
      'nation.water:3',
      'nation.water:4',
      'nation.water:5',
    ],
    moves: ['cache-wave', 'foam-barrier', 'full-outer-join'],
    stance: 'gale',
    stats: { hp: 300, atk: 40, def: 50, spd: 50 },
  });
  const B = mon('wispit', {
    level: 14,
    tree: ['nation.air:1', 'nation.air:2', 'nation.air:3', 'bastion:1'],
    moves: ['wisp-flick', 'zephyr-cut', 'riddle-of-the-docs'],
    stance: 'fury',
    stats: { hp: 300, atk: 40, def: 50, spd: 51.5 },
  });
  const turnHas = (t: BattleTurn | undefined, m: Match) =>
    !!t &&
    [...(t.treeTriggers ?? []), ...t.actions.flatMap((x) => x.treeTriggers ?? [])].some((e) =>
      matches(e, m),
    );

  it('turn 1 soak arms Undertow and Undertow Grip; Release arms at the turn-3 TURN_END', () => {
    let seen = 0;
    for (let i = 0; i < 400; i++) {
      const res = checkedBattle(A, B, `fight62-${i}`);
      const t1 = res.turns[0]!;
      expect(t1.first).toBe('b'); // only B's slot 1 is Priority
      if (!t1.actions.some((x) => x.actor === 'a' && x.nationPassive === 'soak')) continue;
      seen++;
      expect(turnHas(t1, { side: 'a', node: 'nation.water:1', effect: 'payoff_armed' })).toBe(true);
      expect(turnHas(t1, { side: 'a', node: 'nation.water:4', effect: 'payoff_armed' })).toBe(true);
      if (res.turns.length >= 3)
        expect(
          (res.turns[2]!.treeTriggers ?? []).some(
            (e) => e.node === 'nation.water:5' && e.effect === 'payoff_armed',
          ),
        ).toBe(true);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('turn 2: Undercurrent suppresses B Priority and A acts first with both payoffs', () => {
    const res = findBattle(
      A,
      B,
      'fight62-t2',
      (r) =>
        turnHas(r.turns[1], { side: 'a', node: 'nation.water:3', effect: 'order_suppressed' }) &&
        turnHas(r.turns[1], { side: 'a', node: 'nation.water:4', effect: 'payoff_consumed' }),
      2000,
    );
    expect(res).not.toBeNull();
    expect(res!.turns[1]!.first).toBe('a');
  });

  it('turn 4: B acts first and Headwind cancels the Release crit', () => {
    const res = findBattle(
      A,
      B,
      'fight62-t4',
      (r) => {
        const t4 = r.turns[3];
        return (
          t4?.first === 'b' &&
          t4.actions.some((x) =>
            actionHas(
              x,
              { side: 'a', node: 'nation.water:5', effect: 'payoff_consumed' },
              { side: 'b', node: 'nation.air:3', effect: 'noncrit' },
            ),
          )
        );
      },
      3000,
    );
    expect(res).not.toBeNull();
  });
});

// --- nation addendum 4.3: level-7 trace, fire versus water ---------------------------------------

describe('level-7 trace (addendum 4.3): Sparkit Kindle line against Dripple Undertow line', () => {
  const eq = { hp: 100, atk: 50, def: 50, spd: 50 };
  const A = mon('sparkit', {
    level: 7,
    tree: ['nation.fire:1', 'nation.fire:2', 'nation.fire:3'],
    stats: eq,
  });
  const B = mon('dripple', {
    level: 7,
    tree: ['nation.water:1', 'nation.water:2', 'nation.water:3:alt'],
    stats: eq,
  });
  const runs = Array.from({ length: 600 }, (_, i) => checkedBattle(A, B, `trace43-${i}`));

  it('uses the level-7 default loadouts and turn 1 (neutral Priority openers) writes nothing', () => {
    expect(A.loadout!.moves).toEqual(['spark-nip', 'hot-reload', 'force-push']);
    expect(B.loadout!.moves).toEqual(['drip-tap', 'stream-splash', 'backpressure']);
    for (const res of runs) {
      const t1 = res.turns[0]!;
      expect(t1.treeTriggers ?? []).toEqual([]);
      for (const x of t1.actions) {
        expect(x.treeTriggers ?? []).toEqual([]);
        expect(x.nationPassive).toBeUndefined();
      }
    }
  });

  it('Kindle Chain arms only on a landed ignite; Slack Tide refuses an ignite while A is soaked', () => {
    let kindle = 0;
    let slack = 0;
    for (const res of runs)
      for (const t of res.turns)
        for (const x of t.actions) {
          if (actionHas(x, { node: 'nation.fire:3', effect: 'payoff_armed' })) {
            kindle++;
            expect(x.nationPassive).toBe('ignite');
          }
          const refusal = x.treeTriggers?.find(
            (e) => e.node === 'nation.water:3:alt' && e.effect === 'refused',
          );
          if (refusal && refusal.detail.includes('ignite')) {
            slack++;
            expect(actionHas(x, { node: 'nation.fire:3' })).toBe(false);
          }
        }
    expect(kindle).toBeGreaterThan(0);
    expect(slack).toBeGreaterThan(0);
  });

  it('Undertow arms on a soak from turn 2 on and its reply is consumed by B next action', () => {
    const res = runs.find((r) =>
      entries(r).some((e) => e.node === 'nation.water:1' && e.effect === 'payoff_consumed'),
    );
    expect(res).toBeDefined();
    const arm = entries(res!).find(
      (e) => e.node === 'nation.water:1' && e.effect === 'payoff_armed',
    )!;
    expect(arm.turn).toBeGreaterThanOrEqual(2);
  });

  it('Drag cancels a Kindle Chain crit while A is soaked', () => {
    const hit = runs
      .flatMap((r) => r.turns.flatMap((t) => t.actions))
      .find((x) =>
        actionHas(
          x,
          { node: 'nation.fire:3', effect: 'payoff_consumed' },
          { node: 'nation.water:2', effect: 'noncrit' },
        ),
      );
    const res = hit
      ? hit
      : findAction(
          A,
          B,
          'trace43-drag',
          (x) =>
            actionHas(
              x,
              { node: 'nation.fire:3', effect: 'payoff_consumed' },
              { node: 'nation.water:2', effect: 'noncrit' },
            ),
          3000,
        );
    expect(res).toBeTruthy();
    expect(res!.crit).toBe(false);
  });
});
