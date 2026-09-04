---
doc_type: decision
purpose: "Read this when questioning why the pet lives in a small always-on-top window instead of a full-screen transparent overlay layer."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - apps/desktop/src/main/windows/PetWindow.ts
  - apps/desktop/src/main/display.ts
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
(`apps/desktop/src/main/windows/PetWindow.ts`). It runs in one of two modes: **strip** (spans the work-area
width along the bottom edge, sized to `STRIP_HEIGHT_GRID` scaled by sprite scale, so the pet walks inside it
without the window itself moving) or **follow** (a small square, sized to `FOLLOW_SIZE_GRID`, that the main
process repositions every frame while the pet is being dragged or is falling). Click-through is toggled with
`setIgnoreMouseEvents`, re-asserted per platform rather than relying on a single cross-platform mouse-forward
mode. On Windows, `alwaysOnTop` is re-asserted on a timer to survive "topmost wars" with other
always-on-top windows.

## Consequences

- Multi-monitor support and DPI handling stay local to one window's bounds instead of needing to reason
  about a virtual desktop's combined geometry.
- Compositing and hit-testing cost is proportional to the pet's own footprint, not the whole screen.
- **Negative consequence**: any visual effect that needs to draw outside the sprite's own bounding box
  (bigger particle effects, wide FX like celebration bursts) needs the window itself padded or resized for
  that effect, rather than simply drawing into already-available full-screen space — this constrains sprite
  and FX authoring in `packages/sprites`.
- Switching between strip and follow mode is a real mode transition the window and its caller must track
  (`enterStrip`/`enterFollow`/`followTo`), which is extra state that a single always-present full-screen
  layer would not have needed.

## Status

Accepted, 2026-09-04
