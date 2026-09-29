import { expect, it } from 'vitest';
import { simulateBattle, snapshotFor } from '../src/battle/battle.ts';
import { validateTree } from '../src/game/tree.ts';

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
