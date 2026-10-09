/**
 * Diagnostic balance reports (talent-tree spec section 7, addendum section 8.3). Report only:
 * nothing here asserts; `balance.test.ts` runs it when `BALANCE_REPORT` is set. A diagnostic
 * becomes a gate only after its tuned baseline is recorded in the redesign's ADR.
 */
import { simulateBattle, snapshotFor, type MonSnapshot, type Side } from '../src/battle/battle.ts';
import { AIR_SPEED_MULT, WATER_SOAK_SPEED_MULT } from '../src/battle/effects.ts';
import { wildEncounterLevel } from '../src/battle/matchmaking.ts';
import { stageForLevel } from '../src/game/levels.ts';
import type { MonLoadout } from '../src/game/progression.ts';
import { SPECIES, defaultLoadoutMoveIds } from '../src/game/species.ts';
import { TREE_NODES, pointsAvailable } from '../src/game/tree.ts';
import { NATIONS, type Nation } from '../src/types.ts';
import {
  FORK_ROUTES,
  SHARED_BRANCHES,
  SIX_ARCHETYPES,
  archetypeLoadout,
  branchOnlyTree,
  hasStatusMove,
  mirrorPair,
  nodesByBranch,
  pct,
  prioritySlotMoves,
  roleLoadout,
  route,
  routeTo,
  treeCost,
  type BranchKey,
  type LoadoutFor,
} from './balanceRoutes.ts';
import { entries } from './treeTestUtils.ts';

