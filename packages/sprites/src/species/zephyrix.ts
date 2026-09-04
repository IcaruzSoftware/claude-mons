import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, shift, withRows, type Layer } from '../util.ts';

/**
 * Zephyrix (Air, rare, teen): a fox-like breeze spirit seen from the side, facing right. Sky-blue
 * coat with a white chest and belly, pointed ears with lavender insides, and a long tail that
 * rises behind it and fades into translucent lavender wind streaks.
 */
const PALETTE = {
  D: '#2b3550', // outline (tintable dark)
  P: '#4fc3f7', // sky blue coat (tintable primary)
  S: '#f5f7ff', // chest, belly, paws (tintable secondary)
  A: '#b39ddb', // lavender ears / tail streaks (tintable accent)
  p: '#2b9bd6', // far-side legs
  b: '#cfe3f7', // far-side paws
  a: '#b39ddb88', // translucent streak ends
  h: '#ffffff', // eye glint, flash
  y: '#fff176', // sparks
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 32;
const BX = 5; // body: 25 px wide, cols 5..29
const BY = 14; // body: 14 px tall, rows 14..27; legs rows 28..31

// 25 x 14 body: ears on top, head at the right, rump at the left.
const BODY = [
  '.............D......D....',
  '............DAD....DAD...',
  '............DAAD..DAAD...',
  '...........DPAADDDAAPD...',
  '..........DPPPPPPPPPPPD..',
  '.........DPPPPPPDhPPPPPD.',
  '.....DDDDPPPPPPPDDPPPPSSD',
  '...DDPPPPPPPPPPPPPPPPSSSD',
  '..DPPPPPPPPPPPPPPPPPPSSD.',
  '.DPPPPPPPPPPPPPPPPPPSSSD.',
  '.DPPPPPPPPPPPPPPPPPSSSD..',
  'DPPPPPPPPPPPSSSSSSSSSSD..',
  'DPPPPPPPPPSSSSSSSSSSSD...',
  '.DDDDDDDDDDDDDDDDDDDD....',
];

const EYES_CLOSED: Record<number, string> = {
  5: '.........DPPPPPPPPPPPPPD.',
  6: '.....DDDDPPPPPPPDDPPPPSSD',
};
const EYES_HAPPY: Record<number, string> = {
  5: '.........DPPPPPPDDPPPPPD.',
  6: '.....DDDDPPPPPPDPPDPPPSSD',
};
const MOUTH_OPEN: Record<number, string> = {
  7: '...DDPPPPPPPPPPPPPPPPSDDD',
  8: '..DPPPPPPPPPPPPPPPPPPSSD.',
};

function body(...overrides: Array<Record<number, string>>): string[] {
  return withRows(BODY, Object.assign({}, ...overrides));
}

// Tail, 9 wide x 12 tall, drawn behind the body: a thick blue plume rising from the rump that
// turns into lavender wind streaks at the tip. Placed at (BX - 5, BY - 1).
const TAIL_A = [
  'a.aa.....',
  '.aAAA....',
  '.AAAAAD..',
  '.DAAAPPD.',
  '.DAPPPPD.',
  '.DPPPPPD.',
  '..DPPPPD.',
  '..DPPPPD.',
  '...DPPPD.',
  '....DPPD.',
  '.....DPD.',
  '......DD.',
];
const TAIL_B = withRows(TAIL_A, { 0: '..a.a....', 1: 'aAAA.....', 2: '.AAAAAD..' });
const TAIL_CURL = withRows(TAIL_A, { 0: '.........', 1: '..AAA....', 2: '.AAAAAD..' });
// Streaming straight back during the pounce.
const TAIL_STREAK = [
  '.........',
  '.........',
  '.........',
  'aaAAAAD..',
  'aAAAPPPD.',
  '.DPPPPPD.',
  '..DPPPPD.',
  '..DPPPPD.',
  '...DPPPD.',
  '....DPPD.',
  '.....DPD.',
  '......DD.',
];

// One leg, 3 x 4, ending in a white paw. Far legs are shaded.
const LEG_NEAR = ['DPD', 'DPD', 'DSD', 'DDD'];
const LEG_FAR = recolor(LEG_NEAR, { P: 'p', S: 'b' });
const PAW_FOLDED = ['DSSD', 'DDDD'];
// Body-relative leg columns.
const LEGS = { backFar: 4, backNear: 7, frontFar: 15, frontNear: 18 };

const LAPTOP = ['.DDDDDD.', '.DllllD.', '.DllllD.', '.DDDDDD.', 'DggggggD', 'DDDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghgghgD' });

