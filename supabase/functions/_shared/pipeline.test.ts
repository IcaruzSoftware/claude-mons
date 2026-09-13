// deno test --allow-read _shared/pipeline.test.ts   (run `pnpm sync:shared` first)
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { BONUS, CAPS, EVENT_XP, emptyBucket, type MinuteBucket } from './game/game/xp.ts';
import {
  emptyDayTotals,
  runIngestPipeline,
  SUSPICION_MIN_CLAIMED_XP,
  type PipelineInput,
} from './pipeline.ts';

const NOON = Date.UTC(2026, 8, 4, 12, 0, 0); // 2026-09-04 12:00Z
const MIN = 60_000;

function bucket(minute: number, partial: Partial<MinuteBucket>): MinuteBucket {
  return { ...emptyBucket(minute), ...partial };
}

function input(partial: Partial<PipelineInput>): PipelineInput {
  return {
    now: NOON + 5 * MIN,
    buckets: [],
    history: [],
    dayTotals: emptyDayTotals(),
    streak: { streakDays: 0, lastActiveDay: null },
    ...partial,
  };
}

Deno.test('normal batch credits prompts, stops and tools chronologically', () => {
  const out = runIngestPipeline(
    input({
      buckets: [
        bucket(NOON + 2 * MIN, { stops: 1, tools: { Edit: 2 } }),
        bucket(NOON, { prompts: 1, tools: { Read: 3 } }),
      ],
    }),
  );
  assertEquals(out.awarded.prompt, EVENT_XP.prompt);
  assertEquals(out.awarded.stop, EVENT_XP.stop);
  assertEquals(out.awarded.tool, 3 + 4);
  assertEquals(out.awarded.total, 5 + 10 + 7);
  assertEquals(out.dropped, []);
  assertEquals(out.bonus, 0);
  assertEquals(out.dayActivated, null);
  assertEquals(
    out.minutes.map((m) => m.minute),
    [NOON, NOON + 2 * MIN],
  );
  assertEquals(out.dayTotals.workXp, 22);
  assertEquals(out.claimedXp, 22);
});

Deno.test('a replayed batch adds nothing beyond the per-minute and hourly caps', () => {
  const buckets = [
    bucket(NOON, { prompts: 1, tools: { Edit: 15 } }), // 5 + 30 tool XP (cap exactly)
    bucket(NOON + MIN, { stops: 1 }),
  ];
  const first = runIngestPipeline(input({ buckets }));
  assertEquals(first.awarded.total, 5 + 30 + 10);

  // The server persisted the credited minutes and today's totals; the client resends the batch.
  const replay = runIngestPipeline(
    input({
      buckets,
      history: first.minutes,
      dayTotals: first.dayTotals,
    }),
  );
  // tool XP for the minute is already at the cap -> dropped; the second prompt is a new prompt in
  // the hour (allowed), but stops may not exceed prompts credited in the hour.
  assertEquals(replay.awarded.tool, 0);
  assert(replay.dropped.some((d) => d.reason === 'cap_minute' && d.xp === 30));
  assertEquals(replay.awarded.prompt, EVENT_XP.prompt);
  assertEquals(replay.awarded.stop, EVENT_XP.stop);
  assert(replay.awarded.total < first.awarded.total);
});

Deno.test('stale and future buckets are dropped and counted as claimed', () => {
  const now = NOON;
  const out = runIngestPipeline(
    input({
      now,
      buckets: [
        bucket(now - CAPS.staleMs - MIN, { prompts: 2 }),
        bucket(now + CAPS.futureMs + MIN, { prompts: 1, tools: { Bash: 4 } }),
        bucket(now, { prompts: 1 }),
      ],
    }),
  );
  assertEquals(out.awarded.total, EVENT_XP.prompt);
  assertEquals(out.minutes.length, 1);
  const stale = out.dropped.find((d) => d.reason === 'stale');
  const future = out.dropped.find((d) => d.reason === 'future');
  assertEquals(stale?.xp, 10);
  assertEquals(future?.xp, 5 + 4);
  assertEquals(out.claimedXp, 5 + 10 + 9);
});

