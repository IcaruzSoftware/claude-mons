#!/usr/bin/env bash
# Linux e2e harness: bring up a display environment, launch the real app the way the packaged
# .desktop entry does, drive the REAL X pointer with xdotool, and assert hover/click/drag/
# click-through/right-click at the OS input layer. See docs/runbooks/linux-e2e.md.
#
# Usage: scripts/linux-e2e/run.sh <x11|wayland-xwayland>
# Exit:  0 all steps passed · 1 a step failed · 78 the display environment could not be started.
set -uo pipefail

MODE="${1:?usage: run.sh <x11|wayland-xwayland>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ART="${ARTIFACT_DIR:-$ROOT/artifacts-linux-e2e/$MODE}"
PORT="${CLAUDE_MONS_DEBUG_PORT:-9333}"
PROFILE="$(mktemp -d /tmp/mons-e2e.XXXXXX)"
APP_LOG="$ART/app.log"
XEV_LOG="$ART/xev.log"
SUMMARY="${GITHUB_STEP_SUMMARY:-$ART/summary.md}"
ENV_EXIT=78

mkdir -p "$ART"
: > "$SUMMARY"

PIDS=()
track() { PIDS+=("$1"); }
log() { echo "[e2e:$MODE] $*"; }

cleanup() {
  log "cleanup"
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  # Xephyr/Xvfb children can linger; give them a moment then hard-kill.
  sleep 1
  for p in "${PIDS[@]:-}"; do kill -9 "$p" 2>/dev/null || true; done
  rm -rf "$PROFILE" 2>/dev/null || true
}
trap cleanup EXIT

