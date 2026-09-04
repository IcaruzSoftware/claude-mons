---
doc_type: policy
purpose: "Read this when you want to know what data claude-mons collects and where it goes."
audience: both
last_verified: 2026-09-05
last_verified_commit: f198a9d
related_files:
  - PRIVACY.md
  - packages/hook-cli/README.md
  - packages/hook-cli/main.go
  - apps/desktop/src/main/hooks/binary.ts
  - docs/runbooks/delete-a-player.md
  - docs/runbooks/reset-local-state.md
  - supabase/README.md
---

# Privacy

claude-mons is a desktop pet that earns experience while you use Claude Code. This document lists exactly what data is collected and where it goes. In summary: hook events are filtered to metadata only, aggregated event counts are sent to the server for XP calculation, prompt text and file paths never leave your machine, and you can delete your account and local data at any time.

## What the hook forwarder reads

Claude Code invokes `claude-mons-hook` on every hook event (prompts, tool calls, etc.). The forwarder reads the hook event JSON from stdin and keeps only a small whitelist of metadata fields:

- the event name (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd`),
- the session id,
- the tool name and tool-use id,
- the notification type, session source or end reason where present,
- whether a Stop hook is active,
- a 12-character SHA-1 hash of the working directory (so activity can be grouped per project without revealing the path).

Everything else is discarded: prompt text, tool inputs, tool outputs, file contents and transcript paths are never written to disk or sent anywhere. For full technical details, see [`packages/hook-cli/README.md`](packages/hook-cli/README.md).

## What is sent to the server

The app aggregates hook events into per-minute counts (prompts, finished turns, tool calls per tool name) and sends those counts to the project's Supabase backend. The server uses these counts to calculate XP and advance your mon's level and evolution. The app also sends:

- an anonymous account id created by Supabase on first launch (no email, no password needed),
- the nickname you chose (or the randomly generated one),
- your nation, species evolution stage, level and current XP (displayed on the leaderboard),
- battle requests (the request itself, with no additional payload).

The server stores player records (nickname, nation, streak, timestamps), mon records (species, stage, level, XP), per-day and per-minute XP counters (the latter deleted after 48 hours), battle records (both mons' snapshots and the battle log) and battle notifications.

**What is never collected:** prompt text, tool input/output, file contents, transcript paths, telemetry, crash reports, analytics, IP-based location. Supabase receives your IP address as part of normal HTTPS requests; see Supabase's privacy policy for their data handling.

## Local data

State lives in `` `%APPDATA%\claude-mons` `` (Windows) and `~/.config/claude-mons/` (Linux): your mon's game state, app settings, the anonymous account session, the hook spool (envelopes waiting to be sent) and the hook endpoint file. Deleting the entire folder removes everything locally; the server-side player and mon records then become orphaned and are not linked to any new installation of the app.

To reset local data and start over, see [`docs/runbooks/reset-local-state.md`](docs/runbooks/reset-local-state.md).

## Deleting your data

To request deletion of your server-side player record and all associated data, see [`docs/runbooks/delete-a-player.md`](docs/runbooks/delete-a-player.md).

## Uninstalling

**Windows:** Settings → Apps → claude-mons → Uninstall (or run `Uninstall claude-mons.exe` in the install folder). Before uninstalling, click **Disconnect Claude Code** in the app's Settings or tray menu so the hooks are removed from `~/.claude/settings.json`. Local data in `` `%APPDATA%\claude-mons` `` is kept; delete the folder to remove it.

**Linux:** remove the AppImage or `sudo apt remove claude-mons`. Disconnect Claude Code first as above; delete `~/.config/claude-mons/` to remove local data.
