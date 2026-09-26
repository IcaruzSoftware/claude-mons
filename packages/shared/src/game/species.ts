import type { EffectId } from '../battle/effects.ts';
import type { Nation, Rarity, Stage, Stats } from '../types.ts';

/**
 * One of a species' eight moves (docs/design/progression.md Move pool and effects). `type: 'nation'`
 * uses `effectiveness()` from `./nations.ts` like the old `typed`/`special` move kinds did;
 * `'neutral'` never does. `unlocksAt` is the mon level this move joins the loadout pool
 * (`unlockedMoves` below); it always matches this move's position in `movePool` via
 * `MOVE_UNLOCK_LEVELS`, repeated on the move itself so UI code (locked-move rows, error messages)
 * doesn't need to re-derive it from array position.
 */
export interface Move {
  /** stable id, unique within a species' movePool; referenced by `MonLoadout.moves`. */
  id: string;
  name: string;
  power: number;
  type: 'neutral' | 'nation';
  effect: EffectId | null;
  unlocksAt: number;
}

/**
 * Unlock schedule by mon level (docs/design/progression.md Move pool and effects): 2 moves at
 * hatch (level 2), core moves at 5/10/15/20, then signatures at evolutions 10/25.
 * Index-aligned with `movePool`; existing core move ids and unlocks remain stable.
 */
export const MOVE_UNLOCK_LEVELS: readonly number[] = [2, 2, 5, 10, 15, 20, 10, 25] as const;

export interface Species {
  /** Baby name, lowercased. Sprite ids are `${id}-${stage}`. */
  id: string;
  nation: Nation;
  rarity: Rarity;
  /** display names per stage */
  names: { baby: string; teen: string; adult: string };
  baseStats: Stats;
  /** Six core moves, then teen/adult signature moves (see `MOVE_UNLOCK_LEVELS`). */
  movePool: [Move, Move, Move, Move, Move, Move, Move, Move];
  flavor: string;
}

export const RARITY_WEIGHT: Record<Rarity, number> = { common: 75, rare: 25 };

