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
  # Headless Wayland compositor (sway/wlroots) + XWayland, so the app (which forces ozone x11) runs
  # under XWayland exactly as it does on the owner's GNOME/Wayland session. We use sway because a
  # virtual-pointer client (wlr-virtual-pointer) can attach a real pointer device to its seat and
  # inject input through the compositor, so events travel compositor -> XWayland -> app. xdotool/XTEST
  # cannot do this under XWayland: XTEST pointer injection only reaches the compositor when it speaks
  # libei/EIS, which headless weston does not, so the pointer never moved and the leg tested nothing
  # (see docs/runbooks/linux-e2e.md).
  export XDG_RUNTIME_DIR="$(mktemp -d /tmp/xdg.XXXXXX)"
  chmod 700 "$XDG_RUNTIME_DIR"
  if ! command -v Xwayland >/dev/null 2>&1; then
    log "Xwayland binary is not installed; the compositor cannot provide an X server"; return 1
  fi
  if ! command -v sway >/dev/null 2>&1; then
    log "sway is not installed; cannot bring up a wlroots headless Wayland session"; return 1
  fi
  start_sway
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

start_sway() {
  # Headless wlroots session. WLR_BACKENDS=headless + WLR_LIBINPUT_NO_DEVICES=1 needs no seat, GPU or
  # physical input; WLR_RENDERER=pixman uses software rendering (the runner has no GPU). A minimal
  # config gives one 1920x1080 output, enables XWayland, and floats every window so it keeps the
  # geometry its client requests (sway tiles by default, which would move the overlay and the xev
  # under-window the click-through test relies on).
  local cfg="$ART/sway.conf"
  cat >"$cfg" <<'EOF'
xwayland enable
output HEADLESS-1 resolution 1920x1080 position 0 0
default_border none
default_floating_border none
# Keep every window at its client-requested position/size (no tiling).
for_window [class=".*"] floating enable
for_window [app_id=".*"] floating enable
# No idle behaviour or bar in a headless test session.
EOF
  WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman LIBGL_ALWAYS_SOFTWARE=1 \
    sway -d -c "$cfg" >"$ART/sway.log" 2>&1 &
  track $!

  # sway creates its IPC socket at $XDG_RUNTIME_DIR/sway-ipc.<uid>.<pid>.sock; discover it so swaymsg
  # (and the probe) can reach it.
  local sock="" end=$(( SECONDS + 20 ))
  while (( SECONDS < end )); do
    sock="$(ls -t "$XDG_RUNTIME_DIR"/sway-ipc.*.sock 2>/dev/null | head -1)"
    [ -n "$sock" ] && [ -S "$sock" ] && break
    sock=""; sleep 0.5
  done
  [ -n "$sock" ] || { log "sway IPC socket never appeared"; return 1; }
  export SWAYSOCK="$sock"
  if ! wait_for 15 swaymsg -t get_version; then
    log "sway IPC not responding on $SWAYSOCK"; return 1
  fi

  # The Wayland socket the virtual-pointer client connects to; swaymsg itself uses SWAYSOCK.
  local wl
  wl="$(ls -t "$XDG_RUNTIME_DIR"/wayland-* 2>/dev/null | grep -v '\.lock$' | head -1)"
  [ -n "$wl" ] && export WAYLAND_DISPLAY="$(basename "$wl")"

  # Give the seat a pointer device before XWayland comes up, so sway advertises pointer capability and
  # assigns the seat to XWayland (without it: "no seat assigned to xwayland" and no X client gets input).
  if ! start_virtual_pointer; then
    log "virtual-pointer client failed; the wayland seat would have no pointer"; return 1
  fi

  # XWayland starts lazily but reserves its display socket up front; discover_xwayland_display's
  # xdpyinfo probe both finds and warms it. That nested X server is what the app (ozone x11) connects
  # to, reproducing the owner's "Wayland session, app forced to XWayland" setup.
  local d
  if ! d="$(discover_xwayland_display)"; then
    log "sway started but no XWayland display appeared"; return 1
  fi
  export DISPLAY="$d"
  log "sway up: SWAYSOCK=$SWAYSOCK WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-?} XWayland DISPLAY=$DISPLAY"
  swaymsg -t get_seats >"$ART/sway-seats-initial.json" 2>&1 || true
  return 0
}

build_vpointer() {
  # Compile the virtual-pointer client from vendored protocol XML (wlr-virtual-pointer is not packaged).
  local dir="$ROOT/scripts/linux-e2e"
  local hdr="$ART/wlr-virtual-pointer-unstable-v1-client-protocol.h"
  local code="$ART/wlr-virtual-pointer-unstable-v1-protocol.c"
  wayland-scanner client-header "$dir/wlr-virtual-pointer-unstable-v1.xml" "$hdr" || return 1
  wayland-scanner private-code  "$dir/wlr-virtual-pointer-unstable-v1.xml" "$code" || return 1
  cc -O2 -I"$ART" -o "$ART/vpointer" "$dir/vpointer.c" "$code" \
    $(pkg-config --cflags --libs wayland-client) || return 1
  return 0
}

start_virtual_pointer() {
  if ! build_vpointer; then log "could not build $ART/vpointer"; return 1; fi
  VP_FIFO="$ART/vp.fifo"; rm -f "$VP_FIFO"; mkfifo "$VP_FIFO" || return 1
  # stdin is the FIFO opened read-write, so the client blocks for the next command and never sees EOF
  # between the probe's line-at-a-time writes.
  "$ART/vpointer" <>"$VP_FIFO" >"$ART/vpointer.log" 2>&1 &
  track $!
  export VP_FIFO
  if ! wait_for 15 bash -c "grep -q 'vpointer: ready' '$ART/vpointer.log'"; then
    log "virtual-pointer client did not report ready"; return 1
  fi
  log "virtual pointer ready (fifo=$VP_FIFO)"
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
  # Only --dev-nation (no --dev-xp): the pet stays a stationary egg, so its hitbox/geometry do not
  # change mid-run (a hatch/evolve would resize the window and thrash click-through timing). The egg
  # exercises every input path this harness asserts (hover, click, drag, click-through, right-click).
  export CLAUDE_MONS_OFFLINE=1
  export CLAUDE_MONS_DEBUG=1
  ( cd "$ROOT/apps/desktop" && exec pnpm exec electron out/main/index.js \
      --no-sandbox \
      --ozone-platform=x11 \
      --disable-gpu \
      --user-data-dir="$PROFILE" \
      --remote-debugging-port="$PORT" \
      --dev-nation earth ) >"$APP_LOG" 2>&1 &
  track $!
  wait_for 40 bash -c "curl -sf http://127.0.0.1:$PORT/json/list >/dev/null" || {
    log "DevTools endpoint never came up"; return 1
  }
  # Gate on the pet renderer target rather than an X window title (Electron's X WM_NAME is not
  # reliably the BrowserWindow title on every WM); the probe locates the X window by geometry.
  wait_for 30 bash -c "curl -sf http://127.0.0.1:$PORT/json/list | grep -q 'pet/index.html'" || {
    log "pet renderer never appeared"; return 1
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
  timeout 240 node "$ROOT/scripts/linux-e2e/probe.mjs"
RC=$?
if [ "$RC" = "124" ]; then
  log "probe timed out after 240s"
  echo "probe timed out after 240s (see app.log / screenshots)" >>"$SUMMARY"
fi

# Post-mortem environment evidence.
xlsclients -display "$DISPLAY" >"$ART/xlsclients-after.txt" 2>&1 || true
log "probe exit=$RC"
exit "$RC"
