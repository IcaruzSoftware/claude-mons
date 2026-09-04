---
doc_type: decision
purpose: "Read this when questioning why species are grouped into four nations instead of a flat random pool, or why nation is permanent."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - packages/shared/src/game/nations.ts
  - packages/shared/src/game/species.ts
adr_status: accepted
---

# Nations and in-nation species roll

## Context

The original plan for hatching was a fully random species roll across the whole pool, independent of
anything the player did. During design, the owner reconsidered: a pure random roll means two players who
each invest the same effort can end up feeling very differently rewarded — one gets a species they like,
one doesn't, with no sense of belonging to anything larger than their own mon.

An alternative that came up was letting **usage profile** decide the species — e.g. rewarding
tool-call patterns with a matching species. This was rejected: it would incentivise using Claude Code in
whatever way the algorithm favors rather than however the player's actual work needs, which runs against
the point of the app (react to real work, not game it).

The chosen alternative, styled after Avatar-style elemental factions: four nations, each with a personality
and a small roster of species, and the player commits to one nation up front. See
[../design/species-and-nations.md](../design/species-and-nations.md) for the nation list, palettes and
species table.

## Decision

A player picks one of four nations at first launch (panel shows a selection screen). The choice is
**permanent in v1** — no re-roll, no respec. Hatching then rolls a species **restricted to the chosen
nation** (two species per nation: one common, one rare), server-side, weighted by rarity. The nation also
doubles as the mon's battle type (see
[0006-async-server-authoritative-battles.md](0006-async-server-authoritative-battles.md) and
[../design/battle.md](../design/battle.md) for the type-effectiveness cycle this enables).

This gives every player a team identity independent of hatch luck: nation standings on the leaderboard,
and colleagues can pick the same nation to feel like they're on one team, while the randomness that remains
(which of the two species) is bounded and never disappointing in the way a flat 1-in-8 roll could be.

## Consequences

- Team feeling and reduced disappointment: the player always gets *a* mon from a nation they chose, never
  a species from a nation whose personality/flavor they didn't want.
- The type-effectiveness cycle in battles falls out of nation choice for free, rather than needing a
  separate "type" concept layered on top of species.
- **Negative**: nation is permanent in v1, so a player who picks impulsively at first launch is stuck with
  that identity (and that half of the species pool) until a "change nation" feature ships — tracked as a
  post-v1 item, not built.
- Rejecting usage-profile-driven species means the hatch roll carries no signal about *how* someone used
  Claude Code, which was a deliberate simplification but also means that axis of personalization is not
  available even if a future design wanted it.

## Status

Accepted, 2026-09-04
