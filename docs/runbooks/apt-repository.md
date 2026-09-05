---
doc_type: runbook
purpose: "Read this when setting up, publishing to, or rotating keys for the claude-mons APT repository on GitHub Pages."
audience: both
last_verified: 2026-09-05
last_verified_commit: ab12392
related_files:
  - scripts/build-apt-repo.sh
  - scripts/install-claude-mons.sh
  - .github/workflows/release.yml
  - apps/desktop/electron-builder.yml
  - docs/runbooks/release.md
  - docs/runbooks/rotate-secrets.md
  - docs/decisions/0015-apt-repository-on-github-pages.md
---

# APT repository

claude-mons publishes a static, signed APT repository to GitHub Pages so Debian/Ubuntu users get
real upgrades (`apt upgrade`) instead of re-downloading a `.deb` for every release. The `apt` job in
[`.github/workflows/release.yml`](../../.github/workflows/release.yml) builds it from the Linux
`.deb` artifact and pushes it to the `gh-pages` branch, served at
https://icaruzsoftware.github.io/claude-mons/.

## One-time setup (project owner)

### 1. Generate the signing key

Create a parameter file (replace the placeholder passphrase, then remember it):

```bash
cat > gen-key-params.txt <<'EOF'
%echo Generating claude-mons apt signing key
Key-Type: RSA
Key-Length: 4096
Key-Usage: sign
Name-Real: claude-mons apt
Name-Email: 106014197+IcaruzSoftware@users.noreply.github.com
Expire-Date: 0
Passphrase: <choose a strong passphrase, then store it as APT_GPG_PASSPHRASE below>
%commit
%echo done
EOF
gpg --batch --gen-key gen-key-params.txt
rm gen-key-params.txt
```

`Expire-Date: 0` means no expiry; use `Expire-Date: 5y` instead if you would rather force periodic
rotation (see [Key rotation](#key-rotation)).

### 2. Export the key and set the secrets

```bash
key_id="$(gpg --batch --with-colons --list-secret-keys | awk -F: '/^sec/ { print $5; exit }')"
gpg --batch --yes --armor --export-secret-keys "$key_id" > claude-mons-apt-private.asc
gh secret set APT_GPG_PRIVATE_KEY < claude-mons-apt-private.asc
gh secret set APT_GPG_PASSPHRASE
# paste the passphrase from step 1 when prompted; it will not echo to the terminal
rm claude-mons-apt-private.asc
```

Never paste the exported key into chat, an issue, or a commit. Delete the local `.asc` file as soon
as both secrets are set; the workflow only ever needs the GitHub secret copies.

### 3. Enable GitHub Pages

**Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `gh-pages` /
`(root)`**. The branch does not need to exist yet; the first `apt` job run creates it.

### 4. Dry run

```bash
gh workflow run release.yml --ref main -f apt_dry_run=true
gh run watch <run-id>
gh run download <run-id> -n apt-repo-dry-run
```

This builds the repository tree from whatever `.deb` the `linux` job produces on `main`, skips
signing and the `gh-pages` push entirely, and uploads the tree as the `apt-repo-dry-run` artifact.
Inspect it for the expected apt/pool/... and apt/dists/... layout (see [Repository layout](#repository-layout)) before trusting a real publish.

### 5. First real publish

Follow [`docs/runbooks/release.md`](release.md) to tag and push `vX.Y.Z`. The `apt` job runs after
`linux` succeeds and, with both secrets present, signs the repository and pushes it to `gh-pages`.
Once Pages finishes deploying, verify:

```bash
curl -fsSL https://icaruzsoftware.github.io/claude-mons/install.sh | sudo bash
```

## User-facing commands

```bash
# Install (one-time)
curl -fsSL https://icaruzsoftware.github.io/claude-mons/install.sh | sudo bash

# Upgrade (any time after)
sudo apt update && sudo apt upgrade

# Remove
sudo apt remove claude-mons
sudo rm -f /etc/apt/sources.list.d/claude-mons.list /etc/apt/keyrings/claude-mons.gpg
```

The AppImage remains available from GitHub Releases for users who prefer not to add a repository.

## Repository layout

`scripts/build-apt-repo.sh` writes this tree, merging new `.deb` files into whatever the `gh-pages`
checkout already has so old versions stay installable:

```
apt/
  pool/main/c/claude-mons/claude-mons-<version>-linux-amd64.deb   (every published version)
  dists/stable/Release            # signed metadata: Origin/Label/Suite/Codename/Architectures/...
  dists/stable/Release.gpg        # detached signature
  dists/stable/InRelease           # clearsigned Release
  dists/stable/main/binary-amd64/Packages(.gz)
  claude-mons.gpg                  # public key, binary/dearmored (what install.sh downloads)
  claude-mons.asc                  # public key, armored
install.sh                         # copy of scripts/install-claude-mons.sh
index.html
.nojekyll
```

`scripts/build-apt-repo.sh --dry-run` skips the `Release.gpg`/`InRelease`/key-export steps and
prints this tree instead of requiring a key, so it can run without any secret material.

## Key rotation

1. Repeat [step 1](#1-generate-the-signing-key) and [step 2](#2-export-the-key-and-set-the-secrets)
   above with a new passphrase; `gh secret set` overwrites the existing `APT_GPG_PRIVATE_KEY` and
   `APT_GPG_PASSPHRASE` secrets.
2. Push the next tag as usual. The `apt` job signs with the new key and republishes
   apt/claude-mons.gpg / apt/claude-mons.asc with the new public key.
3. Existing installs cached the old public key locally when they ran `install.sh`, so their
   `apt update` will fail signature verification against the new `Release` until they re-run the
   one-liner (which re-downloads the current key). Mention this in `CHANGELOG.md` for the release
   that rotates the key so users know to re-run it.

See also [`docs/runbooks/rotate-secrets.md`](rotate-secrets.md) for the secret names alongside the
project's other rotatable credentials.

## Acceptance

- [ ] `gpg --list-secret-keys` on the owner's machine (not CI) shows the `claude-mons apt` key
- [ ] `APT_GPG_PRIVATE_KEY` and `APT_GPG_PASSPHRASE` are set: `gh secret list`
- [ ] GitHub Pages is configured to deploy from `gh-pages` / `(root)`
- [ ] A `workflow_dispatch` dry run produced the `apt-repo-dry-run` artifact with the expected tree
- [ ] After the first tagged release, `https://icaruzsoftware.github.io/claude-mons/apt/dists/stable/InRelease` is reachable
- [ ] `curl -fsSL https://icaruzsoftware.github.io/claude-mons/install.sh | sudo bash` installs claude-mons on a clean Debian/Ubuntu machine or container
- [ ] `sudo apt upgrade` after a second tagged release picks up the new version
