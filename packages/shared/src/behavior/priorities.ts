import type { PetState } from './states.ts';

/** Higher replaces lower; expiry and decay may always lower. See docs/design/behavior-engine.md. */
export const PRIORITY: Record<PetState, number> = {
  evolving: 100,
  hatching: 100,
  battle_intro: 90,
  battle_attack: 90,
  battle_hit: 90,
  battle_win: 90,
  battle_lose: 90,
  dragged: 80,
  shaking: 80,
  falling: 80,
  celebrate: 60,
  success: 50,
  error: 50,
  working: 40,
  thinking: 35,
  walk: 20,
  sit: 20,
  idle: 10,
  egg_idle: 10,
  egg_wobble: 10,
  sleep: 5,
};

/** Fixed and ranged durations in milliseconds. */
export const DURATIONS = {
  CELEBRATE: 3000,
  SUCCESS: 2000,
  ERROR: 2000,
  HATCHING: 3000,
  EVOLVING: 4000,
  /** `working` with no tools in flight for this long decays to `thinking`. */
  WORKING_DECAY: 400,
  /** `thinking` with no mid-turn sessions and no events for this long decays to `idle`. */
  THINKING_DECAY: 8000,
  /** Base states fall asleep after this long without hook events or input (10 min). */
  SLEEP_AFTER: 600000,
  WALK_MIN: 2000,
  WALK_MAX: 6000,
  IDLE_MIN: 1000,
  IDLE_MAX: 4000,
  SIT_MIN: 3000,
  SIT_MAX: 8000,
  /** A single egg wobble. */
  EGG_WOBBLE: 1200,
  /** `shaking` without further shake progress falls back to `dragged`. */
  SHAKING: 1000,
} as const;

/** Chance rolls used by the base-state scheduler. */
export const SCHEDULE = {
  IDLE_TO_WALK: 0.55,
  IDLE_TO_SIT: 0.2,
  EGG_WOBBLE: 0.1,
} as const;

/**
 * Lower-priority targets a state may still move to via a stimulus because they are the natural
 * decay of that state (e.g. `hook:tool_end` moving `working` to `thinking`).
 */
export const DECAY_TARGET: Partial<Record<PetState, PetState>> = {
  working: 'thinking',
  thinking: 'idle',
};
