import { describe, expect, it } from 'vitest';
import {
  challengerReward,
  npcSnapshot,
  simulateBattle,
  snapshotFor,
} from '../src/battle/battle.ts';
import {
  MATCHMAKING_WINDOWS,
  matchmakingWindowsForRoll,
  wildEncounterLevel,
} from '../src/battle/matchmaking.ts';
import { effectiveness } from '../src/game/nations.ts';

import { stageForLevel } from '../src/game/levels.ts';
import { SPECIES } from '../src/game/species.ts';

describe('passive fair battles', () => {
  it('makes Wild roughly 20% weaker than Trainers and both weaker than Rivals', () => {
    const rival = snapshotFor({
      monId: 'r',
      playerId: 'r',
      nickname: 'r',
      speciesId: 'ottlet',
      level: 20,
      stage: 'teen',
      loadout: { tree: {} },
    });
    const trainer = npcSnapshot(rival, 'trainer');
    const wild = npcSnapshot(rival, 'wild');
    for (const stat of ['hp', 'atk', 'def', 'spd'] as const) {
      expect(trainer.stats[stat]).toBeLessThan(rival.stats[stat]);
      expect(wild.stats[stat]).toBeLessThan(trainer.stats[stat]);
      expect(wild.stats[stat] / trainer.stats[stat]).toBeCloseTo(0.8, 1);
    }
  });
  it('makes prepared ordering useful against +3 opponents without guaranteeing a win', () => {
    let prepared = 0;
    let reversed = 0;
    let total = 0;
    for (const species of Object.values(SPECIES)) {
      const setup = species.movePool.find((m) => m.effect === 'def_down' || m.effect === 'burn')!;
      const hit = species.movePool.find((m) => m.effect === 'priority')!;
      const third = species.movePool
        .filter((m) => m.id !== setup.id && m.id !== hit.id && m.unlocksAt <= 10)
        .sort((a, b) => b.power - a.power)[0]!;
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

  it('varies rivals by level and only rarely offers +4 or +5', () => {
    expect(MATCHMAKING_WINDOWS).toEqual([
      { min: -3, max: -2 },
      { min: -1, max: 0 },
      { min: 1, max: 2 },
      { min: 3, max: 3 },
    ]);
    expect(matchmakingWindowsForRoll(0.5)[0]).toEqual({ min: -1, max: 0 });
    expect(matchmakingWindowsForRoll(0.975)[0]).toEqual({ min: 4, max: 4 });
    expect(matchmakingWindowsForRoll(0.995)[0]).toEqual({ min: 5, max: 5 });
    for (const level of [2, 3, 10, 30, 49, 50]) {
      let weaker = 0;
      let elite = 0;
      for (let i = 0; i < 1000; i++) {
        const encounter = wildEncounterLevel(level, i / 1000);
        expect(Math.abs(encounter.level - level)).toBeLessThanOrEqual(5);
        expect(encounter.level).toBeGreaterThanOrEqual(2);
        expect(encounter.level).toBeLessThanOrEqual(50);
        if (encounter.level < level) weaker++;
        if (encounter.isElite) elite++;
      }
      if (level >= 10 && level <= 45) {
        expect(elite).toBe(60);
        expect(weaker).toBe(550);
      }
    }
  });

  it('makes weaker neutral wild opponents reliable wins throughout the Ottlet line', () => {
    let upsets = 0;
    for (const level of [5, 10, 20, 30, 50]) {
      for (const foe of ['puffle', 'wispit']) {
        for (const gap of [-1, -2, -3]) {
          const a = snapshotFor({
            monId: 'a',
            playerId: 'a',
            nickname: 'a',
            speciesId: 'ottlet',
            level,
            stage: stageForLevel(level) as 'baby' | 'teen' | 'adult',
          });
          const b = snapshotFor({
            monId: 'b',
            playerId: null,
            nickname: 'b',
            speciesId: foe,
            level: level + gap,
            stage: stageForLevel(level + gap) as 'baby' | 'teen' | 'adult',
          });
          let wins = 0;
          for (let i = 0; i < 1000; i++) {
            wins += Number(
              simulateBattle(a, b, `audit-${level}-${gap}-${foe}-${i}`).winner === 'a',
            );
          }
          expect(wins / 1000, `L${level} Ottlet vs ${foe} ${gap}`).toBeGreaterThan(
            gap === -3 ? 0.85 : 0.7,
          );
          upsets += 1000 - wins;
        }
      }
    }
    expect(upsets).toBeGreaterThan(0);
  });

  it('mostly selects clearly weaker wild mons and varies harder encounters', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 3000; i++) {
      const gap = wildEncounterLevel(20, i / 3000).level - 20;
      counts.set(gap, (counts.get(gap) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      0: 600,
      1: 360,
      2: 210,
      3: 120,
      4: 45,
      5: 15,
      '-1': 510,
      '-2': 600,
      '-3': 540,
    });
  });

  it('pays Wild < Trainer < Rival, +15 XP per harder level, and 10 XP on every loss', () => {
    for (const opponentKind of ['wild', 'trainer', 'rival'] as const) {
      for (let diff = -10; diff <= 10; diff++) {
        const input = {
          isBot: opponentKind !== 'rival',
          opponentKind,
          myLevel: 20,
          oppLevel: 20 + diff,
        };
        expect(challengerReward({ ...input, won: false })).toBe(10);
        const bounded = Math.max(-5, Math.min(5, diff));
        const base = opponentKind === 'wild' ? 20 : opponentKind === 'trainer' ? 30 : 45;
        const expected = Math.max(10, base + (bounded > 0 ? 15 : 5) * bounded);
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
