import type { SpriteDef } from '../types.ts';
import { compose, dots, frame, recolor, squashTop, withRows, type Layer } from '../util.ts';

/**
 * Stratosphinx (Air, rare, adult): a cat-sphinx, 48 grid, seen from the side facing right. It
 * sits upright on a small stratosphere cloud with its front paws together, a lavender scarf
 * around the neck streaming back over its shoulders, and a tail curling up behind. The cloud
 * hovers a pixel above the ground. Attack = a pounce off the cloud.
 */
const PALETTE = {
  D: '#2b3550', // outline (tintable dark)
  P: '#4fc3f7', // sky blue coat (tintable primary)
  S: '#f5f7ff', // muzzle, chest, paws, cloud (tintable secondary)
  A: '#b39ddb', // lavender scarf, ear insides, tail tip (tintable accent)
  v: '#8b74c2', // scarf shade
  b: '#cfe3f7', // cloud shade
  a: '#b39ddb88', // translucent streamer end
  h: '#ffffff', // eye glint, flash
  y: '#fff176', // sparks
  g: '#9e9e9e', // laptop body
  l: '#b3e5fc', // laptop screen
};

const SIZE = 48;
const BX = 5; // body: 40 px wide, cols 5..44
const BY = 8; // body: 33 px tall, rows 8..40; cloud rows 40..46

// 40 x 33 body: ears, head and muzzle on top right, seated torso, front legs and paws.
const BODY = [
  '........................D.......D.......',
  '.......................DAD.....DAD......',
  '.......................DAAD...DAAD......',
  '......................DPAADDDDDAAPD.....',
  '.....................DPPPPPPPPPPPPPD....',
  '.....................DPPPPPPPPPPPPPPD...',
  '....................DPPPPDDPPPPPDDPPD...',
  '....................DPPPPDhPPPPPDhPPPD..',
  '....................DPPPPDDPPPPPDDPPPD..',
  '....................DPPPSSSSSSSSSSSPPD..',
  '.....................DPPSSSSSSSSDDSSPD..',
  '.....................DPPSSSSSSSDSSDSPD..',
  '......................DPPSSSSSSSDDSSPPD.',
  '.......................DDPPSSSSSSSSPPD..',
  '..........DDDDDDDDD......DDPPPPPPPPDD...',
  '.........DPPPPPPPPPDDDDDDDPPPPPPPPPPD...',
  '........DPPPPPPPPPPPPPPPPPPPPPPPPPPPPD..',
  '.......DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPD.',
  '......DPPPPPPPPPPPPPPPPPPPPPPPPPPPPSSSPD',
  '.....DPPPPPPPPPPPPPPPPPPPPPPPPPPPPSSSSSD',
  '....DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPSSSSSD',
  '....DPPPPPPPPPPPPPPPPPPPPPPPPPPPPPSSSSSD',
  '....DPPPPPPPPPPPPPPPPPPPPPPPPPPPPSSSSSSD',
  '....DPPPPPPPPPPPPPPPPPPPPPPPPPPPSSSSSSSD',
  '....DPPPPPPPPPPPPPPPPPPPPPPPPPPSSSSSSSSD',
  '....DPPPPPPPPPPPPPPPPPPPPPPPPPSSSSSSSSPD',
  '....DPPPPPPPPPPPPPPPPPPPPPPPPPPSSSSSSPPD',
  '....DPPPPPPPPPPPPPPPPPPPPPPPPPPPSSSSPPPD',
  '.....DPPPPPPPPPPPPPPPPPPPPPPPPPPPPDPPPPD',
  '......DPPPPPPPPPPPPPPPPPPPPPPPPPPDPPPPPD',
  '.......DPPPPPPPPPPPPPPPPPPPPPPPPDPPPPPPD',
  '........DDDDDDDDDDDDDDDDDDDDDDDDPSSSSSSD',
  '................................DDDDDDDD',
];

const EYES_CLOSED: Record<number, string> = {
  6: '....................DPPPPPPPPPPPPPPPD...',
  7: '....................DPPPPDDPPPPPDDPPPD..',
  8: '....................DPPPPPPPPPPPPPPPPD..',
};
const EYES_HAPPY: Record<number, string> = {
  6: '....................DPPPPDDPPPPPDDPPD...',
  7: '....................DPPPPPPPPPPPPPPPPD..',
  8: '....................DPPPPPPPPPPPPPPPPD..',
};
const EYES_NARROW: Record<number, string> = {
  6: '....................DPPPPPPPPPPPPPPPD...',
  7: '....................DPPPPDDPPPPPDDPPPD..',
  8: '....................DPPPPDhPPPPPDhPPPD..',
};
const MOUTH_OPEN: Record<number, string> = {
  11: '.....................DPPSSSSSSSDDDDSPD..',
  12: '......................DPPSSSSSSSDDSSPPD.',
};

function body(...overrides: Array<Record<number, string>>): string[] {
  return withRows(BODY, Object.assign({}, ...overrides));
}

// Tail, 8 x 9, drawn behind the body at (BX - 3, BY + 13): rises from the rump and curls.
const TAIL_A = [
  '..DDDD..',
  '.DAAAAD.',
  '.DAADAD.',
  '.DADDPD.',
  '.DDPPPD.',
  '...DPPD.',
  '...DPPD.',
  '...DPPPD',
  '....DPPD',
];
const TAIL_B = withRows(TAIL_A, {
  0: '...DDDD.',
  1: '..DAAAAD',
  2: '.DDAADAD',
  3: '.DADDDPD',
});

