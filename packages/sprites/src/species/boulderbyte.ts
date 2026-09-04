import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Boulderbyte (Earth, common, teen): a boulder golem. One big rock for head and torso with two
 * glowing amber eyes and byte-like `0 1 0` carvings, thick hanging arms and small stone legs.
 */
const PALETTE = {
  D: '#2e3a1f', // outline (tintable dark)
  P: '#7cb342', // moss patches (tintable primary)
  S: '#8d8d8d', // stone (tintable secondary)
  A: '#ffb300', // amber eyes and carvings (tintable accent)
  s: '#6a6a6a', // stone shade
  l: '#b5b5b5', // stone highlight
  a: '#8a6100', // dim amber (sleep)
  h: '#ffffff', // flash
  y: '#fff3b0', // sparks
};

const SIZE = 32;
const TX = 7; // torso: 18 px wide, cols 7..24
const TY = 11; // torso: 15 px tall, rows 11..25; legs on rows 26..31

// 18 x 15 boulder torso. Amber eyes under a heavy brow, carved `0 1 0` byte marks on the belly.
const TORSO = [
  '.....DDDDDDDD.....',
  '...DDllSSSSSSDD...',
  '..DllSSSSSSSSSSD..',
  '.DlSSSSSSSSSSSSSD.',
  '.DSSSSDDSSSSDDSSD.',
  '.DSSSSAASSSSAASSD.',
  '.DSSSSssSSSSssSSD.',
  '.DSSSSSSSSSSSSSSD.',
  'DSSSSSSDDDDDSSSSsD',
  'DsSSSSSSSSSSSSSSsD',
  'DsSAAASSAsSSSAAAsD',
  'DsSASASSASSSSASAsD',
  'DssAAASSASSSSAAAsD',
  '.DssssssssssssssD.',
  '..DDDDDDDDDDDDDD..',
];

const TORSO_MOSS = withRows(TORSO, {
  1: '...DDPPSSSSSSDD...',
  2: '..DPPSSSSSSSSSSD..',
});

const EYES_CLOSED: Record<number, string> = {
  4: '.DSSSSSSSSSSSSSSD.',
  5: '.DSSSSDDSSSSDDSSD.',
  6: '.DSSSSSSSSSSSSSSD.',
};

const EYES_HURT: Record<number, string> = {
  4: '.DSSSDSDSSSSDSDSD.',
  5: '.DSSSSDSSSSSSDSSD.',
  6: '.DSSSDSDSSSSDSDSD.',
  8: 'DSSSSSSDDDDDDSSSsD',
};

const EYES_HAPPY: Record<number, string> = {
  4: '.DSSSSAASSSSAASSD.',
  5: '.DSSSDSSDSSDSSDSD.',
  6: '.DSSSSSSSSSSSSSSD.',
  8: 'DSSSSSSDSSSSDSSSsD',
  9: 'DsSSSSSSDDDDSSSSsD',
};

function torso(...overrides: Array<Record<number, string>>): string[] {
  return withRows(TORSO_MOSS, Object.assign({}, ...overrides));
}

// Thick arm with a fist, 5 x 14. Default: left at x=3, right at x=24, y=14 (hangs to row 27).
const ARM = [
  '.DDD.',
  'DSSSD',
  'DSSsD',
  'DSSsD',
  'DSSsD',
  'DSSsD',
  'DSSsD',
  'DsSsD',
  'DDDDD',
  'DSSSD',
  'DSlSD',
  'DSSSD',
  'DsssD',
  '.DDD.',
];

// Punching arm (horizontal), 12 x 5: shoulder on the left, fist on the right.
const PUNCH = ['.DDDDDDDDDD.', 'DSSSSSSDSSSD', 'DSSSSSSDSlSD', 'DsssssSDSSSD', '.DDDDDDDDDD.'];

// Small stone leg, 4 x 6. Default: left at x=10, right at x=18, y=26.
const LEG = ['DSSD', 'DSSD', 'DSsD', 'DssD', 'DssD', 'DDDD'];

// Block for the `work` anim (stacking), 6 x 4.
const BLOCK = ['DDDDDD', 'DlSSsD', 'DSSssD', 'DDDDDD'];

