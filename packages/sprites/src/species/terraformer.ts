import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Terraformer (Earth, rare, adult): a great tortoise, 48 grid, side view facing right. Its stone
 * shell carries a small server-rack garden: two stacks of gray rack boxes with amber/green LEDs
 * and moss growing between and around them. Slow, deliberate walk; attack is a shell bash.
 */
const PALETTE = {
  D: '#2e3a1f', // outline (tintable dark)
  P: '#7cb342', // skin, moss (tintable primary)
  S: '#8d8d8d', // shell plates (tintable secondary)
  A: '#ffb300', // amber LEDs (tintable accent)
  m: '#558b2f', // skin shade / far legs
  g: '#aed581', // moss highlight / laptop screen
  G: '#76ff03', // green LEDs
  k: '#555555', // rack boxes, plate seams
  s: '#6a6a6a', // shell shade
  l: '#b5b5b5', // shell highlight
  a: '#8a6100', // dim amber LED
  d: '#3e7a1a', // dim green LED
  h: '#ffffff', // eye glint / flash
  y: '#fff3b0', // sparkles
};

const SIZE = 48;
const UX = 3; // upper art (racks + shell): 38 px wide, cols 3..40
const UY = 12; // rows 12..36
const HEAD_X = 37; // head: 10 px wide, cols 37..46
const HEAD_Y = 26; // rows 26..36
const LEG_Y = 36; // legs: 12 px tall, rows 36..47

// 38 x 25: rack stacks (rows 0..9) on the shell dome (rows 10..24). Moss tufts around the racks.
const UPPER = [
  '......DDDDDDDDDD......................',
  '......DkkkkkkAGD......................',
  '......DkSkSkkkkD......................',
  '......DDDDDDDDDD...DDDDDDDDDD.........',
  '......DkkkkkkAGD...DkkkkkkGAD.........',
  '......DkSkSkkkkD...DkSkSkkkkD.........',
  '......DDDDDDDDDD..PDDDDDDDDDD.........',
  '......DkkkkkkAGD.PPDkkkkkkAGD.........',
  '......DkSkSkkkkDPPgDkSkSkkkkD.........',
  '....PPDDDDDDDDDDPgPDDDDDDDDDDPP.......',
  '.......DDPPPDDDDDDDDDDDDPPPDDD........',
  '.....DDllPPllllllllllllllPPlllDD......',
  '....DlSSSSSSkSSSSSSSSkSSSSSSSSSlD.....',
  '...DlSSSSSSSkSSSSSSSSkSSSSSSSSSSlD....',
  '..DlSSSSSSSSkSSSSSSSSkSSSSSSSSSSSlD...',
  '..DSSSSSSSSSkSSSSSSSSkSSSSSSSSSSSSD...',
  '.DSkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkSD..',
  '.DSSSSSkSSSSSSSSSkSSSSSSSSSSkSSSSSSD..',
  'DSSSSSSkSSSSSSSSSkSSSSSSSSSSkSSSSSSSD.',
  'DSSSSSSkSSSSSSSSSkSSSSSSSSSSkSSSSSSSD.',
  'DsSSSSSkSSSSSSSSSkSSSSSSSSSSkSSSSSSsD.',
  'DsskkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkksD.',
  'DsssSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSsD.',
  '.DsssssssssssssssssssssssssssssssssD..',
  '..DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD...',
];

// LED variants: swap which lights are on.
const LEDS_B: Record<number, string> = {
  1: '......DkkkkkkGAD......................',
  4: '......DkkkkkkaGD...DkkkkkkAaD.........',
  7: '......DkkkkkkAaD.PPDkkkkkkGAD.........',
};
const LEDS_OFF: Record<number, string> = {
  1: '......DkkkkkkadD......................',
  4: '......DkkkkkkadD...DkkkkkkdaD.........',
  7: '......DkkkkkkadD.PPDkkkkkkadD.........',
};
const LEDS_ALL: Record<number, string> = {
  1: '......DkkkkkkGGD......................',
  4: '......DkkkkkkGGD...DkkkkkkGGD.........',
  7: '......DkkkkkkGGD.PPDkkkkkkGGD.........',
};

function upper(...overrides: Array<Record<number, string>>): string[] {
  return withRows(UPPER, Object.assign({}, ...overrides));
}

// Head, 10 x 11, neck on the left tucking under the shell rim.
const HEAD = [
  '...DDDDD..',
  '..DPPPPPD.',
  '.DPPPhDPPD',
  '.DPPPDDPPD',
  'DPPPPPPPPD',
  'DPPPPPPPPD',
  'DPPPPPDDDD',
  'DPPPPPPPPD',
  'DmPPPPPPD.',
  'DmmPPPPmD.',
  '.DDmmmDD..',
];
const HEAD_SLEEP = withRows(HEAD, { 2: '.DPPPPPPPD', 3: '.DPPPDDPPD' });
const HEAD_HAPPY = withRows(HEAD, {
  2: '.DPPPDDPPD',
  3: '.DPPDPPDPD',
  6: 'DPPPPDDDDD',
  7: 'DPPPPPDDPD',
});
const HEAD_HURT = withRows(HEAD, {
  2: '.DPPDPDPPD',
  3: '.DPPPDPPPD',
  4: 'DPPPDPDPPD',
  6: 'DPPPPDDDDD',
});

// Belly strip between the legs, 28 x 3, at (9, 37).
const BELLY = [
  'mmmmmmmmmmmmmmmmmmmmmmmmmmmm',
  'mmmmmmmmmmmmmmmmmmmmmmmmmmmm',
  'DDDDDDDDDDDDDDDDDDDDDDDDDDDD',
];

