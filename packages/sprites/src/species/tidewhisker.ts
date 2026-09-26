import type { SpriteDef } from '../types.ts';
import { compose, frame, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/** Tidewhisker: side-facing river otter, cream whiskered muzzle, long tail and a fish weapon. */
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
  '......dddddddd........',
  '....ddppccccppdd......',
  '...dapccccccccppd.....',
  '..dapppccccccppppd....',
  '..dppppppppppppppd....',
  '.dppppcccppppppppd....',
  '.dppppkhhppppppppdd...',
  'dpppppkkkppppppaaaad..',
  'dppppppppppaaaaaaannnd',
  'dppppppppaaaaaahaaannn',
  '.dpppppaaaaawaaaaannn.',
  '..dpppaaaaawaaaaaaaad.',
  '...dppaaaawaaaaaaadd..',
  '...dppaaaaaaaaadd.....',
  '...dsppaaaaaaad.......',
  '....dsppaaaaad........',
  '.....dddddddd.........',
];

const BODY = [
  '........dddddddd.........',
  '.......dppccccppdd.......',
  '......dppccccpppaad......',
  '.....dpppppppppaaad......',
  '.....dpppppppppaaaad.....',
  '.....dpppppppppaaaad.....',
  '.....dpppppppppaaaad.....',
  '.....dsspppppppaaaaad....',
  '.....dsspppppppaaaaad....',
  '.....dsspppppppaaaaad....',
  '.....dsspppppppaaaaad....',
  '.....dsspppppppaaaaad....',
  '......dssppppppaaaad.....',
  '......dssppppppaaaad.....',
  '......dsspppppaaaad......',
  '......dsspppppaaaad......',
  '......dsspppppaaaad......',
  '......dssppppppppd.......',
  '......dppppddppppd.......',
  '......dpppd..dpppd.......',
  '......dpppd..dpppd.......',
  '.....dppppd..dppppd......',
  '.....dppppd..dpppppd.....',
  '.....dddddd..ddddddd.....',
];

const TAIL = [
  '..dd..............',
  '.dppd.............',
  'dpppd.............',
  'dpppd.............',
  'dpppd.............',
  'dpppd.............',
  'dpppd.............',
  '.dpppd............',
  '.dppppd...........',
  '..dppppd..........',
  '...dppppdd........',
  '....dpppppdd......',
  '.....dppppppdd....',
  '......dpppppppdd..',
  '.......dssppppppdd',
  '........dssppppppd',
  '.........dsspppppd',
  '..........ddddddd.',
];

const FISH = [
  '.............oooo.......',
  '........qqqqffffffqq....',
  '......qqffffffffffffq...',
  'oo...qfffffffffhfffffq..',
  '.ooqqffffffffffkkfffffq.',
  'oooqfffffffffffffffffq..',
  '..qvvvvvvvvvvvvvvvvvq...',
  '...qqvvvvvvvvvvvvvqq....',
  '.....qqooooqqqqqqq......',
];

const CLOSED_EYE = withRows(HEAD, { 6: '.dppppkkkppppppppdd...' });
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
  return compose(48, [
    { art: TAIL, x: 2 + dx, y: 25 + dy },
    { art: BODY, x: 12 + dx, y: 24 + dy },
    { art: head, x: 22 + dx, y: 9 + dy },
    { art: FISH, x: 19 + dx + fishDx, y: 31 + dy + fishDy },
    { art: PAW, x: 25 + dx + fishDx, y: 38 + dy + fishDy },
    ...extra,
  ]);
}

const idle = [figure(), squashTop(figure(), 41), figure({ head: CLOSED_EYE })];
const walk = [
  shift(figure(), -1, 0),
  shift(figure(), 0, -1),
  shift(figure(), 1, 0),
  shift(squashTop(figure(), 41), 0, -1),
];
const curled = squashTop(squashTop(figure({ head: CLOSED_EYE }), 40), 42);
const sleep = [curled, squashTop(curled, 43)];
const work = [
  figure({ extra: [{ art: LAPTOP, x: 5, y: 40 }] }),
  figure({ fishDy: -1, extra: [{ art: withRows(LAPTOP, { 4: 'dghgghgghd' }), x: 5, y: 40 }] }),
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
  figure({ dx: -1, fishDx: -3, fishDy: -7 }),
  figure({ dx: 1, fishDx: 3, fishDy: 0, extra: [{ art: SPLASH, x: 37, y: 26 }] }),
  figure({ fishDx: 1, fishDy: 1 }),
];

export const TIDEWHISKER_ADULT: SpriteDef = {
  id: 'tidewhisker-adult',
  size: 48,
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
