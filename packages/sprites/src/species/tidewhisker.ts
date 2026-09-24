import type { SpriteDef } from '../types.ts';
import { compose, frame, lean, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/** Tidewhisker: chestnut fur, cream muzzle, rounded ears, whiskers and a teal fish.
 * Fixed fur colors preserve the otter silhouette under Water tinting. */
const PALETTE = {
  d: '#38272e', // fixed warm outline: fur must not be recolored by nation tinting
  p: '#98624a', // chestnut fur
  s: '#684737', // fur shadow
  c: '#bf8663', // fur highlight
  a: '#f0d4ad', // cream muzzle and belly
  f: '#39a69c', // fish scales
  q: '#18575a', // fish outline
  v: '#bed6a4', // fish underside
  o: '#ef9869', // fish fins
  k: '#19282d', // eyes
  n: '#26353b', // nose
  w: '#fff0d4', // whiskers
  h: '#ffffff', // eye glints
  g: '#9e9e9e',
  l: '#b3e5fc',
};

const SIZE = 48;
const BX = 12; // torso: 24 px wide, cols 12..35
const BY = 8; // torso: 40 px tall, rows 8..47; feet on row 47

// 24 x 40 standing otter. Face on rows 6..9 (whiskers baked in); legs split at row 32; feet row 39.
const TORSO = [
  '......dddddddddddd......',
  '....dddppccccccppddd....',
  '...ddppccccccccccppdd...',
  '...dapppccccccccpppad...',
  '...dappppppppppppppad...',
  '...dppccppppppppccppd...',
  '...dppppppppppppppppd...',
  '...dppkhhpppppphhkppd...',
  '..dppkkkpaaaaapkkkppd...',
  '..dppaaaaannnaaaaappd...',
  '...wwapaaaanhnaaapaww...',
  '...wdpaaawaanawaaapdw...',
  '..wwapaaaaanaaaaapaww...',
  '...dppaaaaaaaaaaaappd...',
  '...dsppaaaaaaaaaappsd...',
  '...dssppppaaaappppssd...',
  '...dssppppaaaappppssd...',
  '...dssppaaaaaaaappssd...',
  '...dsppaaaaaaaaaappsd...',
  '...dppaaaaaaaaaaaappd...',
  '...dppaaaaaaaaaaaappd...',
  '...dppaaaaaaaaaaaappd...',
  '...dppaaaaaaaaaaaappd...',
  '...dppaaaaaaaaaaaappd...',
  '...dppaaaaaaaaaaaappd...',
  '...dppaaaaaaaaaaaappd...',
  '...dsppaaaaaaaaaappsd...',
  '...dsppaaaaaaaaaappsd...',
  '...dspppaaaaaaaapppsd...',
  '...dssppaaaaaaaappssd...',
  '...dsspppaaaaaapppssd...',
  '...dssppppaaaappppssd...',
  '...dssppppppppppppssd...',
  '...dssppppppppppppssd...',
  '...dssppppppppppppssd...',
  '...dsppppppddppppppsd...',
  '...dspppppd..dpppppsd...',
  '...dppppppd..dppppppd...',
  '...dppppppd..dppppppd...',
  '...dddddddd..dddddddd...',
];

const FACE_SLEEP: Record<number, string> = {
  7: '...dppkkkppppppkkkppd...',
};
const FACE_HAPPY: Record<number, string> = {
  7: '...dppkkkppppppkkkppd...',
};
const FACE_HURT: Record<number, string> = {
  7: '...dppkkkppppppkkkppd...',
};
const FACE_ATTACK: Record<number, string> = {
  7: '...dppkkkppppppkkkppd...',
};

function body(...faces: Array<Record<number, string>>): string[] {
  return withRows(TORSO, Object.assign({}, ...faces));
}

// Teal fish with a visible eye, pale belly and coral fins.
const FISH = [
  '...qqffoooqq......',
  'qqffffffffffq...oo',
  'qffhkffffffffq.ooo',
  'qffkkffffffffqooo.',
  '.qvvvvvvvvvvq..ooo',
  '..qqqoooqqqq......',
];
// A fur paw cradling an end of the fish.
const PAW = ['.dd.', 'dppd', 'dppd', '.dd.'];

// Curling tail at the left hip.
const TAIL = [
  'dppd....',
  'dppd....',
  'dpppd...',
  '.dppd...',
  '.dpppd..',
  '..dppd..',
  '..dpppd.',
  '...dppd.',
  '...dpppd',
  '..dpppd.',
  '..dppd..',
  '.ddd....',
];

const LAPTOP = [
  '.dddddddddddd.',
  '.dlllllllllld.',
  '.dlllllllllld.',
  '.dlllllllllld.',
  '.dddddddddddd.',
  'dggggggggggggd',
  'dddddddddddddd',
];
const LAPTOP_TYPING = withRows(LAPTOP, { 5: 'dghgghgghgghgd' });

const SPLASH = ['a...h...a', '.h.a.a.h.', '..a...a..'];

interface Pose {
  torso?: string[];
  showFish?: boolean;
  fishDx?: number;
  fishDy?: number;
  dx?: number;
  dy?: number;
  extra?: Layer[];
}

const FX = 13; // fish origin col
const FY = 25; // fish origin row

function figure({
  torso = TORSO,
  showFish = true,
  fishDx = 0,
  fishDy = 0,
  dx = 0,
  dy = 0,
  extra = [],
}: Pose): string[] {
  const layers: Layer[] = [
    { art: TAIL, x: 11 + dx, y: 33 + dy },
    { art: torso, x: BX + dx, y: BY + dy },
  ];
  if (showFish) {
    layers.push({ art: FISH, x: FX + dx + fishDx, y: FY + dy + fishDy });
    layers.push({ art: PAW, x: 11 + dx + fishDx, y: FY + 4 + dy + fishDy });
    layers.push({ art: PAW, x: 25 + dx + fishDx, y: FY + 5 + dy + fishDy });
  }
  layers.push(...extra);
  return compose(SIZE, layers);
}

const idle = [figure({}), squashTop(figure({}), 34), squashTop(figure({}), 32)];

const walk = [
  lean(figure({}), 45, 10, -1),
  shift(figure({}), 0, -1),
  lean(figure({}), 45, 10, 1),
  shift(squashTop(figure({}), 34), 0, -1),
];

const sleepFig = figure({ torso: body(FACE_SLEEP), showFish: true });
const sleep = [squashTop(sleepFig, 30), squashTop(squashTop(sleepFig, 30), 33)];

const laptop = (art: string[]): Layer => ({ art, x: 27, y: 40 });
const work = [
  figure({ extra: [laptop(LAPTOP)] }),
  figure({ torso: squashTop(TORSO, 34), extra: [laptop(LAPTOP_TYPING)] }),
  figure({ extra: [laptop(LAPTOP_TYPING)] }),
];

const happy = [
  figure({ torso: body(FACE_HAPPY) }),
  figure({ torso: body(FACE_HAPPY), dy: -2, fishDy: -1 }),
  figure({ torso: body(FACE_HAPPY), dy: -4, fishDy: -2 }),
];

const hurtRecoil = figure({ torso: body(FACE_HURT), dx: -3 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { p: 'h', s: 'h', a: 'h', c: 'h' })];

// Attack: hoist the fish up and back, then slam it down in front with a splash.
const attack = [
  figure({ torso: body(FACE_ATTACK), dx: -1, fishDx: -3, fishDy: -8 }),
  figure({ torso: body(FACE_ATTACK), dx: 2, fishDx: 6, fishDy: -2 }),
  figure({
    torso: body(FACE_ATTACK),
    dx: 2,
    fishDx: 9,
    fishDy: 6,
    extra: [{ art: SPLASH, x: 34, y: 26 }],
  }),
];

export const TIDEWHISKER_ADULT: SpriteDef = {
  id: 'tidewhisker-adult',
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
