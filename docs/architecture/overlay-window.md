---
doc_type: architecture
purpose: "Read this when changing where the pet's window is, how big it is, or how it behaves across displays and on Linux."
audience: agent
last_verified: 2026-09-13
last_verified_commit: 44486b0
related_files:
  - apps/desktop/src/main/windows/PetWindow.ts
  - apps/desktop/src/main/PetHost.ts
  - apps/desktop/src/main/display.ts
  - apps/desktop/src/main/index.ts
  - apps/desktop/src/main/tray/Tray.ts
  - packages/shared/src/behavior/reducer.ts
  - apps/desktop/test/display.test.ts
  - docs/architecture/input-and-gestures.md
  - docs/decisions/0017-force-x11-backend-on-linux.md
  - docs/decisions/0018-compact-window-and-fail-closed-click-through.md
---

# Overlay window

Where the pet lives on screen: one always-on-top transparent window per pet, the three bounds it
moves between, and how it survives display changes, DPI scaling and Linux compositors. How input
reaches that window — click-through, drag, shake, hover — is `docs/architecture/input-and-gestures.md`.
For the wider process model and IPC channel list see `apps/desktop/README.md` and
`apps/desktop/IPC.md`; for the pet's state machine (idle/walk/dragged/falling/battle_*) see
`docs/design/behavior-engine.md`.

## One window, always compact

`apps/desktop/src/main/windows/PetWindow.ts` owns a single `BrowserWindow` per pet; there is no
separate window per mode. `PetHost` moves and resizes it between three bounds:

- **follow** — the one normal mode, always present outside a drag/fall/battle. A compact rect about
  3 sprite-widths by 2.5 sprite-heights (`PetWindow.COMPACT_WIDTH_GRID`/`COMPACT_HEIGHT_GRID`, grid
  px scaled by sprite scale), positioned so the sprite's anchor sits inside it. The sprite moves
  smoothly within the canvas as the pet walks; `PetHost` only *hops* the window (`PetWindow.followTo`,
  a reposition) once the sprite drifts more than 1/3 of the window's width from its center
  (`apps/desktop/src/main/display.ts:needsHop`), or immediately on an ordinary display change
  (`force: true`). See [ADR 0018](../decisions/0018-compact-window-and-fail-closed-click-through.md)
  for why this replaced an earlier full-work-area-width "strip" window.
- **motion** — entered for the whole of a drag through landing; see "Motion mode" below.
- **battle** — a generously-sized box (`BATTLE_WIDTH_GRID`/`BATTLE_HEIGHT_GRID`) entered by
  `PetHost.playBattle` and left again on `IPC.petBattleDone` (back to `follow`), wide/tall enough
  to fit both mons, hp bars, popups and the banner without depending on banner text width — see
  `docs/architecture/flows/shake-to-battle.md` for the arena sizing and HUD-fitting details.

Bounds math lives in `apps/desktop/src/main/display.ts`: `compactBounds`, `motionBounds` and
`battleBounds` all clamp into the display's work area via `clampRectToArea`, so no window ever has
to hang off a small/secondary display or leave it. `needsHop` is the pure predicate
`PetWindow.followTo` uses to decide whether an anchor update warrants a reposition; `canHopFollow`
is the pure predicate that keeps `followTo` from ever hopping outside `follow` mode.

## Motion mode

Dragging used to reposition the compact `follow` window every frame (`PetWindow.followTo(anchor,
{ force: true })`) all the way through `dragged` → `falling`, the same way an ordinary walk hops it
occasionally. Two bugs traced back to that: a per-frame `setBounds` raced the renderer's paint, so
for one frame the sprite was drawn against bounds the window had already moved past (visible as
stutter/jitter while dragging), and a fast fall could outrun the not-yet-repositioned window before
the next hop landed, clipping the sprite against the window's own edge — reads as the pet "falling
behind" whatever window is underneath, popping back in front once geometry resynced on landing.

