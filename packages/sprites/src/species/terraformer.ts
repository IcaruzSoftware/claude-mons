import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, shift, squashTop, withRows } from '../util.ts';
import { MOSS_PALETTE, SEEDLING, SEEDLING_LEFT, SEEDLING_RIGHT } from './moss-art.ts';

/** Terraformer: a squat moss tortoise with buried stone plates and exposed root seams. */
const SHELL = [
  '.............dddddddd.............',
  '..........dddgccggcccddd..........',
  '.......dddgcccpppccppccgddd.......',
  '.....ddgcccppppppppppppcccgdd.....',
  '....dgccppppppccpppppppppccgd....',
  '...dgccpppppccggccppppppppccgd...',
  '..dgccpppppccppppccppppccppccgd..',
  '.dgccpppccppppppppccppcggccpccgd.',
  '.dccppccggccpppppppppccppccppccd.',
  'dccppccpppccppppppppppppppppppccd',
  'dcppppppppppppppccpppppppppppppcd',
  'dcpppppbbrppppccggccppppppbbrppcd',
  'dscppppbrbbrppccppccppppbbrbrppsd',
  'dsccppppbrbbrpppppppppbbrbrppccsd',
  '.dscpddfffddbrppppppbbrddfffddcd.',
  '.dsccdfaaafdbbrpppbbbrdfaaafdcsd.',
  '..dscdfeeefdppbbrbbrppdfeeefdcsd..',
  '..dsccdddddcpppbrbppccdddddcpsd..',
  '...dsccpppppppbbrbbrppppppccsd...',
  '....dssccppppbbrrrbbppppccssd....',
  '.....ddssccpppbbbbbpppccssdd.....',
  '.......dddssssssssssssddd.......',
  '..........dddddddddddd..........',
];
const HEAD = [
  '....dddddd....',
  '...dgccccgd...',
  '..dgccppccgd..',
  '.dgcppppppcgd.',
  'dgcknhpphnkpcd',
  'dccknkppknkpcd',
  'dcppkkppkkpppd',
  'dppappppppappd',
  'dpppppkkpppppd',
  '.dscppppppcsd.',
  '..dssccccssd..',
  '...dddddddd...',
];
const CLOSED = withRows(HEAD, {
  4: 'dgcpppppppppcd',
  5: 'dcckkkppkkkpcd',
  6: 'dcpppppppppppd',
});
const GRIN = withRows(CLOSED, { 8: 'dppppkkkkppppd', 9: '.dscppwwppcsd.' });
const SNEEZE = withRows(CLOSED, {
  4: 'dgcpppkpkpppcd',
  5: 'dccpppkkkpppcd',
  8: 'dppppknnkppppd',
});
const NECK = [
  '...dddddddd...',
  '..dfppppppfd..',
  '.dfeppppppefd.',
  'dfeppppppppefd',
  'dfeppppppppefd',
  '.deppppppped..',
  '..ddddddddd...',
];
const LEG = ['.ddddd.', 'dgcccbd', 'dcpbbbd', 'dcpbbrd', 'dssfffd', '.ddddd.'];
const SHOOT = ['..dd...', '.dggd..', 'dgccpd.', '.dpppd.', '..dpd..', '...d...'];

function pose({
  head = HEAD,
  dx = 0,
  near = 0,
  plant,
  sneeze = false,
  shell = SHELL,
}: {
  head?: string[];
  dx?: number;
  near?: number;
  plant?: string[];
  sneeze?: boolean;
  shell?: string[];
} = {}): string[] {
  const rows = compose(48, [
    { art: recolor(LEG, { p: 's', c: 's', g: 'c', f: 'e' }), x: 13 + dx - near, y: 40 },
    { art: recolor(LEG, { p: 's', c: 's', g: 'c', f: 'e' }), x: 30 + dx - near, y: 40 },
    { art: NECK, x: 29 + dx, y: 34 },
    { art: LEG, x: 8 + dx + near, y: 42 },
    { art: LEG, x: 26 + dx + near, y: 42 },
    { art: shell, x: 4 + dx, y: 19 },
    { art: head, x: 32 + dx, y: 29 },
    { art: SHOOT, x: 13 + dx, y: 15 },
    { art: SHOOT, x: 27 + dx, y: 17 },
    ...(plant ? [{ art: plant, x: 21 + dx, y: 11 }] : []),
  ]);
  return sneeze
    ? dots(rows, 't', [
        [45, 23],
        [46, 26],
        [44, 20],
      ])
    : rows;
}

const idle = [pose(), pose({ shell: squashTop(SHELL, 3) }), pose({ head: CLOSED })];
const walk = [
  pose({ near: 1 }),
  shift(pose(), 0, -1),
  pose({ near: -1 }),
  shift(pose({ head: CLOSED }), 0, -1),
];
const sleep = [pose({ head: CLOSED }), pose({ head: CLOSED, shell: squashTop(SHELL, 3) })];
// The adult grows the same swaying seedling on its living moss shell.
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
  shift(pose({ head: GRIN }), 0, -2),
  shift(pose({ head: GRIN, near: 1 }), 0, -3),
];
const recoil = pose({ head: SNEEZE, dx: -1 });
const hurt = [
  recoil,
  recolor(recoil, { p: 'h', s: 'h', c: 'h', g: 'h', b: 'h', r: 'h', f: 'h', e: 'h' }),
];
const attack = [
  pose({ dx: -2, near: -1 }),
  pose({ dx: 1, near: 1 }),
  dots(pose({ dx: 2, head: SNEEZE }), 't', [
    [47, 23],
    [46, 20],
    [47, 26],
  ]),
  pose(),
];

export const TERRAFORMER_ADULT: SpriteDef = {
  id: 'terraformer-adult',
  size: 48,
  palette: MOSS_PALETTE,
  anchor: { x: 24, y: 47 },
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