Deno.test('daily bonus and streak are paid once when the day crosses the threshold', () => {
  // 50 work XP: 4 prompts (20) + 3 stops (30), spread over minutes
  const buckets = Array.from({ length: 4 }, (_, i) => bucket(NOON + i * MIN, { prompts: 1 }));
  buckets.push(bucket(NOON + 4 * MIN, { stops: 3 }));

  const first = runIngestPipeline(input({ buckets }));
  assertEquals(first.awarded.total, BONUS.dailyThreshold);
  assertEquals(first.dayActivated, '2026-09-04');
  assertEquals(first.bonus, BONUS.daily + BONUS.streakPerDay * 1);
  assertEquals(first.streak, { streakDays: 1, lastActiveDay: '2026-09-04' });

  // Later batch the same day: no second bonus.
  const later = runIngestPipeline(
    input({
      now: NOON + 60 * MIN,
      buckets: [bucket(NOON + 50 * MIN, { prompts: 1 })],
      history: first.minutes,
      dayTotals: first.dayTotals,
      streak: first.streak,
    }),
  );
  assertEquals(later.bonus, 0);
  assertEquals(later.dayActivated, null);
  assertEquals(later.streak, first.streak);

  // Next day continues the streak with a bigger bonus.
  const nextDay = NOON + 24 * 60 * MIN;
  const nextBuckets = Array.from({ length: 5 }, (_, i) =>
    bucket(nextDay + i * MIN, { prompts: 1, stops: 1 }),
  );
  const tomorrow = runIngestPipeline(
    input({ now: nextDay + 10 * MIN, buckets: nextBuckets, streak: first.streak }),
  );
  assertEquals(tomorrow.dayActivated, '2026-09-05');
  assertEquals(tomorrow.streak.streakDays, 2);
  assertEquals(tomorrow.bonus, BONUS.daily + BONUS.streakPerDay * 2);
});

Deno.test('below the threshold nothing activates', () => {
  const out = runIngestPipeline(input({ buckets: [bucket(NOON, { prompts: 1 })] }));
  assertEquals(out.bonus, 0);
  assertEquals(out.dayActivated, null);
  assertEquals(out.streak, { streakDays: 0, lastActiveDay: null });
});

// --- suspicion heuristic ------------------------------------------------------------------------
// Cap drops (cap_minute/cap_hour/cap_day) are the normal shape of a heavy legitimate day and must
// never contribute to `suspicious`; only non-cap drops (stale/future/implausible/no_prompt_context)
// on a batch that claimed at least SUSPICION_MIN_CLAIMED_XP do.

Deno.test('a heavy day that only trips caps never counts toward suspicion', () => {
  // Almost at the daily work cap already; this bucket's legitimate-looking activity mostly has no
  // room left and is dropped as cap_day, not as anything implausible.
  const out = runIngestPipeline(
    input({
      dayTotals: { prompts: 100, stops: 100, toolXp: 1150, workXp: 1990 },
      buckets: [bucket(NOON, { prompts: 5, stops: 5, tools: { Edit: 20 } })],
    }),
  );
  assert(out.claimedXp >= SUSPICION_MIN_CLAIMED_XP);
  assert(out.dropped.length > 0);
  assert(
    out.dropped.every(
      (d) => d.reason === 'cap_day' || d.reason === 'cap_hour' || d.reason === 'cap_minute',
    ),
  );
  assertEquals(out.suspicious, false);
});

Deno.test('a batch mostly rejected as implausible/future counts toward suspicion', () => {
  const now = NOON;
  const out = runIngestPipeline(
    input({
      now,
      buckets: [
        // dropped in full as 'future' (non-cap): 3 prompts (15) + 70 run-class tool XP (70) = 85
        bucket(now + CAPS.futureMs + MIN, { prompts: 3, tools: { Bash: 70 } }),
        // credited normally: 5 (prompt) + 10 (tool) = 15
        bucket(now, { prompts: 1, tools: { Edit: 5 } }),
      ],
    }),
  );
  assertEquals(out.claimedXp, 100);
  assert(out.dropped.some((d) => d.reason === 'future'));
  assertEquals(out.suspicious, true);
});

Deno.test('a tiny batch never counts toward suspicion even if fully dropped', () => {
  const now = NOON;
  const out = runIngestPipeline(
    input({ now, buckets: [bucket(now + CAPS.futureMs + MIN, { prompts: 1 })] }),
  );
  assertEquals(out.claimedXp, EVENT_XP.prompt);
  assert(out.claimedXp < SUSPICION_MIN_CLAIMED_XP);
  assert(out.dropped.some((d) => d.reason === 'future'));
  assertEquals(out.suspicious, false);
});