const ALL = Object.keys(SPECIES);
const nationSpecies = (n: Nation) => ALL.filter((id) => SPECIES[id]!.nation === n);
const treeOf = (tree: Record<string, number>) => () => ({ tree });
const empty: LoadoutFor = () => ({});
const table = (head: string[], rows: Array<Array<string | number>>) =>
  [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
const inBand = (v: number, lo: number, hi: number) => (v >= lo && v <= hi ? 'ok' : 'OUT');
const atLeast = (v: number, t: number) => (v >= t ? 'ok' : 'BELOW');
const fits = (tree: Record<string, number>, level: number) =>
  treeCost(tree) <= pointsAvailable(level);
const LEVELS = [30, 50] as const;

function maxedRoutes(): string {
  const rows: Array<Array<string | number>> = [];
  const run = (key: BranchKey, species: string[]) => {
    let hpWins = 0;
    const s = mirrorPair(
      treeOf(route(key)),
      empty,
      species,
      50,
      100,
      (x, sp, k) => `diag-route-${key}-${x}-${sp}-${k}`,
      (r, side) => {
        if (r.reason !== 'ko' && r.winner === side) hpWins++;
      },
    );
    rows.push([
      key,
      species.join(', '),
      pct(s.rate),
      inBand(s.rate, 0.6, 0.73),
      (s.turns / s.battles).toFixed(2),
      pct(s.timeouts / s.battles),
      pct(hpWins / s.battles),
    ]);
  };
  for (const key of SHARED_BRANCHES) run(key, ALL);
  for (const n of NATIONS) run(`nation.${n}`, nationSpecies(n));
  return [
    '### Per-branch maxed routes vs empty (L50, 47-point centre route, target 60-73%)',
    '',
    'Strike is also the "Payoff stacking" row. Nation columns are reported for completeness.',
    '',
    table(
      ['Route', 'Species', 'Win rate', 'Target', 'Mean turns', 'Timeouts', 'Route wins on timeout'],
      rows,
    ),
  ].join('\n');
}

function nationForks(): string {
  const roles = ['centre', 'left', 'right'] as const;
  const rows: Array<Array<string | number>> = [];
  for (const n of NATIONS) {
    const key: BranchKey = `nation.${n}`;
    for (let i = 0; i < roles.length; i++)
      for (let j = i + 1; j < roles.length; j++) {
        const s = mirrorPair(
          treeOf(route(key, FORK_ROUTES[roles[i]!])),
          treeOf(route(key, FORK_ROUTES[roles[j]!])),
          nationSpecies(n),
          50,
          100,
          (_x, sp, seed) => `fork-${key}-${i}-${j}-${sp}-${seed}`,
        );
        rows.push([key, `${roles[i]} vs ${roles[j]}`, pct(s.rate), inBand(s.rate, 0.4, 0.6)]);
      }
  }
  return [
    '### Nation-column fork routes, centre / left / right mirrors (L50, own species)',
    '',
    'Not a gate: spec section 7 gates the four shared branches; addendum 8.1 gates only the nation `:7`/`:10` variants against the shared routes.',
    '',
    table(['Column', 'Pair', 'First route wins', 'Target 40-60%'], rows),
  ].join('\n');
}

function priorityDependence(): string {
  const lock = SIX_ARCHETYPES.find((a) => a.name === 'Tempo Lock')!;
  const rows: Array<Array<string | number>> = [];
  for (const level of LEVELS)
    for (const mode of ['default', 'priority slot 1', 'priority slot 2'] as const) {
      let wins = 0;
      let battles = 0;
      let fizzles = 0;
      for (const foe of SIX_ARCHETYPES.filter((a) => a !== lock)) {
        const s = mirrorPair(
          (sp) => archetypeLoadout(lock, sp, level),
          (sp) => ({
            ...archetypeLoadout(foe, sp, level),
            moves:
              (mode === 'default'
                ? null
                : prioritySlotMoves(sp, level, mode === 'priority slot 1' ? 0 : 1)) ??
              defaultLoadoutMoveIds(SPECIES[sp]!, level),
          }),
          ALL,
          level,
          20,
          (x, sp, k) => `diag-lock-${level}-${mode}-${foe.name}-${x}-${sp}-${k}`,
        );
        wins += s.rate * s.battles;
        battles += s.battles;
        for (const f of s.xFired.values()) fizzles += f.get('tempo:7') ?? 0;
      }
      const rate = wins / battles;
      const fire = fizzles / battles;
      rows.push([
        `L${level}`,
        mode,
        pct(rate),
        rate <= 0.6 ? 'ok' : 'OVER',
        pct(fire),
        mode === 'priority slot 1' ? atLeast(fire, 0.2) : '',
      ]);
    }
  return [
    '### Priority dependence: Tempo Lock vs the other five archetypes (all species, mirror)',
    '',
    'Win rate target at most 60%; `tempo:7` target rate (any entry) at least 20% with the foe Priority in slot 1. Tempo Lock uses its role loadout (slot 1 Burn, slot 2 crit_up); species without a Burn move fall back to their strongest move.',
    '',
    table(['Level', 'Foe loadout', 'Tempo Lock win', 'Target', 'tempo:7 fires', 'Target'], rows),
  ].join('\n');
}

function firstAction(): string {
  const rows: Array<Array<string | number>> = [];
  for (const level of [10, 30, 50]) {
    let first = 0;
    let turns = 0;
    for (const a of ALL)
      for (const b of ALL) {
        if (a === b || SPECIES[a]!.nation === SPECIES[b]!.nation) continue;
        const sa = snapshotFor(input(a, level, 'a'));
        const sb = snapshotFor(input(b, level, 'b'));
        for (let i = 0; i < 50; i++) {
          const r = simulateBattle(sa, sb, `diag-first-${level}-${a}-${b}-${i}`);
          turns += r.turns.length;
          first += r.turns.filter((t) => t.first === 'a').length;
        }
      }
    rows.push([
      `no tree, cross-nation round-robin, side a, L${level}`,
      pct(first / turns),
      inBand(first / turns, 0.45, 0.55),
    ]);
  }
  const initiative = SIX_ARCHETYPES.find((a) => a.name === 'Initiative Max')!;
  for (const [label, x] of [
    [
      'Initiative Max archetype vs empty, L50',
      (sp: string) => archetypeLoadout(initiative, sp, 50),
    ],
    ['tempo centre route (47) vs empty, L50', treeOf(route('tempo'))],
  ] as const) {
    let first = 0;
    let turns = 0;
    mirrorPair(
      x,
      empty,
      ALL,
      50,
      100,
      (f, sp, k) => `diag-init-${label}-${f}-${sp}-${k}`,
      (r, side) => {
        turns += r.turns.length;
        first += r.turns.filter((t) => t.first === side).length;
      },
    );
    rows.push([label, pct(first / turns), first / turns <= 0.65 ? 'ok' : 'OVER']);
  }
  return [
    '### First-action share',
    '',
    'No-tree target 45-55% (the spec calls this gated and existing; no such test existed, so it is measured here). Initiative route target at most 65%.',
    '',
    table(['Run', 'First-action share', 'Target'], rows),
  ].join('\n');
}

function initiativeArming(): string {
  const rows: Array<Array<string | number>> = [];
  let long = 0;
  let armed = 0;
  let battles = 0;
  const foes: Array<[string, LoadoutFor]> = [
    ['empty', empty],
    ...SIX_ARCHETYPES.map((a): [string, LoadoutFor] => [
      a.name,
      (sp) => archetypeLoadout(a, sp, 50),
    ]),
  ];
  for (const [name, foe] of foes) {
    let l = 0;
    let a = 0;
    mirrorPair(
      treeOf(route('tempo')),
      foe,
      ALL,
      50,
      50,
      (f, sp, k) => `diag-arm-${name}-${f}-${sp}-${k}`,
      (r, side) => {
        battles++;
        if (r.turns.length < 8) return;
        l++;
        if (
          entries(r).some(
            (e) => e.side === side && e.node === 'tempo:12' && e.effect === 'payoff_armed',
          )
        )
          a++;
      },
    );
    long += l;
    armed += a;
    rows.push([name, l, l ? pct(a / l) : 'n/a', l ? atLeast(a / l, 0.8) : '']);
  }
  rows.push(['all', long, pct(armed / long), atLeast(armed / long, 0.8)]);
  return [
    '### Initiative arming rate (`tempo:12`, full tempo route, L50, equal SPD mirror)',
    '',
    `Share of battles of 8 or more turns in which \`tempo:12\` arms; target at least 80%. ${pct(long / battles)} of all battles reach 8 turns.`,
    '',
    table(['Foe', 'Battles >= 8 turns', 'Armed', 'Target'], rows),
  ].join('\n');
}

function earlyChoices(): string {
  const routes: Record<string, string[]> = {
    '(i)': ['strike:1', 'strike:2', 'strike:3', 'tempo:1', 'tempo:2', 'ward:1'],
    '(ii)': ['bastion:1', 'bastion:2', 'bastion:3', 'ward:1', 'ward:2', 'strike:1'],
    '(iii)': ['bastion:1', 'bastion:2', 'bastion:3:alt', 'tempo:1', 'tempo:2', 'ward:1'],
  };
  const t = (k: string) => Object.fromEntries(routes[k]!.map((id) => [id, 1]));
  const rows: Array<Array<string | number>> = [];
  const keys = Object.keys(routes);
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const s = mirrorPair(
        treeOf(t(keys[i]!)),
        treeOf(t(keys[j]!)),
        ALL,
        10,
        100,
        (x, sp, k) => `diag-early-${i}-${j}-${x}-${sp}-${k}`,
      );
      rows.push([`${keys[i]} vs ${keys[j]}`, pct(s.rate), inBand(s.rate, 0.4, 0.6)]);
    }
  return [
    '### Early choices (L10, 7 points, all species)',
    '',
    table(['Pair', 'First route wins', 'Target 40-60%'], rows),
  ].join('\n');
}

