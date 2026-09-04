import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Wispit (Air, rare, baby): a small wisp. A pale flame-shaped spirit with dot eyes, lavender
 * cheeks and a trailing tail that fades into translucent streaks. The body is outlined in sky
 * blue rather than the dark outline so it stays airy; only the eyes use the dark key.
 */
const PALETTE = {
  D: '#2b3550', // eyes, book outline (tintable dark)
  P: '#4fc3f7', // sky blue outline (tintable primary)
  S: '#f5f7ff', // pale body (tintable secondary)
  A: '#b39ddb', // lavender cheeks, text (tintable accent)
  b: '#cfe3f7', // body shade, tail
  t: '#cfe3f7aa', // translucent tail
  a: '#b39ddb88', // translucent tail end
  h: '#ffffff', // flash
  y: '#fff176', // sparks
  n: '#fff3c4', // book paper
};

const SIZE = 32;
const BX = 10; // body: 12 px wide, cols 10..21
const BY = 15; // body: 14 px tall, rows 15..28; hovers above the anchor row

// 12 x 14 flame body
const BODY = [
  '........PP..',
  '.......PSSP.',
  '...PP.PSSP..',
  '...PSPPSSSP.',
  '...PSSSSSSSP',
  '..PSSSSSSSSP',
  '..PSSSSSSSSP',
  '..PSSDSSSDSP',
  '..PSSDSSSDSP',
  '..PbASSSSSAP',
  '..PbbSSSSSbP',
  '..PbbbSSSbbP',
  '...PbbbbbbP.',
  '....PPPPPP..',
];

// Flame tip leaning back.
const TIP_LEFT: Record<number, string> = {
  0: '......PP....',
  1: '.....PSSP...',
  2: '..PP.PSSSP..',
  3: '..PSPPSSSSP.',
  4: '...PSSSSSSSP',
};
const EYES_CLOSED: Record<number, string> = {
  7: '..PSSSSSSSSP',
  8: '..PSDDSSSDDP',
};
const EYES_HAPPY: Record<number, string> = {
  7: '..PSDDSSSDDP',
  8: '..PSDSDSDSDP',
};

function body(...overrides: Array<Record<number, string>>): string[] {
  return withRows(BODY, Object.assign({}, ...overrides));
}

// Trailing tail, drawn behind the body so it grows out of its lower-left edge.
const TAIL_A = ['.......Pb', '....PPbbb', '..AAbbbt.', 'aAA......'];
const TAIL_B = ['.........', '.......Pb', '....PPbbb', '.AAAbbt..', 'aA.......'];
const TAIL_CURL = ['.......Pb', '.....PPbb', '....Abbb.', '....aAt..'];
const TAIL_LONG = ['.........Pb', '......PPbbb', '..AAAbbbbt.', 'aAA........'];

// Open book for the `work` anim, 9 wide, with a page mid-flip in the second variant.
const BOOK = ['DDDD.DDDD', 'DnnnDnnnD', 'DAAnDAAnD', 'DDDDDDDDD'];
const BOOK_FLIP = ['....n....', '...nn....', 'DDDDnDDDD', 'DnnnDnnnD', 'DAAnDAAnD', 'DDDDDDDDD'];

interface Pose {
  body?: string[];
  tail?: string[];
  dx?: number;
  dy?: number;
  extra?: Layer[];
}

function pose({ body: art = BODY, tail = TAIL_A, dx = 0, dy = 0, extra = [] }: Pose): string[] {
  return compose(SIZE, [
    { art: tail, x: BX - (tail[0]?.length ?? 9) + 2 + dx, y: BY + 10 + dy },
    { art, x: BX + dx, y: BY + dy },
    ...extra,
  ]);
}

const idle = [
  pose({}),
  pose({ dy: -1, tail: TAIL_B, body: body(TIP_LEFT) }),
  pose({ dy: -1, body: body(EYES_CLOSED) }),
];

// Drifting: bobs up and down while the tail swishes and the tip flickers.
const walk = [
  pose({}),
  pose({ dy: -1, tail: TAIL_B, body: body(TIP_LEFT) }),
  pose({ dy: -2, tail: TAIL_A }),
  pose({ dy: -1, tail: TAIL_B }),
];

// Asleep: sinks low, eyes closed, tail hanging still.
const sleepBody = body(EYES_CLOSED, TIP_LEFT);
const sleep = [
  pose({ body: sleepBody, dy: 2, tail: TAIL_CURL }),
  pose({ body: squashTop(sleepBody, 4), dy: 2, tail: TAIL_CURL }),
];

// Working: hovers over an open book and flips its pages.
const book = (art: string[], y: number): Layer => ({ art, x: 21, y });
const work = [
  pose({ dx: -2, extra: [book(BOOK, 26)] }),
  pose({ dx: -2, dy: -1, tail: TAIL_B, extra: [book(BOOK_FLIP, 24)] }),
  dots(pose({ dx: -2, body: body(TIP_LEFT), extra: [book(BOOK, 26)] }), 'y', [
    [6, 12],
    [9, 10],
    [23, 21],
  ]),
];

const happy = [
  pose({ body: squashTop(body(EYES_HAPPY), 4), tail: TAIL_CURL }),
  pose({ body: body(EYES_HAPPY), dy: -3, tail: TAIL_B }),
  pose({ body: body(EYES_HAPPY, TIP_LEFT), dy: -5, tail: TAIL_A }),
];

const hurtRecoil = pose({ body: body(EYES_CLOSED, TIP_LEFT), dx: -2, tail: TAIL_LONG });
const hurt = [hurtRecoil, recolor(hurtRecoil, { S: 'h', b: 'h', P: 'h', A: 'h', t: 'h', a: 'h' })];

// Attack: pulls back, then darts forward with the tail streaking behind it.
const attack = [
  pose({ dx: -2, body: body(TIP_LEFT), tail: TAIL_CURL }),
  pose({ dx: 4, dy: -1, tail: TAIL_LONG }),
  dots(pose({ dx: 6, dy: -1, tail: TAIL_LONG }), 'A', [
    [29, 20],
    [30, 23],
    [31, 26],
    [29, 17],
  ]),
];

export const WISPIT_BABY: SpriteDef = {
  id: 'wispit-baby',
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
