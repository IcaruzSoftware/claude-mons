import type { SpriteDef } from '../types.ts';
import { compose, dots, flipH, frame, recolor, withRows, type Layer } from '../util.ts';

/**
 * Emberfox (Fire, rare, teen): a sleek fire fox ("Feuerfuchs"). Side view facing right: a triangular
 * head with large dark-tipped ears, a slender fur-coloured muzzle with a cream jaw and a dark nose, a
 * cream chest bib, a lean body on four slim dark-socked legs, and TWO bushy flame-tipped tails that
 * fan up behind the rump in a V (one bright, one darker), each with a cream band before its
 * orange-to-gold flame tip so both stay countable. Proportions sit between the baby and the adult.
 */
const PALETTE = {
  D: '#2b2b2b', // outline (tintable dark)
  P: '#ff5252', // ember-red fur (tintable primary)
  S: '#ff9100', // orange flame (tintable secondary)
  A: '#ffd740', // gold flame core (tintable accent)
  r: '#c62828', // red shade (far-side legs / far tail)
  k: '#3a0f0f', // dark: nose, ear inner/tips, socks, open mouth
  w: '#fff3e0', // cream: muzzle jaw, chest bib, tail tip band
  h: '#ffffff', // eye glint / hurt flash
  y: '#fff59d', // sparks, speed lines
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 32;

// Head (skull + slender muzzle), 13 x 12. Eye at cols 2..3; muzzle tapers to a dark nose with a
// cream lower jaw.
const HEAD = [
  '..DDDDDD.....',
  '.DPPPPPPDD...',
  'DPPPPPPPPPD..',
  'DPPPPPPPPPPDD',
  'DPPhDPPPPPPPD',
  'DPPDDPPPPPPkD',
  'DPPPPPPPwwwkD',
  'DPPPPPwwwwwDD',
  '.DPPPPwwwDDD.',
  '.DPPPPPPPDD..',
  '..DPPPPPDD...',
  '...DDDDDD....',
];
const HEAD_X = 16;
const HEAD_Y = 8;

const HEAD_HURT = withRows(HEAD, { 4: 'DPPDDPPPPPPPD', 5: 'DPPPDDPPPPPkD' });
// Attack: narrowed eye, jaws parted (dark mouth on the muzzle).
const HEAD_BITE = withRows(HEAD, {
  4: 'DPPDDDPPPPPPD',
  6: 'DPPPPPPPwkkkD',
  7: 'DPPPPPwwwkkDD',
});

// Two large triangular ears, 11 x 7, dark inner and dark tips.
const EARS = [
  'DD......DD.',
  'DkD....DkD.',
  'DPkD..DPkD.',
  'DPPkDDPPkD.',
  'DPPPDDPPPD.',
  '.DPPDDPPD..',
  '..DDDDDD...',
];
const EARS_UP = [
  'DD......DD.',
  'DkD....DkD.',
  'DPkD..DPkD.',
  'DPkD..DPkD.',
  'DPPkDDPPkD.',
  'DPPPDDPPPD.',
  '.DPPDDPPD..',
  '..DDDDDD...',
];
const EARS_X = 16;
const EARS_Y = 2;

// Lean body, 15 x 7, with a cream chest bib at the front (right) and a red-shaded haunch at the left.
const BODY = [
  '...DDDDDDDDDDD..',
  '.DDPPPPPPPPPPwD.',
  'DPPPPPPPPPPwwwD.',
  'DrPPPPPPPPPwwwD.',
  'DrrPPPPPPPPwwDD.',
  '.DrrPPPPPPwwDD..',
  '..DDDDDDDDDDD...',
];
const BODY_X = 3;
const BODY_Y = 18;

// Neck: a sloped fur wedge with the cream bib carried up to the head, so the head never floats.
const NECK = [
  '.....DDD',
  '...DDPPD',
  '.DDPPPwD',
  'DPPPwwwD',
  'DPPwwwDD',
  'DPwwDD..',
  'DDDD....',
];
const NECK_X = 11;
const NECK_Y = 15;

// Upper tail: a bushy fox tail sweeping up from the rump, cream band before an orange-to-gold flame.
const TAIL_UP = [
  '..DAD...',
  '.DASAD..',
  '.DwSSD..',
  '.DwwSD..',
  '.DPwPD..',
  '.DPPPD..',
  '.DPPPrD.',
  '..DPPrD.',
  '..DPPrD.',
  '..DPPrD.',
  '...DPPD.',
  '...DPD..',
  '...DD...',
];
const TAIL_UP_FLICK = withRows(TAIL_UP, {
  0: '.DAD....',
  1: 'DASAD...',
  2: 'DwSSD...',
});
const TAIL_UP_X = 0;
const TAIL_UP_Y = 6;

// Second tail: mirrored and one shade darker, set right and lower so the two fan into a V.
const TAIL_OUT = recolor(flipH(TAIL_UP), { P: 'r' });
const TAIL_OUT_FLICK = recolor(flipH(TAIL_UP_FLICK), { P: 'r' });
const TAIL_OUT_X = 6;
const TAIL_OUT_Y = 9;

// Short ember tails for sleep.
const TAIL_EMBER = ['..DD..', '.DSSD.', '.DwwD.', '.DPPD.', '..DD..'];
const TAIL_EMBER_B = ['......', '..DD..', '.DSSD.', '.DwwD.', '..DD..'];

// Slim leg, 4 x 8, with dark socks and a dark paw.
const LEG = ['DPPD', 'DPPD', 'DPPD', 'DPPD', 'DPPD', 'DkkD', 'DkkD', 'DDDD'];
const LEG_FAR = recolor(LEG, { P: 'r' });
const LEG_FOLDED = ['DkkPPD', 'DDDDDD'];
const LEG_Y = 24;
const LEGS = { backFar: 5, backNear: 7, frontFar: 13, frontNear: 15 };

const LAPTOP = ['.DDDDDDDD.', '.DllllllD.', '.DllllllD.', '.DDDDDDDD.', 'DggggggggD', 'DDDDDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghgghgghD' });

