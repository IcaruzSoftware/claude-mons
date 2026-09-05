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
 * Bounds of the "strip" window: full work-area width, `height` DIPs tall, sitting on the bottom
 * edge of the work area. The pet walks inside this window without the window ever moving.
 */
export function stripBounds(
  display: DisplayLike,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const wa = roundRect(display.workArea);
  const h = Math.min(Math.round(height), wa.height);
  return { x: wa.x, y: wa.y + wa.height - h, width: wa.width, height: h };
}

/**
 * Bounds of the "follow" window: a square of `size` DIPs whose bottom-center sits at the anchor.
 * Used while the pet is dragged or falling, when it may leave the strip.
 */
export function followBounds(
  anchor: { x: number; y: number },
  size: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(anchor.x - size / 2),
    y: Math.round(anchor.y - size + Math.round(size * 0.15)),
    width: size,
    height: size,
  };
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
 * Bounds of the "battle" window: like `followBounds`, centered horizontally on the anchor with its
 * bottom edge at the anchor (so both mons stand on the same ground line as strip/follow mode), but
 * sized generously enough to fit both mons, hp bars and popups without depending on banner text
 * width — the banner instead wraps/shrinks to fit whatever width it is given, see
 * `apps/desktop/src/renderer/pet/bannerFit.ts`. Clamped into the display's work area (`clampRectToArea`)
 * so the window never has to exceed it, e.g. on a small secondary display.
 */
export function battleBounds(
  anchor: { x: number; y: number },
  width: number,
  height: number,
  display: DisplayLike,
): { x: number; y: number; width: number; height: number } {
  // A little slack below the anchor (same idea as `followBounds`'s 0.15 factor, scaled down since
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
