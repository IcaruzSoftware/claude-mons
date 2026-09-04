import type { SpriteDef } from '../types.ts';
import { compose, dots, flipH, frame, recolor, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Mossling (Earth, rare, baby): a moss sprout. Round green body, two leaf ears growing out of the
 * top of its head, dot eyes, amber cheeks and tiny feet. It gets around by hopping; its `work`
 * anim tends a sprout in a pot until it flowers.
 */
const PALETTE = {
  D: '#2e3a1f', // outline (tintable dark)
  P: '#7cb342', // moss green (tintable primary)
  S: '#8d8d8d', // pot stone (tintable secondary)
  A: '#ffb300', // amber cheeks / flower (tintable accent)
  m: '#558b2f', // moss shade
  g: '#aed581', // moss highlight
  s: '#6a6a6a', // pot shade
  l: '#b5b5b5', // pot highlight
  h: '#ffffff', // eye glints / flash
  y: '#fff3b0', // sparkles
};

const SIZE = 32;
const BX = 9; // body: 14 px wide, cols 9..22
const BY = 17; // body: 13 px tall, rows 17..29; feet on rows 30..31

// 14 x 13 body. Dot eyes with a glint, amber cheeks, a tiny smile.
const BODY = [
  '....DDDDDD....',
  '..DDggPPPPDD..',
  '.DggPPPPPPPPD.',
  '.DgPPPPPPPPPD.',
  'DgPPhDPPPPhDPD',
  'DPPPDDPPPPDDPD',
  'DPPPPPPPPPPPPD',
  'DPPAPPPDDPPAPD',
  'DmPPPPPPPPPPmD',
  'DmmPPPPPPPPmmD',
  '.DmmmPPPPmmmD.',
  '..DDmmmmmmDD..',
  '....DDDDDD....',
];

const BODY_SLEEP = withRows(BODY, {
  4: 'DgPPPPPPPPPPPD',
  5: 'DPPPDDPPPPDDPD',
  7: 'DPPAPPPPPPPAPD',
});

const BODY_HAPPY = withRows(BODY, {
  4: 'DgPPDDPPPPDDPD',
  5: 'DPPDPPDPPDPPDD',
  7: 'DPPAPPDPPDPAPD',
  8: 'DmPPPPPDDPPPmD',
});

const BODY_HURT = withRows(BODY, {
  4: 'DgPDPDPPPPDPDD',
  5: 'DPPPDPPPPPPDPD',
  6: 'DPPDPDPPPPDPDD',
  7: 'DPPAPPDDDPPAPD',
});

// One tiny foot, 4 x 2. Default positions: left (11, 30), right (17, 30).
const FOOT = ['DmmD', 'DDDD'];

// Leaf ear, 6 x 5, tip up-left; the bottom row overwrites the head outline (row 17).
const LEAF_L = ['.DD...', 'DggD..', 'DgPPD.', '.DPPPD', '..DPDD'];
const LEAF_R = flipH(LEAF_L);
const LEAF_L_UP = ['DD....', 'DgD...', 'DggPD.', '.DPPPD', '..DPDD'];
const LEAF_R_UP = flipH(LEAF_L_UP);
const LEAF_L_DOWN = ['......', '.DDD..', 'DggPD.', 'DgPPPD', '.DDPDD'];
const LEAF_R_DOWN = flipH(LEAF_L_DOWN);
const LEAF_Y = 13; // rows 13..17
const LEAF_LX = 8; // cols 8..13
const LEAF_RX = 18; // cols 18..23

// Work props: a stone pot and a sprout that grows over the three frames.
const POT = ['DDDDDD', 'DlSSsD', '.DSSD.', '.DSsD.', '.DDDD.'];
const SPROUT_1 = ['.D.', 'DPD', '.P.'];
const SPROUT_2 = ['.D...', 'DPDD.', '.DPPD', 'DPPD.', '.DPD.'];
const SPROUT_3 = ['..DAD.', '.DAhAD', '..DAD.', '.DPPD.', 'DPPD..', '.DPD..'];

interface Pose {
  body?: string[];
  leaves?: [string[], string[]];
  dx?: number;
  dy?: number;
  leftFoot?: [number, number];
  rightFoot?: [number, number];
  extra?: Layer[];
}

function pose({
  body = BODY,
  leaves = [LEAF_L, LEAF_R],
  dx = 0,
  dy = 0,
  leftFoot = [0, 0],
  rightFoot = [0, 0],
  extra = [],
}: Pose): string[] {
  return compose(SIZE, [
    { art: FOOT, x: BX + 2 + dx + leftFoot[0], y: BY + 13 + dy + leftFoot[1] },
    { art: FOOT, x: BX + 8 + dx + rightFoot[0], y: BY + 13 + dy + rightFoot[1] },
    { art: body, x: BX + dx, y: BY + dy },
    { art: leaves[0], x: LEAF_LX + dx, y: LEAF_Y + dy },
    { art: leaves[1], x: LEAF_RX + dx, y: LEAF_Y + dy },
    ...extra,
  ]);
}

const UP: [string[], string[]] = [LEAF_L_UP, LEAF_R_UP];
const DOWN: [string[], string[]] = [LEAF_L_DOWN, LEAF_R_DOWN];

const idle = [pose({}), pose({ body: squashTop(BODY, 3), leaves: DOWN }), pose({ leaves: UP })];

// Hopping: crouch, spring up with the feet tucked, land.
const walk = [
  pose({ body: squashTop(BODY, 3), leaves: DOWN, leftFoot: [-1, 0], rightFoot: [1, 0] }),
  pose({ dy: -3, leaves: UP, leftFoot: [0, -1], rightFoot: [0, -1] }),
  pose({ dy: -4, leaves: UP, leftFoot: [1, -1], rightFoot: [-1, -1] }),
  pose({ dy: -1, leaves: DOWN }),
];

const sleep = [
  pose({ body: BODY_SLEEP, leaves: DOWN }),
  pose({ body: squashTop(BODY_SLEEP, 3), leaves: DOWN }),
];

// Gardening: leans over a pot while the sprout grows and finally flowers.
const pot: Layer = { art: POT, x: 24, y: 27 };
const work = [
  pose({ dx: -2, extra: [pot, { art: SPROUT_1, x: 25, y: 24 }] }),
  pose({
    dx: -2,
    body: squashTop(BODY, 3),
    leaves: DOWN,
    extra: [pot, { art: SPROUT_2, x: 24, y: 22 }],
  }),
  dots(pose({ dx: -2, leaves: UP, extra: [pot, { art: SPROUT_3, x: 24, y: 21 }] }), 'y', [
    [23, 19],
    [31, 21],
    [30, 25],
  ]),
];

const happy = [
  pose({ body: squashTop(BODY, 3), leaves: DOWN }),
  pose({ body: BODY_HAPPY, leaves: UP, dy: -3 }),
  pose({ body: BODY_HAPPY, leaves: UP, dy: -5, leftFoot: [0, 1], rightFoot: [0, 1] }),
];

const hurtRecoil = pose({ body: BODY_HURT, leaves: DOWN, dx: -2 });
const hurt = [
  hurtRecoil,
  recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', m: 'h', g: 'h', s: 'h', l: 'h' }),
];

// Attack: a hop-tackle; loose moss bits fly off in front.
const attack = [
  pose({ body: squashTop(BODY, 3), leaves: DOWN, dx: -2 }),
  pose({ leaves: UP, dx: 4, dy: -2 }),
  dots(pose({ leaves: UP, dx: 5 }), 'P', [
    [29, 18],
    [30, 21],
    [28, 25],
    [31, 16],
  ]),
];

export const MOSSLING_BABY: SpriteDef = {
  id: 'mossling-baby',
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
