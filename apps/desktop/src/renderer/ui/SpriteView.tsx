import { useEffect, useRef } from 'preact/hooks';
import {
  animOf,
  frameAt,
  getSprite,
  rasterize,
  spriteIdFor,
  tintPalette,
  type AnimName,
} from '@claude-mons/sprites';
import type { Nation, Stage } from '@claude-mons/shared';

export interface SpriteViewProps {
  speciesId: string | null;
  stage: Stage;
  nation: Nation | null;
  anim?: AnimName;
  /** CSS pixels per grid pixel */
  scale?: number;
  className?: string;
}

/** Animated sprite preview for the panel/hover card, rendered from the pixel-art source. */
export function SpriteView({
  speciesId,
  stage,
  nation,
  anim = 'idle',
  scale = 4,
  className,
}: SpriteViewProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let def;
    try {
      def = getSprite(speciesId ? spriteIdFor(speciesId, stage) : 'egg');
    } catch {
      return;
    }
    const resolved: AnimName = def.anims[anim] ? anim : 'idle';
    const a = animOf(def, resolved);
    const palette = nation ? tintPalette(def.palette, nation) : def.palette;
    const dpr = window.devicePixelRatio || 1;
    const css = def.size * scale;
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    canvas.style.width = `${css}px`;
    canvas.style.height = `${css}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const frames = a.frames.map((_, i) => {
      const r = rasterize(def!, resolved, i, palette);
      const off = new OffscreenCanvas(r.width, r.height);
      const octx = off.getContext('2d')!;
      octx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
      return off;
    });

    let raf = 0;
    let last = -1;
    const start = performance.now();
    const tick = (now: number) => {
      const i = frameAt(def!, resolved, now - start);
      if (i !== last) {
        last = i;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, css, css);
        ctx.drawImage(frames[i]!, 0, 0, css, css);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speciesId, stage, nation, anim, scale]);

  return <canvas ref={ref} class={`sprite ${className ?? ''}`} />;
}
