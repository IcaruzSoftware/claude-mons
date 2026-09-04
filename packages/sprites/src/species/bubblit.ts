import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Bubblit (Water, rare, baby): a translucent jelly bubble. A pale teal dome with foam-white
 * highlight arcs on the upper left, a darker teal rim on the lower right, two eyes and three thin
 * tentacle feet that wiggle.
 */
const PALETTE = {
  D: '#0d2a4a', // rim outline (tintable dark)
  P: '#2ec4b6', // teal inner rim / tentacles (tintable primary)
  S: '#1b4f8a', // deep blue tentacle tips (tintable secondary)
  A: '#e8fbff', // foam highlight (tintable accent)
  m: '#9fe8e0', // translucent jelly fill
  h: '#ffffff', // glints, bubble cores
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 32;
const BX = 8; // dome: 16 px wide, cols 8..23
const BY = 13; // dome: 14 px tall, rows 13..26; tentacles rows 26..31

// 16 x 14 dome
const DOME = [
  '.....DDDDDD.....',
  '...DDmmAAmmDD...',
  '..DmAAhhAAmmmD..',
  '.DmAhhmmmmmmmmD.',
  '.DmAhmmmmmmmmPD.',
  'DmAAmmmmmmmmmmPD',
  'DmAmmmmmmmmmmPPD',
  'DmAmmmDhmmmDhmPD',
  'DmAmmmDDmmmDDPPD',
  'DmmmmmmmmmmmmPPD',
  'DPmmmmmmmDDmmPPD',
  '.DPmmmmmmmmmPPD.',
  '.DPPmmmmmmmPPPD.',
  '..DDDDDDDDDDDD..',
];

const DOME_SLEEP = withRows(DOME, {
  7: 'DmAmmmmmmmmmmmPD',
  8: 'DmAmmmDDmmmDDPPD',
  10: 'DPmmmmmmmmmmmPPD',
});

const DOME_HAPPY = withRows(DOME, {
  7: 'DmAmmmDmmmmDmmPD',
  8: 'DmAmmmmDhhDmmPPD',
  10: 'DPmmmmmDDDDmmPPD',
});

const DOME_HURT = withRows(DOME, {
  7: 'DmAmmmDDmmmDDmPD',
  8: 'DmAmmmmmmmmmmPPD',
  10: 'DPmmmmmDDDDmmPPD',
});

// Attack face: narrowed eyes, open mouth.
const DOME_ATTACK = withRows(DOME, {
  7: 'DmAmmmDDmmmDDmPD',
  8: 'DmAmmmDhmmmDhPPD',
  10: 'DPmmmmmmmDDmmPPD',
  11: '.DPmmmmmmDDmPPD.',
});

// Tentacles, 5 x 6; the top row overwrites the dome's bottom outline so they grow out of it.
// Default x positions: 9, 13, 17 (centres under the dome).
const T_MID = ['.DPD.', '.DPD.', '.DPD.', '.DPD.', '.DPD.', '.DSD.'];
const T_LEFT = ['.DPD.', '.DPD.', '.DPD.', 'DPD..', 'DPD..', 'DSD..'];
const T_RIGHT = ['.DPD.', '.DPD.', '.DPD.', '..DPD', '..DPD', '..DSD'];
const T_LIFT = ['.DPD.', '.DPD.', '.DPD.', '.DPD.', '.DSD.', '.....'];
const T_CURL_L = ['.DPD.', '.DPD.', 'DPD..', 'DPD..', '.DPD.', '.DSD.'];
const T_CURL_R = ['.DPD.', '.DPD.', '..DPD', '..DPD', '.DPD.', '.DSD.'];
const T_LIMP = ['.DPD.', '.DPD.', '.DPD.', '.DPD.', '.DSD.', 'DDD..'];

const LAPTOP = ['.DDDDDDDD.', '.DllllllD.', '.DllllllD.', '.DDDDDDDD.', 'DggggggggD', 'DDDDDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghgghgghD' });

const BUBBLE = ['.A.', 'AhA', '.A.'];
const BUBBLE_SMALL = ['A'];

