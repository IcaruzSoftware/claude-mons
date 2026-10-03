import { describe, expect, it, vi } from 'vitest';
import { snapshotFor } from '@claude-mons/shared';
import { mergeBattleHistory } from '../src/common/battleHistory.ts';
import {
  fetchBattleHistory,
  summarizeBattle,
  type BattleHistoryRow,
} from '../src/main/net/battleHistory.ts';
import type { SupabaseClient } from '../src/main/net/SupabaseClient.ts';

const mon = (id: string, speciesId: string) =>
  snapshotFor({ monId: id, playerId: id, nickname: id, speciesId, stage: 'baby', level: 5 });
const row: BattleHistoryRow = {
  id: 'battle-1',
  created_at: '2026-10-03T10:00:00Z',
  challenger_id: 'me',
  opponent_id: 'them',
  challenger_snapshot: mon('me', 'dripple'),
  opponent_snapshot: mon('them', 'sparkit'),
  winner: 'b',
  reason: 'ko',
  log: { turns: [{}, {}] },
  challenger_xp: 10,
  opponent_xp: 15,
};

describe('recent account battles', () => {
  it('uses original battle time and correct results/rewards for both participants', () => {
    const challenger = summarizeBattle(row, 'me'),
      defender = summarizeBattle(row, 'them');
    expect(challenger).toMatchObject({
      won: false,
      xp: 10,
      turns: 2,
      at: Date.parse(row.created_at),
      opponent: { nickname: 'them' },
    });
    expect(defender).toMatchObject({ won: true, xp: 15, opponent: { nickname: 'me' } });
  });
  it('merges recent offline/server battles newest first, deduplicates and caps at 50', () => {
    const old = summarizeBattle(row, 'me');
    const recent = { ...old, id: 'recent', at: old.at + 1000 };
    expect(mergeBattleHistory([old, recent], [{ ...old, xp: 12 }])).toEqual([
      recent,
      { ...old, xp: 12 },
    ]);
    expect(
      mergeBattleHistory(Array.from({ length: 70 }, (_, i) => ({ ...old, id: String(i), at: i }))),
    ).toHaveLength(50);
  });
  it('reads the latest account battles through participant-only RLS', async () => {
    const query = {
      select: vi.fn(),
      or: vi.fn(),
      order: vi.fn(),
      limit: vi.fn().mockResolvedValue({ data: [row], error: null }),
    };
    query.select.mockReturnValue(query);
    query.or.mockReturnValue(query);
    query.order.mockReturnValue(query);
    const api = {
      ensureSession: vi.fn().mockResolvedValue('me'),
      client: { from: vi.fn().mockReturnValue(query) },
    };
    expect(await fetchBattleHistory(api as unknown as SupabaseClient, 'me')).toHaveLength(1);
    expect(query.or).toHaveBeenCalledWith('challenger_id.eq.me,opponent_id.eq.me');
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(50);
    api.ensureSession.mockResolvedValue('another-account');
    expect(await fetchBattleHistory(api as unknown as SupabaseClient, 'me')).toEqual([]);
    expect(api.client.from).toHaveBeenCalledTimes(1);
  });
});
