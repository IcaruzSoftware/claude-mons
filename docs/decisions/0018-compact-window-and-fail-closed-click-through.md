---
doc_type: decision
purpose: "Read this when questioning why the pet window is always compact (no full-width strip) or why click-through defaults to closed and re-derives itself every tick."
audience: both
last_verified: 2026-09-13
last_verified_commit: 44486b0
related_files:
  - apps/desktop/src/main/windows/PetWindow.ts
  - apps/desktop/src/main/input/CursorTracker.ts
  - apps/desktop/src/main/PetHost.ts
  - apps/desktop/src/main/display.ts
  - docs/decisions/0008-per-pet-overlay-window.md
  - docs/architecture/overlay-window.md
  - docs/architecture/input-and-gestures.md
adr_status: accepted
---

# Compact window and fail-closed click-through

## Context

A live report on the installed Windows build: "the moment the pet walks around it can't be
dragged or interacted with. Sometimes half the screen is covered by the hitbox, sometimes it
seems to be nowhere. The only fix is 'Bring pet back'." Two bugs were confirmed in the code that
predated this ADR ([ADR 0008](0008-per-pet-overlay-window.md)):

1. **The window's own footprint was the blast radius.** The pet's normal "strip" mode
   (`apps/desktop/src/main/windows/PetWindow.ts`, since removed) spanned the *entire work-area
   width* along the bottom edge, so the pet could walk without the window moving. `CursorTracker`
   decided click-through by comparing the OS cursor to the renderer-reported sprite hitbox — but
   if that decision was ever wrong (stale hitbox, a missed update, an exception mid-tick), the
   window that stopped ignoring mouse events was the *whole screen width*, not just the sprite.
   Any click anywhere along the bottom of the screen then landed on the pet window: left-click
   toggled the panel, right-click opened the context menu — exactly the reported "clicking a
   button in Chrome randomly opens the claude-mons menu."
2. **The renderer-reported hitbox and the main-side window geometry could drift apart.**
   `CursorTracker` held a hitbox in window-local coordinates without any way to tell whether it had
   been computed against the window's *current* bounds or a previous mode/position from before a
   hop, drag, or battle-arena switch. `CursorTracker.tick` also only called `setIgnoreMouse` when
   its computed `hovering` value *changed*, treating that cached flag as the source of truth rather
   than re-deriving the decision every tick — so a wrong decision, once made, had no path back to
   correct on its own. "Bring pet back" fixed both symptoms at once only because it happened to
   force a full mode + geometry + display reset (`PetHost.recenterOnPrimary`), not because anything
   detected or repaired the actual drift.

## Decision

Two changes, designed together:

- **The pet window is always compact.** The full-width "strip" mode is removed entirely. The one
  normal mode (`follow`) is a rect about 3 sprite-widths by 2.5 sprite-heights
  (`PetWindow.COMPACT_WIDTH_GRID`/`COMPACT_HEIGHT_GRID`, scaled by sprite scale), positioned so the
  sprite's anchor sits inside it; the sprite moves smoothly within the canvas as the pet walks, and
  `PetHost` hops the window (`PetWindow.followTo`) only once the sprite has drifted more than 1/3
  of the window's width from its center (`apps/desktop/src/main/display.ts:needsHop`), or immediately during a drag,
  fall, landing, or display change. The battle arena mode is unchanged in shape but now shrinks
  back to this same compact window afterward instead of a strip. Consequence: even if click-through
  is ever wrong, at most a few-sprite-widths window can intercept a click — never the whole screen.
- **Click-through fails closed and self-heals every tick.** `CursorTracker` defaults to
  `setIgnoreMouseEvents(true)` from construction, and every tick *re-derives* the ignore decision
  from scratch and re-asserts it unconditionally (not only on change) — `hovering` is now purely a
  record for the edge-triggered hover-card event, never an input to the next tick's decision.
  Accepting input additionally requires: a cursor sample taken within the last 250 ms, a hitbox
  report received within the last 500 ms *and* tagged with the window's current
  `WindowGeometry.geometryVersion` (a counter `PetWindow` bumps on every `setBounds`/`setPosition`),
  the cursor inside the window bounds, and the cursor inside the hitbox inflated by 3 px. Any
  exception during a tick forces click-through closed rather than preserving a possibly-wrong
  state. `PetHost` forces click-through closed and clears the hitbox outright on blur, hide, every
  mode switch, and every display change, instead of waiting for the next tick to notice.
  `PetHost.onPointer` additionally re-checks `CursorTracker.isPointAccepted` before acting on a
  `down`/`contextmenu` event not already part of an active drag, closing the gap between "the
  window stopped ignoring mouse events" and "the OS actually delivered the click."

Hitbox coordinates stay window-local (the simpler of the two options considered — screen-space
reporting would have made the renderer track window position it doesn't otherwise need); the
geometry version tag is what lets the main process tell a window-local hitbox computed against
*this* window's bounds apart from one computed against a since-superseded position or size.

## Consequences

- A stuck-open click-through state can no longer capture the whole screen width — the compact
  window bounds the damage to its own small footprint, and the fail-closed tick self-heals within
  one poll interval regardless.
- The pet's window position now changes more often during ordinary walking (a hop every time the
  sprite drifts a third of the window's width) instead of never moving during a walk; this is a
  deliberate trade against the strip window's zero-hop convenience, made because the strip's blast
  radius was the actual security/UX problem.
- Any code that assumed the window spans a display's full width (the removed `stripBounds`,
  `STRIP_HEIGHT_GRID`, `enterStrip`) had to be deleted; a future feature that wants "the pet
  wanders freely across the whole taskbar without the window visibly hopping" would need to revisit
  this trade-off explicitly rather than resurrecting the strip window as-is.
- That future feature arrived for drag/fall specifically: a third mode, `motion` (`PetWindow`'s
  `enterMotion`/`retargetMotion`), temporarily grows the window to the full display work area for
  the duration of a drag through landing so per-frame hops during a fast fall can't outrun the
  window — see "Motion mode" in `docs/architecture/overlay-window.md`. This is deliberately
  scoped to drag/fall only, kept safe by the same principle this ADR established: even the huge
  motion-mode window only ever accepts input over the renderer-reported sprite hitbox, never its
  own (now much larger) bounds, so click-through still fails closed exactly as before.
- `PetWindow`, `CursorTracker`, and `PetHost` gained slightly more surface area (geometry
  versioning, freshness timers, explicit `forceIgnore` call sites) in exchange for the self-healing
  property; see `docs/architecture/overlay-window.md` and `docs/architecture/input-and-gestures.md` for the current design in full.

## Status

Accepted, 2026-09-13
