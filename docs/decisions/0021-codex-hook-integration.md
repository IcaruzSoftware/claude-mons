---
doc_type: decision
purpose: "Read this when questioning why Codex has its own hook install, agent spec and event aliases, or how apply_patch/update_plan/Interrupt map onto the XP economy."
audience: both
last_verified: 2026-09-25
last_verified_commit: 2ccd329
related_files:
  - apps/desktop/src/main/hooks/agents.ts
  - apps/desktop/src/main/hooks/HookInstaller.ts
  - apps/desktop/src/main/hooks/codexConfig.ts
  - apps/desktop/src/main/hooks/backup.ts
  - apps/desktop/src/main/hooks/rawHook.ts
  - apps/desktop/src/main/hooks/ActivityTracker.ts
  - apps/desktop/src/main/App.ts
  - packages/shared/src/hooks/payload.ts
  - packages/shared/src/game/xp.ts
  - docs/architecture/flows/hook-to-xp.md
  - docs/design/economy.md
  - docs/runbooks/release.md
adr_status: accepted
---

# Codex hook integration

## Context

OpenAI's Codex CLI added a hooks feature with the same JSON shape Claude Code's
`~/.claude/settings.json` already uses (a `command` entry per event, with a `timeout` in
seconds), configured instead in `$CODEX_HOME/hooks.json` (default `~/.codex`) and gated behind
`[features] hooks = true` in `$CODEX_HOME/config.toml`. Since the pet already trains from Claude
Code's own hook events (`docs/architecture/flows/hook-to-xp.md`), extending it to Codex sessions
needed a hook installer that could target either agent's config file and event names without
duplicating `HookInstaller`'s read/backup/merge/write logic.

Codex's event set differs from Claude Code's: it has no `Notification` event but sends its own
`PermissionRequest`; it has no equivalent of Claude Code's silent user-interrupt (which fires no
event at all) but sends an explicit `Interrupt`; and it caps the `SessionEnd` and `Interrupt` hook
timeouts at 3 s, tighter than the 5 s used everywhere else. Its tool names also differ where they
overlap in function: `apply_patch` edits files where Claude Code uses `Edit`/`Write`, and
`update_plan` tracks a plan where Claude Code uses `TodoWrite`.

## Decision

Generalize `HookInstaller` over a `HookAgentSpec` (`apps/desktop/src/main/hooks/agents.ts`)
instead of hardcoding Claude Code's event list, and add a Codex-specific spec and config path:

- `CLAUDE_AGENT` keeps today's seven events at 5 s. `CODEX_AGENT` installs `SessionStart`,
  `UserPromptSubmit`, `PreToolUse`/`PostToolUse` (matcher `*`), `PermissionRequest` (normalized to
  our `Notification`), `Stop`, `Interrupt` and `SessionEnd` — the last two at 3 s, everything else
  at 5 s. Codex's `SubagentStart`/`SubagentStop` and `Pre`/`PostCompact` events are not installed
  and are ignored if Codex ever sends them anyway.
- `Interrupt` is a new `HookEventName` (`packages/shared/src/hooks/payload.ts`). It is
  animation-only and never credited: `ActivityTracker.ingest` ends the thinking/working state
  without a success animation, and `GameService.ingest` does not react to it at all — the same
  treatment as Claude Code's user interrupt, which fires no event and therefore no XP. Both agents
  end up indistinguishable to the player on an interrupted turn.
- `packages/shared/src/game/xp.ts` classifies `apply_patch` as `mutate` (same weight as `Edit`)
  and `update_plan` as `meta` (same weight as `TodoWrite`); the numbers themselves live in
  [economy.md](../design/economy.md), not here.
- The app itself turns on `[features] hooks = true` in `~/.codex/config.toml`
  (`apps/desktop/src/main/hooks/codexConfig.ts:ensureCodexHooksFeature`), editing as little of the
  file as possible and backing it up first (`apps/desktop/src/main/hooks/backup.ts`) whenever it
  writes. It runs only when the user clicks Connect (or a reinstall needs to reapply it), never on
  disconnect: other tools may rely on the same flag, so disabling Codex hooks must not turn hooks
  off globally. A `[features]` table already using a dotted (`features.hooks = ...`) or inline
  (`features = { hooks = ... }`) form is left untouched (`'unsupported'`); Settings then shows a
  hint to set it by hand instead of risking a malformed rewrite.
- Codex is only ever "detected" by `codexHome()`'s directory already existing on disk
  (`apps/desktop/src/main/hooks/agents.ts:codexDetected`). Absent that, the panel/tray never offer
  to connect it, `toggleHooks('codex')` is a no-op, and nothing in the app creates `~/.codex`
  merely by probing for it.
- Codex requires trusting installed hooks via its own `/hooks` command, which trusts by a hash of
  the installed command line. A script-mode command embeds the port and token, so any port/token
  change invalidates that hash and the user must re-run `/hooks`; a binary-mode command
  (`<binary> --home <dir> --event <name>`) has no such volatile parts, so it stays trusted across
  restarts.

## Consequences

- `packages/shared`'s `classifyTool` changed, and `supabase/functions/_shared/game` is a generated
  copy of it (`pnpm sync:shared`): the `ingest-xp` Edge Function must be redeployed after this
  branch merges, or the server will under-classify `apply_patch`/`update_plan` until it is. This
  redeploy must land **before** the client release ships (see the ordering step in
  [docs/runbooks/release.md](../runbooks/release.md)): a client released first has Codex hooks
  already sending `apply_patch` events, but the old server still classifies it as `read` (weight 0),
  so the very next reconciliation corrects the client's provisional `mutate` XP back down.
- Codex on Windows is untested — Codex CLI's own Windows support and hook behavior have not been
  verified against this integration.
- A script-mode Codex install needs re-trusting (`/hooks`) after every port/token rotation; a
  binary-mode install does not. This mirrors the existing binary-vs-script tradeoff Claude Code
  already has ([ADR 0014](0014-curl-script-mode-hook-fallback.md)), just with an extra manual step
  on the Codex side.
- Two on-disk hook file formats (`~/.claude/settings.json` events keyed by name vs.
  `~/.codex/hooks.json`) are both
  produced by the same `HookInstaller`, so a future third agent only needs its own `HookAgentSpec`
  and config path, not new install/merge/backup logic.

## Status

Accepted, 2026-09-25
