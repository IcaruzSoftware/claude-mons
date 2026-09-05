/**
 * Pure text-fitting for the battle banner (`PetRenderer.drawBattle`). Given the canvas is a
 * generously-sized but still finite battle arena window (`apps/desktop/src/main/display.ts:battleBounds`),
 * a long banner line ("Pebblet used Bedrock Slam!") can still be wider than the window. Rather than
 * growing the window to fit the text (which would have to be reversed every time the banner text
 * changes, mid-animation), the banner wraps to two lines, then shrinks its font, then as a last
 * resort truncates with an ellipsis — so it is always fully inside the canvas.
 *
 * `measure` is injected (real callers pass a closure over `ctx.measureText`) so this stays pure and
 * unit-testable without a real canvas.
 */

export interface BannerLayout {
  lines: string[];
  fontPx: number;
}

export interface BannerFitOptions {
  baseFontPx: number;
  minFontPx: number;
  /** Font size decrement per shrink step. */
  fontStepPx?: number;
}

export type MeasureText = (text: string, fontPx: number) => number;

/** Splits `text` on a space nearest its midpoint into two roughly-balanced lines, or null if it has no space to split on. */
export function splitTwoLines(text: string): [string, string] | null {
  const words = text.split(' ').filter((w) => w.length > 0);
  if (words.length < 2) return null;
  const total = text.length;
  let bestI = 1;
  let bestDiff = Infinity;
  let acc = 0;
  for (let i = 1; i < words.length; i++) {
    acc += words[i - 1]!.length + 1;
    const diff = Math.abs(acc - total / 2);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestI = i;
    }
  }
  return [words.slice(0, bestI).join(' '), words.slice(bestI).join(' ')];
}

/** Binary-searches the longest prefix of `text` (plus an ellipsis) that fits in `maxWidth` at `fontPx`. */
function truncateToFit(
  text: string,
  maxWidth: number,
  fontPx: number,
  measure: MeasureText,
): string {
  if (measure(text, fontPx) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, mid)}…`;
    if (measure(candidate, fontPx) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? '…' : `${text.slice(0, lo)}…`;
}

/**
 * Fits `text` into `maxWidth` px, preferring (in order): the base font on one line, the base font
 * wrapped to two lines, a shrunk font on one line, a shrunk font wrapped to two lines, and finally
 * a truncated ellipsis at the minimum font — so the result always fits regardless of how long
 * `text` or how narrow `maxWidth` is.
 */
export function fitBanner(
  text: string,
  maxWidth: number,
  opts: BannerFitOptions,
  measure: MeasureText,
): BannerLayout {
  const { baseFontPx, minFontPx, fontStepPx = 1 } = opts;
  const width = Math.max(1, maxWidth);

  if (measure(text, baseFontPx) <= width) return { lines: [text], fontPx: baseFontPx };

  const split = splitTwoLines(text);
  if (split && measure(split[0], baseFontPx) <= width && measure(split[1], baseFontPx) <= width) {
    return { lines: split, fontPx: baseFontPx };
  }

  for (let fontPx = baseFontPx - fontStepPx; fontPx >= minFontPx; fontPx -= fontStepPx) {
    if (measure(text, fontPx) <= width) return { lines: [text], fontPx };
  }

  if (split) {
    for (let fontPx = baseFontPx - fontStepPx; fontPx >= minFontPx; fontPx -= fontStepPx) {
      if (measure(split[0], fontPx) <= width && measure(split[1], fontPx) <= width) {
        return { lines: split, fontPx };
      }
    }
  }

  return { lines: [truncateToFit(text, width, minFontPx, measure)], fontPx: minFontPx };
}

/** Clamps `value` into `[min, max]`; if the range is inverted (max < min) returns their midpoint. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamps the center of a `width`-wide box so the whole box stays inside `[0, containerWidth]`
 * (minus `margin` on each side). Used to keep the banner box, hp bars and damage popups fully
 * inside the battle arena canvas regardless of where the anchor/opponent sprites land.
 */
export function clampCenter(
  center: number,
  width: number,
  containerWidth: number,
  margin = 0,
): number {
  const half = width / 2;
  const lo = margin + half;
  const hi = containerWidth - margin - half;
  return clamp(center, Math.min(lo, hi), Math.max(lo, hi));
}
