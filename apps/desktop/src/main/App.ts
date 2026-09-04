import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, dialog, ipcMain, shell } from 'electron';
import { isNation, type HookEnvelope, type Nation, type Stage } from '@claude-mons/shared';
import { IPC, type HookStatusValue, type UiSnapshot } from '../common/ipc.ts';
import { PetHost } from './PetHost.ts';
import { rememberAnchor } from './display.ts';
import { GameService } from './game/GameService.ts';
import { rollSpeciesForNation } from './game/species.ts';
import { ActivityTracker } from './hooks/ActivityTracker.ts';
import { HookInstaller, claudeSettingsPath, type HookStatus } from './hooks/HookInstaller.ts';
import { HookServer } from './hooks/HookServer.ts';
import { SpoolDrainer } from './hooks/SpoolDrainer.ts';
import { ensureHookBinary } from './hooks/binary.ts';
import { JsonStore } from './persistence/JsonStore.ts';
import { MIGRATIONS, defaultState, type LocalState } from './persistence/state.ts';
import {
  ScriptRunner,
  parseCaptureArg,
  parseDevNationArg,
  parseSimulateArg,
} from './sim/ScriptRunner.ts';
import { HoverCardWindow } from './windows/HoverCardWindow.ts';
import { PanelWindow } from './windows/PanelWindow.ts';

/** Until the Supabase backend (Phase 4) is wired in, hatching/evolution are decided locally. */
const LOCAL_GAME = true;
const HOVER_DELAY_MS = 1000;

/** Wires all main-process services together. One instance per app. */
export class App {
  readonly home = app.getPath('userData');
  readonly store = new JsonStore<LocalState>({
    path: join(this.home, 'state.json'),
    defaults: defaultState,
    migrations: MIGRATIONS,
  });
  host!: PetHost;
  game!: GameService;
  readonly panel = new PanelWindow(
    () => this.store.get().ui.panel,
    (m) => this.store.update((s) => (s.ui.panel = m)),
  );
  readonly hoverCard = new HoverCardWindow();
  private readonly activity = new ActivityTracker();
  private hookServer!: HookServer;
  private spool!: SpoolDrainer;
  private installer: HookInstaller | null = null;
  private hookStatus: HookStatus | 'no-binary' = 'no-binary';
  private sim: ScriptRunner | null = null;

