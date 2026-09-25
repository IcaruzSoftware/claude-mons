import { describe, expect, it } from 'vitest';
import { challengerReward, simulateBattle, snapshotFor } from '../src/battle/battle.ts';
import { MATCHMAKING_WINDOWS, wildEncounterLevel } from '../src/battle/matchmaking.ts';
import { effectiveness } from '../src/game/nations.ts';

import { SPECIES } from '../src/game/species.ts';

describe('passive fair battles', () => {
  it('makes prepared ordering useful against +3 opponents without guaranteeing a win', () => {
    let prepared = 0;
    let reversed = 0;
    let total = 0;
    for (const species of Object.values(SPECIES)) {
      const setup = species.movePool.find((m) => m.effect === 'def_down' || m.effect === 'burn')!;
      const hit = species.movePool.find((m) => m.effect === 'priority')!;
      const third = species.movePool.find((m) => m.id !== setup.id && m.id !== hit.id)!;
      for (const foe of Object.values(SPECIES)) {
        if (foe.nation === species.nation) continue;
        const a = snapshotFor({
          monId: 'a',
          playerId: 'a',
          nickname: 'a',
          speciesId: species.id,
          level: 10,
          stage: 'teen',
          loadout: { moves: [setup.id, hit.id, third.id] },
        });
        const b = snapshotFor({
          monId: 'b',
          playerId: 'b',
          nickname: 'b',
          speciesId: foe.id,
          level: 13,
          stage: 'teen',
        });
        const reverse = { ...a, loadout: { ...a.loadout, moves: [hit.id, setup.id, third.id] } };
        for (let i = 0; i < 100; i++) {
          const seed = `prep-${species.id}-${foe.id}-${i}`;
          prepared += Number(simulateBattle(a, b, seed).winner === 'a');
          reversed += Number(simulateBattle(reverse, b, seed).winner === 'a');
          total++;
        }
      }
    }
    expect(prepared / total).toBeGreaterThan(reversed / total + 0.01);
    expect(prepared / total).toBeGreaterThan(0.3);
    expect(prepared / total).toBeLessThan(0.6);
  });

  it('searches weaker players first and never extends beyond three levels either way', () => {
    expect(MATCHMAKING_WINDOWS).toEqual([
      { min: -3, max: -1 },
      { min: 0, max: 0 },
      { min: 1, max: 3 },
    ]);
    for (const level of [2, 3, 10, 30, 49, 50]) {
      let weaker = 0;
      let elite = 0;
      for (let i = 0; i < 1000; i++) {
        const encounter = wildEncounterLevel(level, i / 1000);
        expect(Math.abs(encounter.level - level)).toBeLessThanOrEqual(3);
        expect(encounter.level).toBeGreaterThanOrEqual(2);
        expect(encounter.level).toBeLessThanOrEqual(50);
        if (encounter.level < level) weaker++;
        if (encounter.isElite) elite++;
      }
      expect(elite).toBe(100);
      if (level >= 10) expect(weaker).toBe(900);
    }
  });

  it('pays +15 XP per harder level only on wins and the same 10 XP on every loss', () => {
    for (const isBot of [false, true]) {
      for (let diff = -10; diff <= 10; diff++) {
        const input = { isBot, myLevel: 20, oppLevel: 20 + diff };
        expect(challengerReward({ ...input, won: false })).toBe(10);
        const bounded = Math.max(-3, Math.min(3, diff));
        const expected = isBot
          ? 20 + 15 * Math.max(0, bounded)
          : 30 + (bounded > 0 ? 15 : 5) * bounded;
        expect(challengerReward({ ...input, won: true })).toBe(expected);
      }
    }
  });

  it('limits the type damage swing to 1.2 / 0.9, including neutral matchups', () => {
    expect(effectiveness('water', 'fire')).toBe(1.2);
    expect(effectiveness('fire', 'water')).toBe(0.9);
    expect(effectiveness('water', 'air')).toBe(1);
  });

  it('automatically rewards an opening setup at most once, only on a landed offensive follow-up', () => {
    let combos = 0;
    for (const species of Object.values(SPECIES)) {
      const setup = species.movePool.find((m) => m.effect === 'def_down' || m.effect === 'burn')!;
      const follow = species.movePool.find((m) => m.effect === 'priority')!;
      const third = species.movePool.find((m) => m.id !== setup.id && m.id !== follow.id)!;
      for (let i = 0; i < 100; i++) {
        const a = snapshotFor({
          monId: 'a',
          playerId: 'a',
          nickname: 'a',
          speciesId: species.id,
          level: 10,
          stage: 'teen',
          loadout: { stance: 'bulwark', moves: [setup.id, follow.id, third.id] },
        });
        const b = snapshotFor({
          monId: 'b',
          playerId: 'b',
          nickname: 'b',
          speciesId: 'pebblet',
          level: 13,
          stage: 'teen',
        });
        const log = simulateBattle(a, b, `combo-${species.id}-${i}`);
        const actions = log.turns.flatMap((t) => t.actions).filter((x) => x.actor === 'a');
        const hits = actions.filter((x) => x.followThrough);
        expect(hits.length).toBeLessThanOrEqual(1);
        for (const hit of hits) {
          expect(actions[0]!.dodged).toBe(false);
          expect(hit.dodged).toBe(false);
          expect(hit.damage).toBeGreaterThan(0);
          expect(hit.moveId).not.toBe(setup.id);
          expect(['priority', 'true_hit', 'crit_up', 'charge']).toContain(hit.effect);
          expect(hit.charge).not.toBe('telegraph');
          combos++;
        }
      }
    }
    expect(combos).toBeGreaterThan(500);
  });
});
