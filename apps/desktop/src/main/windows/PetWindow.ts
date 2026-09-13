import { join } from 'node:path';
import { BrowserWindow, screen, type Display } from 'electron';
import { IPC, type WindowGeometry } from '../../common/ipc.ts';
import {
  battleBounds,
  canHopFollow,
  compactBounds,
  motionBounds,
  needsHop,
  nextArenaMode,
  toIntRect,
  type ArenaMode,
} from '../display.ts';

const DEBUG = process.env.CLAUDE_MONS_DEBUG === '1';

export type PetWindowMode = ArenaMode;

export interface PetWindowOptions {
  spriteScale: number;
  /** Linux: some WMs break always-on-top for unfocusable windows; make it configurable. */
  focusable: boolean;
}

/**
 * Compact window size in grid pixels (before scaling): about 3 sprite-widths by 2.5 sprite-heights
 * of the biggest sprite grid (48, adults; see `packages/sprites/src/types.ts:SpriteDef.size`), with
 * room for FX above the sprite. Replaces the old full-work-area-width "strip" window (removed) —
 * see `docs/architecture/overlay-and-input.md` and ADR 0018 for why a compact window is part of the
 * fail-closed click-through design: even a stuck-open click-through state can only ever capture
 * clicks within this small box, not the whole screen width.
 */
export const COMPACT_WIDTH_GRID = 144;
export const COMPACT_HEIGHT_GRID = 120;
/**
 * Size of the battle arena window in grid pixels (before scaling). Generous enough to fit both
 * mons (opponent placed up to `BattlePlayer`'s `GAP_GRID` (56) plus half a 48-grid-px sprite away
 * from the anchor), hp bars, popups and a banner without the window ever needing to grow to fit
 * banner text (`apps/desktop/src/renderer/pet/bannerFit.ts` wraps/shrinks the text to fit instead).
 * Clamped to the display's work area by `battleBounds`, so this is a target, not a guarantee.
 */
export const BATTLE_WIDTH_GRID = 220;
export const BATTLE_HEIGHT_GRID = 150;

/**
 * The transparent always-on-top window the pet lives in. Always compact (see `COMPACT_WIDTH_GRID`/
 * `COMPACT_HEIGHT_GRID`) except during a battle, when it grows to the arena size
 * (`BATTLE_WIDTH_GRID`/`BATTLE_HEIGHT_GRID`) and shrinks back afterward.
 *
 * Three modes:
 * - follow: the one normal-mode compact window, always present; `PetHost` hops it (via `followTo`)
 *   whenever the sprite drifts far enough from the window's center.
 * - motion: entered for the duration of a drag through landing (see `enterMotion`) — the window
 *   covers the current display's full work area and never moves again until `enterFollow` shrinks
 *   it back down on `landed`; the sprite moves freely inside that canvas at render rate instead of
 *   the window hopping every frame. See "Motion mode" in
 *   `docs/architecture/overlay-and-input.md`.
 * - battle: a generously-sized box entered by `PetHost.playBattle` and left again on
 *   `IPC.petBattleDone`.
 */
export class PetWindow {
  readonly win: BrowserWindow;
  private mode: PetWindowMode = 'follow';
  private display: Display;
  private readonly opts: PetWindowOptions;
  private topmostTimer: NodeJS.Timeout | null = null;
  /**
   * Bumped on every successful `setBoundsSafe` call (i.e. every hop, mode switch, or resize).
   * Echoed to the renderer via `WindowGeometry.geometryVersion` and back by the renderer on every
   * `HitboxMessage`; `CursorTracker` discards a hitbox whose version doesn't match this window's
   * current version instead of trusting stale window-local coordinates. See "Geometry versions" in
   * `docs/architecture/overlay-and-input.md`.
   */
  private geometryVersion = 0;
  /** Last anchor passed to `enterFollow`/`followTo`/`enterBattle`; replayed by `reapplyBounds`. */
  private lastAnchor: { x: number; y: number };

