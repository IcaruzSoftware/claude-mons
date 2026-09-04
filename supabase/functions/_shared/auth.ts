// Resolves the calling user from the `Authorization: Bearer <jwt>` header.
//
// The functions are deployed with verify_jwt = true, so the gateway already rejected requests with
// an invalid signature; we still ask GoTrue for the user so revoked sessions and anon-key-only calls
// (which carry a valid but user-less JWT) are turned into a 401 rather than acting as nobody.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { anonKey, supabaseUrl } from './db.ts';
import { HttpError, error } from './http.ts';

export interface AuthedUser {
  uid: string;
  /** true for anonymous-auth users (the normal case for claude-mons) */
  anonymous: boolean;
}

export async function requireUser(req: Request): Promise<AuthedUser> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new HttpError(error('UNAUTHORIZED', 'missing bearer token', 401));
  const token = match[1]!.trim();

  const client = createClient(supabaseUrl(), anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error: authError } = await client.auth.getUser(token);
  if (authError || !data.user) {
    throw new HttpError(error('UNAUTHORIZED', 'invalid or expired session', 401));
  }
  return { uid: data.user.id, anonymous: data.user.is_anonymous === true };
}
