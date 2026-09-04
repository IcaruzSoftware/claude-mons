import type { SpriteDef } from './types.ts';
import { compose, dots, frame, lean, place, recolor, squashTop } from './util.ts';

/**
 * The shared egg. Shell colors are fixed; the spots use the tintable keys P/S/A and the outline D,
 * so `tintPalette(EGG.palette, nation)` gives each nation its own egg.
 */
const PALETTE = {
  D: '#2b2b2b', // outline (tintable dark)
  P: '#ff5252', // big spot (tintable primary)
  S: '#ff9100', // side spot (tintable secondary)
  A: '#ffd740', // small spot (tintable accent)
  w: '#fbf6ea', // shell light
  e: '#efe6d2', // shell mid
  s: '#d3c4a3', // shell shade
  h: '#ffffff', // highlight
  k: '#1a1a1a', // crack
  y: '#fff7b0', // light leaking through the cracks
};

const SIZE = 32;
const X = 9; // shell is 14 px wide: cols 9..22, centred on anchor.x = 16
const Y = 13; // shell is 19 px tall: rows 13..31, standing on the anchor row

// 14 x 19 shell
const SHELL = [
  '......DD......',
  '....DDeeDD....',
  '...DweeeeeD...',
  '..DwweeeeesD..',
  '..DwheeeeesD..',
  '.DwweeeeeessD.',
  '.DweeePeeessD.',
  'DweeePPPeesssD',
  'DweeePPPeSsssD',
  'DweeeePeeSSssD',
  'DweeeeeeSSSssD',
  'DweeAeeeeSsssD',
  'DweAAAeeeesssD',
  'DweeAeeeeesssD',
  'DweeeeeeeesssD',
  '.DweeeeessssD.',
  '..DweeeesssD..',
  '...DDeessDD...',
  '.....DDDD.....',
];

// Crack overlays in shell coordinates (14 wide). `k` = crack, `y` = light showing through.
const CRACK_HAIRLINE = [
  '..............',
  '..............',
  '..............',
  '.........k....',
  '........k.....',
  '.........k....',
  '.........k....',
  '........k.....',
];

const CRACK_MEDIUM = [
  '..............',
  '..............',
  '..............',
  '.........k....',
  '........k.....',
  '.........k....',
  '.........k....',
  '........k.....',
  '.......k......',
  '.......kk.....',
  '........k.....',
  '..k...........',
  '...k..........',
  '..k...........',
  '...k..........',
];

const CRACK_BIG = [
  '..............',
  '......k.......',
  '.......k......',
  '......kyk.....',
  '.......kkyk...',
  '........yk....',
  '........ky....',
  '.......kky....',
  '......ykk.....',
  '.......kyk....',
  '..k....ykk....',
  '..ky...ky.....',
  '..ykk..k......',
  '...yk.........',
  '...kk.........',
  '....k.........',
];

function shellFrame(shell: string[]): string[] {
  return compose(SIZE, [{ art: shell, x: X, y: Y }]);
}

const upright = shellFrame(SHELL);
const breathing = shellFrame(squashTop(SHELL, 4));

// Wobble: the top of the egg leans while the base stays planted on the anchor row.
const leanLeft = lean(upright, SIZE - 1, 7, -1);
const leanRight = lean(upright, SIZE - 1, 7, 1);

// Burst of light: the whole shell goes white with a gold outline and rays around it.
const burst = dots(
  dots(recolor(upright, { w: 'h', e: 'h', s: 'y', P: 'h', S: 'y', A: 'h', D: 'A', k: 'h' }), 'y', [
    [16, 8],
    [16, 9],
    [16, 10],
    [9, 11],
    [8, 10],
    [23, 11],
    [24, 10],
    [5, 20],
    [4, 20],
    [3, 20],
    [27, 20],
    [28, 20],
    [29, 20],
    [7, 28],
    [6, 29],
    [25, 28],
    [26, 29],
  ]),
  'A',
  [
    [16, 7],
    [7, 9],
    [25, 9],
    [2, 20],
    [30, 20],
  ],
);

export const EGG: SpriteDef = {
  id: 'egg',
  size: SIZE,
  palette: PALETTE,
  anchor: { x: 16, y: 31 },
  anims: {
    idle: { fps: 2, loop: true, frames: [frame(upright), frame(breathing)] },
    wobble: {
      fps: 8,
      loop: true,
      frames: [frame(upright), frame(leanLeft), frame(upright), frame(leanRight)],
    },
    crack: {
      fps: 6,
      loop: false,
      frames: [
        frame(shellFrame(place(SHELL, CRACK_HAIRLINE, 0, 0))),
        frame(shellFrame(place(SHELL, CRACK_MEDIUM, 0, 0))),
        frame(shellFrame(place(SHELL, CRACK_BIG, 0, 0))),
        frame(burst),
      ],
    },
  },
};
