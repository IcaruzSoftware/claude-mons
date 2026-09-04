import { nativeImage, type NativeImage } from 'electron';
import { frameBBox, getSprite, rasterize, spriteIdFor, type AnimName } from '@claude-mons/sprites';
import type { Stage } from '@claude-mons/shared';
import { cropRgba, encodePng, scaleRgba } from '../util/png.ts';

/**
 * Builds a tray/app icon from a sprite: crops the opaque bounds of the first idle frame, fits it
 * into a square and encodes it as PNG. Everything is generated from the pixel-art source, so the
 * icon always matches the pet.
 */
export function iconFromSprite(
  speciesId: string | null,
  stage: Stage,
  targetPx: number,
  anim: AnimName = 'idle',
): NativeImage {
  const def = getSprite(speciesId ? spriteIdFor(speciesId, stage) : 'egg');
  const frame = rasterize(def, anim, 0);
  const bbox = frameBBox(def, anim, 0) ?? { x: 0, y: 0, w: def.size, h: def.size };
  const side = Math.max(bbox.w, bbox.h);
  // center the crop in a square
  const square = new Uint8Array(side * side * 4);
  const crop = cropRgba(frame.data, def.size, bbox);
  const ox = Math.floor((side - bbox.w) / 2);
  const oy = Math.floor((side - bbox.h) / 2);
  for (let y = 0; y < bbox.h; y++) {
    square.set(
      crop.data.subarray(y * bbox.w * 4, (y + 1) * bbox.w * 4),
      ((oy + y) * side + ox) * 4,
    );
  }
  const factor = Math.max(1, Math.floor(targetPx / side));
  const scaled = scaleRgba(square, side, side, factor);
  const png = encodePng(scaled.width, scaled.height, scaled.data);
  const img = nativeImage.createFromBuffer(png, { scaleFactor: 1 });
  return img.resize({ width: targetPx, height: targetPx, quality: 'best' });
}
