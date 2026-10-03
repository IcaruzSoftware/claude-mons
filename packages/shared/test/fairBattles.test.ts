import { describe, expect, it } from 'vitest';
import {
  challengerReward,
  npcSnapshot,
  simulateBattle,
  snapshotFor,
} from '../src/battle/battle.ts';
import { MATCHMAKING_WINDOWS, wildEncounterLevel } from '../src/battle/matchmaking.ts';
import { effectiveness, NATION_BEATS } from '../src/game/nations.ts';

import { stageForLevel } from '../src/game/levels.ts';
import { SPECIES } from '../src/game/species.ts';

import type { MonSnapshot } from '../src/battle/battle.ts';

function mon(speciesId: string, level: number, playerId: string | null = speciesId): MonSnapshot {
  return snapshotFor({
    monId: speciesId,
    playerId,
    nickname: speciesId,
    speciesId,
    level,
    stage: stageForLevel(level) as MonSnapshot['stage'],
  });
}

/** Exercise both positions so challenger-side RNG differences cannot masquerade as balance. */
function winRate(a: MonSnapshot, b: MonSnapshot, tag: string, count = 600): number {
  let wins = 0;
  for (let i = 0; i < count; i++) {
    const flipped = i % 2 === 1;
    const result = simulateBattle(flipped ? b : a, flipped ? a : b, `${tag}-${i}`);
    wins += Number(result.winner === (flipped ? 'b' : 'a'));
  }
  return wins / count;
}

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

  it('searches peers first and never extends beyond three levels either way', () => {
    expect(MATCHMAKING_WINDOWS).toEqual([
      { min: 0, max: 0 },
      { min: -1, max: 1 },
      { min: -3, max: 3 },
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
      if (level >= 10) expect(weaker).toBe(750);
    }
  });

  it('gives Ottlet an edge against weaker neutral opponents across its evolution line', () => {
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
            gap === -3 ? 0.7 : 0.5,
          );
          upsets += 1000 - wins;
        }
      }
    }
    expect(upsets).toBeGreaterThan(0);
  });

  it('mixes forgiving wild encounters with peers and varied elites', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 3000; i++) {
      const gap = wildEncounterLevel(20, i / 3000).level - 20;
      counts.set(gap, (counts.get(gap) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      0: 450,
      1: 100,
      2: 100,
      3: 100,
      '-1': 1200,
      '-2': 900,
      '-3': 150,
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

  it('strengthens elemental counters and preserves neutral matchups', () => {
    expect(effectiveness('water', 'fire')).toBe(1.24);
    expect(effectiveness('fire', 'water')).toBe(0.85);
    expect(effectiveness('water', 'air')).toBe(1);
  });

  it.each([2, 5, 10, 30, 50])('makes every elemental counter favored at level %i', (level) => {
    for (const species of Object.values(SPECIES)) {
      for (const foe of Object.values(SPECIES)) {
        if (NATION_BEATS[species.nation] !== foe.nation) continue;
        const tag = `element-${level}-${species.id}-${foe.id}`;
        const rate = winRate(mon(species.id, level), mon(foe.id, level), tag);
        // Hatch pools have only two moves; rarity and effects are a larger part of those fights.
        expect(rate, tag).toBeGreaterThan(level === 2 ? 0.52 : 0.6);
        expect(rate, tag).toBeLessThan(level === 2 ? 1 : 0.99);
      }
    }
  });

  it.each([20, 30, 50])(
    'lets Earth counter Ottlet despite a one-level deficit at level %i',
    (level) => {
      for (const speciesId of ['pebblet', 'mossling']) {
        const tag = `earth-underdog-${speciesId}-${level}`;
        const rate = winRate(mon(speciesId, level - 1), mon('ottlet', level), tag, 1000);
        expect(rate, tag).toBeGreaterThan(0.5);
        expect(rate, tag).toBeLessThan(0.85);
      }
    },
  );

  it.each([5, 10, 30, 50])(
    'keeps Earth more durable than Ottlet against neutral hits at level %i',
    (level) => {
      const attacker = mon('ottlet', level);
      attacker.loadout = { moves: ['splash-dash', 'splash-dash', 'splash-dash'] };
      const fractionTaken = (speciesId: string) => {
        const target = mon(speciesId, level);
        // Isolate durability from speed, move effects and elemental damage.
        target.stats.spd = attacker.stats.spd;
        const move = SPECIES[speciesId]!.movePool[0].id;
        target.loadout = { moves: [move, move, move] };
        let damage = 0;
        for (let i = 0; i < 100; i++) {
          const action = simulateBattle(
            attacker,
            target,
            `durability-${level}-${i}`,
          ).turns[0]!.actions.find((a) => a.actor === 'a')!;
          damage += action.damage;
        }
        return damage / target.stats.hp;
      };
      const otter = fractionTaken('ottlet');
      for (const speciesId of ['pebblet', 'mossling']) {
        expect(fractionTaken(speciesId), speciesId).toBeLessThan(otter * 0.8);
      }
    },
  );

  it.each([5, 10, 20, 30, 50])(
    'keeps trained bots using the encounter distribution beatable with meaningful losses at level %i',
    (level) => {
      let normalWins = 0;
      let normal = 0;
      let eliteWins = 0;
      let elite = 0;
      for (const species of Object.values(SPECIES)) {
        for (const foe of Object.values(SPECIES)) {
          if (species.nation === foe.nation) continue;
          for (let i = 0; i < 100; i++) {
            const encounter = wildEncounterLevel(level, (i + 0.5) / 100);
            const won =
              simulateBattle(
                mon(species.id, level),
                mon(foe.id, encounter.level, null),
                `wild-${species.id}-${foe.id}-${level}-${i}`,
              ).winner === 'a';
            if (encounter.isElite) {
              elite++;
              eliteWins += Number(won);
            } else {
              normal++;
              normalWins += Number(won);
            }
          }
        }
      }
      const overall = (normalWins + eliteWins) / (normal + elite);
      expect(overall).toBeGreaterThan(0.5);
      expect(overall).toBeLessThan(0.82);
      expect(normalWins / normal).toBeGreaterThan(0.55);
      expect(normalWins / normal).toBeLessThan(0.86);
      expect(eliteWins / elite).toBeLessThan(normalWins / normal - 0.08);
    },
  );

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
