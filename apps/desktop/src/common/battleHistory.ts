import type { BattleSummary } from './ipc.ts';

/** Keep locally resolved fights while reconciling server history; timestamps belong to battles. */
export function mergeBattleHistory(...histories: BattleSummary[][]): BattleSummary[] {
  const unique = new Map<string, BattleSummary>();
  for (const history of histories) for (const battle of history) unique.set(battle.id, battle);
  return [...unique.values()].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, 50);
}
