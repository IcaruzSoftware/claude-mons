/**
 * IPC contract between the Electron main process and the renderer windows.
 * Channel names and payload types live here and nowhere else.
 *
 * Coordinate systems:
 * - "world" = Electron screen DIP coordinates (what `screen.*` and `BrowserWindow.getBounds()` use).
 * - "window-local" = CSS pixels inside a renderer window (== DIPs, origin at the window's top-left).
 */
import type {
  BattleNotification,
  BattleResult,
  LeaderboardAlltimeRow,
  LeaderboardNationRow,
  LeaderboardWeeklyRow,
  LevelProgress,
  MonLoadout,
  MonSnapshot,
  Nation,
  PetState,
  Stance,
  Stimulus,
  World,
  Stage,
} from '@claude-mons/shared';

export const IPC = {
  // renderer(pet) -> main
  petReady: 'pet:ready',
  petHitbox: 'pet:hitbox',
  petPointer: 'pet:pointer',
  petState: 'pet:state',
  petRequestBattle: 'pet:request-battle',
  petLanded: 'pet:landed',
  petBattleDone: 'pet:battle-done',

  // main -> renderer(pet)
  petConfig: 'pet:config',
  petWindowMoved: 'pet:window-moved',
  petStimulus: 'pet:stimulus',
  petWorld: 'pet:world',
  petBattlePlay: 'pet:battle-play',

  // renderer(panel / hovercard) -> main (invoke)
  uiGetSnapshot: 'ui:get-snapshot',
  uiChooseNation: 'ui:choose-nation',
  uiToggleHooks: 'ui:toggle-hooks',
  uiSetHookMode: 'ui:set-hook-mode',
  uiAckCodexTrust: 'ui:ack-codex-trust',
  uiSetSpriteScale: 'ui:set-sprite-scale',
  uiOpenExternal: 'ui:open-external',
  uiQuit: 'ui:quit',
  uiDevGrantXp: 'ui:dev-grant-xp',
  uiSetAutostart: 'ui:set-autostart',
  uiCheckUpdates: 'ui:check-updates',
  uiInstallUpdate: 'ui:install-update',
  uiGetLeaderboard: 'ui:get-leaderboard',
  uiSetNickname: 'ui:set-nickname',
  uiSyncNow: 'ui:sync-now',
  uiSetWaterEnabled: 'ui:set-water-enabled',
  uiSetWaterInterval: 'ui:set-water-interval',
  battleSetStance: 'battle:set-stance',
  battleSetLoadout: 'battle:set-loadout',
  accountLinkStart: 'account:link-start',
  accountLinkVerify: 'account:link-verify',
  accountLinkRefresh: 'account:link-refresh',
  accountSigninStart: 'account:signin-start',
  accountSigninVerify: 'account:signin-verify',
  accountSignout: 'account:signout',
  accountStartFresh: 'account:start-fresh',

  // renderer(reminder) -> main (invoke)
  waterDone: 'water:done',
  waterSnooze: 'water:snooze',

  // main -> renderer(panel / hovercard / reminder)
  uiSnapshot: 'ui:snapshot',
} as const;

export interface PetConfig {
  /** True only when a new battle is available (including cooldown and daily limit). */
  battleReady?: boolean;
  /** Integer pixel scale for the sprite (2, 3 or 4). */
  spriteScale: number;
  version: string;
  stage: Stage;
  speciesId: string | null;
  nation: Nation | null;
  /** Initial world bounds and anchor position. */
  world: World;
  x: number;
  /** PRNG seed for the behavior engine (stable per install). */
  seed: number;
  debug: boolean;
  /**
   * True on Linux: the renderer then streams pointer `move`/`leave` events (for hover and drag,
   * since `screen.getCursorScreenPoint()` is unreliable under (X)Wayland) and the main process
   * drives click-through with `BrowserWindow.setShape` instead of `setIgnoreMouseEvents`. See ADR
   * 0020 and `docs/architecture/input-and-gestures.md`.
   */
  linux: boolean;
  /**
   * The window's own geometry at the moment this config was sent. `PetRenderer` uses this to seed
   * its initial geometry instead of a `{0,0,0,0}` placeholder: without it, the very first frame(s)
   * — drawn as soon as `petConfig` starts the render loop — could be computed before the
   * separately-sent `IPC.petWindowMoved` message had been handled, producing a hitbox computed
   * against the wrong (stale/zero) window origin. Observed live: `apps/desktop/src/main/PetHost.ts`'s
   * debug-only `assertHitboxWithinWindow` firing on the very first hitbox of a run.
   */
  windowGeometry: WindowGeometry;
}

