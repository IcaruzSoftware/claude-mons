# Privacy

claude-mons is a desktop pet that earns experience while you use Claude Code. This document lists
exactly what leaves your machine.

## What the hook forwarder reads

Claude Code invokes `claude-mons-hook` on hook events. The forwarder reads the event JSON from stdin and
keeps only:

- the event name (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`,
  `Stop`, `SessionEnd`),
- the session id,
- the tool name and tool-use id,
- the notification type, session source or end reason where present,
- a 12-character hash of the working directory (so activity can be grouped per project without
  revealing the path).

Prompt text, tool inputs, tool outputs, file contents and transcript paths are discarded and never
written to disk or sent anywhere. The forwarder talks only to the claude-mons app on `127.0.0.1`; if
the app is not running it appends the reduced event to a local spool file.

## What is sent to the server

The app aggregates events into per-minute counts (prompts, finished turns, tool calls per tool name)
and sends those counts to the project's Supabase backend to compute XP. It also sends:

- an anonymous account id created by Supabase on first launch (no email, no password),
- the nickname you chose (or the generated one),
- your nation, species, level and XP (shown on the leaderboard),
- battle requests (no payload beyond the request itself).

The server stores: players (nickname, nation, streak, timestamps), mons (species, stage, level, XP),
per-day and per-minute XP counters (the latter deleted after 48 hours), battles (both mons'
snapshots and the battle log) and battle notifications.

Nothing else is collected: no telemetry, no crash reports, no analytics, no IP-based location. Supabase
receives your IP address as part of normal HTTPS requests; see Supabase's privacy policy for their
handling.

## Local data

State lives in `%APPDATA%\claude-mons\` on Windows and `~/.config/claude-mons/` on Linux: game state,
settings, the anonymous session, the hook spool and endpoint file. Deleting the folder removes
everything; the server-side player then becomes orphaned and is not linked to any new install.

## Deleting your data

Open an issue or contact the maintainer with your nickname, and the player row and everything attached
to it will be deleted.

## Uninstalling

Windows: Settings → Apps → claude-mons → Uninstall (or `Uninstall claude-mons.exe` in the install
folder). Before uninstalling, click "Disconnect Claude Code" in the app's Settings or tray menu so the
hooks are removed from `~/.claude/settings.json`; otherwise Claude Code will keep calling a binary that no
longer exists (harmless, but noisy in debug logs). Local data in `%APPDATA%\claude-mons` is kept; delete
the folder to remove it.

Linux: remove the AppImage or `sudo apt remove claude-mons`; disconnect Claude Code first as above;
delete `~/.config/claude-mons` to remove local data.
