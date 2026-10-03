import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, squashTop, withRows, type Layer } from '../util.ts';
import { MOSS_PALETTE, SEEDLING, SEEDLING_LEFT, SEEDLING_RIGHT } from './moss-art.ts';

/** Mossling: a cushion of living moss, leafy shoots and tiny earthy feet. */
const BODY = [
  '.......dddddd.......',
  '....dddggccccddd....',
  '..ddgccccccppccgdd..',
  '.dgcccpppppppppccgd.',
  'dgcccpppppppppppccgd',
  'dccppppppppppppppccd',
  'dcppknhpppppphnkppcd',
  'dpppknkppppppknkpppd',
  'dpppkkkppppppkkkpppd',
  'dppppppppppppppppppd',
  'dcppappppkkppppappcd',
  'dscppppppkkppppppcsd',
  '.dscppppppppppppcsd.',
  'dgcscppppppppppcscgd',
  'dccsccppppppppccsccd',
  '.dssccppppppppccssd.',
  '..ddssccppppccssdd..',
  '....dddssssssddd....',
  '.......dddddd.......',
];
const CLOSED = withRows(BODY, {
  6: 'dcppppppppppppppppcd',
  7: 'dpppkkkppppppkkkpppd',
  8: 'dppppppppppppppppppd',
});
const GRIN = withRows(CLOSED, {
  10: 'dcppapppkkkkpppappcd',
  11: 'dscppppppwwppppppcsd',
});
const SNEEZE = withRows(CLOSED, {
  6: 'dcpppkppppppppkpppcd',
  7: 'dppppkkppppppkkppppd',
  10: 'dcppapppkkkkpppappcd',
  11: 'dscpppppknnkpppppcsd',
});
const SHOOTS = [
  '.dd..........dd.',
  'dggd........dgcd',
  'dcpcdd....ddppcd',
  '.dcppd....dppcd.',
  '..ddpd....dpdd..',
  '....dd....dd....',
];
const PAW = ['.dd.', 'dgcd', 'dppd', '.dd.'];
const FOOT = ['.dbbd.', 'dbobbd', 'drrbbd', '.dddd.'];

function pose({
  body = BODY,
  dx = 0,
  dy = 0,
  plant,
  sneeze = false,
}: {
  body?: string[];
  dx?: number;
  dy?: number;
  plant?: string[];
  sneeze?: boolean;
} = {}): string[] {
  const layers: Layer[] = [
    { art: FOOT, x: 9 + dx, y: 28 + dy },
    { art: FOOT, x: 17 + dx, y: 28 + dy },
    { art: body, x: 6 + dx, y: 11 + dy },
    { art: SHOOTS, x: 8 + dx, y: 6 + dy },
    { art: PAW, x: 5 + dx, y: (plant ? 13 : 23) + dy },
    { art: PAW, x: 23 + dx, y: (plant ? 13 : 23) + dy },
  ];
  if (plant) layers.push({ art: plant, x: 12 + dx, y: 3 + dy });
  const rows = compose(32, layers);
  return sneeze
    ? dots(rows, 't', [
        [27, 14],
        [29, 17],
        [27, 20],
      ])
    : rows;
}

const idle = [pose(), pose({ body: squashTop(BODY, 3) }), pose({ body: CLOSED })];
const walk = [pose({ dx: -1 }), pose({ dy: -2 }), pose({ dx: 1 }), pose({ dy: -1 })];
const sleep = [pose({ body: CLOSED }), pose({ body: squashTop(CLOSED, 4) })];
// Several sways precede a brief tickle, sneeze and grin; the soil ball stays on the crown.
const work = [
  pose({ plant: SEEDLING_LEFT }),
  pose({ plant: SEEDLING }),
  pose({ plant: SEEDLING_RIGHT }),
  pose({ plant: SEEDLING, body: CLOSED }),
  pose({ plant: SEEDLING_RIGHT, body: SNEEZE, sneeze: true }),
  pose({ plant: SEEDLING, body: GRIN }),
  pose({ plant: SEEDLING_LEFT, body: GRIN }),
  pose({ plant: SEEDLING }),
];
const happy = [pose({ body: GRIN }), pose({ body: GRIN, dy: -2 }), pose({ body: GRIN, dy: -4 })];
const recoil = pose({ body: SNEEZE, dx: -1 });
const hurt = [recoil, recolor(recoil, { p: 'h', s: 'h', c: 'h', g: 'h' })];
const attack = [
  pose({ body: squashTop(BODY, 4), dx: -2 }),
  pose({ dx: 2, dy: -2 }),
  dots(pose({ dx: 3, body: SNEEZE }), 't', [
    [30, 18],
    [29, 22],
    [30, 26],
  ]),
  pose(),
];

export const MOSSLING_BABY: SpriteDef = {
  id: 'mossling-baby',
  size: 32,
  palette: MOSS_PALETTE,
  anchor: { x: 16, y: 31 },
  anims: {
    idle: { fps: 3, loop: true, frames: idle.map(frame) },
    walk: { fps: 8, loop: true, frames: walk.map(frame) },
    sleep: { fps: 1, loop: true, frames: sleep.map(frame) },
    work: { fps: 3, loop: true, frames: work.map(frame) },
    happy: { fps: 8, loop: true, frames: happy.map(frame) },
    hurt: { fps: 8, loop: true, frames: hurt.map(frame) },
    attack: { fps: 10, loop: false, frames: attack.map(frame) },
  },
};
