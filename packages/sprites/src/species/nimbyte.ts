import type { SpriteDef } from '../types.ts';
import { compose, dots, flipH, frame, recolor, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Nimbyte (Air, common, adult): a cumulonimbus creature, 48 grid. Flat anvil top, a narrow waist,
 * a bulging base with a dark storm-grey underside, stern brows over small eyes, and three tiny
 * lightning bolts dangling below. It hovers a pixel above the ground. Attack = a lightning strike.
 */
const PALETTE = {
  D: '#2b3550', // outline (tintable dark)
  P: '#4fc3f7', // sky blue (tintable primary; laptop screen, strike flash tint)
  S: '#f5f7ff', // cloud white (tintable secondary)
  A: '#b39ddb', // lavender bolt edges (tintable accent)
  b: '#cfe3f7', // cloud shade
  g: '#8fa3c4', // storm grey underside
  u: '#5f6f93', // deep underside
  v: '#8b74c2', // lavender shade (dim bolts, fading strike)
  y: '#fff176', // lightning yellow
  h: '#ffffff', // glint, flash
  k: '#9e9e9e', // laptop body
};

const SIZE = 48;
const CX = 4; // cloud: 40 px wide, cols 4..43
const CY = 14; // cloud: 26 px tall, rows 14..39; bolts hang on rows 40..44

// 40 x 26 cloud
const CLOUD = [
  '......DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD...',
  '....DDSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSDD.',
  '..DDSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSD',
  '.DSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSD',
  'DSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSD',
  'DSbSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSbSD',
  'DbbbSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSbbbD',
  '.DbbbbSSSSSSSSSSSSSSSSSSSSSSSSSSSSbbbbD.',
  '..DDbbbbbSSSSSSSSSSSSSSSSSSSSSSbbbbbDD..',
  '....DDbbbbSSSSSSSSSSSSSSSSSSSSbbbbDD....',
  '......DbbSSSSSSSSSSSSSSSSSSSSSSbbD......',
  '......DbSSSSSSSSSSSSSSSSSSSSSSSSbD......',
  '.....DbSSSSDDDSSSSSSSSSSSSDDDSSSSSSbD...',
  '.....DbSSSSSDDDSSSSSSSSSSDDDSSSSSSSbD...',
  '....DbSSSSSSSDhDSSSSSSSSDhDSSSSSSSSSbD..',
  '....DbSSSSSSSDDDSSSSSSSSDDDSSSSSSSSSbD..',
  '...DbSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSbD.',
  '..DbSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSbD',
  '.DbSSSSSSSSSSSSSDDDDDDDDSSSSSSSSSSSSSSbD',
  'DbbSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSbbD',
  'DbbbSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSbbbD',
  'DgbbbbSSSSSSSSSSSSSSSSSSSSSSSSSSSSbbbbgD',
  'DggbbbbbbbSSSSSSSSSSSSSSSSSSSSbbbbbbbggD',
  '.DgggbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbgggD.',
  '..DDuuuuuuuuuDDuuuuuuuuuuuDDuuuuuuuuDD..',
  '....DDDDDDDDD..DDDDDDDDDDD..DDDDDDDD....',
];

const NO_BROWS: Record<number, string> = {
  12: '.....DbSSSSSSSSSSSSSSSSSSSSSSSSSSSSbD...',
  13: '.....DbSSSSSSSSSSSSSSSSSSSSSSSSSSSSSbD...'.slice(0, 40),
};
const EYES_CLOSED: Record<number, string> = {
  14: '....DbSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSbD..',
  15: '....DbSSSSSSSDDDSSSSSSSSDDDSSSSSSSSSbD..',
};
const EYES_NARROW: Record<number, string> = {
  14: '....DbSSSSSSSDDDSSSSSSSSDDDSSSSSSSSSbD..',
  15: '....DbSSSSSSSDhDSSSSSSSSDhDSSSSSSSSSbD..',
};
const EYES_HAPPY: Record<number, string> = {
  14: '....DbSSSSSSSDDDSSSSSSSSDDDSSSSSSSSSbD..',
  15: '....DbSSSSSSSDSDSSSSSSSSDSDSSSSSSSSSbD..',
};
const SMILE: Record<number, string> = {
  18: '.DbSSSSSSSSSSSSSDSSSSSSDSSSSSSSSSSSSSSbD',
  19: 'DbbSSSSSSSSSSSSSSDDDDDDSSSSSSSSSSSSSSbbD',
};

function cloud(...overrides: Array<Record<number, string>>): string[] {
  return withRows(CLOUD, Object.assign({}, ...overrides));
}

// Tiny lightning bolt, 4 x 5, yellow with a lavender edge.
const BOLT = ['..yA', '.yA.', 'yyyA', '.yA.', 'yA..'];
const BOLT_B = flipH(BOLT);
const BOLT_DIM = recolor(BOLT, { y: 'A', A: 'v' });
// Default bolt positions under the three base lumps.
const BOLT_X = [10, 22, 34];
const BOLT_Y = CY + 26;

// Lightning strike for the attack, 10 x 10, from the cloud's underside down to the ground.
const STRIKE = [
  'yyA.......',
  '.yyA......',
  '..yyyA....',
  '...AyyyA..',
  '.....yyA..',
  '.....yyA..',
  '......yyyA',
  '.......yyA',
  '........yA',
  '........y.',
];
const STRIKE_FADE = recolor(STRIKE, { y: 'A', A: 'v' });

// Laptop for the `work` anim, 14 x 7.
const LAPTOP = [
  '.DDDDDDDDDDDD.',
  '.DPPPPPPPPPPD.',
  '.DPPPPPPPPPPD.',
  '.DPPPPPPPPPPD.',
  '.DDDDDDDDDDDD.',
  'DkkkkkkkkkkkkD',
  'DDDDDDDDDDDDDD',
];
const LAPTOP_TYPING = withRows(LAPTOP, { 5: 'DkhkkhkkhkkhkD' });

interface Pose {
  body?: string[];
  dx?: number;
  dy?: number;
  /** Bolt art per slot (null hides a slot) and per-slot offsets. */
  bolts?: Array<string[] | null>;
  boltOffsets?: Array<[number, number]>;
  extra?: Layer[];
}

function pose({
  body = cloud(),
  dx = 0,
  dy = 0,
  bolts = [BOLT, BOLT_B, BOLT],
  boltOffsets = [
    [0, 0],
    [0, 0],
    [0, 0],
  ],
  extra = [],
}: Pose): string[] {
  const layers: Layer[] = [];
  for (let i = 0; i < 3; i++) {
    const art = bolts[i];
    if (!art) continue;
    const [ox, oy] = boltOffsets[i] ?? [0, 0];
    layers.push({ art, x: BOLT_X[i]! + dx + ox, y: BOLT_Y + dy + oy });
  }
  return compose(SIZE, [...layers, { art: body, x: CX + dx, y: CY + dy }, ...extra]);
}

const swingL: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [-1, 0],
];
const swingR: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [1, 0],
];

