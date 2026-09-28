import { MAX_LEVEL } from '../game/levels.ts';

/** Prefer easier matches, then peers, then a bounded challenge. */
export const MATCHMAKING_WINDOWS = [
  { min: -3, max: -2 },
  { min: -1, max: -1 },
  { min: 0, max: 0 },
  { min: 1, max: 3 },
] as const;

/** Inject a uniform roll: 90% weaker wild mons (-3: 60%, -2: 25%, -1: 5%); 10% challenges (+1 to +3). */
export function wildEncounterLevel(
  level: number,
  roll: number,
): { level: number; isElite: boolean } {
  const isElite = roll < 0.1;
  const delta = isElite ? 1 + Math.floor(roll * 30) : roll < 0.15 ? -1 : roll < 0.4 ? -2 : -3;
  return { level: Math.max(2, Math.min(MAX_LEVEL, level + delta)), isElite };
}
