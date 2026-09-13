import { describe, expect, it } from 'vitest';
import { snapshotFor, type MonSnapshot } from '../src/battle/battle.ts';
import { explainMatchup, topBranch, toRoman } from '../src/battle/matchup.ts';
import type { MonLoadout } from '../src/game/progression.ts';

/** Builds a full snapshot (species/level determine which moves are unlocked) and then lets the
 * caller override `loadout` -- including dropping it entirely, to simulate a pre-Phase-A/B/C
 * stored snapshot that predates the field. */
function snap(speciesId: string, level: number, loadout: MonLoadout | undefined): MonSnapshot {
  const built = snapshotFor({
    monId: speciesId,
    playerId: speciesId,
    nickname: speciesId,
    speciesId,
    stage: 'adult',
    level,
    ...(loadout !== undefined ? { loadout } : {}),
  });
  if (loadout === undefined) {
    // snapshotFor always fills in a default loadout; drop it again to simulate a genuinely old
    // stored snapshot that has no `loadout` field at all.
    const { loadout: _drop, ...rest } = built;
    return rest as MonSnapshot;
  }
  return built;
}

describe('explainMatchup', () => {
  it('flags a nation-type advantage and suggests leaning on it, absent any other edge', () => {
    const me = snap('dripple', 25, {
      stance: 'bulwark',
      moves: ['drip-tap', 'stream-splash', 'backpressure'],
    });
    const opp = snap('sparkit', 25, {
      stance: 'fury',
      moves: ['spark-nip', 'hot-reload', 'force-push'],
    });
    const r = explainMatchup(me, opp);
    expect(r.nationLine).toBe('Water hits Fire hard.');
    expect(r.stanceLine).toBe('Your Bulwark counters their Fury.');
    expect(r.suggestion).toBe('Lean on nation-type moves -- Water hits Fire hard.');
    expect(r.suggestedStance).toBeNull();
  });

  it('flags a nation-type disadvantage and suggests avoiding the trade', () => {
    // Stances are chosen so *I* counter the opponent's stance (bulwark beats fury) -- this isolates
    // the nation-disadvantage rule, which only applies once the higher-priority stance-counter rule
    // (the opponent countering me) does not.
    const me = snap('sparkit', 25, {
      stance: 'bulwark',
      moves: ['spark-nip', 'hot-reload', 'force-push'],
    });
    const opp = snap('dripple', 25, {
      stance: 'fury',
      moves: ['drip-tap', 'stream-splash', 'ripple-step'],
    });
    const r = explainMatchup(me, opp);
    expect(r.nationLine).toBe('Water hits Fire hard -- brace for it.');
    expect(r.stanceLine).toBe('Your Bulwark counters their Fury.');
    expect(r.suggestion).toBe('Avoid trading nation-type hits -- Water hits back hard.');
    expect(r.suggestedStance).toBeNull();
  });

  it('reports a neutral nation matchup and a neutral fallback suggestion when nothing else applies', () => {
    const me = snap('dripple', 25, {
      stance: 'bulwark',
      moves: ['drip-tap', 'stream-splash', 'ripple-step'],
    });
    const opp = snap('puffle', 25, {
      stance: 'bulwark',
      moves: ['puff', 'gust-draft', 'thunderclap'],
    });
    const r = explainMatchup(me, opp);
    expect(r.nationLine).toBe('Water and Air trade evenly.');
    expect(r.stanceLine).toBe('Both use Bulwark -- no stance edge either way.');
    expect(r.suggestion).toBe('No clear edge either way -- play it by the numbers.');
    expect(r.suggestedStance).toBeNull();
  });

  it('suggests switching stance when the opponent counters mine', () => {
    const me = snap('dripple', 25, {
      stance: 'fury',
      moves: ['drip-tap', 'stream-splash', 'ripple-step'],
    });
    const opp = snap('puffle', 25, {
      stance: 'bulwark',
      moves: ['puff', 'gust-draft', 'thunderclap'],
    });
    const r = explainMatchup(me, opp);
    expect(r.stanceLine).toBe('Their Bulwark counters your Fury.');
    expect(r.suggestion).toBe('Switch to Gale to counter Bulwark.');
    expect(r.suggestedStance).toBe('gale');
  });

  it('does not suggest a stance switch when the player already counters the opponent', () => {
    const me = snap('pebblet', 25, {
      stance: 'gale',
      moves: ['pebble-toss', 'bedrock-slam', 'monolith-drop'],
    });
    const opp = snap('sparkit', 25, {
      stance: 'bulwark',
      moves: ['spark-nip', 'hot-reload', 'force-push'],
    });
    const r = explainMatchup(me, opp);
    expect(r.stanceLine).toBe('Your Gale counters their Bulwark.');
    expect(r.suggestedStance).toBeNull();
    expect(r.suggestion).toBe('No clear edge either way -- play it by the numbers.');
  });

  it('suggests burn against an equipped shield_first move, naming the move', () => {
    const me = snap('puffle', 25, { stance: 'fury', moves: ['puff', 'gust-draft', 'thunderclap'] });
    const opp = snap('dripple', 25, {
      stance: 'fury',
      moves: ['drip-tap', 'stream-splash', 'backpressure'],
    });
    const r = explainMatchup(me, opp);
    expect(r.finisherLine).toBe('Finishes with Backpressure (shields their first hit taken).');
    expect(r.suggestion).toBe("Burn beats Backpressure's single-hit shield.");
    expect(r.suggestedStance).toBeNull();
  });

  it('suggests burn against the Stone Skin shared passive, naming the passive', () => {
    const me = snap('puffle', 25, {
      stance: 'bulwark',
      moves: ['puff', 'gust-draft', 'thunderclap'],
    });
    const opp = snap('dripple', 25, {
      stance: 'bulwark',
      moves: ['drip-tap', 'stream-splash', 'ripple-step'],
      tree: { 'water:current:1': 3, 'water:current:2': 2, 'shared:stone-skin': 1 },
    });
    const r = explainMatchup(me, opp);
    expect(r.suggestion).toBe("Burn beats Stone Skin's single-hit shield.");
    expect(r.topBranchLine).toBe('Invested most in Current (5 ranks).');
    expect(topBranch('water', opp.loadout?.tree)).toEqual({ branch: 'Current', ranks: 5 });
    expect(toRoman(5)).toBe('V');
  });

  it('suggests a true-hit opener against a Gale opponent when no other edge applies first', () => {
    const me = snap('pebblet', 25, {
      stance: 'fury',
      moves: ['pebble-toss', 'bedrock-slam', 'monolith-drop'],
    });
    const opp = snap('puffle', 25, {
      stance: 'gale',
      moves: ['puff', 'gust-draft', 'thunderclap'],
    });
    const r = explainMatchup(me, opp);
    expect(r.stanceLine).toBe('Your Fury counters their Gale.');
    expect(r.suggestion).toBe('A true-hit opener ignores their Gale dodge.');
    expect(r.suggestedStance).toBeNull();
  });

  it('defaults stance/moves and skips tree facts for an opponent snapshot with no loadout at all', () => {
    const me = snap('dripple', 25, {
      stance: 'bulwark',
      moves: ['drip-tap', 'stream-splash', 'ripple-step'],
    });
    const opp = snap('sparkit', 10, undefined);
    expect(opp.loadout).toBeUndefined();
    const r = explainMatchup(me, opp);
    // defaults to DEFAULT_STANCE ('bulwark') for the opponent, and defaultLoadoutMoveIds for moves.
    expect(r.stanceLine).toBe('Both use Bulwark -- no stance edge either way.');
    expect(r.openerLine).toBe('Opens with Spark Nip (always acts first).');
    expect(r.topBranchLine).toBeNull();
  });

  it('defaults moves and tree facts for a loadout that only specifies a stance', () => {
    const me = snap('dripple', 25, {
      stance: 'bulwark',
      moves: ['drip-tap', 'stream-splash', 'ripple-step'],
    });
    const opp = snap('pebblet', 5, { stance: 'fury' });
    const r = explainMatchup(me, opp);
    // level 5 unlocks slots 1-3 only; default loadout repeats the pool's first 3 moves.
    expect(r.openerLine).toBe('Opens with Pebble Toss (always acts first).');
    expect(r.finisherLine).toBe('Finishes with Monolith Drop (high crit chance).');
    expect(r.topBranchLine).toBeNull();
    expect(topBranch('earth', opp.loadout?.tree)).toBeNull();
  });

  it('also defaults a missing loadout on the player (me) side without throwing', () => {
    const me = snap('dripple', 8, undefined);
    const opp = snap('sparkit', 25, {
      stance: 'bulwark',
      moves: ['spark-nip', 'hot-reload', 'force-push'],
    });
    expect(() => explainMatchup(me, opp)).not.toThrow();
    const r = explainMatchup(me, opp);
    expect(r.stanceLine).toBe('Both use Bulwark -- no stance edge either way.');
  });
});

describe('toRoman', () => {
  it('renders small integers as roman numerals', () => {
    expect(toRoman(1)).toBe('I');
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(9)).toBe('IX');
    expect(toRoman(10)).toBe('X');
    expect(toRoman(0)).toBe('');
  });
});
