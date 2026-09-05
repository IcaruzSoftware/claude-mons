---
doc_type: runbook
purpose: "Use this when the pet does not respond to Claude Code activity (no XP, no stimulus)."
audience: both
last_verified: 2026-09-05
last_verified_commit: ab12392
related_files:
  - packages/hook-cli/README.md
  - apps/desktop/README.md
  - apps/desktop/src/main/hooks/HookServer.ts
  - apps/desktop/src/main/hooks/SpoolDrainer.ts
  - apps/desktop/src/main/hooks/binary.ts
  - apps/desktop/src/main/hooks/HookInstaller.ts
  - apps/desktop/src/main/hooks/mode.ts
  - docs/decisions/0014-curl-script-mode-hook-fallback.md
---

# Debug the hook pipeline

The pet receives Claude Code activity through a hook binary that POSTs events to the desktop app. When activity is not reflected, diagnose the path from event generation to pet processing.

## Steps

1. **Start the app with debug output.**

```bash
CLAUDE_MONS_DEBUG=1 pnpm dev
```

Watch the console for `[hooks] binary probe: <ok|blocked|missing>` and `[hooks] effective mode: <binary|script> (configured: ..., status: ...)`. This confirms which mode is active and why. Close the app when done.

2. **Verify the endpoint file exists.**

```bash
cat "<userData>/hook-endpoint.json"
```

Replace `<userData>` with the app's actual data directory (shown in the panel's Settings tab). The file should contain `{"v": 1, "port": <number>, "token": "<hex>", "pid": <number>, "startedAt": <timestamp>}`. If missing or empty, the HookServer did not start.

3. **Check that hooks are installed in Claude Code settings.**

```bash
cat ~/.claude/settings.json | jq '.hooks'
```

Look for entries containing `claude-mons-hook` (binary mode) or `X-Claude-Mons-Token:` (script mode) — `HookInstaller` recognizes either as ours. If absent, run the onboarding flow in the app panel (nation choice triggers installer), click **Connect** in Settings, or manually invoke `HookInstaller.install()`.

4. **Restart Claude Code after installing or updating hooks.**

Close all Claude Code windows and restart the IDE. The hook binary runs on each tool call; a new session is needed to pick up the new configuration.

5. **Test the binary by hand.**

Set `CLAUDE_MONS_DEBUG=1` and pipe a sample JSON to the hook binary:

```bash
export CLAUDE_MONS_DEBUG=1
echo '{"session_id": "test", "tool_name": "Bash", "cwd": "/tmp"}' | \
  "<userData>/bin/claude-mons-hook" --home "<userData>" --event ToolUse
```

Check stderr for `[hook]` debug output. If exit code is 0, the binary ran; if non-zero or stalled, the binary is not executable (see step 7).

6. **Send a synthetic event with curl (app running).**

Start the app with debug output. In another terminal:

```bash
PORT=$(jq .port < "<userData>/hook-endpoint.json")
TOKEN=$(jq -r .token < "<userData>/hook-endpoint.json")
curl -X POST "http://127.0.0.1:$PORT/event" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"v": 1, "event": "ToolUse", "session_id": "debug"}'
```

A `204 No Content` response means the endpoint accepted it. Check the app console for event processing. If `404`, the token is wrong.

7. **Check for Windows Smart App Control rejection (Windows only).**

If the hook binary exits with code 126 in Git Bash, Windows Smart App Control has blocked it. Look in Event Viewer (Applications and Services Logs → Microsoft → Windows → AppControl → Operational) for "Application Control policy has blocked this file". `apps/desktop/src/main/hooks/mode.ts:probeBinary` detects exactly this at app start (exit 126, or an `EACCES`/`EPERM`/`UNKNOWN` spawn error) and reports `'blocked'`; with `hooks.mode` left at the default `'auto'`, the app then installs the `curl`-based script-mode fallback instead (see [ADR 0014](../decisions/0014-curl-script-mode-hook-fallback.md) and [`packages/hook-cli/README.md`](../../packages/hook-cli/README.md)) — no signed binary is required for the pet to keep earning XP, though script mode has no offline spool. Enable `CLAUDE_MONS_DEBUG=1` and check the console for `[hooks] binary probe: blocked` and `[hooks] effective mode: script`. Installing a signed binary (update the app to a version signed by the release pipeline) restores binary mode's spool once available.

8. **Force a specific hook mode.**

Open the panel's Settings tab and change **Hook mode** from `Auto` to `Binary` or `Script (curl)`; the app reinstalls the hooks in that mode immediately (`ui:set-hook-mode` IPC, `apps/desktop/src/main/App.ts:applyHookMode`). Forcing `Binary` on a machine where the probe reports `blocked` reinstalls the (non-functional) binary command anyway — useful only to confirm the block, not to work around it.

9. **Send a synthetic event to the script-mode route (app running).**

```bash
PORT=$(jq .port < "<userData>/hook-endpoint.json")
TOKEN="<value of LocalState.hooks.token in <userData>/state.json>"
curl -X POST "http://127.0.0.1:$PORT/hook" \
  -H "X-Claude-Mons-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name": "UserPromptSubmit", "session_id": "debug", "cwd": "/tmp"}'
```

A `204 No Content` response with the app console showing the event means script mode works end to end; `404` means the token did not match `LocalState.hooks.token`.

10. **Inspect the spool fallback (binary mode only).**

If the app is not running when Claude Code runs a binary-mode hook, events are written to `<userData>/hook-spool.jsonl` (one JSON envelope per line). The app drains this every 30 seconds on startup. Check for spooled events:

```bash
tail -5 "<userData>/hook-spool.jsonl" | jq .
```

Each line should be valid JSON with `"spooled": true`. If the file grows unbounded, the drainer is stuck or the app is crashing during drain. Script mode has no spool file to inspect — a lost event there simply never appears anywhere (see [ADR 0014](../decisions/0014-curl-script-mode-hook-fallback.md)).

11. **Restore settings.json from backup (if corrupt).**

If step 3 shows invalid JSON, look for timestamped backups:

```bash
ls ~/.claude/settings.json.claude-mons-backup-*
```

The installer keeps the 5 most recent. Restore one if the current file is malformed:

```bash
cp ~/.claude/settings.json.claude-mons-backup-<newest> ~/.claude/settings.json
```

Then return to step 3.

## Acceptance

- [ ] Endpoint file exists with valid port and token.
- [ ] Hooks are installed in `~/.claude/settings.json`, either as the binary path or as a `curl`/`X-Claude-Mons-Token:` command.
- [ ] Claude Code was restarted after hook installation.
- [ ] Synthetic event via `curl` to `/event` or `/hook` (whichever mode is effective) returns 204 and appears in app console.
- [ ] Pet gains XP on the next Claude Code activity in a fresh session.
- [ ] On a machine where the binary probe reports `blocked` or `missing`, `auto` mode installs script mode and XP still credits.
