import { describe, expect, it } from 'vitest';
import {
  SPECIES_IDS,
  defaultLoadoutMoveIds,
  speciesOf,
  unlockedMoves,
} from '../src/game/species.ts';

describe('defaultLoadoutMoveIds', () => {
  it('a level-4 Mossling only defaults to moves unlocked at level 4', () => {
    // Regression test: the loadout editor (apps/desktop/src/renderer/panel/views/Battles.tsx)
    // used to fall back to `species.movePool.slice(0, 3)` -- pool order, not unlock order -- for
    // a mon with no saved loadout yet. Mossling's pool has 'terraform apply' (unlocksAt: 5) at
    // index 2, so a level-4 Mossling's editor opened pre-loaded with a locked move, which left
    // Save permanently (and silently) disabled. `defaultLoadoutMoveIds` is the fix: it must only
    // ever draw from what's actually unlocked.
    const species = speciesOf('mossling');
    const ids = defaultLoadoutMoveIds(species, 4);
    // Only 'Moss Pat' and 'Root Bind' unlock by level 4; the third slot repeats the last unlocked
    // move rather than reaching for 'terraform apply' (unlocksAt: 5).
    expect(ids).toEqual(['moss-pat', 'root-bind', 'root-bind']);
    expect(ids).not.toContain('terraform-apply');
  });

  it('never returns a move that is not unlocked, for every species at every level past hatch', () => {
    for (const id of SPECIES_IDS) {
      const species = speciesOf(id);
      for (let level = 2; level <= 25; level++) {
        const unlockedIds = new Set(unlockedMoves(species, level).map((m) => m.id));
        const picks = defaultLoadoutMoveIds(species, level);
        expect(picks).toHaveLength(3);
        for (const pick of picks) {
          expect(unlockedIds.has(pick)).toBe(true);
        }
      }
    }
  });

  it('always returns 3 distinct-or-repeated ids, filling from the last unlocked move below level 5', () => {
    const species = speciesOf('mossling');
    expect(defaultLoadoutMoveIds(species, 2)).toEqual(['moss-pat', 'root-bind', 'root-bind']);
    expect(defaultLoadoutMoveIds(species, 5)).toEqual(['moss-pat', 'root-bind', 'terraform-apply']);
  });
});
