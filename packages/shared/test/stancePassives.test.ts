import { describe, expect, it } from 'vitest';
import {
  simulateBattle,
  snapshotFor,
  type BattleAction,
  type BattleResult,
} from '../src/battle/battle.ts';
import { speciesOf } from '../src/game/species.ts';
import { stanceBuildHint, type Stance } from '../src/game/progression.ts';
import type { EffectId } from '../src/battle/effects.ts';
import { nationNodes } from '../src/game/tree.ts';

function mon(stance: Stance, effects: EffectId[], hp = 4000, atk = 250) {
  const speciesId =
    effects.includes('drain') || effects.includes('shield_first') ? 'puffle' : 'wispit';
  const pool = speciesOf(speciesId).movePool;
  const moveId = (effect: EffectId) => pool.find((move) => move.effect === effect)!.id;
  const snapshot = snapshotFor({
    monId: 'test',
    playerId: 'test',
    nickname: 'Test',
    speciesId,
    stage: 'adult',
    level: 50,
    loadout: { stance, moves: effects.map(moveId) },
  });
  return { ...snapshot, stats: { hp, atk, def: 80, spd: 100 } };
}
const triggered = (action: BattleAction, side: 'a' | 'b', stance: Stance) =>
  action.stancePassives?.some((trigger) => trigger.side === side && trigger.stance === stance) ??
  false;
const mainActions = (result: BattleResult, side: 'a' | 'b') =>
  result.turns.map((turn) => ({
    turn: turn.turn,
    first: turn.first,
    hit: turn.actions.find((hit) => hit.actor === side && hit.moveId && !hit.doubleStrike),
  }));

