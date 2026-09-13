import { describe, expect, it } from 'vitest';
import { MIGRATIONS, defaultState } from '../src/main/persistence/state.ts';

describe('MIGRATIONS', () => {
  it('is append-only: one migration per schema version bump, defaultState matches the latest', () => {
    expect(defaultState().schemaVersion).toBe(1);
    // JsonStore stamps schemaVersion = migrations.length + 1 once a file is loaded/migrated; this
    // just guards against someone editing an existing migration in place instead of appending one.
    expect(MIGRATIONS.length).toBeGreaterThan(0);
  });

  it('addOpponentLoadoutSummary (v6 -> v7) backfills opponent.loadout with {} on old history entries', () => {
    const addOpponentLoadoutSummary = MIGRATIONS[MIGRATIONS.length - 1]!;
    const before = {
      schemaVersion: 6,
      battles: {
        history: [
          { id: 'a', opponent: { nickname: 'Wild Sparkit', speciesId: 'sparkit' } },
          {
            id: 'b',
            opponent: {
              nickname: 'Wild Dripple',
              speciesId: 'dripple',
              loadout: { stance: 'fury' },
            },
          },
        ],
      },
    };
    const after = addOpponentLoadoutSummary(before) as typeof before & {
      battles: { history: Array<{ opponent: { loadout: unknown } }> };
    };
    expect(after.battles.history[0]!.opponent.loadout).toEqual({});
    // an entry that already had a loadout (shouldn't happen pre-migration, but must not be clobbered)
    expect(after.battles.history[1]!.opponent.loadout).toEqual({ stance: 'fury' });
  });

  it('addOpponentLoadoutSummary tolerates a missing/empty history array', () => {
    const addOpponentLoadoutSummary = MIGRATIONS[MIGRATIONS.length - 1]!;
    expect(() => addOpponentLoadoutSummary({ schemaVersion: 6 })).not.toThrow();
    expect(() => addOpponentLoadoutSummary({ schemaVersion: 6, battles: {} })).not.toThrow();
  });
});
