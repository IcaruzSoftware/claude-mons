import type { SpriteDef } from '../types.ts';
import {
  compose,
  dots,
  frame,
  mirrorH,
  recolor,
  shift,
  squashTop,
  withRows,
  type Layer,
} from '../util.ts';

/**
 * Infernode (Fire, common, adult): a node-graph phoenix, 48 grid. Front view with both wings
 * spread; the wing feathers carry a small node graph (gold nodes joined by pale lines). Crown of
 * flame on the head, long beak, orange chest, talons, and a tail ending in a gold flame.
 *
 * The bird is symmetric, so the body is authored as its left half (24 columns) and mirrored.
 * Legs are separate so the walk cycle can move them independently.
 */
const PALETTE = {
  D: '#2b2b2b', // outline (tintable dark)
  P: '#ff5252', // ember red plumage (tintable primary)
  S: '#ff9100', // orange chest / crown (tintable secondary)
  A: '#ffd740', // gold crown tips, graph nodes, tail flame (tintable accent)
  r: '#c62828', // feather shade
  h: '#ffffff', // highlights
  y: '#fff59d', // graph edges, sparks
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 48;

// Left half of the body (24 columns x 48 rows). Mirrored around the seam between cols 23 and 24.
const HALF = [
  '........................',
  '........................',
  '......................DA',
  '...................DD.DA',
  '..................DAADAA',
  '.................DAASSSS',
  '.................DSSSSSS',
  '..................DDDDDD',
  '..DD..............DPPPPP',
  '.DPPD.............DPhPPP',
  '.DPPPDD...........DPDhPP',
  'DPPAAPPDD.........DPDDPP',
  'DPPAAPPPPDD.......DPPPPD',
  'DPPyPyPPPPPDD.....DPPPDA',
  'DPPyPPyPPPPPPDD....DPPDA',
  'DPPyPPPyAAPPPPPDDDDDDDDA',
  'DPPPyPPPAAPPPPPDPPPPPPDA',
  'DPPPyPPPPPyPPPPDPPPPPPPD',
  'DPPPyPPPPPyPPPPDPPPPPPPP',
  'DPPPAAPPPPPyPPPDPPPPSSSS',
  'DPPPAAPPPPPAAPPDPPPSSSSS',
  'DPPPPPyPPPPAAPPDPPPSSSSS',
  'DPPPPPPyPPPyPPPDPPPSSSSS',
  '.DPPPPPyPPyPPPPDPPPSSSSS',
  '.DPPPPPPAAPPPPPDPPPSSSSS',
  '..DPPPPPAAPPPPPDPPPSSSSS',
  '..DPPDPPPPPPPPPDPPPSSSSS',
  '...DDDrPDrPPPPPDPPPSSSSS',
  '......DDDrPDrPPDPPPSSSSS',
  '.........DDDrPPDPPPSSSSS',
  '............DDDDPPPSSSSS',
  '................DPPSSSSS',
  '................DPPSSSSS',
  '.................DPSSSSS',
  '.................DPSSSSS',
  '..................DSSSSS',
  '..................DDDDSS',
  '......................DS',
  '......................DS',
  '......................DS',
  '......................DS',
  '......................DS',
  '......................DS',
  '......................DA',
  '......................DA',
  '......................DA',
  '......................DA',
  '.......................D',
];

// Crown variants (rows 2..6 of the half).
const CROWN_FLICKER: Record<number, string> = {
  2: '...................DD...',
  3: '..................DAAD.D',
  4: '..................DAADDA',
};
const CROWN_DIM: Record<number, string> = {
  2: '........................',
  3: '........................',
  4: '.....................DSS',
  5: '...................DDSSS',
  6: '..................DSSSSS',
};
// Closed eyes: a 2 px line at row 11 only; the wing part of rows 9..10 must be kept intact.
const EYES_CLOSED: Record<number, string> = {
  9: '.DPPD.............DPPPPP',
  10: '.DPPPDD...........DPPPPP',
};

function body(...overrides: Array<Record<number, string>>): string[] {
  return mirrorH(withRows(HALF, Object.assign({}, ...overrides)));
}

// One leg with talons, 5 wide x 11 tall. Default positions: left x=17, right x=26, y=37.
const LEG = [
  '.DSD.',
  '.DSD.',
  '.DSD.',
  '.DSD.',
  '.DSD.',
  '.DSD.',
  '.DSD.',
  '.DSD.',
  'DSSSD',
  'DSDSD',
  'DDDDD',
];
const LEG_Y = 37;

const LAPTOP = [
  '.DDDDDDDDDDDD.',
  '.DllllllllllD.',
  '.DllllllllllD.',
  '.DllllllllllD.',
  '.DDDDDDDDDDDD.',
  'DggggggggggggD',
  'DDDDDDDDDDDDDD',
];
const LAPTOP_TYPING = withRows(LAPTOP, { 5: 'DghgghgghgghgD' });

interface Pose {
  torso?: string[];
  dx?: number;
  dy?: number;
  leftLeg?: [number, number];
  rightLeg?: [number, number];
  extra?: Layer[];
}

function pose({
  torso = body(),
  dx = 0,
  dy = 0,
  leftLeg = [0, 0],
  rightLeg = [0, 0],
  extra = [],
}: Pose): string[] {
  // Legs go first so a lifted leg disappears under the belly instead of drawing over it.
  return compose(SIZE, [
    { art: LEG, x: 17 + dx + leftLeg[0], y: LEG_Y + dy + leftLeg[1] },
    { art: LEG, x: 26 + dx + rightLeg[0], y: LEG_Y + dy + rightLeg[1] },
    { art: torso, x: dx, y: dy },
    ...extra,
  ]);
}

const idle = [
  pose({}),
  pose({ torso: body(CROWN_FLICKER) }),
  squashTop(pose({}), 6), // crown settles by one pixel
];

const walk = [
  pose({ leftLeg: [0, -2] }),
  shift(pose({ torso: body(CROWN_FLICKER) }), 0, -1),
  pose({ rightLeg: [0, -2] }),
  shift(pose({}), 0, -1),
];

const sleep = [
  pose({ torso: body(CROWN_DIM, EYES_CLOSED) }),
  squashTop(pose({ torso: body(CROWN_DIM, EYES_CLOSED) }), 6),
];

const laptop = (art: string[]): Layer => ({ art, x: 10, y: 41 });
const work = [
  pose({ extra: [laptop(LAPTOP)] }),
  squashTop(pose({ torso: body(CROWN_FLICKER), extra: [laptop(LAPTOP_TYPING)] }), 14),
  dots(pose({ extra: [laptop(LAPTOP)] }), 'y', [
    [14, 4],
    [33, 3],
  ]),
];

const happy = [
  pose({ torso: body(CROWN_FLICKER) }),
  shift(pose({}), 0, -2),
  shift(pose({ torso: body(CROWN_FLICKER), leftLeg: [0, 1], rightLeg: [0, 1] }), 0, -4),
];

const hurtRecoil = pose({ torso: body(EYES_CLOSED), dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', r: 'h', y: 'h' })];

// Attack: a short lunge (the wings span the whole grid, so a big shift would clip them), the head
// dips by one pixel, and a burst of fire appears in front of the beak.
const FIRE_BURST = ['.A...A.', 'AyS.ySA', '.SyAyS.', '..AyA..', '.SyAyS.', 'AyS.ySA', '.A...A.'];
const attack = [
  pose({ torso: body(CROWN_FLICKER), dx: -1 }),
  squashTop(pose({ dx: 1 }), 17),
  squashTop(
    pose({ torso: body(CROWN_FLICKER), dx: 2, extra: [{ art: FIRE_BURST, x: 31, y: 13 }] }),
    17,
  ),
];

export const INFERNODE_ADULT: SpriteDef = {
  id: 'infernode-adult',
  size: SIZE,
  palette: PALETTE,
  anchor: { x: 24, y: 47 },
  anims: {
    idle: { fps: 3, loop: true, frames: idle.map(frame) },
    walk: { fps: 8, loop: true, frames: walk.map(frame) },
    sleep: { fps: 1, loop: true, frames: sleep.map(frame) },
    work: { fps: 6, loop: true, frames: work.map(frame) },
    happy: { fps: 8, loop: true, frames: happy.map(frame) },
    hurt: { fps: 8, loop: true, frames: hurt.map(frame) },
    attack: { fps: 10, loop: false, frames: attack.map(frame) },
  },
};