  async start(): Promise<void> {
    const state = await this.store.load();

    this.game = new GameService(this.store, {
      localGame: LOCAL_GAME,
      rollSpecies: (nation, seed) => rollSpeciesForNation(nation as Nation | null, seed),
    });

    this.host = new PetHost(
      {
        stage: state.progress.stage,
        speciesId: state.pet.speciesId,
        nation: state.profile.nation,
        spriteScale: state.settings.spriteScale,
        anchorMemory: state.behavior.anchor,
        seed: state.pet.seed,
      },
      {
        onSpriteScale: (scale) => {
          this.store.update((s) => (s.settings.spriteScale = scale as 2 | 3 | 4));
          this.pushSnapshot();
        },
        onAnchor: (display, x) =>
          this.store.update((s) => (s.behavior.anchor = rememberAnchor(display, x))),
        onHover: (hovering, anchor) => {
          if (hovering && this.store.get().profile.nation) {
            this.hoverCard.scheduleShow(anchor, HOVER_DELAY_MS);
          } else {
            this.hoverCard.hide();
          }
        },
        onClick: () => this.panel.toggle(),
        onPanel: () => this.panel.show(),
        hooks: {
          status: () => (this.hookStatus === 'no-binary' ? 'not-installed' : this.hookStatus),
          toggle: () => void this.toggleHooks(),
        },
        progressLine: () => this.progressLine(),
      },
    );
    this.registerUiIpc();
    this.host.start();
    this.wireGameEvents();

    // Hooks: endpoint + spool + binary + installer
    this.hookServer = new HookServer({ home: this.home, onEvent: (e) => this.onHookEvent(e) });
    await this.hookServer.start();
    this.spool = new SpoolDrainer(this.home, (e) => this.onHookEvent(e));
    this.spool.start();
    const binary = await ensureHookBinary(this.home).catch((err) => {
      console.warn('hook binary unavailable:', err);
      return null;
    });
    if (binary) {
      this.installer = new HookInstaller({
        settingsPath: claudeSettingsPath(),
        binaryPath: binary,
        homeDir: this.home,
      });
      this.hookStatus = await this.installer.status().catch(() => 'unreadable' as const);
      this.host.tray.refreshMenu();
    }

    // First launch: open the panel so the player can pick a nation.
    if (!state.profile.nation) this.panel.show();

    const simPath = parseSimulateArg(process.argv);
    if (simPath) {
      this.sim = ScriptRunner.fromFile(simPath)?.withSender((s) => this.host.stimulate(s)) ?? null;
      setTimeout(() => this.sim?.start(), 1500);
    }
    const devNation = parseDevNationArg(process.argv);
    if (devNation && !app.isPackaged) setTimeout(() => this.chooseNation(devNation), 1000);

    const capturePath = parseCaptureArg(process.argv);
    if (capturePath) {
      setTimeout(async () => {
        try {
          const img = await this.host.window.win.webContents.capturePage();
          await writeFile(capturePath, img.toPNG());
          console.info(
            `--capture: wrote ${capturePath} (${img.getSize().width}x${img.getSize().height})`,
          );
          const panelWin = this.panel.browserWindow;
          if (panelWin && panelWin.isVisible()) {
            const pimg = await panelWin.webContents.capturePage();
            await writeFile(capturePath.replace(/.png$/, '.panel.png'), pimg.toPNG());
            console.info('--capture: wrote panel capture');
          }
        } catch (err) {
          console.error('--capture failed:', err);
        }
      }, 3000);
    }

    app.on('before-quit', () => {
      this.panel.destroy();
      void this.shutdown();
    });
    this.host.stimulate({ type: 'stage:set', stage: state.progress.stage });
    this.host.tray.setTooltip(this.progressLine());
  }

  // --- snapshot for the UI windows -------------------------------------------------------------

  snapshot(): UiSnapshot {
    const s = this.store.get();
    const p = this.game.snapshot();
    const petState = this.host.currentState();
    return {
      version: app.getVersion(),
      isDev: !app.isPackaged,
      profile: { nickname: s.profile.nickname, nation: s.profile.nation, userId: s.profile.userId },
      pet: {
        speciesId: s.pet.speciesId,
        stage: s.progress.stage,
        state: petState?.state ?? 'egg_idle',
      },
      progress: {
        level: p.level,
        stage: p.stage,
        totalXp: p.totalXp,
        xpIntoLevel: p.xpIntoLevel,
        xpToNext: p.xpToNext,
        fraction: p.fraction,
        serverXp: p.serverXp,
        streakDays: p.streakDays,
      },
      hooks: { status: this.hookStatus as HookStatusValue },
      settings: { spriteScale: s.settings.spriteScale },
      online: { connected: false, lastSyncAt: s.ledger.lastSyncAt },
    };
  }

  private pushSnapshot(): void {
    const snap = this.snapshot();
    this.panel.send(IPC.uiSnapshot, snap);
    this.hoverCard.send(IPC.uiSnapshot, snap);
    this.host.tray.setTooltip(this.progressLine());
  }

