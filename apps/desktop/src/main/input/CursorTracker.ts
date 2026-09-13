import type { Hitbox } from '../../common/ipc.ts';
import { pointInRect } from '../display.ts';

/** The parts of the pet window the tracker needs; injected so the tracker is unit-testable. */
export interface TrackedWindow {
  getBounds(): { x: number; y: number; width: number; height: number };
  setIgnoreMouse(ignore: boolean): void;
  /** Current `PetWindow.geometryVersion`; used to discard a hitbox tagged with an older one. */
  getGeometryVersion(): number;
}

export interface CursorSource {
  /** Cursor position in world DIPs. */
  getCursorScreenPoint(): { x: number; y: number };
}

export interface CursorTrackerEvents {
  /** Called at drag-poll rate while dragging with the cursor position in world DIPs. */
  onDragMove(cursor: { x: number; y: number }, t: number): void;
  onHoverChange(hovering: boolean): void;
  /** A tick threw; the tracker forced click-through closed. For debug logging only. */
  onError?(err: unknown): void;
}

/** `pet:hitbox` payload plus the geometry version the renderer had in hand when it computed it. */
export interface HitboxReport {
  hitbox: Hitbox;
  geometryVersion: number;
}

export interface CursorTrackerOptions {
  /** Hz while the cursor is over the window or a drag is active. */
  fastHz: number;
  /** Hz otherwise. */
  slowHz: number;
  /** DIPs added around the hitbox so the edge is grabbable. */
  inflate: number;
  /** A hitbox report older than this (ms) is treated as stale and discarded. */
  hitboxFreshMs: number;
  /** A cursor sample older than this (ms) is treated as stale and discarded. */
  cursorFreshMs: number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  now: () => number;
  debug: boolean;
}

const DEFAULTS: CursorTrackerOptions = {
  fastHz: 60,
  slowHz: 12,
  inflate: 3,
  hitboxFreshMs: 500,
  cursorFreshMs: 250,
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
  now: () => performance.now(),
  debug: false,
};

/**
 * Polls the cursor and toggles click-through on the pet window: the window ignores mouse events
 * except when the cursor is over the sprite's opaque bounding box (reported by the renderer).
 * While a drag is active it streams cursor positions to the host instead.
 *
 * Fail-closed by design (see docs/architecture/overlay-and-input.md "Fail-closed click-through"):
 * the default is always "ignore mouse events", and every tick re-derives and re-asserts the
 * ignore state from scratch — hovering is a report of the last decision, never an input to the
 * next one — so a stuck-open state self-heals within one tick instead of requiring "Bring pet
 * back". Accepting input additionally requires a *fresh* hitbox (`hitboxFreshMs`) tagged with the
 * window's *current* `geometryVersion`, and a fresh cursor sample (`cursorFreshMs`) — any one of
 * those being stale, missing, or mismatched forces click-through back on.
 *
 * Works identically on Windows and Linux because it never relies on `forward: true`.
 */
export class CursorTracker {
  private hitbox: Hitbox = null;
  private hitboxVersion = -1;
  private lastHitboxAt = -Infinity;
  private lastCursorAt = -Infinity;
  private hovering = false;
  private dragging = false;
  private timer: unknown = null;
  private currentHz = 0;
  private readonly opts: CursorTrackerOptions;

  constructor(
    private readonly win: TrackedWindow,
    private readonly cursor: CursorSource,
    private readonly events: CursorTrackerEvents,
    opts: Partial<CursorTrackerOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    // Fail-closed from the first instant, before any tick has ever run.
    this.win.setIgnoreMouse(true);
  }

  start(): void {
    this.schedule(this.opts.slowHz);
  }

  stop(): void {
    if (this.timer !== null) this.opts.clearInterval(this.timer);
    this.timer = null;
    this.currentHz = 0;
  }

  setHitbox(report: HitboxReport): void {
    this.hitbox = report.hitbox;
    this.hitboxVersion = report.geometryVersion;
    this.lastHitboxAt = this.opts.now();
    this.tick();
  }

  isHovering(): boolean {
    return this.hovering;
  }

  isDragging(): boolean {
    return this.dragging;
  }

