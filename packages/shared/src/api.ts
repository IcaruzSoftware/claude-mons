/**
 * Wire types shared by the desktop client and the Supabase Edge Functions (DESIGN.md §6.2).
 * Types only: no runtime code, so importing this module costs nothing.
 *
 * Conventions: request bodies use snake_case where they mirror database columns (`batch_id`),
 * responses are camelCase except for the top-level echo fields (`batch_id`, `server_time`).
 * Timestamps are ISO-8601 strings in UTC; `MinuteBucket.minute` is epoch milliseconds.
 */
import type { BattleResult, MonSnapshot } from './battle/battle.ts';
import type { DropReason, MinuteBucket } from './game/xp.ts';
import type { Nation, Stage, Stats } from './types.ts';

// --- common -----------------------------------------------------------------------------------

/** Every non-2xx response has this shape. */
export interface ApiError {
  error: {
    /** stable machine-readable code, e.g. `NICKNAME_TAKEN` */
    code: string;
    message: string;
    /** optional structured details, e.g. `{ cooldownUntil }` for 429 COOLDOWN */
    details?: Record<string, unknown>;
  };
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'BAD_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'NO_PROFILE'
  | 'INVALID_NATION'
  | 'NATION_LOCKED'
  | 'NICKNAME_INVALID'
  | 'NICKNAME_TAKEN'
  | 'RENAME_COOLDOWN'
  | 'EGG_CANNOT_BATTLE'
  | 'COOLDOWN'
  | 'DAILY_CAP'
  | 'INTERNAL';

/** Server-authoritative view of the caller's mon. Returned by every mutating function. */
export interface MonState {
  id: string;
  /** null while the mon is still an egg */
  speciesId: string | null;
  stage: Stage;
  level: number;
  totalXp: number;
  xpIntoLevel: number;
  xpToNext: number;
  /** already scaled to `level`; empty object while egg */
  stats: Stats | Record<string, never>;
  streakDays: number;
  battle: {
    /** ISO timestamp when the next challenge is allowed, or null if allowed now */
    cooldownUntil: string | null;
    /** challenges left today (BATTLE_RULES.challengesPerDay - battles_started) */
    remainingToday: number;
  };
}

// --- create-profile ----------------------------------------------------------------------------

export interface CreateProfileRequest {
  /** omitted on first call => server generates one (e.g. `Trainer_4821`) */
  nickname?: string;
  /** required on first call, immutable afterwards (409 NATION_LOCKED) */
  nation?: Nation;
}

export interface CreateProfileResponse {
  player: { id: string; nickname: string; nation: Nation };
  mon: MonState;
  /** true when this call created the profile (HTTP 201), false for renames (HTTP 200) */
  created: boolean;
}

// --- ingest-xp --------------------------------------------------------------------------------

export interface IngestXpRequest {
  /** client-generated UUID; resending the same id is a no-op (`duplicate: true`) */
  batch_id: string;
  device_id: string;
  client_version: string;
  /** at most 180 buckets per batch */
  buckets: MinuteBucket[];
}

export type IngestEvent =
  | { type: 'hatched'; speciesId: string }
  | { type: 'level_up'; from: number; to: number }
  | { type: 'evolved'; stage: Exclude<Stage, 'egg'> }
  | { type: 'streak'; days: number; bonus: number };

export interface BattleNotification {
  id: number;
  battleId: string;
  createdAt: string;
  /** whether the notified (defending) player won */
  won: boolean;
  opponentNickname: string;
  opponentNation: Nation;
  /** XP the defender was credited */
  xp: number;
}

export interface IngestXpResponse {
  batch_id: string;
  duplicate: boolean;
  awarded: { prompt: number; stop: number; tool: number; bonus: number; total: number };
  dropped: Array<{ reason: DropReason; xp: number }>;
  mon: MonState;
  events: IngestEvent[];
  /** unseen defender notifications, newest first, at most 10 */
  notifications: BattleNotification[];
  server_time: string;
}

// --- battle-request ---------------------------------------------------------------------------

export type BattleRewardKind = 'win' | 'loss' | 'bot_win' | 'bot_loss';

export interface BattleRequestResponse {
  battle: {
    id: string;
    result: BattleResult;
    /** the challenger (caller) */
    a: MonSnapshot;
    /** the opponent; `playerId` is null for a Wild Mon */
    b: MonSnapshot;
    isBot: boolean;
  };
  reward: { xp: number; kind: BattleRewardKind };
  mon: MonState;
  cooldownUntil: string;
}

// --- heartbeat --------------------------------------------------------------------------------

export interface HeartbeatResponse {
  ok: true;
  pruned: number;
  ts: string;
}

// --- leaderboard views (read via PostgREST + RLS) ----------------------------------------------

export interface LeaderboardAlltimeRow {
  player_id: string;
  nickname: string;
  nation: Nation;
  species_id: string;
  stage: Exclude<Stage, 'egg'>;
  level: number;
  total_xp: number;
  rank: number;
}

export interface LeaderboardWeeklyRow {
  player_id: string;
  nickname: string;
  nation: Nation;
  species_id: string;
  stage: Exclude<Stage, 'egg'>;
  level: number;
  weekly_xp: number;
  rank: number;
}

export interface LeaderboardNationRow {
  nation: Nation;
  members: number;
  hatched_members: number;
  total_xp: number;
  weekly_xp: number;
  /** numeric in SQL; PostgREST serializes numerics as JSON numbers */
  avg_level: number | null;
  weekly_battles_won: number;
  weekly_battles_lost: number;
  rank: number;
}
