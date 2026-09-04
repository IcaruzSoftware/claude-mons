---
doc_type: decision
purpose: "Read this when asked why claude-mons is not a fork of OpenPets or another desktop-pet project."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - CLAUDE.md
  - docs/history/v1-design-2026-09-04.md
adr_status: accepted
---

# From Scratch, Not OpenPets Fork

## Context

Before writing any code, the project considered basing claude-mons on
[OpenPets](https://github.com/), an existing MIT-licensed desktop pet: Electron + React, a plugin
sandbox, multi-assistant support, and an MCP-based integration for feeding it assistant activity.
Forking it would have reused a working overlay window, a plugin loader and an existing
multi-assistant abstraction.

claude-mons needed none of OpenPets' plugin sandbox or multi-assistant abstraction — it targets one
assistant (Claude Code) via its hook system, not MCP — and needed a game core (XP, levels,
evolution, nations, async battles, a Supabase-backed leaderboard) that does not exist in OpenPets at
all. Stripping the plugin/multi-assistant machinery and the React renderer back out, then building
the entire game and backend layer on top of an architecture shaped for a different problem, was
judged more expensive and riskier than starting the overlay and state machine from a blank
`apps/desktop`.

## Decision

Build claude-mons from scratch as its own pnpm monorepo. Borrow OpenPets' proven *concepts* — a
small always-on-top overlay window, a pet state machine, and mapping external tool/assistant events
onto pet reactions — but not its code, license terms, or dependency footprint. No OpenPets source,
config, or assets are vendored anywhere in this repo.

## Consequences

- Full control over every layer (window management, state machine, IPC, game economy, backend
  schema) without working around abstractions built for a different scope.
- No inherited plugin sandbox or multi-assistant support; if claude-mons ever needs to support a
  second AI assistant, that integration is built from nothing rather than adapted from OpenPets'
  MCP-based one.
- All renderer, IPC and persistence code (`apps/desktop`, `packages/shared`, `packages/sprites`) was
  written and tested from zero, taking longer up front than a fork would have for the parts OpenPets
  already solved (window creation, click-through toggling).
- No MIT-license attribution burden from reused OpenPets code, since none was copied.

## Status

Accepted, 2026-09-04