function archetypePairs(): string {
  const rows: Array<Array<string | number>> = [];
  for (const level of LEVELS)
    for (const n of NATIONS) {
      const keys = [...nodesByBranch(n).keys()];
      for (let i = 0; i < keys.length; i++)
        for (let j = i + 1; j < keys.length; j++) {
          const lo =
            (key: BranchKey): LoadoutFor =>
            (sp) => ({
              tree: branchOnlyTree(key, level),
              moves: roleLoadout(sp, level, [['burn', 'def_down'], ['priority']]),
            });
          const s = mirrorPair(
            lo(keys[i]!),
            lo(keys[j]!),
            nationSpecies(n),
            level,
            100,
            (x, sp, k) => `diag-apair-${level}-${keys[i]}-${keys[j]}-${x}-${sp}-${k}`,
          );
          rows.push([
            `L${level}`,
            n,
            `${keys[i]} vs ${keys[j]}`,
            pct(s.rate),
            inBand(s.rate, 0.4, 0.6),
          ]);
        }
    }
  return [
    '### Branch pairs with archetype loadouts (slot 1 status opener, Priority in slot 2)',
    '',
    'Same pairs as the gated line-584 test, with the section 6 loadout instead of the default one.',
    '',
    table(['Level', 'Nation', 'Pair', 'First wins', 'Target 40-60%'], rows),
  ].join('\n');
}

function priorityKeyed(): string {
  const rows: Array<Array<string | number>> = [];
  for (const id of ['bastion:5', 'tempo:7', 'bastion:8', 'bastion:10:right'])
    for (const level of LEVELS) {
      const own = routeTo(TREE_NODES[id]!);
      if (!fits(own, level)) {
        rows.push([id, `L${level}`, 'n/a (route over budget)', '', '', '']);
        continue;
      }
      const rate = (slot: 0 | 1) => {
        const s = mirrorPair(
          treeOf(own),
          (sp) => ({
            moves: prioritySlotMoves(sp, level, slot) ?? defaultLoadoutMoveIds(SPECIES[sp]!, level),
          }),
          ALL,
          level,
          40,
          (x, sp, k) => `diag-pk-${id}-${level}-${slot}-${x}-${sp}-${k}`,
        );
        return [...s.xFired.values()].reduce((sum, f) => sum + (f.get(id) ?? 0), 0) / s.battles;
      };
      const s1 = rate(0);
      const s2 = rate(1);
      rows.push([id, `L${level}`, pct(s1), atLeast(s1, 0.2), pct(s2), atLeast(s2, 0.3)]);
    }
  return [
    '### Priority-keyed arming rate (owner: cheapest route to the node, default loadout; foe: empty tree)',
    '',
    table(
      [
        'Node',
        'Level',
        'Foe Priority slot 1',
        'Target >= 20%',
        'Foe Priority slot 2',
        'Target >= 30%',
      ],
      rows,
    ),
  ].join('\n');
}

