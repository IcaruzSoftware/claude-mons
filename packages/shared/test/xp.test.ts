import { describe, expect, it } from 'vitest';
import {
  BONUS,
  CAPS,
  EVENT_XP,
  activateDay,
  bucketRawXp,
  classifyTool,
  creditBucket,
  dayKey,
  daysBetween,
  emptyBucket,
  mergeCredited,
  minuteFloor,
  type CreditedMinute,
  type MinuteBucket,
} from '../src/game/xp.ts';

const T0 = Date.UTC(2026, 8, 4, 12, 0, 0); // 2026-09-04 12:00Z

function bucket(minuteOffset: number, partial: Partial<MinuteBucket>): MinuteBucket {
  return { ...emptyBucket(T0 + minuteOffset * 60000), ...partial };
}

describe('tool classification', () => {
  it('weights mutations higher and ignores meta tools', () => {
    expect(classifyTool('Edit')).toBe('mutate');
    expect(classifyTool('Write')).toBe('mutate');
    expect(classifyTool('Bash')).toBe('run');
    expect(classifyTool('mcp__supabase__query')).toBe('run');
    expect(classifyTool('Read')).toBe('read');
    expect(classifyTool('SomethingNew')).toBe('read');
    expect(classifyTool('TodoWrite')).toBe('meta');
    expect(classifyTool(undefined)).toBe('read');
  });

  it('computes raw bucket xp', () => {
    const raw = bucketRawXp(
      bucket(0, { prompts: 2, stops: 1, tools: { Edit: 3, Read: 4, TodoWrite: 5 } }),
    );
    expect(raw).toEqual({ prompt: 10, stop: 10, tool: 3 * 2 + 4 });
  });
});

