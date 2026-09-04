import { app } from 'electron';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'up-to-date' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'error'; message: string };

/**
 * Auto-update via GitHub Releases (electron-updater). NSIS and AppImage update in place; the
 * .deb build cannot, so it only reports availability. Disabled in development.
 */
export class Updater {
  private status: UpdateStatus = { kind: 'idle' };
  private listeners: Array<(s: UpdateStatus) => void> = [];
  private timer: NodeJS.Timeout | null = null;

  onStatus(cb: (s: UpdateStatus) => void): void {
    this.listeners.push(cb);
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  async start(): Promise<void> {
    if (!app.isPackaged) {
      this.set({ kind: 'unsupported', reason: 'development build' });
      return;
    }
    if (process.platform === 'linux' && !process.env.APPIMAGE) {
      this.set({ kind: 'unsupported', reason: 'deb installs update via the package manager' });
      return;
    }
    try {
      const { autoUpdater } = await import('electron-updater');
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('checking-for-update', () => this.set({ kind: 'checking' }));
      autoUpdater.on('update-available', (info) =>
        this.set({ kind: 'available', version: info.version }),
      );
      autoUpdater.on('update-not-available', () => this.set({ kind: 'up-to-date' }));
      autoUpdater.on('update-downloaded', (info) =>
        this.set({ kind: 'downloaded', version: info.version }),
      );
      autoUpdater.on('error', (err) =>
        this.set({ kind: 'error', message: String(err?.message ?? err) }),
      );
      const check = () => autoUpdater.checkForUpdates().catch(() => {});
      setTimeout(check, 30_000);
      this.timer = setInterval(check, 6 * 60 * 60 * 1000);
    } catch (err) {
      this.set({ kind: 'error', message: String(err) });
    }
  }

  async checkNow(): Promise<void> {
    if (!app.isPackaged) return;
    try {
      const { autoUpdater } = await import('electron-updater');
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.set({ kind: 'error', message: String(err) });
    }
  }

  async quitAndInstall(): Promise<void> {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.quitAndInstall();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private set(s: UpdateStatus): void {
    this.status = s;
    for (const l of this.listeners) l(s);
  }
}
