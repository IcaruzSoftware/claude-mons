import {
  frameAt,
  frameBBox,
  SPRITES,
  getSprite,
  spriteIdFor,
  tintPalette,
  type AnimName,
  type SpriteDef,
} from '@claude-mons/sprites';
import type { BehaviorModel, FxName } from '@claude-mons/shared';
import { animationFor } from '@claude-mons/shared';
import type { Hitbox, WindowGeometry } from '../../common/ipc.ts';
import { SpriteCache } from './SpriteCache.ts';

export interface RenderOptions {
  spriteScale: number;
  speciesId: string | null;
  nation: 'water' | 'fire' | 'earth' | 'air' | null;
  debug: boolean;
}

/** Vertical bob (grid px) of floating FX. */
function fxBob(now: number): number {
  return Math.round(Math.sin(now / 250) * 2);
}

const FX_IDS: Record<FxName, string> = {
  zzz: 'fx-zzz',
  sparkle: 'fx-sparkle',
  sweat: 'fx-sweat',
  question: 'fx-question',
  heart: 'fx-heart',
};

/**
 * Draws the pet into the window canvas. The behavior model positions the pet's anchor (foot
 * point) in world DIPs; the renderer subtracts the window origin to get canvas coordinates.
 */
export class PetRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cache = new SpriteCache();
  private geometry: WindowGeometry = { x: 0, y: 0, width: 0, height: 0, scaleFactor: 1 };
  private lastHitbox: Hitbox = null;
  private animStart = 0;
  private lastAnim: AnimName | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private opts: RenderOptions,
  ) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.resize();
  }

  setOptions(opts: Partial<RenderOptions>): void {
    this.opts = { ...this.opts, ...opts };
    this.cache.clear();
  }

  setGeometry(g: WindowGeometry): void {
    this.geometry = g;
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
  }

  currentSprite(model: BehaviorModel): SpriteDef {
    const id = this.opts.speciesId ? spriteIdFor(this.opts.speciesId, model.stage) : 'egg';
    return getSprite(id);
  }

  /** Draw one frame. Returns the sprite's opaque bounds in window-local coordinates. */
  /**
   * A string that changes whenever the drawn picture would change. The loop skips `draw` while
   * the key is stable, which keeps an idle pet at near-zero CPU despite the 60 Hz frame loop.
   */
  renderKey(model: BehaviorModel, now: number): string {
    const def = this.currentSprite(model);
    const { anim, fx } = animationFor(model.state, model.stage);
    const frame = anim !== this.lastAnim ? -1 : frameAt(def, anim, now - this.animStart);
    let fxKey = '';
    if (fx) {
      const fxDef = SPRITES[FX_IDS[fx]];
      const fxFrame = fxDef ? frameAt(fxDef, 'idle', now) : 0;
      fxKey = `${fx}:${fxFrame}:${fxBob(now)}`;
    }
    return `${def.id}|${anim}|${frame}|${fxKey}|${Math.round(model.pos.x)}|${Math.round(model.pos.y)}|${model.facing}|${this.geometry.x}|${this.geometry.y}|${this.opts.debug ? model.state : ''}`;
  }

  draw(model: BehaviorModel, now: number): Hitbox {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const s = this.opts.spriteScale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const def = this.currentSprite(model);
    const { anim, fx } = animationFor(model.state, model.stage);
    if (anim !== this.lastAnim) {
      this.lastAnim = anim;
      this.animStart = now;
    }
    const frame = frameAt(def, anim, now - this.animStart);
    const resolvedAnim: AnimName = def.anims[anim] ? anim : 'idle';

    const paletteKey = this.opts.nation ?? 'default';
    const palette = this.opts.nation ? tintPalette(def.palette, this.opts.nation) : undefined;
    const img = this.cache.get(def, resolvedAnim, frame, paletteKey, palette);

    // anchor in window-local CSS px
    const ax = model.pos.x - this.geometry.x;
    const ay = model.pos.y - this.geometry.y;
    const left = Math.round(ax - def.anchor.x * s);
    const top = Math.round(ay - (def.anchor.y + 1) * s);
    const size = def.size * s;

    ctx.save();
    if (model.facing === -1) {
      ctx.translate(left + size, top);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, size, size);
    } else {
      ctx.drawImage(img, left, top, size, size);
    }
    ctx.restore();

    if (fx) this.drawFx(fx, ax, top, s, now);

    if (this.opts.debug) this.drawDebug(model, ax, ay);

    const bbox = frameBBox(def, resolvedAnim, frame);
    if (!bbox) {
      this.lastHitbox = null;
      return null;
    }
    const bx = model.facing === -1 ? def.size - (bbox.x + bbox.w) : bbox.x;
    const hit: Hitbox = {
      x: left + bx * s,
      y: top + bbox.y * s,
      w: bbox.w * s,
      h: bbox.h * s,
    };
    this.lastHitbox = hit;
    return hit;
  }

  hitboxChanged(next: Hitbox, prev: Hitbox): boolean {
    if (next === null || prev === null) return next !== prev;
    return next.x !== prev.x || next.y !== prev.y || next.w !== prev.w || next.h !== prev.h;
  }

  private drawFx(fx: FxName, ax: number, spriteTop: number, s: number, now: number): void {
    let def: SpriteDef;
    try {
      def = getSprite(FX_IDS[fx]);
    } catch {
      return;
    }
    const frame = frameAt(def, 'idle', now);
    const img = this.cache.get(def, 'idle', frame);
    const size = def.size * s;
    // float above the head, slightly to the right
    const bob = fxBob(now) * s;
    const x = Math.round(ax + 6 * s);
    const y = Math.round(spriteTop - size * 0.6 + bob);
    this.ctx.drawImage(img, x, y, size, size);
  }

  private drawDebug(model: BehaviorModel, ax: number, ay: number): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(ax - 60, ay - 4, 120, 14);
    ctx.fillStyle = '#9f9';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      `${model.state} ${Math.round(model.pos.x)},${Math.round(model.pos.y)}`,
      ax,
      ay + 7,
    );
    if (this.lastHitbox) {
      ctx.strokeStyle = 'rgba(255,0,0,0.6)';
      ctx.strokeRect(this.lastHitbox.x, this.lastHitbox.y, this.lastHitbox.w, this.lastHitbox.h);
    }
  }
}
