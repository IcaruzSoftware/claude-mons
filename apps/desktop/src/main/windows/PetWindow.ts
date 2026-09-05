import { join } from 'node:path';
import { BrowserWindow, screen, type Display } from 'electron';
import { IPC, type WindowGeometry } from '../../common/ipc.ts';
import { followBounds, stripBounds, toIntPoint, toIntRect } from '../display.ts';

const DEBUG = process.env.CLAUDE_MONS_DEBUG === '1';

export type PetWindowMode = 'strip' | 'follow';

export interface PetWindowOptions {
  spriteScale: number;
  /** Linux: some WMs break always-on-top for unfocusable windows; make it configurable. */
  focusable: boolean;
}

/** Height of the strip window in grid pixels (before scaling): room for an adult + FX above it. */
export const STRIP_HEIGHT_GRID = 80;
/** Side length of the follow window in grid pixels. */
export const FOLLOW_SIZE_GRID = 80;

/**
 * The transparent always-on-top window the pet lives in.
 *
 * Two modes:
 * - strip: spans the work-area width along the bottom edge; the pet walks inside without the
 *   window moving (no hop glitches, hit-testing stays trivial).
 * - follow: a small square that is moved by the main process every frame while the pet is dragged
 *   or falling, so the pet can leave the strip.
 */
export class PetWindow {
  readonly win: BrowserWindow;
  private mode: PetWindowMode = 'strip';
  private display: Display;
  private readonly opts: PetWindowOptions;
  private topmostTimer: NodeJS.Timeout | null = null;

  constructor(display: Display, opts: PetWindowOptions) {
    this.display = display;
    this.opts = opts;
    // Falls back to a small on-screen rect in the pathological case where the display's work area
    // itself comes back non-finite; BrowserWindow's constructor cannot be skipped like the other
    // setBounds/setPosition calls below can.
    const bounds = toIntRect(stripBounds(display, STRIP_HEIGHT_GRID * opts.spriteScale)) ?? {
      x: 0,
      y: 0,
      width: 800,
      height: 240,
    };

    this.win = new BrowserWindow({
      ...bounds,
      show: false,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      focusable: opts.focusable,
      title: 'claude-mons pet',
      ...(process.platform === 'linux' ? { type: 'toolbar' as const } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.setIgnoreMouseEvents(true);
    this.win.setMenu(null);

    // Kept as a safety net for any bounds change this class did not initiate directly (there
    // shouldn't be any, since resizable/movable are both false, but broadcasting on the native
    // event costs nothing extra when a call site already broadcast the same geometry itself).
    this.win.on('move', () => this.broadcastGeometry());
    this.win.on('resize', () => this.broadcastGeometry());

    if (process.platform === 'win32') {
      // Other topmost windows can cover us; re-asserting is cheap. moveTop() also helps on
      // Windows, where a non-focusable topmost window can still end up behind another topmost
      // window depending on z-order history (see reassertTopmost()).
      this.topmostTimer = setInterval(() => {
        if (!this.win.isDestroyed() && this.win.isVisible()) this.reassertTopmost();
      }, 5000);
    }
    this.win.on('closed', () => {
      if (this.topmostTimer) clearInterval(this.topmostTimer);
    });
  }

  load(): void {
    if (process.env.ELECTRON_RENDERER_URL) {
      void this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pet/index.html`);
    } else {
      void this.win.loadFile(join(__dirname, '../renderer/pet/index.html'));
    }
  }

  show(): void {
    this.win.showInactive();
    this.reassertTopmost();
    this.broadcastGeometry();
  }

  getMode(): PetWindowMode {
    return this.mode;
  }

  getDisplay(): Display {
    return this.display;
  }

  /** Re-anchor the strip to a display (after a drop on another monitor or display changes). */
  setDisplay(display: Display): void {
    this.display = display;
    if (this.mode === 'strip') this.applyStrip();
  }

  setSpriteScale(scale: number): void {
    this.opts.spriteScale = scale;
    if (this.mode === 'strip') this.applyStrip();
  }

  enterStrip(): void {
    this.mode = 'strip';
    this.applyStrip();
    this.reassertTopmost();
  }

  /** Switch to follow mode around the given anchor (world DIPs). */
  enterFollow(anchor: { x: number; y: number }): void {
    this.mode = 'follow';
    this.setBoundsSafe(followBounds(anchor, FOLLOW_SIZE_GRID * this.opts.spriteScale));
    this.reassertTopmost();
  }

  /**
   * Move the follow window so that its bottom-center is at the anchor. Called once per drag
   * frame; only ever repositions (never resizes) so there is nothing for the OS to redraw beyond
   * a plain move.
   */
  followTo(anchor: { x: number; y: number }): void {
    if (this.mode !== 'follow') return;
    const b = followBounds(anchor, FOLLOW_SIZE_GRID * this.opts.spriteScale);
    if (!this.setPositionSafe(b)) return;
    // Broadcast the geometry we just *commanded* synchronously, rather than waiting for the
    // native 'move' event: that event can lag a frame behind the actual OS move, during which the
    // renderer would otherwise paint against last frame's window origin while the window itself
    // has already moved, producing a one-frame offset/flicker.
    this.send(IPC.petWindowMoved, this.geometryFor(b));
  }

  geometry(): WindowGeometry {
    return this.geometryFor(this.win.getBounds());
  }

  setIgnoreMouse(ignore: boolean): void {
    if (this.win.isDestroyed()) return;
    if (ignore) this.win.setIgnoreMouseEvents(true);
    else this.win.setIgnoreMouseEvents(false);
  }

  send(channel: string, payload: unknown): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  private applyStrip(): void {
    this.setBoundsSafe(stripBounds(this.display, STRIP_HEIGHT_GRID * this.opts.spriteScale));
  }

  private geometryFor(b: { x: number; y: number; width: number; height: number }): WindowGeometry {
    const d = screen.getDisplayMatching(b);
    return { ...b, scaleFactor: d.scaleFactor };
  }

  private broadcastGeometry(): void {
    if (this.win.isDestroyed()) return;
    this.send(IPC.petWindowMoved, this.geometry());
  }

  /**
   * Every `setBounds`/`setPosition`/`setSize` call on `this.win` must go through one of these two
   * helpers (bug: a fractional or non-finite coordinate reaching Electron's native binding throws
   * "Error processing argument at index 0, conversion failure" and crashes the whole process —
   * see docs/architecture/overlay-and-input.md). Both round to the nearest integer and skip the
   * call (logging in debug builds) instead of ever forwarding a bad value.
   */
  private setBoundsSafe(rect: { x: number; y: number; width: number; height: number }): boolean {
    const r = toIntRect(rect);
    if (!r) {
      if (DEBUG) console.warn('[pet] skipped setBounds: non-finite rect', JSON.stringify(rect));
      return false;
    }
    this.win.setBounds(r, false);
    this.broadcastGeometry();
    return true;
  }

  private setPositionSafe(point: { x: number; y: number }): boolean {
    const p = toIntPoint(point);
    if (!p) {
      if (DEBUG) console.warn('[pet] skipped setPosition: non-finite point', JSON.stringify(point));
      return false;
    }
    this.win.setPosition(p.x, p.y, false);
    return true;
  }

  /** Windows: a non-focusable topmost window can still lose its place to another topmost window
   *  (e.g. after a mode switch or the drop window regaining z-order); re-asserting both the flag
   *  and the actual z-order position is cheap and fixes it. */
  private reassertTopmost(): void {
    if (this.win.isDestroyed()) return;
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.moveTop();
  }
}
