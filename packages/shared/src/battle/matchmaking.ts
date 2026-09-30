import { MAX_LEVEL } from '../game/levels.ts';
import type { Nation } from '../types.ts';

/** Rotate to a wild encounter when the only available human has the last-seen element. */
export function useWildForElementVariety(candidate: Nation, previous?: Nation | null): boolean {
  return candidate === previous;
}

/** Common human-opponent windows; +4/+5 are only searched on their rare rolls. */
export const MATCHMAKING_WINDOWS = [
  { min: -3, max: -2 },
  { min: -1, max: 0 },
  { min: 1, max: 2 },
  { min: 3, max: 3 },
] as const;

/** Roll a preferred human matchup, then try common windows before falling back to wild. */
export function matchmakingWindowsForRoll(roll: number): Array<{ min: number; max: number }> {
  if (roll >= 0.99) return [{ min: 5, max: 5 }, ...MATCHMAKING_WINDOWS];
  if (roll >= 0.97) return [{ min: 4, max: 4 }, ...MATCHMAKING_WINDOWS];
  const preferred = roll < 0.25 ? 0 : roll < 0.55 ? 1 : roll < 0.9 ? 2 : 3;
  return [
    MATCHMAKING_WINDOWS[preferred]!,
    ...MATCHMAKING_WINDOWS.filter((_, i) => i !== preferred),
  ];
}

/** 55% weaker, 20% peer, 25% stronger; +4/+5 occur only 1.5%/0.5% of the time. */
export function wildEncounterLevel(
  level: number,
  roll: number,
): { level: number; isElite: boolean } {
  const delta =
    roll < 0.18
      ? -3
      : roll < 0.38
        ? -2
        : roll < 0.55
          ? -1
          : roll < 0.75
            ? 0
            : roll < 0.87
              ? 1
              : roll < 0.94
                ? 2
                : roll < 0.98
                  ? 3
                  : roll < 0.995
                    ? 4
                    : 5;
  const isElite = delta >= 3;
  return { level: Math.max(2, Math.min(MAX_LEVEL, level + delta)), isElite };
}
