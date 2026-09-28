import type { SpriteDef } from '../types.ts';
import { compose, frame, recolor, squashTop, withRows, type Layer } from '../util.ts';

/** Tidewhisker: front-facing river otter with paired ears, a broad whiskered muzzle and a fish weapon. */
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
  '........dddddddddd........',
  '.....dddccccccccccddd.....',
  '...ddacccpccccccpcccadd...',
  '..dppapccppcppcppccpappd..',
  '..dppppppppppppppppppppd..',
  '..dppaaaappppppppaaaappd..',
  '..dpaakhhhpaaaaphhhkaapd..',
  '..dpaakhkkpaaaapkkhkaapd..',
  '..dpaakkkkpaaaapkkkkaapd..',
  '..dppakkkpaaaaaapkkkappd..',
  '..dppaaaaannnnnnaaaaappd..',
  '.dppaaaaaannnnnnaaaaaappd.',
  'wwwwaaawaaaannaaaawaaawwww',
  '..dpaaswaaaaddaaaawsaapd..',
  '..wwwaaaaddaaaaddaaaawww..',
  '...dpaawaaaawwaaaawaapd...',
  '....dppaaawaaaawaaappd....',
  '.....dddddddddddddddd.....',
];

const BODY = [
  '.....dddddddddddd.....',
  '.....dpaaawwaaapd.....',
  '.....dpcwaaaawcpd.....',
  '.....dppaaaaaappd.....',
  '.....dpcawaawacpd.....',
  '.....dppaaaaaappd.....',
  '.....dpaaawwaaapd.....',
  '....dppaaawwaaappd....',
  '....dpcwaaaaaawcpd....',
  '....dppaaawwaaappd....',
  '...dpppaaawwaaapppd...',
  '...dpcpaaawwaaapcpd...',
  '...dppspaaaaaapsppd...',
  '..dppcpsaaaaaaspcppd..',
  '..dpcppsaaaaaasppcpd..',
  '..dpppspaaaaaapspppd..',
  '.dppcpsppaaaappspcppd.',
  '.dpcpppspaaaapspppcpd.',
  '.dppspcpppaapppcpsppd.',
  'dppcpsppssppssppspcppd',
  'dpcppspppsppspppsppcpd',
  '.dsppsssppppppsssppsd.',
  '..dpcppssddddssppcpd..',
  '...dsssddddddddsssd...',
  '....dddddddddddddd....',
];

const TAIL = [
  'dd................',
  'dppdd.............',
  'dpcppdd...........',
  'dspppcpdddd.......',
  '.dsppppcpppdddd...',
  '..dssppppppppppddd',
  '...dddssssssssddd.',
];

const FISH = [
  '.............oooo.......',
  '........qqqqffffffqq....',
  '......qqffvffvffffffq...',
  'oo...qfffffffffhfffffq..',
  '.ooqqffffffffffkkfffffq.',
  'oooqffvffvffvffffffffq..',
  '..qvvvvvvvvvvvvvvvvvq...',
  '...qqvvvvvvvvvvvvvqq....',
  '.....qqooooqqqqqqq......',
];

const CLOSED_EYE = withRows(HEAD, {
  6: '..dpaaaaaapaaaapaaaaaapd..',
  7: '..dpaaaaaapaaaapaaaaaapd..',
  8: '..dpaaaaaapaaaapaaaaaapd..',
  9: '..dppakkkpaaaaaapkkkappd..',
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
  '.........j.',
  '.........j.',
  '.........j.',
  '.........j.',
  '.........j.',
  '.........j.',
  '.........j.',
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
  return compose(48, [
    { art: TAIL, x: 25 + dx + tailDx, y: 41 + dy },
    { art: body, x: 13 + dx, y: 23 + dy },
    { art: head, x: 11 + dx, y: 8 + dy },
    ...(showFish
      ? [
          { art: FISH, x: 12 + dx + fishDx, y: 30 + dy + fishDy },
          { art: PAW, x: 17 + dx + fishDx, y: 36 + dy + fishDy },
          { art: PAW, x: 27 + dx + fishDx, y: 36 + dy + fishDy },
        ]
      : []),
    ...extra,
  ]);
}

const STEP_LEFT = withRows(BODY, {
  22: '....dpppd....dpppd....',
  23: '....ddddd....dpppd....',
  24: '.............ddddd....',
});
const STEP_RIGHT = withRows(BODY, {
  22: '....dpppd....dpppd....',
  23: '....dpppd....ddddd....',
  24: '....ddddd.............',
});

const idle = [figure(), squashTop(figure(), 41), figure({ head: CLOSED_EYE })];
const walk = [
  figure({ body: STEP_LEFT, dx: -1, tailDx: 2, fishDy: -1 }),
  figure({ body: STEP_LEFT, dy: -1, tailDx: 1 }),
  figure({ body: STEP_RIGHT, dx: 1, tailDx: -2, fishDy: -1 }),
  figure({ body: STEP_RIGHT, dy: -1, tailDx: -1 }),
];
const curled = squashTop(squashTop(figure({ head: CLOSED_EYE }), 40), 42);
const sleep = [curled, squashTop(curled, 43)];
const work = [
  figure({
    showFish: false,
    extra: [
      { art: ROD, x: 32, y: 23 },
      { art: PAW, x: 31, y: 34 },
      { art: WATER, x: 36, y: 46 },
    ],
  }),
  figure({
    showFish: false,
    head: CLOSED_EYE,
    extra: [
      { art: ROD, x: 32, y: 22 },
      { art: PAW, x: 31, y: 33 },
      { art: WATER, x: 35, y: 46 },
    ],
  }),
  figure({
    showFish: false,
    extra: [
      { art: ROD, x: 32, y: 20 },
      { art: PAW, x: 31, y: 31 },
      { art: CATCH, x: 39, y: 40 },
      { art: WATER, x: 36, y: 46 },
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
    work: { fps: 2, loop: true, frames: work.map(frame) },
    happy: { fps: 8, loop: true, frames: happy.map(frame) },
    hurt: { fps: 8, loop: true, frames: hurt.map(frame) },
    attack: { fps: 10, loop: false, frames: attack.map(frame) },
  },
};
