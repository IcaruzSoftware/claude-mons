/** One crafted scenario per tree node (side a owns the node), shared by the per-node tests and the
 * focused pass of the coverage gate. */
import type { MonSnapshot } from '../src/battle/battle.ts';
import { mon, type Match } from './treeTestUtils.ts';

// Move ids used below (packages/shared/src/game/species.ts):
// cinderpup: ember-bite (priority), hotfix-howl (burn), overclock / ashfang-strike / ember-maul
//   (crit_up); pebblet: pebble-toss (priority), bedrock-slam / fault-line (def_down),
//   monolith-drop (crit_up), magma-vein (burn); sparkit: spark-nip / flash-ignite (priority),
//   hot-reload (crit_up), force-push (def_down), kindling-surge (charge); dripple: drip-tap /
//   ripple-step (priority), pressure-jet (crit_up).
export const NO_PRIORITY = ['bedrock-slam', 'monolith-drop', 'magma-vein'];
export const CRITTER = ['overclock', 'ashfang-strike', 'ember-maul'];
export const STATUSER = ['bedrock-slam', 'magma-vein', 'fault-line'];
export const PRIORITY_SLOT2 = ['hot-reload', 'spark-nip', 'force-push'];
export const BURN_OPENER = ['hotfix-howl', 'ember-bite', 'overclock'];
/** Tree defenses a PIERCE can bypass, all on the foe. */
export const DEF_KIT = [
  'ward:1',
  'ward:3',
  'ward:4',
  'ward:6',
  'ward:12',
  'bastion:1',
  'bastion:7',
  'ward:5',
];

export const crit = (tree: string[], extra: Partial<MonSnapshot['stats']> = {}) =>
  mon('cinderpup', { moves: CRITTER, stats: { spd: 120, ...extra }, tree });
export const strong = { atk: 150 };

export type Row = [node: string, a: MonSnapshot, b: MonSnapshot, match: Match];
export const own = (node: string, m: Match): Match => ({ side: 'a', node, ...m });

