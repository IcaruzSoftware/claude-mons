import type {
  BattleRequestResponse,
  LeaderboardAlltimeRow,
  LeaderboardNationRow,
  LeaderboardWeeklyRow,
  MonSnapshot,
} from '@claude-mons/shared';
import type { BattlePlayMessage } from '../../common/ipc.ts';
import type { BattleBackend } from '../game/BattleService.ts';
import { ApiCallError, type SupabaseClient } from './SupabaseClient.ts';

export interface LeaderboardData {
  nations: LeaderboardNationRow[];
  alltime: LeaderboardAlltimeRow[];
  weekly: LeaderboardWeeklyRow[];
  /** the caller's all-time rank, if hatched */
  myRank: number | null;
  fetchedAt: number;
}

/** Server-backed battles: the Edge Function resolves the fight; we just replay it. */
export class RemoteBattleBackend implements BattleBackend {
  constructor(private readonly api: SupabaseClient) {}

  async request(_me: MonSnapshot): Promise<BattlePlayMessage | null> {
    try {
      const res = await this.api.invoke<BattleRequestResponse>('battle-request', {});
      return {
        id: res.battle.id,
        result: res.battle.result,
        me: res.battle.a,
        opponent: res.battle.b,
        reward: res.reward.xp,
        isBot: res.battle.isBot,
      };
    } catch (err) {
      if (
        err instanceof ApiCallError &&
        (err.code === 'COOLDOWN' || err.code === 'DAILY_CAP' || err.code === 'EGG_CANNOT_BATTLE')
      ) {
        throw err; // the service surfaces these as refusals
      }
      console.warn('battle-request failed:', err);
      return null; // offline: caller falls back to a wild mon
    }
  }
}

/** Leaderboards are plain views read through PostgREST under RLS. */
export async function fetchLeaderboard(api: SupabaseClient, limit = 50): Promise<LeaderboardData> {
  const userId = await api.ensureSession();
  const [nations, alltime, weekly, mine] = await Promise.all([
    api.client.from('leaderboard_nations').select('*').order('rank', { ascending: true }),
    api.client
      .from('leaderboard_alltime')
      .select('*')
      .order('rank', { ascending: true })
      .limit(limit),
    api.client
      .from('leaderboard_weekly')
      .select('*')
      .order('rank', { ascending: true })
      .limit(limit),
    api.client.from('leaderboard_alltime').select('rank').eq('player_id', userId).maybeSingle(),
  ]);
  for (const r of [nations, alltime, weekly]) if (r.error) throw new Error(r.error.message);
  return {
    nations: (nations.data ?? []) as LeaderboardNationRow[],
    alltime: (alltime.data ?? []) as LeaderboardAlltimeRow[],
    weekly: (weekly.data ?? []) as LeaderboardWeeklyRow[],
    myRank: (mine.data as { rank: number } | null)?.rank ?? null,
    fetchedAt: Date.now(),
  };
}
