import type { World } from '@claude-mons/shared';

/** Subset of Electron's Display we rely on, so this module is testable without Electron. */
export interface DisplayLike {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

/** Horizontal margin (DIPs) that keeps the sprite fully inside the work area. */
export const EDGE_MARGIN = 24;

/**
 * `display.workArea`/`display.bounds` are documented as integer DIPs, but Electron has been
 * observed to hand back fractional values on Windows under certain mixed-DPI / fractional
 * scale-factor (125%/150%/175%) multi-monitor setups. Rounding here, once, keeps every downstream
 * computation (world bounds, strip/follow bounds) safely on integers instead of propagating a
 * fraction into `BrowserWindow.setBounds`/`setPosition`, which reject non-integer values outright.
 */
function roundRect<R extends { x: number; y: number; width: number; height: number }>(r: R): R {
  return {
    ...r,
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

/**
 * The world the pet lives in on a given display: the anchor (foot point) may travel along the
 * bottom edge of the work area, so the pet stands on top of the taskbar/panel.
 */
export function worldForDisplay(display: DisplayLike, spriteWidth: number): World {
  const wa = roundRect(display.workArea);
  const half = Math.ceil(spriteWidth / 2);
  const minX = wa.x + half + EDGE_MARGIN;
  const maxX = Math.max(minX, wa.x + wa.width - half - EDGE_MARGIN);
  return { minX, maxX, groundY: wa.y + wa.height };
}

/**
 * Bounds of the pet's one normal-mode ("follow") window: a compact rect, `width` × `height` DIPs,
 * whose bottom-center sits at the anchor (world DIPs) with a little slack below it (matches
 * `battleBounds`'s slack idea, scaled for a much smaller box) so the sprite's foot row isn't drawn
 * on the very last pixel of the window. Clamped into the display's work area via
 * `clampRectToArea` so the window can never hang off (or leave) the display — see
 * `docs/architecture/overlay-and-input.md`'s "Compact window" section for why this replaced the
 * old full-work-area-width "strip" window: a stuck-open click-through bug used to be able to
 * capture clicks anywhere along the whole screen width; a compact window bounds the blast radius
 * to a few sprite-widths regardless of what click-through does.
 */
export function compactBounds(
  anchor: { x: number; y: number },
  width: number,
  height: number,
  display: DisplayLike,
): { x: number; y: number; width: number; height: number } {
  const slack = Math.round(height * 0.15);
  const raw = {
    x: Math.round(anchor.x - width / 2),
    y: Math.round(anchor.y - height + slack),
    width: Math.round(width),
    height: Math.round(height),
  };
  return clampRectToArea(raw, roundRect(display.workArea));
}

/**
 * True once the anchor has drifted more than `thresholdFraction` of the window's width from the
 * window's horizontal center — the trigger for `PetWindow.followTo` to hop (reposition) the compact
 * window instead of leaving the sprite to walk off-canvas. Also true whenever the anchor's vertical
 * distance from the window's own bottom edge changes enough that the sprite could be drawn outside
 * the window (covers a fall inside a not-yet-repositioned window). Pure so it's unit-testable
 * without a real `BrowserWindow`.
 */
export function needsHop(
  anchor: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
  thresholdFraction = 1 / 3,
): boolean {
  const centerX = bounds.x + bounds.width / 2;
  if (Math.abs(anchor.x - centerX) > bounds.width * thresholdFraction) return true;
  // Vertical: the window is bottom-anchored with ~15% slack (see compactBounds); if the anchor
  // rises above the window's top edge or sinks below its bottom edge, a reposition is overdue.
  return anchor.y < bounds.y || anchor.y > bounds.y + bounds.height;
}

/**
 * Clamps `rect` so it lies fully inside `area`, shrinking it first on whichever axis it overflows.
 * Used to keep the battle arena window (see `battleBounds`) inside the display's work area instead
 * of letting it hang off an edge on a small/secondary display.
 */
export function clampRectToArea(
  rect: { x: number; y: number; width: number; height: number },
  area: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(rect.width, area.width);
  const height = Math.min(rect.height, area.height);
  const x = Math.min(Math.max(rect.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

/**
 * Bounds of the "battle" window: like `compactBounds`, centered horizontally on the anchor with its
 * bottom edge at the anchor (so both mons stand on the same ground line as the compact `follow`
 * window), but sized generously enough to fit both mons, hp bars and popups without depending on
 * banner text width — the banner instead wraps/shrinks to fit whatever width it is given, see
 * `apps/desktop/src/renderer/pet/bannerFit.ts`. Clamped into the display's work area (`clampRectToArea`)
 * so the window never has to exceed it, e.g. on a small secondary display.
 */
export function battleBounds(
  anchor: { x: number; y: number },
  width: number,
  height: number,
  display: DisplayLike,
): { x: number; y: number; width: number; height: number } {
  // A little slack below the anchor (same idea as `compactBounds`'s 0.15 factor, scaled down since
  // this box is much taller than a single sprite) so the sprite's foot row isn't drawn on the very
  // last pixel of the window.
  const slack = Math.round(height * 0.04);
  const raw = {
    x: Math.round(anchor.x - width / 2),
    y: Math.round(anchor.y - height + slack),
    width: Math.round(width),
    height: Math.round(height),
  };
  return clampRectToArea(raw, roundRect(display.workArea));
}

/**
 * Bounds of the "motion" arena: the whole of a display's work area, clamped (in practice a no-op
 * clamp, since the work area is already the outer limit — `clampRectToArea` is reused so this goes
 * through the exact same integer/shrink-to-fit path as `compactBounds`/`battleBounds` rather than a
 * bespoke one). `PetWindow.enterMotion` sizes the window to this once at the start of a drag and
 * leaves it untouched (one `setBounds`) through `dragged` → `falling` → `landed`, instead of hopping
 * a small compact window every frame — see "Motion mode" in
 * `docs/architecture/overlay-and-input.md` for the jitter and "falls behind another window" bugs
 * this replaces: a per-frame `setBounds` raced the renderer's paint (stutter), and a fast fall could
 * outrun the not-yet-repositioned compact window, clipping the sprite against its own edge.
 */
export function motionBounds(display: DisplayLike): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const wa = roundRect(display.workArea);
  return clampRectToArea(wa, wa);
}

/** The pet window's three modes: see `PetWindow` and "Motion mode" in
 * `docs/architecture/overlay-and-input.md`. */
export type ArenaMode = 'follow' | 'battle' | 'motion';

export type ArenaEvent = 'drag-start' | 'landed' | 'battle-start' | 'battle-done';

/**
 * Pure decision table for `PetWindow`'s mode machine: drag → motion → landed → back to the compact
 * `follow` window, plus the battle arena's own enter/exit. Extracted so the sequence is
 * unit-testable without a real `BrowserWindow` (see `apps/desktop/test/display.test.ts`).
 * `battle-start`/`battle-done` are absolute — a battle always owns or releases the window
 * regardless of what preceded it (mirrored unconditionally by `PetWindow.enterBattle`/
 * `enterFollow`) — while `drag-start` is the one event a battle can veto: a drag beginning
 * mid-battle is ignored rather than shrinking the arena out from under an in-progress animation
 * (`PetWindow.enterMotion` calls this directly).
 */
export function nextArenaMode(current: ArenaMode, event: ArenaEvent): ArenaMode {
  switch (event) {
    case 'drag-start':
      return current === 'battle' ? current : 'motion';
    case 'landed':
      return current === 'motion' ? 'follow' : current;
    case 'battle-start':
      return 'battle';
    case 'battle-done':
      return 'follow';
  }
}

/**
 * True only in `follow` mode — the one mode `PetWindow.followTo` is allowed to hop (reposition)
 * in. Extracted from the old inline `if (this.mode !== 'follow') return` guard so "no `followTo`
 * calls in motion mode" is a pure, unit-tested predicate instead of only living inside the
 * Electron-coupled `PetWindow`.
 */
export function canHopFollow(mode: ArenaMode): boolean {
  return mode === 'follow';
}

export function displayContaining<D extends DisplayLike>(
  displays: readonly D[],
  point: { x: number; y: number },
  fallback: D,
): D {
  for (const d of displays) {
    const b = d.bounds;
    if (point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height) {
      return d;
    }
  }
  return fallback;
}

/** Persisted position: display id plus the anchor's fraction across the work area width. */
export interface AnchorMemory {
  displayId: number;
  fractionX: number;
}

export function rememberAnchor(display: DisplayLike, anchorX: number): AnchorMemory {
  const wa = display.workArea;
  const f = wa.width > 0 ? (anchorX - wa.x) / wa.width : 0.5;
  return { displayId: display.id, fractionX: Math.min(1, Math.max(0, f)) };
}

export function restoreAnchorX(display: DisplayLike, memory: AnchorMemory | null): number {
  const wa = display.workArea;
  const f = memory ? memory.fractionX : 0.5;
  return Math.round(wa.x + wa.width * f);
}

/**
 * Rounds a point to integer DIPs for `BrowserWindow.setPosition`/`setBounds`, which reject
 * non-integer or non-finite numbers with "Error processing argument at index N, conversion
 * failure". Returns `null` when either coordinate is not finite (NaN/Infinity) so the caller can
 * skip the native call instead of crashing the process.
 */
export function toIntPoint(p: { x: number; y: number }): { x: number; y: number } | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Same as `toIntPoint` but for a full `{x,y,width,height}` rect. */
export function toIntRect(r: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } | null {
  if (
    !Number.isFinite(r.x) ||
    !Number.isFinite(r.y) ||
    !Number.isFinite(r.width) ||
    !Number.isFinite(r.height)
  ) {
    return null;
  }
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

export function pointInRect(
  p: { x: number; y: number },
  r:
    | { x: number; y: number; w: number; h: number }
    | { x: number; y: number; width: number; height: number },
  inflate = 0,
): boolean {
  const w = 'w' in r ? r.w : r.width;
  const h = 'h' in r ? r.h : r.height;
  return (
    p.x >= r.x - inflate &&
    p.x < r.x + w + inflate &&
    p.y >= r.y - inflate &&
    p.y < r.y + h + inflate
  );
}
