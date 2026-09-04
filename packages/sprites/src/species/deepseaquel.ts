import type { SpriteDef } from '../types.ts';
import {
  compose,
  dots,
  flipH,
  frame,
  recolor,
  shift,
  squashTop,
  withRows,
  type Layer,
} from '../util.ts';

/**
 * Deepseaquel (Water, rare, adult): a deep-sea kraken, 48 grid. A big teal mantle with two dark
 * eyes, an "SQL" glyph picked out in foam-white pixels across the forehead, a glowing lure on a
 * stalk above the head, and four front tentacles (plus two shaded ones behind) that curl at the
 * tips and rest on the ground. The attack is a tentacle slam.
 */
const PALETTE = {
  D: '#0d2a4a', // outline (tintable dark)
  P: '#2ec4b6', // teal mantle / tentacles (tintable primary)
  S: '#1b4f8a', // deep blue underside shade (tintable secondary)
  A: '#e8fbff', // glyphs, suckers, lure glow (tintable accent)
  t: '#1f9a8e', // far tentacles / mantle shade
  m: '#8fe3da', // mantle highlight
  h: '#ffffff', // lure core, eye glints, splash
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 48;
const HX = 10; // head: 28 px wide, cols 10..37
const HY = 4; // head: 22 px tall, rows 4..25; tentacles rows 25..47

// 28 x 22 mantle. Rows 5..9 carry the SQL glyph (cols 8..18).
const HEAD = [
  '..........DDDDDDDD..........',
  '.......DDDPPPPPPPPDDD.......',
  '.....DDmmPPPPPPPPPPPPDD.....',
  '....DmmPPPPPPPPPPPPPPPPD....',
  '...DmPPPPPPPPPPPPPPPPPPPD...',
  '..DmPPPPAAAPAAAPAPPPPPPPPD..',
  '.DmPPPPPAPPPAPAPAPPPPPPPPPD.',
  '.DPPPPPPAAAPAPAPAPPPPPPPPtD.',
  'DPPPPPPPPPAPAAAPAPPPPPPPPPtD',
  'DPPPPPPPAAAPPPAPAAAPPPPPPPtD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPtD',
  'DPPPPPPPPPPPPPPPPPPPPPPPPPtD',
  'DPPPPPPPDDDPPPPPPPDDDPPPPPtD',
  'DPPPPPPPDhDPPPPPPPDhDPPPPPtD',
  'DPPPPPPPDDDPPPPPPPDDDPPPPPtD',
  'DtPPPPPPPPPPPPPPPPPPPPPPPttD',
  'DtPPPPPPPPPPPPPPPPPPPPPPPttD',
  '.DtPPPPPPPPPPPPPPPPPPPPPttD.',
  '.DtPPPPPPPPPPPPPPPPPPPPPttD.',
  '..DttPPPPPPPPPPPPPPPPPPtttD.',
  '...DttSSSSSSSSSSSSSSSSStttD.',
  '....DDDDDDDDDDDDDDDDDDDDDD..',
];

const EYES_CLOSED: Record<number, string> = {
  12: 'DPPPPPPPPPPPPPPPPPPPPPPPPPtD',
  13: 'DPPPPPPPDDDPPPPPPPDDDPPPPPtD',
  14: 'DPPPPPPPPPPPPPPPPPPPPPPPPPtD',
};
const EYES_HAPPY: Record<number, string> = {
  12: 'DPPPPPPPDPDPPPPPPPDPDPPPPPtD',
  13: 'DPPPPPPPDhDPPPPPPPDhDPPPPPtD',
  14: 'DPPPPPPPPDPPPPPPPPPDPPPPPPtD',
};
const EYES_ANGRY: Record<number, string> = {
  12: 'DPPPPPPPDDPPPPPPPPDDPPPPPPtD',
  13: 'DPPPPPPPDhDPPPPPPPDhDPPPPPtD',
  14: 'DPPPPPPPDDDPPPPPPPDDDPPPPPtD',
};

function head(...overrides: Array<Record<number, string>>): string[] {
  return withRows(HEAD, Object.assign({}, ...overrides));
}

// Lure: a stalk of single dark pixels rising from the head to a glowing bulb.
const STALK: Array<[number, number]> = [
  [24, 3],
  [25, 2],
  [26, 2],
  [27, 1],
  [28, 1],
  [29, 1],
  [30, 1],
];
const BULB = ['.DD.', 'DAhD', 'DhAD', '.DD.'];
const BULB_BRIGHT = ['.DD.', 'DhAD', 'DAhD', '.DD.'];
const BULB_DIM = ['.DD.', 'DPAD', 'DAPD', '.DD.'];
const BULB_X = 31;
const HALO: Array<[number, number]> = [
  [30, 0],
  [35, 0],
  [30, 3],
  [35, 3],
];

// Tentacles, 12 x 23, hanging from the mantle's underside (the top row overwrites its outline).
// TENT_R drifts right and curls into a hook at the bottom; TENT_L is its mirror.
const TENT_R = [
  'DPPPD.......',
  'DPPPD.......',
  'DPPAD.......',
  'DPPPD.......',
  '.DPPPD......',
  '.DPPPD......',
  '.DPPAD......',
  '.DPPPD......',
  '..DPPPD.....',
  '..DPPPD.....',
  '..DPPAD.....',
  '..DPPPD.....',
  '...DPPPD....',
  '...DPPPD....',
  '...DPPAD....',
  '...DPPD.....',
  '...DPPD.....',
  '...DPPD.DDD.',
  '...DPPD.DPPD',
  '...DPPDDDPPD',
  '...DPPPPPPPD',
  '....DPPPPPD.',
  '.....DDDDD..',
];
const TENT_L = flipH(TENT_R);

// A straighter tentacle for the middle pair, same footprint.
const TENT_S = [
  'DPPPD.......',
  'DPPPD.......',
  'DPPAD.......',
  'DPPPD.......',
  'DPPPD.......',
  'DPPPD.......',
  'DPPAD.......',
  'DPPPD.......',
  '.DPPD.......',
  '.DPPD.......',
  '.DPAD.......',
  '.DPPD.......',
  '.DPPD.......',
  '.DPPD.......',
  '.DPAD.......',
  '.DPPD.......',
  '.DPPD.......',
  '.DPPD.......',
  '.DPPPD......',
  '.DPPPPD.....',
  '.DPPPPPD....',
  '..DPPPPD....',
  '...DDDDD....',
];
const TENT_S_L = flipH(TENT_S);

const EMPTY_ROW = '............';

// Lifted variants (walk): the tip comes off the ground by two rows.
const TENT_R_UP = [...TENT_R.slice(0, 13), ...TENT_R.slice(15), EMPTY_ROW, EMPTY_ROW];
const TENT_L_UP = flipH(TENT_R_UP);
const TENT_S_UP = [...TENT_S.slice(0, 13), ...TENT_S.slice(15), EMPTY_ROW, EMPTY_ROW];
const TENT_S_L_UP = flipH(TENT_S_UP);

// Sleeping: tentacles slump flat along the ground.
const TENT_FLAT = [
  ...TENT_S.slice(0, 15),
  '.DPPD.......',
  '.DPPPDD.....',
  '.DPPPPPDD...',
  '..DDPPPPDD..',
  '....DDDDDD..',
  EMPTY_ROW,
  EMPTY_ROW,
  EMPTY_ROW,
];
const TENT_FLAT_L = flipH(TENT_FLAT);

// Attack arm: raised diagonally, then slammed flat in front.
const ARM_RAISED = [
  '............DDD.',
  '...........DPPPD',
  '.........DDDPAPD',
  '.......DDPPPPPD.',
  '.....DDPPPAPDD..',
  '...DDPPPPPDD....',
  '.DDPPPAPDD......',
  'DPPPPPDD........',
  'DPPPDD..........',
  'DDDD............',
];
const ARM_SLAM = [
  '..............DDD.',
  'DDDDDDDDDDDDDDPPPD',
  'DPPPPAPPPAPPPAPPPD',
  'DDDDDDDDDDDDDPPPD.',
  '.............DDD..',
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

const SPLASH = ['A....h....A', '.h..A.A..h.', '..A.....A..'];

type Tentacles = [string[], string[], string[], string[]];
const REST: Tentacles = [TENT_L, TENT_S, TENT_S_L, TENT_R];
const FLAT: Tentacles = [TENT_FLAT_L, TENT_FLAT, TENT_FLAT_L, TENT_FLAT];
// Attack stance: the far-right tentacle is replaced by the slamming arm.
const STANCE: Tentacles = [TENT_L, TENT_S, TENT_S_L, TENT_S_L];

interface Pose {
  mantle?: string[];
  bulb?: string[];
  halo?: boolean;
  /** Far-left, mid-left, mid-right, far-right tentacles. */
  tentacles?: Tentacles;
  /** Whether to draw the two shaded back tentacles. */
  back?: boolean;
  dx?: number;
  dy?: number;
  extra?: Layer[];
}

const TENT_Y = HY + 21;
const BACK_L = recolor(TENT_L, { P: 't', A: 't' });
const BACK_R = recolor(TENT_R, { P: 't', A: 't' });

function pose({
  mantle = head(),
  bulb = BULB,
  halo = false,
  tentacles = REST,
  back = true,
  dx = 0,
  dy = 0,
  extra = [],
}: Pose): string[] {
  const backLayers: Layer[] = back
    ? [
        { art: BACK_L, x: 3 + dx, y: TENT_Y + dy },
        { art: BACK_R, x: 33 + dx, y: TENT_Y + dy },
      ]
    : [];
  let out = compose(SIZE, [
    ...backLayers,
    { art: tentacles[0], x: 7 + dx, y: TENT_Y + dy },
    { art: tentacles[1], x: 19 + dx, y: TENT_Y + dy },
    { art: tentacles[2], x: 17 + dx, y: TENT_Y + dy },
    { art: tentacles[3], x: 29 + dx, y: TENT_Y + dy },
    { art: mantle, x: HX + dx, y: HY + dy },
    { art: bulb, x: BULB_X + dx, y: dy },
    ...extra,
  ]);
  out = dots(
    out,
    'D',
    STALK.map(([x, y]) => [x + dx, y + dy]),
  );
  if (halo) {
    out = dots(
      out,
      'A',
      HALO.map(([x, y]) => [x + dx, y + dy]),
    );
  }
  return out;
}

const idle = [
  pose({}),
  pose({ bulb: BULB_BRIGHT, halo: true }),
  squashTop(pose({ bulb: BULB_BRIGHT }), 24),
];

// Walk: the tentacles step in alternating pairs while the mantle bobs.
const walk = [
  pose({ tentacles: [TENT_L_UP, TENT_S, TENT_S_L_UP, TENT_R] }),
  shift(pose({ bulb: BULB_BRIGHT }), 0, -1),
  pose({ tentacles: [TENT_L, TENT_S_UP, TENT_S_L, TENT_R_UP] }),
  shift(pose({}), 0, -1),
];

const asleep = pose({ mantle: head(EYES_CLOSED), bulb: BULB_DIM, tentacles: FLAT, back: false });
const sleep = [shift(asleep, 0, 3), shift(squashTop(asleep, 24), 0, 3)];

// Work: a laptop sits on the ground in front; the front-right tentacle taps at it.
const laptop = (art: string[]): Layer => ({ art, x: 33, y: 41 });
const work = [
  pose({ tentacles: [TENT_L, TENT_S, TENT_S_L, TENT_R_UP], extra: [laptop(LAPTOP)] }),
  pose({ bulb: BULB_BRIGHT, extra: [laptop(LAPTOP_TYPING)] }),
  pose({
    halo: true,
    tentacles: [TENT_L, TENT_S, TENT_S_L, TENT_R_UP],
    extra: [laptop(LAPTOP)],
  }),
];

const happy = [
  pose({ mantle: head(EYES_HAPPY), bulb: BULB_BRIGHT }),
  shift(pose({ mantle: head(EYES_HAPPY), halo: true }), 0, -2),
  shift(
    pose({
      mantle: head(EYES_HAPPY),
      bulb: BULB_BRIGHT,
      halo: true,
      tentacles: [TENT_L_UP, TENT_S_UP, TENT_S_L_UP, TENT_R_UP],
    }),
    0,
    -4,
  ),
];

const hurtRecoil = pose({ mantle: head(EYES_CLOSED), bulb: BULB_DIM, dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', t: 'h', m: 'h' })];

// Attack: the front-right tentacle rears up, then slams down in front with a splash.
const attack = [
  pose({
    mantle: head(EYES_ANGRY),
    bulb: BULB_BRIGHT,
    dx: -1,
    tentacles: STANCE,
    extra: [{ art: ARM_RAISED, x: 31, y: 13 }],
  }),
  pose({
    mantle: head(EYES_ANGRY),
    bulb: BULB_BRIGHT,
    halo: true,
    dx: 1,
    tentacles: STANCE,
    extra: [{ art: ARM_SLAM, x: 30, y: 30 }],
  }),
  pose({
    mantle: head(EYES_ANGRY),
    bulb: BULB_BRIGHT,
    halo: true,
    dx: 1,
    tentacles: STANCE,
    extra: [
      { art: ARM_SLAM, x: 30, y: 43 },
      { art: SPLASH, x: 34, y: 39 },
    ],
  }),
];

export const DEEPSEAQUEL_ADULT: SpriteDef = {
  id: 'deepseaquel-adult',
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
