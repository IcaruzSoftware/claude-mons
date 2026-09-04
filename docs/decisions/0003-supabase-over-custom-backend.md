---
doc_type: decision
purpose: "Read this when asked why the backend is Supabase and not a self-hosted server."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - supabase/README.md
  - apps/desktop/src/main/net/SupabaseClient.ts
  - docs/history/v1-design-2026-09-04.md
adr_status: accepted
---

# Supabase over Custom Backend

## Context

claude-mons needs a small backend to hold authoritative XP/level state, run the deterministic
battle resolution, and serve a global leaderboard, without anyone but the owner running a server
around the clock. Two alternatives to a managed backend-as-a-service were considered:

- **A Hono/Node server on Fly.io** — full control over the HTTP layer and Postgres access, roughly
  5 USD/month, but it is the owner's process to keep patched, monitored and running; a solo side
  project has no one else to page.
- **Cloudflare Workers** — free at this scale and globally distributed, but pairs awkwardly with a
  relational schema (players, mons, per-minute XP caps, battle logs) and needs a separate managed
  Postgres (e.g. Neon) bolted on, splitting the backend across two vendors.
- **Supabase** — Postgres, Row Level Security, anonymous auth and Deno Edge Functions in one
  project. The owner already knew Supabase from prior work, which mattered for a project built in a
  single autonomous run.

## Decision

Use a single Supabase project (`supabase/README.md`) as the entire backend: Postgres schema and RLS
policies for reads, Deno Edge Functions with the service role for all writes, and Supabase Auth for
sessions. The desktop app talks to it through `apps/desktop/src/main/net/SupabaseClient.ts`.

## Consequences

- No server process for the owner to run, patch or restart; deploys are `supabase db push` /
  `functions deploy` from a CLI, not a fleet to keep alive.
- Free-tier limits now bound the game's scale: 500 MB database, 50k monthly active users, 500k
  function invocations, and Supabase pauses a project after 7 days with no API activity. The last
  constraint is why `.github/workflows/keepalive.yml` pings the `heartbeat` function daily — an
  operational dependency the project would not have with a self-run server.
- Vendor lock-in accepted: the schema, RLS model and Edge Function runtime (Deno, `npm:` specifiers)
  are Supabase-specific, and `packages/shared` is copied into `supabase/functions/_shared/game/`
  rather than published as a portable package, so moving off Supabase later means re-platforming the
  entire backend, not swapping a connection string.
- Two languages for backend logic: Edge Functions run on Deno while the desktop app runs on Node,
  which is why `packages/shared` is constrained to web-standard globals only (see
  `packages/shared/README.md`).

## Status

Accepted, 2026-09-04
