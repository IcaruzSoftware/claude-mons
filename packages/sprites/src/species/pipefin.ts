import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, shift, withRows, type Layer } from '../util.ts';

/**
 * Pipefin (Water, common, teen): a fish whose body is a segmented pipe. Side view facing right:
 * a teal cylinder with two deep-blue flange rings, a rounded head with one eye, a foam dorsal fin,
 * a forked tail on the left, and two fin-feet underneath that it wriggles along on.
 */
const PALETTE = {
  D: '#0d2a4a', // outline (tintable dark)
  P: '#2ec4b6', // teal pipe (tintable primary)
  S: '#1b4f8a', // deep blue flanges / tail (tintable secondary)
  A: '#e8fbff', // foam fins / bubbles (tintable accent)
  t: '#1f9a8e', // pipe underside shade
  m: '#8fe3da', // pipe top highlight
  h: '#ffffff', // eye glint, bubble cores
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 32;
const BX = 2; // body: 28 px wide, cols 2..29
const BY = 17; // body: 11 px tall, rows 17..27; fins on rows 26..31

// 28 x 11 pipe body: end cap at col 6, flanges at cols 9..12 and 16..19, head on the right.
// Cols 0..5 are left empty for the tail overlay.
const BODY = [
  '.....................DAD....',
  '.........DDDD...DDDDDAAAD...',
  '......DDDDSSDDDDDSSDDDDDD...',
  '......DmmDSSDmmmDSSDmmmmmD..',
  '......DPPDSSDPPPDSSDPPPPDhD.',
  '......DPPDSSDPPPDSSDPPPPDDPD',
  '......DPPDSSDPPPDSSDPPPPPPPD',
  '......DttDSSDtttDSSDttttDDtD',
  '......DttDSSDtttDSSDttttttD.',
  '......DDDDSSDDDDDSSDDDDDDD..',
  '.........DDDD...DDDD........',
];

const BODY_SLEEP = withRows(BODY, {
  0: '............................',
  1: '.........DDDD...DDDD.DAAD...',
  4: '......DPPDSSDPPPDSSDPPPPPPD.',
});

const BODY_HURT = withRows(BODY, {
  4: '......DPPDSSDPPPDSSDPPPPDDD.',
  5: '......DPPDSSDPPPDSSDPPPPPPPD',
  7: '......DttDSSDtttDSSDtttDDDtD',
});

const BODY_HAPPY = withRows(BODY, {
  4: '......DPPDSSDPPPDSSDPPPPDPD.',
  5: '......DPPDSSDPPPDSSDPPPPPDPD',
});

// Attack face: mouth open wide.
const BODY_ATTACK = withRows(BODY, {
  7: '......DttDSSDtttDSSDtttDDDDD',
  8: '......DttDSSDtttDSSDtttDDDD.',
});

// Forked tail, 6 x 8, attached to the end cap at body col 6, rows 2..9.
const TAIL = ['DD....', 'DSD...', 'DSAD..', '.DAAAA', '.DAAAA', 'DSAD..', 'DSD...', 'DD....'];
const TAIL_UP = ['DD....', 'DSD...', 'DSAD..', 'DSAAAA', '.DAAAA', '.DSAD.', '..DD..', '......'];
const TAIL_DOWN = [...TAIL_UP].reverse();
const TAIL_X = 0;
const TAIL_Y = 2;

// One fin-foot, 5 x 6; the top row overwrites the pipe's bottom outline. Body-relative x: 12, 20.
const FIN = ['.DPD.', '.DPD.', '.DPD.', '.DPPD', 'DPPPD', 'DDDDD'];
const FIN_FOLDED = ['DPPPD', 'DDDDD'];
const FINS = { back: 12, front: 20 };

const LAPTOP = ['.DDDDD.', '.DlllD.', '.DlllD.', '.DDDDD.', 'DgggggD', 'DDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghghgD' });

const BUBBLE = ['.A.', 'AhA', '.A.'];
const BUBBLE_SMALL = ['A'];

interface Pose {
  body?: string[];
  tail?: string[];
  dx?: number;
  dy?: number;
  backFin?: [number, number];
  frontFin?: [number, number];
  extra?: Layer[];
}

