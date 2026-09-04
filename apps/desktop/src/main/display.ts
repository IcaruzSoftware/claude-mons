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
 * The world the pet lives in on a given display: the anchor (foot point) may travel along the
 * bottom edge of the work area, so the pet stands on top of the taskbar/panel.
 */
export function worldForDisplay(display: DisplayLike, spriteWidth: number): World {
  const wa = display.workArea;
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
  const wa = display.workArea;
  const h = Math.min(height, wa.height);
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
