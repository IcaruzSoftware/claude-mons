import { describe, expect, it } from 'vitest';
import { MAX_TURNS, challengerReward, simulateBattle, snapshotFor } from '../src/battle/battle.ts';
import { makeRng } from '../src/battle/rng.ts';
import { NATIONS } from '../src/types.ts';
import { effectiveness, otherNations } from '../src/game/nations.ts';
import { SPECIES, SPECIES_IDS, rollSpecies, speciesForNation } from '../src/game/species.ts';

const snap = (speciesId: string, level: number, side: string) =>
  snapshotFor({ monId: side, playerId: side, nickname: side, speciesId, stage: 'baby', level });

describe('rng', () => {
  it('is deterministic and uniform-ish', () => {
    const a = makeRng('seed-1');
    const b = makeRng('seed-1');
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    const c = makeRng('seed-2');
    expect(Array.from({ length: 20 }, () => c())).not.toEqual(seqA);
    let sum = 0;
    const r = makeRng('uniform');
    for (let i = 0; i < 20000; i++) sum += r();
    expect(sum / 20000).toBeGreaterThan(0.48);
    expect(sum / 20000).toBeLessThan(0.52);
  });
});

describe('nations', () => {
  it('form a single cycle where each nation beats one and resists one', () => {
    for (const n of NATIONS) {
      const beats = NATIONS.filter((m) => effectiveness(n, m) === 2);
      const resisted = NATIONS.filter((m) => effectiveness(n, m) === 0.5);
      expect(beats).toHaveLength(1);
      expect(resisted).toHaveLength(1);
      expect(effectiveness(n, n)).toBe(1);
      expect(otherNations(n)).toHaveLength(3);
    }
  });
});

describe('species table', () => {
  it('has two species per nation with the agreed stat budgets', () => {
    for (const n of NATIONS) {
      const pool = speciesForNation(n);
      expect(pool).toHaveLength(2);
      expect(pool.map((s) => s.rarity).sort()).toEqual(['common', 'rare']);
    }
    for (const s of Object.values(SPECIES)) {
      const total = s.baseStats.hp + s.baseStats.atk + s.baseStats.def + s.baseStats.spd;
      expect(total).toBe(s.rarity === 'common' ? 210 : 215);
      expect(s.id).toBe(s.names.baby.toLowerCase());
    }
    expect(SPECIES_IDS).toHaveLength(8);
  });

  it('rolls rare species 25 % of the time', () => {
    let rare = 0;
    const N = 4000;
    const r = makeRng('roll');
    for (let i = 0; i < N; i++) if (rollSpecies('fire', r()).rarity === 'rare') rare++;
    expect(rare / N).toBeGreaterThan(0.21);
    expect(rare / N).toBeLessThan(0.29);
    expect(rollSpecies('water', 0).id).toBe('dripple');
    expect(rollSpecies('water', 0.99).id).toBe('bubblit');
  });
});

describe('simulateBattle', () => {
  it('is deterministic for the same seed and differs across seeds', () => {
    const a = snap('sparkit', 10, 'a');
    const b = snap('dripple', 10, 'b');
    const r1 = simulateBattle(a, b, 'battle-1');
    const r2 = simulateBattle(a, b, 'battle-1');
    expect(r2).toEqual(r1);
    const r3 = simulateBattle(a, b, 'battle-2');
    expect(JSON.stringify(r3)).not.toEqual(JSON.stringify(r1));
  });

  it('always terminates within MAX_TURNS and reports consistent hp', () => {
    const r = makeRng('terminate');
    for (let i = 0; i < 300; i++) {
      const ids = SPECIES_IDS;
      const a = snap(ids[Math.floor(r() * ids.length)]!, 1 + Math.floor(r() * 50), 'a');
      const b = snap(ids[Math.floor(r() * ids.length)]!, 1 + Math.floor(r() * 50), 'b');
      const res = simulateBattle(a, b, `t-${i}`);
      expect(res.turns.length).toBeLessThanOrEqual(MAX_TURNS);
      expect(res.turns.length).toBeGreaterThan(0);
      const last = res.turns.at(-1)!.actions.at(-1)!;
      expect(res.finalHp.a).toBeGreaterThanOrEqual(0);
      expect(res.finalHp.b).toBeGreaterThanOrEqual(0);
      if (res.reason === 'ko') expect(Math.min(res.finalHp.a, res.finalHp.b)).toBe(0);
      expect(last.targetHpAfter).toBeGreaterThanOrEqual(0);
    }
  });

  it('golden log: pins the protocol so client and server cannot drift', () => {
    const res = simulateBattle(snap('sparkit', 10, 'a'), snap('puffle', 10, 'b'), 'golden-1');
    // If this test fails after an intentional formula change, update the fixture AND bump the
    // battle protocol version in the Edge Function; old logs keep replaying from stored snapshots.
    expect(res.turns.length).toBeGreaterThan(0);
    expect(res).toMatchSnapshot();
  });

  it('rewards follow the design table', () => {
    expect(challengerReward({ won: true, isBot: false, myLevel: 10, oppLevel: 10 })).toBe(30);
    expect(challengerReward({ won: true, isBot: false, myLevel: 10, oppLevel: 20 })).toBe(45);
    expect(challengerReward({ won: true, isBot: false, myLevel: 20, oppLevel: 10 })).toBe(15);
    expect(challengerReward({ won: false, isBot: false, myLevel: 10, oppLevel: 10 })).toBe(10);
    expect(challengerReward({ won: true, isBot: true, myLevel: 10, oppLevel: 10 })).toBe(20);
    expect(challengerReward({ won: false, isBot: true, myLevel: 10, oppLevel: 10 })).toBe(5);
  });
});