interface Pose {
  dome?: string[];
  tentacles?: [string[], string[], string[]];
  dx?: number;
  dy?: number;
  extra?: Layer[];
}

function pose({
  dome = DOME,
  tentacles = [T_MID, T_MID, T_MID],
  dx = 0,
  dy = 0,
  extra = [],
}: Pose): string[] {
  const ty = BY + 13 + dy;
  return compose(SIZE, [
    { art: tentacles[0], x: BX + 1 + dx, y: ty },
    { art: tentacles[1], x: BX + 5 + dx, y: ty },
    { art: tentacles[2], x: BX + 9 + dx, y: ty },
    { art: dome, x: BX + dx, y: BY + dy },
    ...extra,
  ]);
}

const idle = [
  pose({}),
  pose({ dome: squashTop(DOME, 3), tentacles: [T_LEFT, T_MID, T_RIGHT] }),
  pose({ tentacles: [T_CURL_L, T_MID, T_CURL_R] }),
];

// Walk: the dome bobs and the tentacles sweep back and forth like little legs.
const walk = [
  pose({ tentacles: [T_LEFT, T_RIGHT, T_LEFT] }),
  pose({ dy: -1, tentacles: [T_MID, T_LIFT, T_MID] }),
  pose({ tentacles: [T_RIGHT, T_LEFT, T_RIGHT] }),
  pose({ dy: -1, tentacles: [T_LIFT, T_MID, T_LIFT] }),
];

const sleep = [
  pose({ dome: squashTop(DOME_SLEEP, 3), tentacles: [T_LIMP, T_MID, T_LIMP] }),
  pose({ dome: squashTop(squashTop(DOME_SLEEP, 3), 4), tentacles: [T_LIMP, T_LIMP, T_LIMP] }),
];

const laptop = (art: string[]): Layer => ({ art, x: 21, y: 26 });
const work = [
  pose({ dx: -1, tentacles: [T_MID, T_MID, T_RIGHT], extra: [laptop(LAPTOP)] }),
  pose({
    dome: squashTop(DOME, 3),
    dx: -1,
    tentacles: [T_MID, T_MID, T_CURL_R],
    extra: [laptop(LAPTOP_TYPING)],
  }),
  pose({
    dx: -1,
    tentacles: [T_MID, T_MID, T_RIGHT],
    extra: [laptop(LAPTOP), { art: BUBBLE_SMALL, x: 5, y: 12 }],
  }),
];

const happy = [
  pose({ dome: squashTop(DOME, 3) }),
  pose({
    dome: DOME_HAPPY,
    dy: -3,
    tentacles: [T_LEFT, T_MID, T_RIGHT],
    extra: [{ art: BUBBLE_SMALL, x: 26, y: 12 }],
  }),
  pose({
    dome: DOME_HAPPY,
    dy: -5,
    tentacles: [T_CURL_L, T_LIFT, T_CURL_R],
    extra: [
      { art: BUBBLE, x: 25, y: 8 },
      { art: BUBBLE_SMALL, x: 5, y: 10 },
    ],
  }),
];

const hurtRecoil = pose({ dome: DOME_HURT, dx: -2, tentacles: [T_RIGHT, T_RIGHT, T_RIGHT] });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', m: 'h' })];

// Attack: a squat, then a lunge with the tentacles trailing and a burst of bubbles in front.
const attack = [
  pose({ dome: squashTop(DOME_ATTACK, 3), dx: -2, tentacles: [T_LEFT, T_MID, T_RIGHT] }),
  pose({ dome: DOME_ATTACK, dx: 4, tentacles: [T_LEFT, T_LEFT, T_LEFT] }),
  dots(
    pose({
      dome: DOME_ATTACK,
      dx: 5,
      tentacles: [T_LEFT, T_LEFT, T_CURL_L],
      extra: [{ art: BUBBLE, x: 29, y: 15 }],
    }),
    'A',
    [
      [30, 21],
      [31, 24],
      [29, 12],
      [31, 10],
    ],
  ),
];

export const BUBBLIT_BABY: SpriteDef = {
  id: 'bubblit-baby',
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
