import { createPrng, type Nation } from '@claude-mons/shared';

/**
 * Species available per nation. Phase 3 moves this table into packages/shared (with stats and
 * moves); for now it only drives local hatching in LOCAL_GAME mode.
 */
export const SPECIES_BY_NATION: Record<Nation, Array<{ id: string; rarity: 'common' | 'rare' }>> = {
  water: [
    { id: 'dripple', rarity: 'common' },
    { id: 'bubblit', rarity: 'rare' },
  ],
  fire: [
    { id: 'sparkit', rarity: 'common' },
    { id: 'cinderpup', rarity: 'rare' },
  ],
  earth: [
    { id: 'pebblet', rarity: 'common' },
    { id: 'mossling', rarity: 'rare' },
  ],
  air: [
    { id: 'puffle', rarity: 'common' },
    { id: 'wispit', rarity: 'rare' },
  ],
};

const RARE_CHANCE = 0.25;

/** Local (dev) species roll: rare 25 %, otherwise common. Deterministic per seed. */
export function rollSpeciesForNation(nation: Nation | null, seed: number): string {
  const pool = SPECIES_BY_NATION[nation ?? 'fire'];
  const rng = createPrng(seed ^ 0x5eed);
  const rare = rng.next() < RARE_CHANCE;
  const pick = pool.find((s) => s.rarity === (rare ? 'rare' : 'common')) ?? pool[0]!;
  return pick.id;
}
