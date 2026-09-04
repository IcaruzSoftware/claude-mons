/**
 * Supabase project the app talks to. The anon key is public by design (it only grants what the
 * database's row-level security allows); all writes go through Edge Functions.
 * Override for local development with CLAUDE_MONS_SUPABASE_URL / CLAUDE_MONS_SUPABASE_ANON_KEY
 * (e.g. `supabase start` prints local values), or disable the backend with
 * CLAUDE_MONS_OFFLINE=1.
 */
export interface BackendConfig {
  url: string;
  anonKey: string;
}

const DEFAULT: BackendConfig = {
  url: 'https://dbeotjfprckdrymmpexv.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiZW90amZwcmNrZHJ5bW1wZXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0Njg3NTAsImV4cCI6MjEwNDA0NDc1MH0.Wa7R9af6s7HNtVmNNLMIH4GwtpsuYD6AiQl1-fRUIJ8',
};

export function backendConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig | null {
  if (env.CLAUDE_MONS_OFFLINE === '1') return null;
  const url = env.CLAUDE_MONS_SUPABASE_URL || DEFAULT.url;
  const anonKey = env.CLAUDE_MONS_SUPABASE_ANON_KEY || DEFAULT.anonKey;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
