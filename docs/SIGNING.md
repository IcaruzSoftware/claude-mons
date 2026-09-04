# Code signing (Windows) via SignPath Foundation

Unsigned Windows binaries are blocked by Smart App Control and flagged by SmartScreen. claude-mons
signs its Windows executables through [SignPath Foundation](https://signpath.org/), which offers
free code signing to open-source projects. Signing runs inside GitHub Actions; no keys ever touch
a developer machine. Nothing in this document is needed for Linux builds.

## One-time setup (project owner)

1. **Apply** at https://about.signpath.io/product/open-source with this repository. Requirements
   they check: OSI license (MIT, yes), public repo, a real maintainer identity, builds produced by
   GitHub Actions. Approval typically takes a few days.
2. In the SignPath dashboard, create the project **`claude-mons`** and:
   - (Foundation/enterprise plans only) connect GitHub Actions as trusted build system and require it
     on the policies;
   - create two **signing policies**: `test-signing` (self-signed test certificate, used for
     `workflow_dispatch` runs) and `release-signing` (the Foundation's public certificate, used for
     `v*` tags; Foundation policies usually require a manual approval click per release);
   - create two **artifact configurations** with the slugs `executables` and `installer`, using the
     XML below.
3. In the GitHub repository settings add
   - secret `SIGNPATH_API_TOKEN` (a SignPath API token with submitter rights),
   - secret `SIGNPATH_ORGANIZATION_ID` (from the SignPath organization page),
   - variable `SIGNPATH_PROJECT_SLUG` = `claude-mons`.
4. Run the release workflow once via **workflow_dispatch**: it uses `test-signing` and proves the
   round trip. Then push a tag `v0.x.y` for a real signed release.

The workflow skips every signing step while the secrets are absent, so unsigned releases keep working
in the meantime.

## Artifact configurations

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

## How the workflow signs

`.github/workflows/release.yml`, job `windows`, uses SignPath's REST API through the official
PowerShell module (`scripts/signpath-sign.ps1`). The connector-based GitHub Action is not used because it
requires the *GitHub.com* trusted build system, which only exists on enterprise and Foundation plans.

1. Build the hook binary and the Electron app; `electron-builder --dir` produces `win-unpacked`.
2. Zip `claude-mons.exe` + `claude-mons-hook.exe`, submit with configuration `executables`, wait, unzip the
   signed files back into `win-unpacked` (`resources/bin/` for the hook).
3. Build the NSIS installer from the pre-packaged directory.
4. Zip the installer, submit with configuration `installer`, wait, replace it, then run
   `scripts/refresh-latest-yml.mjs` so `latest.yml` (sha512, size) and the `.blockmap` match the
   signed bytes; otherwise electron-updater would reject the download.
5. Publish installer, blockmap and `latest.yml` to the GitHub Release.

Manual runs (`workflow_dispatch`) use the `test-signing` policy, tags use `release-signing`. The CI user
that owns `SIGNPATH_API_TOKEN` must be listed as a submitter on both policies.

## After the first signed release

Set `win.publisherName` in `apps/desktop/electron-builder.yml` to the exact certificate subject shown
in the signed file's properties (for Foundation certificates this is `SignPath Foundation`).
electron-updater compares the publisher of a downloaded update with this value, which protects users
against a tampered update server. Leave it unset while releases are unsigned, or updates would be
refused.

## What signing does not fix

- Linux has no equivalent; AppImage/deb do not need signatures to run.
- SmartScreen reputation still builds up over downloads even with a valid signature; the first few
  hundred installs may show "unrecognized app" once. Smart App Control, however, accepts any valid
  signature from a trusted CA, which is the blocker that matters here.