interface FireCount {
  n: number;
  fired: number;
}
const add = (m: Map<string, FireCount>, k: string, fired: boolean) => {
  const c = m.get(k) ?? { n: 0, fired: 0 };
  c.n++;
  c.fired += Number(fired);
  m.set(k, c);
};
const rateOf = (c?: FireCount) => (c && c.n ? c.fired / c.n : NaN);
const fmtRate = (x: number) => (Number.isNaN(x) ? 'n/a' : pct(x));

/** Nodes inert in every default loadout by construction (`tempo:1` needs a slot-1 Burn or
 * DEF-down, `tempo:9` a Charge move); exempt from the default-loadout flag (user decision, D2). */
export const LOADOUT_KEYED: ReadonlySet<string> = new Set(['tempo:1', 'tempo:9']);

function nodeFiring(): { text: string; low: string[] } {
  // key: `${node}|${level}|${bucket}`
  const counts = new Map<string, FireCount>();
  const perSpecies = new Map<string, FireCount>(); // `${species}|${node}`
  const defensive = new Set(['Counterfire Ward', 'Bastion Wall']);
  const ARMING = new Set(['denied', 'payoff_armed', 'payoff_expired', 'payoff_lost']);
  const runs = [...LEVELS.map((level) => ({ level, role: false })), { level: 50, role: true }];
  for (const { level, role } of runs)
    for (const node of Object.values(TREE_NODES)) {
      const own = routeTo(node);
      if (!fits(own, level)) continue;
      const species = node.nation ? nationSpecies(node.nation) : ALL;
      const owner: LoadoutFor = role
        ? (sp) => ({
            tree: own,
            moves: roleLoadout(sp, level, [['burn', 'def_down'], ['priority']]),
          })
        : treeOf(own);
      for (const arch of SIX_ARCHETYPES) {
        mirrorPair(
          owner,
          (sp) => archetypeLoadout(arch, sp, level),
          species,
          level,
          20,
          (x, sp, k) => `diag-fire-${node.id}-${level}-${role}-${arch.name}-${x}-${sp}-${k}`,
          (r, side, sp) => {
            const mine = entries(r).filter((e) => e.side === side && e.node === node.id);
            const fired = mine.some((e) => e.effect !== 'denied');
            if (role) return add(counts, `${node.id}|${level}|role`, fired);
            const status = hasStatusMove(archetypeLoadout(arch, sp, level).moves!, sp);
            add(counts, `${node.id}|${level}|all`, fired);
            add(
              counts,
              `${node.id}|${level}|outcome`,
              mine.some((e) => !ARMING.has(e.effect)),
            );
            add(counts, `${node.id}|${level}|${status ? 'status' : 'nostatus'}`, fired);
            if (defensive.has(arch.name)) add(counts, `${node.id}|${level}|def`, fired);
            add(perSpecies, `${sp}|${node.id}`, fired);
          },
        );
      }
    }
  const rows: Array<Array<string | number>> = [];
  const low: string[] = [];
  for (const node of Object.values(TREE_NODES)) {
    const r = (level: number, b: string) => rateOf(counts.get(`${node.id}|${level}|${b}`));
    const measured = LEVELS.map((l) => r(l, 'all')).filter((x) => !Number.isNaN(x));
    const best = Math.max(...measured);
    // Approved exception (step D2): slot-1-status and Charge nodes are inert in the default
    // loadout by construction; `balance.test.ts` checks them with an enabling loadout instead.
    const flag = LOADOUT_KEYED.has(node.id)
      ? 'loadout-keyed'
      : best < 0.05
        ? '**<5%**'
        : best < 0.15
          ? '<15%'
          : '';
    if (flag)
      low.push(
        `${node.id} ${node.name}: L30 ${fmtRate(r(30, 'all'))}, L50 ${fmtRate(r(50, 'all'))} ${flag}`,
      );
    rows.push([
      node.id,
      node.name,
      node.effect,
      fmtRate(r(30, 'all')),
      fmtRate(r(50, 'all')),
      fmtRate(r(50, 'status')),
      fmtRate(r(50, 'nostatus')),
      fmtRate(r(50, 'def')),
      fmtRate(r(50, 'outcome')),
      fmtRate(r(50, 'role')),
      flag,
    ]);
  }
  const inert: string[] = [];
  for (const sp of ALL) {
    const zero = Object.values(TREE_NODES)
      .filter((n) => !n.nation || n.nation === SPECIES[sp]!.nation)
      .filter((n) => perSpecies.get(`${sp}|${n.id}`)?.fired === 0)
      .map((n) => n.id);
    inert.push(`- ${sp}: ${zero.length ? zero.join(', ') : 'none'}`);
  }
  const text = [
    '### Node firing rate (all 136 nodes, target at least 15%, fallback below 5%)',
    '',
    'Owner: the cheapest legal route to the node (its branch from tier 1 up to the node, the alternative in place of its centre), default loadout and stance. Foe: the same species with each of the six section 6 archetypes (tree fitted to the budget, role loadout, archetype stance), 20 seeds per side order. A node fires in a battle when its owner writes any entry except `denied`. "n/a" at L30 = the route costs more than 27 points. Columns 6 to 8 split the L50 runs: foe loadout with or without a Burn/DEF-down move, and only against the Counterfire Ward and Bastion Wall archetypes (the foes that own tree defenses a PIERCE can bypass). Column 9 counts only entries that changed an outcome (not `payoff_armed`, `payoff_expired`, `payoff_lost`). Column 10 reruns L50 with the owner on a slot-1 Burn/DEF-down, slot-2 Priority loadout (the default loadout puts Priority in slot 1 for every species, which makes slot-1-status nodes such as `tempo:1` inert by construction). The flag uses the default-loadout L30/L50 rates (spec metric).',
    '',
    table(
      [
        'Node',
        'Name',
        'Effect',
        'L30',
        'L50',
        'L50 foe has status move',
        'L50 foe no status move',
        'L50 vs Ward/Bastion',
        'L50 outcome entries only',
        'L50 owner status+Priority loadout',
        'Flag',
      ],
      rows,
    ),
    '',
    '#### Nodes with zero firings per species (empirical inert list, all measured levels and archetypes)',
    '',
    ...inert,
  ].join('\n');
  return { text, low };
}

