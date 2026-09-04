import { describe, expect, it } from 'vitest';
import {
  animOf,
  frameAt,
  frameBBox,
  getSprite,
  hexToRgba,
  rasterize,
  type SpriteDef,
} from '../src/index.ts';

const px = (data: Uint8ClampedArray, size: number, x: number, y: number) =>
  Array.from(data.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));

describe('rasterize', () => {
  const egg = getSprite('egg');

  it('produces an RGBA buffer of size*size*4', () => {
    const r = rasterize(egg, 'idle', 0);
    expect(r.width).toBe(32);
    expect(r.height).toBe(32);
    expect(r.data).toBeInstanceOf(Uint8ClampedArray);
    expect(r.data.length).toBe(32 * 32 * 4);
  });

  it('is transparent where the frame has "." and colored elsewhere', () => {
    const r = rasterize(egg, 'idle', 0);
    const rows = egg.anims.idle!.frames[0]!.split('\n');
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const c = rows[y]![x]!;
        const [, , , a] = px(r.data, 32, x, y);
        if (c === '.') expect(a, `(${x},${y})`).toBe(0);
        else expect(a, `(${x},${y})`).toBe(255);
      }
    }
    // the corner is empty, the bottom of the shell sits on the anchor row
    expect(px(r.data, 32, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(rows[31]![16]).toBe('D');
    expect(px(r.data, 32, 16, 31)).toEqual([...hexToRgba(egg.palette.D!)]);
  });

  it('honors paletteOverride without touching the sprite palette', () => {
    const r = rasterize(egg, 'idle', 0, { D: '#ff0000' });
    expect(px(r.data, 32, 16, 31)).toEqual([255, 0, 0, 255]);
    expect(egg.palette.D).toBe('#2b2b2b');
    // 8-digit hex with alpha is passed through
    const half = rasterize(egg, 'idle', 0, { D: '#00ff0080' });
    expect(px(half.data, 32, 16, 31)).toEqual([0, 255, 0, 128]);
  });

  it('reports the same bbox as frameBBox', () => {
    for (const id of ['egg', 'sparkit-baby', 'infernode-adult', 'fx-zzz']) {
      const def = getSprite(id);
      const r = rasterize(def, 'idle', 0);
      expect(r.bbox).toEqual(frameBBox(def, 'idle', 0));
    }
  });

  it('wraps frame indices', () => {
    const n = egg.anims.wobble!.frames.length;
    expect(rasterize(egg, 'wobble', n).data).toEqual(rasterize(egg, 'wobble', 0).data);
  });
});

describe('animOf / frameAt', () => {
  const def: SpriteDef = {
    id: 'test',
    size: 32,
    palette: { X: '#ffffff' },
    anchor: { x: 16, y: 31 },
    anims: {
      idle: { fps: 2, loop: true, frames: ['X', 'XX'] },
      walk: { fps: 10, loop: true, frames: ['a', 'b', 'c', 'd'] },
      crack: { fps: 4, loop: false, frames: ['a', 'b', 'c'] },
    },
  };

  it('falls back to idle for missing anims', () => {
    expect(animOf(def, 'walk')).toBe(def.anims.walk);
    expect(animOf(def, 'sleep')).toBe(def.anims.idle);
  });

  it('computes loop frames from fps and wraps', () => {
    expect(frameAt(def, 'walk', 0)).toBe(0);
    expect(frameAt(def, 'walk', 99)).toBe(0);
    expect(frameAt(def, 'walk', 100)).toBe(1);
    expect(frameAt(def, 'walk', 350)).toBe(3);
    expect(frameAt(def, 'walk', 400)).toBe(0);
    expect(frameAt(def, 'walk', 1050)).toBe(2);
  });

  it('clamps non-loop anims to the last frame', () => {
    expect(frameAt(def, 'crack', 0)).toBe(0);
    expect(frameAt(def, 'crack', 250)).toBe(1);
    expect(frameAt(def, 'crack', 500)).toBe(2);
    expect(frameAt(def, 'crack', 10_000)).toBe(2);
  });

  it('treats negative or non-finite times as zero', () => {
    expect(frameAt(def, 'walk', -500)).toBe(0);
    expect(frameAt(def, 'walk', Number.NaN)).toBe(0);
  });

  it('returns 0 for single-frame anims', () => {
    const single: SpriteDef = { ...def, anims: { idle: { fps: 5, loop: true, frames: ['X'] } } };
    expect(frameAt(single, 'idle', 12_345)).toBe(0);
  });
});
