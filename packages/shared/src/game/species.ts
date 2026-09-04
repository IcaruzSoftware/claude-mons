import type { Nation, Rarity, Stage, Stats } from '../types.ts';

export interface SpeciesMoves {
  normal: string;
  typed: string;
  special: string;
}

export interface Species {
  /** Baby name, lowercased. Sprite ids are `${id}-${stage}`. */
  id: string;
  nation: Nation;
  rarity: Rarity;
  /** display names per stage */
  names: { baby: string; teen: string; adult: string };
  baseStats: Stats;
  moves: SpeciesMoves;
  flavor: string;
}

export const RARITY_WEIGHT: Record<Rarity, number> = { common: 75, rare: 25 };

export const SPECIES: Record<string, Species> = {
  dripple: {
    id: 'dripple',
    nation: 'water',
    rarity: 'common',
    names: { baby: 'Dripple', teen: 'Pipefin', adult: 'Torrentide' },
    baseStats: { hp: 85, atk: 45, def: 50, spd: 30 },
    moves: { normal: 'Drip Tap', typed: 'Stream Splash', special: 'Backpressure' },
    flavor: 'A single drop that insists it is a pipeline.',
  },
  bubblit: {
    id: 'bubblit',
    nation: 'water',
    rarity: 'rare',
    names: { baby: 'Bubblit', teen: 'Cachecoral', adult: 'Deepseaquel' },
    baseStats: { hp: 80, atk: 50, def: 55, spd: 30 },
    moves: { normal: 'Bubble Pop', typed: 'Cache Wave', special: 'Full Outer Join' },
    flavor: 'Remembers every query you ever ran. Forgives none of them.',
  },
  sparkit: {
    id: 'sparkit',
    nation: 'fire',
    rarity: 'common',
    names: { baby: 'Sparkit', teen: 'Blazebit', adult: 'Infernode' },
    baseStats: { hp: 70, atk: 60, def: 40, spd: 40 },
    moves: { normal: 'Spark Nip', typed: 'Hot Reload', special: 'Force Push' },
    flavor: 'Hatched from a hot reload. Has never waited for a build.',
  },
  cinderpup: {
    id: 'cinderpup',
    nation: 'fire',
    rarity: 'rare',
    names: { baby: 'Cinderpup', teen: 'Hotfixhound', adult: 'Overclockwolf' },
    baseStats: { hp: 75, atk: 60, def: 40, spd: 40 },
    moves: { normal: 'Ember Bite', typed: 'Hotfix Howl', special: 'Overclock' },
    flavor: 'Deploys on Friday. Sleeps like a baby.',
  },
  pebblet: {
    id: 'pebblet',
    nation: 'earth',
    rarity: 'common',
    names: { baby: 'Pebblet', teen: 'Boulderbyte', adult: 'Monolithor' },
    baseStats: { hp: 90, atk: 45, def: 55, spd: 20 },
    moves: { normal: 'Pebble Toss', typed: 'Bedrock Slam', special: 'Monolith Drop' },
    flavor: 'Has 100% test coverage and will tell you about it.',
  },
  mossling: {
    id: 'mossling',
    nation: 'earth',
    rarity: 'rare',
    names: { baby: 'Mossling', teen: 'Rootling', adult: 'Terraformer' },
    baseStats: { hp: 85, atk: 50, def: 55, spd: 25 },
    moves: { normal: 'Moss Pat', typed: 'Root Bind', special: 'terraform apply' },
    flavor: 'Grows a small data center on its back. Zero downtime.',
  },
  puffle: {
    id: 'puffle',
    nation: 'air',
    rarity: 'common',
    names: { baby: 'Puffle', teen: 'Gustling', adult: 'Nimbyte' },
    baseStats: { hp: 65, atk: 50, def: 40, spd: 55 },
    moves: { normal: 'Puff', typed: 'Gust Draft', special: 'Thunderclap' },
    flavor: 'Mostly vapor, mostly ideas, entirely uncontainable.',
  },
  wispit: {
    id: 'wispit',
    nation: 'air',
    rarity: 'rare',
    names: { baby: 'Wispit', teen: 'Zephyrix', adult: 'Stratosphinx' },
    baseStats: { hp: 70, atk: 50, def: 40, spd: 55 },
    moves: { normal: 'Wisp Flick', typed: 'Zephyr Cut', special: 'Riddle of the Docs' },
    flavor: 'Answers every question with a better question.',
  },
};

export const SPECIES_IDS: readonly string[] = Object.keys(SPECIES);

export function speciesOf(id: string): Species {
  const s = SPECIES[id];
  if (!s) throw new Error(`unknown species: ${id}`);
  return s;
}

export function speciesForNation(nation: Nation): Species[] {
  return Object.values(SPECIES).filter((s) => s.nation === nation);
}

export function displayName(speciesId: string, stage: Stage): string {
  const s = speciesOf(speciesId);
  return stage === 'egg' ? 'Egg' : s.names[stage];
}

/**
 * Rolls a species within a nation. `roll` is a uniform random number in [0, 1) supplied by the
 * caller (server: crypto; tests: fixed) so this stays pure and Deno-friendly.
 */
export function rollSpecies(nation: Nation, roll: number): Species {
  const pool = speciesForNation(nation);
  const total = pool.reduce((a, s) => a + RARITY_WEIGHT[s.rarity], 0);
  let r = Math.min(Math.max(roll, 0), 0.999999) * total;
  for (const s of pool) {
    r -= RARITY_WEIGHT[s.rarity];
    if (r < 0) return s;
  }
  return pool[pool.length - 1]!;
}
