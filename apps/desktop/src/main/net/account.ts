/**
 * Pure helpers for account linking (see `docs/architecture/flows/account-linking.md`): email format
 * validation and the two state transforms (adopt a server profile on sign-in, reset to a fresh
 * anonymous profile on sign-out). Kept free of Electron/Supabase so they are unit-testable without
 * either — `apps/desktop/src/main/App.ts` is what wires them to `SupabaseClient`/`GameService`.
 */
import type { User } from '@supabase/supabase-js';
import type { CreateProfileResponse } from '@claude-mons/shared';
import type { LocalState } from '../persistence/state.ts';

/** Same shape the panel uses for an inline format check before ever calling the server. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailFormat(email: string): boolean {
  return EMAIL_RE.test(email.trim()) && email.trim().length <= 254;
}

/**
 * The confirmed linked email for a Supabase Auth user, or null while still anonymous, or while an
 * email-change is still awaiting confirmation. Backs `SupabaseClient.refreshLinkedEmail` — the
 * fallback for the free-tier default mailer's confirmation-*link* email (no 6-digit code,
 * `docs/runbooks/auth-email-config.md`): once the player clicks that link, GoTrue confirms the
 * change and flips `is_anonymous` to false server-side, but a stale/cached user object can still
 * carry a pending `new_email` — that pending value must never be surfaced as if it were already
 * confirmed, so `email` is only trusted once `new_email` is gone.
 */
export function resolveConfirmedEmail(
  user: Pick<User, 'email' | 'is_anonymous' | 'new_email'> | null | undefined,
): string | null {
  if (!user || user.is_anonymous) return null;
  if (user.new_email) return null;
  return user.email ?? null;
}

/** The subset of `LocalState` an adopt/sign-out replaces; everything else (device, settings, hooks, UI, water, behavior) is left untouched. */
export type ProfileReplacement = Pick<
  LocalState,
  'profile' | 'pet' | 'progress' | 'ledger' | 'streak' | 'bonusXp' | 'battleXp' | 'battles'
>;

/**
 * Builds the local-state patch for adopting a server profile after a successful sign-in on this
 * device (`SupabaseClient.verifySignInCode`). Starts progress/pet/ledger from scratch so
 * `GameService.applyServerState` (called by the caller right after this patch is applied) derives
 * stage/species/XP purely from the server's `MonState` rather than mixing in whatever this device's
 * previous local player had pending.
 */
export function buildAdoptedProfile(
  current: LocalState,
  res: CreateProfileResponse,
  email: string,
): ProfileReplacement {
  return {
    profile: {
      userId: res.player.id,
      nickname: res.player.nickname,
      nation: res.player.nation,
      email,
    },
    pet: { speciesId: null, seed: current.pet.seed },
    progress: { localXp: 0, serverXp: null, stage: 'egg', hatchedAt: null, evolvedAt: {} },
    ledger: { credited: [], pending: [], lastSyncAt: null, batchId: null },
    streak: { streakDays: res.mon.streakDays, lastActiveDay: null },
    bonusXp: 0,
    battleXp: 0,
    battles: { history: [], lastBattleAt: null, today: { day: '', count: 0 } },
  };
}

/**
 * Builds the local-state patch for "Sign out on this device" (`SupabaseClient.signOutToAnonymous`
 * clears the Supabase session separately). `newSeed` is injected by the caller
 * (`randomBytes(4).readUInt32LE(0)`, matching `defaultState()`) so this function stays pure — no
 * `Math.random`/`Date.now` in state-transform code, matching packages/shared's own rule.
 */
export function resetToAnonymousProfile(newSeed: number): ProfileReplacement {
  return {
    profile: { userId: null, nickname: null, nation: null, email: null },
    pet: { speciesId: null, seed: newSeed },
    progress: { localXp: 0, serverXp: null, stage: 'egg', hatchedAt: null, evolvedAt: {} },
    ledger: { credited: [], pending: [], lastSyncAt: null, batchId: null },
    streak: { streakDays: 0, lastActiveDay: null },
    bonusXp: 0,
    battleXp: 0,
    battles: { history: [], lastBattleAt: null, today: { day: '', count: 0 } },
  };
}
