import type { SpriteDef } from '../types.ts';
import { compose, frame, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Brookfin (Water, rare, teen): a sleeker otter sitting upright with small ears and whiskers,
 * cradling a fish across its chest in both paws. Tintable teal fur (P), pale belly (A), dark-blue
 * outline/shade (D/S); the fish keeps its fixed silver body (f) and orange tail (o). Dark eyes (k),
 * a nose (n), pale whiskers (w). It sways when idle and swings the fish when it attacks.
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

const SIZE = 32;
const BX = 8; // torso: 16 px wide, cols 8..23
const BY = 5; // torso: 27 px tall, rows 5..31; feet on row 31

// 16 x 27 upright otter with ears. Face on rows 4..7; legs split at row 22; feet on row 26.
const TORSO = [
  '...DD......DD...',
  '..DPPDDDDDDPPD..',
  '..DPPPPPPPPPPD..',
  '..DPPPPPPPPPPD..',
  '..DPkhPPPPhkPD..',
  '..DPPPAAAAPPPD..',
  '.wDPPPAnnAPPPDw.',
  '.wDPPPAAAAPPPDw.',
  '....DPPPPPPD....',
  '..DPPPPPPPPPPD..',
  '.DPPPAAAAAAPPPD.',
  '.DPPAAAAAAAAPPD.',
  '.DPPAAAAAAAAPPD.',
  '.DPPAAAAAAAAPPD.',
  '.DPPAAAAAAAAPPD.',
  '.DPPPAAAAAAPPPD.',
  '.DPPPPAAAAPPPPD.',
  '.DPPPPPAAPPPPPD.',
  '.DPPPPPPPPPPPPD.',
  '.DSPPPPPPPPPPSD.',
  '..DPPPPPPPPPPD..',
  '..DPPPPPPPPPPD..',
  '..DPPD....DPPD..',
  '..DPPD....DPPD..',
  '..DPPD....DPPD..',
  '..DPPD....DPPD..',
  '..DDDD....DDDD..',
];

const FACE_SLEEP: Record<number, string> = {
  4: '..DPkkPPPPkkPD..',
};
const FACE_HAPPY: Record<number, string> = {
  4: '..DPkkPPPPkkPD..',
  7: '.wDPPPAhhAPPPDw.',
};
const FACE_HURT: Record<number, string> = {
  4: '..DPkkPPPPkkPD..',
  7: '.wDPPPAkkAPPPDw.',
};
const FACE_ATTACK: Record<number, string> = {
  4: '..DPkkPPPPkkPD..',
  7: '.wDPPPAhhAPPPDw.',
};

function body(...faces: Array<Record<number, string>>): string[] {
  return withRows(TORSO, Object.assign({}, ...faces));
}

// Fish cradled across the chest: silver body, orange fan tail on the left, dark eye near the head.
const FISH = [
  'oo..ffff....',
  '.o.ffffffk..',
  '.o.ffffffk..',
  'oo..ffff....',
];
// A little fur paw that grips an end of the fish.
const PAW = ['DPD', 'PPP', 'DPD'];

const LAPTOP = ['.DDDDDDDD.', '.DllllllD.', '.DllllllD.', '.DDDDDDDD.', 'DggggggggD', 'DDDDDDDDDD'];
const LAPTOP_TYPING = withRows(LAPTOP, { 4: 'DghgghgghD' });

const SPLASH = ['A..h..A', '.h.A.h.', '..A.A..'];

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
const FY = 15; // fish origin row (chest height)

function figure({
  torso = TORSO,
  showFish = true,
  fishDx = 0,
  fishDy = 0,
  dx = 0,
  dy = 0,
  extra = [],
}: Pose): string[] {
  const layers: Layer[] = [{ art: torso, x: BX + dx, y: BY + dy }];
  if (showFish) {
    layers.push({ art: FISH, x: FX + dx + fishDx, y: FY + dy + fishDy });
    layers.push({ art: PAW, x: 8 + dx + fishDx, y: FY + 1 + dy + fishDy });
    layers.push({ art: PAW, x: 18 + dx + fishDx, y: FY + 1 + dy + fishDy });
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
const sleep = [squashTop(sleepFig, 22), squashTop(squashTop(sleepFig, 22), 24)];

const laptop = (art: string[]): Layer => ({ art, x: 17, y: 25 });
const work = [
  figure({ showFish: false, extra: [laptop(LAPTOP)] }),
  figure({ showFish: false, torso: squashTop(TORSO, 24), extra: [laptop(LAPTOP_TYPING)] }),
  figure({ showFish: false, extra: [laptop(LAPTOP_TYPING)] }),
];

const happy = [
  squashTop(figure({ torso: body(FACE_HAPPY) }), 26),
  figure({ torso: body(FACE_HAPPY), dy: -2, fishDy: -1 }),
  figure({ torso: body(FACE_HAPPY), dy: -4, fishDy: -2 }),
];

const hurtRecoil = figure({ torso: body(FACE_HURT), dx: -2 });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h' })];

// Attack: wind the fish up and back, then swing it forward and down with a splash.
const attack = [
  figure({ torso: body(FACE_ATTACK), dx: -1, fishDx: -3, fishDy: -6 }),
  figure({ torso: body(FACE_ATTACK), dx: 1, fishDx: 4, fishDy: -2 }),
  figure({
    torso: body(FACE_ATTACK),
    dx: 1,
    fishDx: 6,
    fishDy: 3,
    extra: [{ art: SPLASH, x: 24, y: 17 }],
  }),
];

export const BROOKFIN_TEEN: SpriteDef = {
  id: 'brookfin-teen',
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
