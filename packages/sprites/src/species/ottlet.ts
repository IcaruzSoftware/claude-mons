import type { SpriteDef } from '../types.ts';
import { compose, frame, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/** Ottlet: chestnut fur, cream muzzle, rounded ears, whiskers and a teal fish.
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

const SIZE = 32;
const BX = 6; // body: 20 px wide, cols 6..25
const BY = 10; // body: 22 px tall, rows 10..31; feet on row 31

// 20 x 22 pup. Face lives on rows 6..8; feet on rows 20..21.
const BODY = [
  '.....dddddddddd.....',
  '....ddppccccppdd....',
  '...dappppppppppad...',
  '..dppccccppccccppd..',
  '..dppppppppppppppd..',
  '..dppkhpppppphkppd..',
  '..dppkkpaaapakkppd..',
  '.wdppaaannnaaappdw..',
  '..wapaaanhnaaapaw...',
  '.wdppaaaanaaaappdw..',
  '..dsppaaaaaaaappsd..',
  '..dsppppaaaappppsd..',
  '..dsppaaaaaaaappsd..',
  '..dppaaaaaaaaaappd..',
  '..dppaaaaaaaaaappd..',
  '..dppaaaaaaaaaappd..',
  '..dsppaaaaaaaappsd..',
  '..dssppaaaaaappssd..',
  '..dssppppppppppssd..',
  '..dsppppddddppppsd..',
  '..dppppd....dppppd..',
  '..dddddd....dddddd..',
];

const FACE_SLEEP: Record<number, string> = {
  5: '..dppkkppppppkkppd..',
};
const FACE_HAPPY: Record<number, string> = {
  5: '..dppkkppppppkkppd..',
};
const FACE_HURT: Record<number, string> = {
  5: '..dppkkppppppkkppd..',
};
const FACE_ATTACK: Record<number, string> = {
  5: '..dppkkppppppkkppd..',
};

function body(...faces: Array<Record<number, string>>): string[] {
  return withRows(BODY, Object.assign({}, ...faces));
}

// Teal fish with a visible eye, pale belly and coral fins.
const FISH = [
  '..qqffq.....',
  'qffhffffq..o',
  'qffkfffffqo.',
  '.qvvvvvvq.oo',
  '..qqooqq....',
];
// A little fur paw that clutches an end of the fish.
const PAW = ['dpd', 'ppp', 'dpd'];

const LAPTOP = ['.dddddddd.', '.dlllllld.', '.dlllllld.', '.dddddddd.', 'dggggggggd', 'dddddddddd'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'dghgghgghd' });

const SPLASH = ['a..h..a', '.h.a.h.', '..a.a..'];

interface Pose {
  torso?: string[];
  showFish?: boolean;
  fishDx?: number;
  fishDy?: number;
  dx?: number;
  dy?: number;
  extra?: Layer[];
}

const FX = 10; // fish origin col
const FY = 22; // fish origin row

function figure({
  torso = BODY,
  showFish = true,
  fishDx = 0,
  fishDy = 0,
  dx = 0,
  dy = 0,
  extra = [],
}: Pose): string[] {
  const layers: Layer[] = [
    { art: ['dd....', 'dpsd..', '.dppsd', '..dppd', '..ddd.'], x: 23 + dx, y: 26 + dy },
    { art: torso, x: BX + dx, y: BY + dy },
  ];
  if (showFish) {
    layers.push({ art: FISH, x: FX + dx + fishDx, y: FY + dy + fishDy });
    layers.push({ art: PAW, x: 8 + dx + fishDx, y: FY + 3 + dy + fishDy });
    layers.push({ art: PAW, x: 17 + dx + fishDx, y: FY + 3 + dy + fishDy });
  }
  layers.push(...extra);
  return compose(SIZE, layers);
}

const idle = [figure({}), squashTop(figure({}), 26), squashTop(figure({}), 24)];

const walk = [
  shift(figure({}), -1, 0),
  shift(figure({}), 0, -1),
  shift(figure({}), 1, 0),
  shift(squashTop(figure({}), 26), 0, -1),
];

const sleepFig = figure({ torso: body(FACE_SLEEP) });
const sleep = [squashTop(sleepFig, 20), squashTop(squashTop(sleepFig, 20), 22)];

const laptop = (art: string[]): Layer => ({ art, x: 17, y: 25 });
const work = [
  figure({ extra: [laptop(LAPTOP)] }),
  figure({ torso: squashTop(BODY, 26), extra: [laptop(LAPTOP_TYPING)] }),
  figure({ extra: [laptop(LAPTOP_TYPING)] }),
];

const happy = [
  squashTop(figure({ torso: body(FACE_HAPPY) }), 26),
  figure({ torso: body(FACE_HAPPY), dy: -2, fishDy: -1 }),
  figure({ torso: body(FACE_HAPPY), dy: -4, fishDy: -2 }),
];

const hurtRecoil = figure({ torso: body(FACE_HURT), dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { p: 'h', s: 'h', a: 'h', c: 'h' })];

// Attack: wind the fish up and back, then swing it forward and down with a splash.
const attack = [
  figure({ torso: body(FACE_ATTACK), dx: -1, fishDx: -3, fishDy: -6 }),
  figure({ torso: body(FACE_ATTACK), dx: 1, fishDx: 4, fishDy: -2 }),
  figure({
    torso: body(FACE_ATTACK),
    dx: 1,
    fishDx: 6,
    fishDy: 3,
    extra: [{ art: SPLASH, x: 24, y: 24 }],
  }),
];

export const OTTLET_BABY: SpriteDef = {
  id: 'ottlet-baby',
  size: SIZE,
  palette: { ...PALETTE, g: '#9e9e9e', l: '#b3e5fc' },
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
