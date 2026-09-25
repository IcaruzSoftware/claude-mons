import { describe, expect, it } from 'vitest';
import type { LeaderboardNationRow } from '@claude-mons/shared';
import {
  nationStanding,
  podiumOrder,
  sortNations,
} from '../src/renderer/panel/views/leaderboardHelpers.ts';

function nationRow(over: Partial<LeaderboardNationRow>): LeaderboardNationRow {
  return {
    nation: 'earth',
    members: 0,
    hatched_members: 0,
    total_xp: 0,
    weekly_xp: 0,
    avg_level: null,
    weekly_battles_won: 0,
    weekly_battles_lost: 0,
    rank: 0,
    ...over,
  };
}

describe('podiumOrder', () => {
  it('orders 3 entries as 2nd (left), 1st (center), 3rd (right)', () => {
    const top3 = ['gold', 'silver', 'bronze'];
    expect(podiumOrder(top3)).toEqual([
      { place: 2, entry: 'silver' },
      { place: 1, entry: 'gold' },
      { place: 3, entry: 'bronze' },
    ]);
  });

  it('handles fewer than 3 entries by omitting the missing places', () => {
    expect(podiumOrder(['gold'])).toEqual([{ place: 1, entry: 'gold' }]);
    expect(podiumOrder(['gold', 'silver'])).toEqual([
      { place: 2, entry: 'silver' },
      { place: 1, entry: 'gold' },
    ]);
    expect(podiumOrder([])).toEqual([]);
  });

  it('ignores any entries past the first 3', () => {
    const top3 = ['gold', 'silver', 'bronze', 'fourth', 'fifth'];
    expect(podiumOrder(top3).map((p) => p.entry)).toEqual(['silver', 'gold', 'bronze']);
  });
});

describe('nationStanding', () => {
  it('reads weekly XP and weekly battle counts under the weekly scope', () => {
    const row = nationRow({
      weekly_xp: 839,
      total_xp: 16545,
      weekly_battles_won: 3,
      weekly_battles_lost: 1,
      battles_won: 40,
      battles_lost: 10,
    });
    expect(nationStanding(row, 'weekly')).toEqual({ xp: 839, won: 3, lost: 1 });
  });

  it('reads total XP and all-time battle counts under the all-time scope', () => {
    const row = nationRow({
      weekly_xp: 839,
      total_xp: 16545,
      weekly_battles_won: 3,
      weekly_battles_lost: 1,
      battles_won: 40,
      battles_lost: 10,
    });
    expect(nationStanding(row, 'alltime')).toEqual({ xp: 16545, won: 40, lost: 10 });
  });

  it('treats missing all-time battle fields as 0 (older server)', () => {
    const row = nationRow({ total_xp: 16545 });
    expect(nationStanding(row, 'alltime')).toEqual({ xp: 16545, won: 0, lost: 0 });
  });
});

describe('sortNations', () => {
  const earth = nationRow({ nation: 'earth', total_xp: 16545, weekly_xp: 839 });
  const water = nationRow({ nation: 'water', total_xp: 3270, weekly_xp: 3270 });

  it('orders by total XP under the all-time scope', () => {
    expect(sortNations([water, earth], 'alltime').map((r) => r.nation)).toEqual(['earth', 'water']);
  });

  it('orders by weekly XP under the weekly scope', () => {
    expect(sortNations([earth, water], 'weekly').map((r) => r.nation)).toEqual(['water', 'earth']);
  });

  it('tie-breaks by the other scope XP', () => {
    const a = nationRow({ nation: 'fire', weekly_xp: 500, total_xp: 900 });
    const b = nationRow({ nation: 'air', weekly_xp: 500, total_xp: 1200 });
    expect(sortNations([a, b], 'weekly').map((r) => r.nation)).toEqual(['air', 'fire']);
  });
});