interface Pose {
  body?: string[];
  tail?: string[];
  dx?: number;
  dy?: number;
  /** Horizontal offsets of the near-side and far-side leg pairs (walk cycle). */
  near?: number;
  far?: number;
  /** Extra offset for the front legs only (pounce). */
  front?: [number, number];
  extra?: Layer[];
}

function pose({
  body: art = BODY,
  tail = TAIL_A,
  dx = 0,
  dy = 0,
  near = 0,
  far = 0,
  front = [0, 0],
  extra = [],
}: Pose): string[] {
  const x = BX + dx;
  const y = BY + dy;
  const legY = y + 14;
  return compose(SIZE, [
    { art: tail, x: x - 5, y: y - 1 },
    { art: LEG_FAR, x: x + LEGS.backFar + far, y: legY },
    { art: LEG_FAR, x: x + LEGS.frontFar + far + front[0], y: legY + front[1] },
    { art, x, y },
    { art: LEG_NEAR, x: x + LEGS.backNear + near, y: legY },
    { art: LEG_NEAR, x: x + LEGS.frontNear + near + front[0], y: legY + front[1] },
    ...extra,
  ]);
}

const idle = [pose({}), pose({ tail: TAIL_B }), pose({ tail: TAIL_B, body: body(EYES_CLOSED) })];

const walk = [
  pose({ near: 1, far: -1 }),
  shift(pose({ tail: TAIL_B }), 0, -1),
  pose({ near: -1, far: 1, tail: TAIL_B }),
  shift(pose({}), 0, -1),
];

// Sleeping: lying down with the paws tucked under, eyes closed, tail curled.
function sleepPose(art: string[]): string[] {
  const x = BX;
  const y = BY + 4;
  return compose(SIZE, [
    { art: TAIL_CURL, x: x - 5, y: y - 4 },
    { art, x, y },
    { art: PAW_FOLDED, x: x + LEGS.backNear - 1, y: y + 12 },
    { art: PAW_FOLDED, x: x + LEGS.frontNear - 1, y: y + 12 },
  ]);
}
const sleep = [
  sleepPose(body(EYES_CLOSED)),
  sleepPose(withRows(body(EYES_CLOSED), { 0: '.............D.....D.....' })),
];

// Working: sits back a little so the laptop fits in front of the chest; a front paw taps keys.
const laptop = (art: string[]): Layer => ({ art, x: 24, y: 26 });
const work = [
  pose({ dx: -2, tail: TAIL_CURL, front: [1, -2], extra: [laptop(LAPTOP)] }),
  pose({ dx: -2, tail: TAIL_CURL, extra: [laptop(LAPTOP_TYPING)] }),
  dots(pose({ dx: -2, tail: TAIL_B, front: [1, -2], extra: [laptop(LAPTOP)] }), 'y', [
    [3, 8],
    [8, 6],
  ]),
];

const happy = [
  pose({ body: body(EYES_HAPPY, MOUTH_OPEN), tail: TAIL_B }),
  shift(pose({ body: body(EYES_HAPPY, MOUTH_OPEN) }), 0, -2),
  shift(pose({ body: body(EYES_HAPPY, MOUTH_OPEN), tail: TAIL_B, near: 1, far: -1 }), 0, -4),
];

const hurtRecoil = pose({ body: body(EYES_CLOSED), dx: -2, tail: TAIL_STREAK });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', p: 'h', b: 'h', a: 'h' })];

// Attack: crouches, springs forward with the front legs reaching out, lands in a gust.
const attack = [
  pose({ dx: -2, near: -1, far: 1, tail: TAIL_CURL }),
  pose({ dx: 3, dy: -3, tail: TAIL_STREAK, near: -1, far: -1, front: [2, 2] }),
  dots(pose({ dx: 4, tail: TAIL_STREAK, near: 1, far: -1, body: body(MOUTH_OPEN) }), 'A', [
    [30, 22],
    [31, 25],
    [30, 28],
    [31, 19],
  ]),
];

export const ZEPHYRIX_TEEN: SpriteDef = {
  id: 'zephyrix-teen',
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