// Leg, 7 x 12. Near legs at x=8 and x=27; far legs (shaded) at x=14 and x=33.
const LEG = [
  'DPPPPPD',
  'DPPPPPD',
  'DPPPPPD',
  'DPPPPPD',
  'DPPPPPD',
  'DPPPPPD',
  'DPPPPPD',
  'DPPPPPD',
  'DPPPPmD',
  'DPPPPmD',
  'DmmmmmD',
  'DDDDDDD',
];
const LEG_FAR = recolor(LEG, { P: 'm', m: 'D' });

const LAPTOP = [
  '.DDDDDDDDDDDD.',
  '.DggggggggggD.',
  '.DgPgPgPggggD.',
  '.DggggggggggD.',
  '.DDDDDDDDDDDD.',
  'DSSSSSSSSSSSSD',
  'DDDDDDDDDDDDDD',
];
const LAPTOP_TYPING = withRows(LAPTOP, { 2: '.DgPgPgPgPggD.', 5: 'DSlSSlSSlSSlSD' });

interface Pose {
  shell?: string[];
  head?: string[];
  dx?: number;
  dy?: number;
  /** Head offset (retract = negative x). */
  headD?: [number, number];
  /** Horizontal offsets of the near and far leg pairs. */
  near?: number;
  far?: number;
  extra?: Layer[];
}

function pose({
  shell = upper(),
  head = HEAD,
  dx = 0,
  dy = 0,
  headD = [0, 0],
  near = 0,
  far = 0,
  extra = [],
}: Pose): string[] {
  // Far legs, belly, head and near legs go under the shell so it overlaps them.
  return compose(SIZE, [
    { art: LEG_FAR, x: 14 + dx + far, y: LEG_Y + dy },
    { art: LEG_FAR, x: 33 + dx + far, y: LEG_Y + dy },
    { art: BELLY, x: 9 + dx, y: LEG_Y + 1 + dy },
    { art: head, x: HEAD_X + dx + headD[0], y: HEAD_Y + dy + headD[1] },
    { art: LEG, x: 8 + dx + near, y: LEG_Y + dy },
    { art: LEG, x: 27 + dx + near, y: LEG_Y + dy },
    { art: shell, x: UX + dx, y: UY + dy },
    ...extra,
  ]);
}

const idle = [
  pose({}),
  pose({ shell: upper(LEDS_B), headD: [0, 1] }),
  pose({ shell: upper(LEDS_B) }),
];

// A slow, deliberate plod: near and far leg pairs move against each other, the head nods.
const walk = [
  pose({ near: 2, far: -2 }),
  shift(pose({ shell: upper(LEDS_B), headD: [1, 0] }), 0, -1),
  pose({ near: -2, far: 2, shell: upper(LEDS_B) }),
  shift(pose({ headD: [1, 0] }), 0, -1),
];

// Asleep: head pulled halfway into the shell, body sunk down, LEDs off.
const sleep = [
  pose({ shell: upper(LEDS_OFF), head: HEAD_SLEEP, headD: [-4, 2], dy: 0 }),
  squashTop(pose({ shell: upper(LEDS_OFF), head: HEAD_SLEEP, headD: [-4, 2], dy: 0 }), 13),
];

// Working: head down at a laptop on the floor; the racks blink as jobs run.
const laptop = (art: string[]): Layer => ({ art, x: 34, y: 41 });
const work = [
  pose({ shell: upper(LEDS_ALL), headD: [-1, 2], extra: [laptop(LAPTOP)] }),
  pose({ shell: upper(LEDS_B), headD: [-1, 3], extra: [laptop(LAPTOP_TYPING)] }),
  dots(pose({ shell: upper(LEDS_ALL), headD: [-1, 2], extra: [laptop(LAPTOP)] }), 'y', [
    [10, 9],
    [33, 8],
    [44, 22],
  ]),
];

const happy = [
  pose({ head: HEAD_HAPPY, shell: upper(LEDS_ALL), headD: [0, -1] }),
  shift(pose({ head: HEAD_HAPPY, shell: upper(LEDS_ALL), headD: [0, -2] }), 0, -2),
  shift(
    pose({ head: HEAD_HAPPY, shell: upper(LEDS_ALL), headD: [0, -2], near: 1, far: -1 }),
    0,
    -4,
  ),
];

const hurtRecoil = pose({ head: HEAD_HURT, headD: [-2, 1], dx: -2 });
const hurt = [
  hurtRecoil,
  recolor(hurtRecoil, {
    P: 'h',
    S: 'h',
    A: 'h',
    m: 'h',
    g: 'h',
    G: 'h',
    k: 'h',
    s: 'h',
    l: 'h',
  }),
];

// Attack: pulls the head in and rears back, then rams forward shell-first with an amber impact.
const attack = [
  pose({ dx: -3, headD: [-4, 1], near: -2, far: 2 }),
  pose({ dx: 3, headD: [-5, 1], near: 2, far: -2, shell: upper(LEDS_ALL) }),
  dots(
    dots(pose({ dx: 4, headD: [-5, 1], near: 2, far: -2, shell: upper(LEDS_ALL) }), 'A', [
      [45, 24],
      [46, 27],
      [47, 30],
      [46, 33],
      [45, 36],
      [47, 21],
    ]),
    'l',
    [
      [44, 26],
      [45, 31],
      [44, 35],
    ],
  ),
];

export const TERRAFORMER_ADULT: SpriteDef = {
  id: 'terraformer-adult',
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
