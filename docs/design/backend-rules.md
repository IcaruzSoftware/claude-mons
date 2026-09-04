---
doc_type: design
purpose: "Read this when you need to know why the Supabase backend rejects, clamps or flags a client's claimed activity."
audience: agent
last_verified: 2026-09-05
last_verified_commit: 6d99ae3
related_files:
  - supabase/functions/_shared/pipeline.ts
  - supabase/functions/ingest-xp/index.ts
  - supabase/functions/create-profile/index.ts
  - packages/shared/src/game/nickname.ts
  - packages/shared/src/game/xp.ts
  - supabase/migrations/20260904000000_init.sql
  - supabase/README.md
---

# Backend rules

## Trust model

The desktop client is not trusted. It signs in anonymously and holds an `authenticated` JWT, but
through PostgREST it may only **read**: `players`, `mons`, `species_base_stats` (all rows), its own
`xp_daily`/`battles`/`battle_notifications`, and the three leaderboard views. Its one write is
`update battle_notifications set seen_at` on its own rows (a column-level grant plus an RLS policy
requiring `player_id = auth.uid()`). No other insert/update/delete policy exists on any table, and
the default table privileges are also revoked from `anon`/`authenticated`, so a policy added by
mistake later still would not open a write path. `anon` (no session at all) can read nothing. See
`supabase/migrations/20260904000000_init.sql` (`row level security` section) and
`supabase/README.md` for the policy and grant list.

Everything the client's activity turns into XP, species, level or a battle result is instead
computed inside the four Edge Functions (`supabase/functions/{create-profile,ingest-xp,battle-request,heartbeat}/index.ts`),
which authenticate the caller with `requireUser` and then act through the service role, calling
`security definer` RPCs whose `execute` is revoked from `anon`/`authenticated` and granted only to
`service_role`. The client submits raw counts (prompts, stops, tool calls per minute); the server
decides how much of that is plausible and how much XP it is worth. Cap values themselves live in
`docs/design/economy.md` — this document is about why the server clamps, not the numbers it uses.

## Ingest plausibility clamps

`supabase/functions/ingest-xp/index.ts:sanitizeBucket` runs first, at the HTTP boundary, before any
bucket reaches the pipeline: it floors `minute` to a UTC minute, drops non-positive prompt/stop/tool
counts, drops tool names over 128 characters, and the request itself is capped at 64 KiB and 180
buckets (`MAX_BUCKETS`) so one batch cannot describe an implausible number of minutes.

`supabase/functions/_shared/pipeline.ts:runIngestPipeline` then hands each bucket to
`packages/shared/src/game/xp.ts:creditBucket`, the single place that decides what gets credited.
Every rejection is a `DropReason`, so the client sees why its claimed XP shrank rather than a silent
partial credit:

| `DropReason` | What triggers it |
|---|---|
| `stale` | bucket minute is older than `CAPS.staleMs` relative to server time |
| `future` | bucket minute is more than `CAPS.futureMs` ahead of server time |
| `implausible` | prompts/stops/tool count in the bucket exceeds the per-minute plausibility clamp (`CAPS.bucketMaxPrompts`, `CAPS.bucketMaxStops`, `CAPS.bucketMaxTools`) |
| `no_prompt_context` | tool calls with no prompt in the preceding `CAPS.promptContextMs` window (a tool call needs a prompt to have plausibly caused it) |
| `cap_minute` | remaining per-minute tool XP room (`CAPS.toolXpPerMinute`) is exhausted |
| `cap_hour` | rolling-hour prompt/stop/tool/work caps are exhausted |
| `cap_day` | UTC-day prompt/stop/tool/work caps are exhausted |

The exact clamp and cap values are `docs/design/economy.md`'s to state; the point of the table above
is the reasoning, not the numbers. `dropped` entries are merged by reason
(`supabase/functions/_shared/pipeline.ts:mergeDropped`) so a large batch's response stays small.

## Idempotent batches

Each `IngestXpRequest` carries a client-generated `batch_id` (UUID). `ingest-xp` inserts it into
`ingest_batches` before running the pipeline; a unique-violation (`23505`) means this batch was
already applied, and the function returns `duplicate: true` with zero awarded XP and HTTP 200 rather
than an error. This makes retries (a flaky connection, a client that resends after a timeout) safe:
replaying the same batch never credits XP twice. `ingest_batches` rows are pruned after 48 h by
`prune_ephemeral()` (called from `heartbeat`), which is why the window matters more than the count.

