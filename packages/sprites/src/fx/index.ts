import type { SpriteDef } from '../types.ts';
import { compose, frame, type Layer } from '../util.ts';

/**
 * FX overlays. They share the 32 grid with the mons; the renderer draws them above and slightly to
 * the right of the head, so the content lives in the upper-left quadrant of the grid.
 */
const SIZE = 32;
const ANCHOR = { x: 16, y: 31 };

/** Draws `art` with a 1 px dark drop shadow (offset +1,+1) so glyphs read on any desktop. */
function shadowed(art: string[], x: number, y: number, shadowChar = 'k'): Layer[] {
  const shadow = art.map((row) =>
    row
      .split('')
      .map((c) => (c === '.' ? '.' : shadowChar))
      .join(''),
  );
  return [
    { art: shadow, x: x + 1, y: y + 1 },
    { art, x, y },
  ];
}

// --- zzz ------------------------------------------------------------------------------------

const Z_SMALL = ['ZZZZ', '..Z.', '.Z..', 'ZZZZ'];
const Z_BIG = ['ZZZZZ', '...Z.', '..Z..', '.Z...', 'ZZZZZ'];

export const FX_ZZZ: SpriteDef = {
  id: 'fx-zzz',
  size: SIZE,
  palette: { Z: '#bbdefb', k: '#1a2a3a' },
  anchor: ANCHOR,
  anims: {
    idle: {
      fps: 2,
      loop: true,
      frames: [
        compose(SIZE, [...shadowed(Z_SMALL, 4, 14)]),
        compose(SIZE, [...shadowed(Z_SMALL, 5, 11), ...shadowed(Z_BIG, 9, 6)]),
        compose(SIZE, [
          ...shadowed(Z_SMALL, 3, 15),
          ...shadowed(Z_SMALL, 6, 8),
          ...shadowed(Z_BIG, 10, 2),
        ]),
      ].map(frame),
    },
  },
};

// --- sparkle --------------------------------------------------------------------------------

const STAR_3 = ['.A.', 'AhA', '.A.'];
const STAR_5 = ['..h..', '..A..', 'hAAAh', '..A..', '..h..'];
const STAR_7 = ['...h...', '...A...', '...A...', 'hAAhAAh', '...A...', '...A...', '...h...'];

export const FX_SPARKLE: SpriteDef = {
  id: 'fx-sparkle',
  size: SIZE,
  palette: { A: '#ffd740', h: '#ffffff' },
  anchor: ANCHOR,
  anims: {
    idle: {
      fps: 6,
      loop: true,
      frames: [
        compose(SIZE, [
          { art: STAR_5, x: 6, y: 6 },
          { art: STAR_3, x: 14, y: 14 },
        ]),
        compose(SIZE, [
          { art: STAR_7, x: 5, y: 5 },
          { art: STAR_5, x: 13, y: 13 },
        ]),
        compose(SIZE, [
          { art: STAR_3, x: 7, y: 7 },
          { art: STAR_7, x: 12, y: 12 },
          { art: STAR_3, x: 3, y: 16 },
        ]),
      ].map(frame),
    },
  },
};

// --- sweat ----------------------------------------------------------------------------------

const DROP = [
  '...D...',
  '..DBD..',
  '..DBD..',
  '.DBBBD.',
  'DBBhBBD',
  'DBBBBBD',
  '.DBBBD.',
  '..DDD..',
];
const DROP_SMALL = ['.D.', 'DBD', 'DBD', '.D.'];

export const FX_SWEAT: SpriteDef = {
  id: 'fx-sweat',
  size: SIZE,
  palette: { B: '#4fc3f7', h: '#ffffff', D: '#1a3a5a' },
  anchor: ANCHOR,
  anims: {
    idle: {
      fps: 6,
      loop: true,
      frames: [
        compose(SIZE, [{ art: DROP, x: 6, y: 3 }]),
        compose(SIZE, [
          { art: DROP, x: 6, y: 7 },
          { art: DROP_SMALL, x: 14, y: 4 },
        ]),
        compose(SIZE, [
          { art: DROP, x: 6, y: 11 },
          { art: DROP_SMALL, x: 14, y: 8 },
        ]),
      ].map(frame),
    },
  },
};

// --- question -------------------------------------------------------------------------------

const QUESTION = ['.QQQ.', 'Q...Q', '....Q', '...Q.', '..Q..', '..Q..', '.....', '..Q..'];

export const FX_QUESTION: SpriteDef = {
  id: 'fx-question',
  size: SIZE,
  palette: { Q: '#ffffff', k: '#2b2b2b' },
  anchor: ANCHOR,
  anims: {
    idle: {
      fps: 3,
      loop: true,
      frames: [
        compose(SIZE, shadowed(QUESTION, 7, 5)),
        compose(SIZE, shadowed(QUESTION, 7, 4)),
      ].map(frame),
    },
  },
};

// --- heart ----------------------------------------------------------------------------------

const HEART = ['.HH.HH.', 'HhHHHHH', 'HHHHHHH', '.HHHHH.', '..HHH..', '...H...'];
const HEART_SMALL = ['.H.H.', 'HHHHH', '.HHH.', '..H..'];

export const FX_HEART: SpriteDef = {
  id: 'fx-heart',
  size: SIZE,
  palette: { H: '#ff5c8a', h: '#ffd1dc', k: '#5a1a2a' },
  anchor: ANCHOR,
  anims: {
    idle: {
      fps: 6,
      loop: true,
      frames: [
        compose(SIZE, shadowed(HEART_SMALL, 7, 10)),
        compose(SIZE, shadowed(HEART, 5, 7)),
        compose(SIZE, [...shadowed(HEART, 5, 6), ...shadowed(HEART_SMALL, 13, 3)]),
      ].map(frame),
    },
  },
};

export const FX_SPRITES: SpriteDef[] = [FX_ZZZ, FX_SPARKLE, FX_SWEAT, FX_QUESTION, FX_HEART];
