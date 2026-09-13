import type { Nation } from '@claude-mons/shared';

/** Short crest code shown on a nation banner tile / podium crest. */
const NATION_CODE: Record<Nation, string> = {
  water: 'WTR',
  fire: 'FIR',
  earth: 'ETH',
  air: 'AIR',
};

/**
 * Small crest tile for a nation (docs/design/ui-panels.md Leaderboard's banner tiles): a solid
 * nation-colored square with its 3-letter code in ink text.
 */
export function NationBadge({ nation }: { nation: Nation }) {
  return <span class={`crest crest-${nation}`}>{NATION_CODE[nation]}</span>;
}