## Suspicion heuristic

After a batch is credited, `ingest-xp` compares the XP the client claimed (`out.claimedXp`, credited
XP plus everything dropped) against the XP actually dropped: if `out.claimedXp > 0` and
`droppedXp * 2 > out.claimedXp` — more than half the claimed XP was rejected — the player's
`players.suspicion` counter is incremented by one. This is a blunt, cheap signal: it does not try to
prove cheating, only that this batch looked implausible often enough to be worth counting.

The counter's only effect is exclusion, not punishment: `leaderboard_alltime`, `leaderboard_weekly`
and `leaderboard_nations` all filter `suspicion < 10`, and `pick_opponent` excludes players with
`suspicion >= 10` from matchmaking. A flagged player keeps playing normally — hatching, leveling,
battling — they just stop appearing on leaderboards or as an opponent once the counter reaches 10.
Nothing currently lowers `suspicion` once raised.

## Server-side species roll

A mon hatches (rolls a species) the first time its `total_xp` reaches `HATCH_XP` while
`species_id` is still null (`apply_xp` in `supabase/migrations/20260904000000_init.sql`, guarded by
`roll_species`). The roll itself is a `[0, 1)` double from `crypto.getRandomValues`
(`supabase/functions/_shared/random.ts:randomUnit`), generated inside the Edge Function and passed
as `p_species_roll` into the `security definer` RPC — the client never supplies, previews or
influences the roll, and `roll_species`'s `execute` privilege is revoked from `authenticated`, so
there is no path for a client to invoke it directly and search for a favorable rare species.

## Nickname policy

`packages/shared/src/game/nickname.ts` is authoritative and Deno-compatible, so the same rules run
client-side (instant feedback) and inside `create-profile` (enforcement):

- Format: `NICKNAME_RE` = `^[A-Za-z0-9_]{3,16}$`, mirrored by the `players.nickname` CHECK
  constraint in the migration.
- Reserved (exact, case-normalized match; whole token, not substring): `admin`, `claude`,
  `anthropic`, `wild`, `system`, `mod`, `staff`, `moderator`, `support` — plus anything starting with
  `wild`, since that prefix is reserved for the Wild Mon bot's display name.
- Blocklist: `validateNickname` checks whole tokens (the full name, each `_`-separated part, each
  camelCase part) after `normalizeForBlocklist` undoes common leetspeak and strips underscores, then
  matches them against `BLOCKLIST`, an English profanity/slur list, exactly or as a prefix/suffix for
  words of 4+ letters (3-letter entries like `ass`/`sex`/`cum` must match exactly, so `classic` and
  `essex` pass). The list is deliberately short: a false positive blocking a legitimate name is worse
  than a missed word, since nicknames only ever appear on a leaderboard.
- Rename cooldown: `create-profile` allows one nickname change per 7 days
  (`RENAME_COOLDOWN_MS`), measured from `players.nickname_changed_at`; a request inside the window
  gets `429 RENAME_COOLDOWN` with `details.nextAllowedAt`.

## Nation lock

A player's `nation` is set once, on the first `create-profile` call (which also creates the row and
the egg `mons` row), and is immutable after that: any later call whose `nation` differs from the
stored one gets `409 NATION_LOCKED`. There is no server path to change it in v1.

## What is deliberately not protected

The server can clamp implausible *rates* of activity, but it cannot verify that the prompts, stops
and tool calls a batch claims actually happened — it only bounds how much any one minute, hour or day
is worth. A client that fabricates a steady, human-plausible stream of counts (never tripping a
per-minute clamp, never exceeding the hourly/daily caps) is credited as if it were real work; nothing
in `runIngestPipeline` distinguishes a plausible fake day from a real one. This is accepted because
the caps already bound the worst case to one real day's worth of XP regardless, the reward is a
single-player cosmetic pet (no economy or stakes to protect beyond the leaderboard), and the
suspicion heuristic still catches the sloppier, high-volume version of the same cheat — a
well-behaved fake is deliberately the cheapest way to cheat this game, not a gap someone overlooked.
