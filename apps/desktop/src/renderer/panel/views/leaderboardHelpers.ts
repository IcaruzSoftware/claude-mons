/**
 * Pure helpers for `Leaderboard.tsx`'s podium and nation standings, kept dependency-free (no Preact
 * import) so they are unit-testable without a component tree.
 */

import type { LeaderboardNationRow } from '@claude-mons/shared';

/** WEEK / ALL-TIME switch scope; drives both the nation tiles and the trainer list. */
export type Scope = 'alltime' | 'weekly';

/** The XP and battle tallies a nation tile shows for the selected scope. All-time battle counts are
 * optional on the wire (an older server lacks the columns); missing counts are treated as 0. */
export function nationStanding(
  row: LeaderboardNationRow,
  scope: Scope,
): { xp: number; won: number; lost: number } {
  return scope === 'weekly'
    ? { xp: row.weekly_xp, won: row.weekly_battles_won, lost: row.weekly_battles_lost }
    : { xp: row.total_xp, won: row.battles_won ?? 0, lost: row.battles_lost ?? 0 };
}

/** Sort nations by the selected scope's XP descending, tie-breaking by the other scope's XP. */
export function sortNations<T extends LeaderboardNationRow>(rows: readonly T[], scope: Scope): T[] {
  const primary = (r: LeaderboardNationRow) => (scope === 'weekly' ? r.weekly_xp : r.total_xp);
  const secondary = (r: LeaderboardNationRow) => (scope === 'weekly' ? r.total_xp : r.weekly_xp);
  return [...rows].sort((a, b) => primary(b) - primary(a) || secondary(b) - secondary(a));
}

/** Podium slot order: 2nd (left), 1st (center, tallest), 3rd (right) -- matches the mockup and any
 * physical podium. `top3` is the leaderboard's first 3 rows, already sorted best-first. */
export function podiumOrder<T>(top3: readonly T[]): Array<{ place: 1 | 2 | 3; entry: T }> {
  const out: Array<{ place: 1 | 2 | 3; entry: T }> = [];
  if (top3[1] !== undefined) out.push({ place: 2, entry: top3[1] });
  if (top3[0] !== undefined) out.push({ place: 1, entry: top3[0] });
  if (top3[2] !== undefined) out.push({ place: 3, entry: top3[2] });
  return out;
}
