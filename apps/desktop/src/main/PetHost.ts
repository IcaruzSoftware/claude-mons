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
  type HitboxMessage,
  type HookAgent,
  type PetConfig,
  type PointerMessage,
  type StateMessage,
} from '../common/ipc.ts';
import {
  displayContaining,
  pointInRect,
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
/**
 * Linux drives hover/drag/click-through from renderer pointer events + the window shape rather than
 * `CursorTracker`'s `screen.getCursorScreenPoint()` polling, which is unreliable under (X)Wayland.
 * See ADR 0020 and `docs/architecture/input-and-gestures.md`. Windows/macOS keep the tracker.
 */
const IS_LINUX = process.platform === 'linux';
/** DIPs of slack around the sprite hitbox for the Linux hover/press hit-test (matches the tracker). */
const HITBOX_INFLATE = 3;

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
  hooks: {
    status: (agent: HookAgent) => HookStatus;
    toggle: (agent: HookAgent) => void;
    /** Whether Codex's installed command line changed under it and needs re-trusting via `/hooks`. */
    codexNeedsTrust: () => boolean;
  };
  water: { enabled: () => boolean; toggle: () => void };
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
  /** Linux hover edge state (the tracker's `hovering` is unused on Linux — hover comes from the DOM). */
  private linuxHovering = false;
  private shake: ShakeDetectorState = createShakeState();
  private petVisible = true;
  /** True while a battle is animating in the renderer; see `playBattle`/`IPC.petBattleDone`. */
  private inBattle = false;
  private battleReady = false;
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
    const initialAnchor = {
      x: restoreAnchorX(this.display, state.anchorMemory),
      y: worldForDisplay(this.display, this.spriteWidth()).groundY,
    };
    this.window = new PetWindow(this.display, initialAnchor, {
      spriteScale: state.spriteScale,
      focusable: process.platform !== 'linux',
    });
    this.tracker = new CursorTracker(
      {
        getBounds: () => this.window.win.getBounds(),
        setIgnoreMouse: (ignore) => this.window.setIgnoreMouse(ignore),
        getGeometryVersion: () => this.window.getGeometryVersion(),
      },
      { getCursorScreenPoint: () => screen.getCursorScreenPoint() },
      {
        onDragMove: (cursor, t) => this.onDragMove(cursor, t),
        onHoverChange: (hovering) => {
          // Suppressed in motion mode (the whole of a drag through landing): the hover card must
          // stay hidden through the fall too, not just while the button is held, even though the
          // huge motion-arena window can technically report "over" if the cursor happens to sit on
          // the falling sprite's hitbox. See docs/architecture/overlay-and-input.md "Motion mode".
          if (this.window.getMode() === 'motion') return;
          if (DEBUG) console.info('[pet] hover', hovering);
          this.callbacks.onHover(hovering, this.spriteAnchorInfo());
        },
        onError: (err) => {
          if (DEBUG) console.warn('[pet] cursor tracker tick failed, forced click-through:', err);
        },
      },
      { debug: DEBUG },
    );
    // Fail-closed on focus loss or the window being hidden (see docs/architecture/overlay-and-input.md
    // "Fail-closed click-through"): neither should be able to leave click-through wrongly disabled.
    this.window.win.on('blur', () => this.tracker.forceIgnore());
    this.window.win.on('hide', () => this.tracker.forceIgnore());
    this.tray = new AppTray({
      setSpriteScale: (s) => this.setSpriteScale(s),
      getSpriteScale: () => this.state.spriteScale,
      togglePetVisible: () => this.togglePetVisible(),
      isPetVisible: () => this.petVisible,
      bringPetBack: () => this.recenterOnPrimary(),
      battleNow: () => this.callbacks.onBattleRequest(),
      hasNation: () => this.state.nation !== null,
      openPanel: () => this.callbacks.onPanel(),
      hookStatus: (agent) => this.callbacks.hooks.status(agent),
      toggleHooks: (agent) => this.callbacks.hooks.toggle(agent),
      codexNeedsTrust: () => this.callbacks.hooks.codexNeedsTrust(),
      waterReminderEnabled: () => this.callbacks.water.enabled(),
      toggleWaterReminder: () => this.callbacks.water.toggle(),
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
   * otherwise this can still be a small compact `follow` window, too small/short for the battle
   * HUD. Reverted in the `IPC.petBattleDone` handler below, once the renderer confirms the
   * animation actually finished. `forceIgnore` clears click-through state immediately rather than
   * waiting for the next tick to notice the geometry version changed (see
   * docs/architecture/overlay-and-input.md "Fail-closed click-through").
   */
  playBattle(msg: BattlePlayMessage): void {
    this.inBattle = true;
    this.window.enterBattle(this.currentAnchor());
    this.tracker.forceIgnore();
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
    const world = this.world();
    this.window.enterFollow({ x: (world.minX + world.maxX) / 2, y: world.groundY });
    this.tracker.forceIgnore();
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

  /** True while a battle is animating in the renderer; used by `WaterReminder` to defer the card. */
  isInBattle(): boolean {
    return this.inBattle;
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
    // Linux does not poll the cursor at all (getCursorScreenPoint is unreliable under (X)Wayland);
    // hover/drag come from renderer pointer events and click-through from the window shape.
    if (!this.trackerStarted && !IS_LINUX) {
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

  setBattleReady(ready: boolean): void {
    if (ready === this.battleReady) return;
    this.battleReady = ready;
    this.sendConfig();
  }

  private sendConfig(): void {
    const world = this.world();
    const config: PetConfig = {
      battleReady: this.battleReady,
      spriteScale: this.state.spriteScale,
      version: app.getVersion(),
      stage: this.state.stage,
      speciesId: this.state.speciesId,
      nation: this.state.nation,
      world,
      x: this.lastState?.x ?? restoreAnchorX(this.display, this.state.anchorMemory),
      seed: this.state.seed,
      debug: DEBUG,
      linux: IS_LINUX,
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

    ipcMain.on(IPC.petHitbox, (e, msg: HitboxMessage) => {
      if (!own(e)) return;
      if (DEBUG) {
        console.info(
          '[pet] hitbox',
          JSON.stringify(msg),
          'window',
          JSON.stringify(this.window.win.getBounds()),
        );
        this.assertHitboxWithinWindow(msg.hitbox);
      }
      this.lastHitbox = msg.hitbox;
      if (IS_LINUX) {
        // Linux: the renderer-reported content shape is the window's input+draw region (setShape);
        // the cursor tracker does not run here (see class notes / ADR 0020).
        this.window.applyShape(msg.shape ?? msg.hitbox);
      } else {
        this.tracker.setHitbox(msg);
      }
    });

    ipcMain.on(IPC.petState, (e, msg: StateMessage) => {
      if (!own(e)) return;
      if (DEBUG && msg.state !== this.lastState?.state)
        console.info('[pet] state', JSON.stringify(msg));
      this.lastState = msg;
      if (this.window.getMode() !== 'follow') return;
      // Persisted for restart/resolution-change restore regardless of whether this tick hops the
      // window (see `AnchorMemory`/`rememberAnchor`).
      this.callbacks.onAnchor(this.display, msg.x);
      // Drag and fall no longer hop this window at all: `beginDrag` switches to the motion arena
      // (`PetWindow.enterMotion`, full display work area, set once) and `onLanded` switches back
      // once the reducer emits `landed`, so `this.window.getMode() !== 'follow'` is already true
      // for the whole dragged/falling stretch and this handler returns above without calling
      // `followTo` — see "Motion mode" in docs/architecture/overlay-and-input.md (this replaced a
      // bug where a per-frame `setBounds` during a fast fall raced the renderer's paint, visible as
      // sprite stutter, and the sprite could still outrun a not-yet-repositioned window). An
      // ordinary walk only hops once the sprite drifts far enough from the window's center (see
      // `PetWindow.followTo`/`needsHop`); airborne states never reach here in `follow` mode, so no
      // `force` flag is needed any more.
      this.window.followTo({ x: msg.x, y: msg.y });
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
      // Leave the battle arena the same way `onLanded` repositions `follow` mode: shrink back to
      // the compact window, re-anchored to whatever display we're on. The renderer forces the
      // model back to `idle` for the same stimulus (`battle:done`,
      // packages/shared/src/behavior/reducer.ts), so there is nothing mid-drag/mid-fall left to
      // preserve here.
      this.inBattle = false;
      this.window.setDisplay(this.display);
      this.window.enterFollow(this.currentAnchor());
      this.tracker.forceIgnore();
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
      if (this.window.getMode() === 'follow') {
        this.window.followTo(this.currentAnchor(), { force: true });
      }
      this.tracker.forceIgnore();
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

  /**
   * A pointer event only ever reaches the renderer while the window isn't ignoring mouse events —
   * but that decision can have flipped in the instant between the tracker's last tick and the OS
   * actually delivering the click (or, in the bug this guards against, been wrong to begin with).
   * `down`/`contextmenu` are re-checked here against `CursorTracker.isPointAccepted` before acting,
   * so a click that arrives after (or despite) a stuck-open state cannot begin a drag or pop the
   * menu — see docs/architecture/overlay-and-input.md "Pointer handling".
   */
  private onPointer(msg: PointerMessage): void {
    if (IS_LINUX) return this.onPointerLinux(msg);
    const g = this.window.win.getBounds();
    // For releases we trust the OS cursor (the message may come from a blur fallback).
    const worldPoint =
      msg.type === 'up' ? screen.getCursorScreenPoint() : { x: g.x + msg.x, y: g.y + msg.y };
    if (DEBUG) console.info('[pet] pointer', msg.type, msg.button, JSON.stringify(worldPoint));
    if (msg.type === 'down' && msg.button === 0) {
      if (this.tracker.isPointAccepted(worldPoint)) this.beginDrag(worldPoint);
    } else if (msg.type === 'up' && msg.button === 0 && this.drag) {
      this.endDrag(worldPoint);
    } else if (msg.type === 'contextmenu' || (msg.type === 'down' && msg.button === 2)) {
      if (this.drag) {
        this.endDrag(worldPoint);
        this.tray.popup();
      } else if (this.tracker.isPointAccepted(worldPoint)) {
        this.tray.popup();
      }
    }
    this.stimulate({ type: 'input:any' });
  }

  /**
   * Linux pointer handling. The window shape (see `PetWindow.applyShape`) already restricts events
   * to the sprite region, and coordinates come from the renderer's own DOM pointer events (window-
   * local), so there is no `screen.getCursorScreenPoint()` and no cursor tracker involved. Hover and
   * drag streaming are derived from `move`/`leave`; a `down`/`contextmenu` is trusted when it lands
   * on the reported hitbox. See ADR 0020 / `docs/architecture/input-and-gestures.md`.
   */
  private onPointerLinux(msg: PointerMessage): void {
    const g = this.window.win.getBounds();
    const world = { x: g.x + msg.x, y: g.y + msg.y };
    const overSprite = !!this.lastHitbox && pointInRect(msg, this.lastHitbox, HITBOX_INFLATE);
    if (DEBUG && msg.type !== 'move')
      console.info(
        '[pet] pointer',
        msg.type,
        msg.button,
        JSON.stringify(world),
        'over',
        overSprite,
      );
    if (msg.type === 'move') {
      if (this.drag) this.onDragMove(world, performance.now());
      else this.updateLinuxHover(overSprite);
      return; // moves stream at ~60 Hz; don't flood the reducer with input:any
    }
    if (msg.type === 'leave') {
      if (!this.drag) this.updateLinuxHover(false);
      return;
    }
    if (msg.type === 'down' && msg.button === 0) {
      if (overSprite) this.beginDrag(world);
    } else if (msg.type === 'up' && msg.button === 0 && this.drag) {
      this.endDrag(world);
    } else if (msg.type === 'contextmenu' || (msg.type === 'down' && msg.button === 2)) {
      if (this.drag) {
        this.endDrag(world);
        this.tray.popup();
      } else if (overSprite) {
        this.tray.popup();
      }
    }
    this.stimulate({ type: 'input:any' });
  }

  /** Linux hover edge detection (replaces `CursorTracker.onHoverChange`); suppressed during motion. */
  private updateLinuxHover(over: boolean): void {
    if (over === this.linuxHovering) return;
    this.linuxHovering = over;
    if (this.window.getMode() === 'motion') return;
    if (DEBUG) console.info('[pet] hover', over);
    this.callbacks.onHover(over, this.spriteAnchorInfo());
  }

  private beginDrag(cursor: { x: number; y: number }): void {
    // A pointer-down landing on the sprite mid-battle would otherwise call `enterMotion` and
    // shrink the arena out from under the battle window (`playBattle`/`enterBattle`), clipping the
    // in-progress HUD. The battle owns the window until `IPC.petBattleDone` reverts it.
    if (this.inBattle) return;
    const anchor = this.currentAnchor();
    this.drag = { anchorAtGrab: anchor, cursorAtGrab: cursor, startedAt: Date.now(), maxDist: 0 };
    this.shake = createShakeState();
    this.linuxHovering = false;
    this.callbacks.onHover(false, this.spriteAnchorInfo());
    // Motion mode: the window is sized once to the whole display work area and never moves again
    // until `onLanded` shrinks it back — the model's own position (from `input:grab`/`input:drag`
    // stimuli below) is what moves the sprite inside that canvas at render rate. See "Motion mode"
    // in docs/architecture/overlay-and-input.md.
    this.window.enterMotion();
    // Linux streams drag samples from renderer pointer `move` events (pointer capture keeps them
    // flowing) instead of the cursor tracker, which does not run there.
    if (!IS_LINUX) this.tracker.beginDrag();
    this.stimulate({ type: 'input:grab', x: cursor.x, y: cursor.y });
  }

  private onDragMove(cursor: { x: number; y: number }, t: number): void {
    if (!this.drag) return;
    this.drag.maxDist = Math.max(
      this.drag.maxDist,
      Math.hypot(cursor.x - this.drag.cursorAtGrab.x, cursor.y - this.drag.cursorAtGrab.y),
    );
    // Re-target the motion arena to whatever display the cursor is over now — a no-op most ticks
    // (one setBounds only when the display actually changes), rather than hopping this window every
    // frame the way `follow` mode's compact window used to.
    const target = displayContaining(screen.getAllDisplays(), cursor, this.display);
    if (target.id !== this.display.id) {
      this.display = target;
      this.window.setDisplay(target);
      this.window.retargetMotion();
      this.pushWorld();
    }
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
    // Linux has no cursor tracker running; the window shape resumes gating input once `onLanded`
    // switches back to follow mode and the next renderer shape arrives.
    if (!IS_LINUX) {
      this.tracker.endDrag();
      // Not strictly required to close click-through by itself (the motion-mode window's geometry
      // hasn't changed, so a stale hitbox wouldn't fail the version check) — but forcing it here is
      // cheap and keeps every drag/mode transition point behaving the same way, and it discards the
      // hitbox outright rather than leaving whatever the drag last reported in place a tick longer.
      this.tracker.forceIgnore();
    }
    if (wasClick) this.callbacks.onClick();
    // The pet falls to the ground of whichever display it was dropped over. `onDragMove` already
    // retargets the motion arena live as the cursor crosses displays; this is a harmless no-op
    // duplicate in the common case and a safety net for the one drag tick that ends the drag itself.
    const target = displayContaining(screen.getAllDisplays(), cursor, this.display);
    if (target.id !== this.display.id) {
      this.display = target;
      this.window.setDisplay(target);
      this.window.retargetMotion();
      this.pushWorld();
    }
    this.stimulate({ type: 'input:release', x: cursor.x, y: cursor.y });
  }

  /**
   * The reducer emits `landed` both right after a release that never left the ground and after a
   * real fall finishes (`packages/shared/src/behavior/reducer.ts`) — either way this is the one
   * place that exits `motion` mode: compute compact bounds around the now-resting anchor and
   * switch back with a single `setBounds` (`PetWindow.enterFollow`, which also bumps
   * `geometryVersion` and re-asserts topmost). `followTo` would have been a no-op here since the
   * window is still in `motion` mode at this point.
   */
  private onLanded(): void {
    this.window.setDisplay(this.display);
    this.window.enterFollow(this.currentAnchor());
    this.tracker.forceIgnore();
    this.pushWorld();
  }
}
