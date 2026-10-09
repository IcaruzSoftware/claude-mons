// The pure server-side XP pipeline used by ingest-xp (DESIGN.md §6.2). No I/O: the caller loads
// the player's recent xp_minutes, today's xp_daily and streak, and persists the returned deltas
// through the apply_xp RPC. Everything here is deterministic given `now`, so it is unit-tested
// under `deno test` (pipeline.test.ts).
import {
  BONUS,
  activateDay,
  creditBucket,
  dayKey,
  mergeCredited,
  type CreditedMinute,
  type DropReason,
  type MinuteBucket,
  type StreakState,
} from './game/game/xp.ts';

export interface DayTotals {
  prompts: number;
  stops: number;
  toolXp: number;
  workXp: number;
}

export interface PipelineInput {
  /** server time, epoch ms */
  now: number;
  buckets: MinuteBucket[];
  /** credited minutes of roughly the last 24 h (xp_minutes rows) */
  history: CreditedMinute[];
  /** today's already credited work totals (xp_daily row), zeros if none */
  dayTotals: DayTotals;
  /**
   * yesterday's xp_daily row: late buckets from yesterday are capped against it, because the
   * history window no longer covers all of yesterday. Omitted: yesterday falls back to history.
   */
  yesterdayTotals?: DayTotals;
  streak: StreakState;
}

export interface PipelineOutput {
  /** per-minute deltas to upsert (summed); only minutes that received XP */
  minutes: CreditedMinute[];
  awarded: { prompt: number; stop: number; tool: number; total: number };
  dropped: Array<{ reason: DropReason; xp: number }>;
  /** daily + streak bonus awarded by this batch (0 if the day was already active) */
  bonus: number;
  /** streak after this batch; equals the input when nothing changed */
  streak: StreakState;
  /**
   * 'YYYY-MM-DD' of the latest day this batch activated (today, or yesterday when late minutes
   * pushed it over the threshold; pays the bonus), else null
   */
  dayActivated: string | null;
  /** today's totals after this batch (for the response / caps display) */
  dayTotals: DayTotals;
  /** uncapped XP the client claimed, for the suspicion heuristic */
  claimedXp: number;
  /**
   * true when this batch should count toward `players.suspicion`: the batch claimed at least
   * `SUSPICION_MIN_CLAIMED_XP` and more than half of that claimed XP was dropped for a reason that
   * signals implausible/fabricated activity (`NON_CAP_DROP_REASONS`) rather than a heavy user simply
   * running into a cap. Cap drops (`cap_minute`, `cap_hour`, `cap_day`) never count: they are the
   * normal, expected shape of a legitimate heavy-usage day.
   */
  suspicious: boolean;
}

/** Drop reasons that indicate implausible/fabricated activity, as opposed to a normal cap. */
const NON_CAP_DROP_REASONS: ReadonlySet<DropReason> = new Set([
  'stale',
  'future',
  'implausible',
  'no_prompt_context',
]);

/** Batches that claimed less than this much XP never count toward the suspicion heuristic. */
export const SUSPICION_MIN_CLAIMED_XP = 100;

export function emptyDayTotals(): DayTotals {
  return { prompts: 0, stops: 0, toolXp: 0, workXp: 0 };
}

export function runIngestPipeline(input: PipelineInput): PipelineOutput {
  const today = dayKey(input.now);
  const buckets = [...input.buckets].sort((a, b) => a.minute - b.minute);
  let history: CreditedMinute[] = input.history.map((h) => ({ ...h }));
  const day: DayTotals = { ...input.dayTotals };
  const yesterday = dayKey(input.now - 86_400_000);
  const prevDay: DayTotals | null = input.yesterdayTotals ? { ...input.yesterdayTotals } : null;
  const deltas = new Map<number, CreditedMinute>();
  const awarded = { prompt: 0, stop: 0, tool: 0, total: 0 };
  const dropped: PipelineOutput['dropped'] = [];
  let claimedXp = 0;
  let nonCapDroppedXp = 0;

  for (const bucket of buckets) {
    const bucketDay = dayKey(bucket.minute);
    const isToday = bucketDay === today;
    // Daily caps come from xp_daily (authoritative, includes minutes already pruned or outside
    // the history window) for today and yesterday; older buckets are stale anyway.
    const totals = isToday ? day : bucketDay === yesterday ? prevDay : null;
    const result = creditBucket(bucket, {
      now: input.now,
      history,
      ...(totals ? { dayTotals: totals } : {}),
    });
    claimedXp += result.credited.total + result.dropped.reduce((s, d) => s + d.xp, 0);
    for (const d of result.dropped) {
      dropped.push(d);
      if (NON_CAP_DROP_REASONS.has(d.reason)) nonCapDroppedXp += d.xp;
    }
    const e = result.entry;
    if (e.prompts === 0 && e.stops === 0 && e.toolXp === 0) continue;

    awarded.prompt += result.credited.prompt;
    awarded.stop += result.credited.stop;
    awarded.tool += result.credited.tool;
    awarded.total += result.credited.total;
    history = mergeCredited(history, e);
    const prev = deltas.get(e.minute);
    if (prev) {
      prev.prompts += e.prompts;
      prev.stops += e.stops;
      prev.toolXp += e.toolXp;
    } else {
      deltas.set(e.minute, { ...e });
    }
    if (totals) {
      totals.prompts += e.prompts;
      totals.stops += e.stops;
      totals.toolXp += e.toolXp;
      totals.workXp += result.credited.total;
    }
  }

  // Yesterday first, so a late batch that finishes yesterday also extends today's streak. A day is
  // never activated at or before the last active day: no double pay, no streak reset.
  let bonus = 0;
  let streak = input.streak;
  let dayActivated: string | null = null;
  const yesterdayGrew =
    prevDay !== null &&
    input.yesterdayTotals !== undefined &&
    prevDay.workXp > input.yesterdayTotals.workXp;
  const candidates: Array<[string, DayTotals | null]> = [
    [yesterday, yesterdayGrew ? prevDay : null],
    [today, day],
  ];
  for (const [d, totals] of candidates) {
    if (!totals || totals.workXp < BONUS.dailyThreshold) continue;
    if (streak.lastActiveDay !== null && streak.lastActiveDay >= d) continue;
    const activated = activateDay(streak, d);
    bonus += activated.bonus;
    streak = activated.state;
    dayActivated = d;
  }

  return {
    minutes: [...deltas.values()].sort((a, b) => a.minute - b.minute),
    awarded,
    dropped: mergeDropped(dropped),
    bonus,
    streak,
    dayActivated,
    dayTotals: day,
    claimedXp,
    suspicious: claimedXp >= SUSPICION_MIN_CLAIMED_XP && nonCapDroppedXp * 2 > claimedXp,
  };
}

/** Collapse drop entries by reason so the response stays small for large batches. */
function mergeDropped(
  rows: Array<{ reason: DropReason; xp: number }>,
): Array<{ reason: DropReason; xp: number }> {
  const byReason = new Map<DropReason, number>();
  for (const r of rows) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + r.xp);
  return [...byReason.entries()].filter(([, xp]) => xp > 0).map(([reason, xp]) => ({ reason, xp }));
}
