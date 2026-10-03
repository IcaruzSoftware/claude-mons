import { describe, expect, it } from 'vitest';
import { animationFor } from '../../shared/src/behavior/states.ts';
import { frameAt, frameBBox, getSprite, spriteIdFor, tintPalette } from '../src/index.ts';

describe.each(['baby', 'teen', 'adult'] as const)('moss evolution: %s', (stage) => {
  const sprite = getSprite(spriteIdFor('mossling', stage));
  const work = sprite.anims.work!;
  const pixels = (value: string, key: string) => [...value].filter((c) => c === key).length;

  it('routes tool activity to its own animated seedling, including the adult', () => {
    expect(animationFor('working', stage).anim).toBe('work');
    expect(sprite.size).toBe(stage === 'adult' ? 48 : 32);
    expect(Object.keys(sprite.anims).sort()).toEqual([
      'attack',
      'happy',
      'hurt',
      'idle',
      'sleep',
      'walk',
      'work',
    ]);
    expect(work.loop).toBe(true);
    expect(new Set(work.frames).size).toBeGreaterThanOrEqual(6);
    expect(frameAt(sprite, 'work', (work.frames.length * 1000) / work.fps + 1)).toBe(0);
  });

  it('keeps the plant intact as its leaves sway and its soil ball stays anchored', () => {
    const leaves = pixels(work.frames[0]!, 'v');
    const soil = pixels(work.frames[0]!, 'q');
    expect(leaves).toBeGreaterThan(0);
    expect(soil).toBeGreaterThan(0);
    const leafCenters: number[] = [];
    let soilPosition: string | undefined;
    for (const value of work.frames) {
      expect(pixels(value, 'v')).toBe(leaves);
      expect(pixels(value, 'q')).toBe(soil);
      const flat = value.replaceAll('\n', '');
      const leafXs = [...flat].flatMap((c, i) => (c === 'v' ? [i % sprite.size] : []));
      leafCenters.push(leafXs.reduce((a, b) => a + b, 0) / leaves);
      const positions = [...flat].flatMap((c, i) => (c === 'q' ? [i] : [])).join(',');
      soilPosition ??= positions;
      expect(positions).toBe(soilPosition);
    }
    expect(Math.max(...leafCenters) - Math.min(...leafCenters)).toBeGreaterThanOrEqual(1);
    expect(work.frames.filter((value) => value.includes('t'))).toHaveLength(1);
  });

  it('keeps feet grounded through work and preserves moss colors after earth tinting', () => {
    for (const name of ['idle', 'work'] as const) {
      sprite.anims[name]!.frames.forEach((_value, index) => {
        const box = frameBBox(sprite, name, index)!;
        expect(box.y + box.h - 1).toBe(sprite.anchor.y);
      });
    }
    const box = frameBBox(sprite, 'idle', 0)!;
    expect(Math.abs(box.x + box.w / 2 - sprite.anchor.x)).toBeLessThanOrEqual(2);
    expect(tintPalette(sprite.palette, 'earth')).toEqual(sprite.palette);
  });
});
