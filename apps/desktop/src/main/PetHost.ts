import { app, ipcMain, screen, type Display, type IpcMainEvent } from 'electron';
import {
  createShakeState,
  pushShakeSample,
  type ShakeDetectorState,
  type Stage,
  type Stimulus,
  type World,
} from '@claude-mons/shared';
import { getSprite, spriteIdFor } from '@claude-mons/sprites';
import {
  IPC,
  type BattlePlayMessage,
  type Hitbox,
  type PetConfig,
  type PointerMessage,
  type StateMessage,
} from '../common/ipc.ts';
import {
  displayContaining,
  restoreAnchorX,
  worldForDisplay,
  type AnchorMemory,
} from './display.ts';
import type { HookStatus } from './hooks/HookInstaller.ts';
import { CursorTracker } from './input/CursorTracker.ts';
import { canRevealPet, canStimulatePet } from './petGate.ts';
import { AppTray } from './tray/Tray.ts';
import { PetWindow } from './windows/PetWindow.ts';

const DEBUG = process.env.CLAUDE_MONS_DEBUG === '1';

export interface PetHostState {
  stage: Stage;
  speciesId: string | null;
  nation: PetConfig['nation'];
  spriteScale: number;
  anchorMemory: AnchorMemory | null;
  seed: number;
}

export interface PetHostCallbacks {
  onSpriteScale: (scale: number) => void;
  onAnchor: (display: Display, anchorX: number) => void;
  /** Cursor entered/left the sprite. `spriteTop` is the top of the sprite in world DIPs. */
  onHover: (hovering: boolean, anchor: { x: number; y: number; spriteTop: number }) => void;
  /** A press + release without dragging. */
  onClick: () => void;
  onPanel: () => void;
  onBattleRequest: () => void;
  hooks: { status: () => HookStatus; toggle: () => void };
  progressLine: () => string;
}

/** A press shorter than this and moving less than CLICK_MAX_DIST counts as a click, not a drag. */
const CLICK_MAX_MS = 300;
const CLICK_MAX_DIST = 6;

/**
 * Owns the pet window and everything around it in the main process: click-through tracking,
 * drag + shake, world bounds per display, tray, and forwarding stimuli to the renderer.
 * Game state (XP, hooks, persistence) is layered on top in later phases.
 */
export class PetHost {
  readonly window: PetWindow;
  readonly tray: AppTray;
  private readonly tracker: CursorTracker;
  private display: Display;
  private lastState: StateMessage | null = null;
  private drag: {
    anchorAtGrab: { x: number; y: number };
    cursorAtGrab: { x: number; y: number };
    startedAt: number;
    maxDist: number;
  } | null = null;
  private lastHitbox: Hitbox = null;
  private shake: ShakeDetectorState = createShakeState();
  private petVisible = true;
  /** True while a battle is animating in the renderer; see `playBattle`/`IPC.petBattleDone`. */
  private inBattle = false;
  /** True once the renderer has fired `ready-to-show`; gates the first reveal alongside a nation. */
  private windowReady = false;
  private trackerStarted = false;
  private readonly onStimulusHooks: Array<(s: Stimulus) => void> = [];
  private readonly onBattleDoneHooks: Array<(id: string) => void> = [];

  constructor(
    private readonly state: PetHostState,
    private readonly callbacks: PetHostCallbacks,
  ) {
    this.display = this.pickInitialDisplay();
    this.window = new PetWindow(this.display, {
      spriteScale: state.spriteScale,
      focusable: process.platform !== 'linux',
    });
    this.tracker = new CursorTracker(
      {
        getBounds: () => this.window.win.getBounds(),
        setIgnoreMouse: (ignore) => this.window.setIgnoreMouse(ignore),
      },
      { getCursorScreenPoint: () => screen.getCursorScreenPoint() },
      {
        onDragMove: (cursor, t) => this.onDragMove(cursor, t),
        onHoverChange: (hovering) => {
          if (DEBUG) console.info('[pet] hover', hovering);
          this.callbacks.onHover(hovering, this.spriteAnchorInfo());
        },
      },
    );
    this.tray = new AppTray({
      setSpriteScale: (s) => this.setSpriteScale(s),
      getSpriteScale: () => this.state.spriteScale,
      togglePetVisible: () => this.togglePetVisible(),
      isPetVisible: () => this.petVisible,
      bringPetBack: () => this.recenterOnPrimary(),
      hasNation: () => this.state.nation !== null,
      openPanel: () => this.callbacks.onPanel(),
      hookStatus: () => this.callbacks.hooks.status(),
      toggleHooks: () => this.callbacks.hooks.toggle(),
      progressLine: () => this.callbacks.progressLine(),
      quit: () => app.quit(),
    });
    this.registerIpc();
    this.registerDisplayEvents();
  }

