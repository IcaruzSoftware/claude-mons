// Service-role Supabase client. Bypasses RLS: only use it inside Edge Functions after the caller
// has been authenticated (see auth.ts), and prefer the security-definer RPCs for writes.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type ServiceClient = SupabaseClient;

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export function supabaseUrl(): string {
  return env('SUPABASE_URL');
}

export function anonKey(): string {
  return env('SUPABASE_ANON_KEY');
}

let cached: ServiceClient | undefined;

export function serviceClient(): ServiceClient {
  if (!cached) {
    cached = createClient(supabaseUrl(), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return cached;
}

/** Calls a Postgres function and unwraps the PostgREST envelope, throwing on error. */
export async function rpc<T>(
  db: ServiceClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`rpc ${fn}: ${error.message}`);
  return data as T;
}

/** Row shapes as returned by PostgREST for the tables the functions read directly. */
export interface PlayerRow {
  id: string;
  nickname: string;
  nation: 'water' | 'fire' | 'earth' | 'air';
  created_at: string;
  last_seen_at: string;
  nickname_changed_at: string | null;
  streak_days: number;
  last_active_day: string | null;
  suspicion: number;
}

export interface MonRow {
  id: string;
  player_id: string;
  species_id: string | null;
  stage: 'egg' | 'baby' | 'teen' | 'adult';
  level: number;
  total_xp: number;
  work_xp: number;
  battle_xp: number;
  bonus_xp: number;
  stats: Record<string, number>;
  hatched_at: string | null;
  teen_at: string | null;
  adult_at: string | null;
  last_battle_at: string | null;
  last_opponent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface XpDailyRow {
  player_id: string;
  day: string;
  work_xp: number;
  bonus_xp: number;
  battle_xp: number;
  prompts: number;
  stops: number;
  tool_xp: number;
  battles_started: number;
  battles_defended: number;
}

export interface XpMinuteRow {
  player_id: string;
  minute: string;
  prompts: number;
  stops: number;
  tool_xp: number;
}

/** UTC 'YYYY-MM-DD' of a Date, matching `(now() at time zone 'utc')::date` in SQL. */
export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
