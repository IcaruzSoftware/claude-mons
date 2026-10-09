---
doc_type: reference
purpose: "Read this when deploying the backend, debugging database issues, or contributing to Edge Functions."
audience: agent
last_verified: 2026-10-09
last_verified_commit: 64b6667
related_files:
  - supabase/migrations/20260904000000_init.sql
  - supabase/migrations/20261009000000_apply_xp_per_day_and_concurrency.sql
  - supabase/tests/apply-xp.sql
  - supabase/migrations/20261009010000_win_streak_rivals_only.sql
  - supabase/tests/win-streak.sql
  - supabase/migrations/20260913020000_progression_phase_a.sql
  - supabase/migrations/20260913050000_nations_exclude_orphan_battles.sql
  - supabase/config.toml
  - supabase/functions/heartbeat/index.ts
  - supabase/functions/create-profile/index.ts
  - supabase/functions/ingest-xp/index.ts
  - supabase/functions/battle-request/index.ts
  - supabase/functions/set-loadout/index.ts
  - packages/shared/src/game/levels.ts
  - packages/shared/src/game/species.ts
  - packages/shared/src/game/progression.ts
  - packages/shared/src/game/tree.ts
  - scripts/supabase-auth-config.mjs
  - docs/runbooks/auth-email-config.md
  - docs/design/talent-tree.md
---

# claude-mons backend (Supabase)

Postgres schema, RLS, security-definer RPCs and five Deno Edge Functions. Game math is not
duplicated here: the functions import `packages/shared` through the copy in
`supabase/functions/_shared/game/` (gitignored, produced by `pnpm sync:shared`). The only
duplicated pieces are the level/stage/stat formulas and the species table inside
`supabase/migrations/20260904000000_init.sql`, so SQL can recompute a mon without a round trip; keep them in
sync with `packages/shared/src/game/levels.ts` and `packages/shared/src/game/species.ts`.

## Layout

```
supabase/
  config.toml                             CLI config (anonymous sign-ins on, per-function verify_jwt)
  migrations/                             applied in filename-timestamp order — see Migrations below
  tests/                                  hand-run SQL tests for disposable databases (fair-matchmaking.sql, apply-xp.sql, win-streak.sql)
  functions/
    deno.json                             import map (@supabase/supabase-js)
    _shared/                              auth.ts db.ts http.ts loadout.ts monState.ts pipeline.ts queries.ts random.ts
    _shared/pipeline.test.ts              deno test for the pure XP pipeline
    _shared/loadout.test.ts               deno test for saved-tree normalization before battles
    _shared/monState.test.ts              deno test for the normalized loadout and treeLegacyReset
    ingest-xp/credit.test.ts              deno test for ingest-xp's load -> pipeline -> apply_xp retry loop
    _shared/game/                         generated, gitignored copy of packages/shared/src, made by `pnpm sync:shared` (do not edit; mirrors packages/shared/README.md 1:1)
    heartbeat/  create-profile/  ingest-xp/  battle-request/  set-loadout/
```

## Migrations

Applied in filename-timestamp order by `npx supabase db push` / `npx supabase db reset`; the schema, RLS, views and RPCs referenced elsewhere in this doc are the result of applying all of them.

