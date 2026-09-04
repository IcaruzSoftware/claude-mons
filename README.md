---
doc_type: root
purpose: "Read this when starting with claude-mons, installing, or getting the app running locally."
audience: both
last_verified: 2026-09-05
last_verified_commit: f198a9d
related_files:
  - CONTRIBUTING.md
  - PRIVACY.md
  - docs/README.md
  - docs/design/economy.md
  - docs/design/species-and-nations.md
  - docs/design/battle.md
  - docs/architecture/overview.md
  - CHANGELOG.md
  - docs/ROADMAP.md
---

# claude-mons

**Pokémon, but for Claude Code.** A tiny pixel creature lives on your desktop. Every time you prompt Claude Code, it trains. Hatch it from an egg, level it up, evolve it, climb the global leaderboard, and shake it to battle mons from rival nations.

## How it works

1. Pick a nation: **Water**, **Fire**, **Earth** or **Air**. Each has a personality and two species.
2. An egg appears on your taskbar edge. Connect Claude Code with one click (adds hooks to `~/.claude/settings.json`; start a new Claude Code session afterwards).
3. Work with Claude Code as usual. Prompts, tool calls and finished turns earn [XP](docs/design/economy.md). At the [hatch threshold](docs/design/species-and-nations.md), the egg hatches into one of your nation's species (75% common, 25% rare), rolled by the server.
4. Level up through Baby → Teen → Adult. Your nation's weekly XP is its power on the leaderboard.
5. Grab your mon and shake it to [challenge a mon from another nation](docs/design/battle.md). Battles are automatic, deterministic and replayed as an animation. Ten challenges a day, five minutes apart.

The pet is a minimal overlay: it idles, walks along the taskbar, sleeps when you're away, and reacts while Claude thinks, edits and runs commands. Hover for a stats card, click for the panel, right-click for the menu.

## Install

Signed Windows installers and Linux packages are published by the release workflow (`.github/workflows/release.yml`) on tags `v*`. Until the first tagged release, build locally:

```bash
pnpm install
pnpm hook:build                      # Go 1.22+ required; cross-compiles the hook forwarder
pnpm --filter @claude-mons/desktop package:win    # or package:linux
```

The installer lands in `apps/desktop/release/`. Release builds are code-signed via SignPath Foundation; see [docs/CODE_SIGNING_POLICY.md](docs/CODE_SIGNING_POLICY.md) and [docs/runbooks/release.md](docs/runbooks/release.md). Unsigned local builds may be blocked by Windows Smart App Control.

## Development

Start the Electron app with hot reload:

```bash
pnpm install
pnpm dev            # Electron with hot reload
```

Before opening a pull request, run:

```bash
pnpm check          # lint + typecheck + unit tests
pnpm deno:check     # Edge Functions + shared code under Deno
pnpm docs:check     # validate documentation frontmatter and links
pnpm hook:build     # cross-compile the Go hook binary (if you modified it)
```

Repository layout:

- `apps/desktop` – Electron app (main process, pet renderer, Preact panel/hover card)
- `packages/shared` – game logic shared with Supabase Edge Functions (Deno-compatible)
- `packages/sprites` – pixel art as string matrices, rasterizer, preview script
- `packages/hook-cli` – Go binary invoked by Claude Code hooks
- `supabase` – migrations, RLS, RPCs, Edge Functions
- `scripts` – build and deployment automation

For development flags (e.g. `--dev-nation fire`, `--dev-xp 150`, `--simulate <script.json>`) and environment variables, see [apps/desktop/README.md](apps/desktop/README.md).

## Documentation

- **Agents:** [CLAUDE.md](CLAUDE.md) lists game mechanics and repo rules.
- **Index:** [docs/README.md](docs/README.md) lists all documentation by category.
- **Architecture:** [docs/architecture/overview.md](docs/architecture/overview.md) describes the system layers and data flow.
- **Design specs:** [docs/design/](docs/design/) covers economy, battle rules, species, behavior engine and backend rules.
- **Runbooks:** [docs/runbooks/](docs/runbooks/) contains release, deployment, secret rotation, and operational procedures.
- **Decisions:** [docs/decisions/](docs/decisions/) records ADRs with rationale and status.

## Privacy

claude-mons sends only aggregated event counts and anonymous game state to the server. Prompt text, tool inputs, tool outputs and file paths never leave your machine. Full details in [PRIVACY.md](PRIVACY.md).

## Uninstall

Windows: Settings → Apps → claude-mons → Uninstall. Linux: remove the AppImage or `sudo apt remove claude-mons`. Click **Disconnect Claude Code** in the app's Settings or tray menu first so the hooks are removed from `~/.claude/settings.json`; local data in `` `%APPDATA%\claude-mons` `` (Windows) or `~/.config/claude-mons` (Linux) can then be deleted.

## Code signing

Windows builds are signed through SignPath Foundation at no cost. See [docs/CODE_SIGNING_POLICY.md](docs/CODE_SIGNING_POLICY.md) for the policy and [docs/runbooks/release.md](docs/runbooks/release.md) for the release procedure. Free code signing provided by SignPath.io, certificate by SignPath Foundation.

## License

MIT
