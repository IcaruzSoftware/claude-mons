import { expect, it } from 'vitest';
import { simulateBattle, snapshotFor } from '../src/battle/battle.ts';
import { resolveTree, validateTree } from '../src/game/tree.ts';
import { speciesOf } from '../src/game/species.ts';

it('uses an ordered Flow loadout to trigger visible once-per-battle combo talents', () => {
  const tree = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`water:flow:${i + 1}`, 1]));
  expect(validateTree('water', 30, tree)).toEqual({ ok: true });
  const me = snapshotFor({
    monId: 'otter',
    playerId: 'otter',
    nickname: 'Ottlet',
    speciesId: 'ottlet',
    stage: 'adult',
    level: 30,
    loadout: { tree, moves: ['splash-dash', 'river-rush', 'whisker-sense'] },
  });
  const foe = snapshotFor({
    monId: 'foe',
    playerId: 'foe',
    nickname: 'Puffle',
    speciesId: 'puffle',
    stage: 'adult',
    level: 30,
  });
  let quick = 0;
  let varied = 0;
  for (let i = 0; i < 250; i++) {
    const battle = simulateBattle(me, foe, `flow-combo-${i}`);
    const actions = battle.turns.flatMap((turn) => turn.actions);
    const landed = actions.filter(
      (action) =>
        action.actor === 'a' &&
        action.moveId &&
        !action.dodged &&
        !action.doubleStrike &&
        action.charge !== 'telegraph',
    );
    for (let j = 0; j < landed.length; j++) {
      if (landed[j]!.comboTalent?.includes('Rhythm')) {
        expect(new Set(landed.slice(j - 2, j + 1).map((action) => action.moveId)).size).toBe(3);
      }
    }
    const setups = actions.filter((action) => action.comboTalent?.includes('Quick Setup'));
    quick += setups.length;
    expect(setups.every((action) => !action.dodged)).toBe(true);
    expect(setups.length).toBeLessThanOrEqual(1);
    varied += Number(
      actions.some(
        (action) =>
          action.comboTalent?.includes('Rhythm') || action.comboTalent?.includes('Expose Weakness'),
      ),
    );
  }
  expect(quick).toBeGreaterThan(30);
  expect(varied).toBeGreaterThan(5);
});

it('requires a learned Flow skill for the setup combo', () => {
  const foe = snapshotFor({
    monId: 'foe',
    playerId: 'foe',
    nickname: 'Foe',
    speciesId: 'pebblet',
    stage: 'teen',
    level: 13,
  });
  const input = {
    monId: 'me',
    playerId: 'me',
    nickname: 'Me',
    speciesId: 'sparkit',
    stage: 'teen' as const,
    level: 10,
  };
  const pool = speciesOf('sparkit').movePool;
  const setup = pool.find((move) => move.effect === 'def_down')!;
  const follow = pool.find((move) => move.effect === 'priority')!;
  const third = pool.find((move) => move.id !== setup.id && move.id !== follow.id)!;
  const moves = [setup.id, follow.id, third.id] as [string, string, string];
  const plain = snapshotFor({ ...input, loadout: { moves, tree: {} } });
  const learned = snapshotFor({ ...input, loadout: { moves, tree: { 'fire:flow:1': 1 } } });
  let learnedCombos = 0;
  for (let i = 0; i < 100; i++) {
    const actions = simulateBattle(plain, foe, `learned-combo-${i}`).turns.flatMap(
      (turn) => turn.actions,
    );
    expect(actions.some((action) => action.followThrough)).toBe(false);
    learnedCombos += simulateBattle(learned, foe, `learned-combo-${i}`)
      .turns.flatMap((turn) => turn.actions)
      .filter((action) => action.followThrough).length;
  }
  expect(learnedCombos).toBeGreaterThan(0);
});

it('keeps deep effects from different paths as separate investments', () => {
  const tree = resolveTree('water', { 'water:current:8': 1, 'water:reservoir:8': 1 });
  expect(tree.passives.has('mastery-8-current')).toBe(true);
  expect(tree.passives.has('mastery-8-reservoir')).toBe(true);
});

it('records learned recovery as a visible heal at most once per battle', () => {
  const tree = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`water:reservoir:${i + 1}`, 1]),
  );
  const me = snapshotFor({
    monId: 'me',
    playerId: 'me',
    nickname: 'Me',
    speciesId: 'ottlet',
    stage: 'adult',
    level: 50,
    loadout: { tree },
  });
  const foe = snapshotFor({
    monId: 'foe',
    playerId: 'foe',
    nickname: 'Foe',
    speciesId: 'ottlet',
    stage: 'adult',
    level: 50,
  });
  let recovered = 0;
  for (let i = 0; i < 50; i++) {
    const heals = simulateBattle(me, foe, `recovery-${i}`)
      .turns.flatMap((turn) => turn.actions)
      .filter((action) => action.actor === 'a' && action.healing);
    expect(heals.length).toBeLessThanOrEqual(1);
    recovered += heals.reduce((sum, action) => sum + action.healing!, 0);
  }
  expect(recovered).toBeGreaterThan(0);
});