  private registerUiIpc(): void {
    ipcMain.handle(IPC.uiGetSnapshot, () => this.snapshot());
    ipcMain.handle(IPC.uiChooseNation, (_e, nation: unknown) => {
      if (!isNation(nation)) throw new Error('invalid nation');
      this.chooseNation(nation);
      return this.snapshot();
    });
    ipcMain.handle(IPC.uiToggleHooks, async () => {
      await this.toggleHooks();
      return this.snapshot();
    });
    ipcMain.handle(IPC.uiSetSpriteScale, (_e, scale: unknown) => {
      if (scale === 2 || scale === 3 || scale === 4) this.host.setSpriteScale(scale);
      return this.snapshot();
    });
    ipcMain.handle(IPC.uiOpenExternal, (_e, url: unknown) => {
      if (typeof url === 'string' && /^https:\/\/(github\.com|claude-mons\.dev)\//.test(url)) {
        return shell.openExternal(url);
      }
    });
    ipcMain.handle(IPC.uiQuit, () => app.quit());
    ipcMain.handle(IPC.uiDevGrantXp, (_e, amount: unknown) => {
      if (!app.isPackaged && typeof amount === 'number') this.game.grantXp(amount, 'server');
      return this.snapshot();
    });
  }

  /** Nation choice is permanent in v1; later calls are ignored. */
  chooseNation(nation: Nation): void {
    if (this.store.get().profile.nation) return;
    this.store.update((s) => (s.profile.nation = nation));
    this.host.setNation(nation);
    this.host.stimulate({ type: 'game:levelup', level: 1 }); // little celebration
    this.pushSnapshot();
  }

  // --- hooks & game ----------------------------------------------------------------------------

  private onHookEvent(env: HookEnvelope): void {
    const stimuli = this.activity.ingest(env);
    if (!env.spooled) for (const s of stimuli) this.host.stimulate(s);
    this.game.ingest(env);
  }

  private wireGameEvents(): void {
    this.game.on('levelup', () =>
      this.host.stimulate({ type: 'game:levelup', level: this.game.snapshot().level }),
    );
    this.game.on('hatch', ({ speciesId }) => {
      this.host.stimulate({ type: 'game:hatch' });
      // let the crack animation play on the egg sprite before swapping to the baby
      setTimeout(() => {
        this.host.setStage('baby', speciesId);
        this.pushSnapshot();
      }, 2500);
    });
    this.game.on('evolve', ({ to }) => {
      this.host.stimulate({ type: 'game:evolve', stage: to });
      setTimeout(() => {
        this.host.setStage(to, this.store.get().pet.speciesId);
        this.pushSnapshot();
      }, 2000);
    });
    this.game.on('progress', () => this.pushSnapshot());
    // keep the hover card's "state" line fresh while it is visible
    setInterval(() => {
      if (this.hoverCard.isVisible() || this.panel.isVisible()) this.pushSnapshot();
    }, 1000);
  }

  private progressLine(): string {
    const p = this.game.snapshot();
    const name = p.speciesId ? p.speciesId : 'egg';
    const stage: Stage = p.stage;
    return stage === 'egg'
      ? `claude-mons · egg · ${p.totalXp}/${p.xpToNext + p.xpIntoLevel} XP`
      : `claude-mons · ${name} (${stage}) · Lv ${p.level} · ${p.xpIntoLevel}/${p.xpIntoLevel + p.xpToNext} XP`;
  }

  private async toggleHooks(): Promise<void> {
    if (!this.installer) return;
    try {
      if (this.hookStatus === 'installed') {
        this.hookStatus = await this.installer.uninstall();
        this.store.update((s) => (s.hooks.installedAt = null));
      } else {
        this.hookStatus = await this.installer.install();
        this.store.update((s) => (s.hooks.installedAt = Date.now()));
      }
    } catch (err) {
      await dialog.showMessageBox({
        type: 'error',
        message: 'Could not update Claude Code settings',
        detail: String(err),
        buttons: ['OK'],
      });
    }
    this.host.tray.refreshMenu();
    this.pushSnapshot();
  }

  private async shutdown(): Promise<void> {
    this.sim?.stop();
    this.spool?.stop();
    this.hoverCard.hide();
    await this.hookServer?.stop().catch(() => {});
    await this.store.flush().catch(() => {});
  }
}
