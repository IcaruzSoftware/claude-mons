import type { SpriteDef } from '../types.ts';
import { compose, flipH, frame, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Twinflare (Fire, rare, adult): a tall elegant fire fox ("Feuerfuchs"), 48 grid. Side view facing
 * right: a big triangular head with large dark-tipped ears, a slender fur-coloured muzzle with a
 * cream jaw and a dark nose, a cream chest bib, a slim torso on four slim dark-socked legs, and TWO
 * long bushy flame-tipped tails that sweep up behind the rump in different directions (one high, one
 * lower and out), each fur-coloured with a cream band before its orange-to-gold flame tip so both
 * stay countable in every waking frame.
 */
const PALETTE = {
  D: '#2b2b2b', // outline (tintable dark)
  P: '#ff5252', // ember-red fur (tintable primary)
  S: '#ff9100', // orange flame (tintable secondary)
  A: '#ffd740', // gold flame core (tintable accent)
  r: '#c62828', // red shade (far-side fur / far tail)
  k: '#3a0f0f', // dark: nose, ear inner/tips, socks, open mouth
  w: '#fff3e0', // cream: muzzle jaw, chest bib, tail tip band
  h: '#ffffff', // eye glint, teeth, hurt flash
  y: '#fff59d', // sparks, speed lines
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 48;

// Two large triangular ears, 14 x 8, with dark inner and dark tips.
const EARS = [
  'DD........DD..',
  'DkD......DkD..',
  'DPkD....DPkD..',
  'DPPkD..DPPkD..',
  'DPPPkDDPPPkD..',
  'DPPPPDDPPPPD..',
  '.DPPPDDPPPD...',
  '..DDDDDDDD....',
];
// Perked: one row taller.
const EARS_UP = [
  'DD........DD..',
  'DkD......DkD..',
  'DPkD....DPkD..',
  'DPPkD..DPPkD..',
  'DPPkD..DPPkD..',
  'DPPPkDDPPPkD..',
  'DPPPPDDPPPPD..',
  '.DPPPDDPPPD...',
  '..DDDDDDDD....',
];
const EARS_X = 26;
const EARS_Y = 6;

// Head (skull + slender muzzle), 18 x 13. Eye at cols 5..6; muzzle tapers to a dark nose at the
// tip with a cream lower jaw. Rows 11..12 are the neck (blend into the torso).
const HEAD = [
  '..DDDDDDDD........',
  '.DPPPPPPPPDD......',
  'DPPPPPPPPPPPD.....',
  'DPPPPPPPPPPPPPD...',
  'DPPPPDhDPPPPPPPDD.',
  'DPPPPDDDPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPkD',
  'DPPPPPPPPPPwwwwwwD',
  'DPPPPPPPPwwwwwwDD.',
  '.DPPPPPwwwwwDDD...',
  '.DPPPPPPPPPDD.....',
  '..DPPPPPPPD.......',
  '...DDDDDDD........',
];
const HEAD_X = 26;
const HEAD_Y = 13;

const HEAD_SLEEP = withRows(HEAD, {
  4: 'DPPPPDDDDPPPPPPDD.',
  5: 'DPPPPPPPPPPPPPPPPD',
});
const HEAD_HURT = withRows(HEAD, {
  4: 'DPPPPDDPPPPPPPPDD.',
  5: 'DPPPPPDDPPPPPPPPPD',
});
// Bite: eye narrowed, jaws parted (dark mouth with a tooth on the muzzle).
const HEAD_BITE = withRows(HEAD, {
  4: 'DPPPPDDDPPPPPPPDD.',
  6: 'DPPPPPPPPPPPPkkkkD',
  7: 'DPPPPPPPPPPwhwkkkD',
  8: 'DPPPPPPPPwwwwwkDD.',
});

// Torso, 24 x 11: arched back, deep chest to the right, tucked belly, a cream bib at the chest and
// a red-shaded haunch at the left.
const TORSO = [
  '.......DDDDDDDDD.........',
  '....DDDPPPPPPPPPDDDD.....',
  '..DDPPPPPPPPPPPPPPPPDD...',
  '.DrPPPPPPPPPPPPPPPPPPwD..',
  'DrrPPPPPPPPPPPPPPPPPwwwD.',
  'DrrPPPPPPPPPPPPPPPPwwwwD.',
  '.DrrPPPPPPPPPPPPPPwwwwD..',
  '..DrrPPPPPPPPPPPPwwwDD...',
  '...DDrrPPPPPPPPPPDDD.....',
  '.....DDrrPPPPPPDDD.......',
  '.......DDDDDDDDD.........',
];
const TORSO_X = 4;
const TORSO_Y = 22;

const TORSO_HURT = TORSO;

// Neck: a sloped fur wedge joining the shoulders up to the head, with the cream bib carried down the
// chest so the head never floats free of the body.
const NECK = [
  '.......DDDD',
  '.....DDPPPD',
  '...DDPPPPPD',
  '.DDPPPPPPwD',
  'DPPPPPPwwwD',
  'DPPPPPwwwDD',
  'DPPPwwwwDD.',
  'DPPwwwDD...',
  'DDDDDDD....',
];
const NECK_X = 19;
const NECK_Y = 17;

// Upper tail: a tall bushy fox tail sweeping up (and slightly left) from the rump, with a cream band
// before its orange-to-gold flame tip. Base at the bottom, flame at the top.
const TAIL_UP = [
  '...DAD......',
  '..DASAD.....',
  '..DASSD.....',
  '..DwSSD.....',
  '.DwwSSD.....',
  '.DwwSPD.....',
  '.DPwPPD.....',
  '.DPPPPD.....',
  '.DPPPPrD....',
  '..DPPPrD....',
  '..DPPPrD....',
  '..DPPPrrD...',
  '...DPPPrD...',
  '...DPPPrD...',
  '...DPPPrrD..',
  '....DPPPrD..',
  '....DPPPD...',
  '.....DPPD...',
  '.....DPPD...',
  '......DPD...',
  '......DD....',
];
const TAIL_UP_FLICK = withRows(TAIL_UP, {
  0: '..DAD.......',
  1: '.DASAD......',
  2: '.DASSD......',
  3: '.DwwSD......',
});
const TAIL_UP_X = 0;
const TAIL_UP_Y = 6;

// Second tail: the same bushy tail mirrored so it leans the other way, one shade darker, drawn
// behind and set to the right so the two tails fan apart into an upward V and stay countable.
const TAIL_OUT = recolor(flipH(TAIL_UP), { P: 'r' });
const TAIL_OUT_FLICK = recolor(flipH(TAIL_UP_FLICK), { P: 'r' });
const TAIL_OUT_X = 7;
const TAIL_OUT_Y = 10;

// Both tails streaming back low (dash / sleep). Two stacked flame trails, each cream-banded.
const TAIL_BACK_UP = ['...DAD......', '..DASSAD....', '.DwwSSSPDD..', 'DDDwPPPPPPPD'];
const TAIL_BACK_OUT = ['.DAD........', 'DASSAD......', 'DwSSPPDDDD..', '.DDPPPPPPPPD'];

// Legs: thick fur upper with dark socks (k) on the lower third and a dark paw, so they read as
// sturdy fox legs rather than stilts.
const LEG = [
  'DPPPD',
  'DPPPD',
  'DPPPD',
  'DPPPD',
  'DPPPD',
  'DPPPD',
  'DPPPD',
  'DPPPD',
  'DPPPD',
  'DPPPD',
  'DPPPD',
  'DPPPD',
  'DkkkD',
  'DkkkD',
  'DkkkD',
  'DDDDD',
];
const LEG_FAR = recolor(LEG, { P: 'r' });
// Reaching forward onto the laptop, 9 x 13.
const LEG_TYPE = [
  'DPPPD....',
  'DPPPD....',
  '.DPPPD...',
  '.DPPPD...',
  '..DPPPD..',
  '..DPPPD..',
  '...DPPPD.',
  '...DPPPD.',
  '...DkkkD.',
  '...DkkkDD',
  '....DkkkD',
  '....DkkkD',
  '.....DDDD',
];
const LEG_FOLDED = ['DkkkkkkkD', 'DDDDDDDDD'];
const LEG_Y = 32;
const LEGS = { backFar: 5, backNear: 7, frontFar: 19, frontNear: 21 };

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

interface Pose {
  head?: string[];
  ears?: string[];
  torso?: string[];
  tailUp?: string[];
  tailOut?: string[];
  dx?: number;
  dy?: number;
  /** Horizontal offsets of the near-side and far-side leg pairs (stride). */
  near?: number;
  far?: number;
  /** Replacement art for the front-near leg (paw on the laptop). */
  frontNearLeg?: string[];
  /** Layers drawn between the torso and the near legs. */
  props?: Layer[];
  extra?: Layer[];
}

function pose({
  head = HEAD,
  ears = EARS,
  torso = TORSO,
  tailUp = TAIL_UP,
  tailOut = TAIL_OUT,
  dx = 0,
  dy = 0,
  near = 0,
  far = 0,
  frontNearLeg = LEG,
  props = [],
  extra = [],
}: Pose): string[] {
  const legY = LEG_Y + dy;
  return compose(SIZE, [
    { art: tailOut, x: TAIL_OUT_X + dx, y: TAIL_OUT_Y + dy },
    { art: tailUp, x: TAIL_UP_X + dx, y: TAIL_UP_Y + dy },
    { art: LEG_FAR, x: LEGS.backFar + far + dx, y: legY },
    { art: LEG_FAR, x: LEGS.frontFar + far + dx, y: legY },
    { art: torso, x: TORSO_X + dx, y: TORSO_Y + dy },
    { art: NECK, x: NECK_X + dx, y: NECK_Y + dy },
    ...props,
    { art: LEG, x: LEGS.backNear + near + dx, y: legY },
    { art: frontNearLeg, x: LEGS.frontNear + near + dx, y: legY },
    { art: head, x: HEAD_X + dx, y: HEAD_Y + dy },
    { art: ears, x: EARS_X + dx, y: EARS_Y + dy },
    ...extra,
  ]);
}

const idle = [
  pose({}),
  pose({ tailUp: TAIL_UP_FLICK, tailOut: TAIL_OUT_FLICK, ears: EARS_UP }),
  squashTop(pose({ tailUp: TAIL_UP_FLICK }), 33),
];

// Trot: near and far pairs swing in opposite directions with a two-pixel stride.
const walk = [
  pose({ near: 2, far: -2, tailUp: TAIL_UP_FLICK }),
  squashTop(pose({ tailOut: TAIL_OUT_FLICK }), 33),
  pose({ near: -2, far: 2, tailUp: TAIL_UP_FLICK }),
  squashTop(pose({ ears: EARS_UP }), 33),
];

// Sleeping: curled with the belly on the ground, legs folded, head lowered, both tails resting back.
function sleepPose(up: string[], out: string[]): string[] {
  return compose(SIZE, [
    { art: out, x: 0, y: 42 },
    { art: up, x: 2, y: 40 },
    { art: TORSO, x: TORSO_X, y: 32 },
    { art: NECK, x: NECK_X, y: 27 },
    { art: LEG_FOLDED, x: 28, y: 46 },
    { art: LEG_FOLDED, x: 8, y: 46 },
    { art: HEAD_SLEEP, x: HEAD_X, y: 25 },
    { art: EARS, x: EARS_X, y: 18 },
  ]);
}
const sleep = [
  sleepPose(TAIL_BACK_UP, TAIL_BACK_OUT),
  sleepPose(shift(TAIL_BACK_UP, 0, 1), shift(TAIL_BACK_OUT, 0, 1)),
];

// Working: a laptop on the ground in front; the near front paw reaches down onto it.
const laptop = (art: string[]): Layer => ({ art, x: 33, y: 41 });
const work = [
  pose({ frontNearLeg: LEG_TYPE, props: [laptop(LAPTOP)] }),
  pose({ frontNearLeg: shift(LEG_TYPE, 0, 1), tailUp: TAIL_UP_FLICK, props: [laptop(LAPTOP_TYPING)] }),
  pose({
    frontNearLeg: LEG_TYPE,
    ears: EARS_UP,
    tailOut: TAIL_OUT_FLICK,
    props: [laptop(LAPTOP)],
    extra: [{ art: ['y...y', '.....', '..y..'], x: 8, y: 4 }],
  }),
];

const happy = [
  pose({ tailUp: TAIL_UP_FLICK, tailOut: TAIL_OUT_FLICK, ears: EARS_UP }),
  shift(pose({ tailUp: TAIL_UP_FLICK, ears: EARS_UP }), 0, -2),
  shift(pose({ tailOut: TAIL_OUT_FLICK, ears: EARS_UP, near: 1, far: -1 }), 0, -4),
];

const hurtRecoil = pose({ head: HEAD_HURT, torso: TORSO_HURT, dx: -2, tailUp: TAIL_UP_FLICK });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', r: 'h', w: 'h', k: 'h' })];

// Attack: crouch, then a dash-bite. Speed lines trail behind and both tails stream back.
const SPEED_LINES = [
  'yyyy....',
  '........',
  '.yyyyyy.',
  '........',
  'yyyyy...',
  '........',
  '..yyyy..',
];
const attack = [
  squashTop(pose({ dx: -2, near: -2, far: 2, tailUp: TAIL_UP_FLICK, tailOut: TAIL_OUT_FLICK }), 33),
  pose({
    head: HEAD_BITE,
    dx: 3,
    near: 3,
    far: -3,
    tailUp: TAIL_UP_FLICK,
    tailOut: TAIL_OUT_FLICK,
    extra: [{ art: SPEED_LINES, x: 0, y: 22 }],
  }),
  pose({
    head: HEAD_BITE,
    dx: 3,
    dy: -1,
    near: 3,
    far: -3,
    tailUp: TAIL_UP,
    tailOut: TAIL_OUT,
    extra: [
      { art: SPEED_LINES, x: 0, y: 24 },
      { art: ['.A..', 'A...', '....', '..A.', '....', 'A...', '.A..'], x: 44, y: 18 },
    ],
  }),
];

export const TWINFLARE_ADULT: SpriteDef = {
  id: 'twinflare-adult',
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
