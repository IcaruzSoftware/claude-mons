import { describe, expect, it } from 'vitest';
import {
  battleBounds,
  clampRectToArea,
  displayContaining,
  followBounds,
  rememberAnchor,
  restoreAnchorX,
  stripBounds,
  toIntPoint,
  toIntRect,
  worldForDisplay,
  type DisplayLike,
} from '../src/main/display.ts';

const primary: DisplayLike = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1032 }, // 48 px taskbar at the bottom
  scaleFactor: 1,
};
const secondary: DisplayLike = {
  id: 2,
  bounds: { x: 1920, y: -200, width: 2560, height: 1440 },
  workArea: { x: 1920, y: -200, width: 2560, height: 1400 },
  scaleFactor: 1.5,
};

describe('display geometry', () => {
  it('puts the ground on the top edge of the taskbar', () => {
    const w = worldForDisplay(primary, 96);
    expect(w.groundY).toBe(1032);
    expect(w.minX).toBeGreaterThan(0);
    expect(w.maxX).toBeLessThan(1920);
    expect(w.maxX - w.minX).toBeGreaterThan(1500);
  });

  it('strip spans the work area width along its bottom', () => {
    const b = stripBounds(secondary, 240);
    expect(b).toEqual({ x: 1920, y: -200 + 1400 - 240, width: 2560, height: 240 });
  });

  it('follow window is centered on the anchor with a little room below', () => {
    const b = followBounds({ x: 500, y: 400 }, 240);
    expect(b.width).toBe(240);
    expect(b.x).toBe(380);
    expect(b.y + b.height).toBeGreaterThan(400); // anchor is inside, near the bottom
    expect(b.y).toBeLessThan(400);
  });

  it('battle arena is centered on the anchor with its bottom edge near it, like followBounds', () => {
    const b = battleBounds({ x: 500, y: 1032 }, 440, 300, primary);
    expect(b.width).toBe(440);
    expect(b.height).toBe(300);
    expect(b.x).toBe(500 - 220);
    // bottom edge sits at or just below the anchor (a little slack, never above it)
    expect(b.y + b.height).toBeGreaterThanOrEqual(1032);
    expect(b.y + b.height).toBeLessThan(1032 + 20);
  });

  it('battle arena clamps into the work area instead of hanging off a small display', () => {
    const tiny: DisplayLike = {
      id: 4,
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      workArea: { x: 0, y: 0, width: 300, height: 180 },
      scaleFactor: 1,
    };
    const b = battleBounds({ x: 10, y: 180 }, 440, 300, tiny);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(300);
    expect(b.y + b.height).toBeLessThanOrEqual(180);
    // shrunk to fit, not just clipped
    expect(b.width).toBeLessThanOrEqual(300);
    expect(b.height).toBeLessThanOrEqual(180);
  });

  it('battle arena near the right edge of a display stays fully inside it', () => {
    const b = battleBounds({ x: 1900, y: 1032 }, 440, 300, primary);
    expect(b.x + b.width).toBeLessThanOrEqual(1920);
  });

  describe('clampRectToArea', () => {
    it('leaves a rect that already fits untouched', () => {
      const area = { x: 0, y: 0, width: 1000, height: 1000 };
      expect(clampRectToArea({ x: 100, y: 100, width: 200, height: 200 }, area)).toEqual({
        x: 100,
        y: 100,
        width: 200,
        height: 200,
      });
    });

    it('slides an out-of-bounds rect back inside without resizing it', () => {
      const area = { x: 0, y: 0, width: 1000, height: 1000 };
      expect(clampRectToArea({ x: -50, y: 900, width: 200, height: 200 }, area)).toEqual({
        x: 0,
        y: 800,
        width: 200,
        height: 200,
      });
    });

    it('shrinks a rect bigger than the area on either axis', () => {
      const area = { x: 0, y: 0, width: 300, height: 400 };
      const r = clampRectToArea({ x: -10, y: -10, width: 500, height: 500 }, area);
      expect(r).toEqual({ x: 0, y: 0, width: 300, height: 400 });
    });

    it('offsets the area itself correctly (non-origin work area, e.g. a secondary display)', () => {
      const area = { x: 1920, y: -200, width: 2560, height: 1400 };
      const r = clampRectToArea({ x: 1900, y: -300, width: 200, height: 200 }, area);
      expect(r.x).toBeGreaterThanOrEqual(1920);
      expect(r.y).toBeGreaterThanOrEqual(-200);
    });
  });

  it('finds the display containing a point', () => {
    expect(displayContaining([primary, secondary], { x: 2000, y: 100 }, primary).id).toBe(2);
    expect(displayContaining([primary, secondary], { x: 10, y: 10 }, primary).id).toBe(1);
    expect(displayContaining([primary, secondary], { x: -50, y: -50 }, secondary).id).toBe(2);
  });

  it('remembers the anchor as a fraction so it survives resolution changes', () => {
    const mem = rememberAnchor(primary, 960);
    expect(mem.fractionX).toBeCloseTo(0.5);
    expect(restoreAnchorX(secondary, mem)).toBe(1920 + 1280);
    expect(restoreAnchorX(primary, null)).toBe(960);
  });

  it('rounds a fractional work area (fractional Windows DPI scaling) before deriving world/strip bounds', () => {
    // Electron has been observed to hand back non-integer workArea values under 125%/150%/175%
    // Windows scaling; both computations must still land on integers.
    const fractional: DisplayLike = {
      id: 3,
      bounds: { x: 0, y: 0, width: 1536, height: 864 },
      workArea: { x: 0, y: 0, width: 1536, height: 833.6 },
      scaleFactor: 1.25,
    };
    const world = worldForDisplay(fractional, 96);
    expect(Number.isInteger(world.groundY)).toBe(true);
    expect(Number.isInteger(world.minX)).toBe(true);
    expect(Number.isInteger(world.maxX)).toBe(true);

    const strip = stripBounds(fractional, 240);
    expect(Number.isInteger(strip.x)).toBe(true);
    expect(Number.isInteger(strip.y)).toBe(true);
    expect(Number.isInteger(strip.width)).toBe(true);
    expect(Number.isInteger(strip.height)).toBe(true);
  });
});

describe('toIntPoint / toIntRect', () => {
  it('rounds finite fractional points and rects', () => {
    expect(toIntPoint({ x: 10.4, y: 10.6 })).toEqual({ x: 10, y: 11 });
    expect(toIntRect({ x: 1.2, y: 2.8, width: 100.4, height: 99.9 })).toEqual({
      x: 1,
      y: 3,
      width: 100,
      height: 100,
    });
  });

  it('returns null instead of NaN/Infinity so the caller can skip the native call', () => {
    expect(toIntPoint({ x: NaN, y: 0 })).toBeNull();
    expect(toIntPoint({ x: 0, y: Infinity })).toBeNull();
    expect(toIntRect({ x: 0, y: 0, width: NaN, height: 10 })).toBeNull();
    expect(toIntRect({ x: 0, y: 0, width: 10, height: -Infinity })).toBeNull();
  });

  it('passes through already-integer values unchanged', () => {
    expect(toIntPoint({ x: 5, y: -3 })).toEqual({ x: 5, y: -3 });
    expect(toIntRect({ x: 0, y: 0, width: 240, height: 240 })).toEqual({
      x: 0,
      y: 0,
      width: 240,
      height: 240,
    });
  });
});
