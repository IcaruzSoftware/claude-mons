import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, shift, withRows, type Layer } from '../util.ts';

/**
 * Blazebit (Fire, common, teen): a salamander of hot-reload flames. Side view facing right,
 * four short legs, gold spots along the back, a tail that ends in a flame.
 */
const PALETTE = {
  D: '#2b2b2b', // outline (tintable dark)
  P: '#ff5252', // ember red (tintable primary)
  S: '#ff9100', // orange belly / flame (tintable secondary)
  A: '#ffd740', // gold spots / flame core (tintable accent)
  r: '#c62828', // far-side legs
  h: '#ffffff', // eye glint
  y: '#fff59d', // sparks
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 32;
const BX = 2; // body: 26 px wide, cols 2..27
const BY = 18; // body: 11 px tall, rows 18..28; legs on rows 28..31

// 26 x 11 body: tail on the left (rows 0..2 belong to the flame overlay), head on the right.
const BODY = [
  '..........................',
  '..........................',
  '..................DDDDDD..',
  '..DASSSD.........DPPPPPPD.',
  '.DSSSPPPD.......DPPPPDhPPD',
  '.DSPPPPPD.......DPPPPDDPPD',
  '..DPPPPPPDDDDDDDPPPPPPPPPD',
  '...DPPPPAPPPAPPPAPPPPPDDDD',
  '....DPPAPPPAPPPAPPPPSSPPPD',
  '.....DPPSSSSSSSSSSSSSSSPD.',
  '......DDDDDDDDDDDDDDDDDD..',
];

const BODY_SLEEP = withRows(BODY, {
  4: '.DSSSPPPD.......DPPPPPPPPD',
  5: '.DSPPPPPD.......DPPPPDDPPD',
});

const BODY_HURT = withRows(BODY, {
  4: '.DSSSPPPD.......DPPPPDDPPD',
  5: '.DSPPPPPD.......DPPPPPPPPD',
});

// Tail flame, 6 wide, placed at body col 2 so its base is the tail top (body row 3).
const FLAME_UP = ['..DD..', '.DAAD.', 'DAAASD', 'DASSSD'];
const FLAME_BACK = ['.DD...', 'DAAD..', 'DAASSD', 'DASSSD'];
const FLAME_TALL = ['..DD..', '..DAD.', '.DAAD.', '.DAASD', 'DAAASD', 'DASSSD'];
const FLAME_EMBER = ['......', '......', '.DDDD.', 'DSSSSD'];

// One leg, 4 wide x 4 tall; the top row overwrites the belly outline, the foot points forward.
const LEG_NEAR = ['DPD.', 'DPD.', 'DPD.', 'DDDD'];
const LEG_FAR = recolor(LEG_NEAR, { P: 'r' });
const LEG_FOLDED = ['DPPPD', 'DDDDD'];

// Body-relative leg columns: back pair near the tail base, front pair under the shoulder.
const LEGS = { backFar: 6, backNear: 9, frontFar: 16, frontNear: 19 };

// Small laptop in front of the snout for the `work` anim, 8 x 6.
const LAPTOP = ['.DDDDDD.', '.DllllD.', '.DllllD.', '.DDDDDD.', 'DggggggD', 'DDDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghgghgD' });

interface Pose {
  body?: string[];
  flame?: string[];
  /** Whole-sprite offset. */
  dx?: number;
  dy?: number;
  /** Horizontal offsets of the near-side and far-side leg pairs (walk cycle). */
  near?: number;
  far?: number;
  /** Extra offset for the front-near leg only (typing). */
  frontNear?: [number, number];
  extra?: Layer[];
}

function pose({
  body = BODY,
  flame = FLAME_UP,
  dx = 0,
  dy = 0,
  near = 0,
  far = 0,
  frontNear = [0, 0],
  extra = [],
}: Pose): string[] {
  const x = BX + dx;
  const y = BY + dy;
  const legY = y + 10;
  return compose(SIZE, [
    { art: LEG_FAR, x: x + LEGS.backFar + far, y: legY },
    { art: LEG_FAR, x: x + LEGS.frontFar + far, y: legY },
    { art: body, x, y },
    { art: LEG_NEAR, x: x + LEGS.backNear + near, y: legY },
    { art: LEG_NEAR, x: x + LEGS.frontNear + near + frontNear[0], y: legY + frontNear[1] },
    { art: flame, x: x + 2, y: y + 3 - (flame.length - 1) },
    ...extra,
  ]);
}

const idle = [pose({}), pose({ flame: FLAME_BACK }), pose({ flame: FLAME_TALL })];

const walk = [
  pose({ near: 1, far: -1 }),
  shift(pose({ flame: FLAME_BACK }), 0, -1),
  pose({ near: -1, far: 1, flame: FLAME_BACK }),
  shift(pose({}), 0, -1),
];

// Sleeping: belly on the ground, legs folded, eyes closed, tail flame down to an ember.
function sleepPose(flame: string[]): string[] {
  const x = BX;
  const y = BY + 2;
  return compose(SIZE, [
    { art: body(), x, y },
    { art: LEG_FOLDED, x: x + LEGS.backNear - 1, y: y + 10 },
    { art: LEG_FOLDED, x: x + LEGS.frontNear - 1, y: y + 10 },
    { art: flame, x: x + 2, y: y + 3 - (flame.length - 1) },
  ]);
  function body(): string[] {
    return BODY_SLEEP;
  }
}
const sleep = [sleepPose(FLAME_EMBER), sleepPose(['......', '......', '..DDD.', 'DSSSSD'])];

// Working: shifted left so the laptop fits in front of the snout; the front leg taps the keys.
const laptop = (art: string[]): Layer => ({ art, x: 24, y: 26 });
const work = [
  pose({ dx: -3, frontNear: [1, -2], extra: [laptop(LAPTOP)] }),
  pose({ dx: -3, flame: FLAME_BACK, extra: [laptop(LAPTOP_TYPING)] }),
  dots(pose({ dx: -3, frontNear: [1, -2], flame: FLAME_TALL, extra: [laptop(LAPTOP)] }), 'y', [
    [2, 16],
    [7, 14],
  ]),
];

const happy = [
  pose({ flame: FLAME_BACK }),
  shift(pose({ flame: FLAME_TALL }), 0, -2),
  shift(pose({ flame: FLAME_TALL, near: 1, far: -1 }), 0, -4),
];

const hurtRecoil = pose({ body: BODY_HURT, flame: FLAME_BACK, dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', r: 'h' })];

const attack = [
  pose({ dx: -2, near: -1, far: 1 }),
  pose({ dx: 2, flame: FLAME_BACK, near: 1, far: -1 }),
  dots(pose({ dx: 2, flame: FLAME_BACK, near: 1, far: -1 }), 'A', [
    [30, 22],
    [31, 24],
    [30, 26],
    [31, 20],
  ]),
];

export const BLAZEBIT_TEEN: SpriteDef = {
  id: 'blazebit-teen',
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
