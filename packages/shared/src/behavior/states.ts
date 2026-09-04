import type { Stage } from '../types.ts';

export type PetState =
  | 'egg_idle'
  | 'egg_wobble'
  | 'hatching'
  | 'idle'
  | 'walk'
  | 'sit'
  | 'sleep'
  | 'thinking'
  | 'working'
  | 'success'
  | 'error'
  | 'celebrate'
  | 'dragged'
  | 'shaking'
  | 'falling'
  | 'battle_intro'
  | 'battle_attack'
  | 'battle_hit'
  | 'battle_win'
  | 'battle_lose'
  | 'evolving';

export const PET_STATES: readonly PetState[] = [
  'egg_idle',
  'egg_wobble',
  'hatching',
  'idle',
  'walk',
  'sit',
  'sleep',
  'thinking',
  'working',
  'success',
  'error',
  'celebrate',
  'dragged',
  'shaking',
  'falling',
  'battle_intro',
  'battle_attack',
  'battle_hit',
  'battle_win',
  'battle_lose',
  'evolving',
] as const;

/** Animation clip names; mirrors the clips authored in `packages/sprites`. */
export type AnimName =
  'idle' | 'walk' | 'sleep' | 'work' | 'happy' | 'hurt' | 'attack' | 'wobble' | 'crack';

/** Particle / overlay effects layered on top of the sprite. */
export type FxName = 'zzz' | 'sparkle' | 'sweat' | 'question' | 'heart';

export interface Animation {
  anim: AnimName;
  fx: FxName | null;
}

/** Base states the scheduler cycles through on its own. */
export const BASE_STATES: readonly PetState[] = ['idle', 'walk', 'sit', 'egg_idle', 'egg_wobble'];

/** States in which the pet may hang above the ground line. */
export const AIRBORNE_STATES: readonly PetState[] = ['dragged', 'shaking', 'falling'];

export const BATTLE_STATES: readonly PetState[] = [
  'battle_intro',
  'battle_attack',
  'battle_hit',
  'battle_win',
  'battle_lose',
];

export function isBaseState(state: PetState): boolean {
  return BASE_STATES.includes(state);
}

export function isAirborneState(state: PetState): boolean {
  return AIRBORNE_STATES.includes(state);
}

export function isBattleState(state: PetState): boolean {
  return BATTLE_STATES.includes(state);
}

export function isPetState(value: unknown): value is PetState {
  return typeof value === 'string' && (PET_STATES as readonly string[]).includes(value);
}

const NON_EGG_ANIMATIONS: Record<PetState, Animation> = {
  egg_idle: { anim: 'idle', fx: null },
  egg_wobble: { anim: 'idle', fx: null },
  hatching: { anim: 'idle', fx: 'sparkle' },
  idle: { anim: 'idle', fx: null },
  sit: { anim: 'idle', fx: null },
  walk: { anim: 'walk', fx: null },
  sleep: { anim: 'sleep', fx: 'zzz' },
  thinking: { anim: 'idle', fx: 'question' },
  working: { anim: 'work', fx: null },
  success: { anim: 'happy', fx: 'sparkle' },
  error: { anim: 'hurt', fx: 'sweat' },
  celebrate: { anim: 'happy', fx: 'heart' },
  dragged: { anim: 'hurt', fx: null },
  shaking: { anim: 'hurt', fx: 'sweat' },
  falling: { anim: 'hurt', fx: null },
  battle_intro: { anim: 'idle', fx: null },
  battle_attack: { anim: 'attack', fx: null },
  battle_hit: { anim: 'hurt', fx: null },
  battle_win: { anim: 'happy', fx: 'sparkle' },
  battle_lose: { anim: 'sleep', fx: null },
  evolving: { anim: 'happy', fx: 'sparkle' },
};

/** Egg sprites only have `idle`, `wobble` and `crack` clips, so everything active wobbles. */
const EGG_ANIMATIONS: Record<PetState, Animation> = {
  egg_idle: { anim: 'idle', fx: null },
  egg_wobble: { anim: 'wobble', fx: null },
  hatching: { anim: 'crack', fx: null },
  idle: { anim: 'idle', fx: null },
  sit: { anim: 'idle', fx: null },
  walk: { anim: 'idle', fx: null },
  sleep: { anim: 'idle', fx: 'zzz' },
  thinking: { anim: 'wobble', fx: null },
  working: { anim: 'wobble', fx: null },
  success: { anim: 'wobble', fx: 'sparkle' },
  error: { anim: 'wobble', fx: 'sweat' },
  celebrate: { anim: 'wobble', fx: 'heart' },
  dragged: { anim: 'wobble', fx: null },
  shaking: { anim: 'wobble', fx: 'sweat' },
  falling: { anim: 'wobble', fx: null },
  battle_intro: { anim: 'idle', fx: null },
  battle_attack: { anim: 'wobble', fx: null },
  battle_hit: { anim: 'wobble', fx: null },
  battle_win: { anim: 'wobble', fx: 'sparkle' },
  battle_lose: { anim: 'idle', fx: null },
  evolving: { anim: 'wobble', fx: 'sparkle' },
};

/** Which sprite clip (and optional effect overlay) renders a given state at a given stage. */
export function animationFor(state: PetState, stage: Stage): Animation {
  const table = stage === 'egg' ? EGG_ANIMATIONS : NON_EGG_ANIMATIONS;
  return { ...table[state] };
}
