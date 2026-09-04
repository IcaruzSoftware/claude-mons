import type { SpriteDef } from '../types.ts';
import {
  compose,
  dots,
  frame,
  lean,
  recolor,
  shift,
  squashTop,
  withRows,
  type Layer,
} from '../util.ts';

/**
 * Torrentide (Water, common, adult): a wave-shaped whale, 48 grid. Side view facing right: the
 * tail rises on the left into a breaking crest with a foam lip that curls forward over a hollow,
 * the back slopes down and then swells into a big rounded head with one eye and a long mouth
 * line, and the belly is deep blue. A pectoral flipper paddles under the head, and short accent
 * dashes stream out behind the tail like a data pipeline.
 */
const PALETTE = {
  D: '#0d2a4a', // outline (tintable dark)
  P: '#2ec4b6', // teal body (tintable primary)
  S: '#1b4f8a', // deep blue belly (tintable secondary)
  A: '#e8fbff', // foam crest, stream dashes, splash (tintable accent)
  t: '#1f9a8e', // belly transition shade
  m: '#8fe3da', // highlight along the back and under the foam
  h: '#ffffff', // glints
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 48;
const BX = 5; // body: 42 px wide, cols 5..46
const BY = 12; // body: 36 px tall, rows 12..47

// 42 x 36 body. Crest and lip on the left (rows 0..9), hollow under the lip, head dome on the right.
const BODY = [
  '.......DDDDD..............................',
  '.....DDAAhhADD............................',
  '....DAAAAAAAAADD..........................',
  '...DAAhmmmmmAhAADD........................',
  '...DAmmPPPPPmmAAAAD.......................',
  '..DAmPPPPPPPPPmmhAAD......................',
  '..DmPPPPPPPPPPPPmmAAD.....................',
  '..DPPPPPPDDDDDDDPPmAD.....................',
  '.DmPPPPPD.......DDPmD.....................',
  '.DPPPPPPD.........DDD.....................',
  '.DPPPPPPD.................................',
  '.DPPPPPPPDD...............................',
  'DPPPPPPPPPPDD.............................',
  'DPPPPPPPPPPPPDD...........................',
  'DPPPPPPPPPPPPPPDD.........................',
  'DPPPPPPPPPPPPPPPPDD.......................',
  'DPPPPPPPPPPPPPPPPPPDD............DDDDD....',
  'DPPPPPPPPPPPPPPPPPPPPDD........DDmmmmmD...',
  'DPPPPPPPPPPPPPPPPPPPPmmDD.....DmmPPPPPmD..',
  'DPPPPPPPPPPPPPPPPPPPPPPmmDD..DmPPPPPPPPD..',
  'DPPPPPPPPPPPPPPPPPPPPPPPPmmDDmPPPPPPPPPPD.',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPmmPPPPPPDhPPPD.',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPDDPPPD.',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPDDPPPPD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
  'DtttttttttttttttttttttttttttttDDDDDDDDDDDD',
  'DSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSD',
  'DSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSD',
  'DSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSD',
  'DSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSD.',
  'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD..',
];

const EYE_CLOSED: Record<number, string> = {
  21: 'DPPPPPPPPPPPPPPPPPPPPPPPPPPmmPPPPPPPPPPPD.',
  22: 'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPDDPPPD.',
  23: 'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
};
const EYE_HAPPY: Record<number, string> = {
  21: 'DPPPPPPPPPPPPPPPPPPPPPPPPPPmmPPPPPPDDPPPD.',
  22: 'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPDPPDPPD.',
  23: 'DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD',
};
const MOUTH_OPEN: Record<number, string> = {
  31: 'DSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSDDDDDDDDDSD',
  32: 'DSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSDDDDDDSSD',
};

function body(...overrides: Array<Record<number, string>>): string[] {
  return withRows(BODY, Object.assign({}, ...overrides));
}

// Pectoral flipper, 8 x 5, drawn over the body under the head. Body-relative position (28, 29).
const FLIPPER_FWD = ['DDDD....', 'DPPPDD..', '.DPPPPD.', '..DDPPPD', '....DDDD'];
const FLIPPER_MID = ['........', 'DDDDDDD.', 'DPPPPPPD', 'DDDDDDD.', '........'];
const FLIPPER_BACK = ['....DDDD', '..DDPPPD', '.DPPPPD.', 'DPPPDD..', 'DDDD....'];
const FLIPPER_X = 28;
const FLIPPER_Y = 29;

// Blowhole spout for the happy anim, 7 x 5, above the head.
const SPOUT = ['A.....A', '.h...h.', '..A.A..', '...A...', '...A...'];

// Splash thrown forward by the wave crash, 8 x 14, in front of the head.
const SPLASH = [
  '....A...',
  '..A...h.',
  '.h..A...',
  'A.....A.',
  '..A.h..A',
  '.A....A.',
  '...A.h..',
  'A.....A.',
  '..h..A..',
  '.A....h.',
  '...A....',
  'A....A..',
  '..A....A',
  '.....h..',
];

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

// Stream dashes behind the tail (grid cols 0..4), one 3 px dash per row, drifting left per phase.
const STREAM_ROWS = [20, 26, 32, 38, 44];
function stream(rows: string[], phase: number): string[] {
  const foam: Array<[number, number]> = [];
  const lead: Array<[number, number]> = [];
  STREAM_ROWS.forEach((y, i) => {
    const x0 = (i * 2 + 5 - phase) % 5;
    lead.push([x0, y]);
    if (x0 + 1 < 5) foam.push([x0 + 1, y]);
    if (x0 + 2 < 5) foam.push([x0 + 2, y]);
  });
  return dots(dots(rows, 'A', foam), 'm', lead);
}

interface Pose {
  torso?: string[];
  flipper?: string[];
  dx?: number;
  dy?: number;
  extra?: Layer[];
}

function pose({
  torso = body(),
  flipper = FLIPPER_FWD,
  dx = 0,
  dy = 0,
  extra = [],
}: Pose): string[] {
  return compose(SIZE, [
    { art: torso, x: BX + dx, y: BY + dy },
    { art: flipper, x: BX + FLIPPER_X + dx, y: BY + FLIPPER_Y + dy },
    ...extra,
  ]);
}

const idle = [
  stream(pose({}), 0),
  stream(squashTop(pose({ flipper: FLIPPER_MID }), 20), 1), // crest settles by one pixel
  stream(pose({}), 2),
];

// Walk: the flipper paddles while the body surges up and down and the stream flows.
const walk = [
  stream(pose({ flipper: FLIPPER_BACK }), 0),
  stream(shift(pose({ flipper: FLIPPER_MID }), 0, -1), 1),
  stream(pose({ flipper: FLIPPER_FWD }), 2),
  stream(shift(pose({ flipper: FLIPPER_MID }), 0, -1), 3),
];

const sleep = [
  pose({ torso: body(EYE_CLOSED), flipper: FLIPPER_FWD }),
  squashTop(pose({ torso: body(EYE_CLOSED), flipper: FLIPPER_FWD }), 20),
];

// Work: shifted left so a laptop fits on the ground in front of the chin; the flipper types.
const laptop = (art: string[]): Layer => ({ art, x: 34, y: 41 });
const work = [
  pose({ dx: -5, flipper: FLIPPER_MID, extra: [laptop(LAPTOP)] }),
  pose({ dx: -5, flipper: FLIPPER_FWD, extra: [laptop(LAPTOP_TYPING)] }),
  dots(pose({ dx: -5, flipper: FLIPPER_MID, extra: [laptop(LAPTOP)] }), 'A', [
    [1, 20],
    [0, 27],
    [2, 34],
  ]),
];

const spout = (x: number, y: number): Layer => ({ art: SPOUT, x, y });
const happy = [
  stream(pose({ torso: body(EYE_HAPPY), flipper: FLIPPER_BACK }), 0),
  stream(shift(pose({ torso: body(EYE_HAPPY), flipper: FLIPPER_MID }), 0, -2), 1),
  stream(
    shift(pose({ torso: body(EYE_HAPPY), flipper: FLIPPER_FWD, extra: [spout(37, 19)] }), 0, -4),
    2,
  ),
];

const hurtRecoil = pose({ torso: body(EYE_CLOSED), flipper: FLIPPER_BACK, dx: -1 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', t: 'h', m: 'h' })];

// Attack: the crest rears back, then the whole wave crashes forward with the head lunging and a
// splash of foam thrown ahead of the snout. Only rows above the head dome (pivot 28) lean.
const attack = [
  stream(lean(pose({ dx: -1, flipper: FLIPPER_BACK }), 28, 4, -1), 0),
  stream(lean(pose({ torso: body(MOUTH_OPEN), dx: 1, flipper: FLIPPER_MID }), 28, 3, 1), 2),
  stream(
    lean(
      pose({
        torso: body(MOUTH_OPEN),
        dx: 1,
        flipper: FLIPPER_FWD,
        extra: [{ art: SPLASH, x: 40, y: 12 }],
      }),
      28,
      3,
      1,
    ),
    4,
  ),
];

export const TORRENTIDE_ADULT: SpriteDef = {
  id: 'torrentide-adult',
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
