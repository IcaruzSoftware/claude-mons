import { MAX_LEVEL } from '../game/levels.ts';
import type { Nation } from '../types.ts';

/** Rotate to a wild encounter when the only available human has the last-seen element. */
export function useWildForElementVariety(candidate: Nation, previous?: Nation | null): boolean {
  return candidate === previous;
}

/** Prefer peers, then nearby opponents, then the remaining bounded pool. */
export const MATCHMAKING_WINDOWS = [
  { min: 0, max: 0 },
  { min: -1, max: 1 },
  { min: -3, max: 3 },
] as const;

/** Inject a uniform roll: 75% weaker (-1: 40%, -2: 30%, -3: 5%), 15% peers, 10% elites (+1 to +3). */
export function wildEncounterLevel(
  level: number,
  roll: number,
): { level: number; isElite: boolean } {
  const isElite = roll < 0.1;
  const delta = isElite
    ? 1 + Math.floor(roll * 30)
    : roll < 0.25
      ? 0
      : roll < 0.65
        ? -1
        : roll < 0.95
          ? -2
          : -3;
  return { level: Math.max(2, Math.min(MAX_LEVEL, level + delta)), isElite };
}
