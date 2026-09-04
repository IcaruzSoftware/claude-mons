import type { SpriteDef } from '../types.ts';
import {
  compose,
  dots,
  flipH,
  frame,
  lean,
  recolor,
  shift,
  squashTop,
  withRows,
  type Layer,
} from '../util.ts';

/**
 * Rootling (Earth, rare, teen): a creature knotted together out of roots and vines. A rounded
 * root-knot head with a sprouting leaf, a braided torso wrapped in green vines, two tendril arms
 * that end in small amber flowers, and splayed root legs. It sways as it idles; its `work` anim
 * plugs a root into a small database drum.
 */
const PALETTE = {
  D: '#2e3a1f', // outline (tintable dark)
  P: '#7cb342', // vines (tintable primary)
  S: '#8d8d8d', // database drum (tintable secondary)
  A: '#ffb300', // flowers, drum LED (tintable accent)
  b: '#7a5230', // root wood
  r: '#4e3319', // root shade
  g: '#aed581', // vine highlight
  s: '#6a6a6a', // drum shade
  l: '#b5b5b5', // drum highlight
  h: '#ffffff', // eye glints, flower centres
  y: '#fff3b0', // sparkles
};

const SIZE = 32;
const BX = 7; // body: 18 px wide, cols 7..24
const BY = 10; // body: 18 px tall, rows 10..27; legs on rows 28..31

// 18 x 18 head + torso + arms. Eyes are a glint over a dark pupil, looking right.
const BODY = [
  '.........DD.......',
  '........DPPD......',
  '.......DPgPPD.....',
  '......DDDPDDDD....',
  '.....DbbbPbbbbD...',
  '....DbbbbbbbbbbbD.',
  '....DbbhDbbbbhDbD.',
  '....DbbDDbbbbDDbD.',
  '....DbrbbbbbbbbrD.',
  '.....DrbbbbbbbrD..',
  '......DDrbbrDD....',
  '.....DDbrPbrbDD...',
  '...DDbbrPPbrbbDD..',
  '..DPbbrPbbPrbbPD..',
  '.DPDbrPbbbbPrbDPD.',
  'DAADbPbbrbbbPbDAAD',
  'DAhDPbbbrrbbbPDAhD',
  '.DDDDbbbrrbbbDDDD.',
];

const EYES_CLOSED: Record<number, string> = {
  6: '....DbbbbbbbbbbbD.',
  7: '....DbbDDbbbbDDbD.',
};
const EYES_HAPPY: Record<number, string> = {
  6: '....DbbDDbbbbDDbD.',
  7: '....DbDbbDbbDbbDD.',
  8: '....DbrbbbDDbbbrD.',
};
const EYES_HURT: Record<number, string> = {
  6: '....DbDbDbbbDbDbD.',
  7: '....DbbDbbbbbDbbD.',
  8: '....DbDbDbbbDbDrD.',
};
// Flowers open wider (used for happy / attack).
const BLOOM: Record<number, string> = {
  14: '.DADbrPbbbbPrbDAD.',
  15: 'AAADbPbbrbbbPbDAAA',
  16: 'AhADPbbbrrbbbPDAhA',
  17: '.ADDDbbbrrbbbDDDA.',
};

function body(...overrides: Array<Record<number, string>>): string[] {
  return withRows(BODY, Object.assign({}, ...overrides));
}

// Root legs, 18 x 4, placed under the torso at (BX, 28). Two variants for the shuffle.
const LEGS = [
  '....DbbrDDrbbD....',
  '....DbrD..DrbD....',
  '...DbrD....DrbD...',
  '...DDDD....DDDD...',
];
const LEGS_STEP = [
  '....DbbrDDrbbD....',
  '...DbrD...DrbbD...',
  '..DbrD.....DrbbD..',
  '..DDDD......DDDD..',
];
const LEGS_STEP_BACK = flipH(LEGS_STEP);
const LEGS_TUCK = [
  '....DbbrDDrbbD....',
  '....DbrDDDDrbD....',
  '....DDDD..DDDD....',
  '..................',
];

