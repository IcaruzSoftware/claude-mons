---
doc_type: root
purpose: "Read this when contributing code or documentation to claude-mons."
audience: human
last_verified: 2026-09-05
last_verified_commit: f198a9d
related_files:
  - README.md
  - docs/README.md
  - docs/design/battle.md
  - scripts/check-docs.mjs
  - .github/workflows/ci.yml
---

# Contributing

Thanks for your interest in claude-mons!

## Setup

```bash
corepack enable        # or: npm i -g pnpm
pnpm install
pnpm dev               # starts the Electron app with hot reload
```

## Tooling

- **Go 1.22+** – cross-compile the hook binary (`pnpm hook:build`)
- **Deno 2** – type-check Edge Functions and shared code (`pnpm deno:check`)
- **Supabase CLI** – deploy backend (`npx supabase` or `pnpm supabase`)

## Pre-PR checklist

```bash
pnpm check             # lint + typecheck + unit tests
pnpm deno:check        # Deno compatibility of shared code and Edge Functions
pnpm hook:build        # if Go code in packages/hook-cli changed
```

## Ground rules

- **English only** in code, comments, docs and commits.
- **`packages/shared` is Node-free** – it runs in Deno; use web-standard globals and relative imports with `.ts` extensions.
- **Game-balance changes** – update both [docs/design/battle.md](docs/design/battle.md) and the balance tests.
- **Sprites are code** ([`packages/sprites`](packages/sprites/)) – keep palettes per nation consistent.

## Adding or editing documentation

Every `.md` file begins with frontmatter (flat YAML, lines 1–18):

```yaml
---
doc_type: <root | index | design | architecture | decision | runbook | policy | reference | history>
purpose: "Read this when <one sentence: the task that should send a reader here>."
audience: <agent | human | both>
last_verified: <YYYY-MM-DD>
last_verified_commit: <git rev-parse --short HEAD>
related_files:
  - <repo-relative path>
adr_status: accepted               # decision docs only
---
```

### Style rules

1. One `#` title; `##` sections, at most `###`.
2. Every code reference is a backtick span with the full repo-relative path, e.g. `` `apps/desktop/src/main/hooks/binary.ts` ``; paths are verified.
3. Inventories (files, channels, species, flags) are Markdown tables, not prose.
4. A fact has exactly one home – do not restate values from other docs; link instead.
5. Never invent – if a fact cannot be verified in code, use `> Unverified:` blockquote.
6. Flow docs: exactly one `` ```mermaid `` block (`sequenceDiagram` or `flowchart TD`).
7. Runbooks: numbered steps; each is a fenced shell command or bold UI action; end with `## Acceptance`.
8. ADRs: sections `## Context`, `## Decision`, `## Consequences`, `## Status`; 40–80 lines.
9. Present tense for current behavior; past tense only for ADR Context and CHANGELOG.
10. Stay under the target length (hard cap 260 lines); cut prose, not tables.
11. `docs/history/*` are frozen – never edit them and do not cite them as current facts.
12. Placeholders in paths use `<angle brackets>` (checker skips them, e.g. `` `<userData>/state.json` ``).

### Documentation locations

- [docs/design/](docs/design/) – game economy, battle rules, species, behavior engine, backend rules
- [docs/architecture/](docs/architecture/) – system overview, component flows
- [docs/decisions/](docs/decisions/) – ADRs named numerically (e.g. [`docs/decisions/0001-from-scratch-not-openpets-fork.md`](docs/decisions/0001-from-scratch-not-openpets-fork.md))
- [docs/runbooks/](docs/runbooks/) – release, deployment, operational procedures
- Package READMEs – [`apps/desktop/README.md`](apps/desktop/README.md), [`packages/shared/README.md`](packages/shared/README.md), and others

### Validation

After editing a doc, run:

```bash
pnpm docs:check       # Check frontmatter and link integrity (runs scripts/check-docs.mjs)
pnpm docs:index       # Regenerate docs/README.md (auto-run by CI)
```

CI runs `scripts/check-docs.test.mjs` to verify all documentation files.
