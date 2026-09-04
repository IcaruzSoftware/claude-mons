---
doc_type: decision
purpose: "Read this when you need to know why the desktop client shows XP before the server has confirmed it, and who is allowed to trigger a hatch or evolution."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - apps/desktop/src/main/game/GameService.ts
  - packages/shared/src/game/xp.ts
  - docs/design/backend-rules.md
  - docs/design/economy.md
adr_status: accepted
---

# Server-authoritative XP with provisional client XP

## Context

Hook events (prompts, tool calls, stops) arrive on the desktop client continuously, but XP is only
credited for real once the batch reaches `ingest-xp` and survives the plausibility clamps described
in `docs/design/backend-rules.md`. The client cannot wait for a network round trip after every hook
event without the pet feeling unresponsive, but it also cannot be the source of truth: `players`,
`mons` and `xp_daily` are only ever written by the Edge Functions' service-role RPCs (see
`docs/design/backend-rules.md`), and a client-authoritative number would be trivially inflated by a
modified client since nothing server-side would ever recompute or dispute it.

Alternatives considered:

- **Client-authoritative, server as mirror**: the client decides XP/level/stage locally and the
  server just records whatever it is told. Rejected: trivially cheatable — there is no clamp between
  a hostile client and the leaderboard.
- **Server-only display**: never show local XP; wait for each `ingest-xp` response before updating
  anything on screen. Rejected: hook events fire many times per minute during active use, and gating
  every pet reaction on a network round trip makes the pet feel laggy and breaks the "instant
  feedback" goal of the hook pipeline.

## Decision

`apps/desktop/src/main/game/GameService.ts` runs the same capped credit function
(`packages/shared/src/game/xp.ts:creditBucket`) locally that the server runs, so
`apps/desktop/src/main/game/GameService.ts:ingest` can credit **provisional** XP to
`progress.localXp` immediately on each hook event — normally an exact preview of what the server
will later confirm, since it is the same function with the same caps.
`apps/desktop/src/main/game/GameService.ts:applyServerState` reconciles on every `ingest-xp`
response: local XP becomes `server.totalXp + provisionalSince`, where `provisionalSince` is only
whatever was credited locally after the batch that produced this response was sent
(`localXpAtSend`), so events already covered by the response are not double-counted and a rejected
batch's provisional credit is dropped rather than kept. Hatch and evolution are gated on who is
authoritative: with `localGame: true` (offline/dev) `GameService` rolls species and advances stage
itself; otherwise stage only ever advances from a server-supplied `stage` in `applyServerState`
(`apps/desktop/src/main/game/GameService.ts:afterXpChange`), and the stage order check there
(`egg < baby < teen < adult`) means a stage can never regress even if a stale server response
arrives out of order.

## Consequences

- The player sees XP move immediately on every hook event with no perceptible lag, at the cost of
  the number occasionally correcting itself (silently, on the next `ingest-xp` response) when the
  server's clamps drop something the client credited provisionally.
- `GameService` has to track `localXpAtSend` per outstanding batch to reconcile correctly; getting
  that bookkeeping wrong (e.g. reconciling against the wrong batch) would double-count or drop XP
  silently, since there is no error surfaced to the player either way.
- Hatch/evolve celebrations only ever fire from server events in the non-`localGame` path, so a
  player can be at server-confirmed hatch-worthy XP for up to one ingest cycle before the client
  actually shows the hatch — a deliberate lag in the celebratory moment in exchange for never
  celebrating a stage the server later disputes.

## Status

Accepted, 2026-09-05
