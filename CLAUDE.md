# claude-mons — notes for coding agents

Desktop-pet overlay (Electron) crossed with Pokémon, trained by using Claude Code. Read `docs/DESIGN.md` before changing game mechanics; it is the spec.

## Repo rules

- Everything in the repo is English: code, comments, docs, commit messages.
- pnpm monorepo. `pnpm check` = lint + typecheck + test. Run it before committing.
- `packages/shared` is consumed by both Electron (Node) and Supabase Edge Functions (Deno): web-standard globals only, no `node:` imports, no npm deps, relative imports **with `.ts` extensions**, no `Math.random`/`Date.now` in game/battle code (use the seeded RNG and injected clocks). ESLint enforces the globals rule; `pnpm deno:check` proves Deno compatibility.
- `apps/desktop`: main process = window/tray/IPC/persistence/network; the pet renderer is vanilla TS + canvas; the panel/hover card are Preact. IPC channel names and payload types live only in `apps/desktop/src/common/ipc.ts`.
- `packages/hook-cli` is Go (stdlib only). It runs on every Claude Code tool call, so it must stay tiny and fast, and must never forward prompt text, tool input/output or transcript paths.
- Secrets live in `.env.local` (gitignored). Never print its values. Supabase CLI commands read them from the environment.
- Sprites are authored as string-row pixel matrices in `packages/sprites`; never commit generated PNGs except preview artifacts in CI.

## Commands

- `pnpm dev` — run the desktop app with HMR
- `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm check`
- `pnpm deno:check` — sync shared into `supabase/functions/_shared/game` and type-check Edge Functions
- `pnpm hook:build` — cross-compile the Go hook binary
- `pnpm sim <script.json>` — run the behavior engine headlessly

## Conventions

- Commit per phase or per coherent feature, imperative subject, body explains why.
- Tests live next to the package in `test/`. Prefer pure functions and inject clocks/RNG so logic is testable without Electron.
