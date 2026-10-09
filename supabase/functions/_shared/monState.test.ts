// deno test --allow-read _shared/monState.test.ts   (run `pnpm sync:shared` first)
import { assertEquals } from 'jsr:@std/assert@1';
import type { MonRow } from './db.ts';
import { buildMonState } from './monState.ts';

const mon = (loadout: Record<string, unknown>) =>
  ({
    id: 'm1',
    player_id: 'p1',
    species_id: 'bubblit',
    stage: 'teen',
    level: 12,
    total_xp: 6600,
    loadout,
    win_streak: 0,
    last_respec_at: null,
    last_battle_at: null,
  }) as unknown as MonRow;

Deno.test('buildMonState returns the normalized tree and flags a legacy reset', () => {
  const state = buildMonState(
    mon({ stance: 'fury', tree: { 'water:current:1': 1, 'strike:1': 1 } }),
    null,
    0,
  );
  assertEquals(state.loadout, { stance: 'fury', tree: { 'strike:1': 1 } });
  assertEquals(state.treeLegacyReset, true);
});

Deno.test('buildMonState does not flag a tree that was already valid', () => {
  const state = buildMonState(mon({ tree: { 'strike:1': 1 } }), null, 0);
  assertEquals(state.loadout, { tree: { 'strike:1': 1 } });
  assertEquals(state.treeLegacyReset, undefined);
});
