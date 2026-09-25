import type { SpriteDef } from '../types.ts';
import { BLAZEBIT_TEEN } from './blazebit.ts';
import { EMBERKIT_BABY } from './emberkit.ts';
import { EMBERFOX_TEEN } from './emberfox.ts';
import { INFERNODE_ADULT } from './infernode.ts';
import { SPARKIT_BABY } from './sparkit.ts';
import { TWINFLARE_ADULT } from './twinflare.ts';

/** Fire nation sprites: Sparkit line (common) and Emberkit line (rare, species id `cinderpup`). */
export const FIRE_SPRITES: SpriteDef[] = [
  SPARKIT_BABY,
  BLAZEBIT_TEEN,
  INFERNODE_ADULT,
  EMBERKIT_BABY,
  EMBERFOX_TEEN,
  TWINFLARE_ADULT,
];
