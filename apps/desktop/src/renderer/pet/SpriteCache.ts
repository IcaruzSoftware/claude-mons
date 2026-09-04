import { rasterize, type AnimName, type SpriteDef } from '@claude-mons/sprites';

/**
 * Rasterizes sprite frames once into small offscreen canvases (1 canvas px = 1 grid px) and
 * caches them. Upscaling happens at draw time with image smoothing disabled, which gives crisp
 * nearest-neighbor pixels for free.
 */
export class SpriteCache {
  private readonly cache = new Map<string, OffscreenCanvas | HTMLCanvasElement>();

  get(
    def: SpriteDef,
    anim: AnimName,
    frame: number,
    paletteKey = 'default',
    paletteOverride?: Record<string, string>,
  ): OffscreenCanvas | HTMLCanvasElement {
    const key = `${def.id}|${anim}|${frame}|${paletteKey}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const raster = rasterize(def, anim, frame, paletteOverride);
    const canvas = createCanvas(raster.width, raster.height);
    const ctx = canvas.getContext('2d') as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    const img = new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height);
    ctx.putImageData(img, 0, 0);
    this.cache.set(key, canvas);
    return canvas;
  }

  clear(): void {
    this.cache.clear();
  }
}

function createCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