// Database drum for the `work` anim, 8 x 8.
const DRUM = [
  '.DDDDDD.',
  'DllSSSsD',
  'DDDDDDDD',
  'DSSSSSsD',
  'DSSSAssD',
  'DDDDDDDD',
  'DSSSSSsD',
  '.DDDDDD.',
];
const DRUM_LIT = withRows(DRUM, { 4: 'DSSShssD' });
// Root cable from the right arm into the drum.
const CABLE = ['DD......', 'bbDDD...', 'DDbbbDD.', '...DDbbD'];

// Vine whip for the attack, 11 x 5, growing out of the right arm.
const WHIP = ['.......DDD.', '.....DDPgPD', '..DDDPPPDD.', 'DDPPPPDD...', 'DDDDDD.....'];

interface Pose {
  torso?: string[];
  legs?: string[];
  dx?: number;
  dy?: number;
  extra?: Layer[];
}

function pose({ torso = body(), legs = LEGS, dx = 0, dy = 0, extra = [] }: Pose): string[] {
  return compose(SIZE, [
    { art: legs, x: BX + dx, y: BY + 18 + dy },
    { art: torso, x: BX + dx, y: BY + dy },
    ...extra,
  ]);
}

// Sway: the top of the plant leans while the roots stay planted (pivot on the ground row).
const swayL = (rows: string[]): string[] => lean(rows, SIZE - 1, 10, -1);
const swayR = (rows: string[]): string[] => lean(rows, SIZE - 1, 10, 1);

const idle = [swayL(pose({})), pose({}), swayR(pose({}))];

// Shuffle: the roots step forward and back while the body sways with the motion.
const walk = [
  swayR(pose({ legs: LEGS_STEP })),
  shift(pose({}), 0, -1),
  swayL(pose({ legs: LEGS_STEP_BACK })),
  shift(pose({}), 0, -1),
];

// Asleep: curled down onto its roots, eyes closed.
const sleep = [
  pose({ torso: body(EYES_CLOSED), legs: LEGS_TUCK, dy: 2 }),
  pose({ torso: squashTop(body(EYES_CLOSED), 3), legs: LEGS_TUCK, dy: 2 }),
];

// Working: leans toward a database drum and plugs a root cable into it; the LED lights up.
const drum = (art: string[]): Layer => ({ art, x: 24, y: 24 });
const cable: Layer = { art: CABLE, x: 19, y: 26 };
const work = [
  pose({ dx: -3, extra: [drum(DRUM)] }),
  swayR(pose({ dx: -3, extra: [drum(DRUM), cable] })),
  dots(swayR(pose({ dx: -3, extra: [drum(DRUM_LIT), cable] })), 'y', [
    [23, 21],
    [31, 22],
    [30, 26],
  ]),
];

const happy = [
  pose({ torso: body(EYES_HAPPY, BLOOM) }),
  shift(pose({ torso: body(EYES_HAPPY, BLOOM), legs: LEGS_TUCK }), 0, -2),
  shift(swayR(pose({ torso: body(EYES_HAPPY, BLOOM), legs: LEGS_TUCK })), 0, -4),
];

const hurtRecoil = swayL(pose({ torso: body(EYES_HURT), dx: -2 }));
const hurt = [
  hurtRecoil,
  recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', b: 'h', r: 'h', g: 'h', s: 'h', l: 'h' }),
];

// Attack: winds back, then lashes a vine whip forward with a spray of leaves.
const attack = [
  swayL(pose({ dx: -2, legs: LEGS_STEP_BACK })),
  swayR(pose({ dx: 2, torso: body(BLOOM), legs: LEGS_STEP, extra: [{ art: WHIP, x: 21, y: 21 }] })),
  dots(
    swayR(
      pose({ dx: 2, torso: body(BLOOM), legs: LEGS_STEP, extra: [{ art: WHIP, x: 21, y: 19 }] }),
    ),
    'g',
    [
      [30, 15],
      [31, 18],
      [29, 12],
      [31, 23],
    ],
  ),
];

export const ROOTLING_TEEN: SpriteDef = {
  id: 'rootling-teen',
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
