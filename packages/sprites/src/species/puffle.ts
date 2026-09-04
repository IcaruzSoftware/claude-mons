import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Puffle (Air, common, baby): a small round cloud puff with a face and two tiny sky-blue feet.
 * It hovers a pixel above the ground and bobs; when working it scribbles ideas into a tiny
 * notebook held in a stub arm.
 */
const PALETTE = {
  D: '#2b3550', // outline (tintable dark)
  P: '#4fc3f7', // sky blue: feet, blush (tintable primary)
  S: '#f5f7ff', // cloud white body (tintable secondary)
  A: '#b39ddb', // lavender: notebook cover, gust puffs (tintable accent)
  b: '#cfe3f7', // cloud shade
  v: '#8b74c2', // lavender shade (scribbles)
  h: '#ffffff', // eye glint, flash
  y: '#fff176', // pencil, idea sparks
  n: '#fff3c4', // notebook paper
};

const SIZE = 32;
const BX = 8; // body: 16 px wide, cols 8..23
const BY = 17; // body: 12 px tall, rows 17..28; feet rows 29..30 (hovering 1 px above the anchor)

// 16 x 12 cloud body (no feet)
const BODY = [
  '.....DDD..DDD...',
  '....DSSSDDSSSD..',
  '..DDDSSSSSSSSDD.',
  '.DSSSSSSSSSSSSSD',
  'DSSSSDhSSSSDhSSD',
  'DSSSSDDSSSSDDSSD',
  'DSPPSSSSSSSSSPPD',
  'DSSSSSSDSSDSSSSD',
  'DSbSSSSSDDSSSSbD',
  '.DbbSSSSSSSSbbD.',
  '..DbbbbbbbbbbD..',
  '...DDDDDDDDDD...',
];

// Eyes closed (sleep / blink).
const BODY_CLOSED = withRows(BODY, {
  4: 'DSSSSSSSSSSSSSSD',
  5: 'DSSSSDDSSSSDDSSD',
});

// Happy: arched eyes and a wide grin.
const BODY_HAPPY = withRows(BODY, {
  4: 'DSSSSDDSSSSDDSSD',
  5: 'DSSSDSSDSSDSSDSD',
  7: 'DSSSSSDSSSSDSSSD',
  8: 'DSbSSSSDDDDSSSbD',
});

// Hurt: squeezed eyes and a small frown.
const BODY_HURT = withRows(BODY, {
  4: 'DSSSDSDSSSSDSDSD',
  5: 'DSSSSDSSSSSSDSSD',
  7: 'DSSSSSSSDDSSSSSD',
  8: 'DSbSSSSDSSDSSSbD',
});

// One tiny foot, 4 x 2. Default positions: left (11, 29), right (17, 29).
const FOOT = ['DPPD', 'DDDD'];

// Notebook (8 x 7) with a lavender spine; scribbles appear on the paper while working.
const NOTEBOOK = [
  'DDDDDDDD',
  'DAnnnnnD',
  'DAnnnnnD',
  'DAnnnnnD',
  'DAnnnnnD',
  'DAnnnnnD',
  'DDDDDDDD',
];
const NOTEBOOK_1 = withRows(NOTEBOOK, { 2: 'DAvvvnnD' });
const NOTEBOOK_2 = withRows(NOTEBOOK, { 2: 'DAvvvvnD', 3: 'DAvvnnnD' });
const NOTEBOOK_3 = withRows(NOTEBOOK, { 2: 'DAvvvvnD', 3: 'DAvvvnnD', 4: 'DAvnnnnD' });

// Stub arm poking out of the right side of the body, and a pencil (yellow with a dark tip).
const ARM = ['DDDD', 'SSSD', 'DDDD'];
const PENCIL = ['..y', '.y.', 'D..'];

interface Pose {
  body?: string[];
  /** Whole-sprite offset (bob / hop / recoil / lunge). */
  dx?: number;
  dy?: number;
  /** Per-foot offsets relative to the default foot positions. */
  leftFoot?: [number, number];
  rightFoot?: [number, number];
  extra?: Layer[];
}

function pose({
  body = BODY,
  dx = 0,
  dy = 0,
  leftFoot = [0, 0],
  rightFoot = [0, 0],
  extra = [],
}: Pose): string[] {
  return compose(SIZE, [
    { art: FOOT, x: BX + 3 + dx + leftFoot[0], y: BY + 12 + dy + leftFoot[1] },
    { art: FOOT, x: BX + 9 + dx + rightFoot[0], y: BY + 12 + dy + rightFoot[1] },
    { art: body, x: BX + dx, y: BY + dy },
    ...extra,
  ]);
}

const idle = [pose({}), pose({ dy: -1 }), pose({ dy: -1, body: BODY_CLOSED })];

// Drifting: the puff bobs while the feet paddle.
const walk = [
  pose({ leftFoot: [-1, 0], rightFoot: [1, 0] }),
  pose({ dy: -1 }),
  pose({ dy: -2, leftFoot: [1, 0], rightFoot: [-1, 0] }),
  pose({ dy: -1, body: squashTop(BODY, 3) }),
];

// Asleep: settles onto the ground, eyes closed.
const sleep = [
  pose({ body: BODY_CLOSED, dy: 1 }),
  pose({ body: squashTop(BODY_CLOSED, 3), dy: 1 }),
];

// Working: notebook held out front, pencil scribbling, an idea spark now and then.
const notebook = (art: string[]): Layer => ({ art, x: 21, y: 21 });
const arm: Layer = { art: ARM, x: 21, y: 22 };
const pencil = (x: number, y: number): Layer => ({ art: PENCIL, x, y });
const work = [
  pose({ dx: -1, extra: [notebook(NOTEBOOK_1), arm, pencil(24, 20)] }),
  pose({ dx: -1, extra: [notebook(NOTEBOOK_2), arm, pencil(25, 21)] }),
  dots(pose({ dx: -1, extra: [notebook(NOTEBOOK_3), arm, pencil(23, 20)] }), 'y', [
    [8, 14],
    [10, 12],
    [7, 12],
  ]),
];

const happy = [
  pose({ body: squashTop(BODY, 3) }),
  pose({ body: BODY_HAPPY, dy: -3 }),
  pose({ body: BODY_HAPPY, dy: -5, leftFoot: [0, -1], rightFoot: [0, -1] }),
];

const hurtRecoil = pose({ body: BODY_HURT, dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { S: 'h', b: 'h', P: 'h', A: 'h' })];

// Attack: winds up, then lunges forward with a gust of lavender puffs ahead of it.
const attack = [
  pose({ body: squashTop(BODY, 3), dx: -2 }),
  pose({ dx: 3, body: BODY_HAPPY }),
  dots(
    dots(pose({ dx: 5 }), 'A', [
      [29, 19],
      [30, 22],
      [31, 25],
      [29, 27],
    ]),
    'S',
    [
      [30, 20],
      [31, 23],
      [30, 26],
    ],
  ),
];

export const PUFFLE_BABY: SpriteDef = {
  id: 'puffle-baby',
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
