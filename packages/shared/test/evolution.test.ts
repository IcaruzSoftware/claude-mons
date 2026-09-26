import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { snapshotFor, simulateBattle } from '../src/battle/battle.ts';
import { stageForLevel, statAtLevel } from '../src/game/levels.ts';
import { SPECIES, defaultLoadoutMoveIds, unlockedMoves } from '../src/game/species.ts';

it('unlocks stronger signatures and boosted stats at each evolution, retaining old loadouts', () => {
  for (const species of Object.values(SPECIES)) {
    expect(new Set(species.movePool.map((m) => m.id)).size).toBe(8);
    for (const [index, level] of [
      [6, 10],
      [7, 25],
    ] as const) {
      const special = species.movePool[index];
      expect(unlockedMoves(species, level - 1)).not.toContain(special);
      expect(unlockedMoves(species, level)).toContain(special);
      expect(special.power).toBeGreaterThan(
        Math.max(...species.movePool.slice(0, index).map((m) => m.power)),
      );
      expect(defaultLoadoutMoveIds(species, level)[2]).toBe(special.id);
      for (const base of Object.values(species.baseStats)) {
        expect(statAtLevel(base, level)).toBeGreaterThanOrEqual(
          Math.floor((base * (level + 49)) / 50),
        );
      }
      const bases = Object.values(species.baseStats);
      expect(bases.reduce((sum, base) => sum + statAtLevel(base, level), 0)).toBeGreaterThan(
        bases.reduce((sum, base) => sum + Math.floor((base * (level + 49)) / 50), 0),
      );
      const saved = defaultLoadoutMoveIds(species, 5);
      expect(
        snapshotFor({
          monId: 'a',
          playerId: 'a',
          nickname: 'a',
          speciesId: species.id,
          stage: level === 10 ? 'teen' : 'adult',
          level,
          loadout: { moves: saved },
        }).loadout?.moves,
      ).toEqual(saved);
    }
  }
  expect(SPECIES.ottlet!.rarity).toBe('rare');
});

it('every rare species has a measured advantage against the cross-nation common pool', () => {
  for (const level of [2, 5, 10, 30, 50]) {
    for (const rare of Object.values(SPECIES).filter((s) => s.rarity === 'rare')) {
      let wins = 0;
      let total = 0;
      for (const common of Object.values(SPECIES).filter(
        (s) => s.rarity === 'common' && s.nation !== rare.nation,
      )) {
        const make = (speciesId: string, id: string) =>
          snapshotFor({
            monId: id,
            playerId: id,
            nickname: id,
            speciesId,
            level,
            stage: stageForLevel(level) as 'baby' | 'teen' | 'adult',
          });
        const a = make(rare.id, 'a');
        const b = make(common.id, 'b');
        for (let i = 0; i < 1000; i++) {
          wins += Number(
            simulateBattle(a, b, `rarity-${level}-${rare.id}-${common.id}-${i}`).winner === 'a',
          );
          total++;
        }
      }
      expect(wins / total, `${rare.id} L${level}`).toBeGreaterThan(0.52);
      expect(wins / total, `${rare.id} L${level}`).toBeLessThan(0.75);
    }
  }
});

it('keeps migrated base stats identical to client and Edge Function species stats', () => {
  const sql = readFileSync(
    new URL('../../../supabase/migrations/20260926070000_rarity_stats.sql', import.meta.url),
    'utf8',
  );
  const rows = [...sql.matchAll(/\('([a-z]+)', (\d+), (\d+), (\d+), (\d+)\)/g)];
  expect(rows).toHaveLength(7);
  for (const row of rows) {
    expect(Object.values(SPECIES[row[1]!]!.baseStats)).toEqual(row.slice(2).map(Number));
  }
});
