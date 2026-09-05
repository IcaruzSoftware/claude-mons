---
doc_type: decision
purpose: "Read this when you need to know why claude-mons can forward Claude Code hook events with curl instead of the Go binary, and why that path has no offline spool."
audience: both
last_verified: 2026-09-05
last_verified_commit: ab12392
related_files:
  - apps/desktop/src/main/hooks/HookServer.ts
  - apps/desktop/src/main/hooks/rawHook.ts
  - apps/desktop/src/main/hooks/HookInstaller.ts
  - apps/desktop/src/main/hooks/mode.ts
  - apps/desktop/src/main/persistence/state.ts
  - docs/architecture/flows/hook-to-xp.md
  - docs/decisions/0007-go-hook-binary.md
adr_status: accepted
---

# curl script-mode hook fallback

## Context

Windows 11 machines with Smart App Control (SAC) turned on refuse to execute an unsigned binary:
`packages/hook-cli/main.go`, cross-compiled per [ADR 0007](0007-go-hook-binary.md), is unsigned
until the SignPath Foundation certificate lands (`docs/CODE_SIGNING_POLICY.md`). SAC does not block
the file copy in `apps/desktop/src/main/hooks/binary.ts:ensureHookBinary`; it blocks the OS from
starting the process, so Claude Code's hook invocation fails with "An Application Control policy
has blocked this file" and the spawned command exits 126 (observed from Git Bash) — the pet
receives no events at all and earns no XP on these machines, silently, until someone checks Event
Viewer.

Alternatives considered:

- **Wait for the signed release.** Rejected as the only fix: signing is planned but not owned by
  this change, and players on SAC-enabled machines need XP credit now, not after a certificate is
  issued.
- **A PowerShell (`.ps1`) script instead of a raw `curl` command line.** Rejected: a script file is
  itself an executable SAC can flag, needs its own install/update path, and `-ExecutionPolicy
  Bypass` is one more thing to explain; a single `curl.exe` invocation needs neither.
- **A Node.js script shelled out via `node`.** Rejected: requires a bundled or system Node runtime
  Claude Code can find on `PATH`, which is not guaranteed, whereas `curl.exe` has shipped with
  Windows since 10 (1803) and is Microsoft-signed, and `curl` ships with macOS and most Linux
  distributions.

Researched via the Claude Code hooks reference (code.claude.com/docs/en/hooks): a hook `command`
with no `args` runs in shell form — Git Bash if installed, otherwise PowerShell, on Windows — so the
exact shell is not under this app's control. This is why the installed command line avoids
redirections, pipes, `&&`/`||`, and quotes: none of those are needed when header values contain no
spaces, so the same literal command line tokenizes identically under `cmd.exe`, PowerShell, and Git
Bash. `curl.exe` (not the bare `curl`, which PowerShell aliases to `Invoke-WebRequest`, an
incompatible flag set) is used explicitly on Windows. The reference also confirms non-zero, non-2
exit codes from `PostToolUse`/`Stop` are non-blocking, and from `UserPromptSubmit` only add a
"hook error" notice without blocking the prompt — so a `curl` timeout or connection failure (the app
not running) degrades to a missed event rather than an error surfaced to the user or the model.

## Decision

Add a second, mode-selectable delivery path next to the existing Go binary, chosen automatically
per machine:

- `HookServer` (`apps/desktop/src/main/hooks/HookServer.ts`) now also accepts `POST /hook`: raw
  Claude Code hook JSON authenticated by an `X-Claude-Mons-Token` header (no space before the
  colon, so the installed command needs no quoting) instead of the binary's bearer token. The pure
  function `apps/desktop/src/main/hooks/rawHook.ts:rawHookToEnvelope` reduces that JSON to the same
  metadata whitelist as `packages/hook-cli/main.go:buildEnvelope` (never prompt text, tool
  input/output, or transcript paths), then the result is validated the same way as the binary's
  envelopes (`parseHookEnvelope`) before it ever reaches `GameService` or `ActivityTracker`.
- The bind port (`LocalState.hooks.port`, default 51733, falling back to +1..+20 if taken) and the
  script token (`LocalState.hooks.token`, minted once) are now persisted, unlike the random
  per-start port and bearer token still used for `/event` — a script-mode hook command is baked
  into `~/.claude/settings.json` once and must keep working after the app restarts.
- `apps/desktop/src/main/hooks/mode.ts:probeBinary` actually spawns the installed binary
  (`--event SessionStart`, empty stdin) at app start rather than trusting that a file existing on
  disk means it can run; `EACCES`/`EPERM`/unknown spawn errors and exit code 126 mean "blocked",
  `ENOENT` means "missing", only exit 0 means "ok". `LocalState.hooks.mode` (`auto` default,
  `binary`, or `script`) plus this probe decide the effective mode; `auto` picks `script` for
  anything other than a confirmed-working binary.
- `HookInstaller` (`apps/desktop/src/main/hooks/HookInstaller.ts`) builds one identical `curl`
  command line for all seven hook events (Claude Code already includes `hook_event_name` in the
  JSON body, so no per-event argument is needed) and recognizes hooks it owns by either the binary
  marker (`claude-mons-hook`) or the script marker (`X-Claude-Mons-Token:`), so install, uninstall,
  status and mode switches all work uniformly regardless of which mode is currently on disk.

## Consequences

- Script mode has no offline spool: `packages/hook-cli/main.go:spool` only exists in the Go binary,
  so an event posted while the app is not running (or before the app has opened the port) is simply
  lost rather than queued in `hook-spool.jsonl`. This is an accepted, documented gap (players who
  need the binary blocked by SAC are still better served by lossy script mode than by no XP at all)
  and is called out in the Settings UI mode hint. Signing the binary is a stopgap fix, not a
  permanent one, for this ADR: once it lands, the probe should start reporting `ok` on previously
  blocked machines, and `auto` mode moves them back to the binary (and its spool) with no player
  action needed — the fixed port/token this ADR adds stays regardless of which mode is active.
- The raw JSON now enters the main process from an untrusted local caller (any process that can
  read the token can POST arbitrary JSON to `127.0.0.1:<port>/hook`), same trust boundary as the
  existing bearer-token `/event` route; the whitelist reduction happens before any of it is stored
  or forwarded, so this changes nothing about what data leaves the machine (see `PRIVACY.md`).
