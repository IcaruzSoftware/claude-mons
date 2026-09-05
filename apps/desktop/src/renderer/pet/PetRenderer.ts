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
import { clamp, clampCenter, fitBanner, type MeasureText } from './bannerFit.ts';
import { BattlePlayer } from './BattlePlayer.ts';
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
  private battle: BattlePlayer | null = null;
  private oppAnimStart = 0;
  private oppLastAnim: AnimName | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private opts: RenderOptions,
    initialGeometry?: WindowGeometry,
  ) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    // Seeded from `PetConfig.windowGeometry` when the caller has it, instead of the `{0,0,0,0}`
    // placeholder — see that field's doc comment (apps/desktop/src/common/ipc.ts) for the boot-race
    // this avoids: the render loop starts as soon as `petConfig` arrives, which could otherwise be
    // before the separately-sent `IPC.petWindowMoved` had been handled.
    if (initialGeometry) this.geometry = initialGeometry;
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
  /** Attach/detach the running battle; while attached, every frame is redrawn. */
  setBattle(battle: BattlePlayer | null): void {
    this.battle = battle;
  }

  renderKey(model: BehaviorModel, now: number): string {
    if (this.battle) return `battle|${now}`;
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

    if (fx) {
      // anchor effects to the visible head, not the sprite grid top (babies leave ~half the grid empty)
      const bodyBBox = frameBBox(def, resolvedAnim, frame);
      const headTop = bodyBBox ? top + bodyBBox.y * s : top;
      this.drawFx(fx, ax, headTop, s, now);
    }

    if (this.battle) this.drawBattle(this.battle, model, ax, ay, top, size, s, now);

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

  private drawFx(fx: FxName, ax: number, headTop: number, s: number, now: number): void {
    let def: SpriteDef;
    try {
      def = getSprite(FX_IDS[fx]);
    } catch {
      return;
    }
    const frame = frameAt(def, 'idle', now);
    const img = this.cache.get(def, 'idle', frame);
    const size = def.size * s;
    // glyph content sits in the upper-left quadrant of the FX grid; place its bottom edge
    // one grid pixel above the visible head, slightly to the right
    const glyph = frameBBox(def, 'idle', frame);
    const glyphBottom = glyph ? glyph.y + glyph.h : def.size / 2;
    const bob = fxBob(now) * s;
    const x = Math.round(ax + 6 * s);
    const y = Math.round(headTop - (glyphBottom + 1) * s + bob);
    this.ctx.drawImage(img, x, y, size, size);
  }

  /** Opponent sprite, hp bars, damage popups and the banner line. */
  private drawBattle(
    battle: BattlePlayer,
    model: BehaviorModel,
    ax: number,
    ay: number,
    myTop: number,
    mySize: number,
    s: number,
    now: number,
  ): void {
    const { ctx } = this;
    const v = battle.view;
    let oppDef: SpriteDef;
    try {
      oppDef = getSprite(spriteIdFor(v.opponent.speciesId, v.opponent.stage));
    } catch {
      return;
    }
    if (v.opponentAnim !== this.oppLastAnim) {
      this.oppLastAnim = v.opponentAnim;
      this.oppAnimStart = now;
    }
    const oppAnim: AnimName = oppDef.anims[v.opponentAnim] ? v.opponentAnim : 'idle';
    const oppFrame = frameAt(oppDef, oppAnim, now - this.oppAnimStart);
    const img = this.cache.get(oppDef, oppAnim, oppFrame, 'opp');
    const oppSize = oppDef.size * s;
    // slide in from off-screen during the intro
    const slide = (1 - v.intro) * 160 * (v.opponentFacing === -1 ? 1 : -1);
    const ox = v.opponentX - this.geometry.x + slide;
    const oy = v.opponentY - this.geometry.y;
    const oLeft = Math.round(ox - oppDef.anchor.x * s);
    const oTop = Math.round(oy - (oppDef.anchor.y + 1) * s);
    ctx.save();
    if (v.opponentFacing === -1) {
      ctx.translate(oLeft + oppSize, oTop);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, oppSize, oppSize);
    } else {
      ctx.drawImage(img, oLeft, oTop, oppSize, oppSize);
    }
    ctx.restore();

    // Canvas rect in the same window-local units as ax/ay/oLeft/etc — every HUD element below
    // clamps into this so a mon standing near the edge of the (now generously-sized, but still
    // finite, see apps/desktop/src/main/display.ts:battleBounds) arena window never draws its hp
    // bar, popups or the banner partly outside the window itself.
    const canvasW = this.geometry.width;
    const canvasH = this.geometry.height;
    const margin = 4 * s;

    // hp bars above both sprites
    const barW = 14 * s;
    const barH = Math.max(3, s);
    const drawBar = (cx0: number, top: number, hp: number, max: number, label: string) => {
      ctx.font = `${Math.max(9, 4 * s)}px system-ui, sans-serif`;
      const labelW = ctx.measureText(label).width;
      const cx = clampCenter(cx0, Math.max(barW, labelW), canvasW, margin);
      const x = Math.round(cx - barW / 2);
      const y = Math.round(clamp(top - barH - 3 * s, margin, canvasH - barH - margin));
      ctx.fillStyle = 'rgba(20,22,28,0.85)';
      ctx.fillRect(x - 1, y - 1, barW + 2, barH + 2);
      const f = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
      ctx.fillStyle = f > 0.5 ? '#7cb342' : f > 0.25 ? '#ffd740' : '#ff5252';
      ctx.fillRect(x, y, Math.round(barW * f), barH);
      ctx.fillStyle = '#e8e9ee';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, cx, Math.max(y - 2, margin + 8 * s));
    };
    const myBBox = frameBBox(this.currentSprite(model), 'idle', 0);
    const myVisualTop = myBBox ? myTop + myBBox.y * s : myTop;
    const oppBBox = frameBBox(oppDef, 'idle', 0);
    const oppVisualTop = oppBBox ? oTop + oppBBox.y * s : oTop;
    drawBar(ax, myVisualTop, v.hp.me, v.maxHp.me, `Lv ${battle.msg.me.level}`);
    if (v.intro >= 1)
      drawBar(
        ox,
        oppVisualTop,
        v.hp.opp,
        v.maxHp.opp,
        `${v.opponent.nickname} · Lv ${v.opponent.level}`,
      );

    // popups
    for (const p of v.popups) {
      const age = battle.popupAge(p, now) / BattlePlayer.popupMs();
      const baseTop = p.side === 'a' ? myVisualTop : oppVisualTop;
      ctx.font = `bold ${Math.max(10, 5 * s)}px system-ui, sans-serif`;
      const textW = ctx.measureText(p.text).width;
      const cx = clampCenter(p.side === 'a' ? ax : ox, textW, canvasW, margin);
      const cy = clamp(baseTop - 8 * s - age * 14 * s, margin + 10 * s, canvasH - margin);
      ctx.globalAlpha = Math.max(0, 1 - age * age);
      ctx.fillStyle = p.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(p.text, cx, cy);
      ctx.globalAlpha = 1;
    }

    // banner: wraps/shrinks to fit the canvas width instead of ever drawing past its right edge
    // (bug: "Pebblet used Bedrock Sla…" cut off) — see apps/desktop/src/renderer/pet/bannerFit.ts.
    if (v.banner) {
      const baseFontPx = Math.max(10, 4.5 * s);
      const minFontPx = Math.max(8, baseFontPx * 0.6);
      const maxTextWidth = Math.max(40, canvasW - margin * 2 - 12);
      const measure: MeasureText = (text, fontPx) => {
        ctx.font = `${fontPx}px system-ui, sans-serif`;
        return ctx.measureText(text).width;
      };
      const layout = fitBanner(v.banner, maxTextWidth, { baseFontPx, minFontPx }, measure);
      ctx.font = `${layout.fontPx}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const lineW = Math.max(...layout.lines.map((l) => ctx.measureText(l).width));
      const w = lineW + 12;
      const lineH = layout.fontPx + 3 * s;
      const boxH = lineH * layout.lines.length + 3 * s;
      const cx = clampCenter((ax + ox) / 2, w, canvasW, margin);
      const y = clamp(
        Math.min(myTop, oTop) - 20 * s - (boxH - 6 * s),
        margin,
        canvasH - boxH - margin,
      );
      ctx.fillStyle = 'rgba(20,22,28,0.85)';
      ctx.fillRect(Math.round(cx - w / 2), Math.round(y), Math.round(w), Math.round(boxH));
      ctx.fillStyle = '#e8e9ee';
      for (let i = 0; i < layout.lines.length; i++) {
        ctx.fillText(layout.lines[i]!, cx, y + s + i * lineH);
      }
    }
    void ay;
    void mySize;
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
