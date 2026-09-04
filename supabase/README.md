# claude-mons backend (Supabase)

Postgres schema, RLS, security-definer RPCs and four Deno Edge Functions. Game math is not
duplicated here: the functions import `packages/shared` through the copy in
`supabase/functions/_shared/game/` (gitignored, produced by `pnpm sync:shared`). The only
duplicated pieces are the level/stage/stat formulas and the species table inside
`migrations/20260904000000_init.sql`, so SQL can recompute a mon without a round trip; keep them in
sync with `packages/shared/src/game/levels.ts` and `species.ts`.

## Layout

```
supabase/
  config.toml                      CLI config (anonymous sign-ins on, per-function verify_jwt)
  migrations/20260904000000_init.sql  schema, views, RLS, RPCs
  functions/
    deno.json                      import map (@supabase/supabase-js)
    _shared/                       auth.ts db.ts http.ts monState.ts pipeline.ts queries.ts random.ts
    _shared/pipeline.test.ts       deno test for the pure XP pipeline
    _shared/game/                  generated copy of packages/shared/src (do not edit)
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
  JWT (`_shared/auth.ts`) and then use the **service role** to call the RPCs below. Execute on the
  RPCs is revoked from `anon`/`authenticated`; only `service_role` (and the owner) can call them.
- `leaderboard_alltime` is `security_invoker` (it only joins publicly readable tables).
  `leaderboard_weekly` and `leaderboard_nations` aggregate every player's `xp_daily`/`battles`,
  which clients cannot read row by row, so they are plain views owned by `postgres` (evaluated with
  the owner's privileges) and expose aggregated columns only.
- Battles are deterministic: `battles.id` is the seed, both snapshots are stored, and the client
  replays `simulateBattle(a, b, id)` from `packages/shared`.

## RPCs (all `security definer`, `set search_path = public, extensions`)

| Function | Called by | Purpose |
|---|---|---|
| `apply_xp(p_player uuid, p_deltas jsonb, p_species_roll float8) -> jsonb` | ingest-xp | Upserts `xp_minutes`/`xp_daily`, updates streak, adds XP to the mon, recomputes level/stage/stats, rolls the species at 100 XP (roll supplied by the function, `crypto.getRandomValues`). Returns `{ mon, hatched, level_before, level_after, stage_before, stage_after }`. |
| `claim_battle_slot(p_player uuid) -> jsonb` | battle-request | Atomic: egg check, 5 min cooldown, 10 challenges/UTC day; increments `battles_started`. `{ ok, mon }` or `{ ok: false, reason: egg \| cooldown \| daily_cap \| no_mon, cooldown_until? }`. |
| `pick_opponent(p_player, p_nation, p_level, p_window int\|null, p_exclude_recent bool) -> setof row` | battle-request | Random other-nation opponent within `±p_window` levels (null = any), active in 30 days, suspicion < 10, not the last opponent, optionally not fought in 24 h. |
| `settle_battle(p jsonb) -> jsonb` | battle-request | Inserts the battle, credits challenger XP, credits defender XP for the first 10 defenses/day, notifies the defender, recomputes both mons. |
| `prune_ephemeral() -> int` | heartbeat | Deletes `xp_minutes` and `ingest_batches` older than 48 h. |
| `touch_player(p_player uuid)` | create-profile | `last_seen_at = now()` (apply_xp does this itself). |
| `recompute_mon(p_mon_id, p_species_roll default null) -> mons` | internal | Shared by apply_xp / settle_battle. |
| `roll_species`, `level_from_xp`, `stage_for_level` | internal | Mirrors of `rollSpecies`, `levelFromXp`, `stageForLevel`. |

## Edge Functions

| Function | JWT | Request → Response | Errors |
|---|---|---|---|
| `create-profile` | yes | `POST { nickname?, nation? }` → `CreateProfileResponse` (201 on create, 200 on rename) | 400 INVALID_NATION / NICKNAME_INVALID, 409 NICKNAME_TAKEN / NATION_LOCKED, 429 RENAME_COOLDOWN |
| `ingest-xp` | yes | `POST IngestXpRequest` (≤ 64 KB, ≤ 180 buckets) → `IngestXpResponse` | 400 BAD_REQUEST, 409 NO_PROFILE, 413 PAYLOAD_TOO_LARGE |
| `battle-request` | yes | `POST {}` → `BattleRequestResponse` | 400 EGG_CANNOT_BATTLE, 409 NO_PROFILE, 429 COOLDOWN `{ cooldownUntil }` / DAILY_CAP |
| `heartbeat` | **no** | `GET` → `{ ok, pruned, players, ts }` | |

All error bodies are `{ error: { code, message, details? } }` (`ApiError` in `packages/shared/src/api.ts`).
Unauthenticated calls to the JWT functions return 401 UNAUTHORIZED.

Environment: the functions only use the variables Supabase injects (`SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). No secrets to configure.

## Deploy (from this machine)

Credentials live in `.env.local` (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
`SUPABASE_PROJECT_REF`). Source them into the shell first; never print them.

```bash
set -a; . ./.env.local; set +a
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push                        # applies supabase/migrations/*
npx supabase config push                    # enables anonymous sign-ins from config.toml
pnpm sync:shared                            # refresh functions/_shared/game
npx supabase functions deploy heartbeat --no-verify-jwt
npx supabase functions deploy create-profile ingest-xp battle-request
```

`npx supabase functions deploy` without names deploys everything and honours the per-function
`verify_jwt` in `config.toml`, so the two deploy lines can be collapsed into one. The GitHub
workflow `.github/workflows/supabase-deploy.yml` runs the same steps on manual dispatch;
`.github/workflows/keepalive.yml` pings `heartbeat` daily at 06:00 UTC.

## Local development

Requires Docker.

```bash
npx supabase start                          # Postgres + Auth + PostgREST + Studio on 5432x
npx supabase db reset                       # applies the migration from scratch
pnpm sync:shared && npx supabase functions serve --no-verify-jwt
deno test --allow-read supabase/functions/_shared/pipeline.test.ts
npx supabase stop
```

`supabase status` prints the local anon/service keys; the desktop app can be pointed at
`http://127.0.0.1:54321`.

## Checks

- `pnpm deno:check` syncs shared and type-checks every function under Deno.
- `cd supabase/functions && deno test --allow-read _shared/pipeline.test.ts`.
- `pnpm lint` also lints the function sources (the `Deno` global is declared in the ESLint config).
