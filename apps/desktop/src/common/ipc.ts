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
  MonSnapshot,
  Nation,
  PetState,
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

  // main -> renderer(panel / hovercard)
  uiSnapshot: 'ui:snapshot',
} as const;

export interface PetConfig {
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
}

/** Window geometry in world DIPs plus the display's scale factor. */
export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

/** Opaque sprite bounds in window-local coordinates, or null when nothing is drawn. */
export type Hitbox = { x: number; y: number; w: number; h: number } | null;

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
}

/** One line in the battle history. */
export interface BattleSummary {
  id: string;
  at: number;
  won: boolean;
  xp: number;
  isBot: boolean;
  turns: number;
  reason: BattleResult['reason'];
  me: { speciesId: string; stage: Stage; level: number };
  opponent: { nickname: string; speciesId: string; stage: Stage; level: number; nation: Nation };
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

/** Everything the panel and hover card need to render. Pushed on every change. */
export interface UiSnapshot {
  version: string;
  isDev: boolean;
  profile: { nickname: string | null; nation: Nation | null; userId: string | null };
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
  };
  settings: { spriteScale: number; autostart: boolean };
  online: {
    connected: boolean;
    lastSyncAt: number | null;
    lastError: string | null;
    configured: boolean;
  };
  update: UpdateStatusValue;
  notifications: BattleNotification[];
  battles: { history: BattleSummary[]; cooldownUntil: number | null; remainingToday: number };
}

export type UpdateStatusValue =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'up-to-date' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'error'; message: string };

/** Leaderboard payload for the panel. */
export interface LeaderboardPayload {
  nations: LeaderboardNationRow[];
  alltime: LeaderboardAlltimeRow[];
  weekly: LeaderboardWeeklyRow[];
  myRank: number | null;
  fetchedAt: number;
  error: string | null;
}
