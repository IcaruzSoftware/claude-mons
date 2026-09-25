---
doc_type: runbook
purpose: "Create a new release of claude-mons with signed Windows binaries."
audience: both
last_verified: 2026-09-25
last_verified_commit: 2ccd329
related_files:
  - .github/workflows/release.yml
  - scripts/signpath-sign.ps1
  - scripts/refresh-latest-yml.mjs
  - scripts/build-apt-repo.sh
  - apps/desktop/electron-builder.yml
  - apps/desktop/scripts/after-pack.mjs
  - apps/desktop/package.json
  - docs/runbooks/apt-repository.md
  - docs/runbooks/deploy-backend.md
  - docs/decisions/0021-codex-hook-integration.md
  - packages/shared/src/game/xp.ts
---

# Release

Use this runbook when shipping a new version. The workflow builds and signs Windows executables via SignPath Foundation, packages Linux installers, publishes all artifacts to GitHub Releases, and publishes/updates the APT repository on `gh-pages` (see [docs/runbooks/apt-repository.md](apt-repository.md)).

## Prerequisites

SignPath code signing requires one-time setup by a project owner; see the "Setup SignPath" section at the end. Without those secrets, releases build and publish unsigned Windows binaries. The release process itself is the same.

## Backend-first ordering for XP-classification changes

If this release changes how the client classifies hook events into XP categories (e.g.
`packages/shared/src/game/xp.ts`'s `classifyTool`, as ADR 0021 did for Codex's `apply_patch`/
`update_plan`), redeploy the `ingest-xp` Edge Function ([docs/runbooks/deploy-backend.md](deploy-backend.md))
**before** publishing the client release, not after. The server is the authority a reconciliation
corrects local XP against: if the client ships first, it starts sending events the *old* server still
classifies as `read` (weight 0), and the next reconciliation corrects the client's provisional
`mutate`/`meta` XP back down until the server catches up. Deploying the backend first costs nothing —
`ingest-xp` only gains a new classification, it never loses one existing clients rely on.

## app-update.yml (electron-updater's manifest)

Every packaged build must ship a resources/app-update.yml (NSIS install) or the AppImage/deb
equivalent — electron-updater reads it at startup to know which GitHub repo to poll, and a missing
file surfaces to the player as Settings → Updates → `Update check failed: ENOENT: no such file or
directory, open '...\resources\app-update.yml'`.

electron-builder normally writes this file itself from an internal `afterPack` listener, but that
listener only fires when packaging emits the "afterPack" event for a target electron-updater can
use. Two things suppress it, and both apply to how the Windows job packages here:

- A bare `--dir` build packages with electron-builder's own "dir" no-op target, which fails the
  listener's Windows suitability check (it only accepts `nsis`/`nsis-web`/an `electronUpdaterAware`
  `appx`), so it silently skips the write.
- A `--prepackaged <dir>` build (the second pass, building the NSIS installer from an
  already-packaged directory) returns out of `PlatformPackager#doPack` before the "afterPack" event
  is emitted at all — nothing hooked to it, native or custom, runs.

`.github/workflows/release.yml`'s windows job packages in exactly that two-step sequence (`--win
--dir --publish never` so the executables can be signed, then `--win --prepackaged
release/win-unpacked --publish never` to build the installer around the signed files), so without
a fix every installed build shipped with no app-update.yml at all.

The fix is `apps/desktop/scripts/after-pack.mjs`, wired up from `apps/desktop/electron-builder.yml`'s
`afterPack:` key. It runs on every packaging pass (including the `--dir` one, where "afterPack"
still fires normally) and writes resources/app-update.yml itself, but only if the file is not
already there — so it is a no-op wherever electron-builder's native writer already succeeded (a
plain `electron-builder --win` build, or any Linux target, since the suitability check above is
Windows/macOS-only). The content is derived from `apps/desktop/electron-builder.yml`'s `publish:`
block (`provider`, `owner`, `repo`, `releaseType`) plus `packager.appInfo.updaterCacheDirName`.

`apps/desktop/electron-builder.yml` also sets `extraMetadata.name: claude-mons`. electron-builder
derives `updaterCacheDirName` from package.json's `name`, not `productName`; this project's `name`
is the pnpm workspace name @claude-mons/desktop, which sanitizes to `@claude-monsdesktop` and would
give app-update.yml (and electron-updater's on-disk cache directory) an ugly, scope-mangled value.
`extraMetadata` overrides the metadata electron-builder computes packaging info from — package.json
itself is untouched — so both the native writer and `apps/desktop/scripts/after-pack.mjs` end up
with the intended `claude-mons-updater`.

To verify locally: `pnpm --filter @claude-mons/desktop build`, then from `apps/desktop`,
`node_modules/.bin/electron-builder --win --dir --publish never`, then check that
`apps/desktop/release/win-unpacked/resources/app-update.yml` exists and reads:

```yaml
provider: github
owner: IcaruzSoftware
repo: claude-mons
releaseType: release
updaterCacheDirName: claude-mons-updater
```

## Steps

1. **Bump version and changelog**

   Edit `apps/desktop/package.json` and set `version` to the new semver (e.g., `0.3.0` — the current
   released version is `0.2.0`, see `CHANGELOG.md`). Edit `CHANGELOG.md`, move the "Unreleased"
   section under a new `## [0.3.0] - YYYY-MM-DD` heading. Recent releases (`git log --oneline -- CHANGELOG.md`)
   bump both files in the same commit, package.json alongside the changelog entry.

