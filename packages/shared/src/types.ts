/** The four nations. A player picks one at first launch; it is also the mon's battle type. */
export type Nation = 'water' | 'fire' | 'earth' | 'air';
export const NATIONS: readonly Nation[] = ['water', 'fire', 'earth', 'air'] as const;

/** Evolution stage. Derived purely from level, see game/levels.ts. */
export type Stage = 'egg' | 'baby' | 'teen' | 'adult';
export const STAGES: readonly Stage[] = ['egg', 'baby', 'teen', 'adult'] as const;

export type Rarity = 'common' | 'rare';

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

export function isNation(value: unknown): value is Nation {
  return typeof value === 'string' && (NATIONS as readonly string[]).includes(value);
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}
