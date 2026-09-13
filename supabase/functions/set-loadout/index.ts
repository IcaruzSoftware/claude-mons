// POST { stance?, moves?, tree?, respec? } -> SetLoadoutResponse (docs/design/progression.md
// "Data model and API", docs/design/talent-tree.md). Validates and stores `stance`, `moves` (3
// distinct, unlocked move ids) and `tree` (`{ [nodeId]: rank }`) via the shared pure
// validateLoadout, which also enforces the respec cooldown against this mon's own stored
// `tree`/`last_respec_at`; `last_respec_at` is stamped here (not inside validateLoadout, which is
// pure) whenever a genuine respec happened at or above the free-respec level.
import type { SetLoadoutRequest, SetLoadoutResponse } from '../_shared/game/api.ts';
import { RESPEC_FREE_BELOW_LEVEL, validateLoadout } from '../_shared/game/game/progression.ts';
import { requireUser } from '../_shared/auth.ts';
import { serviceClient, type MonRow } from '../_shared/db.ts';
import { error, json, readJson, serve } from '../_shared/http.ts';
import { loadPlayer, monStateFor } from '../_shared/queries.ts';

serve(async (req) => {
  if (req.method !== 'POST') return error('BAD_REQUEST', 'POST only', 405);
  const { uid } = await requireUser(req);
  const body = await readJson<SetLoadoutRequest>(req, 4096);
  const db = serviceClient();
  const now = new Date();

  const player = await loadPlayer(db, uid);
  if (!player) return error('NO_PROFILE', 'create a profile first', 409);

  const { data: monData, error: monError } = await db
    .from('mons')
    .select('*')
    .eq('player_id', uid)
    .maybeSingle();
  if (monError) throw new Error(`mons: ${monError.message}`);
  const mon = monData as MonRow | null;
  if (!mon) return error('NO_PROFILE', 'create a profile first', 409);

  const existingTree = (mon.loadout as { tree?: Record<string, number> } | null)?.tree;
  const result = validateLoadout(body, {
    level: mon.level,
    nation: player.nation,
    speciesId: mon.species_id,
    existingTree,
    lastRespecAt: mon.last_respec_at,
    now,
  });
  if (!result.ok) {
    return error('BAD_REQUEST', result.reason, 400, { code: result.code, ...result.details });
  }

  const nextLoadout = { ...(mon.loadout ?? {}), ...result.loadout };
  const stampRespec = result.isRespec && mon.level >= RESPEC_FREE_BELOW_LEVEL;
  const { data: updated, error: updateError } = await db
    .from('mons')
    .update({ loadout: nextLoadout, ...(stampRespec ? { last_respec_at: now.toISOString() } : {}) })
    .eq('player_id', uid)
    .select('*')
    .single();
  if (updateError) throw new Error(`mons update: ${updateError.message}`);

  const response: SetLoadoutResponse = {
    loadout: nextLoadout,
    mon: await monStateFor(db, updated as MonRow, player.streak_days, now),
  };
  return json(response, 200);
});