| Migration | What it does |
|---|---|
| `supabase/migrations/20260904000000_init.sql` | Initial schema: enums, tables, RLS policies, the three leaderboard views, and the security-definer RPCs (`apply_xp`, `recompute_mon`, `pick_opponent`, `settle_battle`, `claim_battle_slot`, `touch_player`, `prune_ephemeral`, `roll_species`, `level_from_xp`, `stage_for_level`) |
| `supabase/migrations/20260913000000_suspicion_and_nations_filter.sql` | Filters `leaderboard_nations`'s weekly-XP CTE by `suspicion < 10` (parity with the other two leaderboards); makes `apply_xp` decay `players.suspicion` by 1 (floor 0) whenever a batch activates a new day |
| `supabase/migrations/20260913010000_battle_limits.sql` | `claim_battle_slot`: challenge cooldown 5 min → 10 min, daily challenge cap 10 → 50 |
| `supabase/migrations/20260913020000_progression_phase_a.sql` | Adds `mons.loadout`/`win_streak`/`last_respec_at` and `battles.protocol_version`; `recompute_mon` gains an evolution-stage stat multiplier (baby/teen/adult ×1.00/1.15/1.30); `pick_opponent` takes explicit min/max level bounds for asymmetric widening matchmaking windows; `settle_battle` applies a win-streak XP multiplier |
| `supabase/migrations/20260913030000_progression_tuning.sql` | Retunes `recompute_mon`'s evolution-stage multiplier from 1.15/1.30 to 1.03/1.06 — the balance harness found the wider gap won stage-boundary matchups only ~27-28% of the time for the low-level side |
| `supabase/migrations/20260913040000_progression_phase_b.sql` | Docs-only: updates the `mons.loadout` column comment now that `moves` is settable via `set-loadout` (Phase B); deliberately no schema change and no backfill — a mon with no stored `moves` battles with `defaultLoadoutMoveIds(species, level)`, recomputed fresh every battle |
| `supabase/migrations/20260913050000_nations_exclude_orphan_battles.sql` | Redefines `leaderboard_nations` so nation battle-win/loss tallies only count battles whose `challenger_id` still exists (a deleted account's snapshot previously kept inflating that nation's tally) and only credit the defender side when `opponent_id` is a real player (Wild Mons have `opponent_id` null) |
| `supabase/migrations/20260924052834_nations_alltime_battles.sql` | Appends all-time `battles_won`/`battles_lost` columns to `leaderboard_nations` (same orphan-battle and defender-side rules as the weekly tallies, without the week filter); the weekly CTE and every previously exposed column are unchanged |
| `supabase/migrations/20261009000000_apply_xp_per_day_and_concurrency.sql` | Replaces `apply_xp`: books each minute's work XP to its own UTC day in `xp_daily`; records `p_deltas.batch_id` in `ingest_batches` inside its own transaction (a known id returns `duplicate`); returns `conflict` without writing when `mons.work_xp` differs from `p_deltas.expect_work_xp`; pays a day's bonus only when `last_active_day` is before that day. Deploy it before the `ingest-xp` that sends `batch_id` |
| `supabase/migrations/20261009010000_win_streak_rivals_only.sql` | Replaces `settle_battle`: `mons.win_streak` counts only Rival wins (+1 and multiplied), a Rival loss resets it to 0, and NPC battles (`opponent_id` null) leave it unchanged and are paid without the multiplier |

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
| `species_base_stats` | `species_id` (PK) | 9 species (Water has a second rare one); hp/atk/def/spd base stats; seeded order for rarity rolls |
| `mons` | `id` (PK), `player_id` (UQ FK) | One per player; egg until `HATCH_XP`, then rolls species; stage/level derived from total_xp; `loadout` jsonb (`{ stance?, moves?, tree? }`; all three settable via `set-loadout` — see `docs/design/progression.md`, `docs/design/talent-tree.md` for `tree`), `win_streak` int (consecutive real-player wins), `last_respec_at` (stamped on a genuine respec at or above level 10 — `docs/design/talent-tree.md` Respec) |
| `xp_daily` | `player_id`, `day` (PK) | Per-UTC-day counters: work/bonus/battle XP, prompts, stops, battles_started/_defended |
| `xp_minutes` | `player_id`, `minute` (PK) | Per-minute credited XP for rolling caps; pruned after 48 h |
| `ingest_batches` | `batch_id` (PK) | Idempotency keys for ingest-xp; pruned after 48 h |
| `battles` | `id` (PK, = seed) | Challenger/opponent snapshots, winner, log, XP paid; opponent_id null = Wild Mon; `protocol_version` int = `BATTLE_PROTOCOL_VERSION` at simulation time |
| `battle_notifications` | `id` (PK) | Defenders notified of challenges; clients mark seen_at |

## Views

- `leaderboard_alltime` (security_invoker): ranks players by total_xp, excludes eggs and suspicion ≥10
- `leaderboard_weekly` (owned by postgres): ranks by this UTC week's work+bonus+battle XP
- `leaderboard_nations` (owned by postgres): aggregates members, XP, level, and both weekly and all-time battles per nation, excluding suspicion ≥10 players from every aggregated column (not just `total_xp`); battle-win/loss tallies (weekly `weekly_battles_won`/`weekly_battles_lost` and all-time `battles_won`/`battles_lost`) only count battles whose challenger still exists and only credit the defender side for real players (see `supabase/migrations/20260913050000_nations_exclude_orphan_battles.sql` and `supabase/migrations/20260924052834_nations_alltime_battles.sql` in Migrations)

## RLS policies

All tables have RLS enabled. Readable tables grant `select to authenticated`: `players`, `mons`, `species_base_stats`, `xp_daily`, `battles`, `battle_notifications`, and the three leaderboard views. `battle_notifications` grants `update (seen_at) to authenticated` on own rows only. No other writes allowed. Execute on RPCs revoked from `anon`/`authenticated`; granted to `service_role`.

## Edge Functions