  beginDrag(): void {
    this.dragging = true;
    // Never flip to click-through mid-drag: the renderer must keep receiving pointer events.
    this.win.setIgnoreMouse(false);
    this.schedule(this.opts.fastHz);
  }

  endDrag(): void {
    this.dragging = false;
    this.tick();
  }

  /**
   * Immediately forces click-through back on and discards the current hitbox, so nothing stale
   * survives a blur, hide, mode switch, or display change until a fresh hitbox tagged with the new
   * geometry version arrives. Idempotent, safe to call any number of times.
   */
  forceIgnore(): void {
    this.hitbox = null;
    this.hitboxVersion = -1;
    this.lastHitboxAt = -Infinity;
    if (this.hovering) {
      this.hovering = false;
      this.events.onHoverChange(false);
    }
    this.win.setIgnoreMouse(true);
    if (this.opts.debug) console.info('[pet] cursor tracker: forced click-through closed');
  }

  /**
   * Whether `point` (world DIPs) would currently be accepted as "over the sprite" — same freshness/
   * version/inflate rules as `tick`'s hover computation, but driven by an explicit point instead of
   * an OS cursor sample. Used by `PetHost` to gate a just-received pointerdown/contextmenu against
   * the possibility that it arrived just after the tracker's own computed state flipped away from
   * "over" (see docs/architecture/overlay-and-input.md "Pointer handling").
   */
  isPointAccepted(point: { x: number; y: number }): boolean {
    const b = this.win.getBounds();
    if (!pointInRect(point, b)) return false;
    if (!this.cursorFresh()) return false;
    const local = { x: point.x - b.x, y: point.y - b.y };
    return this.hitboxAccepted() && pointInRect(local, this.hitbox!, this.opts.inflate);
  }

  /** One poll. Public so tests and IPC handlers can drive it synchronously. */
  tick(): void {
    try {
      const now = this.opts.now();
      const c = this.cursor.getCursorScreenPoint();
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) {
        // The OS cursor point has been observed to come back non-finite for a single sample
        // during very fast pointer movement (e.g. shaking). Drop it rather than feeding NaN into
        // drag math and, downstream, PetWindow's setBounds/setPosition — the next tick tries
        // again. Fail-closed: leave click-through exactly as it was (already the safe default
        // unless a previous good sample turned it off, in which case the next tick re-evaluates).
        return;
      }
      this.lastCursorAt = now;
      if (this.dragging) {
        this.events.onDragMove(c, now);
        return;
      }
      const b = this.win.getBounds();
      const inWindow = pointInRect(c, b);
      const over = inWindow && this.isPointAccepted(c);
      // Re-assert unconditionally every tick, regardless of whether it changed: `hovering` is a
      // record of the last decision for the edge-triggered onHoverChange event below, never an
      // input to this decision. This is what makes a stuck-open state self-heal within one tick
      // instead of needing "Bring pet back" (see class doc comment).
      this.win.setIgnoreMouse(!over);
      if (over !== this.hovering) {
        this.hovering = over;
        this.events.onHoverChange(over);
      }
      this.schedule(inWindow ? this.opts.fastHz : this.opts.slowHz);
    } catch (err) {
      // Any exception anywhere in the tick forces click-through closed rather than leaving
      // whatever the last (possibly wrong) state was.
      this.hovering = false;
      this.win.setIgnoreMouse(true);
      this.events.onError?.(err);
    }
  }

  private hitboxAccepted(): boolean {
    if (this.hitbox === null) return false;
    if (this.opts.now() - this.lastHitboxAt >= this.opts.hitboxFreshMs) return false;
    if (this.hitboxVersion !== this.win.getGeometryVersion()) return false;
    return true;
  }

  private cursorFresh(): boolean {
    return this.opts.now() - this.lastCursorAt < this.opts.cursorFreshMs;
  }

  private schedule(hz: number): void {
    if (hz === this.currentHz && this.timer !== null) return;
    if (this.timer !== null) this.opts.clearInterval(this.timer);
    this.currentHz = hz;
    this.timer = this.opts.setInterval(() => this.tick(), Math.round(1000 / hz));
  }
}