function mainPassive(): string {
  const rows: Array<Array<string | number>> = [];
  for (const id of ['ward:7', 'strike:7', 'strike:10'])
    for (const level of LEVELS) {
      const own = routeTo(TREE_NODES[id]!);
      if (!fits(own, level)) {
        rows.push([id, `L${level}`, 'n/a', 'n/a', 'n/a']);
        continue;
      }
      const cells = (['', 'shared:aftershock', 'shared:wildfire'] as const).map((passive) => {
        let fired = 0;
        let n = 0;
        const withP = (t: Record<string, number>) => (passive ? { ...t, [passive]: 1 } : t);
        for (const arch of SIX_ARCHETYPES) {
          const s = mirrorPair(
            () => ({ tree: withP(own) }),
            (sp) => {
              const lo = archetypeLoadout(arch, sp, level);
              return { ...lo, tree: withP(lo.tree!) };
            },
            ALL,
            level,
            20,
            (x, sp, k) => `diag-mp-${id}-${level}-${passive}-${arch.name}-${x}-${sp}-${k}`,
          );
          n += s.battles;
          for (const f of s.xFired.values()) fired += f.get(id) ?? 0;
        }
        return pct(fired / n);
      });
      rows.push([id, `L${level}`, ...cells]);
    }
  return [
    '### Main-passive status arming: fire rates with and without Aftershock / Wildfire (both sides)',
    '',
    table(['Node', 'Level', 'No main passive', 'Aftershock', 'Wildfire'], rows),
  ].join('\n');
}

