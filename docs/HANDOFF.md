# v1 hand-off notes

Written at the end of the autonomous build run on 2026-09-04. Everything below was done without
user feedback after the plan was approved; read this before judging what you see on screen.

## What exists

| Area | State | Verified how |
|---|---|---|
| Transparent pet overlay (strip window on the taskbar edge, click-through except on the sprite, drag, fall, shake) | done | scripted mouse input on this Windows 11 machine; `--capture` PNGs |
| Behavior engine (idle/walk/sit/sleep, thinking/working/success, hatching/evolving, battle states) | done | 21 reducer tests, headless sim script, live run |
| Sprites: egg + 8 species x 3 stages + FX, all authored as pixel matrices | done | 643 invariant tests, preview PNGs reviewed by the art agents |
| Claude Code hooks: Go forwarder, localhost endpoint, spool fallback, settings.json installer | done | live run with the real binary (pet reacted, 18 XP credited), spool credited after restart |
| XP economy with caps, daily bonus, streak; identical code on client and server | done | 15 tests + Deno pipeline tests; live sync matched server totals |
| Nation selection, panel (Mon / Leaderboard / Battles / Settings), hover card, tray | done | panel captures; live snapshot |
| Supabase: schema, RLS, RPCs, 4 Edge Functions, deployed to `dbeotjfprckdrymmpexv` | done | migration applied via Management API; profile/ingest/battle/heartbeat exercised from the app |
| Battles: shake -> server (or offline Wild Mon) -> animated playback with HP bars | done | live battle vs a Wild Bubblit; offline battle via `--dev-battle` |
| Packaging: NSIS installer, AppImage/deb config, auto-update, autostart, release workflow | built on Windows | `release/claude-mons-0.1.0-win-x64.exe` (115 MB) launches; Linux builds only in CI (not yet run) |

## Things I could not verify here (please check)

- **Linux.** Nothing ran on Linux. The window flags, autostart `.desktop` file, AppImage/deb targets and the tray fallback are written per the plan but untested. Native Wayland is out of scope (XWayland works by design; needs a real test).
- **Windows Smart App Control blocks the Go hook binary.** This machine has Smart App Control ON. The first build of `claude-mons-hook.exe` ran fine in the morning; a rebuild with an identical source was blocked in the evening ("An Application Control policy has blocked this file"). Unsigned binaries get no reputation. Users with SAC on will need a signed binary, or they will see "Connect Claude Code" work but no XP. Options: sign the binary (and the installer) with a code-signing cert, or ship the hook as a script for those users. The Electron app itself was not blocked.
- **Multi-monitor.** Only one display here. Re-anchoring on drop and display changes are implemented and unit-tested, not exercised live.
- **A second real player.** Matchmaking against real opponents only ran through the Wild Mon fallback (you are the only player). `pick_opponent` is unit-reviewed, not exercised.
- **Auto-update.** `electron-updater` is wired, but no release has been published yet, so the update path is untested. Tag `v0.1.0` to exercise `release.yml`.

## Deviations from docs/DESIGN.md

- Battle balance: probabilistic turn order by speed, damage variance 0.7–1.3, stat growth 2 %/level (`floor(base·(level+49)/50)`). The original 4 %/level with strict speed order made +1 level win ~90 % of mirror matches.
- Nickname is auto-generated on first contact (`Trainer_7980` style) and renamable once per 7 days.
- Hover card is a separate always-on-top window; left click toggles the panel; the tray click opens the panel.
- Battle XP is credited by the server; offline builds credit it locally. Provisional XP earned after a sync batch leaves is preserved on reconciliation.
- Edge Functions import supabase-js via `npm:` specifiers (the function bundler ignores the import map). `heartbeat` runs with `verify_jwt = false`.
- The database password in `.env.local` did not authenticate, so the migration was applied through the Management API with the access token and recorded in `supabase_migrations.schema_migrations`. `npx supabase db push` will work once the password is corrected.

## Local testing aids

```bash
pnpm dev                                   # run with HMR
pnpm --filter @claude-mons/desktop build   # then: apps/desktop/node_modules/.bin/electron apps/desktop
```

Flags (development builds only): `--dev-nation fire|water|earth|air`, `--dev-xp 150`, `--dev-battle`,
`--capture out.png` (writes the pet window and, if open, the panel as PNG after 3 s),
`--simulate packages/shared/scripts/examples/day-in-the-life.json`.
Env: `CLAUDE_MONS_DEBUG=1` (overlay + `[pet]` log lines), `CLAUDE_MONS_OFFLINE=1` (no backend, local hatching).
GDI screenshots (e.g. .NET `CopyFromScreen`) cannot capture the composited Electron window; use `--capture`.

State lives in `%APPDATA%\claude-mons\state.json` (Linux: `~/.config/claude-mons/state.json`). Delete it
for a fresh first launch. The anonymous Supabase session is stored in the same file; deleting it
creates a new player.

## Live data right now

One player exists on the server: `Trainer_7980` (Fire, Sparkit, level 2, 162 XP, one lost Wild
battle) created by the end-to-end test from this machine. Delete it in the dashboard or via SQL if you
want a clean board.

## Suggested next steps

1. Run `pnpm dev`, connect Claude Code from the panel, start a new Claude Code session, watch the egg.
2. Push tag `v0.1.0` to exercise the release workflow and auto-update (needs no secrets).
3. Fix the DB password in `.env.local` so `npx supabase db push` works for the next migration.
4. Apply for SignPath Foundation signing and add the secrets (docs/SIGNING.md); the release workflow is ready.
5. Test on a Linux machine.
