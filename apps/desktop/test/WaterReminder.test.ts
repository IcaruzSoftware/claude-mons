import { describe, expect, it } from 'vitest';
import {
  AUTO_HIDE_MS,
  SNOOZE_MIN,
  WaterReminder,
  isWaterIntervalMin,
  nextDueAt,
  todayCount,
  type WaterReminderPatch,
  type WaterReminderState,
} from '../src/main/reminders/WaterReminder.ts';

const HOUR = 60 * 60_000;
const MIN = 60_000;

function state(overrides: Partial<WaterReminderState> = {}): WaterReminderState {
  return {
    enabled: true,
    intervalMin: 60,
    lastDoneAt: null,
    snoozedUntil: null,
    todayCount: 0,
    todayKey: '',
    ...overrides,
  };
}

/** Builds a WaterReminder wired to a mutable in-memory state + fake clock, for deterministic tests. */
function harness(initial: WaterReminderState = state()) {
  let clock = 0;
  let s = { ...initial };
  let asleep = false;
  let inBattle = false;
  let shown = 0;
  let hidden = 0;

  const reminder = new WaterReminder({
    now: () => clock,
    getState: () => s,
    update: (fn) => {
      const patch: WaterReminderPatch = {
        lastDoneAt: s.lastDoneAt,
        snoozedUntil: s.snoozedUntil,
        todayCount: s.todayCount,
        todayKey: s.todayKey,
      };
      fn(patch);
      s = { ...s, ...patch };
    },
    isAsleep: () => asleep,
    isInBattle: () => inBattle,
    onShow: () => shown++,
    onHide: () => hidden++,
  });

  return {
    reminder,
    setClock: (t: number) => (clock = t),
    advance: (ms: number) => (clock += ms),
    setAsleep: (v: boolean) => (asleep = v),
    setInBattle: (v: boolean) => (inBattle = v),
    get state() {
      return s;
    },
    get shownCount() {
      return shown;
    },
    get hiddenCount() {
      return hidden;
    },
  };
}

describe('nextDueAt', () => {
  it('never due while disabled', () => {
    expect(nextDueAt(state({ enabled: false }), 0)).toBe(Infinity);
  });

  it('is due one interval after now when never done and never snoozed', () => {
    expect(nextDueAt(state({ intervalMin: 30 }), 1000)).toBe(1000 + 30 * MIN);
  });

  it('is due one interval after the last done', () => {
    const s = state({ intervalMin: 45, lastDoneAt: 5000 });
    expect(nextDueAt(s, 999_999)).toBe(5000 + 45 * MIN);
  });

  it('a snooze/re-arm timestamp wins over lastDoneAt', () => {
    const s = state({ lastDoneAt: 0, snoozedUntil: 12_345 });
    expect(nextDueAt(s, 0)).toBe(12_345);
  });
});

describe('isWaterIntervalMin', () => {
  it('accepts only the five offered intervals', () => {
    for (const v of [30, 45, 60, 90, 120]) expect(isWaterIntervalMin(v)).toBe(true);
    const invalid: unknown[] = [0, 15, 61, 121, '60', null, undefined];
    for (const v of invalid) expect(isWaterIntervalMin(v)).toBe(false);
  });
});

describe('WaterReminder.tick', () => {
  it('does not show before the interval has elapsed', () => {
    const h = harness(state({ intervalMin: 60 }));
    h.setClock(59 * MIN);
    h.reminder.tick();
    expect(h.shownCount).toBe(0);
    expect(h.reminder.isShowing()).toBe(false);
  });

  it('shows once due', () => {
    const h = harness(state({ intervalMin: 60 }));
    h.setClock(60 * MIN);
    h.reminder.tick();
    expect(h.shownCount).toBe(1);
    expect(h.reminder.isShowing()).toBe(true);
  });

  it('never shows a second card while one is already showing', () => {
    const h = harness(state({ intervalMin: 60 }));
    h.setClock(60 * MIN);
    h.reminder.tick();
    h.advance(MIN);
    h.reminder.tick();
    h.reminder.tick();
    expect(h.shownCount).toBe(1);
  });

  it('does not show while enabled is false, even past due', () => {
    const h = harness(state({ enabled: false, intervalMin: 60 }));
    h.setClock(10 * HOUR);
    h.reminder.tick();
    expect(h.shownCount).toBe(0);
    expect(h.reminder.getDueAt()).toBeNull();
  });

  it('skips showing while the pet is asleep, and shows once it wakes', () => {
    const h = harness(state({ intervalMin: 60 }));
    h.setAsleep(true);
    h.setClock(60 * MIN);
    h.reminder.tick();
    expect(h.shownCount).toBe(0);
    h.advance(5 * MIN);
    h.reminder.tick();
    expect(h.shownCount).toBe(0); // still asleep
    h.setAsleep(false);
    h.reminder.tick();
    expect(h.shownCount).toBe(1);
  });

  it('skips showing during a battle, and shows once it ends', () => {
    const h = harness(state({ intervalMin: 60 }));
    h.setInBattle(true);
    h.setClock(60 * MIN);
    h.reminder.tick();
    expect(h.shownCount).toBe(0);
    h.setInBattle(false);
    h.reminder.tick();
    expect(h.shownCount).toBe(1);
  });

  it('auto-hides an ignored card after AUTO_HIDE_MS and re-arms for the normal interval', () => {
    const h = harness(state({ intervalMin: 60 }));
    h.setClock(60 * MIN);
    h.reminder.tick(); // shows at t = 60 min
    expect(h.reminder.isShowing()).toBe(true);

    h.advance(AUTO_HIDE_MS - 1);
    h.reminder.tick();
    expect(h.reminder.isShowing()).toBe(true); // not yet

    h.advance(1);
    h.reminder.tick(); // now >= shownAt + AUTO_HIDE_MS
    expect(h.reminder.isShowing()).toBe(false);
    expect(h.hiddenCount).toBe(1);
    const rearmAt = 60 * MIN + AUTO_HIDE_MS + 60 * MIN;
    expect(h.reminder.getDueAt()).toBe(rearmAt);
    expect(h.state.snoozedUntil).toBe(rearmAt);

    // Does not fire again before the re-armed time.
    h.setClock(rearmAt - 1);
    h.reminder.tick();
    expect(h.shownCount).toBe(1);
    h.setClock(rearmAt);
    h.reminder.tick();
    expect(h.shownCount).toBe(2);
  });
});