`PetWindow` gains a third mode, `motion`, that sidesteps both: on `PetHost.beginDrag`,
`PetWindow.enterMotion()` sizes the window once to the current display's full (clamped) work area
(`apps/desktop/src/main/display.ts:motionBounds`) and never touches its bounds again for the rest of
the drag. The sprite still moves every frame — driven by the reducer's own `pos` from the
`input:grab`/`input:drag` stimuli, exactly as `dragged`/`falling` states already worked — but purely
inside the canvas the (now stationary) window provides, so there is no window move to race the
paint against and no window edge for a fast fall to outrun. The window stays in `motion` mode
through `dragged` → `falling` (regardless of whether a real fall happens, since a release right at
ground level also emits `landed`, see `packages/shared/src/behavior/reducer.ts`'s `input:release`
handler) until the reducer's `landed` effect reaches `PetHost.onLanded`, which computes compact
bounds around the now-resting anchor and switches back with one more `setBounds`
(`PetWindow.enterFollow`, which also bumps `geometryVersion` and calls `reassertTopmost()`).

Dragging across a display boundary re-targets the arena live: `PetHost.onDragMove` compares
`displayContaining(cursor)` against the display it last knew about and, only when it actually
changed, calls `window.setDisplay(target)` + `window.retargetMotion()` (one more `setBounds`) —
never every tick. `PetWindow.enterMotion()` is a no-op if a battle currently owns the window
(`apps/desktop/src/main/display.ts:nextArenaMode` returns the current mode unchanged for a
`drag-start` event when it's already `'battle'`), mirroring `PetHost.beginDrag`'s own `inBattle`
guard as a second line of defense — see "Battle arena mode stays as is."

Click-through does **not** need any special-casing for a window this much larger: `CursorTracker`'s
accept decision (see `docs/architecture/input-and-gestures.md`) was already keyed off the renderer-reported
sprite hitbox, tagged with the current `geometryVersion`, not the window's own bounds — the window
bounds only gate the coarse "is the cursor even inside the window" pre-check. A huge motion-mode
window therefore still only ever accepts input over the sprite itself: while the mouse button stays
down (`CursorTracker.beginDrag()`), the tracker never re-evaluates hover at all (it streams
`onDragMove` samples instead); once released, `PetHost.endDrag` calls `CursorTracker.forceIgnore()`
immediately and every following tick re-derives acceptance from the fresh per-frame hitbox the
falling sprite keeps reporting, same as any other tick. The hover card is explicitly suppressed for
the whole of `motion` mode (not just while the button is held) so it can't flash on mid-fall; FX are
already suppressed for `dragged`/`falling` by `animationFor` (`packages/shared/src/behavior/states.ts`)
regardless of window mode.

Unit-tested in `apps/desktop/test/display.test.ts`: `motionBounds` equals the clamped work area,
`nextArenaMode`'s drag → motion → landed → follow sequence (and the battle veto), and `canHopFollow`.
`PetWindow`/`PetHost` themselves stay Electron-coupled and untested (see "Test coverage" below), but
the mode-transition decision they call into is a pure, tested function.

Window flags, all set in the `PetWindow` constructor unless noted:

| Flag | Value | Note |
|---|---|---|
| `transparent` | `true` | |
| `frame` | `false` | |
| `alwaysOnTop` | `true` | re-set via `setAlwaysOnTop(true, 'screen-saver')`; re-asserted every 5 s on win32 and Linux, and (with `moveTop()`) after every mode switch and on `show()` — see "Z-order re-assertion" below |
| `skipTaskbar` | `true` | |
| `resizable` / `movable` | `false` | bounds are only ever changed programmatically |
| `minimizable` / `maximizable` / `fullscreenable` | `false` | |
| `hasShadow` | `false` | |
| `focusable` | `opts.focusable` (`process.platform !== 'linux'`) | some Linux WMs break always-on-top for unfocusable windows |
| `type` | `'toolbar'` on Linux only | |
| `setVisibleOnAllWorkspaces` | `true`, `{ visibleOnFullScreen: true }` | |
| `setIgnoreMouseEvents` | `true` from construction | fail-closed default; re-derived every tick, see below |
| `webPreferences.sandbox` / `contextIsolation` | `true` | shared preload, see `apps/desktop/IPC.md` |
| `webPreferences.backgroundThrottling` | `false` | keeps the rAF loop running while occluded |

## Integer geometry only

`BrowserWindow.setBounds`/`setPosition`/`setSize` reject any non-integer or non-finite (`NaN`/
`Infinity`) coordinate with `TypeError: Error processing argument at index 0, conversion failure`,
which Electron then surfaces as an uncaught-exception crash dialog. A fractional or `NaN`
coordinate has reached these calls in the wild (observed while shaking an egg, which streams
`CursorTracker` samples at 60 Hz through drag math very quickly). Two independent guards close
this off:

- `apps/desktop/src/main/display.ts:toIntPoint` / `toIntRect` round to the nearest integer and
  return `null` when either input is non-finite. Every `setBounds`/`setPosition`/`setSize` call in
  `PetWindow` goes through the private `setBoundsSafe` wrapper, which calls these helpers and skips
  the native call (logging under `CLAUDE_MONS_DEBUG=1`) instead of ever forwarding a bad value.
  `worldForDisplay`/`compactBounds` additionally round `display.workArea` itself before using it,
  since Electron has been observed to hand back fractional work-area values under fractional
  Windows DPI scaling (125%/150%/175%).
- `CursorTracker.tick` drops a single OS cursor sample outright when
  `screen.getCursorScreenPoint()` comes back non-finite, rather than feeding it into drag/anchor
  math (which would otherwise carry the bad value all the way to `PetWindow.followTo`). The next
  tick tries again; a dropped sample is invisible at 60 Hz.
- As a last line of defense, `apps/desktop/src/main/index.ts` installs `uncaughtException` and
  `unhandledRejection` handlers that log to console and append to `<userData>/crash.log` (capped
  at ~1 MB, oldest history dropped first) instead of letting Electron show its blocking modal and
  take the app down.

## Z-order re-assertion

A dropped pet has been observed ending up behind another always-on-top window (e.g. the Claude
desktop app) after a drag. `PetWindow.reassertTopmost()` (`setAlwaysOnTop(true, 'screen-saver')`
+ `moveTop()`) is called after every mode switch (`enterFollow`, `enterBattle`), on `show()`, and
every 5 s on win32 while visible — `moveTop()` matters because a non-focusable topmost window
(`focusable: false`) can still lose its place in the topmost z-order to another topmost window;
re-asserting the flag alone does not always restore ordering, `moveTop()` does.

## World bounds, ground line, anchor memory

`apps/desktop/src/main/display.ts:worldForDisplay` derives the shared `World` (`minX`, `maxX`,
`groundY`) from a display's `workArea`: `groundY` is the top edge of the work area (so the pet
stands on top of the taskbar/dock), and `minX`/`maxX` keep the sprite's center at least
`apps/desktop/src/main/display.ts:EDGE_MARGIN` (24 DIPs) plus half the sprite width from either
edge. World bounds are always in screen coordinates derived from the display, independent of the
(much smaller) window — the window just follows a point that already lives inside those bounds.
`PetHost.world()` recomputes this whenever sprite scale, stage, or display changes and pushes it
via `IPC.petWorld` plus stimulus `world:bounds`. The reducer's `world:bounds` handler
(`packages/shared/src/behavior/reducer.ts`) clamps `pos.x` into the new `[minX, maxX]` and pulls
`pos.y` up to the new `groundY` while airborne on every such update, so a display/scale change
mid-walk or mid-fall cannot leave the pet outside the new bounds — and, since the window always
hops onto whatever anchor the reducer reports, the pet can never leave the window's ground line
either.

