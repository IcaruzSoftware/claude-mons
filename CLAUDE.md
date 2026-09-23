---
doc_type: root
purpose: "Read this first, every session, before touching any code or doc."
audience: agent
last_verified: 2026-09-13
last_verified_commit: 44486b0
related_files:
  - docs/README.md
  - docs/architecture/overview.md
  - CONTRIBUTING.md
---

# claude-mons — agent entry point

claude-mons is a desktop-pet overlay (Electron) crossed with Pokémon: the pet earns XP while the user works with Claude Code, hatches into one of nine species within a chosen nation, evolves, appears on a global leaderboard and fights async battles against other nations. Backend is Supabase; the hook forwarder is a Go binary. Every documentation file is indexed in [docs/README.md](docs/README.md); the system map is [docs/architecture/overview.md](docs/architecture/overview.md).

## Before you touch ... read ...

| You are about to | Read first |
|---|---|
| change XP awards, caps, bonuses or the level curve | [docs/design/economy.md](docs/design/economy.md) |
| change battle math, rewards, cooldowns or matchmaking | [docs/design/battle.md](docs/design/battle.md), [docs/architecture/flows/shake-to-battle.md](docs/architecture/flows/shake-to-battle.md) |
| change moves, stances or matchmaking | [docs/design/progression.md](docs/design/progression.md) |
| change talent-tree nodes, budgets, respec or the Talents editor | [docs/design/talent-tree.md](docs/design/talent-tree.md) |
| add or change a species or nation | [docs/design/species-and-nations.md](docs/design/species-and-nations.md), [docs/runbooks/add-a-species.md](docs/runbooks/add-a-species.md) |
| touch the pet state machine or animations | [docs/design/behavior-engine.md](docs/design/behavior-engine.md), [packages/sprites/README.md](packages/sprites/README.md) |
| touch the overlay window, its bounds, displays or Linux quirks | [docs/architecture/overlay-window.md](docs/architecture/overlay-window.md) |
| touch click-through, pointer handling, drag, shake or the hover card | [docs/architecture/input-and-gestures.md](docs/architecture/input-and-gestures.md) |
| change panel, onboarding, hover-card or reminder styling or layout | [docs/design/ui-style.md](docs/design/ui-style.md), [docs/design/ui-panels.md](docs/design/ui-panels.md) |
| ship any change under `apps/desktop/src/renderer` | [docs/runbooks/verify-a-ui-change.md](docs/runbooks/verify-a-ui-change.md) — run the app before you call it done |
| touch hook ingestion (Go binary, endpoint, spool, installer) | [packages/hook-cli/README.md](packages/hook-cli/README.md), [docs/architecture/flows/hook-to-xp.md](docs/architecture/flows/hook-to-xp.md) |
| touch the Supabase schema, RLS, RPCs or Edge Functions | [supabase/README.md](supabase/README.md), [docs/design/backend-rules.md](docs/design/backend-rules.md), [docs/runbooks/extend-the-backend.md](docs/runbooks/extend-the-backend.md) |
| touch sync, persistence or reconciliation | [docs/architecture/flows/server-reconciliation.md](docs/architecture/flows/server-reconciliation.md), [apps/desktop/README.md](apps/desktop/README.md) |
| touch onboarding, profiles or nicknames | [docs/architecture/flows/onboarding.md](docs/architecture/flows/onboarding.md) |
| touch IPC between main and renderers | [apps/desktop/IPC.md](apps/desktop/IPC.md) |
| package, sign or release | [docs/runbooks/release.md](docs/runbooks/release.md), [docs/CODE_SIGNING_POLICY.md](docs/CODE_SIGNING_POLICY.md) |
| deploy the backend | [docs/runbooks/deploy-backend.md](docs/runbooks/deploy-backend.md) |
| debug "the pet does not react" | [docs/runbooks/debug-hook-pipeline.md](docs/runbooks/debug-hook-pipeline.md) |
| reset local state or test a fresh first launch | [docs/runbooks/reset-local-state.md](docs/runbooks/reset-local-state.md) |
| understand why something was built this way | [docs/decisions](docs/decisions) (ADRs, numbered; newest first in the index) |
| write or edit any documentation | the Doc rules below and [CONTRIBUTING.md](CONTRIBUTING.md) |

## Hard rules