function nationColumns(): string {
  const out: string[] = [
    '### Nation columns (addendum 8.3): centre route vs each shared centre route',
  ];
  const fireRows: Array<Array<string | number>> = [];
  const waterRows: Array<Array<string | number>> = [];
  const earthRows: Array<Array<string | number>> = [];
  for (const n of NATIONS)
    for (const level of LEVELS) {
      const key: BranchKey = `nation.${n}`;
      const perSpecies = new Map<string, { wins: number; n: number }>();
      let turns = 0;
      let burnedTurns = 0;
      let soakedTurns = 0;
      let deniedTurns = 0;
      let twoSoaks = 0;
      let battles = 0;
      let crits = 0;
      let earthCrits = 0;
      for (const shared of SHARED_BRANCHES) {
        const s = mirrorPair(
          treeOf(branchOnlyTree(key, level)),
          treeOf(branchOnlyTree(shared, level)),
          nationSpecies(n),
          level,
          100,
          (x, sp, k) => `diag-nat-${key}-${shared}-${level}-${x}-${sp}-${k}`,
          (r, side) => {
            const foe: Side = side === 'a' ? 'b' : 'a';
            battles++;
            turns += r.turns.length;
            const soaks = r.turns
              .filter((t) => t.actions.some((a) => a.actor === side && a.nationPassive === 'soak'))
              .map((t) => t.turn);
            if (soaks.length >= 2) twoSoaks++;
            for (const t of r.turns) {
              if (t.actions.some((a) => a.moveId === null && a.move === 'Burn' && a.actor === foe))
                burnedTurns++;
              if (soaks.some((s0) => t.turn >= s0 && t.turn <= s0 + 2)) soakedTurns++;
              const log = [
                ...(t.treeTriggers ?? []),
                ...t.actions.flatMap((a) => a.treeTriggers ?? []),
              ];
              if (
                log.some(
                  (e) =>
                    e.side === side &&
                    e.node.startsWith('nation.water') &&
                    ['void', 'fizzled', 'order_override', 'order_suppressed'].includes(e.effect),
                )
              )
                deniedTurns++;
              for (const a of t.actions) {
                if (a.actor !== side || !a.crit || a.doubleStrike) continue;
                crits++;
                if (
                  a.treeTriggers?.some((e) =>
                    ['nation.earth:10', 'nation.earth:7:right', 'nation.earth:12'].includes(e.node),
                  )
                )
                  earthCrits++;
              }
            }
          },
        );
        for (const [sp, c] of s.perSpecies) {
          const p = perSpecies.get(sp) ?? { wins: 0, n: 0 };
          p.wins += c.wins;
          p.n += c.n;
          perSpecies.set(sp, p);
        }
      }
      if (n === 'fire')
        for (const [sp, c] of perSpecies) {
          const burn = SPECIES[sp]!.movePool.some(
            (m) => m.effect === 'burn' && m.unlocksAt <= level,
          );
          fireRows.push([
            `L${level}`,
            sp,
            burn ? 'yes' : 'no',
            pct(c.wins / c.n),
            inBand(c.wins / c.n, 0.4, 0.6),
            pct(burnedTurns / turns),
          ]);
        }
      if (n === 'water')
        waterRows.push([
          `L${level}`,
          pct(soakedTurns / turns),
          inBand(soakedTurns / turns, 0.2, 0.5),
          pct(twoSoaks / battles),
          level === 30 ? atLeast(twoSoaks / battles, 0.15) : '',
          pct(deniedTurns / turns),
        ]);
      if (n === 'earth') earthRows.push([`L${level}`, crits, pct(earthCrits / crits)]);
    }
  out.push(
    '',
    '#### Fire: column win rate per species (avg over the four shared routes) and share of turns ending with a Burn tick on the foe (proxy for "foe burned")',
    '',
    table(
      [
        'Level',
        'Species',
        'Burn move unlocked',
        'Column win',
        'Gate band 40-60%',
        'Foe Burn-tick turns (nation)',
      ],
      fireRows,
    ),
    '',
    '#### Water: soak uptime (turns the foe is soaked at any point: landing turn and the next two), second soak landing, denial',
    '',
    table(
      [
        'Level',
        'Soak uptime',
        'Target 20-50%',
        'Battles with >= 2 soak landings',
        'Target >= 15% (L30)',
        'Turns with a water VOID/FIZZLE/ORDER on the foe',
      ],
      waterRows,
    ),
    '',
    "#### Earth: share of the column owner's crits carrying a Hardrock, Fault Line or Continent entry (the L30 route, tiers 1 to 8 centre, holds none of them)",
    '',
    table(['Level', 'Crits', 'Share'], earthRows),
  );
  return out.join('\n');
}

function airAndKindle(): string {
  const leadRows: Array<Array<string | number>> = [];
  for (const sp of nationSpecies('air'))
    for (const level of LEVELS) {
      let turns = 0;
      let lead = 0;
      for (const foe of ALL.filter((f) => f !== sp)) {
        const a = snapshotFor(input(sp, level, 'a'));
        const b = snapshotFor(input(foe, level, 'b'));
        for (let i = 0; i < 50; i++) {
          const r = simulateBattle(a, b, `diag-lead-${level}-${sp}-${foe}-${i}`);
          const soaks = r.turns
            .filter((t) => t.actions.some((x) => x.actor === 'b' && x.nationPassive === 'soak'))
            .map((t) => t.turn);
          for (const t of r.turns) {
            const soaked = soaks.some((s0) => t.turn > s0 && t.turn <= s0 + 2);
            const ratio =
              (a.stats.spd * AIR_SPEED_MULT * (soaked ? WATER_SOAK_SPEED_MULT : 1)) / b.stats.spd;
            turns++;
            if (ratio >= 1.1) lead++;
          }
        }
      }
      const strat = mirrorAgainstOthers(
        sp,
        level,
        routeTo(TREE_NODES['nation.air:8']!),
        'nation.air:8',
      );
      leadRows.push([sp, `L${level}`, pct(lead / turns), atLeast(lead / turns, 0.6), strat]);
    }
  let kindled = 0;
  let battles = 0;
  for (const sp of nationSpecies('fire'))
    for (const foe of ALL.filter((f) => SPECIES[f]!.nation !== 'fire')) {
      const a = snapshotFor(input(sp, 30, 'a'));
      const b = snapshotFor(input(foe, 30, 'b'));
      for (let i = 0; i < 50; i++) {
        const r = simulateBattle(a, b, `diag-kindle-${sp}-${foe}-${i}`);
        battles++;
        if (
          r.turns.some((t) =>
            t.actions.some((x) => x.actor === 'a' && x.nationPassive === 'ignite'),
          )
        )
          kindled++;
      }
    }
  return [
    '### Air speed lead and Stratosphere against other species (empty trees, start-of-turn state)',
    '',
    'Lead = own SPD x 1.12 (x 0.72 while soaked) over the foe SPD with its air trait divided out, as `spdLead` computes it. Stratosphere = `nation.air:8` with its cheapest route against every other species (empty tree), share of battles with an entry.',
    '',
    table(
      ['Species', 'Level', 'Turns with lead >= 110%', 'Target >= 60%', 'Stratosphere fires'],
      leadRows,
    ),
    '',
    `### Kindle rate: share of L30 battles (fire species vs every other-nation species, empty trees) with at least one ignite: ${pct(kindled / battles)} (target >= 15%, ${atLeast(kindled / battles, 0.15)}).`,
  ].join('\n');
}

