import { normalizeTree, validateLoadout, type SetLoadoutResponse } from '@claude-mons/shared';
import type { LoadoutSaveResult, SetLoadoutPayload } from '../../common/ipc.ts';
import { ApiCallError } from '../net/SupabaseClient.ts';
import { loadoutNation, type LocalState } from '../persistence/state.ts';
import type { StateAccess } from './GameService.ts';

/**
 * Saved-tree normalization on profile load (docs/design/talent-tree.md): a stored protocol-13 tree
 * is rebuilt for the current roster and the next automatic save writes it. `treeLegacyReset` stays
 * set until the player saves a tree again, so the Talents editor can show its one-line notice.
 */
export function normalizeLocalTree(s: LocalState): void {
  if (!s.loadout.tree) return;
  const { tree, legacyReset } = normalizeTree(loadoutNation(s), s.loadout.tree);
  s.loadout.tree = tree;
  if (legacyReset) s.loadout.treeLegacyReset = true;
}

export interface SaveLoadoutDeps {
  state: StateAccess;
  /** the local (provisional) level the editor shows */
  level: () => number;
  /** `set-loadout`, or null in an offline build */
  invoke: ((payload: SetLoadoutPayload) => Promise<SetLoadoutResponse>) | null;
  /** syncs pending XP first, so the server validates against the level the player sees */
  flush?: () => Promise<void>;
  onChange: () => void;
}

/** `LoadoutSaveResult.warning` when the save left this device but the server did not answer. */
export const LOADOUT_UNCONFIRMED = 'Saved on this device. The server has not confirmed it yet.';

/**
 * Validates and stores a loadout change locally, then on the server. A definite server rejection
 * (a 4xx such as TREE_OVER_BUDGET or MOVE_LOCKED while the server level still lags) restores the
 * previous local loadout; after a network error or a 5xx the server may have stored the change,
 * so it is kept and the result is `ok` with `unconfirmed` and a `warning`. On success the server's (normalized) loadout is adopted. Call through
 * `createLoadoutSaver`, which runs saves one at a time.
 */
export async function saveLoadout(
  deps: SaveLoadoutDeps,
  payload: SetLoadoutPayload,
): Promise<LoadoutSaveResult> {
  const s = deps.state.get();
  const result = validateLoadout(payload, {
    level: deps.level(),
    nation: loadoutNation(s),
    speciesId: s.pet.speciesId,
    ...(s.loadout.tree ? { existingTree: s.loadout.tree } : {}),
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const before = structuredClone(s.loadout);
  deps.state.update((st) => {
    if (result.loadout.stance !== undefined) st.loadout.stance = result.loadout.stance;
    if (result.loadout.moves !== undefined) st.loadout.moves = result.loadout.moves;
    if (result.loadout.tree !== undefined) st.loadout.tree = result.loadout.tree;
  });
  deps.onChange();
  // An adopted profile (sign-in) replaces the loadout object; never write over it from here.
  const mine = deps.state.get().loadout;
  const current = () => deps.state.get().loadout === mine;
  let unconfirmed = false;
  if (deps.invoke) {
    try {
      await deps.flush?.();
      const res = await deps.invoke(payload);
      if (current())
        deps.state.update((st) => {
          const server = res.mon.loadout;
          if (server.stance !== undefined) st.loadout.stance = server.stance;
          if (server.moves) st.loadout.moves = server.moves;
          else delete st.loadout.moves;
          if (server.tree) st.loadout.tree = server.tree;
          else delete st.loadout.tree;
          st.loadout.lastRespecAt = res.mon.lastRespecAt;
        });
    } catch (err) {
      if (err instanceof ApiCallError && err.status >= 400 && err.status < 500) {
        if (current()) deps.state.update((st) => (st.loadout = before));
        deps.onChange();
        return { ok: false, error: `${err.code}: ${err.message}` };
      }
      unconfirmed = true;
    }
  }
  if (result.loadout.tree !== undefined && current())
    deps.state.update((st) => delete st.loadout.treeLegacyReset);
  deps.onChange();
  if (unconfirmed)
    return { ok: true, error: null, unconfirmed: true, warning: LOADOUT_UNCONFIRMED };
  const { stance, moves, tree } = deps.state.get().loadout;
  return {
    ok: true,
    error: null,
    loadout: {
      ...(stance !== undefined ? { stance } : {}),
      ...(moves ? { moves } : {}),
      ...(tree ? { tree } : {}),
    },
  };
}

/** `saveLoadout`, one call at a time, so a late rollback never overwrites a newer save. */
export function createLoadoutSaver(
  deps: SaveLoadoutDeps,
): (payload: SetLoadoutPayload) => Promise<LoadoutSaveResult> {
  let queue: Promise<unknown> = Promise.resolve();
  return (payload) => {
    const run = queue.then(() => saveLoadout(deps, payload));
    queue = run.catch(() => {});
    return run;
  };
}
