---
doc_type: decision
purpose: "Read this when you need to know why claude-mons hosts its own signed APT repository on GitHub Pages instead of a PPA, a third-party package host, or plain .deb downloads."
audience: both
last_verified: 2026-09-05
last_verified_commit: ab12392
related_files:
  - scripts/build-apt-repo.sh
  - scripts/install-claude-mons.sh
  - .github/workflows/release.yml
  - docs/runbooks/apt-repository.md
adr_status: accepted
---

# APT repository on GitHub Pages

## Context

Linux users could until now only install claude-mons by downloading a `.deb` or AppImage from
GitHub Releases for every version; `apt upgrade` never picked up a new release because there was no
APT repository to poll. The Linux package already builds cleanly
(`apps/desktop/electron-builder.yml`'s `deb` target); what was missing was a place to host a
`Packages`/`Release` index that stays reachable and current without new infrastructure.

Alternatives considered:

- **Launchpad PPA**: free and well-known to Ubuntu users, but Ubuntu-only (no Debian, Mint, or other
  derivatives without extra `add-apt-repository` shims) and it builds from a source package
  uploaded to Launchpad's own builders, not the artifact this project's release workflow already
  produces — packaging would have to be duplicated for Launchpad's build system instead of reusing
  `electron-builder`'s output.
- **Cloudsmith / packagecloud**: purpose-built APT hosting with a nicer dashboard and no repository
  maintenance script to write, but both require a third-party account (and, past free-tier limits, a
  paid plan) with its own credentials to manage — another external dependency and secret alongside
  Supabase and SignPath for a single-maintainer project.
- **Plain `.deb` download (status quo)**: zero extra work, but no `apt upgrade` path; users must
  notice a new release and reinstall manually every time, which is the exact gap this decision
  closes.

## Decision

Publish a static APT repository to the `gh-pages` branch, served by GitHub Pages at
https://icaruzsoftware.github.io/claude-mons/ — no new hosting account, reusing infrastructure the
project already has (GitHub Actions, GitHub Pages) for a single-maintainer project. `scripts/build-apt-repo.sh`
builds the `pool`/`dists` layout and signs it with `dpkg-scanpackages`, `apt-ftparchive`, and `gpg`
(all present on `ubuntu-latest` runners), following the same shape as the Windows signing secrets
(`SIGNPATH_API_TOKEN`/`SIGNPATH_ORGANIZATION_ID`) already in use: a key/token secret plus a
passphrase secret, here `APT_GPG_PRIVATE_KEY`/`APT_GPG_PASSPHRASE`. The `apt` job in
`.github/workflows/release.yml` runs after the `linux` job on tag builds, merging
each new `.deb` into the existing `gh-pages` checkout so every previously published version's pool
file is kept — old versions and downgrades stay installable, and only the indices are regenerated.
`scripts/install-claude-mons.sh`, published to the `gh-pages` root as `install.sh`, is the one curl
command users need to run once; after that, `sources.list.d` and the keyring are in place and
`apt upgrade` alone picks up future releases.

## Consequences

- GitHub Pages becomes a dependency for Linux installs and upgrades: if Pages has an outage, new
  installs and upgrades stall, though already-installed pets keep running unaffected.
- The GPG signing key is claude-mons-specific (see [`docs/runbooks/apt-repository.md`](../runbooks/apt-repository.md)),
  which means yet another private key and passphrase pair for the maintainer to protect and rotate,
  on top of the SignPath API token; unlike SignPath's certificate this key is fully self-managed,
  so there is no external approval step but also no external revocation path if it leaks — rotation
  is entirely on the maintainer.
- Because the public key is fetched once by `install.sh` and cached at /etc/apt/keyrings/claude-mons.gpg,
  rotating the signing key requires every existing install to re-run the one-liner (or otherwise
  refresh that file) or their next `apt update` will fail signature verification; this is not
  automatic and must be called out in `CHANGELOG.md` whenever it happens.
- The repository only ever contains one architecture (`amd64`, matching `apps/desktop/electron-builder.yml`'s
  `deb.arch`) and one suite (`stable`); adding another architecture or a `testing` channel later
  means extending `scripts/build-apt-repo.sh`'s fixed component/suite/architecture values, not just
  building more `.deb` files.

## Status

Accepted, 2026-09-05
