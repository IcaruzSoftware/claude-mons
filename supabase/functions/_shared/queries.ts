// Read helpers shared by the Edge Functions (service role; callers have already authenticated).
import type { BattleNotification, MonState } from './game/api.ts';
import type { Nation } from './game/types.ts';
import { utcDay, type MonRow, type PlayerRow, type ServiceClient, type XpDailyRow } from './db.ts';
import { buildMonState } from './monState.ts';

export async function loadPlayer(db: ServiceClient, uid: string): Promise<PlayerRow | null> {
  const { data, error } = await db.from('players').select('*').eq('id', uid).maybeSingle();
  if (error) throw new Error(`players: ${error.message}`);
  return (data as PlayerRow | null) ?? null;
}

export async function loadMon(db: ServiceClient, uid: string): Promise<MonRow | null> {
  const { data, error } = await db.from('mons').select('*').eq('player_id', uid).maybeSingle();
  if (error) throw new Error(`mons: ${error.message}`);
  return (data as MonRow | null) ?? null;
}

export async function loadToday(
  db: ServiceClient,
  uid: string,
  now: Date = new Date(),
): Promise<XpDailyRow | null> {
  const { data, error } = await db
    .from('xp_daily')
    .select('*')
    .eq('player_id', uid)
    .eq('day', utcDay(now))
    .maybeSingle();
  if (error) throw new Error(`xp_daily: ${error.message}`);
  return (data as XpDailyRow | null) ?? null;
}

/** MonState for a player whose mon row is already at hand (saves one query). */
export async function monStateFor(
  db: ServiceClient,
  mon: MonRow,
  streakDays: number,
  now: Date = new Date(),
): Promise<MonState> {
  const today = await loadToday(db, mon.player_id, now);
  return buildMonState(mon, today, streakDays, now);
}

export async function loadMonState(
  db: ServiceClient,
  player: PlayerRow,
  now: Date = new Date(),
): Promise<MonState> {
  const mon = await loadMon(db, player.id);
  if (!mon) throw new Error(`player ${player.id} has no mon`);
  return monStateFor(db, mon, player.streak_days, now);
}

interface NotificationJoinRow {
  id: number;
  battle_id: string;
  created_at: string;
  battles: {
    winner: 'a' | 'b';
    opponent_xp: number;
    challenger_snapshot: { nickname?: string; nation?: Nation } | null;
  } | null;
}

/** Unseen defender notifications, newest first, at most `limit`. */
export async function loadNotifications(
  db: ServiceClient,
  uid: string,
  limit = 10,
): Promise<BattleNotification[]> {
  const { data, error } = await db
    .from('battle_notifications')
    .select('id, battle_id, created_at, battles(winner, opponent_xp, challenger_snapshot)')
    .eq('player_id', uid)
    .is('seen_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`battle_notifications: ${error.message}`);
  const rows = (data ?? []) as unknown as NotificationJoinRow[];
  return rows
    .filter((r) => r.battles !== null)
    .map((r) => {
      const b = r.battles!;
      return {
        id: r.id,
        battleId: r.battle_id,
        createdAt: r.created_at,
        // the notified player is always side b (the defender)
        won: b.winner === 'b',
        opponentNickname: b.challenger_snapshot?.nickname ?? 'Unknown',
        opponentNation: b.challenger_snapshot?.nation ?? 'water',
        xp: b.opponent_xp,
      };
    });
}
