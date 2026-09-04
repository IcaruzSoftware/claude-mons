import { describe, expect, it } from 'vitest';
import { simulateBattle, snapshotFor } from '../src/battle/battle.ts';
import { SPECIES } from '../src/game/species.ts';

/**
 * Balance harness: cross-nation round-robin at level 10 (only pairings matchmaking can produce).
 * Every species must land between 35 % and 65 % win rate, battles must stay short, and timeouts
 * rare. Rebalance base stats in species.ts if this fails; do not loosen the thresholds first.
 */
describe('balance (cross-nation round-robin, L10)', () => {
  const ids = Object.keys(SPECIES);
  const BATTLES_PER_PAIR = 150;

  it('keeps every species within 35-65 % and battles short', () => {
    const wins: Record<string, number> = {};
    const games: Record<string, number> = {};
    let turns = 0;
    let timeouts = 0;
    let total = 0;
    for (const idA of ids) {
      for (const idB of ids) {
        if (idA === idB || SPECIES[idA]!.nation === SPECIES[idB]!.nation) continue;
        const a = snapshotFor({
          monId: 'a',
          playerId: 'a',
          nickname: 'a',
          speciesId: idA,
          stage: 'teen',
          level: 10,
        });
        const b = snapshotFor({
          monId: 'b',
          playerId: 'b',
          nickname: 'b',
          speciesId: idB,
          stage: 'teen',
          level: 10,
        });
        for (let i = 0; i < BATTLES_PER_PAIR; i++) {
          const r = simulateBattle(a, b, `${idA}-${idB}-${i}`);
          total++;
          turns += r.turns.length;
          if (r.reason !== 'ko') timeouts++;
          const winner = r.winner === 'a' ? idA : idB;
          wins[winner] = (wins[winner] ?? 0) + 1;
          games[idA] = (games[idA] ?? 0) + 1;
          games[idB] = (games[idB] ?? 0) + 1;
        }
      }
    }
    const report: string[] = [];
    for (const id of ids) {
      const rate = (wins[id] ?? 0) / (games[id] ?? 1);
      report.push(`${id.padEnd(10)} ${(rate * 100).toFixed(1)}%`);
      expect(
        rate,
        `${id} win rate ${(rate * 100).toFixed(1)}%\n${report.join('\n')}`,
      ).toBeGreaterThanOrEqual(0.35);
      expect(
        rate,
        `${id} win rate ${(rate * 100).toFixed(1)}%\n${report.join('\n')}`,
      ).toBeLessThanOrEqual(0.65);
    }
    const meanTurns = turns / total;
    expect(meanTurns).toBeGreaterThanOrEqual(3);
    expect(meanTurns).toBeLessThanOrEqual(8);
    expect(timeouts / total).toBeLessThan(0.02);
  });

  it('a 3-level advantage wins roughly 70-80 % of the time', () => {
    let wins = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      const a = snapshotFor({
        monId: 'a',
        playerId: 'a',
        nickname: 'a',
        speciesId: 'sparkit',
        stage: 'teen',
        level: 13,
      });
      const b = snapshotFor({
        monId: 'b',
        playerId: 'b',
        nickname: 'b',
        speciesId: 'pebblet',
        stage: 'teen',
        level: 10,
      });
      if (simulateBattle(a, b, `lvl-${i}`).winner === 'a') wins++;
    }
    expect(wins / N).toBeGreaterThan(0.6);
    expect(wins / N).toBeLessThan(0.9);
  });
});
