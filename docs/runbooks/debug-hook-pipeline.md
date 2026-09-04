---
doc_type: runbook
purpose: "Use this when the pet does not respond to Claude Code activity (no XP, no stimulus)."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - packages/hook-cli/README.md
  - apps/desktop/README.md
  - apps/desktop/src/main/hooks/HookServer.ts
  - apps/desktop/src/main/hooks/SpoolDrainer.ts
  - apps/desktop/src/main/hooks/binary.ts
  - apps/desktop/src/main/hooks/HookInstaller.ts
---

# Debug the hook pipeline

The pet receives Claude Code activity through a hook binary that POSTs events to the desktop app. When activity is not reflected, diagnose the path from event generation to pet processing.

## Steps

1. **Start the app with debug output.**

```bash
CLAUDE_MONS_DEBUG=1 pnpm dev
```

Watch the console for `HookServer started at port ...` and `endpoint written`. This confirms the HTTP endpoint is listening. Close the app when done.

2. **Verify the endpoint file exists.**

```bash
cat "<userData>/hook-endpoint.json"
```

Replace `<userData>` with the app's actual data directory (shown in the panel's Settings tab). The file should contain `{"v": 1, "port": <number>, "token": "<hex>", "pid": <number>, "startedAt": <timestamp>}`. If missing or empty, the HookServer did not start.

3. **Check that hooks are installed in Claude Code settings.**

```bash
cat ~/.claude/settings.json | jq '.hooks'
```

Look for entries named after `claude-mons-hook` (the binary name). If absent, or if your entries exist but contain `claude-mons-hook`, run the onboarding flow in the app panel (nation choice triggers installer) or manually invoke `HookInstaller.install()`.

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

If the hook binary exits with code 126 in Git Bash, Windows Smart App Control has blocked it. Look in Event Viewer (Applications and Services Logs → Microsoft → Windows → AppControl → Operational) for "Application Control policy has blocked this file". Install a signed binary: update the app to a version signed by the release pipeline, or ask for a pre-signed binary.

8. **Inspect the spool fallback.**

If the app is not running when Claude Code runs, events are written to `<userData>/hook-spool.jsonl` (one JSON envelope per line). The app drains this every 30 seconds on startup. Check for spooled events:

```bash
tail -5 "<userData>/hook-spool.jsonl" | jq .
```

Each line should be valid JSON with `"spooled": true`. If the file grows unbounded, the drainer is stuck or the app is crashing during drain.

9. **Restore settings.json from backup (if corrupt).**

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
- [ ] Hooks are installed in `~/.claude/settings.json` and contain the binary path.
- [ ] Claude Code was restarted after hook installation.
- [ ] Synthetic event via curl returns 204 and appears in app console.
- [ ] Pet gains XP on the next Claude Code activity in a fresh session.
