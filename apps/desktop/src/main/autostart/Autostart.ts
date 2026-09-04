import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';

const LINUX_DESKTOP = 'claude-mons.desktop';

/** Start-on-login: Windows via the registry (Electron API), Linux via ~/.config/autostart. */
export class Autostart {
  async isEnabled(): Promise<boolean> {
    if (process.platform === 'win32') return app.getLoginItemSettings().openAtLogin;
    if (process.platform === 'linux') {
      try {
        await fs.access(this.linuxPath());
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: enabled, args: ['--autostart'] });
      return;
    }
    if (process.platform === 'linux') {
      const path = this.linuxPath();
      if (!enabled) {
        await fs.rm(path, { force: true });
        return;
      }
      const exec = process.env.APPIMAGE ?? process.execPath;
      const entry = [
        '[Desktop Entry]',
        'Type=Application',
        'Name=claude-mons',
        `Exec="${exec}" --autostart`,
        'Icon=claude-mons',
        'Comment=Train your desktop mon by using Claude Code',
        'X-GNOME-Autostart-enabled=true',
        'Terminal=false',
        '',
      ].join('\n');
      await fs.mkdir(join(homedir(), '.config', 'autostart'), { recursive: true });
      await fs.writeFile(path, entry, 'utf8');
    }
  }

  private linuxPath(): string {
    const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
    return join(base, 'autostart', LINUX_DESKTOP);
  }
}
