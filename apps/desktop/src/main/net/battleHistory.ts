import type { MonSnapshot } from '@claude-mons/shared';
import type { BattleSummary } from '../../common/ipc.ts';
import type { SupabaseClient } from './SupabaseClient.ts';

export interface BattleHistoryRow {
  id: string;
  created_at: string;
  challenger_id: string | null;
  opponent_id: string | null;
  challenger_snapshot: MonSnapshot;
  opponent_snapshot: MonSnapshot;
  winner: 'a' | 'b';
  reason: BattleSummary['reason'];
  log: { turns: unknown[] };
  challenger_xp: number;
  opponent_xp: number;
}

export function summarizeBattle(row: BattleHistoryRow, userId: string): BattleSummary {
  const challenger = row.challenger_id === userId;
  const me = challenger ? row.challenger_snapshot : row.opponent_snapshot;
  const opponent = challenger ? row.opponent_snapshot : row.challenger_snapshot;
  return {
    id: row.id,
    at: Date.parse(row.created_at),
    won: row.winner === (challenger ? 'a' : 'b'),
    xp: challenger ? row.challenger_xp : row.opponent_xp,
    isBot: row.opponent_id === null,
    isElite: row.opponent_id === null && opponent.level >= me.level + 3,
    winStreak: 0,
    turns: row.log.turns.length,
    reason: row.reason,
    me: { speciesId: me.speciesId, stage: me.stage, level: me.level },
    opponent: {
      nickname: opponent.nickname,
      speciesId: opponent.speciesId,
      stage: opponent.stage,
      level: opponent.level,
      nation: opponent.nation,
      loadout: opponent.loadout ?? {},
    },
  };
}

/** Existing participant-only RLS protects this read; no new table or server endpoint. */
export async function fetchBattleHistory(
  api: SupabaseClient,
  userId: string,
): Promise<BattleSummary[]> {
  if ((await api.ensureSession()) !== userId) return [];
  const { data, error } = await api.client
    .from('battles')
    .select(
      'id,created_at,challenger_id,opponent_id,challenger_snapshot,opponent_snapshot,winner,reason,log,challenger_xp,opponent_xp',
    )
    .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as BattleHistoryRow[]).map((row) => summarizeBattle(row, userId));
}