function mirrorAgainstOthers(
  sp: string,
  level: number,
  tree: Record<string, number>,
  node: string,
): string {
  if (!fits(tree, level)) return 'n/a';
  let fired = 0;
  let n = 0;
  for (const foe of ALL.filter((f) => f !== sp)) {
    const a = snapshotFor({ ...input(sp, level, 'a'), loadout: { tree } });
    const b = snapshotFor(input(foe, level, 'b'));
    for (let i = 0; i < 50; i++) {
      const r = simulateBattle(a, b, `diag-strat-${level}-${sp}-${foe}-${i}`);
      n++;
      if (entries(r).some((e) => e.side === 'a' && e.node === node && e.effect !== 'denied'))
        fired++;
    }
  }
  return pct(fired / n);
}

function input(speciesId: string, level: number, who: Side, playerId: string | null = who) {
  return {
    monId: who,
    playerId,
    nickname: who,
    speciesId,
    stage: stageForLevel(level) as MonSnapshot['stage'],
    level,
  };
}

/** `defaultBotTree` with its tier cap as a parameter (6 today; the lever stops at 4). */
function botTree(level: number, maxTier: number): Record<string, number> {
  const ranks: Record<string, number> = {};
  let remaining = pointsAvailable(level);
  for (let tier = 1; tier <= maxTier; tier++) {
    const node = TREE_NODES[`strike:${tier}`]!;
    if (node.cost > remaining) break;
    ranks[node.id] = 1;
    remaining -= node.cost;
  }
  return ranks;
}

function wildBots(): string {
  const rows: Array<Array<string | number>> = [];
  const edge: string[] = [];
  for (const maxTier of [6, 4]) {
    const label = maxTier === 6 ? 'current (strike:1-6)' : 'lever (strike:1-4)';
    for (const level of [5, 10, 20, 30, 50]) {
      let nw = 0;
      let nn = 0;
      let ew = 0;
      let en = 0;
      for (const sp of Object.values(SPECIES))
        for (const foe of Object.values(SPECIES)) {
          if (sp.nation === foe.nation) continue;
          for (let i = 0; i < 100; i++) {
            const enc = wildEncounterLevel(level, (i + 0.5) / 100);
            const bot: MonLoadout = { tree: botTree(enc.level, maxTier) };
            const won =
              simulateBattle(
                snapshotFor(input(sp.id, level, 'a', sp.id)),
                snapshotFor({ ...input(foe.id, enc.level, 'b', null), loadout: bot }),
                `wild-${sp.id}-${foe.id}-${level}-${i}`,
              ).winner === 'a';
            if (enc.isElite) {
              en++;
              ew += Number(won);
            } else {
              nn++;
              nw += Number(won);
            }
          }
        }
      const overall = (nw + ew) / (nn + en);
      const normal = nw / nn;
      const elite = ew / en;
      const ok =
        overall > 0.5 && overall < 0.82 && normal > 0.55 && normal < 0.86 && elite < normal - 0.08;
      rows.push([label, `L${level}`, pct(overall), pct(normal), pct(elite), ok ? 'PASS' : 'FAIL']);
    }
    // fairBattles "gives Ottlet an edge against weaker neutral opponents"
    const fails: string[] = [];
    let worst = Infinity;
    for (const level of [5, 10, 20, 30, 50])
      for (const foe of ['puffle', 'wispit'])
        for (const gap of [-1, -2, -3]) {
          const a = snapshotFor(input('ottlet', level, 'a'));
          const b = snapshotFor({
            ...input(foe, level + gap, 'b', null),
            loadout: { tree: botTree(level + gap, maxTier) },
          });
          let wins = 0;
          for (let i = 0; i < 1000; i++)
            wins += Number(
              simulateBattle(a, b, `audit-${level}-${gap}-${foe}-${i}`).winner === 'a',
            );
          const need = gap === -3 ? 0.7 : 0.5;
          worst = Math.min(worst, wins / 1000 - need);
          if (wins / 1000 <= need)
            fails.push(`L${level} vs ${foe} ${gap}: ${pct(wins / 1000)} (needs > ${pct(need)})`);
        }
    edge.push(
      `- ${label}: ${fails.length ? `FAIL ${fails.join('; ')}` : 'PASS'} (smallest margin ${pct(worst)})`,
    );
  }
  return [
    '### Wild Mon difficulty (`fairBattles.test.ts` gates, replicated with explicit bot trees)',
    '',
    'Gate: overall player wins > 50% and < 82%, normal > 55% and < 86%, elite more than 8 points below normal. Same seeds as `fairBattles.test.ts`; the bot tree is passed explicitly, so `tree.ts` is unchanged.',
    '',
    table(['Bot tree', 'Level', 'Overall', 'Normal', 'Elite', 'Gate'], rows),
    '',
    'Ottlet edge test (same seeds):',
    '',
    ...edge,
  ].join('\n');
}

