import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, lean, recolor, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Cachecoral (Water, rare, teen): a coral creature with three branching arms. Each arm carries
 * rectangular "cache slot" polyps: 2 x 2 squares that are lit (foam white) or unlit (deep blue)
 * and blink as the cache fills. A face on the trunk, deep-blue shade at the base, two root feet.
 * It sways when idle.
 */
const PALETTE = {
  D: '#0d2a4a', // outline (tintable dark)
  P: '#2ec4b6', // teal coral (tintable primary)
  S: '#1b4f8a', // unlit slots / base shade (tintable secondary)
  A: '#e8fbff', // lit slots (tintable accent)
  t: '#1f9a8e', // coral shade
  h: '#ffffff', // eye glint
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 32;
const BX = 5; // body: 22 px wide, cols 5..26
const BY = 9; // body: 21 px tall, rows 9..29; feet on rows 30..31

// 22 x 21 body. Slot squares are authored as `A` and repainted by `slotted()`.
const BODY = [
  '.........DDDD.........',
  '........DPPPPD........',
  '.DDD....DPAAPD...DDD..',
  'DPPPD...DPAAPD..DPPPD.',
  'DPAAPD..DPPPPD..DPAAPD',
  'DPAAPD..DPAAPD..DPAAPD',
  'DPPPPD..DPAAPD..DPPPPD',
  'DPAAPD..DPPPPD..DPAAPD',
  'DPAAPD..DPAAPD..DPAAPD',
  '.DPPPDDDDPAAPDDDDPPPD.',
  '.DPPPPPPPPPPPPPPPPPPD.',
  '..DPPPPPPPPPPPPPPPPD..',
  '..DPPPPPPPPPPPPPPPPD..',
  '...DPPPPPDhPPPDhPPD...',
  '...DPPPPPDDPPPDDPPD...',
  '...DPPPPPPPPPPPPPPD...',
  '...DPPPPPPPPDDPPPPD...',
  '...DtPPPPPPPPPPPPtD...',
  '...DtSPPPPPPPPPPStD...',
  '....DtSSSSSSSSSStD....',
  '.....DDDDDDDDDDDD.....',
];

// Top-left corner of each 2 x 2 slot, in body coordinates, listed left arm, centre arm, right arm.
const SLOTS: Array<[number, number]> = [
  [2, 4],
  [2, 7],
  [10, 2],
  [10, 5],
  [10, 8],
  [18, 4],
  [18, 7],
];

/** Paints each slot lit (`1` -> A) or unlit (`0` -> S) according to a 7-char pattern. */
function slotted(body: string[], pattern: string): string[] {
  let out = body;
  SLOTS.forEach(([x, y], i) => {
    const c = pattern[i] === '1' ? 'A' : 'S';
    out = dots(out, c, [
      [x, y],
      [x + 1, y],
      [x, y + 1],
      [x + 1, y + 1],
    ]);
  });
  return out;
}

const FACE_SLEEP: Record<number, string> = {
  13: '...DPPPPPPPPPPPPPPD...',
  14: '...DPPPPPDDPPPDDPPD...',
  16: '...DPPPPPPPPPPPPPPD...',
};
const FACE_HAPPY: Record<number, string> = {
  13: '...DPPPPPDPPPPDPPPD...',
  14: '...DPPPPPPDhhDPPPPD...',
  16: '...DPPPPPPPDDDPPPPD...',
};
const FACE_HURT: Record<number, string> = {
  13: '...DPPPPPDDPPPDDPPD...',
  14: '...DPPPPPPPPPPPPPPD...',
  16: '...DPPPPPPPDDDPPPPD...',
};
const FACE_ATTACK: Record<number, string> = {
  13: '...DPPPPPDDPPPDDPPD...',
  14: '...DPPPPPDhPPPDhPPD...',
  16: '...DPPPPPPPPDDPPPPD...',
  17: '...DtPPPPPPPDDPPPtD...',
};

function body(pattern: string, ...faces: Array<Record<number, string>>): string[] {
  return slotted(withRows(BODY, Object.assign({}, ...faces)), pattern);
}

// One root foot, 4 x 2. Default positions: left (11, 30), right (17, 30).
const FOOT = ['DSSD', 'DDDD'];

const LAPTOP = ['.DDDDDDDD.', '.DllllllD.', '.DllllllD.', '.DDDDDDDD.', 'DggggggggD', 'DDDDDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghgghgghD' });

// A cache block flung forward in the attack.
const BLOCK = ['DDDD', 'DAAD', 'DAAD', 'DDDD'];

interface Pose {
  torso?: string[];
  dx?: number;
  dy?: number;
  leftFoot?: [number, number];
  rightFoot?: [number, number];
  extra?: Layer[];
}

function pose({
  torso = body('1011010'),
  dx = 0,
  dy = 0,
  leftFoot = [0, 0],
  rightFoot = [0, 0],
  extra = [],
}: Pose): string[] {
  return compose(SIZE, [
    { art: FOOT, x: BX + 6 + dx + leftFoot[0], y: BY + 21 + dy + leftFoot[1] },
    { art: FOOT, x: BX + 12 + dx + rightFoot[0], y: BY + 21 + dy + rightFoot[1] },
    { art: torso, x: BX + dx, y: BY + dy },
    ...extra,
  ]);
}

// Idle: sways left and right on its roots while the slots tick over.
const idle = [
  lean(pose({ torso: body('1011010') }), 29, 7, -1),
  pose({ torso: body('1101011') }),
  lean(pose({ torso: body('0111001') }), 29, 7, 1),
];

const walk = [
  lean(pose({ leftFoot: [-1, -1], rightFoot: [1, 0] }), 29, 8, -1),
  pose({ torso: body('1101011'), dy: -1 }),
  lean(pose({ leftFoot: [-1, 0], rightFoot: [1, -1] }), 29, 8, 1),
  pose({ torso: body('0111001'), dy: -1 }),
];

const sleep = [
  pose({ torso: body('0000000', FACE_SLEEP) }),
  pose({ torso: squashTop(body('0000100', FACE_SLEEP), 9) }),
];

const laptop = (art: string[]): Layer => ({ art, x: 21, y: 26 });
const work = [
  pose({ torso: body('1000010'), dx: -2, extra: [laptop(LAPTOP)] }),
  pose({ torso: body('1101011'), dx: -2, extra: [laptop(LAPTOP_TYPING)] }),
  pose({ torso: body('1111111'), dx: -2, extra: [laptop(LAPTOP)] }),
];

const happy = [
  pose({ torso: squashTop(body('1011010', FACE_HAPPY), 9) }),
  pose({ torso: body('1111111', FACE_HAPPY), dy: -3 }),
  pose({
    torso: body('1111111', FACE_HAPPY),
    dy: -5,
    leftFoot: [-1, 1],
    rightFoot: [1, 1],
  }),
];

const hurtRecoil = pose({ torso: body('0000000', FACE_HURT), dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', t: 'h' })];

// Attack: lean back, then lunge forward and fling a lit cache block off the front arm.
const attack = [
  lean(pose({ torso: body('1111111', FACE_ATTACK), dx: -2 }), 29, 6, -1),
  lean(pose({ torso: body('1011010', FACE_ATTACK), dx: 2 }), 29, 6, 1),
  lean(
    pose({
      torso: body('0010000', FACE_ATTACK),
      dx: 3,
      extra: [{ art: BLOCK, x: 28, y: 12 }],
    }),
    29,
    6,
    1,
  ),
];

export const CACHECORAL_TEEN: SpriteDef = {
  id: 'cachecoral-teen',
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
