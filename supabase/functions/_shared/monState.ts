// Builds the client-facing MonState from database rows using the shared game math.
import type { MonState } from './game/api.ts';
import { BATTLE_RULES, statsAtLevel } from './game/battle/battle.ts';
import type { MonLoadout } from './game/game/progression.ts';
import { levelProgress } from './game/game/levels.ts';
import { speciesOf, unlockedMoves } from './game/game/species.ts';
import {
  normalizeTree,
  pointsAvailable,
  sharedPassivePoints,
  treeSpent,
} from './game/game/tree.ts';
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
  const unlockedMoveIds =
    mon.species_id !== null
      ? unlockedMoves(speciesOf(mon.species_id), progress.level).map((m) => m.id)
      : [];

  let cooldownUntil: string | null = null;
  if (mon.last_battle_at) {
    const until = Date.parse(mon.last_battle_at) + BATTLE_RULES.cooldownMs;
    if (until > now.getTime()) cooldownUntil = new Date(until).toISOString();
  }
  const started = today?.battles_started ?? 0;

  // A mon's nation is always its species' nation (species rolled within the player's own nation at
  // hatch), so treeSpent can derive it from species_id without a join to `players` here.
  const nation = mon.species_id !== null ? speciesOf(mon.species_id).nation : null;
  const stored = (mon.loadout ?? {}) as MonLoadout;
  // The stored tree is normalized on read (docs/design/talent-tree.md); legacyReset tells the
  // client to show the "tree was rebuilt" notice.
  const normalized = nation && stored.tree ? normalizeTree(nation, stored.tree) : null;
  const loadout = normalized ? { ...stored, tree: normalized.tree } : stored;
  const spent = nation ? treeSpent(nation, loadout.tree) : { nation: 0, shared: 0 };

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
    winStreak: mon.win_streak,
    loadout,
    unlockedMoveIds,
    treePoints: { spent: spent.nation, available: pointsAvailable(progress.level) },
    sharedPassivePoints: { spent: spent.shared, available: sharedPassivePoints(progress.level) },
    lastRespecAt: mon.last_respec_at,
    ...(normalized?.legacyReset ? { treeLegacyReset: true } : {}),
    battle: {
      cooldownUntil,
      remainingToday: Math.max(0, BATTLE_RULES.challengesPerDay - started),
    },
  };
}
