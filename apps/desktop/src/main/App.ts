import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, dialog, ipcMain, shell } from 'electron';
import {
  RESPEC_FREE_BELOW_LEVEL,
  isNation,
  isStance,
  pointsAvailable,
  sharedPassivePoints,
  speciesOf,
  treeSpent,
  unlockedMoves,
  validateLoadout,
  type BattleNotification,
  type CreateProfileResponse,
  type HookEnvelope,
  type Nation,
  type SetLoadoutResponse,
  type Stage,
} from '@claude-mons/shared';
import {
  IPC,
  type AccountOpResult,
  type HookStatusValue,
  type LeaderboardPayload,
  type SetLoadoutPayload,
  type UiSnapshot,
} from '../common/ipc.ts';
import { PetHost } from './PetHost.ts';
import { Autostart } from './autostart/Autostart.ts';
import { rememberAnchor } from './display.ts';
import { BattleService } from './game/BattleService.ts';
import { GameService } from './game/GameService.ts';
import { rollSpeciesForNation } from './game/species.ts';
import { ActivityTracker } from './hooks/ActivityTracker.ts';
import {
  HookInstaller,
  claudeSettingsPath,
  type HookMode,
  type HookStatus,
  type HookTarget,
} from './hooks/HookInstaller.ts';
import { HookServer } from './hooks/HookServer.ts';
import { SpoolDrainer } from './hooks/SpoolDrainer.ts';
import { ensureHookBinary } from './hooks/binary.ts';
import { computeEffectiveMode, probeBinary, type ProbeResult } from './hooks/mode.ts';
import { buildAdoptedProfile, isValidEmailFormat, resetToAnonymousProfile } from './net/account.ts';
import { RemoteBattleBackend, fetchLeaderboard, type LeaderboardData } from './net/Backend.ts';
import { ApiCallError, SupabaseClient } from './net/SupabaseClient.ts';
import { SyncQueue } from './net/SyncQueue.ts';
import { backendConfig } from './net/config.ts';
import { JsonStore } from './persistence/JsonStore.ts';
import { MIGRATIONS, defaultState, type LocalState } from './persistence/state.ts';
import { isWaterIntervalMin, todayCount, WaterReminder } from './reminders/WaterReminder.ts';
import {
  ScriptRunner,
  parseCaptureArg,
  parseDevNationArg,
  parseDevOnboardingStepArg,
  parseDevWaterInArg,
  parseDevXpArg,
  parseSimulateArg,
} from './sim/ScriptRunner.ts';
import { Updater } from './updater/Updater.ts';
import { HoverCardWindow } from './windows/HoverCardWindow.ts';
import { PanelWindow } from './windows/PanelWindow.ts';
import { ReminderWindow } from './windows/ReminderWindow.ts';

