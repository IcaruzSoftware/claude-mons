// Saved-tree normalization on every server read path (docs/design/talent-tree.md): a stored
// `mons.loadout.tree` may still hold protocol-13 ids, so it is normalized before it is validated
// against, written back, returned to a client or handed to `simulateBattle`.
import type { MonLoadout } from './game/game/progression.ts';
import { normalizeTree } from './game/game/tree.ts';
import type { Nation } from './game/types.ts';

/** `loadout` with its tree normalized for `nation`; a missing tree stays missing. */
export function normalizedLoadout(
  nation: Nation,
  loadout: MonLoadout | null | undefined,
): MonLoadout | undefined {
  if (!loadout) return undefined;
  return loadout.tree ? { ...loadout, tree: normalizeTree(nation, loadout.tree).tree } : loadout;
}