describe('WaterReminder.done', () => {
  it('hides the card, records lastDoneAt, clears any snooze, and re-arms one interval out', () => {
    const h = harness(state({ intervalMin: 30, snoozedUntil: 999 }));
    h.setClock(10_000);
    h.reminder.done();
    expect(h.hiddenCount).toBe(1);
    expect(h.reminder.isShowing()).toBe(false);
    expect(h.state.lastDoneAt).toBe(10_000);
    expect(h.state.snoozedUntil).toBeNull();
    expect(h.reminder.getDueAt()).toBe(10_000 + 30 * MIN);
  });

  it('increments todayCount within the same UTC day, resets on a new day', () => {
    const h = harness(state());
    const day1 = Date.UTC(2026, 8, 9, 8, 0, 0);
    h.setClock(day1);
    h.reminder.done();
    expect(h.state.todayCount).toBe(1);
    h.advance(HOUR);
    h.reminder.done();
    expect(h.state.todayCount).toBe(2);

    const day2 = Date.UTC(2026, 8, 10, 1, 0, 0);
    h.setClock(day2);
    h.reminder.done();
    expect(h.state.todayCount).toBe(1);
    expect(h.state.todayKey).toBe('2026-09-10');
  });

  it('todayCount() reads back 0 for a day that has not recorded a sip yet, without mutating state', () => {
    const day1 = Date.UTC(2026, 8, 9, 8, 0, 0);
    const s = state({ todayKey: '2026-09-09', todayCount: 3 });
    expect(todayCount(s, day1)).toBe(3);
    const nextDay = Date.UTC(2026, 8, 10, 0, 0, 1);
    expect(todayCount(s, nextDay)).toBe(0);
    expect(s.todayCount).toBe(3); // unchanged; todayCount() is a pure read
  });
});

describe('WaterReminder.snooze', () => {
  it('hides the card without counting a sip, and re-arms SNOOZE_MIN minutes out', () => {
    const h = harness(state({ intervalMin: 60 }));
    h.setClock(60 * MIN);
    h.reminder.tick();
    expect(h.reminder.isShowing()).toBe(true);

    h.reminder.snooze();
    expect(h.hiddenCount).toBe(1);
    expect(h.reminder.isShowing()).toBe(false);
    expect(h.state.todayCount).toBe(0);
    expect(h.state.lastDoneAt).toBeNull();
    expect(h.reminder.getDueAt()).toBe(60 * MIN + SNOOZE_MIN * MIN);

    // Does not reappear before the snooze elapses.
    h.advance(SNOOZE_MIN * MIN - 1);
    h.reminder.tick();
    expect(h.reminder.isShowing()).toBe(false);
    h.advance(1);
    h.reminder.tick();
    expect(h.reminder.isShowing()).toBe(true);
  });
});

describe('WaterReminder.onConfigChanged', () => {
  it('reschedules against a newly-shortened interval', () => {
    const h = harness(state({ intervalMin: 120, lastDoneAt: 0 }));
    expect(h.reminder.getDueAt()).toBe(120 * MIN);
    h.state.intervalMin = 30;
    h.reminder.onConfigChanged();
    expect(h.reminder.getDueAt()).toBe(30 * MIN);
  });

  it('disabling makes the due date null even mid-cycle', () => {
    const h = harness(state({ intervalMin: 60, lastDoneAt: 0 }));
    h.state.enabled = false;
    h.reminder.onConfigChanged();
    expect(h.reminder.getDueAt()).toBeNull();
  });
});

describe('WaterReminder.devForceDueInSeconds', () => {
  it('brings the due date forward for a quick manual/capture test', () => {
    const h = harness(state({ intervalMin: 60 }));
    h.setClock(0);
    h.reminder.devForceDueInSeconds(5);
    expect(h.reminder.getDueAt()).toBe(5000);
    h.setClock(5000);
    h.reminder.tick();
    expect(h.reminder.isShowing()).toBe(true);
  });
});