| Function | JWT | Request → Response | Errors |
|---|---|---|---|
| `create-profile` | yes | `POST { nickname?, nation? }` → `CreateProfileResponse` (201 on create, 200 on rename) | 400 INVALID_NATION / NICKNAME_INVALID, 409 NICKNAME_TAKEN / NATION_LOCKED, 429 RENAME_COOLDOWN |
| `ingest-xp` | yes | `POST IngestXpRequest` (≤ 64 KB, ≤ 180 buckets) → `IngestXpResponse` | 400 BAD_REQUEST, 409 NO_PROFILE, 413 PAYLOAD_TOO_LARGE |
| `battle-request` | yes | `POST {}` → `BattleRequestResponse` (now carries `battle.isElite` and `mon.winStreak`) | 400 EGG_CANNOT_BATTLE, 409 NO_PROFILE, 429 COOLDOWN / DAILY_CAP |
| `set-loadout` | yes | `POST SetLoadoutRequest` (`{ stance?, moves?, tree?, respec? }` — `moves` is 3 distinct unlocked move ids, `tree` is `{ [nodeId]: rank }`, see `docs/design/talent-tree.md`) → `SetLoadoutResponse` | 400 BAD_REQUEST (`error.details.code`: `INVALID_STANCE`, `MOVES_COUNT`, `MOVES_NOT_DISTINCT`, `MOVE_UNKNOWN`, `MOVE_LOCKED`, `NO_SPECIES`, `TREE_UNKNOWN_NODE`, `TREE_RANK`, `TREE_PREREQ`, `TREE_OVER_BUDGET`, or `RESPEC_COOLDOWN`), 409 NO_PROFILE |
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

`sanitizeBucket()` (in `supabase/functions/ingest-xp/index.ts`) coerces untrusted client buckets to safe `MinuteBucket` objects: floors minute to 60s granularity, drops non-positive counts, and rejects tool names >128 chars. The pure `runIngestPipeline()` (in `supabase/functions/_shared/pipeline.ts`) applies per-minute and daily caps and returns `out.suspicious`: true only when a batch claimed at least `SUSPICION_MIN_CLAIMED_XP` (100) XP *and* more than half of it was dropped for a non-cap reason (`stale`/`future`/`implausible`/`no_prompt_context`) — cap drops (`cap_minute`/`cap_hour`/`cap_day`) never count, since they are the normal shape of a heavy legitimate day. `ingest-xp` increments `players.suspicion` only when `out.suspicious`; `apply_xp` decays it by 1 (floor 0) every time a batch activates a new day. Players with suspicion ≥10 are hidden from leaderboards and excluded from opponent matchmaking. See `docs/design/backend-rules.md` for the full reasoning.

## Matchmaking, Wild Mons and streaks

`battle-request` searches the shared level bands `[-3,-2]`, `[-1,-1]`, `[0,0]`, `[+1,+3]`.
It excludes humans fought within 24 hours. If none qualifies, or the candidate repeats the
previous opponent's element, it uses `wildMon()` from another element. Online and offline Wild
Mons are 90% weaker and 10% stronger (at most +3 levels), with rewards based on the actual level
difference. See `docs/design/progression.md` Matchmaking and streaks.

Win streaks: `mons.win_streak` is +1 per Rival win and reset to 0 on a Rival loss; NPC (Wild or
Trainer) battles leave it unchanged. For a Rival win `settle_battle` multiplies the challenger's XP
by `1 + 0.10 * min(new_streak, 5)`; NPC battles are paid unmultiplied. It returns the actual amount paid as
`challenger_xp_paid`, which is what `battle-request` reports in `reward.xp` — the pre-multiplier
value computed in TypeScript is never what's actually credited or returned once a streak is active.

## Environment

The functions only use the variables Supabase injects (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). No secrets to configure. Note: `supabase/functions/deno.json` declares `"@supabase/supabase-js": "npm:@supabase/supabase-js@2"` using the `npm:` scheme; the deploy bundler ignores the import map and uses this direct specifier.

## Deploy

Credentials live in `.env.local` (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`). Source them into the shell first; never print them.

```bash
set -a; . ./.env.local; set +a
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push                        # applies supabase/migrations/*
pnpm sync:shared                            # refresh functions/_shared/game
npx supabase functions deploy               # deploys all; honours per-function verify_jwt in config.toml
```

Auth settings are never pushed from `config.toml`; they are managed by `scripts/supabase-auth-config.mjs`, see `docs/runbooks/auth-email-config.md`.

The GitHub workflow `.github/workflows/supabase-deploy.yml` runs these steps on manual dispatch. `.github/workflows/keepalive.yml` pings `heartbeat` daily at 06:00 UTC.

## Auth config (account linking)

Optional email account linking (`docs/decisions/0016-email-otp-account-linking.md`) needs project
auth settings beyond the CLI-managed `config.toml`: `site_url`, `external_email_enabled`,
`security_manual_linking_enabled`, `mailer_autoconfirm`, and the Magic Link / Email Change templates
(`{{ .Token }}` for the 6-digit code). `scripts/supabase-auth-config.mjs` applies these through the
Management API; see `docs/runbooks/auth-email-config.md` for the exact keys, why each one matters,
and the free-tier template-editing limitation.

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
- `cd supabase/functions && deno test --allow-read _shared/ ingest-xp/credit.test.ts`.
- SQL tests in `supabase/tests` run only by hand in an empty disposable database:
  `psql -v ON_ERROR_STOP=1 -f supabase/tests/apply-xp.sql` (likewise `supabase/tests/win-streak.sql`).
- CI runs only `pnpm deno:check`; the Deno tests in `supabase/functions/_shared` and `supabase/functions/ingest-xp/credit.test.ts` are run by hand.
- `pnpm lint` also lints the function sources.
