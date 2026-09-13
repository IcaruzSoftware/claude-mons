---
doc_type: decision
purpose: "Read this when questioning why the pet lives in a small always-on-top window instead of a full-screen transparent overlay layer."
audience: both
last_verified: 2026-09-13
last_verified_commit: 5363066
related_files:
  - apps/desktop/src/main/windows/PetWindow.ts
  - apps/desktop/src/main/display.ts
  - docs/decisions/0017-force-x11-backend-on-linux.md
  - docs/decisions/0018-compact-window-and-fail-closed-click-through.md
adr_status: accepted
---

# Per-pet overlay window

## Context

Two shapes for hosting the desktop pet were considered: a single full-screen, transparent, click-through
window layered over the whole desktop (the pet is drawn somewhere inside it), or one small window per pet
that only covers the area the pet actually needs.

The full-screen layer was rejected on several grounds:

- Electron's mouse-event forwarding for a click-through transparent window (`forward: true` behavior) only
  behaves consistently on Windows and macOS; Linux does not honor it the same way, so a single cross-platform
  full-screen layer would need platform-specific hit-testing workarounds anyway.
- A full-screen transparent window still costs compositing on every frame across the whole screen, even
  though almost all of it is empty.
- Multi-monitor handling is simpler as "which small window is on which display" than as "one giant window
  spanning a virtual desktop that may not even be contiguous."
- Screen-share and screen-recording picker UIs list every window; a full-screen overlay window looks
  alarming or confusing in that list compared to a small, obviously-pet-sized window.

## Decision

Each pet gets its own small, always-on-top, frameless, transparent `BrowserWindow`
(`apps/desktop/src/main/windows/PetWindow.ts`). It runs in one of two modes: **follow** (originally a small
square repositioned only during a drag/fall; since [ADR 0018](0018-compact-window-and-fail-closed-click-through.md)
a compact rect that is always the pet's normal window, hopped whenever the sprite drifts far enough from
its center) or **battle** (a generously-sized arena entered for the duration of a battle, then shrunk back).
Click-through is toggled with `setIgnoreMouseEvents`, re-asserted per platform rather than relying on a
single cross-platform mouse-forward mode. On Windows, `alwaysOnTop` is re-asserted on a timer to survive
"topmost wars" with other always-on-top windows.

## Consequences

- Multi-monitor support and DPI handling stay local to one window's bounds instead of needing to reason
  about a virtual desktop's combined geometry.
- Compositing and hit-testing cost is proportional to the pet's own footprint, not the whole screen.
- **Negative consequence**: any visual effect that needs to draw outside the sprite's own bounding box
  (bigger particle effects, wide FX like celebration bursts) needs the window itself padded or resized for
  that effect, rather than simply drawing into already-available full-screen space — this constrains sprite
  and FX authoring in `packages/sprites`.
- Switching between follow and battle mode is a real mode transition the window and its caller must track
  (`enterFollow`/`enterBattle`/`followTo`), which is extra state that a single always-present full-screen
  layer would not have needed.
- On Linux, native Wayland cannot provide window positioning or always-on-top; XWayland via X11
  backend is forced by default to ensure the overlay works (see [ADR 0017](0017-force-x11-backend-on-linux.md)).
- **Update, [ADR 0018](0018-compact-window-and-fail-closed-click-through.md):** the original design had a
  third mode, **strip**, that spanned the full work-area width so the pet could walk without the window
  moving. That mode was removed: a click-through bug that got stuck "accepting input" while the window was
  a full-width strip let any click along the bottom of the screen reach the pet window. The window is now
  always compact (a few sprite-widths), bounding the damage of any future click-through bug to that small
  footprint regardless of what caused it; see ADR 0018 for the fail-closed click-through design that went
  with it.

## Status

Accepted, 2026-09-04
