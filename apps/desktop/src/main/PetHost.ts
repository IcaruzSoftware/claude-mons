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
  private readonly onStimulusHooks: Array<(s: Stimulus) => void> = [];

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
      openPanel: () => this.callbacks.onPanel(),
      hookStatus: () => this.callbacks.hooks.status(),
      toggleHooks: () => this.callbacks.hooks.toggle(),
      progressLine: () => this.callbacks.progressLine(),
      quit: () => app.quit(),
    });
    this.registerIpc();
    this.registerDisplayEvents();
  }

  start(): void {
    this.window.load();
    this.window.win.once('ready-to-show', () => {
      this.window.show();
      this.tracker.start();
    });
    this.tray.create(this.state.speciesId, this.state.stage);
  }

  /** Send a behavior stimulus to the renderer. */
  stimulate(s: Stimulus): void {
    this.window.send(IPC.petStimulus, s);
    for (const hook of this.onStimulusHooks) hook(s);
  }

  onStimulus(hook: (s: Stimulus) => void): void {
    this.onStimulusHooks.push(hook);
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
    this.sendConfig();
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
    if (this.petVisible) this.window.show();
    else this.window.win.hide();
    this.tray.refreshMenu();
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
      if (DEBUG)
        console.info(
          '[pet] hitbox',
          JSON.stringify(hitbox),
          'window',
          JSON.stringify(this.window.win.getBounds()),
        );
      this.lastHitbox = hitbox;
      this.tracker.setHitbox(hitbox);
    });

    ipcMain.on(IPC.petState, (e, msg: StateMessage) => {
      if (!own(e)) return;
      if (DEBUG && msg.state !== this.lastState?.state)
        console.info('[pet] state', JSON.stringify(msg));
      this.lastState = msg;
      if (this.window.getMode() === 'strip') this.callbacks.onAnchor(this.display, msg.x);
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
      console.info('battle requested (Phase 5 wires this up)');
    });
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
