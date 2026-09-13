import type { Nation } from '@claude-mons/shared';

/**
 * Move-type chip (docs/design/ui-style.md Component specs): a `nation`-type move's chip fills
 * solid with that nation's color and dark ink text; a `neutral`-type move's chip fills a fixed
 * neutral grey. Maps 1:1 onto `docs/design/progression.md`'s move `type: 'neutral' | 'nation'`
 * field -- pass the mon's own nation for a nation-type move, or `'neutral'`.
 */
export function TypeChip({ nation, label }: { nation: Nation | 'neutral'; label: string }) {
  return (
    <span class={`typechip ${nation === 'neutral' ? 'neutral' : `nation-${nation}`}`}>{label}</span>
  );
}
