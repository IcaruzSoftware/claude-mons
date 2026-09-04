---
doc_type: architecture
purpose: "Read this when you need to know how provisional local XP is reconciled against the server, or why a stage/hatch/evolve event fired (or didn't)."
audience: agent
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - apps/desktop/src/main/game/GameService.ts
  - apps/desktop/src/main/net/SyncQueue.ts
  - apps/desktop/src/main/persistence/JsonStore.ts
  - apps/desktop/src/main/persistence/state.ts
  - apps/desktop/src/main/App.ts
  - supabase/functions/ingest-xp/index.ts
---

# Server reconciliation

The pet's XP bar has to update the instant a hook event fires, but only the server ultimately
decides what counted. This flow is how the client shows a number immediately (provisional) and
later folds in whatever the server actually credited (authoritative), without the bar ever jumping
backwards.

## Provisional vs authoritative XP

`apps/desktop/src/main/persistence/state.ts` defines `LocalState['progress']`, which holds the three
numbers this flow moves between:

| Field | Meaning |
|---|---|
| `localXp` | shown to the player; server-confirmed XP plus anything earned since the last sync |
| `serverXp` | the last totals the server acknowledged, or `null` before the first sync |
| `stage` | highest stage ever shown; see [Stage monotonicity](#stage-monotonicity) |

`apps/desktop/src/main/game/GameService.ts:ingest` credits `localXp` provisionally for every
`UserPromptSubmit`/`PostToolUse`/`Stop` hook event, using the same capped, pure functions
(`creditBucket`, `activateDay`) the server runs — see `docs/design/economy.md` for the award and
cap values, which this doc does not restate. Because both sides run the same math, the provisional
number is normally exactly what the server confirms; the reconciliation below exists for the cases
where it isn't (dropped/stale buckets, a cap the client's local history didn't know about, a batch
that never arrived).

## The reconciliation formula

`apps/desktop/src/main/net/SyncQueue.ts:flush` captures `localXpAtSend = deps.localXp()` at the
moment a batch is sent — the local total *at send time*, not after. When the server responds, the
`synced` event carries that same value through to
`apps/desktop/src/main/game/GameService.ts:applyServerState(server, localXpAtSend)`:

```
provisionalSince = max(0, localXp − localXpAtSend)   // earned after the batch left
serverXp          = server.totalXp
localXp           = server.totalXp + provisionalSince
```

Anything credited locally after the snapshot was taken (`provisionalSince`) survives the
reconciliation; everything up to that snapshot is replaced by the server's number, absorbing any
drops or caps the server applied that the client didn't predict. `apps/desktop/src/main/App.ts`
wires this up in `startSync`: it subscribes to `SyncQueue`'s `synced` event and calls
`applyServerState` with the `mon` state and `localXpAtSend` the event carries.

## Stage monotonicity

`GameService.afterXpChange` computes a `targetStage` — the server's `stage` when reconciling, or
(only in `localGame` mode, i.e. no backend) the level-derived stage otherwise the state's current
one — and only moves forward:

```
order = ['egg', 'baby', 'teen', 'adult']
if order.indexOf(targetStage) > order.indexOf(currentStage): apply it
```

A stage never regresses, even if a later sync's `mon.stage` were somehow "behind" what the client
already shows. The level curve and stage thresholds themselves live in
`packages/shared/src/game/levels.ts` (documented in `../../design/species-and-nations.md`), not here.

## Celebrations: which events, and when

`afterXpChange` emits three distinct events, and they are not all triggered the same way:

| Event | Fires from | Online (`localGame: false`) | Offline (`localGame: true`) |
|---|---|---|---|
| `levelup` | any XP change crossing a level boundary | fires eagerly on provisional XP too | fires eagerly on provisional XP |
| `hatch` | stage advancing past `egg` | only via `applyServerState`'s `serverStage` | fires locally once `HATCH_XP` is reached |
| `evolve` | stage advancing past `baby`/`teen` | only via `applyServerState`'s `serverStage` | fires locally from `stageForLevel` |

