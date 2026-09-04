---
doc_type: decision
purpose: "Read this when questioning why the hook forwarder is a Go binary instead of a Node script or another compiled language."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - packages/hook-cli/main.go
  - packages/hook-cli/go.mod
adr_status: accepted
---

# Go hook binary

## Context

Claude Code invokes a hook command on every `UserPromptSubmit`, every tool call, and several other
lifecycle events, per running session. Whatever runs there sits directly in the latency of every tool call,
so it must start and exit as fast as possible, and it must be trivially installable (no runtime the user
has to already have, no dependency install step).

Options considered, with approximate cold-start cost and footprint:

| Option | Startup | Size | Rejected because |
|---|---|---|---|
| Node script | 50-90 ms | needs Node installed | slowest option, and depends on a runtime the user may not have on PATH for a non-interactive hook invocation |
| Bun, compiled | 15-35 ms | ~55 MB | large binary to ship per platform, and observed antivirus false positives on compiled Bun executables |
| Rust, compiled | comparable to Go | comparable to Go | equally fast and small, but a harder cross-compile story for the target platforms than Go's built-in `GOOS`/`GOARCH` |
| **Go, stdlib only** | **2-5 ms** | **~2 MB** | (chosen) |

## Decision

`packages/hook-cli` is a Go binary, `stdlib` only (see [../../packages/hook-cli/README.md](../../packages/hook-cli/README.md)
for its flags, whitelisted fields and delivery/spool behavior). It cross-compiles to Windows and Linux
(x64 and arm64) via `GOOS`/`GOARCH` with no C toolchain (`CGO_ENABLED=0`), giving small, dependency-free
binaries per platform that the desktop app bundles as a resource and copies into `<userData>/bin/` on
start.

## Consequences

- The repo carries a second language (Go, stdlib only) alongside the TypeScript majority, with its own
  toolchain, test runner and build step (`pnpm hook:build`) that contributors must have installed.
- Hook latency stays low enough to be invisible per tool call, which is the entire reason this binary
  exists rather than reusing the Node/TypeScript stack already in the repo.
- **Negative consequence**: unsigned Go binaries are blocked by Windows Smart App Control by default —
  observed on the dev machine. Until the binary is code-signed, a user with Smart App Control enabled
  cannot run it unmodified; this is a real deployment gap, not just a theoretical one, and forces either a
  signing pipeline or a documented workaround before wide distribution.
- Because the binary must stay tiny and fast, it deliberately does very little: it whitelists fields,
  POSTs or spools, and never forwards prompt text, tool input/output, or transcript paths — a stricter data
  minimization discipline than would be natural in a general-purpose script.

## Status

Accepted, 2026-09-04
