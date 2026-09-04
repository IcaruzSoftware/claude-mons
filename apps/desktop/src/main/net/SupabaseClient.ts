import { createClient, type SupabaseClient as Client, type Session } from '@supabase/supabase-js';
import type { ApiError } from '@claude-mons/shared';
import type { BackendConfig } from './config.ts';

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
