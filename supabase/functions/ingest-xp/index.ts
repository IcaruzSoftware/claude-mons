// POST IngestXpRequest -> IngestXpResponse (DESIGN.md §6.2).
// auth -> idempotency insert -> pure pipeline (caps, bonuses) -> apply_xp RPC -> events.
import type { IngestEvent, IngestXpRequest, IngestXpResponse } from '../_shared/game/api.ts';
import type { MinuteBucket } from '../_shared/game/game/xp.ts';
import { requireUser } from '../_shared/auth.ts';
import {
  rpc,
  serviceClient,
  type MonRow,
  type ServiceClient,
  type XpMinuteRow,
} from '../_shared/db.ts';
import { error, json, readJson, serve } from '../_shared/http.ts';
import { buildMonState } from '../_shared/monState.ts';
import { emptyDayTotals, runIngestPipeline } from '../_shared/pipeline.ts';
import { loadMonState, loadNotifications, loadPlayer, loadToday } from '../_shared/queries.ts';
import { randomUnit } from '../_shared/random.ts';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BUCKETS = 180;
const HISTORY_WINDOW_MS = 25 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = '23505';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ApplyXpResult {
  mon: MonRow;
  hatched: boolean;
  level_before: number;
  level_after: number;
  stage_before: MonRow['stage'];
  stage_after: MonRow['stage'];
}

serve(async (req) => {
  if (req.method !== 'POST') return error('BAD_REQUEST', 'POST only', 405);
  const { uid } = await requireUser(req);
  const body = await readJson<Partial<IngestXpRequest>>(req, MAX_BODY_BYTES);

  if (typeof body.batch_id !== 'string' || !UUID_RE.test(body.batch_id)) {
    return error('BAD_REQUEST', 'batch_id must be a UUID', 400);
  }
  if (!Array.isArray(body.buckets)) return error('BAD_REQUEST', 'buckets must be an array', 400);
  if (body.buckets.length > MAX_BUCKETS) {
    return error('PAYLOAD_TOO_LARGE', `at most ${MAX_BUCKETS} buckets per batch`, 413);
  }
  const buckets = body.buckets.map(sanitizeBucket).filter((b): b is MinuteBucket => b !== null);

  const db = serviceClient();
  const now = new Date();
  const player = await loadPlayer(db, uid);
  if (!player) return error('NO_PROFILE', 'create a profile first', 409);

  // --- idempotency ------------------------------------------------------------------------------
  const { error: batchError } = await db
    .from('ingest_batches')
    .insert({ batch_id: body.batch_id, player_id: uid });
  if (batchError) {
    if (batchError.code !== UNIQUE_VIOLATION) {
      throw new Error(`ingest_batches: ${batchError.message}`);
    }
    const response: IngestXpResponse = {
      batch_id: body.batch_id,
      duplicate: true,
      awarded: { prompt: 0, stop: 0, tool: 0, bonus: 0, total: 0 },
      dropped: [],
      mon: await loadMonState(db, player, now),
      events: [],
      notifications: await loadNotifications(db, uid),
      server_time: now.toISOString(),
    };
    return json(response, 200);
  }

  // --- pipeline -----------------------------------------------------------------------------------
  const [history, today] = await Promise.all([loadHistory(db, uid, now), loadToday(db, uid, now)]);
  const out = runIngestPipeline({
    now: now.getTime(),
    buckets,
    history,
    dayTotals: today
      ? { prompts: today.prompts, stops: today.stops, toolXp: today.tool_xp, workXp: today.work_xp }
      : emptyDayTotals(),
    streak: { streakDays: player.streak_days, lastActiveDay: player.last_active_day },
  });

  const applied = await rpc<ApplyXpResult>(db, 'apply_xp', {
    p_player: uid,
    p_deltas: {
      minutes: out.minutes.map((m) => ({
        minute: new Date(m.minute).toISOString(),
        prompts: m.prompts,
        stops: m.stops,
        tool_xp: m.toolXp,
      })),
      work_xp: out.awarded.total,
      bonus_xp: out.bonus,
      streak_days: out.dayActivated ? out.streak.streakDays : null,
      last_active_day: out.dayActivated ? out.streak.lastActiveDay : null,
    },
    p_species_roll: randomUnit(),
  });

  // --- events -------------------------------------------------------------------------------------
  const events: IngestEvent[] = [];
  if (applied.hatched && applied.mon.species_id) {
    events.push({ type: 'hatched', speciesId: applied.mon.species_id });
  }
  if (applied.level_after > applied.level_before) {
    events.push({ type: 'level_up', from: applied.level_before, to: applied.level_after });
  }
  if (
    applied.stage_after !== applied.stage_before &&
    applied.stage_after !== 'egg' &&
    !(applied.hatched && applied.stage_after === 'baby')
  ) {
    events.push({ type: 'evolved', stage: applied.stage_after });
  }
  if (out.dayActivated) {
    events.push({ type: 'streak', days: out.streak.streakDays, bonus: out.bonus });
  }

  // --- suspicion: more than half of the claimed XP was dropped -----------------------------------
  const droppedXp = out.dropped.reduce((s, d) => s + d.xp, 0);
  if (out.claimedXp > 0 && droppedXp * 2 > out.claimedXp) {
    const { error: susError } = await db
      .from('players')
      .update({ suspicion: player.suspicion + 1 })
      .eq('id', uid);
    if (susError) console.warn('suspicion update failed', susError.message);
  }

  const response: IngestXpResponse = {
    batch_id: body.batch_id,
    duplicate: false,
    awarded: { ...out.awarded, bonus: out.bonus, total: out.awarded.total + out.bonus },
    dropped: out.dropped,
    mon: buildMonState(
      applied.mon,
      { battles_started: today?.battles_started ?? 0 },
      out.streak.streakDays,
      now,
    ),
    events,
    notifications: await loadNotifications(db, uid),
    server_time: now.toISOString(),
  };
  return json(response, 200);
});

async function loadHistory(db: ServiceClient, uid: string, now: Date) {
  const since = new Date(now.getTime() - HISTORY_WINDOW_MS).toISOString();
  const { data, error: histError } = await db
    .from('xp_minutes')
    .select('*')
    .eq('player_id', uid)
    .gte('minute', since);
  if (histError) throw new Error(`xp_minutes: ${histError.message}`);
  return ((data ?? []) as XpMinuteRow[]).map((r) => ({
    minute: Date.parse(r.minute),
    prompts: r.prompts,
    stops: r.stops,
    toolXp: r.tool_xp,
  }));
}

/** Coerce an untrusted bucket into a MinuteBucket; returns null when it is unusable. */
function sanitizeBucket(raw: unknown): MinuteBucket | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;
  const minute = Number(b.minute);
  if (!Number.isFinite(minute) || minute <= 0) return null;
  const tools: Record<string, number> = {};
  if (typeof b.tools === 'object' && b.tools !== null) {
    for (const [name, count] of Object.entries(b.tools as Record<string, unknown>)) {
      const n = Number(count);
      if (Number.isFinite(n) && n > 0 && name.length <= 128) tools[name] = Math.floor(n);
    }
  }
  return {
    minute: Math.floor(minute / 60000) * 60000,
    prompts: nonNegInt(b.prompts),
    stops: nonNegInt(b.stops),
    tools,
    sessions: nonNegInt(b.sessions),
  };
}

function nonNegInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