  /**
   * The window is always constructed and loaded (so it is ready the instant a nation is chosen),
   * but stays hidden and the cursor tracker stays off until `canRevealPet` allows it — no nation
   * means no egg on screen. See `apps/desktop/src/main/petGate.ts`.
   */
  start(): void {
    this.window.load();
    this.window.win.once('ready-to-show', () => {
      this.windowReady = true;
      this.maybeReveal();
    });
    this.tray.create(this.state.speciesId, this.state.stage);
  }

  /** Send a behavior stimulus to the renderer. Ignored while no nation is chosen. */
  stimulate(s: Stimulus): void {
    if (!canStimulatePet(this.state.nation)) return;
    this.window.send(IPC.petStimulus, s);
    for (const hook of this.onStimulusHooks) hook(s);
  }

  onStimulus(hook: (s: Stimulus) => void): void {
    this.onStimulusHooks.push(hook);
  }

  onBattleDone(hook: (id: string) => void): void {
    this.onBattleDoneHooks.push(hook);
  }

  /**
   * Hand a resolved battle to the renderer for playback. Switches the window into the battle
   * arena (see `PetWindow.enterBattle`) so the opponent, hp bars, popups and banner have room —
   * otherwise this can still be mid-drag (`follow` mode, a small square) or already back in
   * `strip` mode, both too small/short for the battle HUD. Reverted in the `IPC.petBattleDone`
   * handler below, once the renderer confirms the animation actually finished.
   */
  playBattle(msg: BattlePlayMessage): void {
    this.inBattle = true;
    this.window.enterBattle(this.currentAnchor());
    this.window.send(IPC.petBattlePlay, msg);
  }

  /**
   * Recovery action ("Bring pet back", tray/context menu): re-anchors the window to the primary
   * display and recenters the model in its world, cancelling any stuck drag/fall/walk. Covers the
   * "mon walked out of frame" case regardless of what actually went wrong.
   */
  recenterOnPrimary(): void {
    const primary = screen.getPrimaryDisplay();
    this.display = primary;
    this.window.setDisplay(primary);
    this.window.enterStrip();
    this.pushWorld();
    this.stimulate({ type: 'world:recenter' });
  }

  currentAnchor(): { x: number; y: number } {
    if (this.lastState) return { x: this.lastState.x, y: this.lastState.y };
    const world = this.world();
    return { x: restoreAnchorX(this.display, this.state.anchorMemory), y: world.groundY };
  }

  world(): World {
    return worldForDisplay(this.display, this.spriteWidth());
  }

  setSpriteScale(scale: number): void {
    this.state.spriteScale = scale;
    this.window.setSpriteScale(scale);
    this.sendConfig();
    this.pushWorld();
    this.tray.refreshMenu();
    this.callbacks.onSpriteScale(scale);
  }

  setStage(stage: Stage, speciesId: string | null): void {
    this.state.stage = stage;
    this.state.speciesId = speciesId;
    this.stimulate({ type: 'stage:set', stage });
    this.sendConfig();
    this.pushWorld();
    this.tray.updateIcon(speciesId, stage);
  }

  setNation(nation: PetConfig['nation']): void {
    this.state.nation = nation;
    this.sendConfig(); // correct tint is queued before the window can ever become visible
    this.maybeReveal();
  }

  currentState(): StateMessage | null {
    return this.lastState;
  }

  /** Anchor plus the sprite's top edge (world DIPs), for positioning UI next to the pet. */
  spriteAnchorInfo(): { x: number; y: number; spriteTop: number } {
    const anchor = this.currentAnchor();
    const g = this.window.win.getBounds();
    const spriteTop = this.lastHitbox ? g.y + this.lastHitbox.y : anchor.y - this.spriteWidth();
    return { ...anchor, spriteTop };
  }

  private togglePetVisible(): void {
    this.petVisible = !this.petVisible;
    if (this.petVisible) this.maybeReveal();
    else this.window.win.hide();
    this.tray.refreshMenu();
  }

  /** Shows the window and starts the cursor tracker the first time `canRevealPet` allows it. */
  private maybeReveal(): void {
    if (
      !canRevealPet({
        nation: this.state.nation,
        windowReady: this.windowReady,
        userVisible: this.petVisible,
      })
    ) {
      return;
    }
    this.window.show();
    if (!this.trackerStarted) {
      this.trackerStarted = true;
      this.tracker.start();
    }
  }

  private spriteWidth(): number {
    const id = this.state.speciesId ? spriteIdFor(this.state.speciesId, this.state.stage) : 'egg';
    try {
      return getSprite(id).size * this.state.spriteScale;
    } catch {
      return 32 * this.state.spriteScale;
    }
  }

