---
doc_type: architecture
purpose: "Read this when tracing how a Claude Code hook event turns into pet animation and player XP, or debugging why an animation or an XP credit didn't happen."
audience: agent
last_verified: 2026-09-05
last_verified_commit: ab12392
related_files:
  - packages/hook-cli/main.go
  - apps/desktop/src/main/hooks/HookServer.ts
  - apps/desktop/src/main/hooks/rawHook.ts
  - apps/desktop/src/main/hooks/mode.ts
  - apps/desktop/src/main/hooks/SpoolDrainer.ts
  - apps/desktop/src/main/hooks/ActivityTracker.ts
  - apps/desktop/src/main/App.ts
  - apps/desktop/src/main/game/GameService.ts
  - apps/desktop/src/main/net/SyncQueue.ts
  - supabase/functions/ingest-xp/index.ts
  - supabase/functions/_shared/pipeline.ts
  - docs/decisions/0014-curl-script-mode-hook-fallback.md
---

# Hook event to XP flow

One Claude Code hook event has two independent destinations: it moves the pet on screen (animation-only,
local, immediate) and it may credit XP that eventually reaches the server (provisional locally, confirmed
async). Both start at the same envelope; this doc follows both paths end to end.

## Sequence

```mermaid
sequenceDiagram
    participant HookCLI as HookCLI (hook-cli)
    participant Curl as curl (script mode)
    participant HookServer
    participant SpoolDrainer
    participant App
    participant ActivityTracker
    participant PetHost
    participant PetLoop
    participant GameService
    participant SyncQueue
    participant IngestXp as ingest-xp
    participant ApplyXp as apply_xp

    Note over HookCLI,Curl: Claude Code fires a hook event; only one path runs, per the effective mode
    alt binary mode (mode.ts probe reported 'ok')
        HookCLI->>HookServer: POST /event (bearer token, fresh per app start)
        HookServer-->>HookCLI: 204 (before parsing body)
        HookServer->>App: onEvent(envelope)
        Note over HookCLI,SpoolDrainer: app unreachable -> spool to hook-spool.jsonl
        SpoolDrainer->>App: onEvent({...env, spooled:true}) (every 30s / at boot)
    else script mode (binary blocked/missing, or mode forced to 'script')
        Curl->>HookServer: POST /hook (X-Claude-Mons-Token header, raw hook JSON on stdin)
        HookServer-->>Curl: 204 (before parsing body)
        HookServer->>HookServer: rawHookToEnvelope(raw) -> same whitelist as buildEnvelope, or null
        HookServer->>App: onEvent(envelope)
        Note over Curl: app unreachable -> event is lost; script mode has no spool
    end
    App->>ActivityTracker: ingest(env)
    ActivityTracker-->>App: stimuli[]
    App->>PetHost: stimulate(s) (skipped when env.spooled)
    PetHost->>PetLoop: IPC petStimulus
    PetLoop->>PetLoop: push() -> stepBehavior() next rAF
    App->>GameService: ingest(env)
    GameService->>GameService: creditBucket() -> progress.localXp += credited
    GameService-->>App: emit progress / levelup / hatch / evolve
    App->>SyncQueue: scheduleSoon() (on Stop, 5s debounce)
    SyncQueue->>IngestXp: invoke('ingest-xp', {batch_id, buckets})
    IngestXp->>ApplyXp: rpc apply_xp(deltas, species_roll)
    ApplyXp-->>IngestXp: mon, hatched, level/stage before+after
    IngestXp-->>SyncQueue: IngestXpResponse (mon, events, notifications)
    SyncQueue->>App: emit synced
    App->>GameService: applyServerState(mon, localXpAtSend)
    GameService-->>App: emit hatch / levelup / evolve
    App->>PetHost: stimulate (celebration) / setStage
```

## Step by step

0. `App.start` decides which mode is effective before either path can run:
   `apps/desktop/src/main/hooks/mode.ts:probeBinary` spawns the installed binary
   (`--event SessionStart`, empty stdin, 3 s timeout) to check whether it can actually execute — a
   file can exist and still be refused at exec time (Windows Smart App Control). `computeEffectiveMode`
   combines that probe with the `LocalState.hooks.mode` preference (`auto` default, or a forced
   `binary`/`script`); `auto` only picks binary mode when the probe reported `'ok'`. See
   [ADR 0014](../../decisions/0014-curl-script-mode-hook-fallback.md) for why this fallback exists
   and why it has no spool.
1. **Binary mode:** Claude Code invokes the bundled hook binary. `packages/hook-cli/main.go:main`
   reads stdin (capped at 64 KiB), and `packages/hook-cli/main.go:buildEnvelope` keeps only the
   metadata whitelist (never prompt text, tool input/output, or transcript paths).
   **Script mode:** Claude Code instead invokes a `curl`/`curl.exe` command line (no third-party
   binary) that POSTs the raw hook JSON straight from stdin; see
   `apps/desktop/src/main/hooks/HookInstaller.ts:scriptCommand` for the exact flags and why it needs
   no quotes, pipes, or redirections.
