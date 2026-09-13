---
doc_type: root
purpose: "Read this when starting with claude-mons, installing, or getting the app running locally."
audience: both
last_verified: 2026-09-13
last_verified_commit: 8a24ac9
related_files:
  - CONTRIBUTING.md
  - PRIVACY.md
  - docs/README.md
  - docs/design/economy.md
  - docs/design/species-and-nations.md
  - docs/design/battle.md
  - docs/design/progression.md
  - docs/design/talent-tree.md
  - docs/architecture/overview.md
  - docs/runbooks/apt-repository.md
  - docs/CODE_SIGNING_POLICY.md
  - CHANGELOG.md
  - docs/ROADMAP.md
---

# claude-mons

**Pokémon, but for Claude Code.** A tiny pixel creature lives on your desktop. Every time you prompt Claude Code, it trains. Hatch it from an egg, level it up, evolve it, climb the global leaderboard, and shake it to battle mons from rival nations.

## How it works

1. Pick a nation: **Water**, **Fire**, **Earth** or **Air**. Each has a personality and two species.
2. An egg appears on your taskbar edge. Connect Claude Code with one click (adds hooks to `~/.claude/settings.json`; start a new Claude Code session afterwards).
3. Work with Claude Code as usual. Prompts, tool calls and finished turns earn [XP](docs/design/economy.md). At the [hatch threshold](docs/design/species-and-nations.md), the egg hatches into one of your nation's species, rarity-weighted and rolled by the server.
4. Level up through Baby → Teen → Adult. Your nation's weekly XP is its power on the leaderboard.
5. Grab your mon and shake it to [challenge a mon from another nation](docs/design/battle.md). Battles are automatic, deterministic and replayed as an animation, subject to a [daily cap and cooldown](docs/design/battle.md). Loadouts (moves, battle stance, a per-nation talent tree) shape how a battle plays out — see [docs/design/progression.md](docs/design/progression.md) and [docs/design/talent-tree.md](docs/design/talent-tree.md).

The pet is a minimal overlay: it idles, walks along the taskbar, sleeps when you're away, reacts while Claude thinks, edits and runs commands, and nags for a water break on a timer. Hover for a stats card, click for the game-styled panel (Mon, Leaderboard, Battles, Settings), right-click for the menu. Optionally link an email in Settings to carry the same mon to a second computer (see [PRIVACY.md](PRIVACY.md)).

## Install

Windows installers and Linux packages are published by the release workflow (`.github/workflows/release.yml`) on tags `v*`.

**Windows and Linux (AppImage/deb):** installers and packages for every tagged release (`v0.1.1` onward) are on [GitHub Releases](https://github.com/IcaruzSoftware/claude-mons/releases).

**Linux (Debian/Ubuntu-family) APT repository:** publishing to GitHub Pages is set up (see [docs/runbooks/apt-repository.md](docs/runbooks/apt-repository.md)) but not live yet — see [docs/ROADMAP.md](docs/ROADMAP.md). Once published, the one-line install will be:

```bash
curl -fsSL https://icaruzsoftware.github.io/claude-mons/install.sh | sudo bash
```

Until then, use the AppImage or `.deb` from GitHub Releases directly.

Building from source:

```bash
pnpm install
pnpm hook:build                      # Go 1.22+ required; cross-compiles the hook forwarder
pnpm --filter @claude-mons/desktop package:win    # or package:linux
```

The installer lands in `apps/desktop/release/`. Windows builds are signed through SignPath once a Foundation certificate is attached (currently pending — see [docs/ROADMAP.md](docs/ROADMAP.md)); until then, tagged releases and local builds alike are unsigned and may be blocked by Windows Smart App Control. See [docs/CODE_SIGNING_POLICY.md](docs/CODE_SIGNING_POLICY.md) and [docs/runbooks/release.md](docs/runbooks/release.md).

## Development

Start the Electron app with hot reload:

```bash
pnpm install
pnpm dev            # Electron with hot reload
```

Before opening a pull request, run:

```bash
pnpm check          # lint + typecheck + unit tests + script tests + docs check
pnpm deno:check     # Edge Functions + shared code under Deno
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

claude-mons sends only aggregated event counts and anonymous game state to the server. Prompt text, tool inputs, tool outputs and file paths never leave your machine. Linking an email (optional, for using the same mon on a second computer) is the only other personal data ever stored. Full details in [PRIVACY.md](PRIVACY.md).

## Uninstall

Windows: Settings → Apps → claude-mons → Uninstall. Linux: remove the AppImage or `sudo apt remove claude-mons`. Click **Disconnect Claude Code** in the app's Settings or tray menu first so the hooks are removed from `~/.claude/settings.json`; local data in `` `%APPDATA%\claude-mons` `` (Windows) or `~/.config/claude-mons` (Linux) can then be deleted.

## Code signing

Windows builds are signed through SignPath at no cost once a SignPath Foundation certificate is attached to the release-signing policy; that step is still pending (see [docs/ROADMAP.md](docs/ROADMAP.md)), so current builds are unsigned. See [docs/CODE_SIGNING_POLICY.md](docs/CODE_SIGNING_POLICY.md) for the policy and [docs/runbooks/release.md](docs/runbooks/release.md) for the release procedure. Free code signing provided by SignPath.io, certificate by SignPath Foundation.

## License

MIT
