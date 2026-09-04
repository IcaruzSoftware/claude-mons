import { hexToRgba } from './palette.ts';
import type { AnimDef, AnimName, BBox, RasterFrame, SpriteDef } from './types.ts';

/** Returns the requested anim, falling back to `idle` when the sprite does not define it. */
export function animOf(def: SpriteDef, anim: AnimName): AnimDef {
  const a = def.anims[anim] ?? def.anims.idle;
  if (!a) throw new Error(`Sprite ${def.id} has no 'idle' animation`);
  return a;
}

/** Frame index for a point in time. Loop anims wrap; non-loop anims clamp to the last frame. */
export function frameAt(def: SpriteDef, anim: AnimName, elapsedMs: number): number {
  const a = animOf(def, anim);
  const n = a.frames.length;
  if (n <= 1) return 0;
  const t = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const idx = Math.floor((t * a.fps) / 1000);
  return a.loop ? idx % n : Math.min(idx, n - 1);
}

function frameRows(def: SpriteDef, anim: AnimName, frame: number): string[] {
  const a = animOf(def, anim);
  const n = a.frames.length;
  const f = a.frames[((frame % n) + n) % n];
  if (f === undefined) throw new Error(`Sprite ${def.id}/${anim} has no frames`);
  return f.split('\n');
}

/** Opaque bounds (any non-`.` pixel) of a frame, or null if the frame is empty. */
export function frameBBox(def: SpriteDef, anim: AnimName, frame: number): BBox | null {
  const rows = frameRows(def, anim, frame);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '.') continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Rasterizes one frame to an RGBA buffer of size x size pixels. `.` is transparent regardless of
 * the palette; `paletteOverride` entries win over the sprite palette (hit-flash, nation tint).
 * Chars missing from both palettes are drawn magenta so mistakes are visible instead of silent.
 */
export function rasterize(
  def: SpriteDef,
  anim: AnimName,
  frame: number,
  paletteOverride?: Record<string, string>,
): RasterFrame {
  const size = def.size;
  const rows = frameRows(def, anim, frame);
  const palette = paletteOverride ? { ...def.palette, ...paletteOverride } : def.palette;
  const colors = new Map<string, [number, number, number, number]>();
  const data = new Uint8ClampedArray(size * size * 4);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < size; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < size; x++) {
      const c = row[x];
      if (c === undefined || c === '.') continue;
      let rgba = colors.get(c);
      if (!rgba) {
        const hex = palette[c];
        rgba = hex ? hexToRgba(hex) : [255, 0, 255, 255];
        colors.set(c, rgba);
      }
      if (rgba[3] === 0) continue;
      const o = (y * size + x) * 4;
      data[o] = rgba[0];
      data[o + 1] = rgba[1];
      data[o + 2] = rgba[2];
      data[o + 3] = rgba[3];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const bbox: BBox | null =
    maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  return { width: size, height: size, data, bbox };
}
