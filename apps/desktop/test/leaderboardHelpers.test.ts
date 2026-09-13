import { describe, expect, it } from 'vitest';
import { podiumOrder } from '../src/renderer/panel/views/leaderboardHelpers.ts';

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
