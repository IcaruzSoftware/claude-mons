import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, shift, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Monolithor (Earth, common, adult): a towering dark-gray monolith slab on two short stone legs,
 * 48 grid. Near the top sits a single round green badge for an eye, showing an amber checkmark
 * ("tests passed"). Carved grooves and a row of status LEDs run across the slab. Attack is a
 * ground slam that cracks the floor in amber.
 */
const PALETTE = {
  D: '#2e3a1f', // outline (tintable dark)
  P: '#7cb342', // badge green (tintable primary)
  S: '#8d8d8d', // slab face (tintable secondary)
  A: '#ffb300', // checkmark, LEDs, cracks (tintable accent)
  k: '#5f5f5f', // slab shade side / grooves
  l: '#b5b5b5', // slab highlight edge
  m: '#4f7a24', // badge shade (sleep)
  g: '#c5e1a5', // badge glow
  a: '#8a6100', // dim amber (off LEDs)
  h: '#ffffff', // flash
  y: '#fff3b0', // sparks
};

const SIZE = 48;
const SX = 14; // slab: 20 px wide, cols 14..33
const SY = 6; // slab: 34 px tall, rows 6..39; legs on rows 40..47

// 20 x 34 slab. Left edge lit, right three columns in shade, two grooves, LEDs near the bottom.
const SLAB = [
  '..DDDDDDDDDDDDDDDD..',
  '.DllllllllllllllkkD.',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSkkkkkkkkkkkkkkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSkkkkkkkkkkkkkkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSAaSSAaSSAaSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlSSSSSSSSSSSSSSkkkD',
  'DlkkkkkkkkkkkkkkkkkD',
  'DDDDDDDDDDDDDDDDDDDD',
];
const LEDS_ALT: Record<number, string> = { 28: 'DlSSSaASSaASSaASkkkD' };
const LEDS_OFF: Record<number, string> = { 28: 'DlSSSaaSSaaSSaaSkkkD' };
const LEDS_ON: Record<number, string> = { 28: 'DlSSSAASSAASSAASkkkD' };

// 9 x 9 round badge eye. Placed at slab-relative (6, 3).
const BADGE_CHECK = [
  '..DDDDD..',
  '.DPPPPPD.',
  'DPPPPPPPD',
  'DPPPPPPAD',
  'DPAPPPAPD',
  'DPPAPAPPD',
  'DPPPAPPPD',
  '.DPPPPPD.',
  '..DDDDD..',
];
const BADGE_BLINK = withRows(BADGE_CHECK, {
  3: 'DPPPPPPPD',
  4: 'DPPPPPPPD',
  5: 'DPAAAAAPD',
  6: 'DPPPPPPPD',
});
const BADGE_RUNNING = withRows(BADGE_CHECK, {
  3: 'DPPPPPPPD',
  4: 'DPPPPPPPD',
  5: 'DPAPAPAPD',
  6: 'DPPPPPPPD',
});
const BADGE_FAIL = withRows(BADGE_CHECK, {
  2: 'DPAPPPAPD',
  3: 'DPPAPAPPD',
  4: 'DPPPAPPPD',
  5: 'DPPAPAPPD',
  6: 'DPAPPPAPD',
});
const BADGE_SLEEP = recolor(BADGE_BLINK, { P: 'm', A: 'a' });
const BADGE_GLOW = recolor(BADGE_CHECK, { P: 'g' });

// Short stone leg, 6 x 8. Default: left at x=17, right at x=25, y=40.
const LEG = ['DSSSkD', 'DSSSkD', 'DSSSkD', 'DSSSkD', 'DSSSkD', 'DSSSkD', 'DkkkkD', 'DDDDDD'];

const LAPTOP = [
  '.DDDDDDDDDDDD.',
  '.DggggggggggD.',
  '.DgPgPgPggggD.',
  '.DggggggggggD.',
  '.DDDDDDDDDDDD.',
  'DSSSSSSSSSSSSD',
  'DDDDDDDDDDDDDD',
];
const LAPTOP_TYPING = withRows(LAPTOP, { 2: '.DgPgPgPgPggD.', 5: 'DSlSSlSSlSSlSD' });

interface Pose {
  slab?: string[];
  badge?: string[];
  dx?: number;
  dy?: number;
  /** Extra vertical offset for the slab only (crouch); legs stay put. */
  slabDy?: number;
  leftLeg?: [number, number];
  rightLeg?: [number, number];
  extra?: Layer[];
}

