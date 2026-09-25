import { Menu, Tray, app, type MenuItemConstructorOptions } from 'electron';
import type { Stage } from '@claude-mons/shared';
import type { HookAgent } from '../../common/ipc.ts';
import { CLAUDE_AGENT, CODEX_AGENT, codexDetected } from '../hooks/agents.ts';
import type { HookStatus } from '../hooks/HookInstaller.ts';
import { iconFromSprite } from './icons.ts';

export interface TrayActions {
  setSpriteScale(scale: number): void;
  getSpriteScale(): number;
  togglePetVisible(): void;
  isPetVisible(): boolean;
  /** Recovery action: re-anchors the pet to the primary display and recenters it in its world. */
  bringPetBack(): void;
  /** Starts a battle without the shake gesture (fallback for setups where dragging is unreliable). */
  battleNow(): void;
  /** False until a nation is chosen; gates whether the full pet menu or "Finish setup" shows. */
  hasNation(): boolean;
  openPanel(): void;
  hookStatus(agent: HookAgent): HookStatus;
  toggleHooks(agent: HookAgent): void;
  /** Mirrors `settings.waterReminder.enabled`. */
  waterReminderEnabled(): boolean;
  toggleWaterReminder(): void;
  progressLine(): string;
  quit(): void;
}

/**
 * Tray/context-menu text for one agent's hook item, parametrized by its display label so Claude
 * Code and Codex share the same phrasing. Pure -- `App.ts` has no unit-test harness of its own
 * (Ruling C, `.superpowers/sdd/2026-09-25-codex-integration/task-5-brief.md`), so this is extracted
 * and unit-tested directly in `apps/desktop/test/Tray.test.ts` instead.
 */
export function hookMenuLabel(label: string, status: HookStatus): string {
  switch (status) {
    case 'installed-binary':
      return `● ${label} connected (click to disconnect)`;
    case 'installed-script':
      return `● ${label} connected via script mode (click to disconnect)`;
    case 'partial':
      return `◐ ${label} partially connected (click to repair)`;
    case 'unreadable':
      return `○ Cannot read ${label} settings`;
    default:
      return `○ Connect ${label}`;
  }
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
    if (!this.actions.hasNation()) {
      return [
        { label: 'claude-mons — choose your nation', enabled: false },
        { type: 'separator' },
        { label: 'Finish setup', click: () => this.actions.openPanel() },
        { type: 'separator' },
        { label: `claude-mons v${app.getVersion()}`, enabled: false },
        { label: 'Quit', click: () => this.actions.quit() },
      ];
    }
    const scale = this.actions.getSpriteScale();
    const status = this.actions.hookStatus('claude');
    const hookLabel = hookMenuLabel(CLAUDE_AGENT.label, status);
    // The Codex menu item only appears once a Codex install is actually detected on this machine
    // (`codexHome()`'s directory exists) -- most users won't have one, and there's nothing to
    // connect to otherwise.
    const codexStatus = codexDetected() ? this.actions.hookStatus('codex') : null;
    const codexItems: MenuItemConstructorOptions[] =
      codexStatus
        ? [
            {
              label: hookMenuLabel(CODEX_AGENT.label, codexStatus),
              click: () => this.actions.toggleHooks('codex'),
              enabled: codexStatus !== 'unreadable',
            },
          ]
        : [];
    return [
      { label: this.actions.progressLine(), enabled: false },
      { type: 'separator' },
      { label: 'Open claude-mons', click: () => this.actions.openPanel() },
      {
        label: hookLabel,
        click: () => this.actions.toggleHooks('claude'),
        enabled: status !== 'unreadable',
      },
      ...codexItems,
      { type: 'separator' },
      {
        label: this.actions.isPetVisible() ? 'Hide pet' : 'Show pet',
        click: () => this.actions.togglePetVisible(),
      },
      { label: 'Bring pet back', click: () => this.actions.bringPetBack() },
      { label: 'Battle now', click: () => this.actions.battleNow() },
      {
        label: 'Remind me to drink water',
        type: 'checkbox',
        checked: this.actions.waterReminderEnabled(),
        click: () => this.actions.toggleWaterReminder(),
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
