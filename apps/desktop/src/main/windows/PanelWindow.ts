import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';

export interface PanelMemory {
  x: number;
  y: number;
}

/**
 * The main UI window: nation selection, mon stats, leaderboard, battles, settings.
 * Created lazily, hidden instead of closed, remembers its position.
 */
export class PanelWindow {
  private win: BrowserWindow | null = null;

  constructor(
    private readonly memory: () => PanelMemory | null,
    private readonly remember: (m: PanelMemory) => void,
  ) {}

  get browserWindow(): BrowserWindow | null {
    return this.win;
  }

  isVisible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  show(route?: string): void {
    const win = this.ensure();
    if (route) win.webContents.send('ui:route', route);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  hide(): void {
    this.win?.hide();
  }

  toggle(): void {
    if (this.isVisible()) this.hide();
    else this.show();
  }

  send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const mem = this.memory();
    const width = 440;
    const height = 660;
    let x: number | undefined;
    let y: number | undefined;
    if (mem) {
      const d = screen.getDisplayNearestPoint({ x: mem.x, y: mem.y });
      const wa = d.workArea;
      x = Math.min(Math.max(mem.x, wa.x), wa.x + wa.width - width);
      y = Math.min(Math.max(mem.y, wa.y), wa.y + wa.height - height);
    }
    const win = new BrowserWindow({
      width,
      height,
      minWidth: 380,
      minHeight: 520,
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
      show: false,
      title: 'claude-mons',
      autoHideMenuBar: true,
      backgroundColor: '#14161c',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    win.setMenu(null);
    win.on('close', (e) => {
      // keep the window around; quitting happens via tray/settings
      e.preventDefault();
      win.hide();
    });
    win.on('moved', () => {
      const b = win.getBounds();
      this.remember({ x: b.x, y: b.y });
    });
    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/panel/index.html`);
    } else {
      void win.loadFile(join(__dirname, '../renderer/panel/index.html'));
    }
    this.win = win;
    return win;
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.removeAllListeners('close');
      this.win.destroy();
    }
    this.win = null;
  }
}
