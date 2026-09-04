---
doc_type: decision
purpose: "Read this when asked why the desktop app is Electron and not Tauri or a game engine."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - apps/desktop/package.json
  - apps/desktop/README.md
  - docs/history/v1-design-2026-09-04.md
adr_status: accepted
---

# Electron Over Tauri, Godot

## Context

The overlay needed: a transparent, frame-less, always-on-top window per pet; per-pixel click-through
toggling so the desktop stays usable everywhere except the sprite; and this had to work
identically enough on Windows 10/11 and Linux X11 (XWayland) for one person to build and maintain.
Three stacks were considered:

- **Tauri v2** — a Rust host with a system webview, much lighter on disk and RAM than Electron.
  Rejected: per-pixel click-through and always-on-top behave less consistently across its Linux
  webview backends (WebKitGTK) and Wayland/XWayland sessions than Chromium's, and it splits the
  codebase across Rust (host) and TypeScript (UI) for a one-person project already committed to a
  TypeScript monorepo.
- **Godot 4** — a real game engine, a natural fit for sprite animation and a state machine. Rejected:
  Godot's transparent, click-through overlay windows are reported unreliable on Linux compositors,
  and it commits the game logic to GDScript (or a C# build), which cannot be the single
  Deno/Node-compatible module `packages/shared` requires for both the desktop app and Supabase Edge
  Functions.
- **Electron + TypeScript** — heavier, but click-through (`setIgnoreMouseEvents`) and
  `alwaysOnTop: 'screen-saver'` are first-class, well-documented APIs on both target platforms, and
  the whole app (main, renderer, shared game logic) stays one language.

## Decision

Build the desktop app on Electron with TypeScript throughout, using `electron-vite` for the
build/HMR pipeline and `electron-builder` for packaging (see `apps/desktop/package.json`).

## Consequences

- One language and one dependency graph across main process, renderer, and the shared game/battle
  logic consumed by Supabase Edge Functions (`packages/shared`).
- Click-through, always-on-top and multi-monitor positioning work the same way on Windows and Linux
  X11/XWayland without platform-specific window-manager code.
- Runtime cost: roughly 150 MB of RAM per running instance and a roughly 115 MB installer, both
  materially larger than a Tauri or native build would produce, borne by every player's machine.
- Native Wayland (no XWayland) stays out of scope for v1: the Wayland protocol forbids
  application-positioned always-on-top windows regardless of toolkit, so this cost is not
  Electron-specific but is not avoided by it either.

## Status

Accepted, 2026-09-04