async function protocol13(dir: string | undefined): Promise<string> {
  const head = '### Protocol 13 vs 14: tree-less cross-nation round-robin per species';
  if (!dir)
    return `${head}\n\nSkipped (set BALANCE_P13_DIR to a checkout of the protocol-13 \`packages/shared\`).`;
  let old: { simulateBattle: typeof simulateBattle; snapshotFor: typeof snapshotFor };
  try {
    old = (await import(/* @vite-ignore */ `${dir}/src/battle/battle.ts`)) as typeof old;
  } catch (err) {
    return `${head}\n\nFailed to load the protocol-13 engine from \`${dir}\`: ${String(err)}`;
  }
  const engines = { p13: old, p14: { simulateBattle, snapshotFor } };
  const rows: Array<Array<string | number>> = [];
  for (const level of [10, 30]) {
    const rate: Record<string, Record<string, number>> = { p13: {}, p14: {} };
    for (const [name, e] of Object.entries(engines)) {
      const wins: Record<string, number> = {};
      const games: Record<string, number> = {};
      for (const a of ALL)
        for (const b of ALL) {
          if (a === b || SPECIES[a]!.nation === SPECIES[b]!.nation) continue;
          const sa = e.snapshotFor(input(a, level, 'a'));
          const sb = e.snapshotFor(input(b, level, 'b'));
          for (let i = 0; i < 150; i++) {
            const w = e.simulateBattle(sa, sb, `${level}-${a}-${b}-${i}`).winner === 'a' ? a : b;
            wins[w] = (wins[w] ?? 0) + 1;
            games[a] = (games[a] ?? 0) + 1;
            games[b] = (games[b] ?? 0) + 1;
          }
        }
      for (const id of ALL) rate[name]![id] = (wins[id] ?? 0) / games[id]!;
    }
    for (const id of ALL)
      rows.push([
        `L${level}`,
        id,
        pct(rate.p13![id]!),
        pct(rate.p14![id]!),
        `${((rate.p14![id]! - rate.p13![id]!) * 100).toFixed(1)} pt`,
      ]);
  }
  return [
    head,
    '',
    'Same seeds as the gated round-robin.',
    '',
    table(['Level', 'Species', 'Protocol 13', 'Protocol 14', 'Delta'], rows),
  ].join('\n');
}

export async function runDiagnostics(p13Dir?: string): Promise<string> {
  const timed = <T>(name: string, f: () => T): T => {
    const t = performance.now();
    const r = f();
    times.push(`${name} ${((performance.now() - t) / 1000).toFixed(1)} s`);
    return r;
  };
  const times: string[] = [];
  const firing = timed('node firing', nodeFiring);
  const sections = [
    timed('wild bots', wildBots),
    timed('maxed routes', maxedRoutes),
    timed('nation forks', nationForks),
    timed('priority dependence', priorityDependence),
    timed('first action', firstAction),
    timed('initiative', initiativeArming),
    timed('early choices', earlyChoices),
    timed('archetype pairs', archetypePairs),
    timed('priority keyed', priorityKeyed),
    timed('main passive', mainPassive),
    timed('nation columns', nationColumns),
    timed('air and kindle', airAndKindle),
    await protocol13(p13Dir),
    firing.text,
  ];
  return [
    '## Diagnostics (report only)',
    '',
    `Diagnostic runtimes: ${times.join(', ')}.`,
    '',
    '### Firing-rate outliers (best measured level below 15%; bold below 5%)',
    '',
    ...firing.low.map((l) => `- ${l}`),
    '',
    ...sections.flatMap((s) => [s, '']),
  ].join('\n');
}
