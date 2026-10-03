import { flipH, withRows } from '../util.ts';

/** Fixed earth colors keep the moss forms coherent under nation tinting. */
export const MOSS_PALETTE = {
  d: '#2d3c22',
  p: '#739744',
  s: '#4f7038',
  c: '#93b85d',
  g: '#b4d477',
  b: '#896144',
  r: '#563e2c',
  a: '#d9a449',
  k: '#30291e',
  n: '#65452d',
  w: '#f2e6bc',
  h: '#ffffff',
  f: '#b4a27b',
  e: '#817052',
  v: '#a0c952', // seedling leaves, distinct from moss
  j: '#59763a', // seedling stem
  q: '#775235', // root ball
  o: '#ae8051', // root-ball highlights
  t: '#a9c76b', // brief sneeze crumbs
};

// The root ball stays planted while its asymmetric leaf tips swing.
export const SEEDLING = [
  '...dd....',
  '..dvvdd..',
  '.dvvvvvd.',
  '..dvvjd..',
  '....j....',
  '..dqqqd..',
  '.dqoqoqd.',
  '..dqqqd..',
  '...ddd...',
];
export const SEEDLING_LEFT = withRows(SEEDLING, {
  0: '..dd.....',
  1: '.dvvdd...',
  2: 'dvvvvvd..',
  3: '.dvvjd...',
});
export const SEEDLING_RIGHT = flipH(SEEDLING_LEFT);
