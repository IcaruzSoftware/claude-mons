/**
 * Pure helpers for `Leaderboard.tsx`'s podium, kept dependency-free (no Preact import) so they are
 * unit-testable without a component tree.
 */

/** Podium slot order: 2nd (left), 1st (center, tallest), 3rd (right) -- matches the mockup and any
 * physical podium. `top3` is the leaderboard's first 3 rows, already sorted best-first. */
export function podiumOrder<T>(top3: readonly T[]): Array<{ place: 1 | 2 | 3; entry: T }> {
  const out: Array<{ place: 1 | 2 | 3; entry: T }> = [];
  if (top3[1] !== undefined) out.push({ place: 2, entry: top3[1] });
  if (top3[0] !== undefined) out.push({ place: 1, entry: top3[0] });
  if (top3[2] !== undefined) out.push({ place: 3, entry: top3[2] });
  return out;
}