const HOVER_DELAY_MS = 1000;
/** How often `WaterReminder.tick()` is polled; short enough that "due" and "asleep/battle ends" feel prompt. */
const WATER_TICK_MS = 5000;
const DEBUG = process.env.CLAUDE_MONS_DEBUG === '1';

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
  battles!: BattleService;
  readonly panel = new PanelWindow(
    () => this.store.get().ui.panel,
    (m) => this.store.update((s) => (s.ui.panel = m)),
  );
  readonly hoverCard = new HoverCardWindow();
  readonly reminderWindow = new ReminderWindow();
  readonly updater = new Updater();
  readonly autostart = new Autostart();
  water!: WaterReminder;
  private waterTimer: NodeJS.Timeout | null = null;
  private autostartEnabled = false;
  private api: SupabaseClient | null = null;
  private sync: SyncQueue | null = null;
  private notifications: BattleNotification[] = [];
  private leaderboardCache: LeaderboardData | null = null;
  private readonly activity = new ActivityTracker();
  private hookServer!: HookServer;
  private spool!: SpoolDrainer;
  private installer: HookInstaller | null = null;
  private hookStatus: HookStatus | 'no-binary' = 'no-binary';
  private hookBinaryPath: string | null = null;
  private probeResult: ProbeResult | null = null;
  private effectiveMode: 'binary' | 'script' = 'script';
  private sim: ScriptRunner | null = null;
  private devOnboardingStep: number | null = null;

  async start(): Promise<void> {
    const state = await this.store.load();

    const cfg = backendConfig();
    if (cfg) {
      this.api = new SupabaseClient(cfg, {
        load: () => this.store.get().auth.session,
        save: (v) => this.store.update((s) => (s.auth.session = v)),
      });
    }

    this.game = new GameService(this.store, {
      // with a backend the server rolls species and decides stages; offline builds do it locally
      localGame: !this.api,
      rollSpecies: (nation, seed) => rollSpeciesForNation(nation as Nation | null, seed),
    });

    this.battles = new BattleService({
      state: this.store,
      totalXp: () => this.game.totalXp(),
      backend: this.api ? new RemoteBattleBackend(this.api) : null,
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
        onBattleRequest: () => void this.onBattleRequest(),
        hooks: {
          status: () => (this.hookStatus === 'no-binary' ? 'not-installed' : this.hookStatus),
          toggle: () => void this.toggleHooks(),
        },
        water: {
          enabled: () => this.store.get().settings.waterReminder.enabled,
          toggle: () => this.toggleWaterReminder(),
        },
        progressLine: () => this.progressLine(),
      },
    );
    if (this.api) this.startSync(this.api);
    this.registerUiIpc();
    this.host.onBattleDone((id) => this.onBattleDone(id));
    this.host.start();
    this.wireGameEvents();
    this.wireWaterReminder();

    // Hooks: endpoint + spool + binary + mode probe + installer.
    // The port and the script-mode token are persisted (LocalState.hooks) so a script-mode hook
    // command installed in a previous run keeps working across restarts; hook-endpoint.json is
    // still written for the Go binary exactly as before.
    const priorHookPort = state.hooks.port;
    this.hookServer = new HookServer({
      home: this.home,
      onEvent: (e) => this.onHookEvent(e),
      preferredPort: priorHookPort,
      scriptToken: state.hooks.token,
      onPortChosen: (port) => {
        if (port !== this.store.get().hooks.port) this.store.update((s) => (s.hooks.port = port));
      },
    });
    await this.hookServer.start();
    this.spool = new SpoolDrainer(this.home, (e) => this.onHookEvent(e));
    this.spool.start();
    this.hookBinaryPath = await ensureHookBinary(this.home).catch((err) => {
      console.warn('hook binary unavailable:', err);
      return null;
    });
    this.probeResult = this.hookBinaryPath
      ? await probeBinary(this.hookBinaryPath, this.home).catch(() => 'blocked' as const)
      : 'missing';
    if (DEBUG) console.info(`[hooks] binary probe: ${this.probeResult}`);
    await this.applyHookMode({ portChanged: this.hookServer.getPort() !== priorHookPort });

    this.autostartEnabled = await this.autostart.isEnabled().catch(() => false);
    this.updater.onStatus(() => this.pushSnapshot());
    void this.updater.start();

    // First launch: open the panel so the player can pick a nation.
    if (!state.profile.nation) this.panel.show();

    const simPath = parseSimulateArg(process.argv);
    if (simPath) {
      this.sim = ScriptRunner.fromFile(simPath)?.withSender((s) => this.host.stimulate(s)) ?? null;
      setTimeout(() => this.sim?.start(), 1500);
    }
    let devWaterIn: number | null = null;
    if (!app.isPackaged) {
      const devNation = parseDevNationArg(process.argv);
      if (devNation) setTimeout(() => this.chooseNation(devNation), 1000);
      if (process.argv.includes('--dev-battle')) {
        setTimeout(() => void this.onBattleRequest(), 2500);
      }
      const devXp = parseDevXpArg(process.argv);
      if (devXp) setTimeout(() => this.game.grantXp(devXp, 'server'), 2000);
      this.devOnboardingStep = parseDevOnboardingStepArg(process.argv);
      // Installs hooks into CLAUDE_CONFIG_DIR/settings.json in the currently effective mode, for
      // manual live testing without touching the developer's real ~/.claude/settings.json.
      if (process.argv.includes('--dev-install-hooks')) {
        setTimeout(() => void this.toggleHooks(), 1500);
      }
      devWaterIn = parseDevWaterInArg(process.argv);
      if (devWaterIn) setTimeout(() => this.water.devForceDueInSeconds(devWaterIn!), 500);
    }
    const capturePath = parseCaptureArg(process.argv);
    if (capturePath) {
      // Give the water reminder tick loop (WATER_TICK_MS) enough time to notice a forced due date
      // (armed 500 ms after start, see --dev-water-in below) and actually show the card before the
      // screenshot is taken.
      const captureDelay = devWaterIn ? 500 + devWaterIn * 1000 + WATER_TICK_MS + 2000 : 3000;
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
            await writeFile(capturePath.replace(/\.png$/, '.panel.png'), pimg.toPNG());
            console.info('--capture: wrote panel capture');
          }
          const reminderWin = this.reminderWindow.browserWindow();
          if (reminderWin && reminderWin.isVisible()) {
            const rimg = await reminderWin.webContents.capturePage();
            await writeFile(capturePath.replace(/\.png$/, '.reminder.png'), rimg.toPNG());
            console.info('--capture: wrote reminder capture');
          }
        } catch (err) {
          console.error('--capture failed:', err);
        }
      }, captureDelay);
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
    const sync = this.sync?.getStatus();
    return {
      version: app.getVersion(),
      isDev: !app.isPackaged,
      devOnboardingStep: this.devOnboardingStep,
      profile: { nickname: s.profile.nickname, nation: s.profile.nation, userId: s.profile.userId },
      account: { email: s.profile.email, anonymous: s.profile.email === null },
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
      hooks: {
        status: this.hookStatus as HookStatusValue,
        mode: s.hooks.mode,
        effectiveMode: this.effectiveMode,
        probe: this.probeResult,
      },
      settings: { spriteScale: s.settings.spriteScale, autostart: this.autostartEnabled },
      water: {
        enabled: s.settings.waterReminder.enabled,
        intervalMin: s.settings.waterReminder.intervalMin,
        todayCount: todayCount(s.water, Date.now()),
        nextDueAt: this.water.getDueAt(),
      },
      online: {
        connected: sync?.connected ?? false,
        lastSyncAt: s.ledger.lastSyncAt,
        lastError: sync?.lastError ?? null,
        configured: this.api !== null,
      },
      update: this.updater.getStatus(),
      notifications: this.notifications,
      battles: {
        history: s.battles.history,
        cooldownUntil: this.battles.cooldownUntil(),
        remainingToday: this.battles.remainingToday(),
        winStreak: s.battles.streak,
        loadout: {
          stance: s.loadout.stance,
          ...(s.loadout.moves ? { moves: s.loadout.moves } : {}),
          ...(s.loadout.tree ? { tree: s.loadout.tree } : {}),
        },
        unlockedMoveIds: s.pet.speciesId
          ? unlockedMoves(speciesOf(s.pet.speciesId), p.level).map((m) => m.id)
          : [],
        treePoints: {
          spent: treeSpent(s.profile.nation ?? 'water', s.loadout.tree).nation,
          available: pointsAvailable(p.level),
        },
        sharedPassivePoints: {
          spent: treeSpent(s.profile.nation ?? 'water', s.loadout.tree).shared,
          available: sharedPassivePoints(p.level),
        },
        lastRespecAt: s.loadout.lastRespecAt,
      },
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
    ipcMain.handle(IPC.uiSetHookMode, async (_e, mode: unknown) => {
      if (mode === 'auto' || mode === 'binary' || mode === 'script') {
        this.store.update((s) => (s.hooks.mode = mode));
        await this.applyHookMode();
        this.pushSnapshot();
      }
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
    ipcMain.handle(IPC.uiSetAutostart, async (_e, enabled: unknown) => {
      if (typeof enabled === 'boolean') {
        await this.autostart.setEnabled(enabled).catch((err) => console.warn('autostart:', err));
        this.autostartEnabled = await this.autostart.isEnabled().catch(() => false);
        this.store.update((s) => (s.settings.autostart = this.autostartEnabled));
      }
      return this.snapshot();
    });
    ipcMain.handle(IPC.uiCheckUpdates, async () => {
      await this.updater.checkNow();
      return this.snapshot();
    });
    ipcMain.handle(IPC.uiInstallUpdate, () => this.updater.quitAndInstall());
    ipcMain.handle(IPC.uiGetLeaderboard, () => this.leaderboard());
    ipcMain.handle(IPC.uiSyncNow, async () => {
      await this.sync?.flush();
      return this.snapshot();
    });
    ipcMain.handle(IPC.uiSetNickname, async (_e, nickname: unknown) => {
      if (typeof nickname !== 'string') return { ok: false, error: 'invalid' };
      if (!this.sync) return { ok: false, error: 'offline build' };
      try {
        const res = await this.sync.ensureProfile({ nickname: nickname.trim() });
        this.pushSnapshot();
        return res
          ? { ok: true, error: null }
          : { ok: false, error: this.sync.getStatus().lastError };
      } catch (err) {
        const msg = err instanceof ApiCallError ? `${err.code}: ${err.message}` : String(err);
        return { ok: false, error: msg };
      }
    });
    ipcMain.handle(IPC.battleSetStance, async (_e, stance: unknown) => {
      if (!isStance(stance)) return { ok: false, error: 'invalid stance' };
      this.store.update((s) => (s.loadout.stance = stance));
      this.pushSnapshot();
      if (this.api) {
        try {
          await this.api.invoke('set-loadout', { stance });
        } catch (err) {
          const msg = err instanceof ApiCallError ? `${err.code}: ${err.message}` : String(err);
          return { ok: false, error: msg };
        }
      }
      return { ok: true, error: null };
    });
    ipcMain.handle(IPC.battleSetLoadout, async (_e, payload: unknown) => {
      const s = this.store.get();
      const level = this.game.snapshot().level;
      const result = validateLoadout(payload as SetLoadoutPayload, {
        level,
        nation: s.profile.nation ?? 'water',
        speciesId: s.pet.speciesId,
        ...(s.loadout.tree ? { existingTree: s.loadout.tree } : {}),
        lastRespecAt: s.loadout.lastRespecAt,
      });
      if (!result.ok) return { ok: false, error: result.reason };
      this.store.update((st) => {
        if (result.loadout.stance !== undefined) st.loadout.stance = result.loadout.stance;
        if (result.loadout.moves !== undefined) st.loadout.moves = result.loadout.moves;
        if (result.loadout.tree !== undefined) {
          st.loadout.tree = result.loadout.tree;
          // Offline mirror of set-loadout's own stamping rule; overwritten below with the
          // server's own timestamp as soon as the online call (if any) comes back.
          if (result.isRespec && level >= RESPEC_FREE_BELOW_LEVEL) {
            st.loadout.lastRespecAt = new Date().toISOString();
          }
        }
      });
      this.pushSnapshot();
      if (this.api) {
        try {
          const res = await this.api.invoke<SetLoadoutResponse>(
            'set-loadout',
            payload as SetLoadoutPayload,
          );
          this.store.update((st) => {
            st.loadout.lastRespecAt = res.mon.lastRespecAt;
          });
          this.pushSnapshot();
        } catch (err) {
          const msg = err instanceof ApiCallError ? `${err.code}: ${err.message}` : String(err);
          return { ok: false, error: msg };
        }
      }
      return { ok: true, error: null };
    });
    ipcMain.handle(IPC.uiSetWaterEnabled, (_e, enabled: unknown) => {
      if (typeof enabled === 'boolean') {
        this.store.update((s) => (s.settings.waterReminder.enabled = enabled));
        this.water.onConfigChanged();
        this.host.tray.refreshMenu();
      }
      return this.snapshot();
    });
    ipcMain.handle(IPC.uiSetWaterInterval, (_e, intervalMin: unknown) => {
      if (isWaterIntervalMin(intervalMin)) {
        this.store.update((s) => (s.settings.waterReminder.intervalMin = intervalMin));
        this.water.onConfigChanged();
      }
      return this.snapshot();
    });
    ipcMain.handle(IPC.accountLinkStart, async (_e, email: unknown): Promise<AccountOpResult> => {
      if (!this.api) return { ok: false, error: 'offline build' };
      if (typeof email !== 'string' || !isValidEmailFormat(email)) {
        return { ok: false, error: 'Enter a valid email address' };
      }
      return this.api.linkEmail(email.trim());
    });
    ipcMain.handle(
      IPC.accountLinkVerify,
      async (_e, email: unknown, code: unknown): Promise<AccountOpResult> => {
        if (!this.api) return { ok: false, error: 'offline build' };
        if (typeof email !== 'string' || typeof code !== 'string') {
          return { ok: false, error: 'invalid' };
        }
        const res = await this.api.verifyLinkCode(email.trim(), code.trim());
        if (res.ok) {
          this.store.update((s) => (s.profile.email = email.trim()));
          this.pushSnapshot();
        }
        return res;
      },
    );
    ipcMain.handle(IPC.accountLinkRefresh, async (): Promise<AccountOpResult> => {
      if (!this.api) return { ok: false, error: 'offline build' };
      const email = await this.api.refreshLinkedEmail();
      if (email) {
        this.store.update((s) => (s.profile.email = email));
        this.pushSnapshot();
      }
      return { ok: true, error: null, account: this.snapshot().account };
    });
    ipcMain.handle(IPC.accountSigninStart, async (_e, email: unknown): Promise<AccountOpResult> => {
      if (!this.api) return { ok: false, error: 'offline build' };
      if (typeof email !== 'string' || !isValidEmailFormat(email)) {
        return { ok: false, error: 'Enter a valid email address' };
      }
      return this.api.requestSignInCode(email.trim());
    });
    ipcMain.handle(
      IPC.accountSigninVerify,
      async (_e, email: unknown, code: unknown): Promise<AccountOpResult> => {
        if (!this.api) return { ok: false, error: 'offline build' };
        if (typeof email !== 'string' || typeof code !== 'string') {
          return { ok: false, error: 'invalid' };
        }
        const verify = await this.api.verifySignInCode(email.trim(), code.trim());
        if (!verify.ok) return verify;
        return this.adoptProfile(email.trim());
      },
    );
    ipcMain.handle(IPC.accountSignout, async (): Promise<AccountOpResult> => {
      if (!this.api) return { ok: false, error: 'offline build' };
      await this.api.signOutToAnonymous();
      const seed = randomBytes(4).readUInt32LE(0);
      this.store.update((s) => Object.assign(s, resetToAnonymousProfile(seed)));
      this.host.setStage('egg', null);
      this.host.setNation(null);
      this.host.window.win.hide();
      this.panel.show();
      this.pushSnapshot();
      return { ok: true, error: null };
    });
    ipcMain.handle(IPC.waterDone, () => {
      this.water.done();
      this.host.stimulate({ type: 'game:cheer' }); // little celebration; no XP for drinking water
      this.pushSnapshot();
      return this.snapshot();
    });
    ipcMain.handle(IPC.waterSnooze, () => {
      this.water.snooze();
      this.pushSnapshot();
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
    if (this.sync) {
      void this.sync
        .ensureProfile({ nation })
        .then(() => this.sync?.flush())
        .then(() => this.pushSnapshot())
        .catch((err) => console.warn('create-profile failed:', err));
    }
  }

  /**
   * Adopts the server profile of the account this device just signed into (see
   * `docs/architecture/flows/account-linking.md`): overwrites this device's local profile/pet/
   * progress with the server's, server-authoritative via `GameService.applyServerState`. Called
   * only after `SupabaseClient.verifySignInCode` succeeds — the caller is responsible for any
   * "this replaces the mon on this device" confirmation the UI needs beforehand.
   */
  private async adoptProfile(email: string): Promise<AccountOpResult> {
    if (!this.api) return { ok: false, error: 'offline build' };
    try {
      const res = await this.api.invoke<CreateProfileResponse>('create-profile', {});
      this.store.update((s) => Object.assign(s, buildAdoptedProfile(s, res, email)));
      this.game.applyServerState({
        totalXp: res.mon.totalXp,
        speciesId: res.mon.speciesId,
        stage: res.mon.stage,
      });
      this.host.setNation(res.player.nation);
      // wireGameEvents' hatch handler always lands on 'baby' after the crack animation; correct
      // the sprite to the true adopted stage once that settles (a mon adopted mid-teen/adult would
      // otherwise get stuck showing 'baby'). A no-op when the mon is still an egg or really is baby.
      setTimeout(() => {
        this.host.setStage(res.mon.stage, res.mon.speciesId);
        this.pushSnapshot();
      }, 2600);
      this.pushSnapshot();
      return { ok: true, error: null };
    } catch (err) {
      const msg = err instanceof ApiCallError ? `${err.code}: ${err.message}` : String(err);
      return { ok: false, error: msg };
    }
  }

  // --- backend sync ----------------------------------------------------------------------------

  private startSync(api: SupabaseClient): void {
    this.sync = new SyncQueue({
      api,
      state: this.store,
      clientVersion: app.getVersion(),
      localXp: () => this.game.totalXp(),
    });
    this.sync.on('synced', ({ mon, notifications, localXpAtSend }) => {
      this.game.applyServerState(
        { totalXp: mon.totalXp, speciesId: mon.speciesId, stage: mon.stage },
        localXpAtSend,
      );
      if (notifications.length > 0) {
        const seen = new Set(this.notifications.map((n) => n.id));
        this.notifications = [
          ...notifications.filter((n) => !seen.has(n.id)),
          ...this.notifications,
        ].slice(0, 20);
      }
      this.pushSnapshot();
    });
    this.sync.on('profile', () => this.pushSnapshot());
    this.sync.on('status', () => this.pushSnapshot());
    this.sync.start();
  }

  private async leaderboard(): Promise<LeaderboardPayload> {
    const empty = { nations: [], alltime: [], weekly: [], myRank: null, fetchedAt: 0 };
    if (!this.api) return { ...empty, error: 'offline build' };
    if (this.leaderboardCache && Date.now() - this.leaderboardCache.fetchedAt < 30_000) {
      return { ...this.leaderboardCache, error: null };
    }
    try {
      this.leaderboardCache = await fetchLeaderboard(this.api);
      return { ...this.leaderboardCache, error: null };
    } catch (err) {
      return {
        ...(this.leaderboardCache ?? empty),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // --- battles ---------------------------------------------------------------------------------

  private async onBattleRequest(): Promise<void> {
    const outcome = await this.battles.request();
    if (!outcome.ok) {
      // a short "hurt" pose tells the player the shake was understood but refused
      this.host.stimulate({ type: 'hook:notification' });
      this.pushSnapshot();
      return;
    }
    this.host.playBattle(outcome.play);
    this.pushSnapshot();
  }

  private onBattleDone(id: string): void {
    const summary = this.battles.finish(id);
    if (!summary) return;
    // With a backend the server already credited the XP and the next sync reconciles it.
    // Offline, the local ledger is the only truth.
    if (!this.api) this.game.addBattleXp(summary.xp);
    else this.sync?.scheduleSoon();
    this.pushSnapshot();
  }

  // --- hooks & game ----------------------------------------------------------------------------

  private onHookEvent(env: HookEnvelope): void {
    const stimuli = this.activity.ingest(env);
    if (!env.spooled) for (const s of stimuli) this.host.stimulate(s);
    this.game.ingest(env);
    if (env.event === 'Stop') this.sync?.scheduleSoon();
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

  // --- water reminder ---------------------------------------------------------------------------

  private wireWaterReminder(): void {
    this.water = new WaterReminder({
      now: () => Date.now(),
      getState: () => {
        const s = this.store.get();
        return {
          enabled: s.settings.waterReminder.enabled,
          intervalMin: s.settings.waterReminder.intervalMin,
          lastDoneAt: s.water.lastDoneAt,
          snoozedUntil: s.water.snoozedUntil,
          todayCount: s.water.todayCount,
          todayKey: s.water.todayKey,
        };
      },
      update: (fn) => this.store.update((s) => fn(s.water)),
      isAsleep: () => this.host.currentState()?.state === 'sleep',
      isInBattle: () => this.host.isInBattle(),
      onShow: () => this.reminderWindow.show(this.host.spriteAnchorInfo()),
      onHide: () => this.reminderWindow.hide(),
    });
    this.waterTimer = setInterval(() => this.water.tick(), WATER_TICK_MS);
  }

  private toggleWaterReminder(): void {
    this.store.update(
      (s) => (s.settings.waterReminder.enabled = !s.settings.waterReminder.enabled),
    );
    this.water.onConfigChanged();
    this.host.tray.refreshMenu();
    this.pushSnapshot();
  }

  private progressLine(): string {
    if (!this.store.get().profile.nation) return 'claude-mons — choose your nation';
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
      if (this.hookStatus === 'installed-binary' || this.hookStatus === 'installed-script') {
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

  /**
   * (Re)computes the effective hook mode ('auto' resolves via the binary probe result), rebuilds
   * the installer to target it, and refreshes `hookStatus`. Called on start and whenever the mode
   * preference changes. If hooks were already installed in the *other* mode (or, when
   * `portChanged`, the same script-mode command needs a fresh port), this reinstalls in place so
   * the on-disk `settings.json` always matches the effective mode without the user re-clicking
   * Connect.
   */
  private async applyHookMode(opts: { portChanged?: boolean } = {}): Promise<void> {
    const configured = this.store.get().hooks.mode;
    this.effectiveMode = computeEffectiveMode(configured, this.probeResult);
    const target: HookTarget | null =
      this.effectiveMode === 'binary'
        ? this.hookBinaryPath
          ? { mode: 'binary', binaryPath: this.hookBinaryPath, homeDir: this.home }
          : null
        : {
            mode: 'script',
            endpoint: { port: this.hookServer.getPort(), token: this.store.get().hooks.token },
          };
    if (!target) {
      // Explicit 'binary' preference but no binary was ever bundled/copied: nothing installable.
      this.installer = null;
      this.hookStatus = 'no-binary';
      this.host.tray.refreshMenu();
      return;
    }
    this.installer = new HookInstaller({ settingsPath: claudeSettingsPath(), target });
    this.hookStatus = await this.installer.status().catch(() => 'unreadable' as const);
    const installedMode: HookMode | null =
      this.hookStatus === 'installed-binary'
        ? 'binary'
        : this.hookStatus === 'installed-script'
          ? 'script'
          : null;
    const wasInstalled = this.store.get().hooks.installedAt !== null;
    const modeMismatch =
      wasInstalled && installedMode !== null && installedMode !== this.effectiveMode;
    const stalePort = Boolean(opts.portChanged) && installedMode === 'script';
    if (modeMismatch || stalePort) {
      this.hookStatus = await this.installer.install().catch(() => this.hookStatus);
    }
    if (DEBUG) {
      console.info(
        `[hooks] effective mode: ${this.effectiveMode} (configured: ${configured}, status: ${this.hookStatus})`,
      );
    }
    this.host.tray.refreshMenu();
  }

  private async shutdown(): Promise<void> {
    this.sim?.stop();
    this.updater.stop();
    this.sync?.stop();
    this.spool?.stop();
    this.hoverCard.hide();
    if (this.waterTimer) clearInterval(this.waterTimer);
    this.reminderWindow.hide();
    await this.hookServer?.stop().catch(() => {});
    await this.store.flush().catch(() => {});
  }
}
