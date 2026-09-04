---
doc_type: reference
purpose: "Read this when building or understanding how hook events flow from Claude Code to the desktop app."
audience: agent
last_verified: "2026-09-05"
last_verified_commit: 6d99ae3
related_files:
  - packages/shared/src/hooks/payload.ts
  - apps/desktop/src/main/hooks/binary.ts
  - apps/desktop/src/main/hooks/HookServer.ts
  - apps/desktop/src/main/hooks/SpoolDrainer.ts
---

# hook-cli

Tiny Go binary (Go 1.22, stdlib only) invoked by Claude Code on every tool call and hook event. Reads whitelisted metadata from stdin, creates an envelope, and POSTs it to the running desktop app or spools it for later. Never writes stdout; always exits 0.

## CLI Flags

| Flag | Required | Value | Purpose |
|---|---|---|---|
| `--home` | Yes | `<appDataDir>` | Directory containing hook-endpoint.json (exit if empty) |
| `--event` | Yes | `<HookEventName>` | Event type (or fallback to `hook_event_name` in stdin JSON) |

Set `CLAUDE_MONS_DEBUG=1` to debug to stderr.

## Whitelisted Stdin Fields

Only these fields are extracted from the raw hook JSON and included in the envelope; everything else (prompt text, tool input/output, transcript paths) is dropped:

| Field | Type | Usage |
|---|---|---|
| `session_id` | string | Claude Code session identifier |
| `tool_name` | string | Tool being called (e.g. "Bash", "Read") |
| `tool_use_id` | string | Tool use UUID from Claude API |
| `notification_type` | string | Type of hook event (e.g. "UserPromptSubmit") |
| `source` | string | Event source context |
| `reason` | string | Reason code or message |
| `stop_hook_active` | bool | Whether a Stop hook is presently active |
| `hook_event_name` | string | Fallback event type (overridden by `--event`) |
| `cwd` | string | Working directory → SHA-1(cwd)[:12] → `project` field |

## Envelope Structure

The Go `Envelope` struct (keep in sync with `packages/shared/src/hooks/payload.ts:HookEnvelope`):

```json
{
  "v": 1,
  "id": "<8 random bytes hex>",
  "ts": <UnixMilli>,
  "event": "<HookEventName>",
  "session_id": "<string>",
  "project": "<12-char SHA-1 hash of cwd>",
  "tool_name": "<string>",
  "tool_use_id": "<string>",
  "notification_type": "<string>",
  "source": "<string>",
  "reason": "<string>",
  "stop_hook_active": <bool>,
  "spooled": <bool>
}
```

All fields except `v`, `id`, `ts`, `event`, and `spooled` are optional and omitted if empty.

## Delivery

Reads hook-endpoint.json from `--home` with format:

```json
{"port": <int>, "token": "<string>", "pid": <int>}
```

POSTs the envelope to `http://127.0.0.1:<port>/event` with header `Authorization: Bearer <token>`. Dial timeout 150 ms, total timeout 400 ms, keep-alives disabled. Stdin limited to 64 KiB.

## Spool Fallback

If delivery fails (app not running, stale endpoint, network error), the envelope is appended as a JSONL line to hook-spool.jsonl (mode 0600, O_APPEND). The envelope gets `spooled: true`. Spool refuses writes when the file exceeds 5 MiB (to prevent runaway growth).

## Build Targets

`pnpm hook:build` cross-compiles via `scripts/build.mjs`:

| Target | GOOS | GOARCH | Output |
|---|---|---|---|
| Windows | windows | amd64 | `dist/win-x64/claude-mons-hook.exe` |
| Linux x86 | linux | amd64 | `dist/linux-x64/claude-mons-hook` |
| Linux ARM | linux | arm64 | `dist/linux-arm64/claude-mons-hook` |

Build flags: `-trimpath -ldflags "-s -w"`, `CGO_ENABLED=0`. Go not found exits 0 (build) / 1 (test).

## Desktop App Integration

The desktop app copies the bundled binary into `<userData>/bin/claude-mons-hook[.exe]` and registers it with Claude Code. The function `ensureHookBinary()` in `apps/desktop/src/main/hooks/binary.ts` handles install logic and file selection.

## Tests

| Test | Coverage |
|---|---|
| `TestBuildEnvelopeWhitelistsFields` | Whitelisted fields present, forbidden fields dropped (prompt, tool_input, etc.) |
| `TestBuildEnvelopeExplicitEventWinsAndMalformedInputIsFine` | `--event` flag takes precedence; malformed JSON handled gracefully |
| `TestDeliverPostsWithToken` | POST succeeds, auth header set, spool not created |
| `TestSpoolFallbackWhenAppNotRunning` | No endpoint file → spool; stale port → spool; spool JSONL format valid |
| `TestSpoolRefusesWhenFull` | Spool over 5 MiB → error; size check is pre-append |

Run with `pnpm hook:build && pnpm hook:test` (or via CI in `.github/workflows/ci.yml`).
