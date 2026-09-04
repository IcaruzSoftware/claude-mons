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

/** Sprite id for a species at a stage: the shared 'egg', else `${speciesId}-${stage}`. */
export function spriteIdFor(speciesId: string, stage: Stage): string {
  return stage === 'egg' ? 'egg' : `${speciesId}-${stage}`;
}
