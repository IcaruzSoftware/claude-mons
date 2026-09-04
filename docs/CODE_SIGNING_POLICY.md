# Code signing policy

claude-mons distributes signed Windows binaries. This policy describes who may produce them and how a
signed artifact can be traced back to source code.

## What is signed

- `claude-mons.exe` (the Electron application)
- `claude-mons-hook.exe` (the Claude Code hook forwarder, written in Go)
- `claude-mons-<version>-win-x64.exe` (the NSIS installer)

Linux builds (AppImage, deb) are not signed.

## How binaries are produced

Every signed binary is built by GitHub Actions from a tagged commit of
https://github.com/IcaruzSoftware/claude-mons using `.github/workflows/release.yml`. No binary built on a
developer machine is ever signed. The workflow:

1. checks out the tagged commit,
2. compiles the hook binary and bundles the Electron app,
3. submits the executables and then the installer to SignPath, which signs them with a certificate whose
   private key lives on SignPath's hardware security module,
4. publishes the signed installer together with its checksums (`latest.yml`) to GitHub Releases.

Signing requests reference the exact workflow run, so any signed file can be matched to the commit that
produced it.

## Roles

| Role | Who | Responsibility |
|---|---|---|
| Author | committers of the repository (currently the maintainer, Gerrit Visser) | Write code; changes land on `main` through reviewed pull requests or direct commits by the maintainer |
| Reviewer | the maintainer | Reviews every contribution from non-committers before merge, with particular attention to build scripts, `.github/workflows/*`, `scripts/*`, `electron-builder.yml` and `packages/hook-cli` |
| Approver | the maintainer | Approves each release signing request in SignPath before the certificate is used |

All accounts involved (GitHub, SignPath) use multi-factor authentication.

## Release procedure

1. Bump the version in `apps/desktop/package.json`, update `CHANGELOG.md`, commit to `main`.
2. Push a tag `vX.Y.Z`. The release workflow builds and submits signing requests under the
   `release-signing` policy.
3. The approver checks the signing request (workflow run, commit, artifact list) in SignPath and approves.
4. The workflow publishes the signed installer; the auto-updater picks it up from GitHub Releases.

Manual `workflow_dispatch` runs use a self-signed test certificate and are never published.

## Reporting

Suspected misuse of the certificate or a signed binary that does not match its source: open a GitHub
issue or contact the maintainer through the repository's security contact. Signing can be paused at any
time by deactivating the SignPath policy.

## Attribution

Free code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org).
