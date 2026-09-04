// Keepalive + housekeeping. Called daily by .github/workflows/keepalive.yml (no JWT: deployed with
// verify_jwt = false). Touches the database so the free-tier project is not paused and prunes the
// ephemeral tables (xp_minutes, ingest_batches older than 48 h).
import type { HeartbeatResponse } from '../_shared/game/api.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { error, json, serve } from '../_shared/http.ts';

serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return error('BAD_REQUEST', 'GET only', 405);
  }
  const db = serviceClient();
  const { count, error: countError } = await db
    .from('players')
    .select('id', { count: 'exact', head: true });
  if (countError) throw new Error(`players count: ${countError.message}`);
  const pruned = await rpc<number>(db, 'prune_ephemeral', {});
  const body: HeartbeatResponse & { players: number } = {
    ok: true,
    pruned: pruned ?? 0,
    players: count ?? 0,
    ts: new Date().toISOString(),
  };
  return json(body);
});