2. **Commit and create a git tag**

   ```bash
   git add -A
   git commit -m "Release 0.3.0"
   git tag v0.3.0
   git push origin main v0.3.0
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

## Signing switch

The repository variable `SIGNPATH_ENABLED` must be `true` for any signing to happen. It is `false` while the SignPath trial quota is exhausted and the only certificate is self-signed; set it to `true` once the Foundation certificate is attached to `release-signing`.

## Releases before 1.0

Tags `v0.*` (and any tag containing a `-`, e.g. a `v1.0.0-beta1` pre-release) are published as GitHub
pre-releases (`prerelease: ${{ startsWith(github.ref_name, 'v0.') || contains(github.ref_name, '-') }}`
in both the `linux` and `windows` jobs' publish steps). Releases `0.1.1` through `0.2.0` have shipped
this way. `apps/desktop/src/main/updater/Updater.ts` sets `autoUpdater.allowPrerelease = true` so
auto-update keeps working during this preview phase — see the "Updater accepts pre-releases" fix
below. Each release needs a version bump in `apps/desktop/package.json` and a `CHANGELOG.md` section.

### Updater fixes behind this

Two bugs had to be fixed for auto-update to work at all during the pre-release phase:

- **Pre-releases were invisible to the updater.** Before the "Release 0.1.1" commit, electron-updater's
  default feed only considers full (non-pre-release) GitHub Releases, so `v0.1.0`-style tags published
  as pre-releases were never offered as updates. `apps/desktop/src/main/updater/Updater.ts` now sets `allowPrerelease = true`, and a
  missing/absent release now reads as "up to date" instead of surfacing a failed check.
- **`autoUpdater` resolved to `undefined` at runtime.** Per commit "Updater: resolve autoUpdater from
  the CommonJS default export": `electron-updater`'s `autoUpdater` export is a CommonJS lazy getter,
  which Node's CJS→ESM named-export detection cannot see — so in the packaged (ESM) main bundle,
  importing the named export directly yielded `undefined` even though `module.exports.autoUpdater`
  (the `default` export) still carried it. `apps/desktop/src/main/updater/interop.ts`'s
  `pickAutoUpdater()` now tries both `mod.autoUpdater` and `mod.default.autoUpdater` and picks
  whichever actually has a working `checkForUpdates` method, so both interop shapes work.

## Signing quota

SignPath's free trial meters the yearly artifact size. Manual `workflow_dispatch` runs therefore build **unsigned** Windows artifacts unless the `sign_test` input is set; only `v*` tag builds sign with `release-signing`. A run that fails with "Yearly quota for artifact size has been exceeded" needs the quota reset or a plan change on the SignPath side; the Linux job and the unsigned Windows artifact are unaffected.

## Acceptance

- [ ] Verify that the tag `v*` exists and is pushed: `git tag`
- [ ] The workflow run completed without errors: check **Actions** log for job status
- [ ] Signing steps completed (if secrets present): look for "Valid" in `signpath-sign:` log lines
- [ ] Windows, Linux, and metadata files appear in GitHub Releases (for tag push) or Artifacts (for workflow_dispatch)
- [ ] `publish apt repository` ran (`gh-pages` push) or logged a `::notice::` skip if secrets are missing — see [docs/runbooks/apt-repository.md](apt-repository.md)
- [ ] The packaged Windows build's `apps/desktop/release/win-unpacked/resources/app-update.yml` exists and has the right `updaterCacheDirName` (see the "app-update.yml" section above)
- [ ] (Post-release) electron-updater can fetch and verify the update: test from a prior version

## What signing does not fix

- **Linux** has no equivalent; AppImage and deb do not require signatures to run
- **SmartScreen reputation** accumulates with downloads; first few hundred installs may show "unrecognized app" even with a valid signature. Smart App Control (the actual blocker) accepts any valid signature from a trusted CA.
- **Unsigned Windows builds** still work locally but are blocked by Smart App Control and flagged by SmartScreen
