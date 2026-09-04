import { describe, expect, it } from 'vitest';
import { NATION_PALETTES, getSprite, hexToRgba, tintPalette } from '../src/index.ts';

describe('tintPalette', () => {
  it('swaps only P/S/A/D and leaves other keys untouched', () => {
    const base = { P: '#111111', S: '#222222', A: '#333333', D: '#444444', w: '#fbf6ea' };
    const water = tintPalette(base, 'water');
    expect(water).toEqual({
      P: NATION_PALETTES.water.primary,
      S: NATION_PALETTES.water.secondary,
      A: NATION_PALETTES.water.accent,
      D: NATION_PALETTES.water.dark,
      w: '#fbf6ea',
    });
    // input is not mutated
    expect(base.P).toBe('#111111');
  });

  it('does not add keys the palette lacks', () => {
    expect(tintPalette({ w: '#ffffff' }, 'earth')).toEqual({ w: '#ffffff' });
  });

  it('tints the egg for every nation', () => {
    const egg = getSprite('egg');
    for (const nation of ['water', 'fire', 'earth', 'air'] as const) {
      const p = tintPalette(egg.palette, nation);
      expect(p.P).toBe(NATION_PALETTES[nation].primary);
      expect(p.D).toBe(NATION_PALETTES[nation].dark);
      expect(p.w).toBe(egg.palette.w);
      expect(Object.keys(p).sort()).toEqual(Object.keys(egg.palette).sort());
    }
    expect(tintPalette(egg.palette, 'fire')).toEqual(egg.palette);
  });
});

describe('hexToRgba', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgba('#ff9100')).toEqual([255, 145, 0, 255]);
    expect(hexToRgba('2B2B2B')).toEqual([43, 43, 43, 255]);
  });

  it('parses 8-digit hex with alpha', () => {
    expect(hexToRgba('#ff910080')).toEqual([255, 145, 0, 128]);
    expect(hexToRgba('#00000000')).toEqual([0, 0, 0, 0]);
  });

  it('expands short forms', () => {
    expect(hexToRgba('#f80')).toEqual([255, 136, 0, 255]);
    expect(hexToRgba('#f808')).toEqual([255, 136, 0, 136]);
  });

  it('throws on garbage', () => {
    expect(() => hexToRgba('#12345')).toThrow();
    expect(() => hexToRgba('red')).toThrow();
    expect(() => hexToRgba('#gg0000')).toThrow();
  });
});
