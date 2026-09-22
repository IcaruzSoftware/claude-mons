import { createPrng, type Nation } from '@claude-mons/shared';

/**
 * Species available per nation. Phase 3 moves this table into packages/shared (with stats and
 * moves); for now it only drives local hatching in LOCAL_GAME mode.
 */
export const SPECIES_BY_NATION: Record<Nation, Array<{ id: string; rarity: 'common' | 'rare' }>> = {
  water: [
    { id: 'dripple', rarity: 'common' },
    { id: 'bubblit', rarity: 'rare' },
    { id: 'ottlet', rarity: 'rare' },
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

/**
 * Local (dev) species roll: rare 25 %, otherwise common. Deterministic per seed. When several
 * species share the drawn rarity (e.g. Water has two rares), a second draw from the same seeded
 * generator picks among them, so the choice stays deterministic instead of always the first match.
 */
export function rollSpeciesForNation(nation: Nation | null, seed: number): string {
  const pool = SPECIES_BY_NATION[nation ?? 'fire'];
  const rng = createPrng(seed ^ 0x5eed);
  const rare = rng.next() < RARE_CHANCE;
  const matches = pool.filter((s) => s.rarity === (rare ? 'rare' : 'common'));
  const candidates = matches.length > 0 ? matches : pool;
  const pick = candidates[Math.floor(rng.next() * candidates.length)] ?? candidates[0]!;
  return pick.id;
}
