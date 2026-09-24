import { MAX_LEVEL } from '../game/levels.ts';

/** Prefer easier matches, then peers, then a bounded challenge. */
export const MATCHMAKING_WINDOWS = [
  { min: -3, max: -1 },
  { min: 0, max: 0 },
  { min: 1, max: 3 },
] as const;

/** Inject a uniform roll: 90% lower-level wild mons, 10% elite challenges (+3). */
export function wildEncounterLevel(
  level: number,
  roll: number,
): { level: number; isElite: boolean } {
  const isElite = roll < 0.1;
  const delta = isElite ? 3 : -1 - Math.min(2, Math.floor((roll - 0.1) / 0.3));
  return { level: Math.max(2, Math.min(MAX_LEVEL, level + delta)), isElite };
}
