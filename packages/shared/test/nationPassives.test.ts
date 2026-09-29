import { describe, expect, it } from 'vitest';
import { simulateBattle, snapshotFor } from '../src/battle/battle.ts';
import {
  AIR_SPEED_MULT,
  EARTH_DAMAGE_MULT,
  FIRE_IGNITE_CHANCE,
  WATER_SOAK_CHANCE,
} from '../src/battle/effects.ts';

const mon = (id: string, side: string) =>
  snapshotFor({
    monId: side,
    playerId: side,
    nickname: side,
    speciesId: id,
    stage: 'teen',
    level: 15,
  });

describe('automatic nation traits', () => {
  it('gives air an advantage in turn order without guaranteeing it', () => {
    expect(AIR_SPEED_MULT).toBeGreaterThan(1);
    const air = mon('puffle', 'a');
    const earth = mon('pebblet', 'b');
    let first = 0;
    for (let i = 0; i < 500; i++) {
      if (simulateBattle(air, earth, `wind-order-${i}`).turns[0]!.first === 'a') first++;
    }
    expect(first / 500).toBeGreaterThan(0.5);
    expect(first / 500).toBeLessThan(0.9);
  });

  it('reduces direct hits against earth by a small bounded amount', () => {
    expect(EARTH_DAMAGE_MULT).toBeGreaterThanOrEqual(0.95);
    const attacker = mon('sparkit', 'a');
    const target = mon('pebblet', 'b');
    const earth = simulateBattle(attacker, target, 'earth-guard').turns[0]!.actions[0]!;
    const neutral = simulateBattle(attacker, { ...target, nation: 'air' }, 'earth-guard').turns[0]!
      .actions[0]!;
    // The opening Spark Nip is neutral, so only the passive changes its direct damage.
    expect(earth.dodged).toBe(false);
    expect(earth.damage).toBeLessThanOrEqual(neutral.damage);
  });

  it('occasionally ignites and soaks on landed elemental hits, never on neutral hits', () => {
    expect(FIRE_IGNITE_CHANCE).toBeLessThan(0.2);
    expect(WATER_SOAK_CHANCE).toBeLessThan(0.35);
    let ignites = 0;
    let soaks = 0;
    for (let i = 0; i < 400; i++) {
      const fire = simulateBattle(mon('sparkit', 'a'), mon('pebblet', 'b'), `ignite-${i}`);
      const water = simulateBattle(mon('ottlet', 'a'), mon('puffle', 'b'), `soak-${i}`);
      for (const action of fire.turns.flatMap((turn) => turn.actions)) {
        if (action.nationPassive === 'ignite') ignites++;
        if (action.moveId === 'spark-nip') expect(action.nationPassive).toBeUndefined();
      }
      for (const action of water.turns.flatMap((turn) => turn.actions)) {
        if (action.nationPassive === 'soak') soaks++;
        if (action.moveId === 'splash-dash') expect(action.nationPassive).toBeUndefined();
      }
    }
    expect(ignites).toBeGreaterThan(10);
    expect(ignites).toBeLessThan(200);
    expect(soaks).toBeGreaterThan(10);
    expect(soaks).toBeLessThan(250);
  });
});
