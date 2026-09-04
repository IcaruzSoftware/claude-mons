import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, withRows, type Layer } from '../util.ts';

/**
 * Cinderpup (Fire, rare, baby): an ember puppy. Side view facing right: a big round head with a
 * light muzzle, one large glossy eye, a floppy ear whose tip glows, a chubby body with an orange
 * belly, four stubby legs and a tiny flame for a tail.
 */
const PALETTE = {
  D: '#2b2b2b', // charcoal outline (tintable dark)
  P: '#ff5252', // ember red (tintable primary)
  S: '#ff9100', // orange belly / flame (tintable secondary)
  A: '#ffd740', // gold flame core / ear glow (tintable accent)
  r: '#c62828', // red shade (far-side legs, ear inner)
  o: '#ffab40', // light orange (muzzle, paws)
  h: '#ffffff', // eye glint / hurt flash
  y: '#fff59d', // sparks
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 32;

// Head, 16 x 13. Eye on head cols 7..10 rows 4..6, muzzle on the lower right, nose at cols 14..15.
const HEAD = [
  '....DDDDDD......',
  '..DDPPPPPPDD....',
  '.DPPPPPPPPPPD...',
  '.DPPPPPPPPPPD...',
  'DPPPPPPDhDDPPD..',
  'DPPPPPPDDDDPPDD.',
  'DPPPPPPPDDPPooDD',
  'DPPPPPPPPPPoooDD',
  'DPPPPPPPPPPoooD.',
  '.DPPPPPPPPPDooD.',
  '.DPPPPPPPPPPDDD.',
  '..DDPPPPPPDD....',
  '....DDDDDD......',
];
const HEAD_X = 13;
const HEAD_Y = 11;

const HEAD_SLEEP = withRows(HEAD, {
  4: 'DPPPPPPPPPPPPD..',
  5: 'DPPPPPPDDDDPPDD.',
  6: 'DPPPPPPPPPPPooDD',
});
// Happy: a closed, upturned eye (^).
const HEAD_HAPPY = withRows(HEAD, {
  4: 'DPPPPPPDPPDPPD..',
  5: 'DPPPPPPPDDPPPDD.',
  6: 'DPPPPPPPPPPPooDD',
});
// Hurt: eye squeezed shut (>).
const HEAD_HURT = withRows(HEAD, {
  4: 'DPPPPPPDDPPPPD..',
  5: 'DPPPPPPPPDDPPDD.',
  6: 'DPPPPPPPDDPPooDD',
});
// Attack: narrowed eye, mouth open.
const HEAD_BITE = withRows(HEAD, {
  4: 'DPPPPPPPPPPPPD..',
  5: 'DPPPPPPDhDDPPDD.',
  6: 'DPPPPPPDDDDPooDD',
  9: '.DPPPPPPPPPDDDD.',
  10: '.DPPPPPPPPPPDoD.',
});

// Body, 17 x 9, sits behind the head; the chest below the chin stays visible.
const BODY = [
  '...DDDDDDDDDDD...',
  '.DDPPPPPPPPPPPDD.',
  'DPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPD',
  'DPPPPPPPPPPPPPPPD',
  'DPPPSSSSSSSSSSPPD',
  'DPPSSSSSSSSSSSSPD',
  '.DPSSSSSSSSSSSPD.',
  '..DDDDDDDDDDDDD..',
];
const BODY_X = 4;
const BODY_Y = 19;

// Floppy ear, 5 x 9: a flap hanging over the back edge of the head; the tip glows.
const EAR = ['.DDDD', 'DPPPD', 'DPrPD', 'DPrPD', 'DPrPD', 'DSrPD', 'DSSPD', 'DASSD', '.DAD.'];
const EAR_BRIGHT = withRows(EAR, { 6: 'DASPD', 7: 'DAASD' });
// Ear flapping up during a hop, 7 x 5: sticks out behind the head.
const EAR_UP = ['DDDD...', 'DASPDD.', 'DAASPPD', '.DSSPPD', '..DDDD.'];
const EAR_X = 10;
const EAR_Y = 12;

// Flame tail, 6 x 6; the base sits on the body's top-left corner.
const TAIL_UP = ['..DD..', '.DAAD.', 'DAASSD', 'DSSSPD', '.DPPD.', '..DDD.'];
const TAIL_FLICK = ['.DD...', 'DAAD..', 'DASSD.', 'DSSSPD', '.DPPD.', '..DDD.'];
const TAIL_BACK = ['......', 'DDD...', 'DAADD.', 'DASSPD', '.DSPPD', '..DDD.'];
const TAIL_EMBER = ['......', '......', '..DD..', '.DSSD.', '.DPPD.', '..DDD.'];
const TAIL_EMBER_B = ['......', '......', '......', '..DDD.', '.DSSD.', '..DDD.'];
const TAIL_X = 3;
const TAIL_Y = 15;

// One stubby leg, 4 x 5; the top row overwrites the belly outline so the leg grows out of it.
const LEG = ['.DPD', '.DPD', '.DPD', 'DooD', 'DDDD'];
const LEG_FAR = recolor(LEG, { P: 'r', o: 'r' });
const LEG_FOLDED = ['DooPD', 'DDDDD'];
const LEG_Y = 27;
// Far legs sit 2 px behind the near ones, so a sliver of each shows in the standing pose.
const LEGS = { backFar: 6, backNear: 8, frontFar: 13, frontNear: 15 };

// Laptop for the `work` anim, 10 x 6.
const LAPTOP = ['.DDDDDDDD.', '.DllllllD.', '.DllllllD.', '.DDDDDDDD.', 'DggggggggD', 'DDDDDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghgghgghD' });

