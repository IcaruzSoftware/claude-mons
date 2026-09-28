import type { SpriteDef } from '../types.ts';
import { compose, frame, recolor, squashTop, withRows, type Layer } from '../util.ts';

/** Ottlet: front-facing river otter with paired ears, a broad whiskered muzzle and a fish weapon. */
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
  n: '#35242a',
  w: '#fff0d4',
  h: '#ffffff',
  t: '#61c5e8',
  i: '#c5f2ff',
  r: '#bb8650', // bamboo rod
  j: '#d2e3df', // fishing line
};

const HEAD = [
  '.....dddddddddd.....',
  '...ddccccccccccdd...',
  '..dapccppccppccpad..',
  '..dppppppppppppppd..',
  '..dpaakhpppphkaapd..',
  '..dpakhkpaapkhkapd..',
  '..dpakkkpaapkkkapd..',
  '..dpaaannnnnnaaapd..',
  '.ssaawaaannaaawaass.',
  '..dsaawaaddaawaasd..',
  '..ssaaaaddddaaaass..',
  '...dpaaaawwaaaapd...',
  '....dddddddddddd....',
];

const BODY = [
  '...dddddddd...',
  '..dpaaaaaapd..',
  '..dppawwappd..',
  '..dppaaaappd..',
  '..dppaaaappd..',
  '.dpppaaaapppd.',
  '.dppppaappppd.',
  'dppppppppppppd',
  'dppppppppppppd',
  '.dppppppppppd.',
  '..dppddddppd..',
  '...dddddddd...',
];

const TAIL = [
  'dd..............',
  'dppddd..........',
  'dpcpppdddd......',
  'dsppcpppppdddd..',
  '.dsspppcppppppdd',
  '..ddssppppssddd.',
  '....dddddddd....',
];

const FISH = [
  '......oo.....',
  '...qqffffq...',
  'o.qfffffhfq..',
  'ooqfffffkkfq.',
  'o.qvvvvvvvq..',
  '...qqooqqq...',
];

const CLOSED_EYE = withRows(HEAD, {
  4: '..dpaaaappppaaaapd..',
  5: '..dpaaaapaapaaaapd..',
  6: '..dpakkkpaapkkkapd..',
});
const PAW = ['.dd.', 'dppd', 'dppd', '.dd.'];
const SPLASH = ['..i....i...', '.it....ti..', 'itt..t..tti', '.iittttii..', '...iiii....'];
const ROD = [
  '......rrr..',
  '.....r...j.',
  '.....r...j.',
  '....r....j.',
  '....r....j.',
  '...r.....j.',
  '...r.....j.',
  '..r......j.',
  '..r......j.',
  '.r.......j.',
  '.r.......j.',
  'r........j.',
  'r........j.',
  'r........j.',
  '.........o.',
  '........ooo',
  '.........j.',
];
const CATCH = ['.qfq.', 'qfhfq', '.qvq.', '.ooo.'];
const WATER = ['.tt.tt.', 't..tt.t'];

interface Pose {
  head?: string[];
  body?: string[];
  tailDx?: number;
  showFish?: boolean;
  dx?: number;
  dy?: number;
  fishDx?: number;
  fishDy?: number;
  extra?: Layer[];
}
function figure({
  head = HEAD,
  body = BODY,
  tailDx = 0,
  showFish = true,
  dx = 0,
  dy = 0,
  fishDx = 0,
  fishDy = 0,
  extra = [],
}: Pose = {}): string[] {
  return compose(32, [
    { art: TAIL, x: 14 + dx + tailDx, y: 25 + dy },
    { art: body, x: 9 + dx, y: 20 + dy },
    { art: head, x: 6 + dx, y: 10 + dy },
    ...(showFish
      ? [
          { art: FISH, x: 8 + dx + fishDx, y: 23 + dy + fishDy },
          { art: PAW, x: 11 + dx + fishDx, y: 27 + dy + fishDy },
          { art: PAW, x: 18 + dx + fishDx, y: 27 + dy + fishDy },
        ]
      : []),
    ...extra,
  ]);
}

const STEP_LEFT = withRows(BODY, {
  9: '..dppd..dppd..',
  10: '..dddd..dppd..',
  11: '........dddd..',
});
const STEP_RIGHT = withRows(BODY, {
  9: '..dppd..dppd..',
  10: '..dppd..dddd..',
  11: '..dddd........',
});

const idle = [figure(), squashTop(figure(), 25), figure({ head: CLOSED_EYE })];
const walk = [
  figure({ body: STEP_LEFT, dx: -1, tailDx: 2, fishDy: -1 }),
  figure({ body: STEP_LEFT, dy: -1, tailDx: 1 }),
  figure({ body: STEP_RIGHT, dx: 1, tailDx: -2, fishDy: -1 }),
  figure({ body: STEP_RIGHT, dy: -1, tailDx: -1 }),
];
const curled = squashTop(squashTop(figure({ head: CLOSED_EYE }), 24), 26);
const sleep = [curled, squashTop(curled, 27)];
const work = [
  figure({
    showFish: false,
    extra: [
      { art: ROD, x: 20, y: 13 },
      { art: PAW, x: 19, y: 24 },
      { art: WATER, x: 24, y: 30 },
    ],
  }),
  figure({
    showFish: false,
    head: CLOSED_EYE,
    extra: [
      { art: ROD, x: 20, y: 12 },
      { art: PAW, x: 19, y: 23 },
      { art: WATER, x: 23, y: 30 },
    ],
  }),
  figure({
    showFish: false,
    extra: [
      { art: ROD, x: 20, y: 10 },
      { art: PAW, x: 19, y: 21 },
      { art: CATCH, x: 27, y: 23 },
      { art: WATER, x: 24, y: 30 },
    ],
  }),
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
  figure({ dx: 1, fishDx: 2, fishDy: 0, extra: [{ art: SPLASH, x: 21, y: 19 }] }),
  figure({ fishDx: 1, fishDy: 1 }),
];

export const OTTLET_BABY: SpriteDef = {
  id: 'ottlet-baby',
  size: 32,
  palette: PALETTE,
  anchor: { x: 16, y: 31 },
  anims: {
    idle: { fps: 3, loop: true, frames: idle.map(frame) },
    walk: { fps: 8, loop: true, frames: walk.map(frame) },
    sleep: { fps: 1, loop: true, frames: sleep.map(frame) },
    work: { fps: 2, loop: true, frames: work.map(frame) },
    happy: { fps: 8, loop: true, frames: happy.map(frame) },
    hurt: { fps: 8, loop: true, frames: hurt.map(frame) },
    attack: { fps: 10, loop: false, frames: attack.map(frame) },
  },
};
