import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';

const WIDTH = 240;
const HEIGHT = 92;

/**
 * Compact stats card shown after hovering the pet for a moment. A frameless, non-focusable,
 * click-through window positioned above the sprite. Created once, shown/hidden as needed.
 */
export class HoverCardWindow {
  private win: BrowserWindow | null = null;
  private showTimer: NodeJS.Timeout | null = null;

  /** Schedule showing the card above `anchor` (world DIPs) after `delayMs`. */
  scheduleShow(anchor: { x: number; y: number; spriteTop: number }, delayMs: number): void {
    this.cancel();
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      this.showAt(anchor);
    }, delayMs);
  }

  cancel(): void {
    if (this.showTimer) clearTimeout(this.showTimer);
    this.showTimer = null;
  }

  hide(): void {
    this.cancel();
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  isVisible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  private showAt(anchor: { x: number; y: number; spriteTop: number }): void {
    const win = this.ensure();
    const d = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
    const wa = d.workArea;
    let x = Math.round(anchor.x - WIDTH / 2);
    x = Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - WIDTH - 4);
    let y = Math.round(anchor.spriteTop - HEIGHT - 12);
    if (y < wa.y + 4) y = Math.round(anchor.y + 12);
    win.setBounds({ x, y, width: WIDTH, height: HEIGHT }, false);
    win.showInactive();
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      hasShadow: false,
      ...(process.platform === 'linux' ? { type: 'toolbar' as const } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.setMenu(null);
    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/hovercard/index.html`);
    } else {
      void win.loadFile(join(__dirname, '../renderer/hovercard/index.html'));
    }
    this.win = win;
    return win;
  }
}
