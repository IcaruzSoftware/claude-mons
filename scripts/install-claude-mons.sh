#!/usr/bin/env bash
# One-line installer for claude-mons on Debian/Ubuntu-family Linux.
#
# Published to the gh-pages root as install.sh; the documented command is:
#
#   curl -fsSL https://icaruzsoftware.github.io/claude-mons/install.sh | sudo bash
#
# It registers the claude-mons APT repository (signing key + sources.list.d
# entry) and installs the package, so that a plain `sudo apt upgrade`
# picks up future claude-mons releases without re-running this script.
#
# See docs/runbooks/apt-repository.md for the repository layout and how it
# is published.

set -euo pipefail

REPO_URL="https://icaruzsoftware.github.io/claude-mons/apt"
KEY_URL="$REPO_URL/claude-mons.gpg"
KEYRING_PATH="/etc/apt/keyrings/claude-mons.gpg"
SOURCES_PATH="/etc/apt/sources.list.d/claude-mons.list"
SUITE="stable"
COMPONENT="main"
ARCH="amd64"

if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    echo "install-claude-mons: re-running with sudo"
    exec sudo -E bash "$0" "$@"
  fi
  echo "install-claude-mons: this script must run as root (sudo not found)" >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "install-claude-mons: apt-get not found; this installer only supports Debian/Ubuntu-family distributions" >&2
  echo "install-claude-mons: on other distributions, download a .deb or AppImage from https://github.com/IcaruzSoftware/claude-mons/releases" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "install-claude-mons: curl is required but was not found; install it first (apt-get install -y curl)" >&2
  exit 1
fi

echo "install-claude-mons: creating /etc/apt/keyrings"
install -d -m 0755 /etc/apt/keyrings

echo "install-claude-mons: downloading signing key to $KEYRING_PATH"
curl -fsSL "$KEY_URL" -o "$KEYRING_PATH"
chmod 0644 "$KEYRING_PATH"

echo "install-claude-mons: writing $SOURCES_PATH"
printf 'deb [signed-by=%s arch=%s] %s %s %s\n' \
  "$KEYRING_PATH" "$ARCH" "$REPO_URL" "$SUITE" "$COMPONENT" >"$SOURCES_PATH"

echo "install-claude-mons: running apt-get update"
apt-get update

echo "install-claude-mons: installing claude-mons"
apt-get install -y claude-mons

echo "install-claude-mons: done. Future updates: sudo apt upgrade"
