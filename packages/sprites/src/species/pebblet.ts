import type { SpriteDef } from '../types.ts';
import { compose, dots, flipH, frame, recolor, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Pebblet (Earth, common, baby): a round gray pebble with big eyes, a moss tuft on top and two
 * stubby stone feet. Slow and steady; its `work` anim hammers a tiny nail into a block.
 */
const PALETTE = {
  D: '#2e3a1f', // outline (tintable dark)
  P: '#7cb342', // moss tuft (tintable primary)
  S: '#8d8d8d', // stone (tintable secondary)
  A: '#ffb300', // amber: hammer handle, nail head (tintable accent)
  s: '#6a6a6a', // stone shade
  l: '#b5b5b5', // stone highlight
  m: '#558b2f', // moss shade
  h: '#ffffff', // eye whites
  y: '#fff3b0', // sparks
};

const SIZE = 32;
const BX = 9; // body: 14 px wide, cols 9..22
const BY = 16; // body: 14 px tall, rows 16..29; feet on rows 30..31

// 14 x 14 pebble body (no feet, no tuft). Big 3 x 3 eyes with the pupils looking right.
const BODY = [
  '....DDDDDD....',
  '..DDllllllDD..',
  '.DlllSSSSSSSD.',
  '.DlSSSSSSSSSD.',
  'DlShhhSSShhhSD',
  'DSShDDSSShDDSD',
  'DSShDDSSShDDSD',
  'DSSSSSSSSSSSsD',
  'DsSSSSSDDSSSsD',
  'DsSSSSSSSSSssD',
  'DssSSSSSSSsssD',
  '.DsssSSSSsssD.',
  '..DDssssssDD..',
  '....DDDDDD....',
];

const BODY_SLEEP = withRows(BODY, {
  4: 'DlSSSSSSSSSSSD',
  5: 'DSSDDDSSSDDDSD',
  6: 'DSSSSSSSSSSSSD',
});

const BODY_HAPPY = withRows(BODY, {
  4: 'DlShhhSSShhhSD',
  5: 'DSSDDDSSSDDDSD',
  6: 'DSSSSSSSSSSSSD',
  8: 'DsSSSDSSSDSSsD',
  9: 'DsSSSSDDDSSssD',
});

const BODY_HURT = withRows(BODY, {
  4: 'DlSDSDSSSDSDSD',
  5: 'DSSSDSSSSSDSSD',
  6: 'DSSDSDSSSDSDSD',
  8: 'DsSSSDDDDSSSsD',
});

// One stub foot, 4 x 2. Default positions: left (11, 30), right (17, 30).
const FOOT = ['DssD', 'DDDD'];

// Moss tuft, 7 wide; the bottom row overwrites the head outline so the moss grows out of it.
const TUFT_RIGHT = ['...DD..', '..DPPD.', '.DPPmPD', 'DPmPPPD', '.DPmPD.'];
const TUFT_LEFT = flipH(TUFT_RIGHT);
const TUFT_TALL = ['...DD..', '..DPPD.', '..DPmD.', '.DPPmPD', 'DPmPPPD', '.DPmPD.'];
const TUFT_FLAT = ['.DDDDD.', 'DPPmPPD', '.DPmPD.'];
const TX = 13; // tuft x: cols 13..19, centred on the head

// Work props: a stone block, a nail and a hammer.
const BLOCK = ['DDDDDDD', 'DlSSSsD', 'DSSSssD', 'DDDDDDD'];
const NAIL_UP = ['A', 'l', 'l'];
const NAIL_DOWN = ['A'];
// Hammer, 6 x 5: amber handle on the left (held by the arm), stone head on the right.
const HAMMER = ['..DDDD', '..DlSD', 'AADSSD', '..DssD', '..DDDD'];
const ARM = ['DssD', 'DDDD'];

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

const idle = [pose({}), pose({ body: squashTop(BODY, 3), tuft: TUFT_LEFT }), pose({})];

// A very slow waddle: one foot shuffles forward at a time while the body rocks.
const walk = [
  pose({ leftFoot: [-1, -1], rightFoot: [1, 0] }),
  pose({ dy: -1, tuft: TUFT_LEFT }),
  pose({ leftFoot: [-1, 0], rightFoot: [1, -1], tuft: TUFT_LEFT }),
  pose({ dy: -1 }),
];

const sleep = [
  pose({ body: BODY_SLEEP, tuft: TUFT_FLAT }),
  pose({ body: squashTop(BODY_SLEEP, 3), tuft: TUFT_FLAT }),
];

// Hammering: the block sits in front of the pebble; the stub arm grips the handle, and the
// hammer head rises, strikes the nail (driving it in), and rises again.
const block: Layer = { art: BLOCK, x: 24, y: 28 };
const arm = (y: number): Layer => ({ art: ARM, x: 20, y });
const hammer = (y: number): Layer => ({ art: HAMMER, x: 24, y: y - 2 });
const nail = (art: string[], y: number): Layer => ({ art, x: 27, y });
const work = [
  pose({ dx: -1, extra: [block, nail(NAIL_UP, 25), arm(18), hammer(18)] }),
  dots(
    pose({
      dx: -1,
      body: squashTop(BODY, 3),
      tuft: TUFT_FLAT,
      extra: [block, nail(NAIL_DOWN, 27), arm(24), hammer(24)],
    }),
    'y',
    [
      [25, 26],
      [31, 25],
      [30, 23],
    ],
  ),
  pose({ dx: -1, tuft: TUFT_LEFT, extra: [block, nail(NAIL_DOWN, 27), arm(21), hammer(21)] }),
];

const happy = [
  pose({ body: squashTop(BODY, 3), tuft: TUFT_FLAT }),
  pose({ body: BODY_HAPPY, tuft: TUFT_TALL, dy: -3 }),
  pose({ body: BODY_HAPPY, tuft: TUFT_TALL, dy: -5 }),
];

const hurtRecoil = pose({ body: BODY_HURT, tuft: TUFT_LEFT, dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', s: 'h', l: 'h', m: 'h' })];

// Attack: a short headbutt lunge; a few stone chips fly off the front.
const attack = [
  pose({ body: squashTop(BODY, 3), tuft: TUFT_FLAT, dx: -2 }),
  pose({ tuft: TUFT_LEFT, dx: 4 }),
  dots(pose({ tuft: TUFT_LEFT, dx: 5 }), 'l', [
    [29, 18],
    [30, 21],
    [28, 24],
    [31, 16],
  ]),
];

export const PEBBLET_BABY: SpriteDef = {
  id: 'pebblet-baby',
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
