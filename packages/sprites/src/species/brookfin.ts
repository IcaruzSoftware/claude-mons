import type { SpriteDef } from '../types.ts';
import { compose, frame, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/** Brookfin: side-facing river otter, cream whiskered muzzle, long tail and a fish weapon. */
const PALETTE = {
  d: '#38272e',
  p: '#98624a',
  s: '#684737',
  c: '#bf8663',
  a: '#f0d4ad',
  f: '#398ba5',
  q: '#18575a',
  v: '#b9dbe6',
  o: '#ef9869',
  k: '#19282d',
  n: '#26353b',
  w: '#fff0d4',
  h: '#ffffff',
  t: '#61c5e8',
  i: '#c5f2ff',
  g: '#9e9e9e',
  l: '#b3e5fc',
};

const HEAD = [
  '....ddddddd.....',
  '..ddpccccccdd...',
  '.dappcccccpppd..',
  '.dappppppppppd..',
  'dppppccppppppd..',
  'dppppkhppppppdd.',
  'dppppkkppppaaaad',
  'dpppppaaaaaannnd',
  '.dpppaaaahaaannn',
  '..dppaaaawaaaaad',
  '..dppaaawaaadd..',
  '...dppaaaadd....',
  '...dppaaaad.....',
  '....dddddd......',
];

const BODY = [
  '......dddddd.....',
  '....ddppccpdd....',
  '..ddppccccppad...',
  '.dpppppppppaaad..',
  'dppppppppppaaaad.',
  'dssppppppppaaaad.',
  'dssppppppppaaaad.',
  'dssppppppppaaaad.',
  '.dsspppppppaaaad.',
  '..dssppppppaaad..',
  '...dppppdddpppd..',
  '...dpppd...dppd..',
  '...dpppd...dpppd.',
  '...ddddd...ddddd.',
];

const TAIL = [
  '.dd........',
  'dppd.......',
  'dppd.......',
  'dppd.......',
  '.dppd......',
  '.dpppd.....',
  '..dpppd....',
  '...dpppd...',
  '...dpppdd..',
  '....dppppdd',
  '.....dssppd',
  '......dsspd',
  '.......ddd.',
];

const FISH = [
  '........ooo......',
  '.....qqqffffqq...',
  'oo..qfffffffffq..',
  '.ooqffffffhffffq.',
  'ooqfffffffkkfffq.',
  '..qvvvvvvvvvvvq..',
  '...qqqoooqqqqq...',
];

const CLOSED_EYE = withRows(HEAD, { 5: 'dppppkkppppppdd.' });
const PAW = ['.dd.', 'dppd', 'dppd', '.dd.'];
const SPLASH = ['..i....i...', '.it....ti..', 'itt..t..tti', '.iittttii..', '...iiii....'];
const LAPTOP = ['.dddddddd.', '.dlllllld.', '.dlllllld.', '.dddddddd.', 'dggggggggd', 'dddddddddd'];

interface Pose {
  head?: string[];
  dx?: number;
  dy?: number;
  fishDx?: number;
  fishDy?: number;
  extra?: Layer[];
}
function figure({
  head = HEAD,
  dx = 0,
  dy = 0,
  fishDx = 0,
  fishDy = 0,
  extra = [],
}: Pose = {}): string[] {
  return compose(32, [
    { art: TAIL, x: 2 + dx, y: 16 + dy },
    { art: BODY, x: 7 + dx, y: 18 + dy },
    { art: head, x: 15 + dx, y: 6 + dy },
    { art: FISH, x: 12 + dx + fishDx, y: 20 + dy + fishDy },
    { art: PAW, x: 16 + dx + fishDx, y: 25 + dy + fishDy },
    ...extra,
  ]);
}

const idle = [figure(), squashTop(figure(), 25), figure({ head: CLOSED_EYE })];
const walk = [
  shift(figure(), -1, 0),
  shift(figure(), 0, -1),
  shift(figure(), 1, 0),
  shift(squashTop(figure(), 25), 0, -1),
];
const curled = squashTop(squashTop(figure({ head: CLOSED_EYE }), 24), 26);
const sleep = [curled, squashTop(curled, 27)];
const work = [
  figure({ extra: [{ art: LAPTOP, x: 3, y: 25 }] }),
  figure({ fishDy: -1, extra: [{ art: withRows(LAPTOP, { 4: 'dghgghgghd' }), x: 3, y: 25 }] }),
];
const happy = [
  figure({ head: CLOSED_EYE }),
  figure({ head: CLOSED_EYE, dy: -2, fishDy: -1 }),
  figure({ head: CLOSED_EYE, dy: -3, fishDy: -2 }),
];
const recoil = figure({ head: CLOSED_EYE, dx: -1 });
const hurt = [recoil, recolor(recoil, { p: 'h', s: 'h', c: 'h', a: 'h' })];

// Ready, wind-up, fish-first impact, recovery. Fish stays on-grid and attached to its paw.
const attack = [
  figure({ fishDx: -2, fishDy: -3 }),
  figure({ dx: -1, fishDx: -3, fishDy: -5 }),
  figure({ dx: 1, fishDx: 2, fishDy: 0, extra: [{ art: SPLASH, x: 21, y: 15 }] }),
  figure({ fishDx: 1, fishDy: 1 }),
];

export const BROOKFIN_TEEN: SpriteDef = {
  id: 'brookfin-teen',
  size: 32,
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
