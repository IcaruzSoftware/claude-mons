import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';

const WIDTH = 260;
const HEIGHT = 110;

/**
 * Small frameless always-on-top card shown next to the pet by `WaterReminder`
 * (`apps/desktop/src/main/reminders/WaterReminder.ts`). Same family as `HoverCardWindow`, but
 * interactive (Done / Snooze buttons), so — unlike the hover card — it does not ignore mouse
 * events and is never click-through. Created once, shown/hidden as needed; there is only ever one.
 */
export class ReminderWindow {
  private win: BrowserWindow | null = null;

  /** Show the card above `anchor` (world DIPs; same shape as `PetHost.spriteAnchorInfo()`). */
  show(anchor: { x: number; y: number; spriteTop: number }): void {
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

  hide(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  isVisible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  /** For `--capture`: the underlying BrowserWindow, if it has ever been created. */
  browserWindow(): BrowserWindow | null {
    return this.win;
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
    win.setMenu(null);
    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/reminder/index.html`);
    } else {
      void win.loadFile(join(__dirname, '../renderer/reminder/index.html'));
    }
    this.win = win;
    return win;
  }
}
