import type { SpriteDef } from '../types.ts';
import { compose, frame, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Ottlet (Water, rare, baby): a round otter pup sitting on its haunches, clutching a small fish
 * across its belly with both paws. Tintable teal fur (P) with a big pale belly (A), dark-blue
 * outline/shade (D/S), fixed silver fish body (f) with an orange tail (o), dark eyes (k), a nose (n)
 * and pale whiskers (w). It breathes when idle and swings the fish when it attacks.
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
};

const SIZE = 32;
const BX = 6; // body: 20 px wide, cols 6..25
const BY = 10; // body: 22 px tall, rows 10..31; feet on row 31

// 20 x 22 pup. Face lives on rows 6..8; feet on rows 20..21.
const BODY = [
  '....DD........DD....',
  '...DPPDDDDDDDDPPD...',
  '..DPPPPPPPPPPPPPPD..',
  '..DPPPPPPPPPPPPPPD..',
  '..DPPPPPPPPPPPPPPD..',
  '..DPPPPPPPPPPPPPPD..',
  '..DPPkhPPAAPPhkPPD..',
  '.wDPPPPAAnnAAPPPPDw.',
  '.wDPPPPAAAAAAPPPPDw.',
  '.DPPPPPPPPPPPPPPPPD.',
  '.DPPPPAAAAAAAAPPPPD.',
  '.DPPPAAAAAAAAAAPPPD.',
  '.DPPAAAAAAAAAAAAPPD.',
  '.DPPAAAAAAAAAAAAPPD.',
  '.DPPAAAAAAAAAAAAPPD.',
  '.DPPPAAAAAAAAAAPPPD.',
  '.DPPPPAAAAAAAAPPPPD.',
  '.DPPPPPAAAAAAPPPPPD.',
  '.DSPPPPPPPPPPPPPPSD.',
  '..DSPPPPPPPPPPPPSD..',
  '...DPPPD....DPPPD...',
  '...DDDDD....DDDDD...',
];

const FACE_SLEEP: Record<number, string> = {
  6: '..DPPkkPPAAPPkkPPD..',
};
const FACE_HAPPY: Record<number, string> = {
  6: '..DPkkPPPAAPPPkkPD..',
  8: '.wDPPPPAAhhAAPPPPDw.',
};
const FACE_HURT: Record<number, string> = {
  6: '..DPPkkPPAAPPkkPPD..',
  8: '.wDPPPPAAkkAAPPPPDw.',
};
const FACE_ATTACK: Record<number, string> = {
  6: '..DPPkkPPAAPPkkPPD..',
  8: '.wDPPPPAAhhAAPPPPDw.',
};

function body(...faces: Array<Record<number, string>>): string[] {
  return withRows(BODY, Object.assign({}, ...faces));
}

// Fish held across the belly: silver body, orange fan tail on the left, dark eye near the head.
const FISH = [
  'oo..ffff....',
  '.o.ffffffk..',
  '.o.ffffffk..',
  'oo..ffff....',
];
// A little fur paw that clutches an end of the fish.
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
const sleep = [squashTop(sleepFig, 20), squashTop(squashTop(sleepFig, 20), 22)];

const laptop = (art: string[]): Layer => ({ art, x: 17, y: 25 });
const work = [
  figure({ showFish: false, extra: [laptop(LAPTOP)] }),
  figure({ showFish: false, torso: squashTop(BODY, 26), extra: [laptop(LAPTOP_TYPING)] }),
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
