import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHAKE_CONFIG,
  createShakeState,
  pushShakeSample,
  resetShake,
  type ShakeDetectorState,
  type ShakeSample,
  type ShakeVerdict,
} from '../src/index.ts';

const FRAME = 1000 / 60;

interface Trace {
  verdicts: { t: number; verdict: ShakeVerdict }[];
  state: ShakeDetectorState;
}

function feed(samples: ShakeSample[], state = createShakeState()): Trace {
  const verdicts: Trace['verdicts'] = [];
  let s = state;
  for (const sample of samples) {
    const res = pushShakeSample(s, sample);
    s = res.state;
    verdicts.push({ t: sample.t, verdict: res.verdict });
  }
  return { verdicts, state: s };
}

function sine(opts: {
  hz: number;
  amplitude: number;
  durationMs: number;
  axis: 'x' | 'y';
  startMs?: number;
  sampleMs?: number;
}): ShakeSample[] {
  const out: ShakeSample[] = [];
  const start = opts.startMs ?? 0;
  const step = opts.sampleMs ?? FRAME;
  for (let t = start; t <= start + opts.durationMs; t += step) {
    const d = opts.amplitude * Math.sin(2 * Math.PI * opts.hz * ((t - start) / 1000));
    out.push({ t, x: opts.axis === 'x' ? 400 + d : 400, y: opts.axis === 'y' ? 300 + d : 300 });
  }
  return out;
}

const shakes = (trace: Trace) => trace.verdicts.filter((v) => v.verdict === 'shake');

describe('shake detector', () => {
  it('detects a 6 Hz horizontal shake within ~1 s, once per cooldown', () => {
    const trace = feed(sine({ hz: 6, amplitude: 120, durationMs: 2500, axis: 'x' }));
    const fired = shakes(trace);
    expect(fired.length).toBe(1);
    expect(fired[0]!.t).toBeLessThanOrEqual(1000);
    // Some visual feedback precedes the verdict.
    expect(trace.verdicts.some((v) => v.verdict === 'shaking' && v.t < fired[0]!.t)).toBe(true);
    expect(trace.state.cooldownUntil).toBe(fired[0]!.t + DEFAULT_SHAKE_CONFIG.cooldownMs);
  });

  it('fires again after the cooldown while shaking continues', () => {
    const trace = feed(sine({ hz: 6, amplitude: 120, durationMs: 8000, axis: 'x' }));
    const fired = shakes(trace);
    expect(fired.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < fired.length; i++) {
      expect(fired[i]!.t - fired[i - 1]!.t).toBeGreaterThanOrEqual(DEFAULT_SHAKE_CONFIG.cooldownMs);
    }
  });

  it('ignores a slow drag across 1000 px in 2 s', () => {
    const samples: ShakeSample[] = [];
    for (let t = 0; t <= 2000; t += FRAME) samples.push({ t, x: t / 2, y: 300 });
    const trace = feed(samples);
    expect(trace.verdicts.every((v) => v.verdict === 'none')).toBe(true);
  });

  it('ignores +-1 px jitter at 60 Hz', () => {
    const samples: ShakeSample[] = [];
    let i = 0;
    for (let t = 0; t <= 3000; t += FRAME, i++) {
      samples.push({ t, x: 400 + (i % 2 === 0 ? 1 : -1), y: 300 + (i % 3 === 0 ? 1 : -1) });
    }
    const trace = feed(samples);
    expect(trace.verdicts.every((v) => v.verdict === 'none')).toBe(true);
  });

  it('two fast reversals followed by a stop reach at most shaking', () => {
    // Right, left, right at ~2400 px/s (40 px per frame), then hold still.
    const samples: ShakeSample[] = [];
    let x = 400;
    let t = 0;
    const leg = (dir: number) => {
      for (let k = 0; k < 4; k++) {
        t += FRAME;
        x += dir * 40;
        samples.push({ t, x, y: 300 });
      }
    };
    samples.push({ t, x, y: 300 });
    leg(1);
    leg(-1);
    leg(1);
    for (let k = 0; k < 60; k++) {
      t += FRAME;
      samples.push({ t, x, y: 300 });
    }
    const trace = feed(samples);
    expect(shakes(trace)).toHaveLength(0);
    expect(trace.verdicts.some((v) => v.verdict === 'shaking')).toBe(true);
    expect(trace.verdicts.at(-1)!.verdict).toBe('none');
  });

  it('detects vertical shakes too', () => {
    const trace = feed(sine({ hz: 6, amplitude: 120, durationMs: 2000, axis: 'y' }));
    expect(shakes(trace)).toHaveLength(1);
  });

  it('honours the cooldown across separate bursts', () => {
    const first = feed(sine({ hz: 6, amplitude: 120, durationMs: 1000, axis: 'x' }));
    expect(shakes(first)).toHaveLength(1);
    const firedAt = shakes(first)[0]!.t;

    // A second burst inside the cooldown window is ignored...
    const second = feed(
      sine({ hz: 6, amplitude: 120, durationMs: 1000, axis: 'x', startMs: firedAt + 500 }),
      first.state,
    );
    expect(shakes(second)).toHaveLength(0);

    // ...but a burst after it fires again.
    const third = feed(
      sine({
        hz: 6,
        amplitude: 120,
        durationMs: 1000,
        axis: 'x',
        startMs: firedAt + DEFAULT_SHAKE_CONFIG.cooldownMs + 10,
      }),
      resetShake(second.state),
    );
    expect(shakes(third)).toHaveLength(1);
  });

  it('resetShake drops samples but keeps the cooldown', () => {
    const first = feed(sine({ hz: 6, amplitude: 120, durationMs: 1000, axis: 'x' }));
    const reset = resetShake({ ...first.state, samples: [{ t: 1, x: 0, y: 0 }] });
    expect(reset.samples).toEqual([]);
    expect(reset.cooldownUntil).toBe(first.state.cooldownUntil);
  });
});
