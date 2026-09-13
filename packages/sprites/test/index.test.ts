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

  it('maps a species id to its evolved forms', () => {
    expect(spriteIdFor('sparkit', 'teen')).toBe('blazebit-teen');
    expect(spriteIdFor('sparkit', 'adult')).toBe('infernode-adult');
    expect(spriteIdFor('pebblet', 'teen')).toBe('boulderbyte-teen');
    expect(spriteIdFor('blazebit', 'adult')).toBe('infernode-adult');
  });

  it('resolves a registered sprite for every species at every stage', () => {
    const species = [
      'dripple',
      'bubblit',
      'sparkit',
      'cinderpup',
      'pebblet',
      'mossling',
      'puffle',
      'wispit',
    ];
    for (const id of species) {
      for (const stage of ['baby', 'teen', 'adult'] as const) {
        expect(() => getSprite(spriteIdFor(id, stage))).not.toThrow();
      }
    }
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
