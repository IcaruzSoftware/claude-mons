import type { SpriteDef } from '../types.ts';
import { compose, flipH, frame, recolor, shift, withRows, type Layer } from '../util.ts';

/**
 * Hotfixhound (Fire, rare, teen): a lean hound built for 2 a.m. hotfixes. Side view facing right:
 * a long low body, pointed snout, floppy ear, a leather collar with a gold `!` tag, a mane of flame
 * along the back, a flame-tipped tail and long legs that stretch into a full gallop when walking.
 */
const PALETTE = {
  D: '#2b2b2b', // outline (tintable dark)
  P: '#ff5252', // ember red coat (tintable primary)
  S: '#ff9100', // orange belly / flame (tintable secondary)
  A: '#ffd740', // gold tag / flame tips (tintable accent)
  r: '#c62828', // red shade (far-side legs, ear inner)
  c: '#6d4c41', // leather collar
  h: '#ffffff', // eye glint / hurt flash
  y: '#fff59d', // sparks, speed lines
  k: '#3a0f0f', // open mouth
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 32;

// Body (head + neck + torso), 26 x 15. Eye at cols 17..18 rows 2..3, nose at col 25, collar on
// rows 6..7 of the neck.
const BODY = [
  '..............DDDDDD......',
  '.............DPPPPPPDD....',
  '............DPPPPDhPPPDD..',
  '............DPPPPDDPPPPPDD',
  '............DPPPPPPPPPPPPD',
  '............DPPPPPPPPPDDDD',
  '............DcccccccccD...',
  '.DDDDDDDDDDDDcccccccccD...',
  'DPPPPPPPPPPPPPPPPPPPPPD...',
  'DPPPPPPPPPPPPPPPPPPPPD....',
  'DPPPPPPPPPPPPPPPPPPPPD....',
  'DPPPPPPPPPPPPPPPPPPPPD....',
  '.DPPPPPSSSSSSSSSSSPPPD....',
  '..DPPPSSSSSSSSSSSSPPD.....',
  '...DDDDDDDDDDDDDDDDD......',
];
const BODY_X = 4;
const BODY_Y = 10;

const BODY_HURT = withRows(BODY, {
  2: '............DPPPPPPPPPDD..',
  3: '............DPPPPDDPPPPPDD',
});
// Attack: mouth open, eye narrowed.
const BODY_BITE = withRows(BODY, {
  2: '............DPPPPPPPPPDD..',
  3: '............DPPPPDhPPPPPDD',
  4: '............DPPPPDDPPPDDDD',
  5: '............DPPPPPPPPPDkkD',
  6: '............DcccccccccDDD.',
});

// Lying down, 28 x 9: head resting forward on the ground, eyes closed, front legs folded.
const BODY_SLEEP = [
  '......DDDDDDDDDDDDD.........',
  '....DDPPPPPPPPPPPPPDDDDDDD..',
  '..DDPPPPPPPPPPPPPPccPPPPPPDD',
  '.DPPPPPPPPPPPPPPPPccPPDDPPPD',
  'DPPPPPPPPPPPPPPPPPccPPPPPPPD',
  'DPPPPPPPPPPPPPPPPPPPPPPPDDDD',
  'DPPSSSSSSSSSSSSSSPPPPPPPPPD.',
  '.DPSSSSSSSSSSSSDPPPPDPPPPPD.',
  '..DDDDDDDDDDDDDDDDDDDDDDDDD.',
];

// Gold `!` tag hanging from the collar, 7 x 7: a gold field with the mark punched in dark.
const TAG = ['.DDDDD.', 'DAADAAD', 'DAADAAD', 'DAADAAD', 'DAAAAAD', 'DAADAAD', '.DDDDD.'];
const TAG_X = 22;
const TAG_Y = 18;

// Flame mane along the back, 10 x 5; the bottom row overwrites the back outline.
const MANE = ['.DD....DD.', 'DAAD..DAAD', 'DAASDDAASD', 'DSSSSSSSSD', 'DPSSSSSSPD'];
const MANE_BACK = flipH(MANE); // tips streaming backwards
const MANE_TALL = [
  '.DD....DD.',
  'DAAD..DAAD',
  'DAAD..DAAD',
  'DAASDDAASD',
  'DSSSSSSSSD',
  'DPSSSSSSPD',
];
const MANE_EMBER = ['.DD....DD.', 'DSSD..DSSD', 'DPSSSSSSPD'];
const MANE_X = 7;
const MANE_Y = 13;

// Tail, 6 x 6, curling up from the rump with a flame tip. Drawn behind the body.
const TAIL_UP = ['.DD...', 'DAAD..', 'DASPD.', '.DPPD.', '..DPPD', '...DPD'];
const TAIL_WAG = ['DD....', 'DAAD..', 'DASSPD', '.DDPPD', '...DPD', '...DPD'];
const TAIL_BACK = ['......', 'DDD...', 'DAADD.', 'DASSPD', '..DDPD', '....DD'];
const TAIL_X = 1;
const TAIL_Y = 13;

// Legs, hip at the top-left `DPD`. The top row overwrites the belly outline.
const LEG_STAND = ['DPD.', 'DPD.', 'DPD.', 'DPD.', 'DPD.', 'DPD.', 'DPPD', 'DDDD'];
// Kicked forward, 7 x 8 (hip at cols 0..2).
const LEG_FWD = [
  'DPD....',
  'DPD....',
  '.DPD...',
  '.DPD...',
  '..DPD..',
  '..DPD..',
  '...DPPD',
  '...DDDD',
];
// Kicked back, 7 x 8 (hip at cols 4..6).
const LEG_BACK = flipH(LEG_FWD);
// Reaching forward onto the laptop, 7 x 7.
const LEG_TYPE = [
  'DPD....',
  'DPD....',
  '.DPD...',
  '.DPD...',
  '..DPD..',
  '..DPPDD',
  '...DPPD',
  '....DDD',
];
const LEG_FOLDED = ['DPPPD', 'DDDDD'];
const LEG_Y = 24;
const LEGS = { backFar: 6, backNear: 8, frontFar: 20, frontNear: 22 };

type LegKind = 'stand' | 'fwd' | 'back' | 'type';
const LEG_ART: Record<LegKind, string[]> = {
  stand: LEG_STAND,
  fwd: LEG_FWD,
  back: LEG_BACK,
  type: LEG_TYPE,
};

function leg(kind: LegKind, hipX: number, y: number, far = false): Layer {
  const art = far ? recolor(LEG_ART[kind], { P: 'r' }) : LEG_ART[kind];
  return { art, x: kind === 'back' ? hipX - 4 : hipX, y };
}

const LAPTOP = ['.DDDDDD.', '.DllllD.', '.DllllD.', '.DDDDDD.', 'DggggggD', 'DDDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghgghgD' });

