# claude-mons

**Pokémon, but for Claude Code.** A tiny pixel creature lives on your desktop. Every time you prompt Claude Code, it trains. Hatch it from an egg, level it up, evolve it, climb the global leaderboard, and shake it to battle mons from rival nations.

> Status: **v1 preview**. Windows verified; Linux builds are configured but untested. See [docs/HANDOFF.md](docs/HANDOFF.md) for exactly what has and has not been verified.

## How it works

1. Pick a nation: **Water**, **Fire**, **Earth** or **Air**. Each has a personality and two species.
2. An egg appears on your taskbar edge. Connect Claude Code with one click (adds hooks to `~/.claude/settings.json`; start a new Claude Code session afterwards).
3. Work with Claude Code as usual. Prompts, tool calls and finished turns earn XP. At 100 XP the egg hatches into one of your nation's species (75 % common, 25 % rare), rolled by the server.
4. Level up through Baby (level 2) → Teen (10) → Adult (25). Your nation's weekly XP is its power on the leaderboard.
5. Grab your mon and shake it to challenge a mon from another nation. Battles are automatic, deterministic and replayed as an animation. Ten challenges a day, five minutes apart.

The pet is a minimal overlay: it idles, walks along the taskbar, sleeps when you're away, and reacts while Claude thinks, edits and runs commands. Hover for a stats card, click for the panel, right-click for the menu.

## Install

Installers are produced by the release workflow (`.github/workflows/release.yml`) on tags `v*`: an NSIS installer for Windows and AppImage + deb for Linux. Until the first tagged release, build locally:

```bash
pnpm install
pnpm hook:build                      # Go 1.22+ required; cross-compiles the hook forwarder
pnpm --filter @claude-mons/desktop package:win    # or package:linux
```

The installer lands in `apps/desktop/release/`. Release builds are code-signed through SignPath once the repository secrets exist; see [docs/SIGNING.md](docs/SIGNING.md). Unsigned local builds may be blocked by Windows Smart App Control.

## Development

```bash
pnpm install
pnpm dev            # Electron with hot reload
pnpm check          # lint + typecheck + unit tests (755 tests)
pnpm deno:check     # Edge Functions + shared code under Deno
```

Useful flags for a dev build: `--dev-nation fire`, `--dev-xp 150`, `--dev-battle`, `--capture out.png`, `--simulate <script.json>`; env `CLAUDE_MONS_DEBUG=1`, `CLAUDE_MONS_OFFLINE=1`.

Repository layout:

- `apps/desktop` – Electron app (main process, pet renderer, Preact panel/hover card)
- `packages/shared` – game logic shared with the server (levels, XP caps, species, battle simulator), Deno-compatible
- `packages/sprites` – pixel art as string matrices, rasterizer, preview script
- `packages/hook-cli` – Go binary invoked by Claude Code hooks
- `supabase` – migration, RLS, RPCs, Edge Functions (`create-profile`, `ingest-xp`, `battle-request`, `heartbeat`)
- `docs/DESIGN.md` – the design document; `docs/HANDOFF.md` – v1 verification status

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and [supabase/README.md](supabase/README.md) for deploying the backend.

## Privacy

Full details in [PRIVACY.md](PRIVACY.md), including how to uninstall and delete your data. In short: the hook forwarder sends only event metadata (event type, tool name, session id, a hash of the project path) to the local app. Prompt text, tool inputs and outputs never leave your machine. The server receives aggregated event counts per minute, nothing else. Players are anonymous; the only identity is a generated nickname you can change.

## Uninstall

Windows: Settings → Apps → claude-mons → Uninstall. Linux: delete the AppImage or `sudo apt remove claude-mons`. Click **Disconnect Claude Code** in the app first so the hooks are removed from `~/.claude/settings.json`; local data lives in `%APPDATA%claude-mons` (Windows) or `~/.config/claude-mons` (Linux).

## Code signing

Windows builds are signed in CI; see [docs/CODE_SIGNING_POLICY.md](docs/CODE_SIGNING_POLICY.md). Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## License

MIT
