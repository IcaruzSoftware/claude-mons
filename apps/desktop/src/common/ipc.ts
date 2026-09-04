/**
 * IPC contract between the Electron main process and the renderer windows.
 * Channel names and payload types live here and nowhere else.
 *
 * Coordinate systems:
 * - "world" = Electron screen DIP coordinates (what `screen.*` and `BrowserWindow.getBounds()` use).
 * - "window-local" = CSS pixels inside a renderer window (== DIPs, origin at the window's top-left).
 */
import type { LevelProgress, Nation, PetState, Stimulus, World, Stage } from '@claude-mons/shared';

export const IPC = {
  // renderer(pet) -> main
  petReady: 'pet:ready',
  petHitbox: 'pet:hitbox',
  petPointer: 'pet:pointer',
  petState: 'pet:state',
  petRequestBattle: 'pet:request-battle',
  petLanded: 'pet:landed',

  // main -> renderer(pet)
  petConfig: 'pet:config',
  petWindowMoved: 'pet:window-moved',
  petStimulus: 'pet:stimulus',
  petWorld: 'pet:world',

  // renderer(panel / hovercard) -> main (invoke)
  uiGetSnapshot: 'ui:get-snapshot',
  uiChooseNation: 'ui:choose-nation',
  uiToggleHooks: 'ui:toggle-hooks',
  uiSetSpriteScale: 'ui:set-sprite-scale',
  uiOpenExternal: 'ui:open-external',
  uiQuit: 'ui:quit',
  uiDevGrantXp: 'ui:dev-grant-xp',

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

export type HookStatusValue =
  'installed' | 'partial' | 'not-installed' | 'unreadable' | 'no-binary';

/** Everything the panel and hover card need to render. Pushed on every change. */
export interface UiSnapshot {
  version: string;
  isDev: boolean;
  profile: { nickname: string | null; nation: Nation | null; userId: string | null };
  pet: { speciesId: string | null; stage: Stage; state: PetState };
  progress: LevelProgress & { serverXp: number | null; streakDays: number };
  hooks: { status: HookStatusValue };
  settings: { spriteScale: number };
  online: { connected: boolean; lastSyncAt: number | null };
}
