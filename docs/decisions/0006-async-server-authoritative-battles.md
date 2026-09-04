---
doc_type: decision
purpose: "Read this when questioning why battles are async snapshot fights instead of live PvP or interactive move selection."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - packages/shared/src/battle/battle.ts
  - supabase/functions/battle-request/index.ts
  - apps/desktop/src/main/game/BattleService.ts
adr_status: accepted
---

# Async server-authoritative battles

## Context

claude-mons has a small, scattered player base (colleagues running the app while they code), not a
matchmaking pool that is reliably online at the same time. Two shapes of battle were considered and
rejected:

- **Realtime PvP**: both players' apps connect and exchange live battle state. Rejected because it requires
  both players online simultaneously, which a small, scattered player base cannot reliably provide — most
  challenges would simply fail to find a live opponent.
- **Interactive move selection**: the player picks moves turn-by-turn, as in a traditional monster-battler.
  Rejected as too much UI for what is meant to stay a minimal desktop overlay — the panel is not meant to
  become a full game client, and shake-to-battle is supposed to stay a one-gesture action.

The chosen shape: a battle is fought against a **stored snapshot** of an opponent's mon (their stats and
species at the time of the last snapshot, not a live connection), simulated once, and the result replayed
as an animation. See [../design/battle.md](../design/battle.md) for the damage formula, turn order and
matchmaking details this decision enables, and
[0005-nations-and-in-nation-species-roll.md](0005-nations-and-in-nation-species-roll.md) for how nation
choice supplies the type-effectiveness axis the simulation uses.

## Decision

A battle is resolved in one request-response round trip, with no opponent involvement required:

1. The server picks an opponent snapshot (or a "Wild Mon" bot fallback when none qualifies).
2. `simulateBattle()` in `packages/shared/src/battle/battle.ts` runs **deterministically**, seeded by the
   battle id, entirely server-side.
3. The same function, given the same two snapshots and the same seed, reproduces the identical log
   client-side, so the client can replay the fight as an animation without trusting anything the client
   computed — the server's result is authoritative and already final by the time the client sees it.

Determinism (seed = battle id) is what makes "replay client-side" safe: the client never simulates a battle
whose outcome differs from what the server already committed.

## Consequences

- No live multiplayer: two players are never actually fighting "at the same time" in any synchronous
  sense, only against each other's last-known snapshot. This is an explicit trade against the small player
  base, not an oversight.
- The Wild Mon bot fallback (a generated opponent from another nation) becomes load-bearing rather than
  optional, since a real cross-nation opponent may often not be available — matchmaking must degrade
  gracefully to a bot rather than fail the challenge.
- **Negative consequence**: a player can never react to or influence their own battle in the moment — no
  move selection, no way to concede or retry a bad seed. The entire skill expression is in leveling and
  species/nation choice made long before the shake gesture, not in the fight itself.
- Because the log must replay identically forever (old battles are shown from their stored snapshots, not
  recomputed), the RNG call order inside `simulateBattle` becomes part of a durable protocol — changing it
  requires a protocol version bump, as documented in [../design/battle.md](../design/battle.md).

## Status

Accepted, 2026-09-04
