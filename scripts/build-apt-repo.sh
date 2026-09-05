#!/usr/bin/env bash
# Build (or extend) a static APT repository for claude-mons.
#
# Merges a directory of new .deb files into an existing "apt/" tree (typically
# a checkout of the gh-pages branch, so previously published pool files stay
# around and old versions remain installable), then regenerates the dists
# indices and signs the Release file.
#
# Usage:
#   scripts/build-apt-repo.sh --deb-dir <dir> --out-dir <dir> [--key-id <id>] [--dry-run]
#
# --deb-dir DIR   Directory containing the new .deb file(s) to add to the pool.
# --out-dir DIR   Directory that contains (or will contain) the "apt/" tree.
#                 Point this at an existing gh-pages checkout to merge with
#                 previously published packages; an empty directory starts a
#                 fresh repository.
# --key-id ID     GPG key id (or fingerprint) used to sign the repository.
#                 Required unless --dry-run is given.
# --dry-run       Skip all GPG signing and key export, and print the resulting
#                 tree instead of requiring a key. Safe to run without any
#                 secret material.
#
# Signing reads the signing passphrase from the APT_GPG_PASSPHRASE environment
# variable (never from an argument, so it never appears in `ps` output or logs).
# The corresponding private key must already be imported into the GPG keyring
# the script runs with (see docs/runbooks/apt-repository.md).
#
# Requires: dpkg-scanpackages, apt-ftparchive (both from the "dpkg-dev" /
# "apt-utils" packages, present on ubuntu-latest runners), gpg, gzip.

set -euo pipefail

ORIGIN="claude-mons"
LABEL="claude-mons"
SUITE="stable"
CODENAME="stable"
ARCH="amd64"
COMPONENT="main"
DESCRIPTION="claude-mons APT repository"

DEB_DIR=""
OUT_DIR=""
KEY_ID=""
DRY_RUN=0

usage() {
  sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --deb-dir)
      DEB_DIR="$2"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    --key-id)
      KEY_ID="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "build-apt-repo: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$DEB_DIR" ] || [ -z "$OUT_DIR" ]; then
  echo "build-apt-repo: --deb-dir and --out-dir are required" >&2
  usage >&2
  exit 2
fi
if [ ! -d "$DEB_DIR" ]; then
  echo "build-apt-repo: --deb-dir does not exist: $DEB_DIR" >&2
  exit 2
fi
if [ "$DRY_RUN" -eq 0 ] && [ -z "$KEY_ID" ]; then
  echo "build-apt-repo: --key-id is required unless --dry-run is given" >&2
  exit 2
fi

for tool in dpkg-deb dpkg-scanpackages apt-ftparchive gzip; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "build-apt-repo: required tool not found: $tool (install dpkg-dev and apt-utils)" >&2
    exit 2
  fi
done
if [ "$DRY_RUN" -eq 0 ] && ! command -v gpg >/dev/null 2>&1; then
  echo "build-apt-repo: required tool not found: gpg" >&2
  exit 2
fi

APT_DIR="$OUT_DIR/apt"
POOL_DIR="$APT_DIR/pool/$COMPONENT"
DISTS_DIR="$APT_DIR/dists/$SUITE"
BINARY_DIR="$DISTS_DIR/$COMPONENT/binary-$ARCH"

mkdir -p "$POOL_DIR" "$BINARY_DIR"

shopt -s nullglob
debs=("$DEB_DIR"/*.deb)
shopt -u nullglob
if [ "${#debs[@]}" -eq 0 ]; then
  echo "build-apt-repo: no .deb files found in $DEB_DIR; regenerating indices from the existing pool only"
fi

echo "build-apt-repo: merging ${#debs[@]} .deb file(s) into $POOL_DIR"
for deb in "${debs[@]}"; do
  package="$(dpkg-deb -f "$deb" Package)"
  if [ -z "$package" ]; then
    echo "build-apt-repo: could not read Package field from $deb" >&2
    exit 1
  fi
  first_letter="$(printf '%s' "$package" | cut -c1)"
  # Debian pool convention: 4-char prefix for "lib*" packages, else first letter.
  case "$package" in
    lib*) section_dir="$(printf '%s' "$package" | cut -c1-4)" ;;
    *) section_dir="$first_letter" ;;
  esac
  dest_dir="$POOL_DIR/$section_dir/$package"
  mkdir -p "$dest_dir"
  # -n: never overwrite an already-published file with the same name (keeps history intact).
  cp -n "$deb" "$dest_dir/"
  echo "build-apt-repo: $deb -> ${dest_dir#"$OUT_DIR/"}/$(basename "$deb")"
done

echo "build-apt-repo: scanning pool and regenerating Packages"
(
  cd "$APT_DIR"
  dpkg-scanpackages --arch "$ARCH" pool /dev/null >"dists/$SUITE/$COMPONENT/binary-$ARCH/Packages"
)
gzip -kf "$BINARY_DIR/Packages"

echo "build-apt-repo: writing Release"
(
  cd "$APT_DIR"
  apt-ftparchive \
    -o "APT::FTPArchive::Release::Origin=$ORIGIN" \
    -o "APT::FTPArchive::Release::Label=$LABEL" \
    -o "APT::FTPArchive::Release::Suite=$SUITE" \
    -o "APT::FTPArchive::Release::Codename=$CODENAME" \
    -o "APT::FTPArchive::Release::Architectures=$ARCH" \
    -o "APT::FTPArchive::Release::Components=$COMPONENT" \
    -o "APT::FTPArchive::Release::Description=$DESCRIPTION" \
    release "dists/$SUITE" >"dists/$SUITE/Release"
)

if [ "$DRY_RUN" -eq 1 ]; then
  echo "build-apt-repo: --dry-run, skipping signing and public key export"
else
  echo "build-apt-repo: signing Release (key $KEY_ID)"
  if [ -z "${APT_GPG_PASSPHRASE:-}" ]; then
    echo "build-apt-repo: APT_GPG_PASSPHRASE is not set" >&2
    exit 1
  fi
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --default-key "$KEY_ID" --detach-sign --armor \
    --output "$DISTS_DIR/Release.gpg" "$DISTS_DIR/Release" \
    <<<"$APT_GPG_PASSPHRASE"
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --default-key "$KEY_ID" --clearsign \
    --output "$DISTS_DIR/InRelease" "$DISTS_DIR/Release" \
    <<<"$APT_GPG_PASSPHRASE"

  echo "build-apt-repo: exporting public key (apt/claude-mons.gpg, apt/claude-mons.asc)"
  gpg --batch --yes --export "$KEY_ID" >"$APT_DIR/claude-mons.gpg"
  gpg --batch --yes --export --armor "$KEY_ID" >"$APT_DIR/claude-mons.asc"
fi

echo "build-apt-repo: tree under $APT_DIR"
find "$APT_DIR" -type f | sort
