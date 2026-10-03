import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, squashTop, withRows } from '../util.ts';
import { MOSS_PALETTE, SEEDLING, SEEDLING_LEFT, SEEDLING_RIGHT } from './moss-art.ts';

/** Rootling: a braided root guardian with a moss cushion crown and mitten hands. */
const HEAD = [
  '......dddddddd......',
  '...dddgccggcccddd...',
  '..dgcccpppccppccgd..',
  '.dgccppppppppppccgd.',
  'dgccppppppppppppccgd',
  'dccppknhpppphnkppccd',
  'dcpppknkppppknkpppcd',
  'dppppkkkppppkkkppppd',
  'dppappppppppppppappd',
  '.dcppppppkkppppppcd.',
  '..dscppppppppppcsd..',
  '....ddssccccssdd....',
  '......dddddddd......',
];
const CLOSED = withRows(HEAD, {
  5: 'dccppppppppppppppccd',
  6: 'dcpppkkkppppkkkpppcd',
  7: 'dppppppppppppppppppd',
});
const GRIN = withRows(CLOSED, { 9: '.dcpppppkkkkpppppcd.', 10: '..dscppppwwppppcsd..' });
const SNEEZE = withRows(CLOSED, {
  5: 'dccpppkpppppkppppccd',
  6: 'dcppppkkpppkkpppppcd',
  9: '.dcpppppknnkpppppcd.',
});
const TORSO = [
  '..dddccddccddd..',
  '.dgcpccbbccpcgd.',
  'dgccppbrbbppccgd',
  'dcpppbbrbbppppcd',
  '.dcppbrbbrpppcd.',
  '..dbbrbccbbrbd..',
  '.dbbrbcccbbrbbd.',
  '.drbbccppcbbrbd.',
  '..drbbccbbbrdd..',
  '...ddrrrrrrdd...',
];
const SHOOTS = [
  '.dd..........dd.',
  'dggd........dgcd',
  'dcpcdd....ddppcd',
  '.dcppd....dppcd.',
  '..ddpd....dpdd..',
  '....dd....dd....',
];
const ARM = ['.dd.', 'dbbd', 'drbd', 'dbbd', 'dggd', 'dccd', '.dd.'];
const LEG = ['.dbbd.', 'dbbbrd', 'dbccbd', 'dcccbd', '.dddd.'];

function pose({
  head = HEAD,
  dx = 0,
  plant,
  sneeze = false,
  step = 0,
}: {
  head?: string[];
  dx?: number;
  plant?: string[];
  sneeze?: boolean;
  step?: number;
} = {}): string[] {
  const headY = plant ? 12 : 7;
  const rows = compose(32, [
    { art: LEG, x: 9 + dx - step, y: 27 },
    { art: LEG, x: 17 + dx + step, y: 27 },
    { art: TORSO, x: 8 + dx, y: 19 },
    { art: ARM, x: 4 + dx, y: plant ? 14 : 21 },
    { art: ARM, x: 24 + dx, y: plant ? 14 : 21 },
    { art: head, x: 6 + dx, y: headY },
    { art: SHOOTS, x: 8 + dx, y: headY - 5 },
    ...(plant ? [{ art: plant, x: 12 + dx, y: 4 }] : []),
  ]);
  return sneeze
    ? dots(rows, 't', [
        [27, 13],
        [29, 16],
        [28, 20],
      ])
    : rows;
}

const idle = [pose(), pose({ head: squashTop(HEAD, 3) }), pose({ head: CLOSED })];
const walk = [
  pose({ dx: -1, step: 1 }),
  pose({ step: 0 }),
  pose({ dx: 1, step: -1 }),
  pose({ head: squashTop(HEAD, 3) }),
];
const sleep = [pose({ head: CLOSED }), pose({ head: squashTop(CLOSED, 3) })];
const work = [
  pose({ plant: SEEDLING_LEFT }),
  pose({ plant: SEEDLING }),
  pose({ plant: SEEDLING_RIGHT }),
  pose({ plant: SEEDLING, head: CLOSED }),
  pose({ plant: SEEDLING_RIGHT, head: SNEEZE, sneeze: true }),
  pose({ plant: SEEDLING, head: GRIN }),
  pose({ plant: SEEDLING_LEFT, head: GRIN }),
  pose({ plant: SEEDLING }),
];
const happy = [
  pose({ head: GRIN }),
  pose({ head: GRIN, step: 1 }),
  pose({ head: squashTop(GRIN, 3), step: -1 }),
];
const recoil = pose({ head: SNEEZE, dx: -2 });
const hurt = [recoil, recolor(recoil, { p: 'h', s: 'h', c: 'h', g: 'h', b: 'h', r: 'h' })];
const attack = [
  pose({ dx: -2, step: -1 }),
  pose({ dx: 1, step: 1 }),
  dots(pose({ dx: 2, head: SNEEZE }), 't', [
    [30, 11],
    [31, 15],
    [30, 20],
  ]),
  pose(),
];

export const ROOTLING_TEEN: SpriteDef = {
  id: 'rootling-teen',
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
