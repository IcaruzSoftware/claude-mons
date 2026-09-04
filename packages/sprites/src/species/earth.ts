import type { SpriteDef } from '../types.ts';
import { BOULDERBYTE_TEEN } from './boulderbyte.ts';
import { MONOLITHOR_ADULT } from './monolithor.ts';
import { MOSSLING_BABY } from './mossling.ts';
import { PEBBLET_BABY } from './pebblet.ts';
import { ROOTLING_TEEN } from './rootling.ts';
import { TERRAFORMER_ADULT } from './terraformer.ts';

/** Earth nation sprites: Pebblet line (common) and Mossling line (rare). */
export const EARTH_SPRITES: SpriteDef[] = [
  PEBBLET_BABY,
  BOULDERBYTE_TEEN,
  MONOLITHOR_ADULT,
  MOSSLING_BABY,
  ROOTLING_TEEN,
  TERRAFORMER_ADULT,
];
