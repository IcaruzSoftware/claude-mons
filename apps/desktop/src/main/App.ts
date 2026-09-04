import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, dialog, shell } from 'electron';
import type { HookEnvelope, Nation, Stage } from '@claude-mons/shared';
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
import { ScriptRunner, parseCaptureArg, parseSimulateArg } from './sim/ScriptRunner.ts';

/** Until the Supabase backend (Phase 4) is wired in, hatching/evolution are decided locally. */
const LOCAL_GAME = true;

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
  private readonly activity = new ActivityTracker();
  private hookServer!: HookServer;
  private spool!: SpoolDrainer;
  private installer: HookInstaller | null = null;
  private hookStatus: HookStatus = 'not-installed';
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
        onSpriteScale: (scale) =>
          this.store.update((s) => (s.settings.spriteScale = scale as 2 | 3 | 4)),
        onAnchor: (display, x) =>
          this.store.update((s) => (s.behavior.anchor = rememberAnchor(display, x))),
        hooks: {
          status: () => this.hookStatus,
          toggle: () => void this.toggleHooks(),
        },
        progressLine: () => this.progressLine(),
      },
    );
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

    const simPath = parseSimulateArg(process.argv);
    if (simPath) {
      this.sim = ScriptRunner.fromFile(simPath)?.withSender((s) => this.host.stimulate(s)) ?? null;
      setTimeout(() => this.sim?.start(), 1500);
    }
    const capturePath = parseCaptureArg(process.argv);
    if (capturePath) {
      setTimeout(async () => {
        try {
          const img = await this.host.window.win.webContents.capturePage();
          await writeFile(capturePath, img.toPNG());
          console.info(
            `--capture: wrote ${capturePath} (${img.getSize().width}x${img.getSize().height})`,
          );
        } catch (err) {
          console.error('--capture failed:', err);
        }
      }, 3000);
    }

    app.on('before-quit', () => {
      void this.shutdown();
    });
    this.host.stimulate({ type: 'stage:set', stage: state.progress.stage });
    this.host.tray.setTooltip(this.progressLine());
  }

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
      setTimeout(() => this.host.setStage('baby', speciesId), 2500);
    });
    this.game.on('evolve', ({ to }) => {
      this.host.stimulate({ type: 'game:evolve', stage: to });
      setTimeout(() => this.host.setStage(to, this.store.get().pet.speciesId), 2000);
    });
    this.game.on('progress', () => {
      this.host.tray.setTooltip(this.progressLine());
    });
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
    if (!this.installer) {
      const r = await dialog.showMessageBox({
        type: 'warning',
        message: 'Hook binary not found',
        detail:
          'The claude-mons hook forwarder is missing from this build. In development, run `pnpm hook:build` first.',
        buttons: ['OK'],
      });
      void r;
      return;
    }
    try {
      if (this.hookStatus === 'installed') {
        this.hookStatus = await this.installer.uninstall();
        this.store.update((s) => (s.hooks.installedAt = null));
      } else {
        this.hookStatus = await this.installer.install();
        this.store.update((s) => (s.hooks.installedAt = Date.now()));
        void dialog
          .showMessageBox({
            type: 'info',
            message: 'Claude Code connected',
            detail:
              'Hooks were added to your Claude Code settings. Start a new Claude Code session and your egg will start training.\n\nOnly event metadata is sent to the app; prompts and file contents never leave your machine.',
            buttons: ['OK', 'Open settings.json'],
          })
          .then((r) => {
            if (r.response === 1) void shell.showItemInFolder(claudeSettingsPath());
          });
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
  }

  private async shutdown(): Promise<void> {
    this.sim?.stop();
    this.spool?.stop();
    await this.hookServer?.stop().catch(() => {});
    await this.store.flush().catch(() => {});
  }
}