interface Pose {
  body?: string[];
  mane?: string[];
  tail?: string[];
  dx?: number;
  dy?: number;
  /** Leg kinds for the back and front pairs. */
  back?: LegKind;
  front?: LegKind;
  /** Horizontal offsets of the near-side and far-side legs (stride). */
  near?: number;
  far?: number;
  /** Extra offset for the front-near leg only. */
  frontNear?: [number, number];
  /** Layers drawn between the body and the near legs. */
  props?: Layer[];
  extra?: Layer[];
}

function pose({
  body = BODY,
  mane = MANE,
  tail = TAIL_UP,
  dx = 0,
  dy = 0,
  back = 'stand',
  front = 'stand',
  near = 0,
  far = 0,
  frontNear = [0, 0],
  props = [],
  extra = [],
}: Pose): string[] {
  const legY = LEG_Y + dy;
  return compose(SIZE, [
    { art: tail, x: TAIL_X + dx, y: TAIL_Y + dy },
    leg(back, LEGS.backFar + far + dx, legY, true),
    leg(front === 'type' ? 'stand' : front, LEGS.frontFar + far + dx, legY, true),
    { art: body, x: BODY_X + dx, y: BODY_Y + dy },
    ...props,
    leg(back, LEGS.backNear + near + dx, legY),
    leg(front, LEGS.frontNear + near + frontNear[0] + dx, legY + frontNear[1]),
    { art: mane, x: MANE_X + dx, y: MANE_Y + dy + 5 - mane.length },
    { art: TAG, x: TAG_X + dx, y: TAG_Y + dy },
    ...extra,
  ]);
}

