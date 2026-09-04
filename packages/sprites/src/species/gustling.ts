import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, shift, withRows, type Layer } from '../util.ts';

/**
 * Gustling (Air, common, teen): a gusty little bird seen from the side, facing right. Sky-blue
 * plumage, white chest, a small orange beak, and wind curls (lavender swirls) at the tips of its
 * tail and wing. The wing is a separate layer so it can flap in the walk cycle.
 */
const PALETTE = {
  D: '#2b3550', // outline (tintable dark)
  P: '#4fc3f7', // sky blue plumage (tintable primary)
  S: '#f5f7ff', // white chest (tintable secondary)
  A: '#b39ddb', // lavender wind curls (tintable accent)
  p: '#2b9bd6', // wing shade
  o: '#ffb74d', // beak, legs
  q: '#d18a3a', // far leg shade
  h: '#ffffff', // eye glint, flash
  y: '#fff176', // sparks
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 32;
const BX = 4; // body: 23 px wide, cols 4..26
const BY = 13; // body: 14 px tall, rows 13..26; legs rows 27..31

// 23 x 14 body without the near wing: tail curl on the left, head and beak on the right.
const BODY = [
  '..............DDDDD....',
  '.............DPPPPPD...',
  '............DPPPPDhPPD.',
  '............DPPPPDDPPD.',
  '.DDD.......DPPPPPPPPDDD',
  'DAAAD....DPPPPPPPPPDooD',
  'DA.DD...DPPPPPPPPPPDDD.',
  'DADPPDDDPPPPPPPPPPPD...',
  '.DDPPPPPPPPPPPPPPSSSD..',
  '...DPPPPPPPPPPPPSSSSD..',
  '....DPPPPPPPPPPSSSSSD..',
  '.....DPPPPPPPPPSSSSD...',
  '......DPPPPPPPSSSSD....',
  '.......DDDDDDDDDDD.....',
];

const BODY_CLOSED = withRows(BODY, {
  2: '............DPPPPPPPPD.',
  3: '............DPPPPDDPPD.',
});

const BODY_HAPPY = withRows(BODY, {
  2: '............DPPPPDDPPD.',
  3: '............DPPPDPPDPD.',
  5: 'DAAAD....DPPPPPPPPPDooD',
  6: 'DA.DD...DPPPPPPPPPPDoD.',
});

// Near wing variants, 14 wide. Each ends in a lavender wind curl at the back (left).
const WING_DOWN = [
  '......DDDDDDD.',
  '....DDpppppppD',
  '..DDAppppppppD',
  '.DAAAppppppDD.',
  'DA.DDppppDDD..',
  'DAD..DDDDD....',
  '.D............',
];
const WING_MID = [
  '..DDD.........',
  '.DAAADDDDDDDD.',
  'DA.DDppppppppD',
  'DAD.DDDDDDDDDD',
  '.D............',
];
const WING_UP = [
  '..DDD.........',
  '.DAAAD........',
  'DA.DDpD.......',
  'DAD.DppD......',
  '.D..DpppDD....',
  '....DppppppDDD',
  '....DDpppppppD',
];
// Where each wing variant sits relative to the body so the shoulder stays in place.
const WING_POS: Record<string, [number, number]> = {
  down: [5, 7],
  mid: [4, 6],
  up: [5, 3],
};
const WINGS = { down: WING_DOWN, mid: WING_MID, up: WING_UP };
type WingName = keyof typeof WINGS;

// One thin leg with a forward-pointing foot, 5 x 5. Far leg is shaded.
const LEG_NEAR = ['.DoD.', '.DoD.', '.DoD.', '.DooD', '.DDDD'];
const LEG_FAR = recolor(LEG_NEAR, { o: 'q' });
const LEG_FOLDED = ['DooD', 'DDDD'];
const LEGS = { far: 9, near: 13 }; // body-relative columns

// Small laptop in front of the chest for the `work` anim, 8 x 6.
const LAPTOP = ['.DDDDDD.', '.DllllD.', '.DllllD.', '.DDDDDD.', 'DggggggD', 'DDDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghgghgD' });