interface Pose {
  body?: string[];
  dx?: number;
  dy?: number;
  leftArm?: [number, number];
  rightArm?: [number, number];
  /** Replace the right arm with a horizontal punch. */
  punch?: boolean;
  leftLeg?: [number, number];
  rightLeg?: [number, number];
  extra?: Layer[];
}

function pose({
  body = torso(),
  dx = 0,
  dy = 0,
  leftArm = [0, 0],
  rightArm = [0, 0],
  punch = false,
  leftLeg = [0, 0],
  rightLeg = [0, 0],
  extra = [],
}: Pose): string[] {
  const x = TX + dx;
  const y = TY + dy;
  // Legs first so a lifted leg hides under the torso; arms last so they hang in front of it.
  return compose(SIZE, [
    { art: LEG, x: x + 3 + leftLeg[0], y: y + 15 + leftLeg[1] },
    { art: LEG, x: x + 11 + rightLeg[0], y: y + 15 + rightLeg[1] },
    { art: body, x, y },
    { art: ARM, x: x - 4 + leftArm[0], y: y + 3 + leftArm[1] },
    punch
      ? { art: PUNCH, x: x + 13, y: y + 5 }
      : { art: ARM, x: x + 17 + rightArm[0], y: y + 3 + rightArm[1] },
    ...extra,
  ]);
}

const idle = [
  pose({}),
  pose({ body: squashTop(torso(), 3), leftArm: [0, 1], rightArm: [0, 1] }),
  pose({}),
];

// A heavy stomp: one leg lifts while the opposite arm swings.
const walk = [
  pose({ leftLeg: [0, -2], leftArm: [0, 1], rightArm: [0, -1] }),
  shift(pose({}), 0, -1),
  pose({ rightLeg: [0, -2], leftArm: [0, -1], rightArm: [0, 1] }),
  shift(pose({}), 0, -1),
];

// Sleeping: the golem sinks down onto its legs, eyes out, carvings dimmed.
const dim = (rows: string[]): string[] => recolor(rows, { A: 'a' });
const sleep = [
  dim(pose({ body: torso(EYES_CLOSED), dy: 4, leftArm: [1, 0], rightArm: [-1, 0] })),
  dim(
    pose({
      body: squashTop(torso(EYES_CLOSED), 3),
      dy: 4,
      leftArm: [1, 0],
      rightArm: [-1, 0],
    }),
  ),
];

// Stacking blocks: the whole golem stands left; the right arm lifts a block onto the pile.
const pile: Layer = { art: BLOCK, x: 26, y: 28 };
const work = [
  pose({ dx: -3, rightArm: [1, -8], extra: [pile, { art: BLOCK, x: 26, y: 17 }] }),
  pose({ dx: -3, rightArm: [1, -1], extra: [pile, { art: BLOCK, x: 26, y: 24 }] }),
  dots(pose({ dx: -3, rightArm: [1, -5], extra: [pile, { art: BLOCK, x: 26, y: 24 }] }), 'y', [
    [25, 21],
    [31, 20],
    [30, 23],
  ]),
];

const happy = [
  pose({ body: torso(EYES_HAPPY), leftArm: [0, -2], rightArm: [0, -2] }),
  shift(pose({ body: torso(EYES_HAPPY), leftArm: [-1, -6], rightArm: [1, -6] }), 0, -2),
  shift(pose({ body: torso(EYES_HAPPY), leftArm: [-1, -8], rightArm: [1, -8] }), 0, -4),
];

const hurtRecoil = pose({ body: torso(EYES_HURT), dx: -2, leftArm: [-1, -1], rightArm: [1, -1] });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', s: 'h', l: 'h', a: 'h' })];

// Attack: wind up, then a big straight punch with amber sparks off the fist.
const attack = [
  pose({ dx: -2, rightArm: [1, -3], leftLeg: [-1, 0] }),
  pose({ dx: 2, punch: true, leftArm: [0, -2] }),
  dots(pose({ dx: 2, punch: true, leftArm: [0, -2] }), 'A', [
    [30, 14],
    [31, 17],
    [30, 21],
    [31, 24],
  ]),
];

export const BOULDERBYTE_TEEN: SpriteDef = {
  id: 'boulderbyte-teen',
  size: SIZE,
  palette: PALETTE,
  anchor: { x: 16, y: 31 },
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