const idle = [pose({}), pose({ mane: MANE_BACK, tail: TAIL_WAG }), pose({ mane: MANE_TALL })];

// Gallop: stretch in the air, land on the front legs, gather under the body, push off.
const walk = [
  pose({ dy: -1, back: 'back', front: 'fwd', mane: MANE_BACK, tail: TAIL_BACK }),
  pose({ back: 'fwd', near: 1, far: -1, mane: MANE_BACK, tail: TAIL_BACK }),
  pose({ dy: -1, back: 'fwd', front: 'back', mane: MANE, tail: TAIL_WAG }),
  pose({ front: 'fwd', near: -1, far: 1, mane: MANE_BACK, tail: TAIL_BACK }),
];

// Sleeping: flat on the ground, mane down to embers, a small ember where the tail rests.
function sleepPose(mane: string[], ember: string[]): string[] {
  return compose(SIZE, [
    { art: ember, x: 4, y: 21 },
    { art: BODY_SLEEP, x: 2, y: 23 },
    { art: LEG_FOLDED, x: 7, y: 30 },
    { art: mane, x: 9, y: 24 - mane.length },
  ]);
}
const sleep = [
  sleepPose(MANE_EMBER, ['.DD.', 'DSSD', 'DPPD']),
  sleepPose(shift(MANE_EMBER, 1, 0), ['....', '.DD.', 'DSSD']),
];

// Working: a laptop in front of the chest; the near front paw reaches onto the keys.
const laptop = (art: string[]): Layer => ({ art, x: 25, y: 26 });
const work = [
  pose({ front: 'type', frontNear: [0, -1], props: [laptop(LAPTOP)] }),
  pose({ front: 'type', mane: MANE_BACK, props: [laptop(LAPTOP_TYPING)] }),
  pose({
    front: 'type',
    frontNear: [0, -1],
    mane: MANE_TALL,
    tail: TAIL_WAG,
    props: [laptop(LAPTOP)],
    extra: [{ art: ['y...y', '.....', '..y..'], x: 3, y: 8 }],
  }),
];

const happy = [
  pose({ tail: TAIL_WAG, mane: MANE_BACK }),
  pose({ dy: -2, tail: TAIL_UP, mane: MANE_TALL }),
  pose({ dy: -4, tail: TAIL_WAG, mane: MANE_TALL, back: 'fwd', front: 'back' }),
];

const hurtRecoil = pose({ body: BODY_HURT, dx: -1, tail: TAIL_BACK, mane: MANE_BACK });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', r: 'h', c: 'h' })];

// Attack: crouch, then a dash-bite with the legs stretched and speed lines trailing behind.
const SPEED = ['yyyy..', '......', '.yyyyy', '......', 'yyy...'];
const attack = [
  pose({ dx: -1, back: 'fwd', front: 'back', tail: TAIL_BACK, mane: MANE_BACK }),
  pose({ body: BODY_BITE, dx: 2, back: 'back', front: 'fwd', tail: TAIL_BACK, mane: MANE_BACK }),
  pose({
    body: BODY_BITE,
    dx: 2,
    dy: -1,
    back: 'back',
    front: 'fwd',
    tail: TAIL_BACK,
    mane: MANE_BACK,
    extra: [
      { art: SPEED, x: 0, y: 18 },
      { art: ['.A', 'A.', '..', '..', '..', '..', 'A.', '.A'], x: 30, y: 8 },
    ],
  }),
];

export const HOTFIXHOUND_TEEN: SpriteDef = {
  id: 'hotfixhound-teen',
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
