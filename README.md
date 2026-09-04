# claude-mons

**Pokémon, but for Claude Code.** A tiny pixel creature lives on your desktop. Every time you prompt Claude Code, it trains. Hatch it from an egg, level it up, evolve it, climb the global leaderboard, and shake it to battle mons from rival nations.

> Status: **in development** (pre-v1). Windows and Linux.

## How it works

1. Pick a nation: **Water**, **Fire**, **Earth** or **Air**. Each has a personality and its own species.
2. An egg appears on your taskbar edge. Connect Claude Code with one click (installs hooks into `~/.claude/settings.json`).
3. Work with Claude Code as usual. Prompts, tool calls and finished turns earn XP. The egg hatches at 100 XP into one of your nation's species (random, with a rare variant).
4. Level up through Baby → Teen → Adult. Your nation's total power shows on the leaderboard.
5. Grab your mon and shake it to enter a battle against another nation's mon. Battles are automatic, short and replayed as an animation.

The pet is a minimal overlay: it idles, walks along the taskbar, sleeps when you're away, and reacts while Claude thinks, edits and runs commands. Hover for a stats card, click for the full panel.

## Development

```bash
pnpm install
pnpm dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full toolchain and [docs/DESIGN.md](docs/DESIGN.md) for the design document.

## Privacy

The hook forwarder only sends event metadata (event type, tool name, session id, a hash of the project path) to the local app. Prompt text, tool inputs and outputs never leave your machine. The server receives aggregated event counts per minute, nothing else.

## License

MIT