  constructor(display: Display, anchor: { x: number; y: number }, opts: PetWindowOptions) {
    this.display = display;
    this.opts = opts;
    this.lastAnchor = anchor;
    // Falls back to a small on-screen rect in the pathological case where the display's work area
    // itself comes back non-finite; BrowserWindow's constructor cannot be skipped like the other
    // setBounds/setPosition calls below can.
    const bounds = toIntRect(
      compactBounds(
        anchor,
        COMPACT_WIDTH_GRID * opts.spriteScale,
        COMPACT_HEIGHT_GRID * opts.spriteScale,
        display,
      ),
    ) ?? {
      x: 0,
      y: 0,
      width: 800,
      height: 240,
    };

    this.win = new BrowserWindow({
      ...bounds,
      show: false,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      focusable: opts.focusable,
      title: 'claude-mons pet',
      ...(process.platform === 'linux' ? { type: 'toolbar' as const } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.setIgnoreMouseEvents(true);
    this.win.setMenu(null);

    // Kept as a safety net for any bounds change this class did not initiate directly (there
    // shouldn't be any, since resizable/movable are both false, but broadcasting on the native
    // event costs nothing extra when a call site already broadcast the same geometry itself).
    this.win.on('move', () => this.broadcastGeometry());
    this.win.on('resize', () => this.broadcastGeometry());

    if (process.platform === 'win32' || process.platform === 'linux') {
      // Other topmost windows can cover us; re-asserting is cheap. moveTop() also helps on
      // Windows, where a non-focusable topmost window can still end up behind another topmost
      // window depending on z-order history (see reassertTopmost()). X11 window managers can
      // likewise drop _NET_WM_STATE_ABOVE after focus changes, so Linux re-asserts too.
      this.topmostTimer = setInterval(() => {
        if (!this.win.isDestroyed() && this.win.isVisible()) this.reassertTopmost();
      }, 5000);
    }
    this.win.on('closed', () => {
      if (this.topmostTimer) clearInterval(this.topmostTimer);
    });
  }

  load(): void {
    if (process.env.ELECTRON_RENDERER_URL) {
      void this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pet/index.html`);
    } else {
      void this.win.loadFile(join(__dirname, '../renderer/pet/index.html'));
    }
  }

  show(): void {
    this.win.showInactive();
    this.reassertTopmost();
    this.broadcastGeometry();
  }

  getMode(): PetWindowMode {
    return this.mode;
  }

  getDisplay(): Display {
    return this.display;
  }

  getGeometryVersion(): number {
    return this.geometryVersion;
  }

  /**
   * Re-anchor to a display (after a drop on another monitor, a display-added/removed/
   * metrics-changed event, or the cursor crossing displays mid-drag). Only stores the new display;
   * callers always follow up with one of `followTo(anchor, { force: true })`, `enterBattle(anchor)`,
   * `enterFollow(anchor)`, or `retargetMotion()` using freshly recomputed bounds, so there is no
   * stale-anchor window to reposition here.
   */
  setDisplay(display: Display): void {
    this.display = display;
  }

  setSpriteScale(scale: number): void {
    this.opts.spriteScale = scale;
    this.reapplyBounds();
  }

  /** Switch to (or stay in) follow mode, positioned at the given anchor (world DIPs). */
  enterFollow(anchor: { x: number; y: number }): void {
    this.mode = 'follow';
    this.lastAnchor = anchor;
    this.setBoundsSafe(
      compactBounds(
        anchor,
        COMPACT_WIDTH_GRID * this.opts.spriteScale,
        COMPACT_HEIGHT_GRID * this.opts.spriteScale,
        this.display,
      ),
    );
    this.reassertTopmost();
  }

  /**
   * Switch to the battle arena around the given anchor (world DIPs) for the duration of a battle
   * playback. Sized by `battleBounds`/`BATTLE_WIDTH_GRID`/`BATTLE_HEIGHT_GRID` (see there) instead
   * of the small compact window, so the opponent, hp bars, popups and banner all land inside the
   * window instead of being clipped or drawn over whatever is behind the (too-small) window.
   */
  enterBattle(anchor: { x: number; y: number }): void {
    this.mode = 'battle';
    this.lastAnchor = anchor;
    this.setBoundsSafe(
      battleBounds(
        anchor,
        BATTLE_WIDTH_GRID * this.opts.spriteScale,
        BATTLE_HEIGHT_GRID * this.opts.spriteScale,
        this.display,
      ),
    );
    this.reassertTopmost();
  }

  /**
   * Switch to the motion arena for the duration of a drag through landing: bounds = the current
   * display's full (clamped) work area (`motionBounds`), set once; the window is never moved again
   * until `enterFollow` shrinks it back down on `landed`. Ignored (no-op) if a battle currently owns
   * the window — `nextArenaMode('drag-start')` is the only event a battle can veto, matching
   * `PetHost.beginDrag`'s own `inBattle` guard as a second line of defense. See "Motion mode" in
   * `docs/architecture/overlay-and-input.md`.
   */
  enterMotion(): void {
    const next = nextArenaMode(this.mode, 'drag-start');
    if (next === this.mode) return;
    this.mode = next;
    this.setBoundsSafe(motionBounds(this.display));
    this.reassertTopmost();
  }

  /**
   * Re-target the motion arena to a different display's work area mid-drag (one `setBounds`).
   * No-op outside motion mode. Call only when the display actually changed (`PetHost.onDragMove`
   * compares `displayContaining` against the last known display) — never on every drag tick.
   */
  retargetMotion(): void {
    if (this.mode !== 'motion') return;
    this.setBoundsSafe(motionBounds(this.display));
    this.reassertTopmost();
  }

  /**
   * Re-center the compact window on `anchor` (world DIPs) — a "hop". Only ever called in `follow`
   * mode (a no-op in `battle` or `motion` — see `canHopFollow`). By default only actually
   * repositions when `needsHop` says the sprite has drifted too far from the window's current
   * center (so a smoothly walking pet doesn't make the window visibly jump every frame); `force`
   * always repositions immediately. Drag/fall no longer call this at all (see `enterMotion`); it
   * still exists for ordinary walk hops and the display-change `reanchor` handler.
   */
  followTo(anchor: { x: number; y: number }, opts: { force?: boolean } = {}): void {
    if (!canHopFollow(this.mode)) return;
    this.lastAnchor = anchor;
    const current = this.win.getBounds();
    if (!opts.force && !needsHop(anchor, current)) return;
    const b = compactBounds(
      anchor,
      COMPACT_WIDTH_GRID * this.opts.spriteScale,
      COMPACT_HEIGHT_GRID * this.opts.spriteScale,
      this.display,
    );
    // setBounds rather than setPosition: compactBounds can shrink the rect when clamping to a
    // small/secondary display, so size may legitimately change alongside position.
    if (!this.setBoundsSafeQuiet(b)) return;
    // Broadcast the geometry we just *commanded* synchronously, rather than waiting for the
    // native 'move'/'resize' event: that event can lag a frame behind the actual OS move, during
    // which the renderer would otherwise paint against last frame's window origin while the
    // window itself has already moved, producing a one-frame offset/flicker.
    this.send(IPC.petWindowMoved, this.geometryFor(b));
  }

  geometry(): WindowGeometry {
    return this.geometryFor(this.win.getBounds());
  }

  setIgnoreMouse(ignore: boolean): void {
    if (this.win.isDestroyed()) return;
    if (ignore) this.win.setIgnoreMouseEvents(true);
    else this.win.setIgnoreMouseEvents(false);
  }

  send(channel: string, payload: unknown): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  private reapplyBounds(): void {
    if (this.mode === 'follow') this.enterFollow(this.lastAnchor);
    else if (this.mode === 'motion') this.setBoundsSafe(motionBounds(this.display));
    else this.enterBattle(this.lastAnchor);
  }

  private geometryFor(b: { x: number; y: number; width: number; height: number }): WindowGeometry {
    const d = screen.getDisplayMatching(b);
    return { ...b, scaleFactor: d.scaleFactor, geometryVersion: this.geometryVersion };
  }

  private broadcastGeometry(): void {
    if (this.win.isDestroyed()) return;
    this.send(IPC.petWindowMoved, this.geometry());
  }

  /**
   * Every `setBounds`/`setPosition`/`setSize` call on `this.win` must go through one of these
   * helpers (bug: a fractional or non-finite coordinate reaching Electron's native binding throws
   * "Error processing argument at index 0, conversion failure" and crashes the whole process —
   * see docs/architecture/overlay-and-input.md). All round to the nearest integer and skip the
   * call (logging in debug builds) instead of ever forwarding a bad value; all bump
   * `geometryVersion` on success so `CursorTracker` can tell a hitbox tagged with an older version
   * apart from one computed against the bounds actually in effect now.
   */
  private setBoundsSafe(rect: { x: number; y: number; width: number; height: number }): boolean {
    if (!this.setBoundsSafeQuiet(rect)) return false;
    this.broadcastGeometry();
    return true;
  }

  /** Same as `setBoundsSafe` but the caller broadcasts geometry itself (see `followTo`). */
  private setBoundsSafeQuiet(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): boolean {
    const r = toIntRect(rect);
    if (!r) {
      if (DEBUG) console.warn('[pet] skipped setBounds: non-finite rect', JSON.stringify(rect));
      return false;
    }
    this.win.setBounds(r, false);
    this.geometryVersion++;
    return true;
  }

  /** Windows: a non-focusable topmost window can still lose its place to another topmost window
   *  (e.g. after a mode switch or the drop window regaining z-order); re-asserting both the flag
   *  and the actual z-order position is cheap and fixes it. */
  private reassertTopmost(): void {
    if (this.win.isDestroyed()) return;
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.moveTop();
  }
}
