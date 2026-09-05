import type { Hitbox } from '../../common/ipc.ts';
import { pointInRect } from '../display.ts';

/** The parts of the pet window the tracker needs; injected so the tracker is unit-testable. */
export interface TrackedWindow {
  getBounds(): { x: number; y: number; width: number; height: number };
  setIgnoreMouse(ignore: boolean): void;
}

export interface CursorSource {
  /** Cursor position in world DIPs. */
  getCursorScreenPoint(): { x: number; y: number };
}

export interface CursorTrackerEvents {
  /** Called at drag-poll rate while dragging with the cursor position in world DIPs. */
  onDragMove(cursor: { x: number; y: number }, t: number): void;
  onHoverChange(hovering: boolean): void;
}

export interface CursorTrackerOptions {
  /** Hz while the cursor is over the window or a drag is active. */
  fastHz: number;
  /** Hz otherwise. */
  slowHz: number;
  /** DIPs added around the hitbox so the edge is grabbable. */
  inflate: number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  now: () => number;
}

const DEFAULTS: CursorTrackerOptions = {
  fastHz: 60,
  slowHz: 12,
  inflate: 3,
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
  now: () => performance.now(),
};

/**
 * Polls the cursor and toggles click-through on the pet window: the window ignores mouse events
 * except when the cursor is over the sprite's opaque bounding box (reported by the renderer).
 * While a drag is active it streams cursor positions to the host instead.
 *
 * Works identically on Windows and Linux because it never relies on `forward: true`.
 */
export class CursorTracker {
  private hitbox: Hitbox = null;
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
  }

  start(): void {
    this.schedule(this.opts.slowHz);
  }

  stop(): void {
    if (this.timer !== null) this.opts.clearInterval(this.timer);
    this.timer = null;
    this.currentHz = 0;
  }

  setHitbox(hitbox: Hitbox): void {
    this.hitbox = hitbox;
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

  /** One poll. Public so tests and IPC handlers can drive it synchronously. */
  tick(): void {
    const c = this.cursor.getCursorScreenPoint();
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) {
      // The OS cursor point has been observed to come back non-finite for a single sample during
      // very fast pointer movement (e.g. shaking). Drop it rather than feeding NaN into drag math
      // and, downstream, PetWindow's setBounds/setPosition — the next tick tries again.
      return;
    }
    if (this.dragging) {
      this.events.onDragMove(c, this.opts.now());
      return;
    }
    const b = this.win.getBounds();
    const local = { x: c.x - b.x, y: c.y - b.y };
    const inWindow = pointInRect(c, b);
    const over =
      inWindow && this.hitbox !== null && pointInRect(local, this.hitbox, this.opts.inflate);
    if (over !== this.hovering) {
      this.hovering = over;
      this.win.setIgnoreMouse(!over);
      this.events.onHoverChange(over);
    }
    this.schedule(inWindow ? this.opts.fastHz : this.opts.slowHz);
  }

  private schedule(hz: number): void {
    if (hz === this.currentHz && this.timer !== null) return;
    if (this.timer !== null) this.opts.clearInterval(this.timer);
    this.currentHz = hz;
    this.timer = this.opts.setInterval(() => this.tick(), Math.round(1000 / hz));
  }
}