function slab(...overrides: Array<Record<number, string>>): string[] {
  return withRows(SLAB, Object.assign({}, ...overrides));
}

function pose({
  slab: body = slab(),
  badge = BADGE_CHECK,
  dx = 0,
  dy = 0,
  slabDy = 0,
  leftLeg = [0, 0],
  rightLeg = [0, 0],
  extra = [],
}: Pose): string[] {
  const x = SX + dx;
  const y = SY + dy + slabDy;
  // Legs first so a lifted leg or a crouching slab hides them.
  return compose(SIZE, [
    { art: LEG, x: x + 3 + leftLeg[0], y: SY + 34 + dy + leftLeg[1] },
    { art: LEG, x: x + 11 + rightLeg[0], y: SY + 34 + dy + rightLeg[1] },
    { art: body, x, y },
    { art: badge, x: x + 6, y: y + 3 },
    ...extra,
  ]);
}

const idle = [
  pose({}),
  pose({ slab: slab(LEDS_ALT) }),
  pose({ slab: slab(LEDS_ALT), badge: BADGE_BLINK }),
];

// A ponderous march: each stone leg lifts in turn while the slab rocks up a pixel.
const walk = [
  pose({ leftLeg: [0, -2] }),
  shift(pose({ slab: slab(LEDS_ALT) }), 0, -1),
  pose({ rightLeg: [0, -2], slab: slab(LEDS_ALT) }),
  shift(pose({}), 0, -1),
];

// Asleep: the slab sinks onto its legs, the badge dims, LEDs off.
const sleep = [
  pose({ slab: slab(LEDS_OFF), badge: BADGE_SLEEP, slabDy: 3 }),
  pose({ slab: squashTop(slab(LEDS_OFF), 4), badge: BADGE_SLEEP, slabDy: 3 }),
];

// Working: a laptop on the floor in front; the badge cycles running -> passed -> passed + glow.
const laptop = (art: string[]): Layer => ({ art, x: 31, y: 41 });
const work = [
  pose({ badge: BADGE_RUNNING, slab: slab(LEDS_ON), extra: [laptop(LAPTOP)] }),
  pose({ badge: BADGE_CHECK, slab: slab(LEDS_ALT), extra: [laptop(LAPTOP_TYPING)] }),
  dots(pose({ badge: BADGE_GLOW, slab: slab(LEDS_ON), extra: [laptop(LAPTOP)] }), 'y', [
    [12, 7],
    [36, 5],
    [11, 12],
  ]),
];

const happy = [
  pose({ badge: BADGE_GLOW, slab: slab(LEDS_ON) }),
  shift(pose({ badge: BADGE_GLOW, slab: slab(LEDS_ON) }), 0, -2),
  shift(pose({ badge: BADGE_GLOW, slab: slab(LEDS_ON), leftLeg: [0, 1], rightLeg: [0, 1] }), 0, -4),
];

// Hurt: the badge flips to an amber X ("test failed") as the slab recoils.
const hurtRecoil = pose({ badge: BADGE_FAIL, slab: slab(LEDS_ON), dx: -2 });
const hurt = [
  hurtRecoil,
  recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', k: 'h', l: 'h', a: 'h', g: 'h' }),
];

// Attack: the monolith jumps, slams down into a crouch, and amber cracks race across the floor.
const CRACKS_NEAR: Array<[number, number]> = [
  [34, 46],
  [35, 47],
  [36, 46],
  [37, 45],
  [38, 46],
  [39, 47],
  [12, 46],
  [11, 47],
  [10, 46],
];
const CRACKS_FAR: Array<[number, number]> = [
  ...CRACKS_NEAR,
  [40, 46],
  [41, 45],
  [42, 44],
  [43, 45],
  [44, 46],
  [45, 47],
  [46, 46],
  [9, 45],
  [8, 46],
  [7, 47],
  [6, 46],
];
const attack = [
  shift(pose({ badge: BADGE_GLOW, slab: slab(LEDS_ON) }), 0, -4),
  dots(pose({ slab: slab(LEDS_ON), slabDy: 3 }), 'A', CRACKS_NEAR),
  dots(dots(pose({ slab: slab(LEDS_ON), slabDy: 2 }), 'A', CRACKS_FAR), 'l', [
    [36, 42],
    [39, 41],
    [42, 42],
    [10, 42],
    [7, 41],
  ]),
];

export const MONOLITHOR_ADULT: SpriteDef = {
  id: 'monolithor-adult',
  size: SIZE,
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
