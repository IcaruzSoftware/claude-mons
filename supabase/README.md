---
doc_type: reference
purpose: "Read this when deploying the backend, debugging database issues, or contributing to Edge Functions."
audience: agent
last_verified: 2026-09-05
last_verified_commit: 74a76ce
related_files:
  - supabase/migrations/20260904000000_init.sql
  - supabase/config.toml
  - supabase/functions/heartbeat/index.ts
  - supabase/functions/create-profile/index.ts
  - supabase/functions/ingest-xp/index.ts
  - supabase/functions/battle-request/index.ts
  - packages/shared/src/game/levels.ts
  - packages/shared/src/game/species.ts
---

# claude-mons backend (Supabase)

Postgres schema, RLS, security-definer RPCs and four Deno Edge Functions. Game math is not
duplicated here: the functions import `packages/shared` through the copy in
`supabase/functions/_shared/game/` (gitignored, produced by `pnpm sync:shared`). The only
duplicated pieces are the level/stage/stat formulas and the species table inside
`supabase/migrations/20260904000000_init.sql`, so SQL can recompute a mon without a round trip; keep them in
sync with `packages/shared/src/game/levels.ts` and `packages/shared/src/game/species.ts`.

## Layout

```
supabase/
  config.toml                             CLI config (anonymous sign-ins on, per-function verify_jwt)
  migrations/20260904000000_init.sql      schema, views, RLS, RPCs
  functions/
    deno.json                             import map (@supabase/supabase-js)
    _shared/                              auth.ts db.ts http.ts monState.ts pipeline.ts queries.ts random.ts
    _shared/pipeline.test.ts              deno test for the pure XP pipeline
    _shared/game/                         generated copy of packages/shared/src (do not edit)
    heartbeat/  create-profile/  ingest-xp/  battle-request/
```

## Trust model

- Clients sign in anonymously and receive an `authenticated` JWT. Through PostgREST they may only
  **read**: `players`, `mons`, `species_base_stats` (all rows), their own `xp_daily`, `battles`
  and `battle_notifications`, and the three leaderboard views. The single client write is
  `update battle_notifications set seen_at` on their own rows (column-level grant + RLS policy).
- There are no insert/update/delete policies anywhere else and the default table privileges are
  revoked from `anon`/`authenticated`, so nothing else is writable even if a policy is added later
  by mistake. `anon` (no session) can read nothing.
- All writes happen in the Edge Functions. They verify the caller with the anon key + the caller's
  JWT (`supabase/functions/_shared/auth.ts`) and then use the **service role** to call the RPCs below. Execute on the
  RPCs is revoked from `anon`/`authenticated`; only `service_role` (and the owner) can call them.
- `leaderboard_alltime` is `security_invoker` (it only joins publicly readable tables).
  `leaderboard_weekly` and `leaderboard_nations` aggregate every player's `xp_daily`/`battles`,
  which clients cannot read row by row, so they are plain views owned by `postgres` and expose
  aggregated columns only.
- Battles are deterministic: `battles.id` is the seed, both snapshots are stored, and the client
  replays `simulateBattle(a, b, id)` from `packages/shared`.

## Tables

| Table | Key columns | Notes |
|---|---|---|
| `players` | `id` (PK, auth.users FK) | One per user; nickname citext; suspicion tracks XP drops (≥10 excludes from leaderboards) |
| `species_base_stats` | `species_id` (PK) | 8 species (1 per rarity per nation); hp/atk/def/spd base stats; seeded order for rarity rolls |
| `mons` | `id` (PK), `player_id` (UQ FK) | One per player; egg until 100 XP, then rolls species; stage/level derived from total_xp |
| `xp_daily` | `player_id`, `day` (PK) | Per-UTC-day counters: work/bonus/battle XP, prompts, stops, battles_started/_defended |
| `xp_minutes` | `player_id`, `minute` (PK) | Per-minute credited XP for rolling caps; pruned after 48 h |
| `ingest_batches` | `batch_id` (PK) | Idempotency keys for ingest-xp; pruned after 48 h |
| `battles` | `id` (PK, = seed) | Challenger/opponent snapshots, winner, log, XP paid; opponent_id null = Wild Mon |
| `battle_notifications` | `id` (PK) | Defenders notified of challenges; clients mark seen_at |

## Views

- `leaderboard_alltime` (security_invoker): ranks players by total_xp, excludes eggs and suspicion ≥10
- `leaderboard_weekly` (owned by postgres): ranks by this UTC week's work+bonus+battle XP
- `leaderboard_nations` (owned by postgres): aggregates members, XP, level, and weekly battles per nation

## RLS policies

All tables have RLS enabled. Readable tables grant `select to authenticated`: `players`, `mons`, `species_base_stats`, `xp_daily`, `battles`, `battle_notifications`, and the three leaderboard views. `battle_notifications` grants `update (seen_at) to authenticated` on own rows only. No other writes allowed. Execute on RPCs revoked from `anon`/`authenticated`; granted to `service_role`.

