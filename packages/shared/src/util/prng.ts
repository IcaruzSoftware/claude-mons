/**
 * Seeded pseudo-random numbers (mulberry32).
 *
 * The state is a plain 32-bit unsigned integer so it can live inside a JSON-serialisable model.
 * Prefer the pure `nextRandom(state)` form in reducers; `createPrng` is a convenience wrapper for
 * imperative call sites.
 */

/** Advance the generator once. Returns `[value in [0, 1), nextState]`. */
export function nextRandom(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Uniform float in `[min, max)`. */
export function randomBetween(state: number, min: number, max: number): [number, number] {
  const [value, next] = nextRandom(state);
  return [min + value * (max - min), next];
}

/** Uniform integer in `[min, max]` (inclusive). */
export function randomInt(state: number, min: number, max: number): [number, number] {
  const [value, next] = nextRandom(state);
  return [min + Math.floor(value * (max - min + 1)), next];
}

/** Normalise any number into a valid 32-bit seed. */
export function seedFrom(seed: number): number {
  return Number.isFinite(seed) ? seed >>> 0 : 0;
}

export interface Prng {
  /** Current generator state; safe to persist and pass to `nextRandom`. */
  state: number;
  /** Next float in `[0, 1)`; advances `state`. */
  next(): number;
}

export function createPrng(seed: number): Prng {
  const prng: Prng = {
    state: seedFrom(seed),
    next() {
      const [value, next] = nextRandom(prng.state);
      prng.state = next;
      return value;
    },
  };
  return prng;
}
