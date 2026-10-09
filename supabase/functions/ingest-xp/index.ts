// POST IngestXpRequest -> IngestXpResponse (DESIGN.md §6.2).
// auth -> pure pipeline (caps, bonuses) -> apply_xp RPC (idempotency, persistence) -> events.
import type { IngestEvent, IngestXpRequest, IngestXpResponse } from '../_shared/game/api.ts';
import type { MinuteBucket } from '../_shared/game/game/xp.ts';
import { requireUser } from '../_shared/auth.ts';
import { rpc, serviceClient, type ServiceClient, type XpMinuteRow } from '../_shared/db.ts';
import { error, json, readJson, serve } from '../_shared/http.ts';
import { buildMonState } from '../_shared/monState.ts';
import {
  loadMon,
  loadMonState,
  loadNotifications,
  loadPlayer,
  loadToday,
} from '../_shared/queries.ts';
import { randomUnit } from '../_shared/random.ts';
import { creditBatch, type ApplyXpResult } from './credit.ts';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BUCKETS = 180;
const HISTORY_WINDOW_MS = 25 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // --- pipeline + apply_xp (idempotency lives in apply_xp's transaction, see credit.ts) --------------
  const { out, applied, today, bonus } = await creditBatch(
    {
      loadWorkXp: async () => (await loadMon(db, uid))?.work_xp ?? null,
      loadState: async (attempt) => {
        const [history, todayRow, yesterday, fresh] = await Promise.all([
          loadHistory(db, uid, now),
          loadToday(db, uid, now),
          loadToday(db, uid, new Date(now.getTime() - DAY_MS)),
          attempt === 1 ? Promise.resolve(player) : loadPlayer(db, uid),
        ]);
        const p = fresh ?? player;
        return {
          history,
          today: todayRow,
          yesterday,
          streak: { streakDays: p.streak_days, lastActiveDay: p.last_active_day },
        };
      },
      applyXp: (deltas) =>
        rpc<ApplyXpResult>(db, 'apply_xp', {
          p_player: uid,
          p_deltas: deltas,
          p_species_roll: randomUnit(),
        }),
    },
    { batchId: body.batch_id, now, buckets },
  );

  if (applied.duplicate) {
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
  if (out.dayActivated && bonus > 0) {
    events.push({ type: 'streak', days: out.streak.streakDays, bonus, day: out.dayActivated });
  }

  // --- suspicion: more than half of a meaningfully large batch's claimed XP was dropped for a
  // non-cap reason (implausible/stale/future/no_prompt_context) -----------------------------------
  // Cap drops (cap_minute/cap_hour/cap_day) are the normal, expected shape of a heavy legitimate
  // user's batch and never count; see PipelineOutput['suspicious'] in _shared/pipeline.ts.
  if (out.suspicious) {
    const { error: susError } = await db
      .from('players')
      .update({ suspicion: player.suspicion + 1 })
      .eq('id', uid);
    if (susError) console.warn('suspicion update failed', susError.message);
  }

  const response: IngestXpResponse = {
    batch_id: body.batch_id,
    duplicate: false,
    awarded: { ...out.awarded, bonus, total: out.awarded.total + bonus },
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