function pose({
  body = BODY,
  tail = TAIL,
  dx = 0,
  dy = 0,
  backFin = [0, 0],
  frontFin = [0, 0],
  extra = [],
}: Pose): string[] {
  const x = BX + dx;
  const y = BY + dy;
  return compose(SIZE, [
    { art: body, x, y },
    { art: tail, x: x + TAIL_X, y: y + TAIL_Y },
    { art: FIN, x: x + FINS.back + backFin[0], y: y + 9 + backFin[1] },
    { art: FIN, x: x + FINS.front + frontFin[0], y: y + 9 + frontFin[1] },
    ...extra,
  ]);
}

const idle = [pose({}), pose({ tail: TAIL_UP }), pose({ tail: TAIL_DOWN })];

// Walk: fins scissor back and forth while the tail wags and the body bobs.
const walk = [
  pose({ backFin: [1, 0], frontFin: [-1, 0], tail: TAIL_UP }),
  shift(pose({ backFin: [0, -1], frontFin: [0, 0] }), 0, -1),
  pose({ backFin: [-1, 0], frontFin: [1, 0], tail: TAIL_DOWN }),
  shift(pose({ backFin: [0, 0], frontFin: [0, -1] }), 0, -1),
];

// Sleep: belly on the ground, fins folded, eye closed, dorsal fin drooping.
function sleepPose(tail: string[]): string[] {
  const x = BX;
  const y = BY + 3;
  return compose(SIZE, [
    { art: BODY_SLEEP, x, y },
    { art: tail, x: x + TAIL_X, y: y + TAIL_Y },
    { art: FIN_FOLDED, x: x + FINS.back, y: y + 10 },
    { art: FIN_FOLDED, x: x + FINS.front, y: y + 10 },
  ]);
}
const sleep = [
  sleepPose(TAIL),
  dots(sleepPose(TAIL_DOWN), 'A', [
    [30, 14],
    [31, 12],
  ]),
];

// Work: shifted left so a laptop fits under the snout; the front fin taps the keys.
const laptop = (art: string[]): Layer => ({ art, x: 25, y: 26 });
const work = [
  pose({ dx: -2, frontFin: [1, -1], extra: [laptop(LAPTOP)] }),
  pose({ dx: -2, tail: TAIL_UP, extra: [laptop(LAPTOP_TYPING)] }),
  pose({
    dx: -2,
    tail: TAIL_DOWN,
    frontFin: [1, -1],
    extra: [laptop(LAPTOP), { art: BUBBLE_SMALL, x: 29, y: 13 }],
  }),
];

const happy = [
  pose({ body: BODY_HAPPY, tail: TAIL_UP, extra: [{ art: BUBBLE_SMALL, x: 30, y: 15 }] }),
  shift(pose({ body: BODY_HAPPY, extra: [{ art: BUBBLE, x: 28, y: 11 }] }), 0, -2),
  shift(
    pose({
      body: BODY_HAPPY,
      tail: TAIL_DOWN,
      backFin: [1, 0],
      frontFin: [-1, 0],
      extra: [
        { art: BUBBLE, x: 27, y: 8 },
        { art: BUBBLE_SMALL, x: 31, y: 13 },
      ],
    }),
    0,
    -4,
  ),
];

const hurtRecoil = pose({ body: BODY_HURT, tail: TAIL_UP, dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', t: 'h', m: 'h' })];

// Attack: coil back, then lunge with the tail whipping and a spray of bubbles off the snout.
const attack = [
  pose({ dx: -2, tail: TAIL_UP, backFin: [-1, 0], frontFin: [1, 0] }),
  pose({ body: BODY_ATTACK, dx: 2, tail: TAIL_DOWN, backFin: [1, 0], frontFin: [-1, 0] }),
  dots(
    pose({ body: BODY_ATTACK, dx: 2, tail: TAIL_DOWN, backFin: [1, 0], frontFin: [-1, 0] }),
    'A',
    [
      [30, 19],
      [31, 22],
      [31, 26],
      [30, 28],
      [31, 16],
    ],
  ),
];

export const PIPEFIN_TEEN: SpriteDef = {
  id: 'pipefin-teen',
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
