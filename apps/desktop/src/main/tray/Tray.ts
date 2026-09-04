import { Menu, Tray, app, type MenuItemConstructorOptions } from 'electron';
import type { Stage } from '@claude-mons/shared';
import type { HookStatus } from '../hooks/HookInstaller.ts';
import { iconFromSprite } from './icons.ts';

export interface TrayActions {
  setSpriteScale(scale: number): void;
  getSpriteScale(): number;
  togglePetVisible(): void;
  isPetVisible(): boolean;
  openPanel(): void;
  hookStatus(): HookStatus;
  toggleHooks(): void;
  progressLine(): string;
  quit(): void;
}

/** System tray icon + menu. The same menu is used for right-clicks on the pet. */
export class AppTray {
  private tray: Tray | null = null;
  private tooltip = 'claude-mons';

  constructor(private readonly actions: TrayActions) {}

  create(speciesId: string | null, stage: Stage): void {
    try {
      const size = process.platform === 'win32' ? 16 : 22;
      this.tray = new Tray(iconFromSprite(speciesId, stage, size));
      this.tray.setToolTip(this.tooltip);
      this.tray.setContextMenu(this.buildMenu());
      this.tray.on('click', () => this.actions.openPanel());
    } catch (err) {
      // Linux without a StatusNotifier host: the right-click menu on the pet remains available.
      console.warn('tray unavailable:', err);
    }
  }

  updateIcon(speciesId: string | null, stage: Stage): void {
    if (!this.tray) return;
    const size = process.platform === 'win32' ? 16 : 22;
    try {
      this.tray.setImage(iconFromSprite(speciesId, stage, size));
    } catch (err) {
      console.warn('tray icon update failed:', err);
    }
  }

  setTooltip(text: string): void {
    this.tooltip = text;
    this.tray?.setToolTip(text);
    this.refreshMenu();
  }

  refreshMenu(): void {
    this.tray?.setContextMenu(this.buildMenu());
  }

  buildMenu(): Menu {
    return Menu.buildFromTemplate(this.template());
  }

  popup(): void {
    this.buildMenu().popup();
  }

  private template(): MenuItemConstructorOptions[] {
    const scale = this.actions.getSpriteScale();
    const status = this.actions.hookStatus();
    const hookLabel =
      status === 'installed'
        ? '● Claude Code connected (click to disconnect)'
        : status === 'partial'
          ? '◐ Claude Code partially connected (click to repair)'
          : status === 'unreadable'
            ? '○ Cannot read Claude settings.json'
            : '○ Connect Claude Code';
    return [
      { label: this.actions.progressLine(), enabled: false },
      { type: 'separator' },
      { label: 'Open claude-mons', click: () => this.actions.openPanel() },
      {
        label: hookLabel,
        click: () => this.actions.toggleHooks(),
        enabled: status !== 'unreadable',
      },
      { type: 'separator' },
      {
        label: this.actions.isPetVisible() ? 'Hide pet' : 'Show pet',
        click: () => this.actions.togglePetVisible(),
      },
      {
        label: 'Sprite size',
        submenu: [2, 3, 4].map((s) => ({
          label: `${s}x`,
          type: 'radio',
          checked: scale === s,
          click: () => this.actions.setSpriteScale(s),
        })),
      },
      { type: 'separator' },
      { label: `claude-mons v${app.getVersion()}`, enabled: false },
      { label: 'Quit', click: () => this.actions.quit() },
    ];
  }
}