// Scarf: a band around the neck and a streamer trailing back over the shoulders.
const BAND = ['DAAAAAAAAAAAAD', 'DAvAAAAAAAAvAD', '.DvvvvvvvvvvD.'];
const STREAMER_A = ['.aa...........', '...AAA........', '......AAAA....', '.........AAAAA'];
const STREAMER_B = ['..............', 'aa.AAA........', '..A...AAAA....', '.........AAAAA'];
const STREAMER_DOWN = ['..............', '..............', '..........AAAA', '.....aaAAAvvvv'];

// Cloud the sphinx sits on, 34 x 7, at (7, 40).
const CLOUD = [
  '....DDDD.....DDDDD......DDDDD.....',
  '..DDSSSSDDDDDSSSSSDDDDDDSSSSSDDD..',
  '.DSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSD',
  'DSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSD',
  'DbSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSbD',
  '.DbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbD.',
  '..DDDDDDDDDDDDDDDDDDDDDDDDDDDDDD..',
];
const CLOUD_B = withRows(CLOUD, {
  0: '.......DDDD......DDDDD.....DDDD...',
  1: '..DDDDDSSSSDDDDDDSSSSSDDDDDSSSSDD.',
});

const LAPTOP = [
  '.DDDDDDDDDDDD.',
  '.DllllllllllD.',
  '.DllllllllllD.',
  '.DllllllllllD.',
  '.DDDDDDDDDDDD.',
  'DggggggggggggD',
  'DDDDDDDDDDDDDD',
];
const LAPTOP_TYPING = withRows(LAPTOP, { 5: 'DghgghgghgghgD' });

interface Pose {
  body?: string[];
  tail?: string[];
  streamer?: string[];
  cloud?: string[] | null;
  /** Offset of the sphinx (the cloud stays put unless `cloudDy` is given). */
  dx?: number;
  dy?: number;
  cloudDy?: number;
  extra?: Layer[];
}

function pose({
  body: art = BODY,
  tail = TAIL_A,
  streamer = STREAMER_A,
  cloud = CLOUD,
  dx = 0,
  dy = 0,
  cloudDy = 0,
  extra = [],
}: Pose): string[] {
  const x = BX + dx;
  const y = BY + dy;
  const layers: Layer[] = [];
  if (cloud) layers.push({ art: cloud, x: 7, y: 40 + cloudDy });
  layers.push(
    { art: tail, x: x - 3, y: y + 13 },
    { art: streamer, x: x + 9, y: y + 9 },
    { art, x, y },
    { art: BAND, x: x + 23, y: y + 13 },
    ...extra,
  );
  return compose(SIZE, layers);
}

const idle = [
  pose({}),
  pose({ streamer: STREAMER_B, tail: TAIL_B }),
  pose({ streamer: STREAMER_B, body: body(EYES_CLOSED) }),
];

// Drifting on the cloud: everything bobs, the streamer waves and the tail swishes.
const walk = [
  pose({}),
  pose({ dy: -1, cloudDy: -1, streamer: STREAMER_B, cloud: CLOUD_B }),
  pose({ dy: -2, cloudDy: -2, tail: TAIL_B }),
  pose({ dy: -1, cloudDy: -1, streamer: STREAMER_B, tail: TAIL_B, cloud: CLOUD_B }),
];

// Asleep: head sinks, eyes closed, scarf hangs down.
const sleepBody = squashTop(body(EYES_CLOSED), 14);
const sleep = [
  pose({ body: sleepBody, streamer: STREAMER_DOWN }),
  pose({ body: squashTop(sleepBody, 14), streamer: STREAMER_DOWN, tail: TAIL_B }),
];

// Working: a laptop rests on the front paws.
const laptop = (art: string[]): Layer => ({ art, x: 33, y: 34 });
const work = [
  pose({ extra: [laptop(LAPTOP)] }),
  pose({ body: squashTop(BODY, 14), streamer: STREAMER_B, extra: [laptop(LAPTOP_TYPING)] }),
  dots(pose({ extra: [laptop(LAPTOP)] }), 'y', [
    [22, 6],
    [44, 4],
  ]),
];

const happyBody = body(EYES_HAPPY, MOUTH_OPEN);
const happy = [
  pose({ body: squashTop(happyBody, 14), streamer: STREAMER_B }),
  pose({ body: happyBody, dy: -2 }),
  pose({ body: happyBody, dy: -4, tail: TAIL_B, streamer: STREAMER_B }),
];

const hurtRecoil = pose({ body: body(EYES_CLOSED), dx: -2, streamer: STREAMER_DOWN });
const hurt = [hurtRecoil, recolor(hurtRecoil, { P: 'h', S: 'h', A: 'h', v: 'h', b: 'h', a: 'h' })];

// Attack: crouches, pounces off the cloud with the streamer trailing, lands in a gust.
const attack = [
  pose({ body: squashTop(body(EYES_NARROW), 14), dx: -2, tail: TAIL_B }),
  pose({ body: body(EYES_NARROW), dx: 3, dy: -5, streamer: STREAMER_B, cloud: CLOUD_B }),
  dots(pose({ body: body(EYES_NARROW, MOUTH_OPEN), dx: 3, dy: -1, tail: TAIL_B }), 'A', [
    [46, 28],
    [47, 32],
    [46, 36],
    [47, 24],
  ]),
];

export const STRATOSPHINX_ADULT: SpriteDef = {
  id: 'stratosphinx-adult',
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