- Everything in the repo is English: code, comments, docs, commit messages.
- Run `pnpm check` before committing. It runs lint, typecheck, unit tests, the script tests and `pnpm docs:check`.
- `packages/shared` runs in Electron (Node) and in Deno Edge Functions: web-standard globals only, no `node:` imports, no npm dependencies, relative imports **with `.ts` extensions**, no `Math.random` or `Date.now` in game or battle code (inject seeds and clocks). `pnpm deno:check` proves Deno compatibility.
- `packages/hook-cli` is Go, stdlib only. It runs on every Claude Code tool call: keep it tiny, never write to stdout, always exit 0, and never forward prompt text, tool input/output or transcript paths.
- IPC channel names and payload types live only in `apps/desktop/src/common/ipc.ts`.
- Secrets live only in `.env.local` (gitignored). Never print their values; source them into the environment of CLI commands.
- Sprites are string-row pixel matrices in `packages/sprites`; never commit generated PNGs.
- Never run the app against your own pet while testing: launch with a throwaway `--user-data-dir` and `CLAUDE_MONS_OFFLINE=1` ([docs/runbooks/verify-a-ui-change.md](docs/runbooks/verify-a-ui-change.md)). A plain `pnpm dev` uses the real profile and the real backend.
- Read the owning file in `docs/design` before changing a game mechanic, and update it in the same commit. The balance test in `packages/shared/test/balance.test.ts` must still pass.
- Commit per coherent feature: imperative subject, body explains why.

## Doc rules

- Every doc starts with the flat frontmatter described in [CONTRIBUTING.md](CONTRIBUTING.md); `last_verified_commit` is the real short SHA you read the code at.
- One topic per file, 80–250 lines (the checker errors above 260; frozen `docs/history/*` and the append-only `CHANGELOG.md` excepted), tables for inventories, full repo-relative paths in backticks.
- A fact has one home. Numbers and formulas live in `docs/design`; everywhere else links to them.
- Run `pnpm docs:check` after editing a doc, `pnpm docs:index` after adding or removing one; CI fails on stale paths or a stale index.
- New decisions get the next ADR number in `docs/decisions`; runbooks end with an Acceptance section.
- `docs/history` is frozen and is not a source of current facts. Point-in-time counts belong only in `CHANGELOG.md`.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | run the desktop app with hot reload |
| `pnpm check` | lint + typecheck + tests + script tests + docs check |
| `pnpm deno:check` | copy shared into the Edge Functions and type-check them under Deno |
| `pnpm docs:check` / `pnpm docs:index` | validate docs / regenerate `docs/README.md` |
| `pnpm hook:build` | cross-compile the Go hook binary |
| `pnpm sim <script.json>` | run the behavior engine headlessly |

Dev flags (`--dev-nation`, `--dev-xp`, `--dev-battle`, `--capture`, `--simulate`) and env vars (`CLAUDE_MONS_DEBUG`, `CLAUDE_MONS_OFFLINE`) are documented in [apps/desktop/README.md](apps/desktop/README.md).

## Gotchas

- Migrations live in `supabase/migrations` with 14-digit UTC timestamps; never edit an applied one, add a new file. Preferred deploy path is `gh workflow run supabase-deploy.yml --ref main` (needs the `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD` repo secrets); `npx supabase db push` also works locally now; the Management API fallback in the deploy runbook remains for when neither authenticates.
- The profile Edge Function is `create-profile`; older plans called it claim-nickname.
- There is no constants file in `packages/shared`; constants live in the module that owns them.
- The Supabase function bundler ignores import maps, so Edge Functions import supabase-js with an explicit npm specifier.
- `pnpm sync:shared` copies the shared package into `supabase/functions/_shared/game`; that directory is generated and gitignored.
- Windows Smart App Control blocks unsigned executables. A rebuilt hook binary can fail with "Application Control policy has blocked this file" on the dev machine; a signed build is the fix.
- GDI screenshots cannot capture the composited Electron overlay; use `--capture`.
- The Windows credential manager hangs git pushes from non-interactive shells; on the dev machine git uses the GitHub CLI as credential helper.
- If the database password ever stops authenticating again, [docs/runbooks/deploy-backend.md](docs/runbooks/deploy-backend.md) has the Management API fallback.
- Linux runs on the X11 backend (XWayland) with hardware acceleration off by default (ADR 0017); native Wayland is unsupported. Retest checklist: [docs/runbooks/verify-on-linux.md](docs/runbooks/verify-on-linux.md).