With a backend, `ingest()`'s own call to `afterXpChange` passes no `serverStage`, so `targetStage`
falls through to the state's current stage and never advances — hatch/evolve celebrations only ever
fire once a sync round-trip confirms them. `apps/desktop/src/main/App.ts:wireGameEvents` turns
`hatch`/`evolve` into a stimulus plus a delayed `PetHost.setStage` call (2500 ms / 2000 ms after the
event) so the crack/evolution animation plays before the sprite swaps.

## Idempotent batches, retry, and backoff

Each batch carries a client-generated `batch_id` (UUID), reused across retries of the *same* batch
(`SyncQueue.flush` only mints a new one when `ledger.batchId` is null) so a retried send after a
timeout cannot double-credit XP. `supabase/functions/ingest-xp/index.ts` inserts that id into
`ingest_batches` before running the pipeline and returns `duplicate: true` on a unique-violation —
see `../../design/backend-rules.md` for the full idempotency and suspicion model, not restated here.

On failure, `SyncQueue` backs off from 5 s and doubles up to a 5 minute ceiling
(`BACKOFF_MIN_MS`/`BACKOFF_MAX_MS` in `apps/desktop/src/main/net/SyncQueue.ts`), resetting to the
floor on the next success. A `NO_PROFILE` response clears the local profile so the next flush
recreates it; any other 4xx (other than 429) drops the batch outright rather than retrying forever.
Independent of failures, a flush also runs every 60 s, 5 s after a `Stop` event
(`scheduleSoon`/`AFTER_STOP_MS`), and roughly every 5 minutes even with nothing pending, so server
notifications still arrive.

## Offline for days: dropped XP is a real consequence

Two limits interact when a client stays offline:

- **Client-side bucket cap**: `GameService.ingest` keeps at most 24 h worth of minute buckets in
  `ledger.pending` (`24 * 60` entries), trimming the oldest first — a device offline for much longer
  than a day is already discarding its own backlog before it ever reaches the network.
- **Server-side staleness window**: whatever *does* reach `ingest-xp`, `creditBucket` still drops any
  bucket older than `CAPS.staleMs` relative to server time (value in `../../design/economy.md`).

Together these mean XP earned while offline beyond that window is not a display glitch that
resolves on reconnect — it is permanently dropped, both on the client's own pending list and again
by the server if it somehow survived that. There is no backfill path for it.

## JsonStore durability

`apps/desktop/src/main/persistence/JsonStore.ts` is what makes all of the above survive a crash.
Writes are debounced 500 ms after the last `update()`, then go through
`<userData>/state.json.tmp` → copy current `<userData>/state.json` to `<userData>/state.json.bak` →
rename `.tmp` over `<userData>/state.json`, so a crash mid-write leaves either the old file or the
fully-written new one, never a half-written one. `load()` reads `<userData>/state.json`, falling
back to the `.bak` copy, falling back to `defaultState()`; a file that fails to parse is copied
aside as `<userData>/state.json.corrupt-<timestamp>.json` before falling back. `apps/desktop/src/main/persistence/state.ts:MIGRATIONS` is an append-only list
run in order by schema version on load — never edit an existing entry, only add new ones at the end.
`App.shutdown` awaits `JsonStore.flush()` so the debounced write is not lost on quit.

```mermaid
sequenceDiagram
    participant GameService
    participant SyncQueue
    participant ingest-xp
    participant App
    GameService->>GameService: ingest() credits localXp provisionally
    App->>SyncQueue: scheduleSoon() (after Stop) / 60s timer
    SyncQueue->>SyncQueue: localXpAtSend = localXp()
    SyncQueue->>ingest-xp: invoke(batch_id, buckets)
    ingest-xp->>ingest-xp: insert batch_id (idempotency) -> runIngestPipeline
    ingest-xp-->>SyncQueue: { mon: {totalXp, speciesId, stage}, events, notifications }
    SyncQueue->>SyncQueue: subtract sent counts from ledger.pending
    SyncQueue-->>App: emit synced({mon, localXpAtSend})
    App->>GameService: applyServerState(mon, localXpAtSend)
    GameService->>GameService: localXp = mon.totalXp + max(0, localXp - localXpAtSend)
    GameService-->>App: emit levelup / hatch / evolve / progress
```
