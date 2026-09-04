---
doc_type: decision
purpose: "Read this when questioning why hook events travel over localhost HTTP with a token and file spool instead of a pipe, socket, or watched file."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - apps/desktop/src/main/hooks/HookServer.ts
  - apps/desktop/src/main/hooks/SpoolDrainer.ts
  - packages/hook-cli/main.go
adr_status: accepted
---

# Localhost hook ingestion with spool

## Context

The hook binary (see [0007-go-hook-binary.md](0007-go-hook-binary.md)) needs a way to hand each event to
the desktop app, which may or may not be running at the time. Several transports were considered:

- **Named pipes / Unix domain sockets**: fast and don't need a port, but require platform-specific code
  paths (Windows named pipes vs. POSIX Unix sockets are different APIs), which the tiny hook binary and the
  app's IPC layer would both have to carry.
- **Append-only file watched with `fs.watch`**: no server process needed, but `fs.watch` is documented as
  unreliable and non-atomic on Windows, which is one of the two target platforms.
- **UDP**: simple and fast, but lossy — a dropped event silently loses XP with no fallback.
- **Localhost HTTP with a random port and bearer token, plus a JSONL spool file for when the app is down**
  (chosen): one code path on both platforms, a normal `node:http` server in the app, and a fallback that
  survives the app not running at all.

## Decision

`apps/desktop/src/main/hooks/HookServer.ts` binds `http` to `127.0.0.1` on a random OS-assigned port,
generates a random 64-hex bearer token, and announces `{ port, token, pid }` in a `0600`-mode
`<userData>/hook-endpoint.json`. It accepts only `POST /event` with the correct bearer token (everything
else, including a wrong token, gets a bare 404) and responds `204` before processing, so the hook binary's
request returns as fast as possible. When the hook binary cannot reach that endpoint (app not running,
stale port file, network error), it appends the event as one JSONL line to `<userData>/hook-spool.jsonl`
instead. `apps/desktop/src/main/hooks/SpoolDrainer.ts` renames the spool aside on start and every 30
seconds, replays each line with `spooled: true`, and deletes the drained file — so no XP is lost to the app
simply not running when an event fired.

## Consequences

- One implementation on both target platforms (Windows, Linux): a normal HTTP server and a normal HTTP
  client, no platform-specific pipe or socket code in either the hook binary or the app.
- The port-file-plus-token scheme keeps the raw hook payload from ever leaving the machine — the binary
  already whitelists which fields it forwards (see [0007-go-hook-binary.md](0007-go-hook-binary.md)), and
  the localhost bearer token additionally means nothing else on the machine can post fabricated events to
  the app without reading a `0600` file first.
- The spool guarantees delivery is eventually consistent even across an app restart, at the cost of a
  small window where spooled events are credited without their original animation (XP yes, animation no,
  per `apps/desktop/src/main/hooks/SpoolDrainer.ts`).
- **Negative consequence**: this is still a local, unauthenticated-to-the-OS-user HTTP server — any other
  process running as the same user that can read `<userData>/hook-endpoint.json` can also POST fabricated
  events to it. The token stops other users and casual network probes, not a malicious local process
  running as the same account.

## Status

Accepted, 2026-09-04
