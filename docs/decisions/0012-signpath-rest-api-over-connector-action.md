---
doc_type: decision
purpose: "Read this when you need to know why Windows code signing calls the SignPath REST API from a script instead of using a SignPath GitHub Action."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - .github/workflows/release.yml
  - scripts/signpath-sign.ps1
  - scripts/refresh-latest-yml.mjs
adr_status: accepted
---

# SignPath REST API over connector action

## Context

Windows installers built by `electron-builder` need Authenticode signing so they do not trigger
SmartScreen warnings on install. SignPath (https://signpath.org) offers two integration paths: a
connector-based GitHub Action that signs artifacts through GitHub's OIDC trusted-build-system
attestation, and a plain REST API driven by an API token. The connector action's trusted-build-system
setup is only available to organizations on SignPath plans with that feature enabled; it was not
available on the plan this project has access to (free/trial), so that path could not be used
regardless of its other merits.

Alternative considered:

- **Connector-based GitHub Action**: would need no custom script and ties the signing identity to
  the GitHub OIDC token instead of a bearer secret. Rejected: requires the trusted-build-system
  feature, which this project's SignPath plan does not have.

## Decision

`.github/workflows/release.yml` signs Windows binaries via `scripts/signpath-sign.ps1`, a wrapper
around the official SignPath PowerShell module's `Submit-SigningRequest`, authenticated with
`SIGNPATH_API_TOKEN` / `SIGNPATH_ORGANIZATION_ID` / `SIGNPATH_PROJECT_SLUG`. Signing runs in two
passes because the installer is built from the already-packaged executables: pass 1 signs
`claude-mons.exe` and the hook binary inside the unpacked app (`-ArtifactConfiguration executables`)
before NSIS packages them into the installer, and pass 2 signs the resulting installer `.exe`
(`-ArtifactConfiguration installer`) after packaging. Signing is optional at the workflow level —
if the three secrets/variables are not configured, the `sign` step's `enabled` output stays false
and the workflow still produces an unsigned build rather than failing, so forks and early setup are
not blocked. The workflow currently targets the SignPath Foundation test-signing policy; the
Foundation's OSS release certificate is to be attached to the project later, at which point
`SIGNING_POLICY` moves to `release-signing` for tag builds (already selected by the
`startsWith(github.ref, 'refs/tags/v')` condition in the workflow).

## Consequences

- The workflow depends on a hand-rolled script (`scripts/signpath-sign.ps1`) and the SignPath
  PowerShell module rather than a maintained GitHub Action; upstream changes to SignPath's API
  surface are not picked up automatically and must be noticed and ported manually.
- Because signing happens in two passes with a repackage in between, `apps/desktop/release/latest.yml`'s
  installer SHA-512 and the NSIS blockmap are computed from the pass-1 (unsigned-installer) build artifacts
  and no longer match the pass-2 (signed) installer bytes; `scripts/refresh-latest-yml.mjs` must
  regenerate both after pass 2 or auto-update integrity checks on the installed app will fail.
- The API token is a long-lived bearer secret in GitHub Actions secrets, a weaker isolation boundary
  than the connector action's per-run OIDC attestation would have given.

## Status

Accepted, 2026-09-05
