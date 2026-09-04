/**
 * Small helpers for authoring frames. Art is written as arrays of equal-width strings ("rows");
 * `.` is transparent. Helpers never mutate their input.
 */

export interface Layer {
  art: string[];
  x: number;
  y: number;
}

/** A size x size grid of `.`. */
export function blank(size: number): string[] {
  return Array.from({ length: size }, () => '.'.repeat(size));
}

/** Paints `art` onto `base` at (x, y). `.` pixels in `art` are skipped; out-of-bounds pixels are clipped. */
export function place(base: string[], art: string[], x: number, y: number): string[] {
  const out = base.map((row) => row.split(''));
  for (let j = 0; j < art.length; j++) {
    const target = out[y + j];
    if (!target) continue;
    const row = art[j] ?? '';
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '.' || c === undefined) continue;
      const gx = x + i;
      if (gx < 0 || gx >= target.length) continue;
      target[gx] = c;
    }
  }
  return out.map((row) => row.join(''));
}

/** Composes layers (first = back-most) onto a blank size x size grid. */
export function compose(size: number, layers: Layer[]): string[] {
  let out = blank(size);
  for (const layer of layers) out = place(out, layer.art, layer.x, layer.y);
  return out;
}

/** Shifts art by (dx, dy) inside its own bounds; uncovered cells become `.`. */
export function shift(rows: string[], dx: number, dy: number): string[] {
  const w = rows[0]?.length ?? 0;
  const empty = rows.map(() => '.'.repeat(w));
  return place(empty, rows, dx, dy);
}

/** Mirrors art left-to-right. */
export function flipH(rows: string[]): string[] {
  return rows.map((row) => row.split('').reverse().join(''));
}

/** Builds a symmetric image from its left half: `half` + mirrored `half`. */
export function mirrorH(half: string[]): string[] {
  return half.map((row) => row + row.split('').reverse().join(''));
}

/**
 * "Breathing" squash: rows 0..untilRow-1 move down by one row (row 0 becomes empty, the old row
 * `untilRow` is overwritten). Rows below `untilRow` stay put, so feet do not move.
 */
export function squashTop(rows: string[], untilRow: number): string[] {
  const w = rows[0]?.length ?? 0;
  return rows.map((row, i) => {
    if (i > untilRow) return row;
    if (i === 0) return '.'.repeat(w);
    return rows[i - 1] ?? row;
  });
}

/**
 * Leans the top of the art sideways: each row above `pivotRow` shifts by
 * `dir * floor((pivotRow - row) / step)` pixels. Used for the egg wobble.
 */
export function lean(rows: string[], pivotRow: number, step: number, dir: 1 | -1): string[] {
  const w = rows[0]?.length ?? 0;
  return rows.map((row, i) => {
    if (i >= pivotRow) return row;
    const dx = dir * Math.floor((pivotRow - i) / step);
    return place(['.'.repeat(w)], [row], dx, 0)[0] ?? row;
  });
}

/** Replaces chars according to `map` (chars not in the map are kept). */
export function recolor(rows: string[], map: Record<string, string>): string[] {
  return rows.map((row) =>
    row
      .split('')
      .map((c) => map[c] ?? c)
      .join(''),
  );
}

/** Returns a copy of `rows` with the given rows replaced. */
export function withRows(rows: string[], overrides: Record<number, string>): string[] {
  return rows.map((row, i) => overrides[i] ?? row);
}

/** Paints single pixels of `char` at the given (x, y) positions. */
export function dots(rows: string[], char: string, points: Array<[number, number]>): string[] {
  const out = rows.map((row) => row.split(''));
  for (const [x, y] of points) {
    const row = out[y];
    if (row && x >= 0 && x < row.length) row[x] = char;
  }
  return out.map((row) => row.join(''));
}

/** Joins rows into the single-string frame format used by `AnimDef.frames`. */
export function frame(rows: string[]): string {
  return rows.join('\n');
}

/** Splits a frame string back into rows. */
export function rowsOf(frameStr: string): string[] {
  return frameStr.split('\n');
}
