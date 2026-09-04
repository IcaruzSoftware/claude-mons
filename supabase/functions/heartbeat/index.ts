// Keepalive + housekeeping. Called daily by .github/workflows/keepalive.yml.
// Phase 0: placeholder that proves `deno check` runs against the shared package.
// Phase 4 adds the database touch and pruning of ephemeral tables.
import { HATCH_XP } from '../_shared/game/index.ts';

Deno.serve(() => {
  return new Response(
    JSON.stringify({ ok: true, hatchXp: HATCH_XP, ts: new Date().toISOString() }),
    {
      headers: { 'content-type': 'application/json' },
    },
  );
});