// One crafted scenario per shared node (side a owns the node). The seed search is
// deterministic: the first matching seed of a fixed list.
export const ROWS: Row[] = [
  // --- bastion -------------------------------------------------------------------------------
  [
    'bastion:1',
    mon('pebblet', { tree: ['bastion:1'], stats: strong }),
    crit([]),
    { step: 'crit', effect: 'noncrit' },
  ],
  [
    'bastion:2',
    mon('pebblet', { tree: ['bastion:2'], stats: { spd: 30 } }),
    mon('puffle', { stats: { atk: 120, spd: 160 } }),
    { step: 'dodge', effect: 'undodge' },
  ],
  [
    'bastion:3',
    mon('pebblet', { tree: ['bastion:3'], stats: { ...strong, spd: 90 } }),
    mon('puffle', { stats: { atk: 30 } }),
    { step: 'pick', effect: 'finisher_early' },
  ],
  [
    'bastion:3:alt',
    mon('pebblet', { tree: ['bastion:3:alt'], stats: { def: 10 } }),
    mon('puffle', { stats: { atk: 200, spd: 10 } }),
    { step: 'clamp', effect: 'clamp' },
  ],
  [
    'bastion:4',
    mon('pebblet', { tree: ['bastion:4'], stats: { hp: 400 } }),
    mon('cinderpup', { moves: BURN_OPENER, stats: { atk: 20 } }),
    { step: 'turn_end', effect: 'burn_tick_skipped' },
  ],
  [
    'bastion:5',
    mon('pebblet', { tree: ['bastion:5'], moves: NO_PRIORITY }),
    mon('sparkit', { moves: PRIORITY_SLOT2 }),
    { step: 'order', effect: 'order_override' },
  ],
  [
    'bastion:6',
    mon('pebblet', { tree: ['bastion:6'], stats: { spd: 30 } }),
    mon('puffle', { stats: { atk: 120, spd: 160 } }),
    { step: 'dodge', effect: 'undodge' },
  ],
  [
    'bastion:7',
    mon('pebblet', { tree: ['bastion:7'] }),
    mon('pebblet', { moves: STATUSER }),
    { step: 'status', effect: 'refused' },
  ],
  [
    'bastion:7:left',
    mon('cinderpup', { tree: ['bastion:7:left'], moves: BURN_OPENER, stats: { hp: 400 } }),
    mon('pebblet', { tree: ['ward:7:left'] }),
    { step: 'status', effect: 'pierced' },
  ],
  [
    'bastion:7:right',
    mon('pebblet', { tree: ['bastion:7:right'] }),
    crit([]),
    { step: 'crit', effect: 'noncrit' },
  ],
  [
    'bastion:8',
    mon('pebblet', { tree: ['bastion:8'], moves: STATUSER }),
    mon('sparkit', { moves: PRIORITY_SLOT2 }),
    { step: 'damage', effect: 'void' },
  ],
  [
    'bastion:9',
    mon('pebblet', { tree: ['bastion:9'], moves: NO_PRIORITY }),
    mon('sparkit', { moves: ['spark-nip', 'flash-ignite', 'hot-reload'], stats: { spd: 160 } }),
    { step: 'dodge', effect: 'undodge' },
  ],
  [
    'bastion:10',
    mon('pebblet', { tree: ['bastion:10'], stats: { hp: 300 } }),
    crit([], { atk: 110 }),
    { step: 'crit', effect: 'noncrit' },
  ],
  [
    'bastion:10:left',
    mon('pebblet', { tree: ['bastion:10:left'], stats: strong }),
    crit([]),
    { step: 'damage', effect: 'multiplier' },
  ],
  [
    'bastion:10:right',
    mon('pebblet', { tree: ['bastion:10:right'] }),
    mon('pebblet', { moves: STATUSER }),
    { step: 'status', effect: 'refused' },
  ],
  [
    'bastion:11',
    mon('pebblet', { tree: ['bastion:11'] }),
    mon('pebblet', { moves: STATUSER }),
    { step: 'status', effect: 'refused' },
  ],
  [
    'bastion:12',
    mon('pebblet', { tree: ['bastion:12'], stats: strong }),
    mon('pebblet', { moves: STATUSER }),
    { step: 'status', effect: 'refused' },
  ],
  // --- strike --------------------------------------------------------------------------------
  [
    'strike:1',
    mon('pebblet', { tree: ['strike:1'], stats: strong }),
    mon('puffle'),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  [
    'strike:2',
    mon('pebblet', { tree: ['strike:2'] }),
    mon('pebblet', { tree: ['ward:3'], moves: NO_PRIORITY }),
    { step: 'damage', effect: 'pierced' },
  ],
  [
    'strike:3',
    mon('pebblet', { tree: ['strike:3'], moves: ['bedrock-slam', 'magma-vein', 'pebble-toss'] }),
    mon('puffle', { stats: { hp: 400 } }),
    { step: 'status', effect: 'payoff_armed' },
  ],
  [
    'strike:3:alt',
    mon('pebblet', { tree: ['strike:3:alt'], stats: strong }),
    mon('puffle'),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  [
    'strike:4',
    crit(['strike:4']),
    mon('puffle', { stats: { hp: 400 } }),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  [
    'strike:5',
    mon('pebblet', {
      tree: ['strike:5'],
      moves: ['monolith-drop', 'pebble-toss', 'landslide'],
      stats: strong,
    }),
    mon('puffle', { tree: DEF_KIT, stats: { hp: 300 } }),
    { effect: 'pierced' },
  ],
  [
    'strike:6',
    crit(['strike:6'], { atk: 120 }),
    mon('puffle'),
    { step: 'damage', effect: 'multiplier' },
  ],
  [
    'strike:7',
    mon('pebblet', { tree: ['strike:7'], moves: STATUSER }),
    mon('puffle', { tree: DEF_KIT }),
    { effect: 'pierced' },
  ],
  [
    'strike:7:left',
    mon('pebblet', {
      tree: ['strike:7:left'],
      moves: ['bedrock-slam', 'magma-vein', 'fault-line'],
      stats: { atk: 20 },
    }),
    mon('puffle', { stats: { hp: 400, atk: 20 } }),
    { step: 'turn_end', effect: 'status_refreshed' },
  ],
  [
    'strike:7:right',
    mon('pebblet', { tree: ['strike:7:right'], stats: { spd: 30 } }),
    mon('puffle', { stats: { spd: 160 } }),
    { step: 'dodge', effect: 'undodge' },
  ],
  [
    'strike:8',
    crit(['strike:8']),
    mon('puffle', { stats: { hp: 400 } }),
    { step: 'damage', effect: 'multiplier' },
  ],
  [
    'strike:9',
    mon('pebblet', { tree: ['strike:9'], stats: strong }),
    mon('puffle'),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  [
    'strike:10',
    mon('pebblet', { tree: ['strike:10'], moves: STATUSER, stats: { ...strong, spd: 20 } }),
    mon('puffle', { stats: { hp: 400 } }),
    { step: 'crit', effect: 'guaranteed_crit' },
  ],
  [
    'strike:10:left',
    mon('pebblet', { tree: ['strike:10:left'], moves: STATUSER }),
    mon('puffle'),
    { step: 'status', effect: 'payoff_armed' },
  ],
  [
    'strike:10:right',
    mon('pebblet', { tree: ['strike:10:right'] }),
    mon('puffle'),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  [
    'strike:11',
    mon('cinderpup', { tree: ['strike:11'], moves: BURN_OPENER }),
    mon('puffle'),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'strike:12',
    mon('pebblet', { tree: ['strike:12'], stats: strong }),
    mon('puffle'),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  // --- ward ----------------------------------------------------------------------------------
  ['ward:1', mon('pebblet', { tree: ['ward:1'] }), crit([]), { step: 'crit', effect: 'noncrit' }],
  [
    'ward:2',
    mon('puffle', { tree: ['ward:2'], stats: { spd: 160 } }),
    mon('pebblet', { stats: { spd: 30 } }),
    { step: 'dodge', effect: 'payoff_armed' },
  ],
  [
    'ward:3',
    mon('pebblet', { tree: ['ward:3'] }),
    mon('sparkit'),
    { step: 'damage', effect: 'void' },
  ],
  [
    'ward:3:alt',
    mon('puffle', { tree: ['ward:3:alt'], stats: { spd: 160 } }),
    mon('pebblet', { moves: STATUSER, stats: { spd: 30 } }),
    { step: 'status', effect: 'refused' },
  ],
  [
    'ward:4',
    mon('pebblet', { tree: ['ward:4'] }),
    mon('puffle', { stats: { atk: 200 } }),
    { step: 'clamp', effect: 'clamp' },
  ],
  [
    'ward:5',
    mon('puffle', { tree: ['ward:5'] }),
    mon('pebblet', { moves: STATUSER, stats: { atk: 120 } }),
    { step: 'status', effect: 'refused' },
  ],
  [
    'ward:6',
    mon('pebblet', { tree: ['ward:6'] }),
    mon('puffle', { stats: { atk: 300 } }),
    { step: 'lethal', effect: 'clamp' },
  ],
  [
    'ward:7',
    mon('puffle', { tree: ['ward:7'], stats: { hp: 400 } }),
    mon('pebblet', { moves: ['magma-vein', 'bedrock-slam', 'fault-line'] }),
    { step: 'status', effect: 'refused' },
  ],
  [
    'ward:7:left',
    mon('pebblet', { tree: ['ward:7:left'] }),
    mon('cinderpup', { moves: BURN_OPENER }),
    { step: 'status', effect: 'refused' },
  ],
  [
    'ward:7:right',
    mon('puffle', { tree: ['ward:7:right'], stats: { spd: 160 } }),
    mon('cinderpup', { moves: CRITTER, stats: { spd: 30 } }),
    { step: 'crit', effect: 'noncrit' },
  ],
  [
    'ward:8',
    mon('pebblet', { tree: ['ward:8'] }),
    mon('puffle', { stats: { atk: 150 } }),
    { step: 'turn_end', effect: 'heal' },
  ],
  [
    'ward:9',
    mon('pebblet', { tree: ['ward:9'] }),
    mon('pebblet', { moves: STATUSER }),
    { step: 'status', effect: 'refused' },
  ],
  [
    'ward:10',
    mon('pebblet', { tree: ['ward:10'], stats: { hp: 300 } }),
    mon('sparkit', { moves: ['brushfire', 'kindling-surge', 'hot-reload'], stats: { atk: 110 } }),
    { step: 'damage', effect: 'void' },
  ],
  [
    'ward:10:left',
    mon('pebblet', { tree: ['ward:10:left'], stats: { spd: 120 } }),
    mon('pebblet', { moves: STATUSER }),
    { step: 'status', effect: 'refused' },
  ],
  [
    'ward:10:right',
    mon('pebblet', { tree: ['ward:3', 'ward:10:right'] }),
    mon('sparkit'),
    { step: 'damage', effect: 'payoff_armed' },
  ],
  [
    'ward:11',
    mon('pebblet', { tree: ['ward:11'] }),
    mon('puffle', { stats: { atk: 150 } }),
    { step: 'turn_end', effect: 'heal' },
  ],
  [
    'ward:12',
    mon('pebblet', { tree: ['ward:12'] }),
    mon('puffle', { stats: { atk: 300 } }),
    { step: 'clamp', effect: 'clamp' },
  ],
  // --- tempo ---------------------------------------------------------------------------------
  [
    'tempo:1',
    mon('cinderpup', { tree: ['tempo:1'], moves: BURN_OPENER }),
    mon('puffle', { stats: { hp: 400 } }),
    { step: 'damage', effect: 'multiplier' },
  ],
  [
    'tempo:2',
    mon('pebblet', { tree: ['tempo:2'], stats: { spd: 60 } }),
    mon('puffle', { stats: { spd: 50 } }),
    { step: 'order', effect: 'order_override' },
  ],
  [
    'tempo:3',
    mon('cinderpup', { tree: ['tempo:3'], moves: BURN_OPENER }),
    mon('puffle', { tree: DEF_KIT }),
    { effect: 'pierced' },
  ],
  [
    'tempo:3:alt',
    mon('dripple', {
      tree: ['tempo:3:alt'],
      moves: ['drip-tap', 'ripple-step', 'pressure-jet'],
      stats: { spd: 30 },
    }),
    mon('pebblet', { moves: NO_PRIORITY, stats: { spd: 160 } }),
    { step: 'dodge', effect: 'undodge' },
  ],
  [
    'tempo:4',
    mon('pebblet', { tree: ['tempo:4'] }),
    mon('puffle', { stats: { hp: 400 } }),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  [
    'tempo:5',
    mon('pebblet', { tree: ['tempo:5'] }),
    mon('puffle', { tree: DEF_KIT }),
    { effect: 'pierced' },
  ],
  [
    'tempo:6',
    mon('puffle', { tree: ['tempo:6'], stats: { hp: 400 } }),
    mon('pebblet', { moves: STATUSER, stats: { atk: 20 } }),
    { step: 'hit', effect: 'status_cleared' },
  ],
  [
    'tempo:7',
    mon('cinderpup', { tree: ['tempo:7'], moves: ['hotfix-howl', 'overclock', 'ember-maul'] }),
    mon('pebblet', { moves: ['bedrock-slam', 'pebble-toss', 'monolith-drop'] }),
    { step: 'act_pre', effect: 'fizzled' },
  ],
  [
    'tempo:7:left',
    mon('pebblet', { tree: ['tempo:7:left'], moves: NO_PRIORITY }),
    mon('sparkit', { tree: DEF_KIT }),
    { effect: 'pierced' },
  ],
  [
    'tempo:7:right',
    mon('cinderpup', { tree: ['tempo:7:right'], moves: BURN_OPENER }),
    mon('puffle'),
    { step: 'status', effect: 'payoff_armed' },
  ],
  [
    'tempo:8',
    mon('dripple', { tree: ['tempo:8'], moves: ['drip-tap', 'ripple-step', 'pressure-jet'] }),
    mon('cinderpup', { moves: BURN_OPENER }),
    { step: 'turn_end', effect: 'burn_tick_skipped' },
  ],
  [
    'tempo:9',
    mon('sparkit', {
      tree: ['tempo:9'],
      moves: ['kindling-surge', 'spark-nip', 'hot-reload'],
      stats: { spd: 30 },
    }),
    mon('puffle', { stats: { hp: 400, spd: 160 } }),
    { step: 'dodge', effect: 'undodge' },
  ],
  [
    'tempo:10',
    mon('dripple', { tree: ['tempo:10'], moves: ['drip-tap', 'ripple-step', 'pressure-jet'] }),
    mon('puffle', { stats: { hp: 400 } }),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  [
    'tempo:10:left',
    mon('puffle', { tree: ['tempo:10:left'], stats: { spd: 160 } }),
    mon('sparkit', { moves: ['spark-nip', 'flash-ignite', 'hot-reload'], stats: { spd: 30 } }),
    { step: 'dodge', effect: 'payoff_armed' },
  ],
  [
    'tempo:10:right',
    mon('dripple', {
      tree: ['tempo:10:right'],
      moves: ['stream-splash', 'drip-tap', 'pressure-jet'],
      stats: { hp: 400, spd: 160 },
    }),
    mon('sparkit', { moves: ['hot-reload', 'spark-nip', 'force-push'], stats: { hp: 400 } }),
    { step: 'order', effect: 'order_suppressed' },
  ],
  [
    'tempo:11',
    mon('dripple', { tree: ['tempo:11'], moves: ['drip-tap', 'ripple-step', 'pressure-jet'] }),
    mon('puffle', { stats: { hp: 400 } }),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  [
    'tempo:12',
    mon('pebblet', { tree: ['tempo:12'], moves: NO_PRIORITY, stats: { hp: 400 } }),
    mon('sparkit', { moves: ['spark-nip', 'flash-ignite', 'hot-reload'], stats: { hp: 400 } }),
    { step: 'order', effect: 'order_override' },
  ],
];

// One crafted scenario per nation node (side a owns the node; a mon of that nation).
// dripple: drip-tap / ripple-step (neutral priority), stream-splash (nation def_down),
//   pressure-jet (nation crit_up), deep-current (nation drain); puffle: puff (neutral priority).
export const WATER_HITS = ['pressure-jet', 'stream-splash', 'deep-current'];
export const BURN_SLOT2 = ['ember-bite', 'hotfix-howl', 'overclock'];
export const CHARGE_OPENER = ['kindling-surge', 'hot-reload', 'force-push'];
export const fire = (tree: string[], o: Parameters<typeof mon>[1] = {}) =>
  mon('cinderpup', { moves: BURN_OPENER, ...o, tree });
export const water = (tree: string[], o: Parameters<typeof mon>[1] = {}) =>
  mon('dripple', { moves: WATER_HITS, ...o, tree });
export const earth = (tree: string[], o: Parameters<typeof mon>[1] = {}) =>
  mon('pebblet', { ...o, tree });
export const air = (tree: string[], o: Parameters<typeof mon>[1] = {}) =>
  mon('puffle', { ...o, tree });
export const tank = (o: Partial<MonSnapshot['stats']> = {}) =>
  mon('puffle', { stats: { hp: 400, ...o } });
export const fast = { spd: 160 };
export const slowStatuser = mon('pebblet', { moves: STATUSER, stats: { spd: 10, hp: 400 } });
export const priorityFoe = mon('sparkit', { moves: PRIORITY_SLOT2, stats: { spd: 10, hp: 400 } });

export const NATION_ROWS: Row[] = [
  // --- fire ----------------------------------------------------------------------------------
  [
    'nation.fire:1',
    fire(['nation.fire:1'], { stats: { spd: 120 } }),
    tank(),
    { step: 'damage', effect: 'multiplier' },
  ],
  [
    'nation.fire:2',
    fire(['nation.fire:2'], { stats: { spd: 10 } }),
    tank({ spd: 160 }),
    { step: 'dodge', effect: 'undodge' },
  ],
  [
    'nation.fire:3',
    mon('cinderpup', { moves: CRITTER, tree: ['nation.fire:3'] }),
    tank(),
    { step: 'status', effect: 'payoff_armed' },
  ],
  ['nation.fire:3:alt', fire(['nation.fire:3:alt']), crit([]), { step: 'crit', effect: 'noncrit' }],
  ['nation.fire:4', fire(['nation.fire:4']), tank(), { step: 'status', effect: 'payoff_armed' }],
  ['nation.fire:5', fire(['nation.fire:5']), tank(), { step: 'hit', effect: 'payoff_armed' }],
  [
    'nation.fire:6',
    fire(['nation.fire:6']),
    mon('puffle', { tree: DEF_KIT }),
    { effect: 'pierced' },
  ],
  [
    'nation.fire:7',
    mon('cinderpup', { moves: CRITTER, tree: ['nation.fire:7'] }),
    crit([]),
    { step: 'crit', effect: 'noncrit' },
  ],
  [
    'nation.fire:7:left',
    fire(['nation.fire:7:left']),
    slowStatuser,
    { step: 'status', effect: 'refused' },
  ],
  [
    'nation.fire:7:right',
    fire(['nation.fire:7:right'], { stats: { spd: 120 } }),
    tank(),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  ['nation.fire:8', fire(['nation.fire:8']), tank(), { step: 'turn_end', effect: 'payoff_armed' }],
  [
    'nation.fire:9',
    fire(['nation.fire:9'], { moves: BURN_SLOT2, stats: { atk: 20 } }),
    tank({ atk: 20 }),
    { step: 'status', effect: 'payoff_armed' },
  ],
  [
    'nation.fire:10',
    fire(['nation.fire:10'], { stats: strong }),
    mon('puffle'),
    { step: 'crit', effect: 'guaranteed_crit' },
  ],
  [
    'nation.fire:10:left',
    fire(['nation.fire:10:left']),
    tank(),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.fire:10:right',
    fire(['nation.fire:10:right']),
    crit([]),
    { step: 'crit', effect: 'payoff_armed' },
  ],
  [
    'nation.fire:11',
    fire(['nation.fire:11'], { moves: BURN_SLOT2 }),
    tank(),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  [
    'nation.fire:12',
    fire(['nation.fire:12'], { stats: { atk: 120, spd: 120 } }),
    mon('puffle'),
    { step: 'damage', effect: 'multiplier' },
  ],
  // --- water ---------------------------------------------------------------------------------
  ['nation.water:1', water(['nation.water:1']), tank(), { step: 'hit', effect: 'payoff_armed' }],
  [
    'nation.water:2',
    water(['nation.water:2'], { stats: { hp: 400 } }),
    crit([]),
    { step: 'crit', effect: 'noncrit' },
  ],
  [
    'nation.water:3',
    water(['nation.water:3'], { stats: { hp: 400 } }),
    mon('sparkit', { moves: PRIORITY_SLOT2, stats: { hp: 400 } }),
    { step: 'order', effect: 'order_suppressed' },
  ],
  [
    'nation.water:3:alt',
    water(['nation.water:3:alt']),
    slowStatuser,
    { step: 'status', effect: 'refused' },
  ],
  ['nation.water:4', water(['nation.water:4']), tank(), { step: 'hit', effect: 'payoff_armed' }],
  [
    'nation.water:5',
    water(['nation.water:5']),
    tank(),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.water:6',
    water(['nation.water:6']),
    mon('puffle', { tree: DEF_KIT, stats: { hp: 400 } }),
    { effect: 'pierced' },
  ],
  [
    'nation.water:7',
    water(['nation.water:7']),
    slowStatuser,
    { step: 'status', effect: 'refused' },
  ],
  [
    'nation.water:7:left',
    water(['nation.water:7:left']),
    tank(),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.water:7:right',
    water(['nation.water:7:right'], { stats: { spd: 10 } }),
    tank(fast),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.water:8',
    water(['nation.water:8']),
    tank(),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.water:9',
    water(['nation.water:9'], { stats: strong }),
    mon('puffle'),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.water:10',
    // Slower than the foe, so Undercurrent on the route cannot suppress (and deny) its Priority.
    water(['nation.water:10'], { stats: { hp: 400, spd: 5 } }),
    priorityFoe,
    { step: 'damage', effect: 'void' },
  ],
  [
    'nation.water:10:left',
    water(['nation.water:10:left'], { stats: { spd: 30 } }),
    tank(),
    { step: 'order', effect: 'order_override' },
  ],
  [
    'nation.water:10:right',
    water(['nation.water:10:right'], { stats: { hp: 400 } }),
    tank({ atk: 20 }),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  [
    'nation.water:11',
    water(['nation.water:11'], { stats: { def: 10 } }),
    mon('puffle', { stats: { atk: 160, spd: 10 } }),
    { step: 'clamp', effect: 'clamp' },
  ],
  [
    'nation.water:12',
    water(['nation.water:12'], { stats: { spd: 120 } }),
    tank(),
    { step: 'crit', effect: 'guaranteed_crit' },
  ],
  // --- earth ---------------------------------------------------------------------------------
  [
    'nation.earth:1',
    earth(['nation.earth:1'], { stats: { atk: 20 } }),
    mon('puffle', { stats: { spd: 10 } }),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.earth:2',
    earth(['nation.earth:2'], { stats: { spd: 10, hp: 400 } }),
    tank(fast),
    { step: 'dodge', effect: 'undodge' },
  ],
  [
    'nation.earth:3',
    earth(['nation.earth:3'], { stats: { def: 10 } }),
    mon('sparkit', { moves: CHARGE_OPENER, stats: { atk: 200, spd: 10 } }),
    { step: 'clamp', effect: 'clamp' },
  ],
  [
    'nation.earth:3:alt',
    earth(['nation.earth:3:alt'], { stats: { hp: 400 } }),
    slowStatuser,
    { step: 'status', effect: 'refused' },
  ],
  [
    'nation.earth:4',
    earth(['nation.earth:4'], { stats: { hp: 400 } }),
    mon('puffle'),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.earth:5',
    earth(['nation.earth:5'], { stats: { hp: 400 } }),
    mon('puffle'),
    { step: 'damage', effect: 'void' },
  ],
  [
    'nation.earth:6',
    earth(['nation.earth:6'], { stats: { hp: 400 } }),
    crit([]),
    { step: 'crit', effect: 'noncrit' },
  ],
  [
    'nation.earth:7',
    earth(['nation.earth:7'], { stats: { def: 10 } }),
    mon('puffle', { stats: { atk: 200, spd: 10 } }),
    { step: 'clamp', effect: 'clamp' },
  ],
  [
    'nation.earth:7:left',
    earth(['nation.earth:7:left'], { stats: { hp: 400 } }),
    mon('sparkit', { moves: PRIORITY_SLOT2, stats: { hp: 400 } }),
    { step: 'act_pre', effect: 'fizzled' },
  ],
  [
    'nation.earth:7:right',
    earth(['nation.earth:7:right']),
    mon('puffle', { stats: { spd: 10 } }),
    { step: 'crit', effect: 'guaranteed_crit' },
  ],
  [
    'nation.earth:8',
    earth(['nation.earth:8'], { stats: { hp: 400 } }),
    mon('puffle'),
    { step: 'hit', effect: 'payoff_armed' },
  ],
  [
    'nation.earth:9',
    earth(['nation.earth:9'], { stats: { hp: 400 } }),
    mon('pebblet', { moves: STATUSER }),
    { step: 'status', effect: 'refused' },
  ],
  [
    'nation.earth:10',
    earth(['nation.earth:10'], { stats: { hp: 400 } }),
    mon('puffle', { stats: { spd: 10 } }),
    { step: 'crit', effect: 'guaranteed_crit' },
  ],
  [
    'nation.earth:10:left',
    earth(['nation.earth:10:left'], { stats: { hp: 400 } }),
    mon('puffle', { stats: { spd: 10 } }),
    { step: 'crit', effect: 'guaranteed_crit' },
  ],
  [
    'nation.earth:10:right',
    earth(['nation.earth:10:right'], { stats: { hp: 400 } }),
    mon('puffle'),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.earth:11',
    earth(['nation.earth:11'], { stats: { def: 10, hp: 300 } }),
    mon('puffle', { stats: { atk: 150, spd: 10 } }),
    { step: 'clamp', effect: 'clamp' },
  ],
  [
    'nation.earth:12',
    earth(['nation.earth:12'], { moves: NO_PRIORITY, stats: { spd: 120, hp: 400 } }),
    mon('puffle', { stats: { hp: 400 } }),
    { step: 'damage', effect: 'multiplier' },
  ],
  // --- air -----------------------------------------------------------------------------------
  [
    'nation.air:1',
    air(['nation.air:1'], { stats: fast }),
    mon('pebblet', { stats: { spd: 10, hp: 400 } }),
    { step: 'dodge', effect: 'payoff_armed' },
  ],
  [
    'nation.air:2',
    air(['nation.air:2'], { stats: { hp: 400 } }),
    mon('pebblet', { stats: { hp: 400 } }),
    { step: 'dodge', effect: 'undodge' },
  ],
  [
    'nation.air:3',
    air(['nation.air:3'], { stats: { spd: 120, hp: 400 } }),
    crit([], { spd: 100 }),
    { step: 'crit', effect: 'noncrit' },
  ],
  [
    'nation.air:3:alt',
    air(['nation.air:3:alt'], { stats: fast }),
    priorityFoe,
    { step: 'dodge', effect: 'payoff_armed' },
  ],
  [
    'nation.air:4',
    air(['nation.air:4']),
    mon('pebblet', { tree: DEF_KIT, stats: { spd: 30 } }),
    { effect: 'pierced' },
  ],
  [
    'nation.air:5',
    air(['nation.air:5'], { stats: fast }),
    mon('pebblet', { stats: { spd: 10, hp: 400 } }),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.air:6',
    air(['nation.air:6'], { stats: { hp: 400 } }),
    slowStatuser,
    { step: 'status', effect: 'refused' },
  ],
  [
    'nation.air:7',
    air(['nation.air:7'], { stats: { spd: 120, hp: 400 } }),
    crit([], { spd: 100 }),
    { step: 'crit', effect: 'noncrit' },
  ],
  [
    'nation.air:7:left',
    air(['nation.air:7:left'], { stats: { ...fast, hp: 400 } }),
    priorityFoe,
    { step: 'act_pre', effect: 'fizzled' },
  ],
  [
    'nation.air:7:right',
    air(['nation.air:7:right'], { stats: fast }),
    tank(),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.air:8',
    air(['nation.air:8'], {
      moves: ['gust-draft', 'gust-draft', 'gust-draft'],
      stats: { spd: 120 },
    }),
    tank(),
    { step: 'damage', effect: 'multiplier' },
  ],
  [
    'nation.air:9',
    air(['nation.air:9'], { stats: fast }),
    mon('pebblet', { stats: { spd: 10, hp: 400 } }),
    { step: 'dodge', effect: 'payoff_armed' },
  ],
  [
    'nation.air:10',
    air(['nation.air:10'], { stats: { hp: 400 } }),
    slowStatuser,
    { step: 'status', effect: 'refused' },
  ],
  [
    'nation.air:10:left',
    air(['nation.air:10:left'], { stats: fast }),
    tank(),
    { step: 'turn_end', effect: 'payoff_armed' },
  ],
  [
    'nation.air:10:right',
    air(['nation.air:10:right'], { stats: fast }),
    priorityFoe,
    { step: 'dodge', effect: 'payoff_armed' },
  ],
  [
    'nation.air:11',
    // A speed lead below 105%, so Tailwind Crown and Lee Shore on the route stay off; long fights
    // give the two dodges time.
    air(['nation.air:11'], { stats: { spd: 50, hp: 600, atk: 20 } }),
    mon('pebblet', { moves: STATUSER, stats: { spd: 54, hp: 600, atk: 20 } }),
    { step: 'status', effect: 'refused' },
  ],
  [
    'nation.air:12',
    air(['nation.air:12'], { stats: { spd: 120 } }),
    tank(),
    { step: 'crit', effect: 'guaranteed_crit' },
  ],
];
