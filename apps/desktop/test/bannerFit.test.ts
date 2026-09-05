import { describe, expect, it } from 'vitest';
import {
  clamp,
  clampCenter,
  fitBanner,
  splitTwoLines,
  type MeasureText,
} from '../src/renderer/pet/bannerFit.ts';

/** Stand-in for `ctx.measureText(text).width`: proportional to text length and font size. */
const measure: MeasureText = (text, fontPx) => text.length * fontPx * 0.6;

describe('fitBanner', () => {
  it('keeps a short banner on one line at the base font', () => {
    const layout = fitBanner('You win!', 400, { baseFontPx: 18, minFontPx: 10 }, measure);
    expect(layout).toEqual({ lines: ['You win!'], fontPx: 18 });
  });

  it('wraps a long banner to two lines at the base font when that fits', () => {
    const text = 'Pebblet used Bedrock Slam';
    // width chosen so the full line does not fit but each half does
    const maxWidth = measure(text, 18) * 0.6;
    const layout = fitBanner(text, maxWidth, { baseFontPx: 18, minFontPx: 10 }, measure);
    expect(layout.fontPx).toBe(18);
    expect(layout.lines.length).toBe(2);
    for (const line of layout.lines)
      expect(measure(line, layout.fontPx)).toBeLessThanOrEqual(maxWidth);
    // both lines concatenated (with the joining space) reconstruct the original text
    expect(layout.lines.join(' ')).toBe(text);
  });

  it('shrinks the font on one line when it has no space to wrap on', () => {
    const text = 'Supercalifragilisticexpialidocious';
    // wide enough that only the minimum font size (no spaces to wrap on) makes it fit
    const layout = fitBanner(text, 170, { baseFontPx: 18, minFontPx: 8, fontStepPx: 1 }, measure);
    expect(layout.lines).toEqual([text]);
    expect(layout.fontPx).toBeLessThan(18);
    expect(layout.fontPx).toBeGreaterThanOrEqual(8);
    expect(measure(text, layout.fontPx)).toBeLessThanOrEqual(170);
  });

  it('truncates with an ellipsis as a last resort so it always fits', () => {
    const text = 'A'.repeat(200);
    const layout = fitBanner(text, 50, { baseFontPx: 18, minFontPx: 8 }, measure);
    expect(layout.fontPx).toBe(8);
    expect(layout.lines.length).toBe(1);
    expect(layout.lines[0]!.endsWith('…')).toBe(true);
    expect(measure(layout.lines[0]!, 8)).toBeLessThanOrEqual(50);
  });

  it('never returns a layout wider than maxWidth, across a range of lengths', () => {
    for (let len = 1; len <= 60; len += 7) {
      const text = 'word '.repeat(Math.max(1, Math.floor(len / 5))).trim() + 'x'.repeat(len % 5);
      const layout = fitBanner(text, 90, { baseFontPx: 16, minFontPx: 8 }, measure);
      for (const line of layout.lines) {
        expect(measure(line, layout.fontPx)).toBeLessThanOrEqual(90);
      }
    }
  });
});

describe('splitTwoLines', () => {
  it('splits near the middle on a space', () => {
    expect(splitTwoLines('one two three four')).toEqual(['one two', 'three four']);
  });

  it('returns null for a single word (nothing to split on)', () => {
    expect(splitTwoLines('supercalifragilistic')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(splitTwoLines('')).toBeNull();
  });
});

describe('clamp / clampCenter', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it('falls back to the midpoint when the range is inverted', () => {
    expect(clamp(5, 10, 0)).toBe(5);
  });

  it('keeps a centered box fully inside the container when it already fits', () => {
    expect(clampCenter(50, 20, 200)).toBe(50);
  });

  it('pulls a box back inside the container when its center is too close to an edge', () => {
    expect(clampCenter(5, 40, 200)).toBe(20);
    expect(clampCenter(195, 40, 200)).toBe(180);
  });

  it('respects a margin', () => {
    expect(clampCenter(5, 20, 200, 10)).toBe(20);
  });

  it('still pulls extreme centers toward the container when the box itself is wider than it', () => {
    // box (500) wider than container (200): there is no position with zero overflow on both
    // sides, but a wildly off-container center is still pulled back toward it rather than left
    // free to drift arbitrarily far off-screen.
    expect(clampCenter(10_000, 500, 200, 10)).toBeLessThan(10_000);
    expect(clampCenter(-10_000, 500, 200, 10)).toBeGreaterThan(-10_000);
  });
});