wait_for() { # wait_for <seconds> <cmd...>
  local secs="$1"; shift
  local end=$(( SECONDS + secs ))
  while (( SECONDS < end )); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

# --- display environment ---------------------------------------------------------------------

start_x11() {
  export DISPLAY=":99"
  Xvfb "$DISPLAY" -screen 0 1920x1080x24 -ac +extension RANDR +extension GLX +render -noreset \
    >"$ART/xvfb.log" 2>&1 &
  track $!
  if ! wait_for 20 xdpyinfo -display "$DISPLAY"; then
    log "Xvfb did not come up"; return 1
  fi
  openbox >"$ART/openbox.log" 2>&1 & track $!
  sleep 1
  # A compositor so the transparent, shaped overlay behaves like it does on a real desktop.
  picom --backend xrender --no-vsync --daemon --log-file "$ART/picom.log" 2>>"$ART/picom.log" || \
    log "picom failed to start (transparency may render opaque); continuing"
  sleep 1
  return 0
}

start_wayland_xwayland() {
  # Headless Wayland compositor + XWayland, so the app (which forces ozone x11) runs under XWayland
  # exactly as it does on the owner's GNOME/Wayland session. Try mutter, then weston.
  export XDG_RUNTIME_DIR="$(mktemp -d /tmp/xdg.XXXXXX)"
  chmod 700 "$XDG_RUNTIME_DIR"
  if command -v mutter >/dev/null 2>&1 && start_mutter; then return 0; fi
  log "mutter unavailable/failed; trying weston"
  if command -v weston >/dev/null 2>&1 && start_weston; then return 0; fi
  log "no headless Wayland compositor with XWayland could be started"
  return 1
}

discover_xwayland_display() {
  # Wait for a new X socket to appear and return its :N display.
  local end=$(( SECONDS + 20 ))
  while (( SECONDS < end )); do
    for sock in /tmp/.X11-unix/X*; do
      [ -e "$sock" ] || continue
      local n=":${sock##*/X}"
      if [ "$n" != ":99" ] && xdpyinfo -display "$n" >/dev/null 2>&1; then
        echo "$n"; return 0
      fi
    done
    sleep 0.5
  done
  return 1
}

start_mutter() {
  # --headless --wayland brings up XWayland by default; that nested X server is what the app (ozone
  # x11) connects to, reproducing the owner's "Wayland session, app forced to XWayland" setup.
  dbus-run-session -- mutter --headless --wayland --virtual-monitor 1920x1080 \
    >"$ART/mutter.log" 2>&1 &
  track $!
  local d
  if ! d="$(discover_xwayland_display)"; then
    log "mutter started but no XWayland display appeared"; return 1
  fi
  export DISPLAY="$d"
  log "XWayland display is $DISPLAY (mutter)"
  return 0
}

start_weston() {
  weston --backend=headless-backend.so --xwayland --width=1920 --height=1080 \
    --socket=wayland-e2e >"$ART/weston.log" 2>&1 &
  track $!
  export WAYLAND_DISPLAY=wayland-e2e
  local d
  if ! d="$(discover_xwayland_display)"; then
    log "weston started but no XWayland display appeared"; return 1
  fi
  export DISPLAY="$d"
  log "XWayland display is $DISPLAY (weston)"
  return 0
}

# --- under-window for the click-through test -------------------------------------------------

start_under_window() {
  # xev's "Event Tester" window sits under the pet; the probe moves it beneath the pet window and
  # clicks a transparent part of the pet — a working click-through delivers ButtonPress to xev.
  : > "$XEV_LOG"
  xev >"$XEV_LOG" 2>&1 & track $!
  wait_for 10 bash -c 'xdotool search --name "^Event Tester$" >/dev/null 2>&1' || \
    log "xev under-window did not appear"
}

# --- app launch ------------------------------------------------------------------------------

launch_app() {
  # Unpacked production build (electron against out/), so app.isPackaged is false and the --dev-*
  # seed flags apply — the asar/AppImage wrapper does not change X11 input behaviour (window flags,
  # ozone platform, transparency, input shape). Launch flags mirror electron-builder.yml's
  # linux.executableArgs (--ozone-platform=x11 --disable-gpu) that the .desktop entry passes.
  export CLAUDE_MONS_OFFLINE=1
  export CLAUDE_MONS_DEBUG=1
  ( cd "$ROOT/apps/desktop" && exec pnpm exec electron out/main/index.js \
      --no-sandbox \
      --ozone-platform=x11 \
      --disable-gpu \
      --user-data-dir="$PROFILE" \
      --remote-debugging-port="$PORT" \
      --dev-nation earth \
      --dev-xp 400 ) >"$APP_LOG" 2>&1 &
  track $!
  wait_for 40 bash -c "curl -sf http://127.0.0.1:$PORT/json/list >/dev/null" || {
    log "DevTools endpoint never came up"; return 1
  }
  wait_for 30 bash -c 'xdotool search --name "^claude-mons pet$" >/dev/null 2>&1' || {
    log "pet window never appeared"; return 1
  }
  return 0
}

# --- main ------------------------------------------------------------------------------------

log "profile=$PROFILE artifacts=$ART"
case "$MODE" in
  x11)               start_x11 || { echo "environment: Xvfb/openbox/picom failed to start" >>"$SUMMARY"; exit "$ENV_EXIT"; } ;;
  wayland-xwayland)  start_wayland_xwayland || { echo "environment: no headless Wayland+XWayland available on this runner" >>"$SUMMARY"; exit "$ENV_EXIT"; } ;;
  *) log "unknown mode $MODE"; exit 2 ;;
esac

log "display up: DISPLAY=$DISPLAY"
xlsclients -display "$DISPLAY" >"$ART/xlsclients-before.txt" 2>&1 || true

start_under_window
if ! launch_app; then
  cp "$APP_LOG" "$ART/app.log" 2>/dev/null || true
  echo "environment: the app or its DevTools endpoint did not start (see app.log)" >>"$SUMMARY"
  exit "$ENV_EXIT"
fi

log "running probe"
CLAUDE_MONS_DEBUG_PORT="$PORT" \
ARTIFACT_DIR="$ART" APP_LOG="$APP_LOG" XEV_LOG="$XEV_LOG" MODE="$MODE" SUMMARY_FILE="$SUMMARY" \
  node "$ROOT/scripts/linux-e2e/probe.mjs"
RC=$?

# Post-mortem environment evidence.
xlsclients -display "$DISPLAY" >"$ART/xlsclients-after.txt" 2>&1 || true
log "probe exit=$RC"
exit "$RC"
