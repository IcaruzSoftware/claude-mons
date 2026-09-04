import type { SpriteDef } from '../types.ts';
import { compose, dots, flipH, frame, recolor, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Sparkit (Fire, common, baby): a small ember spark. Round red body with an orange/gold belly,
 * a flame tuft on top, two dot eyes with a glint, stub feet.
 */
const PALETTE = {
  D: '#2b2b2b', // charcoal outline (tintable dark)
  P: '#ff5252', // ember red (tintable primary)
  S: '#ff9100', // orange (tintable secondary)
  A: '#ffd740', // gold (tintable accent)
  r: '#c62828', // red shade
  o: '#ffab40', // light orange (blush, feet)
  h: '#ffffff', // highlights
  y: '#fff59d', // sparks
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 32;
const BX = 9; // body: 14 px wide, cols 9..22
const BY = 16; // body: 14 px tall, rows 16..29; feet on rows 30..31

// 14 x 14 body (no feet, no tuft)
const BODY = [
  '....DDDDDD....',
  '..DDPPPPPPDD..',
  '.DPPPPPPPPPPD.',
  '.DPhPPPPPPPPD.',
  'DPPDhPPPPDhPPD',
  'DPPDDPPPPDDPPD',
  'DPoPPPPPPPPoPD',
  'DPPPPDPPDPPPPD',
  'DPPPPPDDPPPPPD',
  'DPPPSSSSSSPPPD',
  'DrPSSSAASSSPrD',
  '.DrSSSAASSSrD.',
  '..DDrSSSSrDD..',
  '....DDDDDD....',
];

const BODY_SLEEP = withRows(BODY, {
  4: 'DPPPPPPPPPPPPD',
  5: 'DPPDDPPPPDDPPD',
  7: 'DPPPPPPPPPPPPD',
  8: 'DPPPPPDDPPPPPD',
});

const BODY_HAPPY = withRows(BODY, {
  7: 'DPPPDPPPPDPPPD',
  8: 'DPPPPDDDDPPPPD',
});

const BODY_HURT = withRows(BODY, {
  4: 'DPPDDPPPPDDPPD',
  5: 'DPPPPPPPPPPPPD',
  7: 'DPPPPPPPPPPPPD',
  8: 'DPPPPDDDDPPPPD',
});

// One stub foot, 4 x 2. Default positions: left (11, 30), right (17, 30).
const FOOT = ['DooD', 'DDDD'];

// Flame tuft variants, 7 wide. The bottom row overwrites the head outline so the flame grows out of it.
const TUFT_RIGHT = [
  '....DD.',
  '...DAD.',
  '..DAAAD',
  '..DSAAD',
  '.DSSAAD',
  '.DPSSSD',
  'DPPSSPD',
  '.DPPPD.',
];
const TUFT_LEFT = flipH(TUFT_RIGHT);
const TUFT_TALL = [
  '.....DD',
  '....DAD',
  '...DAAD',
  '..DAAAD',
  '..DSAAD',
  '.DSSAAD',
  '.DSSSSD',
  'DPSSSPD',
  'DPPSPPD',
  '.DPPPD.',
];
const TUFT_EMBER = ['....DD.', '...DSSD', '.DSSSSD', '.DPSSPD', '.DPPPD.'];
const TUFT_EMBER_B = flipH(TUFT_EMBER);
const TX = 13; // tuft x: cols 13..19, centred on the head

// Laptop for the `work` anim, 10 x 6, drawn in front of the body.
const LAPTOP = ['.DDDDDDDD.', '.DllllllD.', '.DllllllD.', '.DDDDDDDD.', 'DggggggggD', 'DDDDDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghgghgghD' });

interface Pose {
  body?: string[];
  tuft?: string[];
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
  tuft = TUFT_RIGHT,
  dx = 0,
  dy = 0,
  leftFoot = [0, 0],
  rightFoot = [0, 0],
  extra = [],
}: Pose): string[] {
  const tuftY = BY + 1 - tuft.length; // tuft bottom row sits on the head outline (row 16)
  return compose(SIZE, [
    { art: FOOT, x: BX + 2 + dx + leftFoot[0], y: BY + 14 + dy + leftFoot[1] },
    { art: FOOT, x: BX + 8 + dx + rightFoot[0], y: BY + 14 + dy + rightFoot[1] },
    { art: body, x: BX + dx, y: BY + dy },
    { art: tuft, x: TX + dx, y: tuftY + dy },
    ...extra,
  ]);
}

const idle = [
  pose({}),
  pose({ body: squashTop(BODY, 3), tuft: TUFT_LEFT }),
  pose({ tuft: TUFT_LEFT }),
];

const walk = [
  pose({ leftFoot: [-1, -1], rightFoot: [1, 0] }),
  pose({ dy: -1, tuft: TUFT_LEFT }),
  pose({ leftFoot: [-1, 0], rightFoot: [1, -1] }),
  pose({ dy: -1 }),
];

const sleep = [
  pose({ body: BODY_SLEEP, tuft: TUFT_EMBER }),
  pose({ body: squashTop(BODY_SLEEP, 3), tuft: TUFT_EMBER_B }),
];

const laptop = (art: string[]): Layer => ({ art, x: 20, y: 26 });
const work = [
  pose({ tuft: TUFT_TALL, dx: 1, extra: [laptop(LAPTOP)] }),
  dots(
    pose({ body: squashTop(BODY, 3), tuft: TUFT_RIGHT, dx: 1, extra: [laptop(LAPTOP_TYPING)] }),
    'y',
    [
      [12, 9],
      [22, 7],
    ],
  ),
  dots(pose({ tuft: TUFT_LEFT, dx: 1, extra: [laptop(LAPTOP)] }), 'y', [
    [10, 7],
    [23, 10],
  ]),
];

const happy = [
  pose({ body: squashTop(BODY, 3), tuft: TUFT_LEFT }),
  pose({ body: BODY_HAPPY, tuft: TUFT_TALL, dy: -3 }),
  pose({ body: BODY_HAPPY, tuft: TUFT_TALL, dy: -5 }),
];

const hurtRecoil = pose({ body: BODY_HURT, tuft: TUFT_RIGHT, dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', r: 'h', o: 'h' })];

const attack = [
  pose({ body: squashTop(BODY, 3), tuft: TUFT_LEFT, dx: -2 }),
  pose({ tuft: TUFT_LEFT, dx: 4 }),
  dots(pose({ tuft: TUFT_LEFT, dx: 5 }), 'A', [
    [29, 18],
    [30, 21],
    [28, 24],
    [31, 16],
  ]),
];

export const SPARKIT_BABY: SpriteDef = {
  id: 'sparkit-baby',
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