interface Pose {
  head?: string[];
  ear?: string[];
  tail?: string[];
  /** Whole-sprite offset (hop / recoil / lunge). */
  dx?: number;
  dy?: number;
  /** Head + ear offset relative to the body (breathing, crouching). */
  headDy?: number;
  /** Horizontal offsets of the near-side and far-side leg pairs (walk cycle). */
  near?: number;
  far?: number;
  /** Extra offset for the front-near leg only (paw on the laptop). */
  frontNear?: [number, number];
  /** Layers drawn between the body and the near legs (the laptop the paw rests on). */
  props?: Layer[];
  extra?: Layer[];
}

function pose({
  head = HEAD,
  ear = EAR,
  tail = TAIL_UP,
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
    { art: tail, x: TAIL_X + dx, y: TAIL_Y + dy },
    { art: LEG_FAR, x: LEGS.backFar + far + dx, y: legY },
    { art: LEG_FAR, x: LEGS.frontFar + far + dx, y: legY },
    { art: BODY, x: BODY_X + dx, y: BODY_Y + dy },
    ...props,
    { art: LEG, x: LEGS.backNear + near + dx, y: legY },
    { art: LEG, x: LEGS.frontNear + near + frontNear[0] + dx, y: legY + frontNear[1] },
    { art: head, x: HEAD_X + dx, y: HEAD_Y + dy + headDy },
    { art: ear, x: EAR_X + dx, y: EAR_Y + dy + headDy },
    ...extra,
  ]);
}

const idle = [
  pose({}),
  pose({ tail: TAIL_FLICK, ear: EAR_BRIGHT, headDy: 1 }),
  pose({ tail: TAIL_FLICK }),
];

// Trot: the near and far leg pairs swing in opposite directions; the body bobs on the passes.
const walk = [
  pose({ near: 1, far: -1, tail: TAIL_FLICK }),
  pose({ dy: -1, headDy: 1 }),
  pose({ near: -1, far: 1, tail: TAIL_FLICK }),
  pose({ dy: -1, headDy: 1, ear: EAR_BRIGHT }),
];

// Sleeping: belly on the ground, head resting on the ground in front, one folded paw showing,
// ear draped over the back, tail down to an ember.
function sleepPose(tail: string[]): string[] {
  return compose(SIZE, [
    { art: tail, x: TAIL_X, y: TAIL_Y + 4 },
    { art: BODY, x: BODY_X, y: BODY_Y + 4 },
    { art: LEG_FOLDED, x: LEGS.backNear - 2, y: LEG_Y + 3 },
    { art: HEAD_SLEEP, x: HEAD_X + 2, y: HEAD_Y + 8 },
    { art: recolor(EAR, { A: 'S' }), x: EAR_X + 2, y: EAR_Y + 8 },
  ]);
}
const sleep = [sleepPose(TAIL_EMBER), sleepPose(TAIL_EMBER_B)];

// Working: a laptop in front of the chest; the near front paw lifts and taps the keys.
const laptop = (art: string[]): Layer => ({ art, x: 19, y: 26 });
const work = [
  pose({ dx: -1, frontNear: [5, -1], props: [laptop(LAPTOP)] }),
  pose({ dx: -1, tail: TAIL_FLICK, frontNear: [5, 0], props: [laptop(LAPTOP_TYPING)] }),
  dots(pose({ dx: -1, ear: EAR_BRIGHT, frontNear: [5, -1], props: [laptop(LAPTOP)] }), 'y', [
    [3, 12],
    [7, 10],
  ]),
];

// Happy: tail wag plus a hop with the ear flapping up.
const happy = [
  pose({ tail: TAIL_BACK, headDy: 1 }),
  pose({ head: HEAD_HAPPY, tail: TAIL_UP, ear: EAR_UP, dy: -3 }),
  pose({ head: HEAD_HAPPY, tail: TAIL_BACK, ear: EAR_UP, dy: -5, near: 1, far: -1 }),
];

const hurtRecoil = pose({ head: HEAD_HURT, tail: TAIL_BACK, dx: -2, headDy: 1 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', r: 'h', o: 'h' })];

// Attack: crouch, then a pounce forward with the mouth open and sparks at the snout.
const attack = [
  pose({ dx: -2, headDy: 2, tail: TAIL_BACK, near: -1, far: 1 }),
  pose({ head: HEAD_BITE, dx: 2, tail: TAIL_BACK, near: 1, far: -1 }),
  dots(pose({ head: HEAD_BITE, dx: 3, tail: TAIL_FLICK, near: 1, far: -1, dy: -1 }), 'A', [
    [31, 14],
    [30, 17],
    [31, 21],
    [30, 24],
  ]),
];

export const CINDERPUP_BABY: SpriteDef = {
  id: 'cinderpup-baby',
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
