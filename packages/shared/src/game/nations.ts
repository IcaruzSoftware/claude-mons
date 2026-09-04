import type { Nation } from '../types.ts';

export interface NationInfo {
  id: Nation;
  name: string;
  tagline: string;
  personality: string;
  palette: { primary: string; secondary: string; accent: string; dark: string };
}

export const NATION_INFO: Record<Nation, NationInfo> = {
  water: {
    id: 'water',
    name: 'Water',
    tagline: 'Everything is a stream.',
    personality:
      'Calm and adaptive. Flows around problems, refactors with patience, loves pipelines.',
    palette: { primary: '#2ec4b6', secondary: '#1b4f8a', accent: '#e8fbff', dark: '#0d2a4a' },
  },
  fire: {
    id: 'fire',
    name: 'Fire',
    tagline: 'Move fast, break things, fix them faster.',
    personality: 'Bold and quick. Ships hotfixes at 2 a.m. and never leaves a build red for long.',
    palette: { primary: '#ff5252', secondary: '#ff9100', accent: '#ffd740', dark: '#3a0f0f' },
  },
  earth: {
    id: 'earth',
    name: 'Earth',
    tagline: 'It compiles on my machine and on yours.',
    personality:
      'Steady and reliable. Tests everything twice, tends the infrastructure, keeps the monolith standing.',
    palette: { primary: '#7cb342', secondary: '#8d8d8d', accent: '#ffb300', dark: '#2e3a1f' },
  },
  air: {
    id: 'air',
    name: 'Air',
    tagline: 'Just one more idea.',
    personality:
      'Light and curious. Writes the docs, prototypes the wild thing, lives in the cloud.',
    palette: { primary: '#4fc3f7', secondary: '#f5f7ff', accent: '#b39ddb', dark: '#2b3550' },
  },
};

/**
 * Type cycle: each nation beats exactly one and resists exactly one.
 * Water -> Fire -> Air -> Earth -> Water
 * (water douses fire, fire consumes air, air erodes earth, earth dams water)
 */
export const NATION_BEATS: Record<Nation, Nation> = {
  water: 'fire',
  fire: 'air',
  air: 'earth',
  earth: 'water',
};

export function effectiveness(attacker: Nation, defender: Nation): 0.5 | 1 | 2 {
  if (NATION_BEATS[attacker] === defender) return 2;
  if (NATION_BEATS[defender] === attacker) return 0.5;
  return 1;
}

export function otherNations(nation: Nation): Nation[] {
  return (Object.keys(NATION_INFO) as Nation[]).filter((n) => n !== nation);
}
