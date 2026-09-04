export * from './types.ts';
export * from './raster.ts';
export * from './palette.ts';

import { EGG } from './egg.ts';
import { FX_SPRITES } from './fx/index.ts';
import { BLAZEBIT_TEEN } from './species/blazebit.ts';
import { INFERNODE_ADULT } from './species/infernode.ts';
import { SPARKIT_BABY } from './species/sparkit.ts';
import type { SpriteDef } from './types.ts';

const ALL: SpriteDef[] = [EGG, SPARKIT_BABY, BLAZEBIT_TEEN, INFERNODE_ADULT, ...FX_SPRITES];

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
