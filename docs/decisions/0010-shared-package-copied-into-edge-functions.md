---
doc_type: decision
purpose: "Read this when you need to know why supabase/functions/_shared/game exists and is gitignored instead of importing packages/shared directly."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - scripts/sync-shared.mjs
  - packages/shared/README.md
  - supabase/functions/deno.json
  - packages/shared/package.json
  - tsconfig.base.json
  - eslint.config.js
adr_status: accepted
---

# Shared package copied into Edge Functions

## Context

`packages/shared` (see `packages/shared/README.md`) is dependency-free, web-standard TypeScript
consumed as source by both `apps/desktop` (via electron-vite, which resolves the monorepo package
normally) and the Supabase Edge Functions under `supabase/functions/*`. The Supabase CLI's deploy
bundler only packages files that live under `supabase/functions/`; it does not follow package
resolution out to `packages/shared` and it ignores Deno import maps, so a `supabase/functions/deno.json`
`imports` entry pointing at `../../packages/shared/src` builds locally but is silently dropped on
deploy.

Alternatives considered:

- **Publish `packages/shared` to npm** and depend on it from `supabase/functions` via an `npm:`
  specifier (which the bundler does honor, per the `supabase-js` entry in
  `supabase/functions/deno.json`). Rejected: every change to shared game logic would need a version
  bump and publish before an Edge Function could pick it up, adding a release step to routine
  gameplay changes.
- **Import map to `../../packages/shared`** relative path. Rejected: works under `deno check`
  locally but is exactly the path the CLI's bundler does not follow at deploy time, so it fails
  silently in production while looking correct in CI.

## Decision

`scripts/sync-shared.mjs` copies `packages/shared/src` verbatim into
`supabase/functions/_shared/game` before any Deno-side check or deploy. The destination directory
is gitignored — it is build output, never a source of truth. `packages/shared` keeps its `.ts`
import extensions and Node-global ban (enforced by `eslint.config.js` and `tsconfig.base.json`) so
the copied tree type-checks unmodified under Deno; `pnpm deno:check` runs the sync and then
`deno check` against `supabase/functions/deno.json` in one step. Third-party packages the Edge
Functions need but shared code does not stay as `npm:` specifiers in `supabase/functions/deno.json`
(the `supabase-js` entry), since those are genuinely external dependencies, not the shared game
module.

## Consequences

- Deploys and Deno type-checks always run the sync first (`pnpm sync:shared` / `pnpm deno:check`);
  running `deno check` directly against a stale or missing `supabase/functions/_shared/game` gives
  misleading results.
- There are now two copies of the same source on disk during local development. A change to
  `packages/shared/src` is invisible to `supabase/functions` until the next sync — anyone editing
  shared game logic and testing an Edge Function locally without re-running the sync will debug
  against stale code.
- Because the destination is gitignored, `git status` never shows drift, which also means a
  forgotten sync fails quietly (stale behavior) rather than loudly (a git diff nobody committed).

## Status

Accepted, 2026-09-05
