---
doc_type: root
purpose: "Read this first, every session, before touching any code or doc."
audience: agent
last_verified: 2026-09-05
last_verified_commit: 66fc383
related_files:
  - docs/README.md
  - docs/architecture/overview.md
  - CONTRIBUTING.md
---

# claude-mons — agent entry point

claude-mons is a desktop-pet overlay (Electron) crossed with Pokémon: the pet earns XP while the user works with Claude Code, hatches into one of eight species within a chosen nation, evolves, appears on a global leaderboard and fights async battles against other nations. Backend is Supabase; the hook forwarder is a Go binary. Every documentation file is indexed in [docs/README.md](docs/README.md); the system map is [docs/architecture/overview.md](docs/architecture/overview.md).

## Before you touch ... read ...

| You are about to | Read first |
|---|---|
| change XP awards, caps, bonuses or the level curve | [docs/design/economy.md](docs/design/economy.md) |
| change battle math, rewards, cooldowns or matchmaking | [docs/design/battle.md](docs/design/battle.md), [docs/architecture/flows/shake-to-battle.md](docs/architecture/flows/shake-to-battle.md) |
| add or change a species or nation | [docs/design/species-and-nations.md](docs/design/species-and-nations.md), [docs/runbooks/add-a-species.md](docs/runbooks/add-a-species.md) |
| touch the pet state machine or animations | [docs/design/behavior-engine.md](docs/design/behavior-engine.md), [packages/sprites/README.md](packages/sprites/README.md) |
| touch the overlay window, click-through, drag or shake | [docs/architecture/overlay-and-input.md](docs/architecture/overlay-and-input.md) |
| touch hook ingestion (Go binary, endpoint, spool, installer) | [packages/hook-cli/README.md](packages/hook-cli/README.md), [docs/architecture/flows/hook-to-xp.md](docs/architecture/flows/hook-to-xp.md) |
| touch the Supabase schema, RLS, RPCs or Edge Functions | [supabase/README.md](supabase/README.md), [docs/design/backend-rules.md](docs/design/backend-rules.md), [docs/runbooks/extend-the-backend.md](docs/runbooks/extend-the-backend.md) |
| touch sync, persistence or reconciliation | [docs/architecture/flows/server-reconciliation.md](docs/architecture/flows/server-reconciliation.md), [apps/desktop/README.md](apps/desktop/README.md) |
| touch onboarding, profiles or nicknames | [docs/architecture/flows/onboarding.md](docs/architecture/flows/onboarding.md) |
| touch IPC between main and renderers | [apps/desktop/IPC.md](apps/desktop/IPC.md) |
| package, sign or release | [docs/runbooks/release.md](docs/runbooks/release.md), [docs/CODE_SIGNING_POLICY.md](docs/CODE_SIGNING_POLICY.md) |
| deploy the backend | [docs/runbooks/deploy-backend.md](docs/runbooks/deploy-backend.md) |
| debug "the pet does not react" | [docs/runbooks/debug-hook-pipeline.md](docs/runbooks/debug-hook-pipeline.md) |
| reset local state or test a fresh first launch | [docs/runbooks/reset-local-state.md](docs/runbooks/reset-local-state.md) |
| understand why something was built this way | [docs/decisions](docs/decisions) (ADRs 0001–0013) |
| write or edit any documentation | the Doc rules below and [CONTRIBUTING.md](CONTRIBUTING.md) |

## Hard rules

- Everything in the repo is English: code, comments, docs, commit messages.
- Run `pnpm check` before committing. It runs lint, typecheck, unit tests, the script tests and `pnpm docs:check`.
- `packages/shared` runs in Electron (Node) and in Deno Edge Functions: web-standard globals only, no `node:` imports, no npm dependencies, relative imports **with `.ts` extensions**, no `Math.random` or `Date.now` in game or battle code (inject seeds and clocks). `pnpm deno:check` proves Deno compatibility.
- `packages/hook-cli` is Go, stdlib only. It runs on every Claude Code tool call: keep it tiny, never write to stdout, always exit 0, and never forward prompt text, tool input/output or transcript paths.
- IPC channel names and payload types live only in `apps/desktop/src/common/ipc.ts`.
- Secrets live only in `.env.local` (gitignored). Never print their values; source them into the environment of CLI commands.
- Sprites are string-row pixel matrices in `packages/sprites`; never commit generated PNGs.
- Read the owning file in `docs/design` before changing a game mechanic, and update it in the same commit. The balance test in `packages/shared/test/balance.test.ts` must still pass.
- Commit per coherent feature: imperative subject, body explains why.

## Doc rules

- Every doc starts with the flat frontmatter described in [CONTRIBUTING.md](CONTRIBUTING.md); `last_verified_commit` is the real short SHA you read the code at.
- One topic per file, 80–250 lines, tables for inventories, full repo-relative paths in backticks.
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

- The only migration is `supabase/migrations/20260904000000_init.sql`; new schema changes get a new timestamped file.
- The profile Edge Function is `create-profile`; older plans called it claim-nickname.
- There is no constants file in `packages/shared`; constants live in the module that owns them.
- The Supabase function bundler ignores import maps, so Edge Functions import supabase-js with an explicit npm specifier.
- `pnpm sync:shared` copies the shared package into `supabase/functions/_shared/game`; that directory is generated and gitignored.
- Windows Smart App Control blocks unsigned executables. A rebuilt hook binary can fail with "Application Control policy has blocked this file" on the dev machine; a signed build is the fix.
- GDI screenshots cannot capture the composited Electron overlay; use `--capture`.
- The Windows credential manager hangs git pushes from non-interactive shells; on the dev machine git uses the GitHub CLI as credential helper.
- The database password in `.env.local` may not authenticate; [docs/runbooks/deploy-backend.md](docs/runbooks/deploy-backend.md) has the Management API fallback.
- Nothing has been verified on Linux yet; see [docs/runbooks/verify-on-linux.md](docs/runbooks/verify-on-linux.md).
