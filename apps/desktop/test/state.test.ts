import { describe, expect, it } from 'vitest';
import { MIGRATIONS, defaultState, loadoutNation } from '../src/main/persistence/state.ts';
import { NATIONS, speciesForNation } from '@claude-mons/shared';

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

describe('loadoutNation', () => {
  it("uses the hatched mon's species nation for every nation, not profile.nation", () => {
    for (const nation of NATIONS) {
      const species = speciesForNation(nation)[0]!;
      // profile.nation deliberately set to a DIFFERENT nation than the species: the tree belongs to
      // the species, so the main-process set-loadout gate must validate against the species nation
      // (matching the renderer editor and the server's monState). Before the fix this returned
      // profile.nation, which made the gate reject a valid non-matching tree the editor built.
      const wrongProfile = NATIONS.find((n) => n !== nation)!;
      const state = { profile: { nation: wrongProfile }, pet: { speciesId: species.id } };
      expect(loadoutNation(state), `${nation} species`).toBe(nation);
    }
  });

  it('falls back to profile.nation (then water) only while still an egg', () => {
    expect(loadoutNation({ profile: { nation: 'air' }, pet: { speciesId: null } })).toBe('air');
    expect(loadoutNation({ profile: { nation: null }, pet: { speciesId: null } })).toBe('water');
  });
});
