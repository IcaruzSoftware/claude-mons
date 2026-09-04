import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, lean, recolor, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Dripple (Water, common, baby): a single teal water droplet with a face. Pointed tip, round
 * belly, a soft highlight on the upper left, deep-blue shade at the bottom, two stub feet.
 */
const PALETTE = {
  D: '#0d2a4a', // deep outline (tintable dark)
  P: '#2ec4b6', // teal water (tintable primary)
  S: '#1b4f8a', // deep blue shade (tintable secondary)
  A: '#e8fbff', // foam / splash (tintable accent)
  t: '#1f9a8e', // teal shade
  m: '#8fe3da', // light teal (feet, highlight edge)
  h: '#ffffff', // highlights
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 32;
const BX = 9; // body: 14 px wide, cols 9..22
const BY = 14; // body: 16 px tall, rows 14..29; feet on rows 30..31

// 14 x 16 droplet (no feet)
const BODY = [
  '......DD......',
  '.....DPPD.....',
  '.....DPPD.....',
  '....DPPPPD....',
  '....DPhPPD....',
  '...DPhhPPPD...',
  '..DPhhPPPPPD..',
  '.DPPhPPPPPPtD.',
  'DPPPPDhPPDhPtD',
  'DPPPPDDPPDDPtD',
  'DPmPPPPPPPPPtD',
  'DPmPPPPDDPPPtD',
  'DPPPPPPPPPtttD',
  '.DPPPPPPPttSD.',
  '..DPPPPSSSSD..',
  '...DDDDDDDD...',
];

const BODY_SLEEP = withRows(BODY, {
  8: 'DPPPPPPPPPPPtD',
  9: 'DPPPPDDPPDDPtD',
  11: 'DPmPPPPPPPPPtD',
});

const BODY_HAPPY = withRows(BODY, {
  8: 'DPPPPDPPPPDPtD',
  9: 'DPPPPPDhhDPPtD',
  11: 'DPmPPPDDDDPPtD',
});

const BODY_HURT = withRows(BODY, {
  8: 'DPPPPDDPPDDPtD',
  9: 'DPPPPPPPPPPPtD',
  11: 'DPmPPPDDDDPPtD',
});

// Attack face: eyes narrowed, mouth open.
const BODY_ATTACK = withRows(BODY, {
  8: 'DPPPPDDPPDDPtD',
  9: 'DPPPPDhPPDhPtD',
  11: 'DPmPPPPDDPPPtD',
  12: 'DPPPPPPDDPtttD',
});

// One stub foot, 4 x 2. Default positions: left (12, 30), right (17, 30).
const FOOT = ['DmmD', 'DDDD'];

// Laptop for the `work` anim, 10 x 6, drawn in front of the body.
const LAPTOP = ['.DDDDDDDD.', '.DllllllD.', '.DllllllD.', '.DDDDDDDD.', 'DggggggggD', 'DDDDDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghgghgghD' });

interface Pose {
  body?: string[];
  /** Whole-sprite offset (hop / recoil / lunge). */
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
    { art: FOOT, x: BX + 3 + dx + leftFoot[0], y: BY + 16 + dy + leftFoot[1] },
    { art: FOOT, x: BX + 8 + dx + rightFoot[0], y: BY + 16 + dy + rightFoot[1] },
    { art: body, x: BX + dx, y: BY + dy },
    ...extra,
  ]);
}

// Wobble: the tip sways while the feet stay planted (pivot on the foot row).
const upright = pose({});
const idle = [
  upright,
  lean(upright, 29, 6, 1),
  pose({ body: squashTop(BODY, 3) }),
  lean(upright, 29, 6, -1),
];

const walk = [
  pose({ leftFoot: [-1, -1], rightFoot: [1, 0] }),
  lean(pose({ dy: -1 }), 29, 8, 1),
  pose({ leftFoot: [-1, 0], rightFoot: [1, -1] }),
  lean(pose({ dy: -1 }), 29, 8, -1),
];

// Asleep: the droplet slumps (tip shorter) and the eyes close.
const sleep = [
  pose({ body: squashTop(BODY_SLEEP, 3) }),
  pose({ body: squashTop(squashTop(BODY_SLEEP, 3), 4) }),
];

const laptop = (art: string[]): Layer => ({ art, x: 20, y: 26 });
const work = [
  pose({ dx: 1, extra: [laptop(LAPTOP)] }),
  dots(pose({ body: squashTop(BODY, 3), dx: 1, extra: [laptop(LAPTOP_TYPING)] }), 'A', [
    [11, 12],
    [24, 10],
  ]),
  dots(lean(pose({ dx: 1, extra: [laptop(LAPTOP)] }), 29, 8, 1), 'A', [
    [9, 10],
    [25, 13],
  ]),
];

const happy = [
  pose({ body: squashTop(BODY, 3) }),
  pose({ body: BODY_HAPPY, dy: -3 }),
  dots(pose({ body: BODY_HAPPY, dy: -5, leftFoot: [-1, 1], rightFoot: [1, 1] }), 'A', [
    [6, 12],
    [26, 10],
    [8, 20],
  ]),
];

const hurtRecoil = pose({ body: BODY_HURT, dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', t: 'h', m: 'h' })];

// Attack: a squat, then a lunge with a spray of droplets in front.
const attack = [
  pose({ body: squashTop(BODY_ATTACK, 3), dx: -2 }),
  lean(pose({ body: BODY_ATTACK, dx: 4 }), 29, 5, 1),
  dots(lean(pose({ body: BODY_ATTACK, dx: 5 }), 29, 5, 1), 'A', [
    [29, 17],
    [30, 20],
    [31, 23],
    [30, 26],
    [28, 14],
  ]),
];

export const DRIPPLE_BABY: SpriteDef = {
  id: 'dripple-baby',
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
