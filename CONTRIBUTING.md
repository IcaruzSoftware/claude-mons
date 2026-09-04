# Contributing

Thanks for your interest in claude-mons!

## Setup

```bash
corepack enable        # or: npm i -g pnpm
pnpm install
pnpm dev               # starts the Electron app with hot reload
```

Additional tooling for the full build: Go 1.22+ (hook binary), Deno 2 (Edge Function checks), Supabase CLI via `npx supabase`.

## Before opening a PR

```bash
pnpm check             # lint + typecheck + unit tests
pnpm deno:check        # Deno compatibility of shared code and Edge Functions
```

## Ground rules

- English only in code, comments, docs and commits.
- Keep `packages/shared` free of Node-specific APIs; it also runs in Deno.
- Game-balance changes (XP, level curve, stats, damage formula) need an update to `docs/DESIGN.md` and the balance tests.
- Sprites are code (`packages/sprites`). Keep palettes per nation consistent.