  private pickInitialDisplay(): Display {
    const displays = screen.getAllDisplays();
    const remembered = this.state.anchorMemory
      ? displays.find((d) => d.id === this.state.anchorMemory!.displayId)
      : undefined;
    return remembered ?? screen.getPrimaryDisplay();
  }

  private sendConfig(): void {
    const world = this.world();
    const config: PetConfig = {
      spriteScale: this.state.spriteScale,
      version: app.getVersion(),
      stage: this.state.stage,
      speciesId: this.state.speciesId,
      nation: this.state.nation,
      world,
      x: this.lastState?.x ?? restoreAnchorX(this.display, this.state.anchorMemory),
      seed: this.state.seed,
      debug: DEBUG,
      windowGeometry: this.window.geometry(),
    };
    this.window.send(IPC.petConfig, config);
    this.window.send(IPC.petWindowMoved, this.window.geometry());
  }

  private registerIpc(): void {
    const own = (e: IpcMainEvent) => e.sender === this.window.win.webContents;

    ipcMain.on(IPC.petReady, (e) => {
      if (!own(e)) return;
      this.sendConfig();
    });

    ipcMain.on(IPC.petHitbox, (e, hitbox: Hitbox) => {
      if (!own(e)) return;
      if (DEBUG) {
        console.info(
          '[pet] hitbox',
          JSON.stringify(hitbox),
          'window',
          JSON.stringify(this.window.win.getBounds()),
        );
        this.assertHitboxWithinWindow(hitbox);
      }
      this.lastHitbox = hitbox;
      this.tracker.setHitbox(hitbox);
    });

    ipcMain.on(IPC.petState, (e, msg: StateMessage) => {
      if (!own(e)) return;
      if (DEBUG && msg.state !== this.lastState?.state)
        console.info('[pet] state', JSON.stringify(msg));
      this.lastState = msg;
      if (this.window.getMode() === 'strip') {
        this.callbacks.onAnchor(this.display, msg.x);
      } else if (this.window.getMode() === 'follow') {
        // Bug: after a release that starts a real fall (`above` in the reducer's `input:release`
        // handler), nothing repositioned the follow window while the model fell — `followTo` was
        // only ever called from `onDragMove`, which stops the moment the pointer is released. The
        // window stayed wherever the drag left it while the sprite kept falling inside it, so the
        // hitbox (and the sprite itself) drifted past the window's own bottom edge until landing
        // (visible as `assertHitboxWithinWindow` firing repeatedly with a growing `hitbox.y`).
        // Tracking every reported position here, drag or fall alike, keeps the window under the
        // sprite the whole time; it's a harmless no-op duplicate of the drag-time call while
        // `this.drag` is still set, since both compute the same anchor for the same frame.
        this.window.followTo({ x: msg.x, y: msg.y });
      }
    });

    ipcMain.on(IPC.petPointer, (e, msg: PointerMessage) => {
      if (!own(e)) return;
      this.onPointer(msg);
    });

    ipcMain.on(IPC.petLanded, (e) => {
      if (!own(e)) return;
      this.onLanded();
    });

    ipcMain.on(IPC.petRequestBattle, (e) => {
      if (!own(e)) return;
      this.callbacks.onBattleRequest();
    });

    ipcMain.on(IPC.petBattleDone, (e, id: unknown) => {
      if (!own(e)) return;
      // Leave the battle arena the same way `onLanded` leaves `follow` mode: back to `strip`,
      // re-anchored to whatever display we're on. The renderer forces the model back to `idle`
      // for the same stimulus (`battle:done`, packages/shared/src/behavior/reducer.ts), so there
      // is nothing mid-drag/mid-fall left to preserve here.
      this.inBattle = false;
      this.window.setDisplay(this.display);
      this.window.enterStrip();
      this.pushWorld();
      if (typeof id === 'string') for (const hook of this.onBattleDoneHooks) hook(id);
    });
  }

  /**
   * Debug-only (CLAUDE_MONS_DEBUG=1): warns when the renderer's reported sprite hitbox — supposedly
   * window-local coordinates — falls outside the window's own current bounds. This would mean the
   * renderer drew against geometry the main process no longer agrees with (e.g. a stale `geometry`
   * after a mode switch), the general shape of bug reports like "HUD partly behind another window"
   * (see docs/architecture/overlay-and-input.md and docs/architecture/flows/shake-to-battle.md).
   */
  private assertHitboxWithinWindow(hitbox: Hitbox): void {
    if (!hitbox) return;
    const b = this.window.win.getBounds();
    const outOfBounds =
      hitbox.x < 0 ||
      hitbox.y < 0 ||
      hitbox.x + hitbox.w > b.width ||
      hitbox.y + hitbox.h > b.height;
    if (outOfBounds) {
      console.warn(
        '[pet] geometry mismatch: hitbox lies outside window bounds',
        JSON.stringify({
          hitbox,
          windowSize: { width: b.width, height: b.height },
          mode: this.window.getMode(),
        }),
      );
    }
  }

