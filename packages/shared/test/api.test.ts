import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ApiError,
  BattleRequestResponse,
  CreateProfileRequest,
  IngestEvent,
  IngestXpRequest,
  IngestXpResponse,
  LeaderboardNationRow,
  MonState,
} from '../src/api.ts';
import * as api from '../src/api.ts';
import { emptyBucket } from '../src/game/xp.ts';

const mon: MonState = {
  id: '00000000-0000-4000-8000-000000000001',
  speciesId: 'sparkit',
  stage: 'baby',
  level: 3,
  totalXp: 320,
  xpIntoLevel: 20,
  xpToNext: 280,
  stats: { hp: 72, atk: 62, def: 41, spd: 41 },
  streakDays: 2,
  battle: { cooldownUntil: null, remainingToday: 10 },
};

describe('api types', () => {
  it('is a types-only module (no runtime exports)', () => {
    expect(Object.keys(api)).toEqual([]);
  });

  it('accepts well-formed requests and responses', () => {
    const create = { nation: 'fire' } satisfies CreateProfileRequest;
    expect(create.nation).toBe('fire');

    const ingest = {
      batch_id: 'b1',
      device_id: 'd1',
      client_version: '0.1.0',
      buckets: [emptyBucket(Date.UTC(2026, 8, 4, 12, 0))],
    } satisfies IngestXpRequest;
    expect(ingest.buckets[0]?.minute).toBe(Date.UTC(2026, 8, 4, 12, 0));

    const events: IngestEvent[] = [
      { type: 'hatched', speciesId: 'sparkit' },
      { type: 'level_up', from: 1, to: 2 },
      { type: 'evolved', stage: 'baby' },
      { type: 'streak', days: 3, bonus: 55 },
    ];
    const response = {
      batch_id: 'b1',
      duplicate: false,
      awarded: { prompt: 5, stop: 10, tool: 3, bonus: 0, total: 18 },
      dropped: [{ reason: 'cap_day', xp: 4 }],
      mon,
      events,
      notifications: [],
      server_time: '2026-09-04T12:00:00.000Z',
    } satisfies IngestXpResponse;
    expect(response.awarded.total).toBe(18);

    const error = { error: { code: 'NICKNAME_TAKEN', message: 'taken' } } satisfies ApiError;
    expect(error.error.code).toBe('NICKNAME_TAKEN');
  });

  it('type-level sanity checks', () => {
    expectTypeOf<MonState['stage']>().toEqualTypeOf<'egg' | 'baby' | 'teen' | 'adult'>();
    expectTypeOf<BattleRequestResponse['battle']['b']['playerId']>().toEqualTypeOf<string | null>();
    expectTypeOf<LeaderboardNationRow['avg_level']>().toEqualTypeOf<number | null>();
    expectTypeOf<IngestEvent>().toMatchTypeOf<{ type: string }>();
  });
});
