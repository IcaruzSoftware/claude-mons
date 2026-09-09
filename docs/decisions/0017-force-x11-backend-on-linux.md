---
doc_type: decision
purpose: "Read this when questioning why claude-mons forces X11 backend on Linux instead of using native Wayland."
audience: both
last_verified: 2026-09-09
last_verified_commit: 256f0c3
related_files:
  - apps/desktop/src/main/index.ts
  - apps/desktop/src/main/windows/PetWindow.ts
  - apps/desktop/src/main/display.ts
  - docs/runbooks/verify-on-linux.md
  - docs/decisions/0008-per-pet-overlay-window.md
adr_status: accepted
---

# Force X11 backend on Linux

## Context

First Linux test on Ubuntu 24.04 (GNOME, Wayland session) ran the app under native Wayland, since
some distributions set `ELECTRON_OZONE_PLATFORM_HINT=auto` system-wide. Native Wayland (via
xdg-shell) reveals a critical limitation: a client window cannot position itself, cannot read the
global cursor position, and cannot request always-on-top. These capabilities are essential to the
pet overlay: repositioning during drag/fall, polling the cursor for click-through, and staying above
other windows. This produced seven issues (#1–#7): sprite spawning centred instead of bottom-edge,
landing below ground, drifting past horizontal bounds, disappearing from the top z-order, and
complete input failure (hover/right-click/shake).

Alternatives considered:

- **Native Wayland rewrite using wlr-layer-shell.** This protocol (supported by Sway, KDE, GNOME
  via layer-shell extensions) would provide positioning and always-on-top. However, Electron does
  not expose it; GNOME discourages distributing it; and switching the app entirely to Wayland would
  break X11 users and require ongoing maintenance of two paths.
- **A native helper process for positioning.** A small C utility calling Wayland protocols directly
  would side-step Electron's limitation but requires distributing and launching a binary per session,
  invites sandboxing complications, and is fragile against protocol breakage.
- **Document the workaround and unsupported status.** Leave native Wayland broken and require users
  to switch to X11 sessions. Rejected: every mainstream Linux desktop (GNOME, KDE, Sway) ships
  XWayland, making X11 a reliable fallback with no user effort.

## Decision

`apps/desktop/src/main/index.ts` appends the Chromium switch `ozone-platform x11` before `app.whenReady()`
on Linux, forcing Electron to use XWayland. This is the default unless the environment variable
`CLAUDE_MONS_NATIVE_WAYLAND=1` is set, which disables the override and allows native Wayland (for
experimentation or if future Electron versions expose layer-shell). XWayland is present on all
mainstream distributions as a compatibility layer and supports window positioning, cursor polling,
and always-on-top.

Additionally, `apps/desktop/src/main/windows/PetWindow.ts` now re-asserts always-on-top every 5 s on Linux
(not just Windows), since some X11 window managers drop `_NET_WM_STATE_ABOVE` after focus changes.

## Consequences

- All Linux users run under XWayland, with no decision required; the app works consistently.
- XWayland has a dependency cost (not always pre-installed in minimal distributions) and may see
  fractional scaling render soft/blurry on GNOME (a known X11-under-Wayland compositing limitation,
  not a claude-mons bug).
- The `CLAUDE_MONS_NATIVE_WAYLAND=1` override allows developers to test native Wayland (currently
  broken for all the reasons above) and compare window-manager behavior.
- Long-term solution is blocked on either Electron exposing layer-shell or Wayland protocols evolving
  to let clients position windows (outside the scope of this project). See
  `docs/ROADMAP.md` "Later" section.

## Status

Accepted, 2026-09-09