interface Pose {
  head?: string[];
  ears?: string[];
  tailUp?: string[];
  tailOut?: string[];
  dx?: number;
  dy?: number;
  headDy?: number;
  near?: number;
  far?: number;
  frontNear?: [number, number];
  props?: Layer[];
  extra?: Layer[];
}

function pose({
  head = HEAD,
  ears = EARS,
  tailUp = TAIL_UP,
  tailOut = TAIL_OUT,
  dx = 0,
  dy = 0,
  headDy = 0,
  near = 0,
  far = 0,
  frontNear = [0, 0],
  props = [],
  extra = [],
}: Pose): string[] {
  const legY = LEG_Y + dy;
  return compose(SIZE, [
    { art: tailOut, x: TAIL_OUT_X + dx, y: TAIL_OUT_Y + dy },
    { art: tailUp, x: TAIL_UP_X + dx, y: TAIL_UP_Y + dy },
    { art: LEG_FAR, x: LEGS.backFar + far + dx, y: legY },
    { art: LEG_FAR, x: LEGS.frontFar + far + dx, y: legY },
    { art: BODY, x: BODY_X + dx, y: BODY_Y + dy },
    { art: NECK, x: NECK_X + dx, y: NECK_Y + dy + headDy },
    ...props,
    { art: LEG, x: LEGS.backNear + near + dx, y: legY },
    { art: LEG, x: LEGS.frontNear + near + frontNear[0] + dx, y: legY + frontNear[1] },
    { art: head, x: HEAD_X + dx, y: HEAD_Y + dy + headDy },
    { art: ears, x: EARS_X + dx, y: EARS_Y + dy + headDy },
    ...extra,
  ]);
}

const idle = [
  pose({}),
  pose({ tailUp: TAIL_UP_FLICK, tailOut: TAIL_OUT_FLICK, headDy: 1 }),
  pose({ tailUp: TAIL_UP_FLICK }),
];

// Trot: near and far leg pairs swing in opposite directions; the body bobs on the passes.
const walk = [
  pose({ near: 1, far: -1, tailUp: TAIL_UP_FLICK }),
  pose({ dy: -1, headDy: 1, tailOut: TAIL_OUT_FLICK }),
  pose({ near: -1, far: 1, tailUp: TAIL_UP_FLICK }),
  pose({ dy: -1, headDy: 1, ears: EARS_UP }),
];

// Sleeping: curled on the ground, head low, one folded paw, both tails down to embers.
function sleepPose(up: string[], out: string[]): string[] {
  return compose(SIZE, [
    { art: out, x: 1, y: 22 },
    { art: up, x: 6, y: 22 },
    { art: BODY, x: BODY_X, y: BODY_Y + 5 },
    { art: LEG_FOLDED, x: LEGS.backNear - 2, y: LEG_Y + 5 },
    { art: HEAD, x: HEAD_X - 2, y: HEAD_Y + 12 },
    { art: recolor(EARS, { P: 'r' }), x: EARS_X - 2, y: EARS_Y + 13 },
  ]);
}
const sleep = [sleepPose(TAIL_EMBER, TAIL_EMBER_B), sleepPose(TAIL_EMBER_B, TAIL_EMBER)];

// Working: a laptop in front of the chest; the near front paw lifts and taps the keys.
const laptop = (art: string[]): Layer => ({ art, x: 19, y: 25 });
const work = [
  pose({ dx: -1, frontNear: [4, -1], props: [laptop(LAPTOP)] }),
  pose({ dx: -1, tailUp: TAIL_UP_FLICK, frontNear: [4, 0], props: [laptop(LAPTOP_TYPING)] }),
  dots(pose({ dx: -1, ears: EARS_UP, frontNear: [4, -1], props: [laptop(LAPTOP)] }), 'y', [
    [3, 7],
    [8, 5],
  ]),
];

const happy = [
  pose({ tailUp: TAIL_UP_FLICK, tailOut: TAIL_OUT_FLICK, headDy: 1 }),
  pose({ ears: EARS_UP, dy: -3 }),
  pose({ tailUp: TAIL_UP_FLICK, ears: EARS_UP, dy: -5, near: 1, far: -1 }),
];

const hurtRecoil = pose({ head: HEAD_HURT, tailUp: TAIL_UP_FLICK, dx: -2, headDy: 1 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', r: 'h', w: 'h', k: 'h' })];

// Attack: crouch, then a dash-bite with speed lines trailing behind and a flame puff at the muzzle.
const SPEED = ['yyyy..', '......', '.yyyyy', '......', 'yyy...'];
const attack = [
  pose({ dx: -2, headDy: 1, tailUp: TAIL_UP_FLICK, near: -1, far: 1 }),
  pose({ head: HEAD_BITE, dx: 2, near: 1, far: -1, extra: [{ art: SPEED, x: 0, y: 16 }] }),
  dots(
    pose({
      head: HEAD_BITE,
      dx: 3,
      dy: -1,
      tailUp: TAIL_UP_FLICK,
      near: 1,
      far: -1,
      extra: [{ art: SPEED, x: 0, y: 18 }],
    }),
    'A',
    [
      [31, 14],
      [30, 16],
      [31, 18],
    ],
  ),
];

export const EMBERFOX_TEEN: SpriteDef = {
  id: 'emberfox-teen',
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
