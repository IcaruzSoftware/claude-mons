---
doc_type: decision
purpose: "Read this when questioning why Linux drives pointer input from the window shape and renderer events instead of the cursor poller Windows and macOS use."
audience: both
last_verified: 2026-09-25
last_verified_commit: 11cdc14
related_files:
  - apps/desktop/src/main/windows/PetWindow.ts
  - apps/desktop/src/main/PetHost.ts
  - apps/desktop/src/main/display.ts
  - apps/desktop/src/main/input/CursorTracker.ts
  - apps/desktop/src/renderer/pet/PetRenderer.ts
  - apps/desktop/src/common/ipc.ts
  - docs/decisions/0017-force-x11-backend-on-linux.md
  - docs/decisions/0018-compact-window-and-fail-closed-click-through.md
  - docs/architecture/input-and-gestures.md
  - docs/runbooks/linux-e2e.md
adr_status: accepted
---

# Linux shape-based input

## Context

On Linux the pet rendered correctly but was completely dead to input: hover, left-click, drag and
right-click all did nothing (the owner's repeated report). The cause is the interaction of two
facts, reproduced on the `wayland-xwayland` e2e leg (see
[docs/runbooks/linux-e2e.md](../runbooks/linux-e2e.md)):

- Under (X)Wayland the compositor only reports the pointer to an X client while the pointer is over
  one of that client's own surfaces. `screen.getCursorScreenPoint()` therefore stays frozen at the
  screen centre whenever the cursor is not already over the pet.
- The fail-closed click-through model ([ADR 0018](0018-compact-window-and-fail-closed-click-through.md))
  keeps the pet window input-transparent (`setIgnoreMouseEvents(true)`) until the cursor poller says
  the cursor is over the sprite. But the poller can never see the cursor arrive over the sprite,
  because the window is input-transparent and the app is forced onto XWayland
  ([ADR 0017](0017-force-x11-backend-on-linux.md)). That is a deadlock: no first sample, so no
  input, ever.

The Windows and macOS cursor-polling path is unaffected — there `getCursorScreenPoint()` tracks the
real cursor everywhere — so the fix has to be Linux-only.

## Decision

Replace cursor polling on Linux with a window-shape input model; Windows and macOS keep
`CursorTracker` + `setIgnoreMouseEvents` unchanged.

- **The window's input region is its X11 SHAPE, not `setIgnoreMouseEvents`.** `PetWindow.applyShape`
  calls `win.setShape` with the rects from the pure `display.linuxShapeRects`: in `follow` mode the
  renderer-reported drawn content (the sprite tile ∪ FX, inflated), and the whole window in
  `battle`/`motion` mode so the HUD and a fast fall are never clipped. Pixels and events outside the
  shape fall through to the window below, so click-through still fails closed. The window stays
  input-active (`setIgnoreMouseEvents` is a no-op on Linux), and the shape fails closed to a 1×1 rect
  until the first shape report arrives. `setShape` needs the X11 SHAPE extension (present on every
  mainstream X/XWayland server) and is guarded so its absence cannot crash the overlay.
- **Pointer state comes from the renderer, not the OS cursor.** On Linux the pet renderer streams
  throttled `move`/`leave` pointer events (window-local coordinates); `PetHost.onPointerLinux`
  derives hover and drag from them and hit-tests `down`/`contextmenu` against the renderer-reported
  hitbox. `CursorTracker` does not run on Linux. `move`/`leave` return before the reducer's
  `input:any` stimulation so the ~60 Hz stream cannot flood it.
- **Supporting types:** a pure, unit-tested `display.linuxShapeRects`, plus `PetConfig.linux` and
  `HitboxMessage.shape` on the IPC boundary (`apps/desktop/src/common/ipc.ts`).

## Consequences

- Input works on Linux under X11 and XWayland; both e2e legs pass 6/6, gating against regressions.
- The fail-closed guarantee is preserved by a different mechanism: outside-shape events fall through
  via X SHAPE, and the shape is 1×1 until the first renderer report.
- There are now two input paths to keep in step: cursor polling (Windows/macOS) and shape + renderer
  events (Linux). A change to hit-testing or the drag lifecycle must be made for both.
- The renderer must keep reporting an accurate drawn-content shape; if it stops, the window becomes
  effectively click-through (1×1), which is the safe direction.

## Status

Accepted, 2026-09-25
