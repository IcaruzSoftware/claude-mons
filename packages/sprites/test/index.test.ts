import { describe, expect, it } from 'vitest';
import { SPRITES, getSprite, spriteIdFor } from '../src/index.ts';

describe('spriteIdFor', () => {
  it('maps the egg stage to the shared egg sprite', () => {
    expect(spriteIdFor('sparkit', 'egg')).toBe('egg');
    expect(spriteIdFor('dripple', 'egg')).toBe('egg');
  });

  it('builds species-stage ids', () => {
    expect(spriteIdFor('sparkit', 'baby')).toBe('sparkit-baby');
    expect(spriteIdFor('blazebit', 'teen')).toBe('blazebit-teen');
    expect(spriteIdFor('infernode', 'adult')).toBe('infernode-adult');
  });

  it('resolves to registered sprites for the fire line', () => {
    expect(getSprite(spriteIdFor('sparkit', 'baby'))).toBe(SPRITES['sparkit-baby']);
    expect(getSprite(spriteIdFor('blazebit', 'teen')).size).toBe(32);
    expect(getSprite(spriteIdFor('infernode', 'adult')).size).toBe(48);
  });
});

describe('getSprite', () => {
  it('returns the definition for known ids', () => {
    expect(getSprite('egg').id).toBe('egg');
    expect(getSprite('fx-heart').anims.idle).toBeDefined();
  });

  it('throws on unknown ids', () => {
    expect(() => getSprite('nope')).toThrow(/Unknown sprite id/);
  });
});
