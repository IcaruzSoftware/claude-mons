import type { SpriteDef } from '../types.ts';
import { compose, frame, lean, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Tidewhisker (Water, rare, adult): a tall otter standing on two feet, long whiskers fanning from
 * its snout, a curling tail at its left hip, cradling a big fish across its chest in both paws.
 * Tintable teal fur (P), pale belly (A), dark-blue outline/shade (D/S); the fish keeps its fixed
 * silver body (f) and orange tail (o). Dark eyes (k), a nose (n), pale whiskers (w). It sways when
 * idle and slams the fish down when it attacks.
 */
const PALETTE = {
  D: '#0d2a4a', // outline (tintable dark)
  P: '#2ec4b6', // fur (tintable primary)
  S: '#1b4f8a', // fur shade (tintable secondary)
  A: '#e8fbff', // belly / highlight (tintable accent)
  f: '#c8d2dc', // fish body (silver)
  o: '#ff8a3d', // fish tail (coral orange)
  k: '#12232e', // eyes / fish eye
  n: '#2a1c18', // nose
  w: '#eef7ff', // whiskers
  h: '#ffffff', // glints
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 48;
const BX = 12; // torso: 24 px wide, cols 12..35
const BY = 8; // torso: 40 px tall, rows 8..47; feet on row 47

// 24 x 40 standing otter. Face on rows 6..9 (whiskers baked in); legs split at row 32; feet row 39.
const TORSO = [
  '........DDDDDDDD........',
  '.......DPPPPPPPPD.......',
  '......DPPPPPPPPPPD......',
  '.....DPPPPPPPPPPPPD.....',
  '....DPPPPPPPPPPPPPPD....',
  '....DPPPPPPPPPPPPPPD....',
  '....DPPkhPAAAAPhkPPD....',
  '....DPPPPAAAAAAPPPPD....',
  '.wwwDPPPAAAnnAAAPPPDwww.',
  '.wwwDPPPPAAAAAAPPPPDwww.',
  '....DPPPPPPPPPPPPPPD....',
  '......DPPPPPPPPPPD......',
  '......DPPPPPPPPPPD......',
  '....DPPPPPPPPPPPPPPD....',
  '...DPPPPPPPPPPPPPPPPD...',
  '..DPPPPAAAAAAAAAAPPPPD..',
  '..DPPPAAAAAAAAAAAAPPPD..',
  '..DPPAAAAAAAAAAAAAAPPD..',
  '..DPPAAAAAAAAAAAAAAPPD..',
  '..DPPAAAAAAAAAAAAAAPPD..',
  '..DPPAAAAAAAAAAAAAAPPD..',
  '..DPPAAAAAAAAAAAAAAPPD..',
  '..DPPAAAAAAAAAAAAAAPPD..',
  '..DPPPAAAAAAAAAAAAPPPD..',
  '..DPPPPAAAAAAAAAAPPPPD..',
  '..DPPPPPAAAAAAAAPPPPPD..',
  '..DPPPPPPAAAAAAPPPPPPD..',
  '..DPPPPPPPAAAAPPPPPPPD..',
  '..DPPPPPPPPPPPPPPPPPPD..',
  '..DSPPPPPPPPPPPPPPPPSD..',
  '...DPPPPPPPPPPPPPPPPD...',
  '...DPPPPPPPPPPPPPPPPD...',
  '...DPPPPPD....DPPPPPD...',
  '...DPPPPPD....DPPPPPD...',
  '...DPPPPPD....DPPPPPD...',
  '...DPPPPPD....DPPPPPD...',
  '...DPPPPPD....DPPPPPD...',
  '...DPPPPPD....DPPPPPD...',
  '...DPPPPPPD..DPPPPPPD...',
  '...DDDDDDDD..DDDDDDDD...',
];

const FACE_SLEEP: Record<number, string> = {
  6: '....DPPkkPAAAAPkkPPD....',
};
const FACE_HAPPY: Record<number, string> = {
  6: '....DPPkkPAAAAPkkPPD....',
  9: '.wwwDPPPPAAhhAAPPPPDwww.',
};
const FACE_HURT: Record<number, string> = {
  6: '....DPPkkPAAAAPkkPPD....',
  9: '.wwwDPPPPAAkkAAPPPPDwww.',
};
const FACE_ATTACK: Record<number, string> = {
  6: '....DPPkkPAAAAPkkPPD....',
  9: '.wwwDPPPPAAhhAAPPPPDwww.',
};

function body(...faces: Array<Record<number, string>>): string[] {
  return withRows(TORSO, Object.assign({}, ...faces));
}

// The big cradled fish: silver body, orange fan tail on the left, dark eye near the head.
const FISH = [
  'oo...fffffff....',
  'oooffffffffff...',
  'ooffffffffffffk.',
  'ooffffffffffffk.',
  'oooffffffffff...',
  'oo...fffffff....',
];
// A fur paw cradling an end of the fish.
const PAW = ['.DD.', 'DPPD', 'DPPD', '.DD.'];

// Curling tail at the left hip.
const TAIL = [
  'DPPD....',
  'DPPD....',
  'DPPPD...',
  '.DPPD...',
  '.DPPPD..',
  '..DPPD..',
  '..DPPPD.',
  '...DPPD.',
  '...DPPPD',
  '..DPPPD.',
  '..DPPD..',
  '.DDD....',
];

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

const SPLASH = ['A...h...A', '.h.A.A.h.', '..A...A..'];

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
const FY = 18; // fish origin row

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
    { art: TAIL, x: 5 + dx, y: 33 + dy },
    { art: torso, x: BX + dx, y: BY + dy },
  ];
  if (showFish) {
    layers.push({ art: FISH, x: FX + dx + fishDx, y: FY + dy + fishDy });
    layers.push({ art: PAW, x: 11 + dx + fishDx, y: FY + 1 + dy + fishDy });
    layers.push({ art: PAW, x: 26 + dx + fishDx, y: FY + 1 + dy + fishDy });
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

const sleepFig = figure({ torso: body(FACE_SLEEP), showFish: false });
const sleep = [squashTop(sleepFig, 30), squashTop(squashTop(sleepFig, 30), 33)];

const laptop = (art: string[]): Layer => ({ art, x: 27, y: 40 });
const work = [
  figure({ showFish: false, extra: [laptop(LAPTOP)] }),
  figure({ showFish: false, torso: squashTop(TORSO, 34), extra: [laptop(LAPTOP_TYPING)] }),
  figure({ showFish: false, extra: [laptop(LAPTOP_TYPING)] }),
];

const happy = [
  figure({ torso: body(FACE_HAPPY) }),
  figure({ torso: body(FACE_HAPPY), dy: -2, fishDy: -1 }),
  figure({ torso: body(FACE_HAPPY), dy: -4, fishDy: -2 }),
];

const hurtRecoil = figure({ torso: body(FACE_HURT), dx: -3 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h' })];

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
