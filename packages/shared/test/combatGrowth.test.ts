import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { armorReduction, simulateBattle, snapshotFor } from '../src/battle/battle.ts';
import { MAX_LEVEL, statAtLevel } from '../src/game/levels.ts';
import { SPECIES } from '../src/game/species.ts';

it('gives every species at least one point in every stat on every level, including evolutions', () => {
  for (const species of Object.values(SPECIES)) {
    for (const base of Object.values(species.baseStats)) {
      for (let level = 2; level <= MAX_LEVEL; level++) {
        expect(statAtLevel(base, level) - statAtLevel(base, level - 1)).toBeGreaterThanOrEqual(1);
      }
      expect(statAtLevel(base, MAX_LEVEL + 1)).toBe(statAtLevel(base, MAX_LEVEL));
    }
  }
});

it('uses armor / (armor + K), with diminishing returns and no complete immunity', () => {
  for (const level of [2, 10, 25, 50]) {
    const k = level + 24;
    expect(armorReduction(0, level)).toBe(0);
    expect(armorReduction(k, level)).toBe(0.5);
    expect(armorReduction(2 * k, level)).toBeCloseTo(2 / 3);
    expect(armorReduction(3 * k, level)).toBe(0.75);
    expect(armorReduction(1_000_000, level)).toBeLessThan(1);
  }
});

it('keeps the SQL growth expressions aligned and rounds exact stat boundaries consistently', () => {
  const sql = readFileSync(
    new URL('../../../supabase/migrations/20260927120000_level_stat_growth.sql', import.meta.url),
    'utf8',
  );
  for (const stat of ['hp', 'atk', 'def', 'spd']) {
    expect(sql).toContain(
      `floor((v_base.${stat}::numeric * 25 + (v_level - 1) * greatest(25, v_base.${stat})) * v_stage_mult / 25)`,
    );
  }
  for (const species of Object.values(SPECIES)) {
    for (const base of Object.values(species.baseStats)) {
      for (let level = 2; level <= MAX_LEVEL; level++) {
        const numerator = BigInt(base * 25 + (level - 1) * Math.max(25, base));
        const stagePercent = BigInt(level >= 25 ? 106 : level >= 10 ? 103 : 100);
        expect(statAtLevel(base, level)).toBe(Number((numerator * stagePercent) / 2500n));
      }
    }
  }
});

it('keeps misses, crits and non-chaining double strikes occasional and deterministic', () => {
  const mon = (id: string) =>
    snapshotFor({
      monId: id,
      playerId: id,
      nickname: id,
      speciesId: 'ottlet',
      level: 20,
      stage: 'teen',
      loadout: { moves: ['splash-dash', 'splash-dash', 'splash-dash'] },
    });
  const a = mon('a');
  const b = mon('b');
  let doubles = 0;
  let eligible = 0;
  let primary = 0;
  let misses = 0;
  let crits = 0;
  for (let seed = 0; seed < 2000; seed++) {
    const result = simulateBattle(a, b, `events-${seed}`);
    if (seed < 10) expect(result).toEqual(simulateBattle(a, b, `events-${seed}`));
    for (const turn of result.turns) {
      for (const side of ['a', 'b']) {
        const actions = turn.actions.filter((action) => action.actor === side);
        expect(actions.length).toBeLessThanOrEqual(2);
        for (const [index, action] of actions.entries()) {
          if (action.doubleStrike) {
            doubles++;
            expect(index).toBe(1);
            expect(action.crit).toBe(false);
            expect(action.effect).toBeNull();
            expect(action.followThrough).toBeUndefined();
            expect(action.charge).toBeUndefined();
            expect(actions[0]!.dodged).toBe(false);
            expect(actions[0]!.targetHpAfter).toBeGreaterThan(0);
            expect(action.damage).toBeLessThanOrEqual(Math.ceil(actions[0]!.damage * 0.65));
          } else {
            primary++;
            misses += Number(action.dodged);
            crits += Number(action.crit);
            eligible += Number(!action.dodged && action.targetHpAfter > 0);
          }
        }
      }
    }
  }
  expect(doubles / eligible).toBeGreaterThan(0.06);
  expect(doubles / eligible).toBeLessThan(0.1);
  expect(misses / primary).toBeGreaterThan(0.02);
  expect(misses / primary).toBeLessThan(0.06);
  expect(crits / primary).toBeGreaterThan(0.05);
  expect(crits / primary).toBeLessThan(0.11);
});
