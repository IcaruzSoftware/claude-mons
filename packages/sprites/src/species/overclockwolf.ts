import type { SpriteDef } from '../types.ts';
import { compose, frame, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Overclockwolf (Fire, rare, adult): a large wolf running past its rated clock, 48 grid. Side view
 * facing right: pointed flame-tipped ears, a gold clock-speed gauge glowing on the forehead, a
 * ruff of flame-tipped fur over the shoulders, a deep chest, a tucked belly and a long tail that
 * ends in fire. The attack is a dash-bite with speed lines trailing behind.
 */
const PALETTE = {
  D: '#2b2b2b', // outline (tintable dark)
  P: '#ff5252', // ember red coat (tintable primary)
  S: '#ff9100', // orange belly / flame (tintable secondary)
  A: '#ffd740', // gold gauge / flame tips (tintable accent)
  r: '#c62828', // red shade (underside, far legs)
  k: '#3a0f0f', // open mouth
  h: '#ffffff', // eye glint, teeth, hurt flash
  y: '#fff59d', // sparks, speed lines, gauge glow
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 48;

// Head, 22 x 16. Ears on rows 0..3, eye at cols 13..15 rows 7..8, nose at col 21, jaw on rows
// 11..13; rows 14..15 are the neck and have no left outline so they blend into the torso.
const HEAD = [
  '..DD.........DD.......',
  '.DAAD.......DAAD......',
  '.DASPD.....DPSAD......',
  '.DSPPPDDDDDDPPPSD.....',
  '.DPPPPPPPPPPPPPPD.....',
  'DPPPPPPPPPPPPPPPPD....',
  'DPPPPPPPPPPPPPPPPD....',
  'DPPPPPPPPPPPPDhDPPDD..',
  'DPPPPPPPPPPPPDDDPPPPDD',
  'DPPPPPPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPPPPPDD',
  '.DPPPPPPPPPPPPPPDDDDD.',
  '.DPPPPPPPPPPPPPPPPPDD.',
  '..DPPPPPPPPPPPPPPDDD..',
  '..PPPPPPPPPPPPPPDDD...',
  '..PPPPPPPPPPPPPDD.....',
];
const HEAD_X = 23;
const HEAD_Y = 10;

const HEAD_SLEEP = withRows(HEAD, {
  7: 'DPPPPPPPPPPPPPPPPPDD..',
  8: 'DPPPPPPPPPPPPDDDPPPPDD',
});
const HEAD_HURT = withRows(HEAD, {
  7: 'DPPPPPPPPPPPPDDPPPPDD.',
  8: 'DPPPPPPPPPPPPPPDDPPPDD',
});
// Bite: eye narrowed, jaws open with teeth and a dark mouth.
const HEAD_BITE = withRows(HEAD, {
  7: 'DPPPPPPPPPPPPPPPPPPDD.',
  8: 'DPPPPPPPPPPPPDhDPPPPDD',
  11: '.DPPPPPPPPPPPPPPDhDhD.',
  12: '.DPPPPPPPPPPPPPPDkkkD.',
  13: '..DPPPPPPPPPPPPPDhDhD.',
  14: '..PPPPPPPPPPPPPPPDDDD.',
  15: '..PPPPPPPPPPPPPDDD....',
});

// Clock-speed gauge on the forehead, 7 x 7: gold dial, orange ticks, dark needle.
const GAUGE = ['..DDD..', '.DASAD.', 'DAAADAD', 'DSADASD', 'DAAAAAD', '.DAAAD.', '..DDD..'];
const GAUGE_REDLINE = withRows(GAUGE, { 2: 'DAAAAAD', 3: 'DSADDSD' });
const GAUGE_IDLE = withRows(GAUGE, { 2: 'DAADAAD', 3: 'DSADASD' });
const GAUGE_DIM = recolor(GAUGE_IDLE, { A: 'S', S: 'r' });
const GAUGE_X = 28;
const GAUGE_Y = 12;

// Torso, 32 x 18: hip hump at the left, shoulders at the right, tucked belly, deep chest.
const TORSO = [
  '.....DDDD............DDDDDDDD...',
  '...DDPPPPDDDDDDDDDDDDPPPPPPPPDD.',
  '..DPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  '.DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  '.DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DrPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DrPPPPPPPPPPPSSSSSSSSSSSPPPPPPPD',
  'DrrPPPPPPPPSSSSSSSSSSSSSSPPPPPPD',
  '.DrrPPPPPDSSSSSSSSSSSSSSSPPPPPPD',
  '.DrrPPPPD.DSSSSSSSSSSSSSSPPPPPD.',
  '..DrrPPD...DDSSSSSSSSSSSPPPPPDD.',
  '...DDDD......DDDSSSSSSSSPPPPDD..',
  '................DDDDDDDPPPPDD...',
  '.......................DDDDD....',
];
const TORSO_X = 3;
const TORSO_Y = 19;

// Ruff of flame-tipped fur over the neck and shoulders, 14 x 10. Spikes sweep back; the lower
// rows have no outline so they blend into the coat and hide the head/torso seam.
const RUFF = [
  'DD............',
  'DAD..DD.......',
  'DSAD.DAD..DD..',
  '.DSPDDSAD.DAD.',
  '.DPPPPSSPDDSAD',
  '..DPPPPPPPPSPD',
  '..DPPPPPPPPPPP',
  '...PPPPPPPPPPP',
  '....PPPPPPPPPP',
  '.....PPPPPPPPP',
];
const RUFF_FLICKER = withRows(RUFF, {
  0: '..............',
  1: 'DD...DD.......',
  2: 'DADD.DAD..DD..',
  3: '.DSSDDSAD.DAD.',
});
const RUFF_X = 15;
const RUFF_Y = 14;

// Tail, 8 x 10, rising from the hip with a flame tip. Drawn behind the torso.
const TAIL_UP = [
  '..DD....',
  '.DAAD...',
  '.DASSD..',
  'DASSPD..',
  'DSSPPPD.',
  'DSPPPPD.',
  '.DPPPPPD',
  '..DPPPPD',
  '...DPPPD',
  '....DPPD',
];
const TAIL_FLICK = withRows(TAIL_UP, { 0: '.DD.....', 1: 'DAAD....', 2: 'DAASD...' });
// Streaming straight back during a dash / lying on the ground asleep, 10 x 4.
const TAIL_BACK = ['DDD.......', 'DAADDD....', 'DASSSPDDDD', '.DDSPPPPPP'];
const TAIL_X = 1;
const TAIL_Y = 11;

// Legs: hip at the top-left `DPPD`; the paw points forward. Back legs are 14 tall, front 12.
const LEG_BACK = [
  'DPPD.',
  'DPPD.',
  'DPPD.',
  'DPPD.',
  'DPPD.',
  'DPPD.',
  'DPPD.',
  'DPPD.',
  'DPPD.',
  'DPPD.',
  'DPPD.',
  'DPPD.',
  'DPPPD',
  'DDDDD',
];
const LEG_FRONT = LEG_BACK.slice(2);
// Reaching forward onto the laptop, 9 x 10.
const LEG_TYPE = [
  'DPPD.....',
  'DPPD.....',
  '.DPPD....',
  '.DPPD....',
  '..DPPD...',
  '..DPPD...',
  '...DPPD..',
  '...DPPPDD',
  '....DPPPD',
  '.....DDDD',
];
const LEG_FOLDED = ['DPPPPPPD', 'DDDDDDDD'];
const BACK_LEG_Y = 34;
const FRONT_LEG_Y = 36;
const LEGS = { backFar: 4, backNear: 6, frontFar: 25, frontNear: 27 };

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
  head?: string[];
  gauge?: string[];
  ruff?: string[];
  tail?: string[];
  dx?: number;
  dy?: number;
  /** Horizontal offsets of the near-side and far-side leg pairs (stride). */
  near?: number;
  far?: number;
  /** Replacement art for the front-near leg (paw on the laptop). */
  frontNearLeg?: string[];
  /** Layers drawn between the torso and the near legs. */
  props?: Layer[];
  extra?: Layer[];
}

function pose({
  head = HEAD,
  gauge = GAUGE,
  ruff = RUFF,
  tail = TAIL_UP,
  dx = 0,
  dy = 0,
  near = 0,
  far = 0,
  frontNearLeg = LEG_FRONT,
  props = [],
  extra = [],
}: Pose): string[] {
  const farLegBack = recolor(LEG_BACK, { P: 'r' });
  const farLegFront = recolor(LEG_FRONT, { P: 'r' });
  return compose(SIZE, [
    // Shorter tail variants are bottom-aligned so they still grow out of the hip.
    { art: tail, x: TAIL_X + dx, y: TAIL_Y + dy + TAIL_UP.length - tail.length },
    { art: farLegBack, x: LEGS.backFar + far + dx, y: BACK_LEG_Y + dy },
    { art: farLegFront, x: LEGS.frontFar + far + dx, y: FRONT_LEG_Y + dy },
    { art: TORSO, x: TORSO_X + dx, y: TORSO_Y + dy },
    ...props,
    { art: LEG_BACK, x: LEGS.backNear + near + dx, y: BACK_LEG_Y + dy },
    { art: frontNearLeg, x: LEGS.frontNear + near + dx, y: FRONT_LEG_Y + dy },
    { art: head, x: HEAD_X + dx, y: HEAD_Y + dy },
    { art: ruff, x: RUFF_X + dx, y: RUFF_Y + dy },
    { art: gauge, x: GAUGE_X + dx, y: GAUGE_Y + dy },
    ...extra,
  ]);
}

const idle = [
  pose({}),
  pose({ gauge: GAUGE_IDLE, ruff: RUFF_FLICKER, tail: TAIL_FLICK }),
  squashTop(pose({ gauge: GAUGE_REDLINE }), 33), // head and torso settle by one pixel
];

// Trot: near and far pairs swing in opposite directions with a two-pixel stride.
const walk = [
  pose({ near: 2, far: -2, tail: TAIL_FLICK }),
  squashTop(pose({ ruff: RUFF_FLICKER }), 33),
  pose({ near: -2, far: 2, tail: TAIL_FLICK, gauge: GAUGE_IDLE }),
  squashTop(pose({}), 33),
];

// Sleeping: sphinx pose with the belly on the ground, legs folded, head lowered, eyes closed,
// gauge dimmed, tail lying along the ground.
function sleepPose(gauge: string[], tail: string[]): string[] {
  return compose(SIZE, [
    { art: tail, x: 0, y: 44 },
    { art: TORSO, x: TORSO_X, y: 30 },
    { art: LEG_FOLDED, x: 28, y: 46 },
    { art: LEG_FOLDED, x: 7, y: 46 },
    { art: HEAD_SLEEP, x: HEAD_X, y: 23 },
    { art: RUFF, x: RUFF_X, y: 27 },
    { art: gauge, x: GAUGE_X, y: 25 },
  ]);
}
const sleep = [
  sleepPose(GAUGE_DIM, TAIL_BACK),
  sleepPose(recolor(GAUGE_DIM, { S: 'r' }), shift(TAIL_BACK, 0, 1)),
];

// Working: a laptop on the ground in front; the near front paw reaches down onto it.
const laptop = (art: string[]): Layer => ({ art, x: 34, y: 41 });
const work = [
  pose({ frontNearLeg: LEG_TYPE, props: [laptop(LAPTOP)] }),
  pose({ frontNearLeg: shift(LEG_TYPE, 0, 1), gauge: GAUGE_IDLE, props: [laptop(LAPTOP_TYPING)] }),
  pose({
    frontNearLeg: LEG_TYPE,
    ruff: RUFF_FLICKER,
    gauge: GAUGE_REDLINE,
    props: [laptop(LAPTOP)],
    extra: [{ art: ['y...y', '.....', '..y..'], x: 9, y: 6 }],
  }),
];

const happy = [
  pose({ tail: TAIL_FLICK, ruff: RUFF_FLICKER }),
  shift(pose({ gauge: GAUGE_REDLINE }), 0, -2),
  shift(pose({ tail: TAIL_FLICK, ruff: RUFF_FLICKER, near: 1, far: -1 }), 0, -4),
];

const hurtRecoil = pose({ head: HEAD_HURT, dx: -2, tail: TAIL_BACK, gauge: GAUGE_IDLE });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', r: 'h', k: 'h' })];

// Attack: crouch, then a dash-bite. Speed lines trail behind; the gauge redlines and glows.
const SPEED_LINES = [
  'yyyy....',
  '........',
  '.yyyyyy.',
  '........',
  'yyyyy...',
  '........',
  '..yyyy..',
];
const GLOW: Array<[number, number]> = [
  [27, 11],
  [36, 11],
  [27, 19],
  [36, 19],
];
/** Paints pale glow pixels around the gauge wherever they land on the coat. */
function glow(rows: string[], dx: number): string[] {
  const out = rows.map((row) => row.split(''));
  for (const [x, y] of GLOW) {
    const row = out[y];
    if (row && row[x + dx] === 'P') row[x + dx] = 'y';
  }
  return out.map((row) => row.join(''));
}
const attack = [
  squashTop(pose({ dx: -2, near: -2, far: 2, tail: TAIL_BACK, gauge: GAUGE_IDLE }), 33),
  glow(
    pose({
      head: HEAD_BITE,
      dx: 3,
      near: 3,
      far: -3,
      tail: TAIL_BACK,
      gauge: GAUGE_REDLINE,
      extra: [{ art: SPEED_LINES, x: 0, y: 22 }],
    }),
    3,
  ),
  glow(
    pose({
      head: HEAD_BITE,
      dx: 3,
      dy: -1,
      near: 3,
      far: -3,
      tail: TAIL_BACK,
      gauge: GAUGE_REDLINE,
      extra: [
        { art: SPEED_LINES, x: 0, y: 24 },
        { art: ['.A..', 'A...', '....', '..A.', '....', 'A...', '.A..'], x: 44, y: 16 },
      ],
    }),
    3,
  ),
];

export const OVERCLOCKWOLF_ADULT: SpriteDef = {
  id: 'overclockwolf-adult',
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