/**
 * Window geometry in world DIPs plus the display's scale factor.
 *
 * `geometryVersion` is bumped by `PetWindow` on every `setBounds`/`setPosition`/mode change (see
 * `apps/desktop/src/main/windows/PetWindow.ts`). The renderer echoes it back on every `Hitbox`
 * report (`HitboxMessage`) so the main process can tell whether a reported hitbox was computed
 * against the window's *current* geometry or a stale one from before a hop/mode switch/resize —
 * see "Geometry versions" in `docs/architecture/overlay-and-input.md`.
 */
export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  geometryVersion: number;
}

/** Opaque sprite bounds in window-local coordinates, or null when nothing is drawn. */
export type Hitbox = { x: number; y: number; w: number; h: number } | null;

/**
 * `pet:hitbox` payload: the hitbox tagged with the `WindowGeometry.geometryVersion` the renderer
 * had in hand when it computed it. `CursorTracker` discards a hitbox whose version doesn't match
 * the window's current geometry version instead of trusting window-local coordinates that may no
 * longer correspond to the window's actual current bounds.
 */
export interface HitboxMessage {
  hitbox: Hitbox;
  geometryVersion: number;
  /**
   * Window-local bounding box of everything the renderer drew this frame (sprite tile plus any FX
   * glyph above it), or null when nothing is drawn. Linux uses it as the window's input+draw shape
   * (`BrowserWindow.setShape`, see `apps/desktop/src/main/display.ts:linuxShapeRects` and ADR 0020);
   * ignored on Windows, which toggles `setIgnoreMouseEvents` from cursor polling instead.
   */
  shape?: Hitbox;
}

export interface PointerMessage {
  type: 'down' | 'up' | 'move' | 'enter' | 'leave' | 'contextmenu';
  button: number;
  /** window-local */
  x: number;
  y: number;
}

export interface StateMessage {
  state: PetState;
  stage: Stage;
  /** anchor position in world DIPs */
  x: number;
  y: number;
}

export type StimulusMessage = Stimulus;

/** A resolved battle for the renderer to animate. */
export interface BattlePlayMessage {
  id: string;
  result: BattleResult;
  me: MonSnapshot;
  opponent: MonSnapshot;
  /** XP the player earns; shown at the end */
  reward: number;
  isBot: boolean;
  /** true for the 10% of Wild Mon encounters that roll +3 levels and double challenger XP */
  isElite: boolean;
  /** the challenger's consecutive-win streak after this battle (0 on a loss) */
  winStreak: number;
}

/** One line in the battle history. */
export interface BattleSummary {
  id: string;
  at: number;
  won: boolean;
  xp: number;
  isBot: boolean;
  isElite: boolean;
  winStreak: number;
  turns: number;
  reason: BattleResult['reason'];
  me: { speciesId: string; stage: Stage; level: number };
  opponent: {
    nickname: string;
    speciesId: string;
    stage: Stage;
    level: number;
    nation: Nation;
    /**
     * The opponent's loadout at the time of this battle (docs/design/progression.md Phase D:
     * recent-opponent intel) -- `stance`/`moves`/`tree`, same shape as `MonLoadout` everywhere
     * else, so the Battles tab's "Recent opponents" cards can rebuild a snapshot-shaped object and
     * pass it straight to `explainMatchup` (`packages/shared/src/battle/matchup.ts`). Always `{}`
     * for history recorded before this field existed (`addOpponentLoadoutSummary` migration,
     * `apps/desktop/src/main/persistence/state.ts`) -- `explainMatchup` already defaults an absent
     * stance/moves/tree the same way a pre-Phase-A/B/C `MonSnapshot.loadout` does.
     */
    loadout: MonLoadout;
  };
}

export type HookStatusValue =
  | 'installed-binary'
  | 'installed-script'
  | 'partial'
  | 'not-installed'
  | 'unreadable'
  | 'no-binary';

/** `hooks.mode` preference (`LocalState`) vs. what actually got installed (probe-resolved in 'auto'). */
export type HookModeValue = 'auto' | 'binary' | 'script';
export type HookProbeValue = 'ok' | 'blocked' | 'missing' | null;

/**
 * Coding agent whose hooks we can install (single source of truth; `apps/desktop/src/main/hooks/
 * agents.ts` imports and re-exports this instead of declaring its own literal union).
 */
export type HookAgent = 'claude' | 'codex';

