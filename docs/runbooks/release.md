---
doc_type: runbook
purpose: "Create a new release of claude-mons with signed Windows binaries."
audience: both
last_verified: 2026-09-05
last_verified_commit: ab12392
related_files:
  - .github/workflows/release.yml
  - scripts/signpath-sign.ps1
  - scripts/refresh-latest-yml.mjs
  - scripts/build-apt-repo.sh
  - apps/desktop/electron-builder.yml
  - apps/desktop/package.json
  - docs/runbooks/apt-repository.md
---

# Release

Use this runbook when shipping a new version. The workflow builds and signs Windows executables via SignPath Foundation, packages Linux installers, publishes all artifacts to GitHub Releases, and publishes/updates the APT repository on `gh-pages` (see [docs/runbooks/apt-repository.md](apt-repository.md)).

## Prerequisites

SignPath code signing requires one-time setup by a project owner; see the "Setup SignPath" section at the end. Without those secrets, releases build and publish unsigned Windows binaries. The release process itself is the same.

## Steps

1. **Bump version and changelog**

   Edit `apps/desktop/package.json` and set `version` to the new semver (e.g., `0.2.0`). Edit `CHANGELOG.md`, move the "Unreleased" section under a new `## [0.2.0] - YYYY-MM-DD` heading.

2. **Commit and create a git tag**

   ```bash
   git add -A
   git commit -m "Release 0.2.0"
   git tag v0.2.0
   git push origin main v0.2.0
   ```

3. **Trigger the release workflow**

   The workflow `.github/workflows/release.yml` starts automatically when the `v*` tag reaches `origin`. To test signing first without publishing, run:

   ```bash
   gh workflow run release.yml --ref main
   ```

   This `workflow_dispatch` run uses the `test-signing` policy (self-signed certificate). Artifacts appear under **Actions → Release → Artifacts**, not in GitHub Releases.

4. **Monitor the workflow**

   ```bash
   gh run watch <run-id>
   ```

   or visit **Actions** on GitHub and click the run. Expect these jobs:
   - `build (linux)`: compiles and packages AppImage + deb, publishes to Release if `v*` tag
   - `publish apt repository`: runs after `build (linux)`; on a `v*` tag with `APT_GPG_PRIVATE_KEY`/`APT_GPG_PASSPHRASE` configured it merges the new `.deb` into the APT repository on `gh-pages` (`scripts/build-apt-repo.sh`); without those secrets it logs a `::notice::` and does nothing; a `workflow_dispatch` run with `apt_dry_run: true` builds the tree unsigned and uploads it as the `apt-repo-dry-run` artifact instead
   - `build + sign (windows)`: builds unpacked app, signs executables via SignPath, builds NSIS installer, signs installer, refreshes metadata (see `scripts/refresh-latest-yml.mjs`), publishes to Release if `v*` tag

   If `SIGNPATH_API_TOKEN` or `SIGNPATH_ORGANIZATION_ID` secrets are missing, the windows job logs a notice and produces unsigned builds.

5. **Verify build artifacts**

   In the run logs, look for lines like:
   - `signpath-sign: signing request <id> finished with status Completed` (pass 1 and 2 both should complete)
   - `signpath-sign: claude-mons.exe -> Valid (SignPath Foundation)` (indicates a valid signature)
   - `refresh-latest-yml: claude-mons-*.exe sha512 updated` (metadata refreshed after signing; see `scripts/refresh-latest-yml.mjs`)

   If running via tag, navigate to **Releases** and verify that Windows `.exe`, `.blockmap`, and `apps/desktop/release/latest.yml` (plus Linux `.AppImage` and `.deb`) are present.

6. **After the first Foundation-signed release** (project owner only)

   Set `win.publisherName` in `apps/desktop/electron-builder.yml` to the exact certificate subject (typically `SignPath Foundation`). electron-updater will then reject any future unsigned or differently-signed updates, protecting users from tampering.

## SignPath artifact configurations

Two artifact configurations with XML are needed to sign the executables (pass 1) and installer (pass 2). Use these exactly as written in the SignPath dashboard.

`executables` (pass 1: the app exe and the hook binary, uploaded as a GitHub artifact zip):

```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file path="claude-mons.exe">
      <authenticode-sign />
    </pe-file>
    <pe-file path="claude-mons-hook.exe">
      <authenticode-sign />
    </pe-file>
  </zip-file>
</artifact-configuration>
```

`installer` (pass 2: the NSIS installer):

```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file path="*.exe">
      <authenticode-sign />
    </pe-file>
  </zip-file>
</artifact-configuration>
```

## Setup SignPath (one-time, project owner)

1. Apply to [SignPath Foundation](https://about.signpath.io/product/open-source) with the repository URL. Requirements: public repo, OSI license (MIT ✓), real maintainer identity, GitHub Actions builds. Approval takes a few days.

2. In the SignPath dashboard, create project `claude-mons` and:
   - Create two signing policies: `test-signing` (self-signed, for `workflow_dispatch`) and `release-signing` (Foundation certificate, for `v*` tags)
   - Create artifact configurations `executables` and `installer` with the XML from the "SignPath artifact configurations" section above
   - Mark CI user as submitter on both policies

3. In GitHub repository settings, add:
   - Secret `SIGNPATH_API_TOKEN` (SignPath API token with submitter rights)
   - Secret `SIGNPATH_ORGANIZATION_ID` (from SignPath organization page)
   - Variable `SIGNPATH_PROJECT_SLUG` = `claude-mons`

4. Run the workflow once via `workflow_dispatch` to test; it uses `test-signing`.

## Acceptance

- [ ] Verify that the tag `v*` exists and is pushed: `git tag`
- [ ] The workflow run completed without errors: check **Actions** log for job status
- [ ] Signing steps completed (if secrets present): look for "Valid" in `signpath-sign:` log lines
- [ ] Windows, Linux, and metadata files appear in GitHub Releases (for tag push) or Artifacts (for workflow_dispatch)
- [ ] `publish apt repository` ran (`gh-pages` push) or logged a `::notice::` skip if secrets are missing — see [docs/runbooks/apt-repository.md](apt-repository.md)
- [ ] (Post-release) electron-updater can fetch and verify the update: test from a prior version

## What signing does not fix

- **Linux** has no equivalent; AppImage and deb do not require signatures to run
- **SmartScreen reputation** accumulates with downloads; first few hundred installs may show "unrecognized app" even with a valid signature. Smart App Control (the actual blocker) accepts any valid signature from a trusted CA.
- **Unsigned Windows builds** still work locally but are blocked by Smart App Control and flagged by SmartScreen
