import { join } from 'node:path';
import { BrowserWindow, screen, type Display } from 'electron';
import { IPC, type WindowGeometry } from '../../common/ipc.ts';
import { followBounds, stripBounds } from '../display.ts';

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
    const bounds = stripBounds(display, STRIP_HEIGHT_GRID * opts.spriteScale);

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

    this.win.on('move', () => this.broadcastGeometry());
    this.win.on('resize', () => this.broadcastGeometry());

    if (process.platform === 'win32') {
      // Other topmost windows can cover us; re-asserting is cheap.
      this.topmostTimer = setInterval(() => {
        if (!this.win.isDestroyed() && this.win.isVisible())
          this.win.setAlwaysOnTop(true, 'screen-saver');
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
  }

  /** Switch to follow mode around the given anchor (world DIPs). */
  enterFollow(anchor: { x: number; y: number }): void {
    this.mode = 'follow';
    this.win.setBounds(followBounds(anchor, FOLLOW_SIZE_GRID * this.opts.spriteScale), false);
    this.broadcastGeometry();
  }

  /** Move the follow window so that its bottom-center is at the anchor. */
  followTo(anchor: { x: number; y: number }): void {
    if (this.mode !== 'follow') return;
    const b = followBounds(anchor, FOLLOW_SIZE_GRID * this.opts.spriteScale);
    this.win.setPosition(b.x, b.y, false);
  }

  geometry(): WindowGeometry {
    const b = this.win.getBounds();
    const d = screen.getDisplayMatching(b);
    return { ...b, scaleFactor: d.scaleFactor };
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
    this.win.setBounds(stripBounds(this.display, STRIP_HEIGHT_GRID * this.opts.spriteScale), false);
    this.broadcastGeometry();
  }

  private broadcastGeometry(): void {
    if (this.win.isDestroyed()) return;
    this.send(IPC.petWindowMoved, this.geometry());
  }
}
