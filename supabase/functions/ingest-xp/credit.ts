// The load -> pipeline -> apply_xp loop of ingest-xp, with I/O injected so it is unit-tested under
// `deno test` (credit.test.ts). Idempotency (the batch_id) and the caps are enforced inside apply_xp's
// transaction, so a failure anywhere before it commits leaves nothing behind and a retry is safe.
import type { MinuteBucket, StreakState } from '../_shared/game/game/xp.ts';
import type { MonRow, XpDailyRow } from '../_shared/db.ts';
import {
  emptyDayTotals,
  runIngestPipeline,
  type DayTotals,
  type PipelineInput,
  type PipelineOutput,
} from '../_shared/pipeline.ts';

/** apply_xp attempts; the last one skips the concurrency check so the batch is never lost */
export const MAX_APPLY_ATTEMPTS = 3;

export interface ApplyXpResult {
  /** the batch_id was already applied; nothing was written */
  duplicate?: boolean;
  /** another batch was applied after this one read its state; nothing was written */
  conflict?: boolean;
  /** bonus actually paid (0 when another batch already activated the day) */
  bonus_xp?: number;
  mon: MonRow;
  hatched: boolean;
  level_before: number;
  level_after: number;
  stage_before: MonRow['stage'];
  stage_after: MonRow['stage'];
}

export interface CreditDeps {
  /** mons.work_xp; read before everything else, it versions the state loaded after it */
  loadWorkXp(): Promise<number | null>;
  loadState(attempt: number): Promise<{
    history: PipelineInput['history'];
    today: XpDailyRow | null;
    yesterday: XpDailyRow | null;
    streak: StreakState;
  }>;
  applyXp(deltas: Record<string, unknown>): Promise<ApplyXpResult>;
}

export interface CreditResult {
  out: PipelineOutput;
  applied: ApplyXpResult;
  today: XpDailyRow | null;
  /** bonus actually paid */
  bonus: number;
}

/**
 * Optimistic concurrency against a second device syncing at the same time: apply_xp rejects the
 * batch when mons.work_xp moved since it was read, and the batch is recomputed from fresh state.
 */
export async function creditBatch(
  deps: CreditDeps,
  batch: { batchId: string; now: Date; buckets: MinuteBucket[] },
): Promise<CreditResult> {
  for (let attempt = 1; ; attempt++) {
    const workXp = await deps.loadWorkXp();
    const state = await deps.loadState(attempt);
    const out = runIngestPipeline({
      now: batch.now.getTime(),
      buckets: batch.buckets,
      history: state.history,
      dayTotals: state.today ? dayTotalsOf(state.today) : emptyDayTotals(),
      // no row yet still means zero: a day that arrives entirely late must be able to activate
      yesterdayTotals: state.yesterday ? dayTotalsOf(state.yesterday) : emptyDayTotals(),
      streak: state.streak,
    });
    const applied = await deps.applyXp({
      batch_id: batch.batchId,
      today: batch.now.toISOString().slice(0, 10),
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
      expect_work_xp: attempt < MAX_APPLY_ATTEMPTS ? workXp : null,
    });
    if (applied.conflict) continue;
    // `?? out.bonus`: an apply_xp from before 20261009000000 does not report the bonus it paid
    return { out, applied, today: state.today, bonus: applied.bonus_xp ?? out.bonus };
  }
}

function dayTotalsOf(row: XpDailyRow): DayTotals {
  return { prompts: row.prompts, stops: row.stops, toolXp: row.tool_xp, workXp: row.work_xp };
}