2. `packages/hook-cli/main.go:deliver` reads `<home>/hook-endpoint.json` and POSTs the envelope to
   `http://127.0.0.1:<port>/event` with the bearer token from that file (binary mode only; the
   script command instead carries its own stable `X-Claude-Mons-Token` header and posts to
   `/hook`, both persisted in `LocalState.hooks`).
3. `apps/desktop/src/main/hooks/HookServer.ts` (private `handle`) checks method, path and the token
   for whichever route matched, then replies `204` **before** parsing the body, so the caller
   returns as fast as possible. `/event` bodies go straight to `parseHookEnvelope`; `/hook` bodies
   first go through `apps/desktop/src/main/hooks/rawHook.ts:rawHookToEnvelope` (mirrors
   `buildEnvelope`'s whitelist field-for-field, hashes `cwd` the same way, returns `null` for an
   unrecognized event) and only then to `parseHookEnvelope`. Either way the result reaches the
   `onEvent` callback wired in `apps/desktop/src/main/App.ts`
   (`new HookServer({ home, onEvent: (e) => this.onHookEvent(e), ... })`).
4. If binary-mode delivery fails (app not running, endpoint stale, timeout),
   `packages/hook-cli/main.go:spool` appends the envelope to `hook-spool.jsonl` instead.
   `apps/desktop/src/main/hooks/SpoolDrainer.ts:drain` renames and replays that file at boot and
   every interval (see table below), marking each envelope `spooled: true` so it is never
   double-counted. **Script mode has no equivalent**: a `curl` call the app was not listening for
   simply times out and the event is lost (see ADR 0014's Consequences).
5. Either path lands in `apps/desktop/src/main/App.ts:onHookEvent`, which fans the envelope out to
   `ActivityTracker.ingest` and `GameService.ingest`.
6. `apps/desktop/src/main/hooks/ActivityTracker.ts:ingest` collapses concurrent Claude Code sessions
   into stimuli (`hook:session_start|prompt|tool_start|tool_end|notification|stop|session_end`) plus a
   trailing `activity:update`. `App.onHookEvent` forwards these to `PetHost.stimulate` only when
   `!env.spooled` — a drained backlog must not replay old animations.
7. `PetHost.stimulate` sends `IPC.petStimulus` to the pet renderer. The preload's `onStimulus` feeds
   `apps/desktop/src/renderer/pet/loop.ts:push`; the next `requestAnimationFrame` tick runs the queued
   stimuli through the shared `stepBehavior` reducer and redraws via `PetRenderer`. This half of the
   flow never touches the network.
8. In parallel, `apps/desktop/src/main/game/GameService.ts:ingest` only acts on
   `UserPromptSubmit | PostToolUse | Stop`. It appends the event to the pending minute bucket and
   credits provisional XP via shared `creditBucket()`/`mergeCredited()` into `progress.localXp`
   (timestamp is the envelope's own `ts` field for spooled events, the local clock otherwise), then awards the daily bonus
   and streak once today's work XP crosses the threshold — see
   [economy.md](../../design/economy.md) for the XP formulas and caps themselves.
9. `apps/desktop/src/main/game/GameService.ts` (private `afterXpChange`) emits `levelup` / `hatch` / `evolve` / `progress`.
   `apps/desktop/src/main/App.ts:wireGameEvents` turns those into pet stimuli and, for hatch/evolve,
   a delayed `PetHost.setStage` call so the crack/evolve animation finishes first.
10. A `Stop` event also makes `App.onHookEvent` call `SyncQueue.scheduleSoon()`, which debounces then
    calls `flush`.
11. `apps/desktop/src/main/net/SyncQueue.ts:flush` takes up to the batch's bucket limit from
    `ledger.pending`, reuses or creates `ledger.batchId`, snapshots `localXpAtSend`, and calls
    `SupabaseClient.invoke('ingest-xp', ...)`.
12. `supabase/functions/ingest-xp/index.ts` authenticates the caller, inserts `batch_id` into
    `ingest_batches` for idempotency (a duplicate short-circuits with the current mon state), then runs
    the pure `supabase/functions/_shared/pipeline.ts:runIngestPipeline` — the same cap/bonus math as
    the client, so provisional XP normally matches — before persisting through the `apply_xp` RPC
    (`supabase/migrations/20260904000000_init.sql`). See
    [backend-rules.md](../../design/backend-rules.md) for the plausibility clamps and idempotency
    details.
13. The response's `events` (`hatched`/`level_up`/`evolved`/`streak`) and `mon` state come back through
    `SyncQueue` as a `synced` event. `apps/desktop/src/main/App.ts:startSync`'s handler calls
    `apps/desktop/src/main/game/GameService.ts:applyServerState`, which reconciles local vs. server XP (`provisionalSince`) and
    re-emits `hatch`/`levelup`/`evolve` if the server moved the stage further than the client knew.
14. Those events replay through `wireGameEvents` exactly as in step 9, producing the on-screen
    celebration; `apps/desktop/src/main/App.ts` (private `pushSnapshot`) refreshes the panel and hover card.

## Timings and limits

| What | Value | Where |
|---|---|---|
| HTTP reply before body parse | `204` before `parseHookEnvelope` | `apps/desktop/src/main/hooks/HookServer.ts` |
| Hook binary dial / total timeout | 150 ms / 400 ms | `packages/hook-cli/main.go` |
| Spool drain interval | 30 s (+ once at boot) | `apps/desktop/src/main/hooks/SpoolDrainer.ts` |
| Spool file cap | 5 MiB (further failures dropped) | `packages/hook-cli/main.go` |
| Sync debounce after `Stop` | 5 s | `apps/desktop/src/main/net/SyncQueue.ts` |
| Sync poll interval | 60 s (+2 s after start; ~5 min idle ping for notifications) | `apps/desktop/src/main/net/SyncQueue.ts` |
| Max buckets per batch | 180 (client and server agree) | `apps/desktop/src/main/net/SyncQueue.ts`, `supabase/functions/ingest-xp/index.ts` |
| Sync retry backoff | 5 s, doubling to 5 min cap | `apps/desktop/src/main/net/SyncQueue.ts` |
| Client pending-bucket horizon | 24 h | `apps/desktop/src/main/game/GameService.ts` |
| Client credited-minute horizon | 48 h | `apps/desktop/src/main/game/GameService.ts` |
| Server history window loaded per batch | 25 h | `supabase/functions/ingest-xp/index.ts` |
| Hatch / evolve animation delay before stage swap | 2500 ms / 2000 ms | `apps/desktop/src/main/App.ts` |
| Script command timeout | 2 s (`curl -m 2`) | `apps/desktop/src/main/hooks/HookInstaller.ts` |
| Binary probe timeout | 3 s | `apps/desktop/src/main/hooks/mode.ts` |
| Hook port fallback range | preferred port +1..+20, then random | `apps/desktop/src/main/hooks/HookServer.ts` |

Per-bucket and per-day XP caps live in [economy.md](../../design/economy.md); the plausibility clamps
applied at the ingest boundary live in [backend-rules.md](../../design/backend-rules.md).

## Failure paths

- **App closed or endpoint stale (binary mode)**: `deliver` fails, the hook binary spools instead of
  dropping the event; `SpoolDrainer` replays it later with `spooled: true` — XP is credited at its
  original timestamp, but no animation plays for it (step 6).
- **App closed or endpoint stale (script mode)**: the `curl` command simply times out after 2 s and
  exits non-zero; there is no spool, so the event is lost outright — see
  [ADR 0014](../../decisions/0014-curl-script-mode-hook-fallback.md).
- **`NO_PROFILE` (409 from `ingest-xp`)**: the player row is missing server-side; `SyncQueue.flush`
  clears `profile.userId`/`nickname` so the next flush recreates the profile via `ensureProfile` before
  retrying the batch.
- **Other 4xx, not 429**: `SyncQueue.flush` treats the batch itself as bad and clears `ledger.batchId`
  rather than retrying it forever; the event is logged, not retried.
- **429 (rate-limited), 5xx, or network error**: `SyncQueue.scheduleRetry` backs off exponentially
  (5 s → 5 min) and keeps the same `batchId`, so the identical batch is retried once reachable.
- **Malformed or unauthorized POST to either route**: `HookServer` answers `404` for a wrong
  path/method, a bad bearer token on `/event`, or a bad/missing `X-Claude-Mons-Token` on `/hook` —
  all made indistinguishable from each other on purpose.
- **Unrecognized `hook_event_name` on `/hook`**: `rawHookToEnvelope` returns `null` (logged at debug
  level); the request still gets its `204` and nothing reaches `onEvent`.

## Animation-only vs. XP-relevant

- `ActivityTracker.ingest` produces a stimulus for every `HookEventName` and always drives the pet
  renderer (when not spooled) — this is the animation path, and it never reaches `GameService` or the
  network.
- `GameService.ingest` only reacts to three event names: `UserPromptSubmit`, `PostToolUse`, `Stop`. All
  other hook events (`SessionStart`, `PreToolUse`, `Notification`, `SessionEnd`) are animation-only and
  carry no XP.
- A spooled envelope (`env.spooled === true`) is the mirror image: `App.onHookEvent` skips
  `PetHost.stimulate` for it entirely, but still calls `GameService.ingest` unconditionally — a backlog
  drain is XP-relevant but never animates.
