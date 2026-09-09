import {
  createClient,
  type SupabaseClient as Client,
  type EmailOtpType,
  type Session,
} from '@supabase/supabase-js';
import type { ApiError } from '@claude-mons/shared';
import type { AccountOpResult } from '../../common/ipc.ts';
import type { BackendConfig } from './config.ts';

const DEBUG = process.env.CLAUDE_MONS_DEBUG === '1';

/** Result of an account-linking call: `error` is a short, user-facing string, null on success. */
export type AccountResult = AccountOpResult;

/**
 * Maps a raw Supabase Auth error to a short, user-facing string. Codes come from
 * `@supabase/auth-js`'s `ErrorCode` union (`node_modules/@supabase/auth-js/src/lib/error-codes.ts`).
 */
export function describeAuthError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'email_exists':
    case 'identity_already_exists':
      return 'That email is already linked to another account.';
    case 'otp_expired':
      return 'That code is invalid or has expired. Request a new one.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts — wait a few minutes and try again.';
    case 'email_address_invalid':
    case 'email_address_not_authorized':
      return "That email address can't be used.";
    case 'anonymous_provider_disabled':
      return 'Account linking is temporarily unavailable.';
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

/** Thrown for non-2xx Edge Function responses, carrying the server's error code. */
export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

export interface SessionStorage {
  load(): string | null;
  save(value: string | null): void;
}

/**
 * Thin wrapper around supabase-js for the main process: anonymous auth with the session persisted
 * in our own JSON store, and typed Edge Function calls.
 */
export class SupabaseClient {
  readonly client: Client;
  private userId: string | null = null;

  constructor(
    readonly config: BackendConfig,
    storage: SessionStorage,
  ) {
    this.client = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: {
          getItem: (_key: string) => storage.load(),
          setItem: (_key: string, value: string) => storage.save(value),
          removeItem: (_key: string) => storage.save(null),
        },
      },
      global: { headers: { 'x-client-info': 'claude-mons-desktop' } },
    });
  }

  /** Returns the user id, signing in anonymously on first use. */
  async ensureSession(): Promise<string> {
    if (this.userId) return this.userId;
    const { data } = await this.client.auth.getSession();
    let session: Session | null = data.session;
    if (!session) {
      const res = await this.client.auth.signInAnonymously();
      if (res.error) throw res.error;
      session = res.data.session;
    }
    if (!session?.user) throw new Error('no session after anonymous sign-in');
    this.userId = session.user.id;
    return this.userId;
  }

  currentUserId(): string | null {
    return this.userId;
  }

  /** The linked email of the current session's user, or null while still anonymous / signed out. */
  async linkedEmail(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();
    const user = data.session?.user;
    if (!user || user.is_anonymous) return null;
    return user.email ?? null;
  }

  /**
   * Starts linking an email to the current (anonymous) account: `updateUser({ email })` sends a
   * 6-digit code to `email` via the "Email Change" template (see
   * `docs/runbooks/auth-email-config.md`). No password is ever set. Requires
   * `security_manual_linking_enabled` on the project (docs/runbooks/auth-email-config.md).
   */
  async linkEmail(email: string): Promise<AccountResult> {
    await this.ensureSession();
    const { error } = await this.client.auth.updateUser({ email });
    if (error) return { ok: false, error: describeAuthError(error) };
    return { ok: true, error: null };
  }

  /**
   * Verifies the 6-digit code sent by `linkEmail`. The anonymous user's auth id is unchanged by a
   * successful email link (see `docs/architecture/flows/account-linking.md`), so no local profile
   * fields need to change here — only `profile.email` (set by the caller).
   *
   * The correct `verifyOtp` type for this is `email_change` (confirmed against
   * `@supabase/auth-js`'s GoTrueClient docs: "`email_change` – Used when verifying an OTP sent to a
   * new email address during an email update process"). `signup`/`email` are tried as a fallback in
   * case a differently-configured project routes the anonymous conversion through the signup
   * confirmation template instead (see the runbook).
   */
  async verifyLinkCode(email: string, code: string): Promise<AccountResult> {
    return this.verifyWithFallback(email, code, ['email_change', 'signup', 'email']);
  }

  /** Requests a sign-in code for an *existing* linked account; never creates a new user. */
  async requestSignInCode(email: string): Promise<AccountResult> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) return { ok: false, error: describeAuthError(error) };
    return { ok: true, error: null };
  }

  /** Verifies a sign-in code from `requestSignInCode`; on success the session is that user's. */
  async verifySignInCode(email: string, code: string): Promise<AccountResult> {
    return this.verifyWithFallback(email, code, ['email']);
  }

  /** Signs out and clears the persisted session; the next `ensureSession()` starts fresh anonymous. */
  async signOutToAnonymous(): Promise<void> {
    await this.client.auth.signOut();
    this.userId = null;
  }

  private async verifyWithFallback(
    email: string,
    token: string,
    types: EmailOtpType[],
  ): Promise<AccountResult> {
    let lastError: unknown = null;
    for (const type of types) {
      const { data, error } = await this.client.auth.verifyOtp({ email, token, type });
      if (!error && data.session) {
        if (DEBUG) console.info(`[account] verifyOtp succeeded with type=${type}`);
        this.userId = data.session.user.id;
        return { ok: true, error: null };
      }
      lastError = error;
    }
    return { ok: false, error: describeAuthError(lastError) };
  }

  /** Calls an Edge Function; resolves with the JSON body or rejects with ApiCallError. */
  async invoke<T>(name: string, body: unknown, method: 'POST' | 'GET' = 'POST'): Promise<T> {
    await this.ensureSession();
    const { data: sessionData } = await this.client.auth.getSession();
    const token = sessionData.session?.access_token;
    const init: RequestInit = {
      method,
      headers: {
        'content-type': 'application/json',
        apikey: this.config.anonKey,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    };
    if (method === 'POST') init.body = JSON.stringify(body ?? {});
    const res = await fetch(`${this.config.url}/functions/v1/${name}`, init);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      const err = (json as ApiError | null)?.error;
      throw new ApiCallError(
        res.status,
        err?.code ?? `HTTP_${res.status}`,
        err?.message ?? text.slice(0, 200),
        err?.details,
      );
    }
    return json as T;
  }
}