describe('creditBucket', () => {
  it('credits a normal turn fully', () => {
    const r = creditBucket(bucket(0, { prompts: 1, stops: 1, tools: { Edit: 3, Read: 5 } }), {
      now: T0 + 30000,
      history: [],
    });
    expect(r.credited).toEqual({ prompt: 5, stop: 10, tool: 11, total: 26 });
    expect(r.dropped).toEqual([]);
    expect(r.entry).toEqual({ minute: T0, prompts: 1, stops: 1, toolXp: 11 });
  });

  it('drops stale and future buckets', () => {
    const stale = creditBucket(bucket(-60 * 25, { prompts: 1 }), { now: T0, history: [] });
    expect(stale.credited.total).toBe(0);
    expect(stale.dropped[0]?.reason).toBe('stale');
    const future = creditBucket(bucket(5, { prompts: 1 }), { now: T0, history: [] });
    expect(future.dropped[0]?.reason).toBe('future');
  });

  it('clamps implausible per-minute counts', () => {
    const r = creditBucket(bucket(0, { prompts: 50, stops: 50, tools: { Read: 500 } }), {
      now: T0,
      history: [],
    });
    expect(r.entry.prompts).toBe(CAPS.bucketMaxPrompts);
    expect(r.entry.stops).toBe(CAPS.bucketMaxStops);
    expect(r.credited.tool).toBeLessThanOrEqual(CAPS.toolXpPerMinute);
    expect(r.dropped.some((d) => d.reason === 'implausible')).toBe(true);
  });

  it('requires a prompt within 30 minutes for tool xp', () => {
    const noContext = creditBucket(bucket(0, { tools: { Edit: 5 } }), { now: T0, history: [] });
    expect(noContext.credited.tool).toBe(0);
    expect(noContext.dropped[0]?.reason).toBe('no_prompt_context');

    const history: CreditedMinute[] = [
      { minute: T0 - 20 * 60000, prompts: 1, stops: 0, toolXp: 0 },
    ];
    const withContext = creditBucket(bucket(0, { tools: { Edit: 5 } }), { now: T0, history });
    expect(withContext.credited.tool).toBe(10);

    const tooOld: CreditedMinute[] = [{ minute: T0 - 40 * 60000, prompts: 1, stops: 0, toolXp: 0 }];
    expect(
      creditBucket(bucket(0, { tools: { Edit: 5 } }), { now: T0, history: tooOld }).credited.tool,
    ).toBe(0);
  });

  it('caps tool xp per minute and makes re-sending a minute idempotent-ish', () => {
    const b = bucket(0, { prompts: 1, tools: { Edit: 20 } }); // 40 raw tool xp
    const first = creditBucket(b, { now: T0, history: [] });
    expect(first.credited.tool).toBe(CAPS.toolXpPerMinute);
    expect(first.dropped.some((d) => d.reason === 'cap_minute')).toBe(true);
    const again = creditBucket(b, { now: T0, history: [first.entry] });
    expect(again.credited.tool).toBe(0);
  });

  it('stops cannot exceed prompts in the hour', () => {
    const r = creditBucket(bucket(0, { prompts: 1, stops: 4 }), { now: T0, history: [] });
    expect(r.entry.stops).toBe(1);
    expect(r.dropped.some((d) => d.reason === 'cap_hour')).toBe(true);
  });

  it('enforces the hourly work cap', () => {
    // 59 previous minutes each with a prompt + stop + 10 tool xp = 25 xp/min -> way over 400
    const history: CreditedMinute[] = [];
    for (let m = 1; m <= 16; m++)
      history.push({ minute: T0 - m * 60000, prompts: 1, stops: 1, toolXp: 10 });
    // 16 * 25 = 400 already
    const r = creditBucket(bucket(0, { prompts: 1, stops: 1, tools: { Edit: 5 } }), {
      now: T0,
      history,
    });
    expect(r.credited.total).toBe(0);
    expect(r.dropped.some((d) => d.reason === 'cap_hour')).toBe(true);
  });

  it('enforces the daily work cap via dayTotals', () => {
    const r = creditBucket(bucket(0, { prompts: 1, stops: 1, tools: { Edit: 5 } }), {
      now: T0,
      history: [],
      dayTotals: { prompts: 10, stops: 10, toolXp: 100, workXp: CAPS.workXpPerDay - 12 },
    });
    // whole events only: the stop (10) no longer fits, the prompt (5) does
    expect(r.credited.total).toBe(5);
    expect(r.credited.total).toBeLessThanOrEqual(12);
    expect(r.dropped.some((d) => d.reason === 'cap_day')).toBe(true);
  });

  it('a scripted 8-hour day cannot beat the daily cap', () => {
    let history: CreditedMinute[] = [];
    let total = 0;
    for (let m = 0; m < 8 * 60; m++) {
      const b = bucket(m, { prompts: 6, stops: 6, tools: { Edit: 60 } });
      const r = creditBucket(b, { now: T0 + m * 60000 + 1000, history });
      total += r.credited.total;
      history = mergeCredited(history, r.entry);
    }
    expect(total).toBeLessThanOrEqual(CAPS.workXpPerDay);
    expect(total).toBeGreaterThan(CAPS.workXpPerDay * 0.9);
  });

  it('a realistic day lands well under the caps', () => {
    // 10 prompts/hour, 12 tools per turn (3 edits), 2.5 hours
    let history: CreditedMinute[] = [];
    let total = 0;
    for (let m = 0; m < 150; m++) {
      const turn = m % 6 === 0;
      const b = bucket(m, turn ? { prompts: 1, stops: 1, tools: { Edit: 3, Read: 9 } } : {});
      const r = creditBucket(b, { now: T0 + m * 60000 + 1000, history });
      total += r.credited.total;
      history = mergeCredited(history, r.entry);
    }
    expect(total).toBe(25 * (5 + 10 + 15));
  });
});

describe('days and streaks', () => {
  it('uses UTC day keys', () => {
    expect(dayKey(T0)).toBe('2026-09-04');
    expect(minuteFloor(T0 + 59999)).toBe(T0);
    expect(daysBetween('2026-09-04', '2026-09-07')).toBe(3);
  });

  it('pays daily + streak bonus and survives weekend gaps', () => {
    let s = { streakDays: 0, lastActiveDay: null as string | null };
    let r = activateDay(s, '2026-09-04');
    expect(r.state.streakDays).toBe(1);
    expect(r.bonus).toBe(BONUS.daily + BONUS.streakPerDay);
    s = r.state;
    expect(activateDay(s, '2026-09-04').bonus).toBe(0); // idempotent same day
    r = activateDay(s, '2026-09-07'); // Fri -> Mon
    expect(r.state.streakDays).toBe(2);
    r = activateDay(r.state, '2026-09-20'); // long gap resets
    expect(r.state.streakDays).toBe(1);
  });

  it('caps the streak bonus at 7 days', () => {
    let s = { streakDays: 0, lastActiveDay: null as string | null };
    let bonus = 0;
    for (let d = 1; d <= 12; d++) {
      const r = activateDay(s, `2026-09-${String(d).padStart(2, '0')}`);
      s = r.state;
      bonus = r.bonus;
    }
    expect(s.streakDays).toBe(12);
    expect(bonus).toBe(BONUS.daily + BONUS.streakPerDay * BONUS.streakMaxDays);
    expect(EVENT_XP.prompt).toBe(5);
  });
});