describe('conditional stance passives', () => {
  it('Tempo and Brace change actual damage, while instant charges cannot activate Brace', () => {
    let tempoChecks = 0;
    for (let seed = 0; seed < 100; seed++) {
      const enemy = mon('fury', ['true_hit', 'drain', 'shield_first']);
      const enhanced = simulateBattle(
        mon('gale', ['priority', 'true_hit', 'crit_up']),
        enemy,
        `actual-${seed}`,
      );
      const neutral = simulateBattle(
        mon('fury', ['priority', 'true_hit', 'crit_up']),
        enemy,
        `actual-${seed}`,
      );
      const hit = mainActions(enhanced, 'a')[1]?.hit,
        baseline = mainActions(neutral, 'a')[1]?.hit;
      if (hit && baseline && triggered(hit, 'a', 'gale')) {
        expect(hit.damage).toBeGreaterThan(baseline.damage);
        expect(Math.abs(hit.damage - baseline.damage * 1.1)).toBeLessThan(2);
        tempoChecks++;
      }
      const attack = mon('gale', ['true_hit', 'priority', 'crit_up']);
      const defender = mon('bulwark', ['charge', 'true_hit', 'crit_up']);
      const brace = simulateBattle(attack, defender, `actual-${seed}`);
      const withoutBrace = simulateBattle(
        attack,
        { ...defender, loadout: { ...defender.loadout, stance: 'fury' } },
        `actual-${seed}`,
      );
      const direct = mainActions(brace, 'a')[0]!.hit!,
        plain = mainActions(withoutBrace, 'a')[0]!.hit!;
      expect(direct.damage).toBeLessThan(plain.damage);
      expect(Math.abs(direct.damage - plain.damage * 0.9)).toBeLessThan(2);
    }
    expect(tempoChecks).toBeGreaterThan(0);
    const instant = mon('bulwark', ['charge', 'true_hit', 'crit_up']);
    const capstone = nationNodes('air').find((node) => node.capstone?.kind === 'chargeInstant')!;
    instant.loadout!.tree = Object.fromEntries(
      nationNodes('air')
        .filter((node) => node.branch === capstone.branch)
        .map((node) => [node.id, 1]),
    );
    const result = simulateBattle(
      mon('gale', ['true_hit', 'priority', 'crit_up']),
      instant,
      'instant-brace',
    );
    expect(
      result.turns.flatMap((turn) => turn.actions).some((hit) => hit.charge === 'telegraph'),
    ).toBe(false);
    expect(
      result.turns.flatMap((turn) => turn.actions).some((hit) => triggered(hit, 'b', 'bulwark')),
    ).toBe(false);
  });
  it('Exploit needs a previous debuff and a crit/release, and never boosts setup or doubles', () => {
    let crits = 0,
      releases = 0,
      unboosted = 0;
    for (const payoff of ['crit_up', 'charge'] as const) {
      for (let seed = 0; seed < 100; seed++) {
        const result = simulateBattle(
          mon('fury', ['burn', payoff, 'true_hit']),
          mon('gale', ['true_hit', 'drain', 'shield_first']),
          `exploit-${seed}`,
        );
        let burnTurns = 0;
        for (const turn of result.turns) {
          for (const hit of turn.actions.filter(
            (action) => action.actor === 'a' && action.moveId,
          )) {
            const qualifies =
              burnTurns > 0 &&
              !hit.dodged &&
              !hit.doubleStrike &&
              (hit.crit || hit.charge === 'release');
            expect(triggered(hit, 'a', 'fury')).toBe(qualifies);
            if (qualifies) {
              if (hit.charge === 'release') releases++;
              else crits++;
            } else unboosted++;
            if (hit.effect === 'burn' && !hit.dodged && burnTurns === 0) burnTurns = 3;
          }
          burnTurns = Math.max(0, burnTurns - 1);
        }
      }
    }
    expect(crits).toBeGreaterThan(0);
    expect(releases).toBeGreaterThan(0);
    expect(unboosted).toBeGreaterThan(0);
  });

  it('Exploit increases real damage while a no-debuff build receives no bonus', () => {
    const enemy = mon('gale', ['true_hit', 'drain', 'shield_first']);
    let checked = 0;
    for (let seed = 0; seed < 100; seed++) {
      const effects: EffectId[] = ['burn', 'crit_up', 'true_hit'];
      const enhanced = simulateBattle(mon('fury', effects), enemy, `damage-${seed}`);
      const neutral = simulateBattle(mon('gale', effects), enemy, `damage-${seed}`);
      const hit = mainActions(enhanced, 'a')[1]?.hit;
      const baseline = mainActions(neutral, 'a')[1]?.hit;
      if (hit && baseline && triggered(hit, 'a', 'fury')) {
        expect(hit.damage).toBeGreaterThan(baseline.damage);
        expect(hit.damage).toBeCloseTo(baseline.damage * 1.08, -1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    const noDebuff = simulateBattle(
      mon('fury', ['crit_up', 'charge', 'true_hit']),
      enemy,
      'no-setup',
    );
    expect(
      noDebuff.turns.flatMap((turn) => turn.actions).some((hit) => triggered(hit, 'a', 'fury')),
    ).toBe(false);
  });

  it('Tempo requires last turn landed Priority, a different move, and first initiative', () => {
    let activations = 0,
      repeated = 0,
      misses = 0,
      telegraphs = 0,
      second = 0;
    for (const payoff of ['true_hit', 'charge'] as const) {
      for (let seed = 0; seed < 200; seed++) {
        const result = simulateBattle(
          mon('gale', ['priority', payoff, 'crit_up']),
          mon('fury', ['priority', 'drain', 'shield_first']),
          `tempo-${seed}`,
        );
        let previous: BattleAction | undefined;
        for (const { hit, first } of mainActions(result, 'a')) {
          if (!hit) continue;
          const ready =
            previous?.effect === 'priority' && !previous.dodged && previous.moveId !== hit.moveId;
          const qualifies = Boolean(
            ready && first === 'a' && !hit.dodged && hit.charge !== 'telegraph',
          );
          expect(triggered(hit, 'a', 'gale')).toBe(qualifies);
          if (qualifies) activations++;
          if (previous?.moveId === hit.moveId) repeated++;
          if (previous?.dodged) misses++;
          if (hit.charge === 'telegraph') telegraphs++;
          if (ready && first === 'b') second++;
          previous = hit;
        }
        expect(
          result.turns
            .flatMap((turn) => turn.actions)
            .filter((hit) => hit.doubleStrike)
            .some((hit) => triggered(hit, 'a', 'gale')),
        ).toBe(false);
      }
    }
    for (const count of [activations, repeated, misses, telegraphs, second])
      expect(count).toBeGreaterThan(0);
  });

  it('Brace protects telegraph turns in either initiative, but not high-HP releases or burn', () => {
    const initiative = new Set<string>();
    let protectedHits = 0,
      unprotectedHits = 0,
      burns = 0;
    for (let seed = 0; seed < 100; seed++) {
      const result = simulateBattle(
        mon('fury', ['burn', 'true_hit', 'crit_up']),
        mon('bulwark', ['charge', 'true_hit', 'crit_up']),
        `brace-${seed}`,
      );
      for (const turn of result.turns) {
        const charging = turn.actions.some(
          (hit) => hit.actor === 'b' && hit.charge === 'telegraph',
        );
        for (const hit of turn.actions) {
          if (hit.moveId === null) {
            expect(hit.stancePassives).toBeUndefined();
            burns++;
            continue;
          }
          if (hit.actor !== 'a' || hit.dodged) continue;
          expect(triggered(hit, 'b', 'bulwark')).toBe(charging);
          if (charging) {
            protectedHits++;
            initiative.add(turn.first);
          } else unprotectedHits++;
        }
      }
    }
    expect([...initiative].sort()).toEqual(['a', 'b']);
    for (const count of [protectedHits, unprotectedHits, burns]) expect(count).toBeGreaterThan(0);
  });

  it('Brace checks HP before each hit, including double strikes, without a charge equipped', () => {
    let protectedHits = 0,
      healthyHits = 0;
    for (let seed = 0; seed < 200; seed++) {
      const result = simulateBattle(
        mon('gale', ['true_hit', 'priority', 'crit_up'], 1000, 600),
        mon('bulwark', ['true_hit', 'priority', 'crit_up'], 350, 10),
        `threshold-${seed}`,
      );
      let hp = 350;
      for (const hit of result.turns.flatMap((turn) => turn.actions)) {
        if (hit.actor !== 'a') continue;
        expect(triggered(hit, 'b', 'bulwark')).toBe(!hit.dodged && hp <= 350 * 0.35);
        if (!hit.dodged) {
          if (hp <= 350 * 0.35) protectedHits++;
          else healthyHits++;
        }
        hp = hit.targetHpAfter;
      }
    }
    expect(protectedHits).toBeGreaterThan(0);
    expect(healthyHits).toBeGreaterThan(0);
  });

  it('build hints use the current attacks and distinguish unusable Tempo and conditional Exploit', () => {
    expect(stanceBuildHint('gale', [{ effect: 'drain' }])).toContain('cannot activate');
    expect(stanceBuildHint('gale', [{ effect: 'priority' }])).toContain('Acting first');
    expect(stanceBuildHint('fury', [{ effect: 'burn' }, { effect: 'charge' }])).toContain(
      'Build fit',
    );
    expect(stanceBuildHint('fury', [{ effect: 'true_hit' }])).toContain('innate traits');
    expect(stanceBuildHint('bulwark', [{ effect: 'charge' }])).toContain('Instant-charge');
  });
});
