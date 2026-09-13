import { describe, expect, it } from 'vitest';
import type { CreateProfileResponse } from '@claude-mons/shared';
import {
  buildAdoptedProfile,
  isValidEmailFormat,
  resetToAnonymousProfile,
  resolveConfirmedEmail,
} from '../src/main/net/account.ts';
import { describeAuthError } from '../src/main/net/SupabaseClient.ts';
import { defaultState } from '../src/main/persistence/state.ts';

function fakeResponse(
  overrides: Partial<CreateProfileResponse['mon']> = {},
): CreateProfileResponse {
  return {
    player: { id: 'server-uid', nickname: 'Trainer_1234', nation: 'water' },
    mon: {
      id: 'mon-1',
      speciesId: 'splashy',
      stage: 'teen',
      level: 12,
      totalXp: 5000,
      xpIntoLevel: 100,
      xpToNext: 400,
      stats: { hp: 1, atk: 1, def: 1, spd: 1 },
      streakDays: 7,
      winStreak: 0,
      loadout: { stance: 'bulwark' },
      unlockedMoveIds: [],
      treePoints: { spent: 0, available: 0 },
      sharedPassivePoints: { spent: 0, available: 0 },
      lastRespecAt: null,
      battle: { cooldownUntil: null, remainingToday: 3 },
      ...overrides,
    },
    created: false,
  };
}

describe('isValidEmailFormat', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmailFormat('a@b.com')).toBe(true);
    expect(isValidEmailFormat('trainer.one+test@example.co.uk')).toBe(true);
    expect(isValidEmailFormat('  a@b.com  ')).toBe(true); // trims
  });

  it('rejects malformed or oversized addresses', () => {
    expect(isValidEmailFormat('')).toBe(false);
    expect(isValidEmailFormat('not-an-email')).toBe(false);
    expect(isValidEmailFormat('a@b')).toBe(false);
    expect(isValidEmailFormat('a b@c.com')).toBe(false);
    expect(isValidEmailFormat('@b.com')).toBe(false);
    expect(isValidEmailFormat(`${'a'.repeat(250)}@b.com`)).toBe(false);
  });
});

describe('buildAdoptedProfile', () => {
  it('writes the server profile fields and resets local progress from scratch', () => {
    const current = defaultState();
    current.pet.seed = 12345; // preserved: it's the behavior engine's per-install seed, not per-account
    current.profile.nation = 'fire'; // this device's prior (about-to-be-replaced) local player
    current.progress.localXp = 999;
    current.progress.stage = 'baby';

    const patch = buildAdoptedProfile(current, fakeResponse(), 'trainer@example.com');

    expect(patch.profile).toEqual({
      userId: 'server-uid',
      nickname: 'Trainer_1234',
      nation: 'water',
      email: 'trainer@example.com',
    });
    // pet/progress start from egg/null so GameService.applyServerState derives everything from
    // the server's MonState rather than mixing in this device's previous local player.
    expect(patch.pet).toEqual({ speciesId: null, seed: 12345 });
    expect(patch.progress).toEqual({
      localXp: 0,
      serverXp: null,
      stage: 'egg',
      hatchedAt: null,
      evolvedAt: {},
    });
    expect(patch.streak).toEqual({ streakDays: 7, lastActiveDay: null });
    expect(patch.ledger).toEqual({ credited: [], pending: [], lastSyncAt: null, batchId: null });
    expect(patch.bonusXp).toBe(0);
    expect(patch.battleXp).toBe(0);
    expect(patch.battles).toEqual({
      history: [],
      lastBattleAt: null,
      today: { day: '', count: 0 },
      streak: 0,
    });
  });
});

describe('resolveConfirmedEmail', () => {
  it('returns null for a missing user or one still anonymous', () => {
    expect(resolveConfirmedEmail(null)).toBeNull();
    expect(resolveConfirmedEmail(undefined)).toBeNull();
    expect(resolveConfirmedEmail({ is_anonymous: true, email: 'trainer@example.com' })).toBeNull();
  });

  it('returns the confirmed email once the account is permanent and nothing is pending', () => {
    expect(resolveConfirmedEmail({ is_anonymous: false, email: 'trainer@example.com' })).toBe(
      'trainer@example.com',
    );
  });

  it('returns null while a `new_email` change is still pending, even if `is_anonymous` already flipped', () => {
    // Clicking the confirmation link flips `is_anonymous` and the email atomically, but a
    // stale/cached user object could still carry a pending `new_email` for a moment; that must
    // never be surfaced as the confirmed address (`docs/runbooks/auth-email-config.md`).
    expect(
      resolveConfirmedEmail({
        is_anonymous: false,
        email: 'old@example.com',
        new_email: 'new@example.com',
      }),
    ).toBeNull();
  });

  it('treats a missing email as unconfirmed', () => {
    expect(resolveConfirmedEmail({ is_anonymous: false })).toBeNull();
  });
});

describe('resetToAnonymousProfile', () => {
  it('clears the profile and resets progress, keeping the injected seed', () => {
    const patch = resetToAnonymousProfile(777);
    expect(patch.profile).toEqual({ userId: null, nickname: null, nation: null, email: null });
    expect(patch.pet).toEqual({ speciesId: null, seed: 777 });
    expect(patch.progress.stage).toBe('egg');
    expect(patch.streak).toEqual({ streakDays: 0, lastActiveDay: null });
  });
});

/** Matches how @supabase/auth-js actually throws: a real Error with a `.code` property attached. */
function authError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeAuthError', () => {
  it('maps known Supabase Auth error codes to short user-facing strings', () => {
    expect(describeAuthError(authError('email_exists'))).toMatch(/already linked/i);
    expect(describeAuthError(authError('identity_already_exists'))).toMatch(/already linked/i);
    expect(describeAuthError(authError('otp_expired'))).toMatch(/invalid or has expired/i);
    expect(describeAuthError(authError('over_email_send_rate_limit'))).toMatch(
      /too many attempts/i,
    );
    expect(describeAuthError(authError('over_request_rate_limit'))).toMatch(/too many attempts/i);
    expect(describeAuthError(authError('email_address_invalid'))).toMatch(/can't be used/i);
    expect(describeAuthError(authError('anonymous_provider_disabled'))).toMatch(/unavailable/i);
  });

  it('falls back to the raw error message for unknown codes or plain errors', () => {
    expect(describeAuthError(new Error('boom'))).toBe('boom');
    expect(describeAuthError(authError('some_future_code', 'a new kind of failure'))).toBe(
      'a new kind of failure',
    );
  });

  it('stringifies a non-Error value as a last resort', () => {
    expect(describeAuthError('plain string failure')).toBe('plain string failure');
  });
});