const idle = [
  pose({}),
  pose({ dy: -1, boltOffsets: swingL }),
  pose({ dy: -1, bolts: [BOLT_B, BOLT, BOLT_B], boltOffsets: swingR }),
];

// Drifting: the cloud bobs while the bolts swing beneath it.
const walk = [
  pose({ boltOffsets: swingL }),
  pose({ dy: -1 }),
  pose({ dy: -2, bolts: [BOLT_B, BOLT, BOLT_B], boltOffsets: swingR }),
  pose({ dy: -1, body: squashTop(cloud(), 8) }),
];

// Asleep: sinks to the ground, brows relaxed, eyes closed, bolts dimmed.
const sleepBody = cloud(NO_BROWS, EYES_CLOSED);
const dimBolts = [BOLT_DIM, flipH(BOLT_DIM), BOLT_DIM];
const sleep = [
  pose({ body: sleepBody, dy: 1, bolts: dimBolts }),
  pose({ body: squashTop(sleepBody, 9), dy: 1, bolts: dimBolts, boltOffsets: swingL }),
];

// Working: hovers a little higher over a laptop, zapping the keys with a bolt.
const laptop = (art: string[]): Layer => ({ art, x: 29, y: 41 });
const TYPE_ZAP = ['.yA', 'yA.', 'yyA', '.yA'];
const work = [
  pose({ dy: -2, bolts: [BOLT, BOLT_B, null], extra: [laptop(LAPTOP)] }),
  pose({
    dy: -2,
    bolts: [BOLT_B, BOLT, null],
    extra: [laptop(LAPTOP_TYPING), { art: TYPE_ZAP, x: 35, y: 38 }],
  }),
  dots(pose({ dy: -2, bolts: [BOLT, BOLT_B, null], extra: [laptop(LAPTOP)] }), 'y', [
    [8, 9],
    [40, 7],
  ]),
];

const happyBody = cloud(NO_BROWS, EYES_HAPPY, SMILE);
const happy = [
  pose({ body: squashTop(happyBody, 8) }),
  pose({ body: happyBody, dy: -2, boltOffsets: swingL }),
  pose({ body: happyBody, dy: -4, bolts: [BOLT_B, BOLT, BOLT_B], boltOffsets: swingR }),
];

const hurtRecoil = pose({ body: cloud(EYES_CLOSED), dx: -2, bolts: dimBolts });
const hurt = [
  hurtRecoil,
  recolor(hurtRecoil, { S: 'h', b: 'h', g: 'h', u: 'h', A: 'h', v: 'h', y: 'h' }),
];

// Attack: eyes narrow and the cloud darkens, then a strike lands ahead of it, then fades.
const angry = cloud(EYES_NARROW);
const darkCloud = recolor(angry, { S: 'b', b: 'g', g: 'u' });
const strike: Layer = { art: STRIKE, x: 37, y: 38 };
const attack = [
  pose({ body: squashTop(darkCloud, 8), dx: -1, bolts: dimBolts }),
  dots(pose({ body: recolor(angry, { b: 'S' }), dx: 1, extra: [strike] }), 'h', [
    [46, 45],
    [47, 43],
    [44, 47],
  ]),
  dots(pose({ body: angry, dx: 1, extra: [{ art: STRIKE_FADE, x: 37, y: 38 }] }), 'y', [
    [45, 46],
    [47, 44],
    [43, 46],
  ]),
];

export const NIMBYTE_ADULT: SpriteDef = {
  id: 'nimbyte-adult',
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