  private registerDisplayEvents(): void {
    const reanchor = () => {
      const displays = screen.getAllDisplays();
      const still = displays.find((d) => d.id === this.display.id);
      this.display = still ?? screen.getPrimaryDisplay();
      this.window.setDisplay(this.display);
      this.pushWorld();
    };
    screen.on('display-added', reanchor);
    screen.on('display-removed', reanchor);
    screen.on('display-metrics-changed', reanchor);
  }

  private pushWorld(): void {
    const world = this.world();
    this.window.send(IPC.petWorld, world);
    this.stimulate({ type: 'world:bounds', ...world });
  }

  private onPointer(msg: PointerMessage): void {
    const g = this.window.win.getBounds();
    // For releases we trust the OS cursor (the message may come from a blur fallback).
    const worldPoint =
      msg.type === 'up' ? screen.getCursorScreenPoint() : { x: g.x + msg.x, y: g.y + msg.y };
    if (DEBUG) console.info('[pet] pointer', msg.type, msg.button, JSON.stringify(worldPoint));
    if (msg.type === 'down' && msg.button === 0) {
      this.beginDrag(worldPoint);
    } else if (msg.type === 'up' && msg.button === 0 && this.drag) {
      this.endDrag(worldPoint);
    } else if (msg.type === 'contextmenu' || (msg.type === 'down' && msg.button === 2)) {
      if (this.drag) this.endDrag(worldPoint);
      this.tray.popup();
    }
    this.stimulate({ type: 'input:any' });
  }

  private beginDrag(cursor: { x: number; y: number }): void {
    // A pointer-down landing on the sprite mid-battle would otherwise call `enterFollow` and
    // shrink the window out from under the battle arena (`playBattle`/`enterBattle`), clipping the
    // in-progress HUD. The battle owns the window until `IPC.petBattleDone` reverts it.
    if (this.inBattle) return;
    const anchor = this.currentAnchor();
    this.drag = { anchorAtGrab: anchor, cursorAtGrab: cursor, startedAt: Date.now(), maxDist: 0 };
    this.shake = createShakeState();
    this.callbacks.onHover(false, this.spriteAnchorInfo());
    this.window.enterFollow(anchor);
    this.tracker.beginDrag();
    this.stimulate({ type: 'input:grab', x: cursor.x, y: cursor.y });
  }

  private onDragMove(cursor: { x: number; y: number }, t: number): void {
    if (!this.drag) return;
    const anchor = {
      x: cursor.x + (this.drag.anchorAtGrab.x - this.drag.cursorAtGrab.x),
      y: cursor.y + (this.drag.anchorAtGrab.y - this.drag.cursorAtGrab.y),
    };
    this.drag.maxDist = Math.max(
      this.drag.maxDist,
      Math.hypot(cursor.x - this.drag.cursorAtGrab.x, cursor.y - this.drag.cursorAtGrab.y),
    );
    this.window.followTo(anchor);
    this.stimulate({ type: 'input:drag', x: cursor.x, y: cursor.y });

    const res = pushShakeSample(this.shake, { t, x: cursor.x, y: cursor.y });
    this.shake = res.state;
    if (DEBUG && res.verdict !== 'none') console.info('[pet] shake', res.verdict);
    if (res.verdict === 'shaking') this.stimulate({ type: 'input:shake-progress' });
    else if (res.verdict === 'shake') this.stimulate({ type: 'input:shake' });
  }

  private endDrag(cursor: { x: number; y: number }): void {
    if (!this.drag) return;
    const wasClick =
      Date.now() - this.drag.startedAt < CLICK_MAX_MS && this.drag.maxDist < CLICK_MAX_DIST;
    this.drag = null;
    this.tracker.endDrag();
    if (wasClick) this.callbacks.onClick();
    // The pet falls to the ground of whichever display it was dropped over.
    const target = displayContaining(screen.getAllDisplays(), cursor, this.display);
    if (target.id !== this.display.id) {
      this.display = target;
      this.pushWorld();
    }
    this.stimulate({ type: 'input:release', x: cursor.x, y: cursor.y });
  }

  private onLanded(): void {
    this.window.setDisplay(this.display);
    this.window.enterStrip();
    this.pushWorld();
  }
}
