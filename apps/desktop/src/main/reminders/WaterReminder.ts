import { dayKey } from '@claude-mons/shared';

/** Valid reminder intervals, minutes. */
export type WaterIntervalMin = 30 | 45 | 60 | 90 | 120;

export function isWaterIntervalMin(v: unknown): v is WaterIntervalMin {
  return v === 30 || v === 45 || v === 60 || v === 90 || v === 120;
}

/** Everything `nextDueAt`/`onTick` need to reason about scheduling. Mirrors `LocalState.settings.waterReminder` + `LocalState.water`. */
export interface WaterReminderState {
  enabled: boolean;
  intervalMin: WaterIntervalMin;
  /** Last time the player clicked "Done", or null before the first ever click. */
  lastDoneAt: number | null;
  /**
   * Timestamp the next reminder is deferred until — set by an explicit "Snooze 10 min", and reused
   * (with the normal interval instead of the snooze length) to re-arm after the card auto-hides
   * unanswered. Cleared by `done()`.
   */
  snoozedUntil: number | null;
  /** Sips recorded on `todayKey` (UTC day key, `@claude-mons/shared:dayKey`). */
  todayCount: number;
  todayKey: string;
}

/** Fields `done`/`snooze`/auto-hide re-arm may write back to `LocalState.water`. */
export type WaterReminderPatch = Pick<
  WaterReminderState,
  'lastDoneAt' | 'snoozedUntil' | 'todayCount' | 'todayKey'
>;

export const SNOOZE_MIN = 10;
/** Card auto-hides if ignored this long, then re-arms for the normal interval. */
export const AUTO_HIDE_MS = 5 * 60_000;

/**
 * Pure derivation of the next due timestamp from the reminder's own fields. Not meant to be
 * recomputed on every tick — `now` seeds the "never done yet" anchor, so call it only right after
 * something actually changes the schedule (load, `done()`, an explicit snooze, or an auto-hide
 * re-arm), and cache the result (see `WaterReminder.dueAt`).
 */
export function nextDueAt(state: WaterReminderState, now: number): number {
  if (!state.enabled) return Infinity;
  if (state.snoozedUntil !== null) return state.snoozedUntil;
  const base = state.lastDoneAt ?? now;
  return base + state.intervalMin * 60_000;
}

/** Sips recorded today, resetting to 0 across a UTC day boundary without needing a write. */
export function todayCount(
  state: Pick<WaterReminderState, 'todayCount' | 'todayKey'>,
  now: number,
): number {
  return state.todayKey === dayKey(now) ? state.todayCount : 0;
}

export interface WaterReminderDeps {
  now: () => number;
  getState: () => WaterReminderState;
  /** Persists a patch to `LocalState.water` (never touches `settings.waterReminder`). */
  update: (fn: (patch: WaterReminderPatch) => void) => void;
  /** True while the pet has had no hook events or input for the sleep threshold. */
  isAsleep: () => boolean;
  /** True while a battle is animating. */
  isInBattle: () => boolean;
  onShow: () => void;
  onHide: () => void;
}

/**
 * Scheduling logic for the water reminder, kept free of Electron so it is unit-testable
 * (`apps/desktop/test/WaterReminder.test.ts`). Owns a single cached `dueAt` timestamp plus whether
 * the card is currently shown; `tick()` is meant to be called on a short interval (e.g. every
 * 15 s) by the host.
 */
export class WaterReminder {
  private dueAt: number;
  private shownAt: number | null = null;

  constructor(private readonly deps: WaterReminderDeps) {
    this.dueAt = nextDueAt(this.deps.getState(), this.deps.now());
  }

  /** Whether the card is currently shown. */
  isShowing(): boolean {
    return this.shownAt !== null;
  }

  /** Cached next-due timestamp, or null when the reminder is disabled. */
  getDueAt(): number | null {
    return Number.isFinite(this.dueAt) ? this.dueAt : null;
  }

  /** Call after `settings.waterReminder` changes (enabled toggled, interval changed). */
  onConfigChanged(): void {
    this.reschedule(this.deps.now());
  }

  /** Periodic check: shows the card once due (and awake, and not battling), or auto-hides it. */
  tick(): void {
    const now = this.deps.now();
    if (this.shownAt !== null) {
      if (now - this.shownAt >= AUTO_HIDE_MS) {
        this.shownAt = null;
        this.deps.onHide();
        this.autoRearm(now);
      }
      return;
    }
    const s = this.deps.getState();
    if (!s.enabled) return;
    if (now < this.dueAt) return;
    if (this.deps.isAsleep() || this.deps.isInBattle()) return; // stay due; retried next tick
    this.shownAt = now;
    this.deps.onShow();
  }

  /** "Done": hides the card, records the sip, advances to the next normal interval. */
  done(): void {
    const now = this.deps.now();
    this.deps.update((s) => {
      s.lastDoneAt = now;
      s.snoozedUntil = null;
      const key = dayKey(now);
      s.todayCount = s.todayKey === key ? s.todayCount + 1 : 1;
      s.todayKey = key;
    });
    this.shownAt = null;
    this.deps.onHide();
    this.reschedule(now);
  }

  /** "Snooze 10 min": hides the card and re-arms shortly, without counting a sip. */
  snooze(): void {
    const now = this.deps.now();
    this.deps.update((s) => (s.snoozedUntil = now + SNOOZE_MIN * 60_000));
    this.shownAt = null;
    this.deps.onHide();
    this.reschedule(now);
  }

  /** Development aid (`--dev-water-in <seconds>`): force the next tick to be due soon. */
  devForceDueInSeconds(seconds: number): void {
    this.dueAt = this.deps.now() + seconds * 1000;
  }

  private autoRearm(now: number): void {
    const s = this.deps.getState();
    this.deps.update((patch) => (patch.snoozedUntil = now + s.intervalMin * 60_000));
    this.reschedule(now);
  }

  private reschedule(now: number): void {
    this.dueAt = nextDueAt(this.deps.getState(), now);
  }
}
