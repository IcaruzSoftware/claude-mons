// deno test --allow-read ingest-xp/credit.test.ts   (run `pnpm sync:shared` first)
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { CAPS, emptyBucket } from '../_shared/game/game/xp.ts';
import type { MonRow, XpDailyRow } from '../_shared/db.ts';
import { creditBatch, type ApplyXpResult, type CreditDeps } from './credit.ts';

const NOW = new Date(Date.UTC(2026, 8, 5, 20, 0)); // 2026-09-05 20:00Z
const LATE = Date.UTC(2026, 8, 4, 23, 30); // yesterday 23:30Z
const BATCH = '00000000-0000-4000-8000-000000000001';

function daily(day: string, workXp: number): XpDailyRow {
  return {
    day,
    work_xp: workXp,
    prompts: 0,
    stops: 0,
    tool_xp: 0,
  } as unknown as XpDailyRow;
}

function ok(bonus = 0): ApplyXpResult {
  return {
    bonus_xp: bonus,
    mon: {} as MonRow,
    hatched: false,
    level_before: 1,
    level_after: 1,
    stage_before: 'egg',
    stage_after: 'egg',
  };
}

function fakeDeps(replies: Array<ApplyXpResult | Error>, yesterday: XpDailyRow | null = null) {
  const calls: Array<Record<string, unknown>> = [];
  let workXp = 100;
  const deps: CreditDeps = {
    loadWorkXp: () => Promise.resolve(workXp),
    loadState: () =>
      Promise.resolve({
        history: [],
        today: null,
        yesterday,
        streak: { streakDays: 0, lastActiveDay: null },
      }),
    applyXp: (deltas) => {
      calls.push(deltas);
      workXp += 5; // another device keeps landing batches between attempts
      const reply = replies.shift() ?? ok();
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
  return { deps, calls };
}

const conflict = { ...ok(), conflict: true };

Deno.test('a conflicting apply is recomputed; the last attempt skips the check', async () => {
  const { deps, calls } = fakeDeps([conflict, conflict, ok()]);
  await creditBatch(deps, {
    batchId: BATCH,
    now: NOW,
    buckets: [{ ...emptyBucket(NOW.getTime()), prompts: 1 }],
  });
  assertEquals(
    calls.map((c) => c.expect_work_xp),
    [100, 105, null],
  );
  assertEquals(
    calls.map((c) => c.batch_id),
    [BATCH, BATCH, BATCH],
  );
  assertEquals(calls[0]!.today, '2026-09-05');
});

Deno.test("yesterday's xp_daily row caps a late bucket", async () => {
  const { deps, calls } = fakeDeps([], daily('2026-09-04', CAPS.workXpPerDay));
  await creditBatch(deps, {
    batchId: BATCH,
    now: NOW,
    buckets: [{ ...emptyBucket(LATE), prompts: 1 }],
  });
  assertEquals(calls[0]!.work_xp, 0);
  assertEquals(calls[0]!.minutes, []);
});

Deno.test('a failed apply propagates, and the retry of the same batch_id is credited', async () => {
  // apply_xp holds the batch_id insert in its own transaction: a 5xx leaves nothing behind
  const { deps, calls } = fakeDeps([new Error('rpc apply_xp: 503'), ok()]);
  const batch = {
    batchId: BATCH,
    now: NOW,
    buckets: [{ ...emptyBucket(NOW.getTime()), prompts: 1 }],
  };
  await assertRejects(() => creditBatch(deps, batch));
  const res = await creditBatch(deps, batch);
  assertEquals(res.applied.duplicate, undefined);
  assertEquals(calls[1]!.work_xp, 5);
});

Deno.test(
  'a duplicate reply is passed through and an old apply_xp falls back to the computed bonus',
  async () => {
    const dup = await creditBatch(fakeDeps([{ ...ok(), duplicate: true }]).deps, {
      batchId: BATCH,
      now: NOW,
      buckets: [],
    });
    assertEquals(dup.applied.duplicate, true);

    const legacy = { ...ok() };
    delete legacy.bonus_xp;
    const res = await creditBatch(fakeDeps([legacy]).deps, {
      batchId: BATCH,
      now: NOW,
      // ten one-prompt minutes = 50 work XP: activates today
      buckets: Array.from({ length: 10 }, (_, i) => ({
        ...emptyBucket(NOW.getTime() - i * 60_000),
        prompts: 1,
      })),
    });
    assertEquals(res.out.bonus > 0, true);
    assertEquals(res.bonus, res.out.bonus);
  },
);

Deno.test(
  'a whole day arriving late after midnight activates it even without an xp_daily row',
  async () => {
    const { deps, calls } = fakeDeps([], null);
    const res = await creditBatch(deps, {
      batchId: BATCH,
      now: NOW,
      // ten one-prompt minutes at yesterday 23:50..23:59Z = 50 work XP
      buckets: Array.from({ length: 10 }, (_, i) => ({
        ...emptyBucket(Date.UTC(2026, 8, 4, 23, 50 + i)),
        prompts: 1,
      })),
    });
    assertEquals(res.out.dayActivated, '2026-09-04');
    assertEquals(calls[0]!.last_active_day, '2026-09-04');
  },
);
