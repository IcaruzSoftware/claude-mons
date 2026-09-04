---
doc_type: decision
purpose: "Read this when asked why players have no sign-up step and where the account-linking gap is tracked."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - supabase/functions/create-profile/index.ts
  - packages/shared/src/game/nickname.ts
  - apps/desktop/src/main/net/SupabaseClient.ts
  - docs/ROADMAP.md
adr_status: accepted
---

# Anonymous Auth, Generated Nickname

## Context

First launch needed an identity for the player's mon (a row to own, a nickname for the
leaderboard) with as little friction as possible — the pet should exist the moment the app opens,
not after a sign-up flow. The alternative considered was **GitHub OAuth**: a natural fit for a
tool built around Claude Code and its developer audience, and it would give players a durable
identity tied to a real account from the start. It was rejected for v1 because it forces a
browser round-trip and an OAuth consent screen before the egg can even appear, which works against
the zero-friction first launch the design called for.

## Decision

Use Supabase anonymous auth (`signInAnonymously`, see
`apps/desktop/src/main/net/SupabaseClient.ts`) for every player. On first launch the app calls
`create-profile` (`supabase/functions/create-profile/index.ts`) with the chosen nation and no
nickname; the function generates one deterministically (`generateNickname` in
`packages/shared/src/game/nickname.ts`, e.g. `Trainer_4821`) and validates it against the same
format, reserved-word and blocklist rules used for a later player-chosen rename. The nickname is
renamable in Settings, subject to the cooldown documented in `supabase/README.md`.

## Consequences

- Zero-friction first launch: an egg appears and starts earning XP with no form to fill in and no
  external identity provider to authorize.
- The anonymous Supabase session is the only thing linking a device to its player row. Losing that
  session — a wiped `userData` directory, a reinstall, a new machine — loses the mon with no
  recovery path, since there is no email or OAuth identity to reattach it to.
- Nicknames need their own moderation surface (reserved names, a leetspeak-aware blocklist) that an
  OAuth-provided display name would not have needed.
- Account linking (email or GitHub, to survive a reinstall) is deferred, not solved: it is tracked
  as a v1.1 item in `docs/ROADMAP.md` rather than built now.

## Status

Accepted, 2026-09-04