/** Everything the panel and hover card need to render. Pushed on every change. */
export interface UiSnapshot {
  version: string;
  isDev: boolean;
  /** `--dev-onboarding-step <n>` (dev builds only): open the wizard on step n for a capture/screenshot. */
  devOnboardingStep: number | null;
  profile: { nickname: string | null; nation: Nation | null; userId: string | null };
  /**
   * `signedOut` is true when this device has a known account (see `authActionOnLostSession`) whose
   * Supabase session was lost or rejected: sync stops and the panel shows the sign-in-again banner
   * (`docs/architecture/flows/account-linking.md#signed-out`) instead of silently re-creating a mon.
   */
  account: { email: string | null; anonymous: boolean; signedOut: boolean };
  pet: { speciesId: string | null; stage: Stage; state: PetState };
  progress: LevelProgress & { serverXp: number | null; streakDays: number };
  hooks: {
    status: HookStatusValue;
    /** configured preference: 'auto' | 'binary' | 'script' */
    mode: HookModeValue;
    /** mode actually installed/probed for, resolved from 'auto' via the binary probe */
    effectiveMode: 'binary' | 'script';
    /** last `probeBinary()` result, or null before the first probe (e.g. no binary bundled) */
    probe: HookProbeValue;
    /**
     * Codex's own hook install status, tracked alongside Claude's above. `detected` is whether
     * Codex's config directory (`codexHome()`) exists on disk at all -- the panel/tray only offer
     * to connect Codex when it does. `feature` is the last `ensureCodexHooksFeature()` result (the
     * app enables `[features] hooks = true` in Codex's `config.toml` itself): `'unsupported'` means
     * that file's `[features]` table has a form the app refuses to edit automatically, `null` means
     * no install/reinstall has attempted it yet.
     *
     * `needsTrust` is set (in memory only, never persisted) whenever an automatic reinstall
     * actually rewrote the installed Codex command line (a binary/script mode switch, or a
     * script-mode port rotation -- see `apps/desktop/src/main/hooks/mode.ts:needsReinstall`). Codex
     * trusts its hooks by a hash of the command line, so a rewritten command silently stops running
     * until the player re-runs `/hooks` in Codex; this flag drives the Settings hint and the tray
     * label suffix that tell them so. Cleared by `ui:ack-codex-trust` or by the player
     * connecting/disconnecting Codex themselves.
     */
    codex: {
      status: HookStatusValue;
      detected: boolean;
      feature: 'ok' | 'unsupported' | null;
      needsTrust: boolean;
    };
  };
  settings: { spriteScale: number; autostart: boolean };
  water: {
    enabled: boolean;
    intervalMin: number;
    /** Sips recorded today (resets across a UTC day boundary). */
    todayCount: number;
    /** Cached next-due timestamp, or null while disabled. */
    nextDueAt: number | null;
  };
  online: {
    connected: boolean;
    lastSyncAt: number | null;
    lastError: string | null;
    configured: boolean;
  };
  update: UpdateStatusValue;
  notifications: BattleNotification[];
  battles: {
    history: BattleSummary[];
    cooldownUntil: number | null;
    remainingToday: number;
    /** current consecutive-win streak (docs/design/progression.md Matchmaking and streaks) */
    winStreak: number;
    /** this mon's prepared loadout (docs/design/progression.md Stances, Move pool and effects) */
    loadout: MonLoadout;
    /** this mon's currently-unlocked move ids, in pool order (empty while egg) */
    unlockedMoveIds: string[];
    /** nation talent points spent vs. available at this mon's level (docs/design/talent-tree.md) */
    treePoints: { spent: number; available: number };
    /** shared-passive points spent vs. available (docs/design/talent-tree.md Shared passives) */
    sharedPassivePoints: { spent: number; available: number };
    /** local mirror of `mons.last_respec_at`, or null if never respecced; server-authoritative
     * value is re-synced from every successful `set-loadout` response. */
    lastRespecAt: string | null;
  };
}

/** `battle:set-loadout` request payload; all fields optional, same as `SetLoadoutRequest`. */
export interface SetLoadoutPayload {
  stance?: Stance;
  moves?: string[];
  /** `{ [nodeId]: rank }` (docs/design/talent-tree.md). */
  tree?: Record<string, number>;
  /** UI acknowledgement that this submission lowers a rank; the server always re-derives whether
   * it actually is a respec from the ranks themselves. */
  respec?: boolean;
}

export type UpdateStatusValue =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'up-to-date' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'error'; message: string };

/** Result of an account-linking IPC call (`account:*`); `error` is a short, user-facing string. */
export interface AccountOpResult {
  ok: boolean;
  error: string | null;
  /**
   * Populated only by `account:link-refresh` (the confirmation-link fallback,
   * `docs/architecture/flows/account-linking.md`): the account state right after checking, so the
   * caller can tell whether the link was actually clicked without waiting for the next
   * `UiSnapshot` push.
   */
  account?: UiSnapshot['account'];
}

/** Leaderboard payload for the panel. */
export interface LeaderboardPayload {
  nations: LeaderboardNationRow[];
  alltime: LeaderboardAlltimeRow[];
  weekly: LeaderboardWeeklyRow[];
  myRank: number | null;
  fetchedAt: number;
  error: string | null;
}
