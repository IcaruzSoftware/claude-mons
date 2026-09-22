import { describe, expect, it } from 'vitest';
import { SPECIES_BY_NATION, rollSpeciesForNation } from '../src/main/game/species.ts';

describe('rollSpeciesForNation (local/offline hatch)', () => {
  it('is deterministic per seed', () => {
    for (const seed of [1, 42, 1000, 999999]) {
      expect(rollSpeciesForNation('water', seed)).toBe(rollSpeciesForNation('water', seed));
    }
  });

  it('only ever returns species from the nation pool', () => {
    const waterIds = new Set(SPECIES_BY_NATION.water.map((s) => s.id));
    for (let seed = 0; seed < 500; seed++) {
      expect(waterIds.has(rollSpeciesForNation('water', seed))).toBe(true);
    }
  });

  it('picks among species sharing the drawn rarity instead of always the first', () => {
    // Water has two rares (bubblit, ottlet); across seeds both must be reachable.
    const seen = new Set<string>();
    for (let seed = 0; seed < 2000; seed++) seen.add(rollSpeciesForNation('water', seed));
    expect(seen.has('bubblit')).toBe(true);
    expect(seen.has('ottlet')).toBe(true);
    expect(seen.has('dripple')).toBe(true);
  });

  it('nations with one species per rarity still resolve', () => {
    const fireIds = new Set(SPECIES_BY_NATION.fire.map((s) => s.id));
    for (let seed = 0; seed < 100; seed++) {
      expect(fireIds.has(rollSpeciesForNation('fire', seed))).toBe(true);
    }
  });
});