interface Pose {
  body?: string[];
  wing?: WingName;
  /** Whole-sprite offset. */
  dx?: number;
  dy?: number;
  /** Horizontal offsets of the near and far legs (walk cycle). */
  near?: number;
  far?: number;
  extra?: Layer[];
}

function pose({
  body = BODY,
  wing = 'down',
  dx = 0,
  dy = 0,
  near = 0,
  far = 0,
  extra = [],
}: Pose): string[] {
  const x = BX + dx;
  const y = BY + dy;
  const legY = y + 14;
  const [wx, wy] = WING_POS[wing]!;
  return compose(SIZE, [
    { art: LEG_FAR, x: x + LEGS.far + far, y: legY },
    { art: body, x, y },
    { art: LEG_NEAR, x: x + LEGS.near + near, y: legY },
    { art: WINGS[wing], x: x + wx, y: y + wy },
    ...extra,
  ]);
}

const idle = [pose({}), pose({ body: BODY_CLOSED }), pose({ wing: 'mid' })];

// Walking: legs alternate while the wing flaps down -> mid -> up -> mid.
const walk = [
  pose({ near: 1, far: -1, wing: 'down' }),
  pose({ dy: -1, wing: 'mid' }),
  pose({ near: -1, far: 1, wing: 'up' }),
  pose({ dy: -1, wing: 'mid' }),
];

// Sleeping: tucked down on folded legs, eyes closed.
function sleepPose(body: string[]): string[] {
  const x = BX;
  const y = BY + 3;
  const [wx, wy] = WING_POS.down!;
  return compose(SIZE, [
    { art: body, x, y },
    { art: LEG_FOLDED, x: x + LEGS.far, y: y + 13 },
    { art: LEG_FOLDED, x: x + LEGS.near + 1, y: y + 13 },
    { art: WING_DOWN, x: x + wx, y: y + wy },
  ]);
}
const sleep = [
  sleepPose(BODY_CLOSED),
  sleepPose(withRows(BODY_CLOSED, { 0: '.......................', 1: '.............DDDDDDD...' })),
];

// Working: shifted back so the laptop fits in front of the chest; the wing taps the keys.
const laptop = (art: string[]): Layer => ({ art, x: 24, y: 26 });
const work = [
  pose({ dx: -4, wing: 'mid', extra: [laptop(LAPTOP)] }),
  pose({ dx: -4, wing: 'down', extra: [laptop(LAPTOP_TYPING)] }),
  dots(pose({ dx: -4, wing: 'mid', extra: [laptop(LAPTOP)] }), 'y', [
    [4, 9],
    [9, 7],
  ]),
];

const happy = [
  pose({ wing: 'down', body: BODY_HAPPY }),
  shift(pose({ wing: 'mid', body: BODY_HAPPY }), 0, -2),
  shift(pose({ wing: 'up', body: BODY_HAPPY, near: 1, far: -1 }), 0, -4),
];

const hurtRecoil = pose({ body: BODY_CLOSED, wing: 'up', dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', p: 'h', o: 'h', q: 'h' })];

// Attack: crouches back with the wing raised, then darts forward on a gust.
const attack = [
  pose({ dx: -2, wing: 'up', near: -1, far: 1 }),
  pose({ dx: 3, wing: 'mid', near: 1, far: -1 }),
  dots(
    dots(pose({ dx: 4, wing: 'down', near: 1, far: -1 }), 'A', [
      [30, 16],
      [31, 19],
      [30, 22],
    ]),
    'S',
    [
      [31, 17],
      [30, 20],
      [31, 23],
    ],
  ),
];

export const GUSTLING_TEEN: SpriteDef = {
  id: 'gustling-teen',
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
