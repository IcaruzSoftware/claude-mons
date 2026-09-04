// Builds the client-facing MonState from database rows using the shared game math.
import type { MonState } from './game/api.ts';
import { BATTLE_RULES, statsAtLevel } from './game/battle/battle.ts';
import { levelProgress } from './game/game/levels.ts';
import { speciesOf } from './game/game/species.ts';
import type { MonRow, XpDailyRow } from './db.ts';

export function buildMonState(
  mon: MonRow,
  today: Pick<XpDailyRow, 'battles_started'> | null,
  streakDays: number,
  now: Date = new Date(),
): MonState {
  const progress = levelProgress(mon.total_xp);
  const stats =
    mon.species_id !== null
      ? statsAtLevel(speciesOf(mon.species_id).baseStats, progress.level)
      : {};

  let cooldownUntil: string | null = null;
  if (mon.last_battle_at) {
    const until = Date.parse(mon.last_battle_at) + BATTLE_RULES.cooldownMs;
    if (until > now.getTime()) cooldownUntil = new Date(until).toISOString();
  }
  const started = today?.battles_started ?? 0;

  return {
    id: mon.id,
    speciesId: mon.species_id,
    stage: mon.stage,
    level: progress.level,
    totalXp: mon.total_xp,
    xpIntoLevel: progress.xpIntoLevel,
    xpToNext: progress.xpToNext,
    stats,
    streakDays,
    battle: {
      cooldownUntil,
      remainingToday: Math.max(0, BATTLE_RULES.challengesPerDay - started),
    },
  };
}
