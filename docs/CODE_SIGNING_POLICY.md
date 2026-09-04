---
doc_type: policy
purpose: "Read this when you need to understand how Windows builds are code-signed and traced to source."
audience: both
last_verified: 2026-09-05
last_verified_commit: f198a9d
related_files:
  - .github/workflows/release.yml
  - docs/runbooks/release.md
  - docs/runbooks/rotate-secrets.md
---

# Code signing policy

claude-mons distributes signed Windows binaries. This policy describes who may produce them and how a signed artifact can be traced back to source code.

## What is signed

- `claude-mons.exe` (the Electron application)
- `claude-mons-hook.exe` (the Claude Code hook forwarder, written in Go)
- `claude-mons-<version>-win-x64.exe` (the NSIS installer)

Linux builds (AppImage, deb) are not signed.

## How binaries are produced

Every signed binary is built by GitHub Actions from a tagged commit of https://github.com/IcaruzSoftware/claude-mons using [`.github/workflows/release.yml`](../.github/workflows/release.yml). No binary built on a developer machine is ever signed. The workflow builds, signs both the executables and then the installer (two-pass signing), and publishes signed artifacts to GitHub Releases. Signing requests reference the exact workflow run, so any signed file can be matched to the commit that produced it.

For detailed steps, see [`docs/runbooks/release.md`](docs/runbooks/release.md).

## Roles

| Role | Who | Responsibility |
|---|---|---|
| Author | committers of the repository (currently the maintainer, Gerrit Visser) | Write code; changes land on `main` through reviewed pull requests or direct commits by the maintainer |
| Reviewer | the maintainer | Reviews every contribution from non-committers before merge, with particular attention to build scripts, `.github/workflows/*`, `scripts/*`, `apps/desktop/electron-builder.yml` and `packages/hook-cli` |
| Approver | the maintainer | Approves each release signing request in SignPath before the certificate is used |

All accounts involved (GitHub, SignPath) use multi-factor authentication.

## Release procedure summary

1. Bump version in `apps/desktop/package.json`, update `CHANGELOG.md`, commit to `main`.
2. Push tag `vX.Y.Z`. The release workflow builds and submits signing requests.
3. Approver checks the signing request in SignPath and approves it.
4. Workflow publishes the signed installer to GitHub Releases.

For complete steps, see [`docs/runbooks/release.md`](docs/runbooks/release.md). To rotate signing credentials, see [`docs/runbooks/rotate-secrets.md`](docs/runbooks/rotate-secrets.md).

## Reporting

Suspected misuse of the certificate or a signed binary that does not match its source: open a GitHub issue or contact the maintainer through the repository's security contact. Signing can be paused at any time by deactivating the SignPath policy.

## Attribution

Free code signing provided by SignPath.io, certificate by SignPath Foundation.
