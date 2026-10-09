// POST { stance?, moves?, tree?, respec? } -> SetLoadoutResponse (docs/design/progression.md
// "Data model and API", docs/design/talent-tree.md). Validates and stores `stance`, `moves` (3
// distinct, unlocked move ids) and `tree` (`{ [nodeId]: rank }`) via the shared pure
// validateLoadout. Respecs are free and can be saved immediately.
import type { SetLoadoutRequest, SetLoadoutResponse } from '../_shared/game/api.ts';
import { validateLoadout, type MonLoadout } from '../_shared/game/game/progression.ts';
import { requireUser } from '../_shared/auth.ts';
import { serviceClient, type MonRow } from '../_shared/db.ts';
import { error, json, readJson, serve } from '../_shared/http.ts';
import { normalizedLoadout } from '../_shared/loadout.ts';
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

  // A stored protocol-13 tree is normalized first, so it is never validated against or written back.
  const stored = normalizedLoadout(player.nation, mon.loadout as MonLoadout | null);
  const existingTree = stored?.tree;
  const result = validateLoadout(body, {
    level: mon.level,
    nation: player.nation,
    speciesId: mon.species_id,
    existingTree,
  });
  if (!result.ok) {
    return error('BAD_REQUEST', result.reason, 400, { code: result.code, ...result.details });
  }

  const nextLoadout = { ...stored, ...result.loadout };
  const { data: updated, error: updateError } = await db
    .from('mons')
    .update({ loadout: nextLoadout })
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
