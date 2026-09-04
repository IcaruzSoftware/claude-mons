/**
 * Pure shake detector (docs/DESIGN.md section 2).
 *
 * Feed it `(t, x, y)` pointer samples while the pet is being dragged. It keeps a sliding window,
 * derives per-segment velocities, picks the dominant axis and counts velocity sign reversals
 * where both neighbouring fast segments exceed `minSpeed`.
 */

export interface ShakeConfig {
  /** Sliding window length in ms. */
  windowMs: number;
  /** A segment counts as "fast" at or above this speed (DIP/s). */
  minSpeed: number;
  /** Reversals needed for a `shake` verdict. */
  minReversals: number;
  /** Total travel on the dominant axis needed for a `shake` verdict (DIP). */
  minTravel: number;
  /** No second `shake` for this long after one fired. */
  cooldownMs: number;
}

export const DEFAULT_SHAKE_CONFIG: ShakeConfig = {
  windowMs: 1000,
  minSpeed: 900,
  minReversals: 4,
  minTravel: 250,
  cooldownMs: 3000,
};

export interface ShakeSample {
  t: number;
  x: number;
  y: number;
}

export interface ShakeDetectorState {
  samples: ShakeSample[];
  cooldownUntil: number;
}

export type ShakeVerdict = 'none' | 'shaking' | 'shake';

/** Segments shorter than this are dropped (duplicate / coalesced pointer events). */
const MIN_SEGMENT_MS = 4;

export function createShakeState(): ShakeDetectorState {
  return { samples: [], cooldownUntil: 0 };
}

export function resetShake(state: ShakeDetectorState): ShakeDetectorState {
  return { samples: [], cooldownUntil: state.cooldownUntil };
}

export function pushShakeSample(
  state: ShakeDetectorState,
  sample: ShakeSample,
  cfg: ShakeConfig = DEFAULT_SHAKE_CONFIG,
): { state: ShakeDetectorState; verdict: ShakeVerdict } {
  const now = sample.t;
  const cutoff = now - cfg.windowMs;
  const samples = state.samples.filter((s) => s.t >= cutoff && s.t <= now);
  samples.push(sample);

  const { reversals, travel } = analyse(samples, cfg.minSpeed);

  if (reversals >= cfg.minReversals && travel >= cfg.minTravel && now >= state.cooldownUntil) {
    return {
      state: { samples: [], cooldownUntil: now + cfg.cooldownMs },
      verdict: 'shake',
    };
  }
  return {
    state: { samples, cooldownUntil: state.cooldownUntil },
    verdict: reversals >= 2 ? 'shaking' : 'none',
  };
}

interface Segment {
  vx: number;
  vy: number;
  dx: number;
  dy: number;
}

function analyse(samples: readonly ShakeSample[], minSpeed: number) {
  const segments: Segment[] = [];
  let sumVx = 0;
  let sumVy = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const dtMs = b.t - a.t;
    if (dtMs < MIN_SEGMENT_MS) continue;
    const dt = dtMs / 1000;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const seg = { vx: dx / dt, vy: dy / dt, dx, dy };
    segments.push(seg);
    sumVx += Math.abs(seg.vx);
    sumVy += Math.abs(seg.vy);
  }

  const horizontal = sumVx >= sumVy;
  let reversals = 0;
  let travel = 0;
  let lastFastSign = 0;
  for (const seg of segments) {
    const v = horizontal ? seg.vx : seg.vy;
    travel += Math.abs(horizontal ? seg.dx : seg.dy);
    if (Math.abs(v) < minSpeed) continue;
    const sign = v > 0 ? 1 : -1;
    if (lastFastSign !== 0 && sign !== lastFastSign) reversals++;
    lastFastSign = sign;
  }
  return { reversals, travel };
}