function pool(
  moves: ReadonlyArray<[name: string, power: number, type: Move['type'], effect: EffectId]>,
): [Move, Move, Move, Move, Move, Move, Move, Move] {
  return moves.map(([name, power, type, effect], i) => ({
    id: slugify(name),
    name,
    power,
    type,
    effect,
    unlocksAt: MOVE_UNLOCK_LEVELS[i]!,
  })) as [Move, Move, Move, Move, Move, Move, Move, Move];
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const SPECIES: Record<string, Species> = {
  dripple: {
    id: 'dripple',
    nation: 'water',
    rarity: 'common',
    names: { baby: 'Dripple', teen: 'Pipefin', adult: 'Torrentide' },
    baseStats: { hp: 88, atk: 45, def: 50, spd: 30 },
    movePool: pool([
      ['Drip Tap', 45, 'neutral', 'priority'],
      ['Stream Splash', 40, 'nation', 'def_down'],
      ['Backpressure', 75, 'nation', 'shield_first'],
      ['Ripple Step', 50, 'neutral', 'priority'],
      ['Pressure Jet', 55, 'nation', 'crit_up'],
      ['Deep Current', 65, 'nation', 'drain'],
      ['Pressure Burst', 80, 'nation', 'shield_first'],
      ['Ocean Break', 85, 'nation', 'shield_first'],
    ]),
    flavor: 'A single drop that insists it is a pipeline.',
  },
  bubblit: {
    id: 'bubblit',
    nation: 'water',
    rarity: 'rare',
    names: { baby: 'Bubblit', teen: 'Cachecoral', adult: 'Deepseaquel' },
    baseStats: { hp: 78, atk: 50, def: 53, spd: 36 },
    movePool: pool([
      ['Bubble Pop', 45, 'neutral', 'priority'],
      ['Cache Wave', 40, 'nation', 'drain'],
      ['Full Outer Join', 75, 'nation', 'true_hit'],
      ['Foam Barrier', 50, 'nation', 'shield_first'],
      ['Brine Corrode', 55, 'nation', 'def_down'],
      ['Scalding Current', 65, 'nation', 'burn'],
      ['Coral Crash', 80, 'nation', 'true_hit'],
      ['Abyss Bloom', 85, 'nation', 'true_hit'],
    ]),
    flavor: 'Remembers every query you ever ran. Forgives none of them.',
  },
  ottlet: {
    id: 'ottlet',
    nation: 'water',
    rarity: 'rare',
    names: { baby: 'Ottlet', teen: 'Brookfin', adult: 'Tidewhisker' },
    baseStats: { hp: 79, atk: 61, def: 42, spd: 40 },
    movePool: pool([
      ['Splash Dash', 45, 'neutral', 'priority'],
      ['Fish Flick', 40, 'nation', 'crit_up'],
      ['River Rush', 75, 'nation', 'def_down'],
      ['Whisker Sense', 50, 'nation', 'true_hit'],
      ['Undertow', 55, 'nation', 'drain'],
      ['Tidal Tumble', 65, 'nation', 'burn'],
      ['Fish Breaker', 80, 'nation', 'def_down'],
      ['Torrent Fish Slam', 85, 'nation', 'def_down'],
    ]),
    flavor: 'Never lets go of its fish, not even mid-somersault down the rapids.',
  },
  sparkit: {
    id: 'sparkit',
    nation: 'fire',
    rarity: 'common',
    names: { baby: 'Sparkit', teen: 'Blazebit', adult: 'Infernode' },
    baseStats: { hp: 71, atk: 60, def: 42, spd: 38 },
    movePool: pool([
      ['Spark Nip', 45, 'neutral', 'priority'],
      ['Hot Reload', 40, 'nation', 'crit_up'],
      ['Force Push', 75, 'nation', 'def_down'],
      ['Brushfire', 50, 'nation', 'true_hit'],
      ['Kindling Surge', 58, 'nation', 'charge'],
      ['Flash Ignite', 50, 'neutral', 'priority'],
      ['Flare Pounce', 80, 'nation', 'def_down'],
      ['Inferno Impact', 85, 'nation', 'def_down'],
    ]),
    flavor: 'Hatched from a hot reload. Has never waited for a build.',
  },
  cinderpup: {
    id: 'cinderpup',
    nation: 'fire',
    rarity: 'rare',
    names: { baby: 'Emberkit', teen: 'Emberfox', adult: 'Twinflare' },
    baseStats: { hp: 77, atk: 60, def: 40, spd: 40 },
    movePool: pool([
      ['Ember Bite', 45, 'neutral', 'priority'],
      ['Hotfix Howl', 40, 'nation', 'burn'],
      ['Overclock', 75, 'nation', 'crit_up'],
      ['Ashfang Strike', 50, 'nation', 'crit_up'],
      ['Cinder Feast', 55, 'nation', 'drain'],
      ['Soot Ward', 50, 'nation', 'shield_first'],
      ['Ember Maul', 80, 'nation', 'crit_up'],
      ['Twin Flare Rush', 85, 'nation', 'crit_up'],
    ]),
    flavor: 'Deploys on Friday. Sleeps like a baby.',
  },
  pebblet: {
    id: 'pebblet',
    nation: 'earth',
    rarity: 'common',
    names: { baby: 'Pebblet', teen: 'Boulderbyte', adult: 'Monolithor' },
    baseStats: { hp: 90, atk: 45, def: 55, spd: 20 },
    movePool: pool([
      ['Pebble Toss', 45, 'neutral', 'priority'],
      ['Bedrock Slam', 40, 'nation', 'def_down'],
      ['Monolith Drop', 75, 'nation', 'crit_up'],
      ['Fault Line', 50, 'nation', 'def_down'],
      ['Magma Vein', 55, 'nation', 'burn'],
      ['Landslide', 65, 'nation', 'true_hit'],
      ['Boulder Crash', 80, 'nation', 'crit_up'],
      ['Monolith Quake', 85, 'nation', 'crit_up'],
    ]),
    flavor: 'Has 100% test coverage and will tell you about it.',
  },
  mossling: {
    id: 'mossling',
    nation: 'earth',
    rarity: 'rare',
    names: { baby: 'Mossling', teen: 'Rootling', adult: 'Terraformer' },
    baseStats: { hp: 93, atk: 47, def: 55, spd: 23 },
    movePool: pool([
      ['Moss Pat', 45, 'neutral', 'priority'],
      ['Root Bind', 40, 'nation', 'def_down'],
      ['terraform apply', 75, 'nation', 'drain'],
      ['Taproot Surge', 58, 'nation', 'charge'],
      ['Spore Burst', 50, 'neutral', 'priority'],
      ['Ironwood Strike', 60, 'nation', 'crit_up'],
      ['Root Crush', 80, 'nation', 'drain'],
      ['Forest Surge', 85, 'nation', 'drain'],
    ]),
    flavor: 'Grows a small data center on its back. Zero downtime.',
  },
  puffle: {
    id: 'puffle',
    nation: 'air',
    rarity: 'common',
    names: { baby: 'Puffle', teen: 'Gustling', adult: 'Nimbyte' },
    baseStats: { hp: 61, atk: 52, def: 48, spd: 49 },
    movePool: pool([
      ['Puff', 45, 'neutral', 'priority'],
      ['Gust Draft', 40, 'nation', 'crit_up'],
      ['Thunderclap', 75, 'nation', 'true_hit'],
      ['Vortex Pull', 50, 'nation', 'drain'],
      ['Windbreak', 50, 'nation', 'shield_first'],
      ['Pressure Drop', 55, 'nation', 'def_down'],
      ['Cyclone Burst', 80, 'nation', 'true_hit'],
      ['Skybreaker', 85, 'nation', 'true_hit'],
    ]),
    flavor: 'Mostly vapor, mostly ideas, entirely uncontainable.',
  },
  wispit: {
    id: 'wispit',
    nation: 'air',
    rarity: 'rare',
    names: { baby: 'Wispit', teen: 'Zephyrix', adult: 'Stratosphinx' },
    baseStats: { hp: 76, atk: 49, def: 43, spd: 55 },
    movePool: pool([
      ['Wisp Flick', 45, 'neutral', 'priority'],
      ['Zephyr Cut', 40, 'nation', 'crit_up'],
      ['Riddle of the Docs', 75, 'nation', 'def_down'],
      ['Windburn', 50, 'nation', 'burn'],
      ['Foretold Squall', 58, 'nation', 'true_hit'],
      ['Gathering Storm', 60, 'nation', 'charge'],
      ['Tempest Cut', 80, 'nation', 'def_down'],
      ['Stratosphere Dive', 85, 'nation', 'def_down'],
    ]),
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

/** This species' moves unlocked at `level` (docs/design/progression.md Move pool and effects). */
export function unlockedMoves(species: Species, level: number): Move[] {
  return species.movePool.filter((m) => level >= m.unlocksAt);
}

export function findMove(species: Species, moveId: string): Move | undefined {
  return species.movePool.find((m) => m.id === moveId);
}

/**
 * Default loadout (3 move ids) for a mon with no `loadout.moves` set. Evolution signatures
 * replace slot 3 automatically once unlocked; custom saved loadouts stay unchanged. Below 10: the first three unlocked
 * moves in pool order (docs/design/progression.md Loadout policy) -- for species whose pool keeps
 * the old `normal`/`typed`/`special` moves in slots 1-3, this reproduces the pre-Phase-B mapping
 * (normal in slot 1/opener, typed in slot 2/default, special in slot 3/finisher). Below level 5 a
 * mon only has 2 moves unlocked (see `MOVE_UNLOCK_LEVELS`); the last unlocked move repeats to fill
 * the remaining slot(s) so the battle engine (which always needs an opener/default/finisher) never
 * sees fewer than 3 entries. Eggs cannot battle in practice (no species at all below level 2), but
 * this stays total for level < 2 too (falls back to the pool's first move) so the battle engine
 * never has to special-case a malformed/out-of-range level.
 */
export function defaultLoadoutMoveIds(species: Species, level: number): [string, string, string] {
  const unlocked = unlockedMoves(species, level);
  const source = unlocked.length > 0 ? unlocked : species.movePool.slice(0, 1);
  const picks = source.slice(0, 3).map((m) => m.id);
  const signature = species.movePool
    .slice(6)
    .filter((m) => level >= m.unlocksAt)
    .at(-1);
  if (signature) picks[2] = signature.id;
  while (picks.length < 3) picks.push(source[source.length - 1]!.id);
  return [picks[0]!, picks[1]!, picks[2]!];
}