## Edge Functions

| Function | JWT | Request → Response | Errors |
|---|---|---|---|
| `create-profile` | yes | `POST { nickname?, nation? }` → `CreateProfileResponse` (201 on create, 200 on rename) | 400 INVALID_NATION / NICKNAME_INVALID, 409 NICKNAME_TAKEN / NATION_LOCKED, 429 RENAME_COOLDOWN |
| `ingest-xp` | yes | `POST IngestXpRequest` (≤ 64 KB, ≤ 180 buckets) → `IngestXpResponse` | 400 BAD_REQUEST, 409 NO_PROFILE, 413 PAYLOAD_TOO_LARGE |
| `battle-request` | yes | `POST {}` → `BattleRequestResponse` | 400 EGG_CANNOT_BATTLE, 409 NO_PROFILE, 429 COOLDOWN / DAILY_CAP |
| `heartbeat` | **no** | `GET` → `{ ok, pruned, players, ts }` | — |

All error bodies are `{ error: { code, message, details? } }` (`ApiError` in `packages/shared/src/api.ts`).

## Shared helpers

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/auth.ts` | `AuthedUser`, `requireUser` (verifies JWT via GoTrue anon key) |
| `supabase/functions/_shared/db.ts` | `ServiceClient`, `supabaseUrl()`, `anonKey()`, `serviceClient()`, `rpc<T>()`, row types, `utcDay` |
| `supabase/functions/_shared/http.ts` | `CORS_HEADERS`, `json()`, `error()`, `HttpError`, `preflight()`, `readJson()`, `serve()` |
| `supabase/functions/_shared/monState.ts` | `buildMonState` (construct response-ready mon object with battle cooldown) |
| `supabase/functions/_shared/pipeline.ts` | Pure `runIngestPipeline` (caps, bonuses, streak, XP crediting); deterministic, unit-tested |
| `supabase/functions/_shared/queries.ts` | `loadPlayer()`, `loadMon()`, `loadToday()`, `loadMonState()`, `loadNotifications()` |
| `supabase/functions/_shared/random.ts` | `randomUnit()`, `randomInt()` (never for battle outcomes; battles use the deterministic seed) |

## XP pipeline and suspicion

`sanitizeBucket()` (in `supabase/functions/ingest-xp/index.ts`) coerces untrusted client buckets to safe `MinuteBucket` objects: floors minute to 60s granularity, drops non-positive counts, and rejects tool names >128 chars. The pure `runIngestPipeline()` (in `supabase/functions/_shared/pipeline.ts`) applies per-minute and daily caps. When `ingest-xp` completes, if >50% of claimed XP was dropped (overages, repeats, or invalid tools), the player's `suspicion` is incremented. Players with suspicion ≥10 are hidden from leaderboards and excluded from opponent matchmaking.

## Matchmaking and Wild Mons

`battle-request` calls `findOpponent()` with `LEVEL_WINDOWS = [3, 6, 10, null]` for a first pass (exact ±3 levels preferred) before trying wider windows. Each window tries once excluding recent 24-h repeats, then again without the recency filter. If no opponent is found, the challenger faces `wildMon()`, a random species from a random other nation at `max(2, challenger_level)`, nicknamed `Wild <BabyName>`, with `playerId: null`. Wild Mons pay the challenger full XP but don't count toward nations' weekly battle records.

## Environment

The functions only use the variables Supabase injects (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). No secrets to configure. Note: `supabase/functions/deno.json` declares `"@supabase/supabase-js": "npm:@supabase/supabase-js@2"` using the `npm:` scheme; the deploy bundler ignores the import map and uses this direct specifier.

## Deploy

Credentials live in `.env.local` (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`). Source them into the shell first; never print them.

```bash
set -a; . ./.env.local; set +a
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push                        # applies supabase/migrations/*
npx supabase config push                    # enables anonymous sign-ins from config.toml
pnpm sync:shared                            # refresh functions/_shared/game
npx supabase functions deploy               # deploys all; honours per-function verify_jwt in config.toml
```

The GitHub workflow `.github/workflows/supabase-deploy.yml` runs these steps on manual dispatch. `.github/workflows/keepalive.yml` pings `heartbeat` daily at 06:00 UTC.

## Local development

Requires Docker.

```bash
npx supabase start                          # Postgres + Auth + PostgREST + Studio on 5432x
npx supabase db reset                       # applies the migration from scratch
pnpm sync:shared && npx supabase functions serve --no-verify-jwt
deno test --allow-read supabase/functions/_shared/pipeline.test.ts
npx supabase stop
```

`supabase status` prints the local anon/service keys; the desktop app can be pointed at `http://127.0.0.1:54321`.

## Checks

- `pnpm deno:check` syncs shared and type-checks every function under Deno.
- `cd supabase/functions && deno test --allow-read _shared/pipeline.test.ts`.
- `pnpm lint` also lints the function sources.