If the pet still ends up stuck or off-screen (e.g. a missed edge case in the above), "Bring pet
back" in the tray/context menu (`apps/desktop/src/main/tray/Tray.ts`) calls
`PetHost.recenterOnPrimary()`: re-anchors the window to the primary display, re-centers the compact
window there, and sends stimulus `world:recenter`, which snaps the model to the center of the (new)
world, on the ground, cancelling any drag/fall/walk in progress (left alone mid-battle, so it
doesn't derail an in-progress battle animation).

Position across restarts and resolution changes is remembered as a fraction, not a pixel: `AnchorMemory`
(`{ displayId, fractionX }`) is produced by `rememberAnchor` and turned back into an absolute `x` by
`restoreAnchorX`, so a saved position survives a display being resized or swapped for one of a
different width.

## Multi-monitor handling

`PetHost.registerDisplayEvents` listens to Electron's `display-added`, `display-removed`, and
`display-metrics-changed`; on any of them it re-resolves the current display by id (falling back to
the primary display if it's gone), calls `PetWindow.setDisplay`, hops the window onto the current
anchor if in `follow` mode, forces click-through closed (`CursorTracker.forceIgnore`), and pushes a
fresh `World`. On drop (`endDrag`), `displayContaining` picks the display whose bounds contain the
cursor, defaulting to the display the pet was already on if none match (e.g. a coordinate in the
gap between two displays). `PetHost.pickInitialDisplay` prefers the display named in the persisted
`AnchorMemory`, falling back to `screen.getPrimaryDisplay()`.

## Linux specifics

`apps/desktop/src/main/index.ts` appends the `ozone-platform x11` Chromium switch before
`app.whenReady()` on all Linux distributions, forcing XWayland even on native Wayland sessions
(unless `CLAUDE_MONS_NATIVE_WAYLAND=1` is set). Native Wayland cannot provide window positioning,
global cursor polling, or always-on-top; see [ADR 0017](../decisions/0017-force-x11-backend-on-linux.md).
Additionally, `enable-transparent-visuals` is appended (required for transparent windows under
X11/XWayland) and, after `ready`, the app waits 300 ms before creating any window — a workaround
for a known Electron/Linux race where a transparent window created immediately after `ready` renders
as an opaque black square.

`PetWindow` and `HoverCardWindow` both set `focusable: false` (actually forced to `false` for
`PetWindow` by `PetHost`'s constructor on Linux) and `type: 'toolbar'` only on Linux, since some
X11 window managers otherwise break always-on-top for unfocusable windows.

`PetWindow.reassertTopmost()` runs every 5 s on Linux (as well as Windows) since some X11 window
managers drop `_NET_WM_STATE_ABOVE` after focus changes; this is triggered by the always-on-top
re-assertion timer (not just mode switches as on Windows).

## Test coverage

| Area | Coverage |
|---|---|
| `apps/desktop/src/main/display.ts` (world bounds, `compactBounds`/`battleBounds`/`motionBounds`, `needsHop`, `canHopFollow`, `nextArenaMode` mode-transition table, `clampRectToArea`, display lookup, anchor memory, `toIntPoint`/`toIntRect`, fractional-work-area rounding) | Unit-tested, `apps/desktop/test/display.test.ts` |
| Banner wrap/shrink/truncate and HUD-clamp helpers (`apps/desktop/src/renderer/pet/bannerFit.ts`) | Unit-tested, `apps/desktop/test/bannerFit.test.ts` |
| Reducer `world:bounds` clamp and `world:recenter` recovery | Unit-tested, `packages/shared/test/behavior.test.ts` |
| `PetWindow`, `PetHost`, `HoverCardWindow` (actual window flags, always-on-top/z-order behavior, transparency, crash-log handlers, battle arena mode switch, motion-mode drag/fall/landing) | No automated test — Electron-coupled; verified manually on Windows (see [ADR 0018](../decisions/0018-compact-window-and-fail-closed-click-through.md)); the mode-transition decision itself is a pure, tested function (`nextArenaMode`/`canHopFollow`, see "Motion mode" above) |
| Linux window flags, `enable-transparent-visuals`, the 300 ms boot delay, XWayland behavior | No automated test; not covered by the manual Windows verification either |

Click-through and gesture coverage is listed in `docs/architecture/input-and-gestures.md`.
