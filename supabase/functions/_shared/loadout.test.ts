// deno test --allow-read _shared/loadout.test.ts   (run `pnpm sync:shared` first)
import { assertEquals } from 'jsr:@std/assert@1';
import { simulateBattle, snapshotFor } from './game/battle/battle.ts';
import { normalizedLoadout } from './loadout.ts';

// A stored v13 tree: nation-tree ids from the old roster, a node whose prerequisite is gone and a
// legacy multi-rank purchase.
const V13 = { 'water:current:1': 1, 'fire:flow:2': 1, 'strike:3': 1, 'strike:1': 2 };

Deno.test('normalizedLoadout drops v13 ids and orphaned nodes, keeps stance and moves', () => {
  const loadout = { stance: 'fury' as const, moves: ['a', 'b', 'c'], tree: V13 };
  assertEquals(normalizedLoadout('water', loadout), {
    stance: 'fury',
    moves: ['a', 'b', 'c'],
    tree: { 'strike:1': 1 },
  });
});

Deno.test('normalizedLoadout leaves a missing tree missing (bots still get defaultBotTree)', () => {
  assertEquals(normalizedLoadout('water', null), undefined);
  assertEquals(normalizedLoadout('water', { stance: null }), { stance: null });
});

Deno.test('a stored v13 opponent fights with its normalized tree', () => {
  const opp = (tree: Record<string, number>) =>
    snapshotFor({
      monId: 'm2',
      playerId: 'p2',
      nickname: 'foe',
      speciesId: 'sparkit',
      stage: 'teen',
      level: 12,
      loadout: normalizedLoadout('fire', { tree }),
    });
  const me = snapshotFor({
    monId: 'm1',
    playerId: 'p1',
    nickname: 'me',
    speciesId: 'bubblit',
    stage: 'teen',
    level: 12,
    loadout: normalizedLoadout('water', { tree: V13 }),
  });
  assertEquals(me.loadout?.tree, { 'strike:1': 1 });
  assertEquals(
    simulateBattle(me, opp(V13), 'seed-1'),
    simulateBattle(me, opp({ 'strike:1': 1 }), 'seed-1'),
  );
});
