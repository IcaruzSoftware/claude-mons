export * from './types.ts';
export * from './raster.ts';
export * from './palette.ts';

import { EGG } from './egg.ts';
import { FX_SPRITES } from './fx/index.ts';
import { AIR_SPRITES } from './species/air.ts';
import { EARTH_SPRITES } from './species/earth.ts';
import { FIRE_SPRITES } from './species/fire.ts';
import { WATER_SPRITES } from './species/water.ts';
import type { SpriteDef } from './types.ts';

const ALL: SpriteDef[] = [
  EGG,
  ...WATER_SPRITES,
  ...FIRE_SPRITES,
  ...EARTH_SPRITES,
  ...AIR_SPRITES,
  ...FX_SPRITES,
];

/** All sprites by id. */
export const SPRITES: Record<string, SpriteDef> = Object.fromEntries(ALL.map((s) => [s.id, s]));

/** Looks up a sprite; throws on unknown ids so typos fail loudly. */
export function getSprite(id: string): SpriteDef {
  const def = SPRITES[id];
  if (!def) throw new Error(`Unknown sprite id: ${JSON.stringify(id)}`);
  return def;
}

export type Stage = 'egg' | 'baby' | 'teen' | 'adult';

/**
 * Evolution lines: species id (the baby name, as used by `packages/shared` and the server) →
 * the stage-specific sprite names. Sprite files are named after the form they draw
 * (`boulderbyte-teen`), while a mon keeps its species id (`pebblet`) for life.
 */
export const EVOLUTION_LINES: Record<string, { baby: string; teen: string; adult: string }> = {
  dripple: { baby: 'dripple', teen: 'pipefin', adult: 'torrentide' },
  bubblit: { baby: 'bubblit', teen: 'cachecoral', adult: 'deepseaquel' },
  ottlet: { baby: 'ottlet', teen: 'brookfin', adult: 'tidewhisker' },
  sparkit: { baby: 'sparkit', teen: 'blazebit', adult: 'infernode' },
  cinderpup: { baby: 'cinderpup', teen: 'hotfixhound', adult: 'overclockwolf' },
  pebblet: { baby: 'pebblet', teen: 'boulderbyte', adult: 'monolithor' },
  mossling: { baby: 'mossling', teen: 'rootling', adult: 'terraformer' },
  puffle: { baby: 'puffle', teen: 'gustling', adult: 'nimbyte' },
  wispit: { baby: 'wispit', teen: 'zephyrix', adult: 'stratosphinx' },
};

/**
 * Sprite id for a species at a stage: the shared 'egg', else the stage form's sprite
 * (`spriteIdFor('pebblet', 'teen')` → `'boulderbyte-teen'`). Stage-form names are accepted as
 * input too, so callers holding a display name keep working.
 */
export function spriteIdFor(speciesId: string, stage: Stage): string {
  if (stage === 'egg') return 'egg';
  const line =
    EVOLUTION_LINES[speciesId] ??
    Object.values(EVOLUTION_LINES).find((l) => l.teen === speciesId || l.adult === speciesId);
  const form = line ? line[stage] : speciesId;
  return `${form}-${stage}`;
}
