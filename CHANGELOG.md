---
doc_type: reference
purpose: "Release notes and version history; check this when seeing claude-mons updates or deciding what version to expect features in."
audience: both
last_verified: 2026-09-05
last_verified_commit: 91c68e5
related_files:
  - docs/history/v1-handoff-2026-09-04.md
  - docs/README.md
---

# Changelog

All notable changes to claude-mons are documented here. See [Keep a Changelog](https://keepachangelog.com/) for format details.

## [Unreleased]

### Added
- Documentation tooling: `scripts/check-docs.mjs` script and CI job to validate doc structure and code references.
- Code signing infrastructure: SignPath Foundation signing pipeline (test certificate verified).
- Privacy policy and code signing policy documentation.
- APT repository: `scripts/build-apt-repo.sh` publishes a signed APT repository to GitHub Pages from the `apt` job in `.github/workflows/release.yml`; `curl -fsSL https://icaruzsoftware.github.io/claude-mons/install.sh | sudo bash` then `sudo apt upgrade` installs and updates claude-mons on Debian/Ubuntu. See `docs/runbooks/apt-repository.md`.
- Script-mode hook fallback: on machines where Windows Smart App Control blocks the unsigned Go hook binary, the app now installs a `curl`/`curl.exe` command instead, posting raw Claude Code hook events to a new `/hook` endpoint (`apps/desktop/src/main/hooks/HookServer.ts`) that reduces them with the same metadata whitelist as the binary. Mode is auto-detected by actually probing the binary at start (`apps/desktop/src/main/hooks/mode.ts`), with a manual override in Settings; see `docs/decisions/0014-curl-script-mode-hook-fallback.md`.
- Onboarding wizard: `apps/desktop/src/renderer/panel/views/Onboarding.tsx` is now a 5-step wizard (welcome, what-is-claude-mons, controls reference, connect Claude Code, nation picker) with Back/Next buttons and step dots, replacing the bare nation-picker screen; copy lives in one `onboardingCopy` constant and step transitions go through pure helpers in `apps/desktop/src/renderer/panel/onboardingSteps.ts`. The new "Connect Claude Code" step calls the same hook-toggle IPC as Settings (via the shared `apps/desktop/src/renderer/ui/hookStatus.ts` helpers) and never installs hooks without a click; the nation-picker step was also re-tuned (smaller cards, clamped blurbs) and the wizard's scrollbar hidden so the four-nation grid fits the 440×660 panel without scrolling.

### Fixed
- Battle HUD rendering: `PetHost.playBattle` now switches the pet window into a new, generously-sized
  **battle** arena mode (`PetWindow.enterBattle`, `apps/desktop/src/main/display.ts:battleBounds`,
  clamped into the display's work area) instead of playing the battle inside whatever small `follow`
  square or short `strip` window happened to be active, which is why a banner like "Pebblet used
  Bedrock Sla…" could be cut off and the hp bars/damage popups could land outside the window entirely
  (looking like they were "behind" another app, when the window just didn't cover that part of the
  screen). The banner itself now wraps to two lines, then shrinks its font, then truncates with an
  ellipsis as a last resort (`apps/desktop/src/renderer/pet/bannerFit.ts:fitBanner`) so it always fits
  regardless of arena width, and hp bars/popups/the banner box are all re-centered to stay inside the
  canvas (`apps/desktop/src/renderer/pet/bannerFit.ts:clampCenter`). `PetWindow.reassertTopmost()` also runs after entering/leaving
  the arena; live z-order testing on Windows 11 (`EnumWindows`) confirmed the window was already
  correctly topmost, so the clipping above — not z-order — was the root cause.
- Two further window-geometry bugs found while investigating the above, both debug-assertable via a
  new `PetHost.assertHitboxWithinWindow` (`CLAUDE_MONS_DEBUG=1`): a fall started by releasing the pet
  mid-air in `follow` mode never repositioned the window, so the sprite drifted past the window's own
  bottom edge until landing (`PetHost`'s `IPC.petState` handler now calls `followTo` on every reported
  position while in `follow` mode, not only during an active drag); and a renderer boot race where the
  very first frame could draw before the window's geometry had arrived over a separate IPC message,
  producing a hitbox computed against a `{0,0,0,0}` placeholder (`PetConfig` now carries
  `windowGeometry`, which `PetRenderer` seeds its geometry from directly).
- Linux packaging: explicit executable name and homepage/maintainer metadata required by deb target.
- App builder: blockmap regeneration with pure JS builder, corrected pnpm dependency resolution in `refresh-latest-yml`.
- First-run egg on screen before a nation was chosen: `PetHost` (`apps/desktop/src/main/PetHost.ts`) now withholds the pet window and every stimulus until `App.chooseNation` sets a nation (`apps/desktop/src/main/petGate.ts`), instead of showing the overlay with a default-tinted egg during onboarding. The tray tooltip and menu now reflect the pre-nation state ("claude-mons — choose your nation" / "Finish setup").
- Crash "Uncaught Exception: ... conversion failure" while dragging/shaking the pet: a fractional or non-finite coordinate could reach `BrowserWindow.setBounds`/`setPosition`, which reject anything but an integer. Every such call in `PetWindow` (`apps/desktop/src/main/windows/PetWindow.ts`) now goes through new `toIntPoint`/`toIntRect` helpers (`apps/desktop/src/main/display.ts`) that round and skip the call instead of crashing; `CursorTracker` also drops a non-finite OS cursor sample outright, and `worldForDisplay`/`stripBounds` round `display.workArea` itself (observed fractional under non-100% Windows DPI scaling). `apps/desktop/src/main/index.ts` additionally installs `uncaughtException`/`unhandledRejection` handlers that log to console and `<userData>/crash.log` (capped ~1 MB) instead of showing Electron's blocking crash dialog, so the app survives whatever else slips through.
- Dropped pet ending up behind other always-on-top windows: `PetWindow.reassertTopmost()` (`setAlwaysOnTop` + `moveTop()`) now runs after every mode switch (drag start/end) and on `show()`, not just the existing 5 s timer — a non-focusable topmost window can otherwise lose its place in the z-order.
- Flicker while dragging: `PetWindow.followTo` now broadcasts the pet window's new geometry synchronously from the bounds it just commanded instead of waiting for the native `'move'` event, which could lag a frame behind the actual move and have the renderer draw against stale geometry for one frame.
- Pet walking out of the visible work area with no easy way back: the reducer's `world:bounds` handler now clamps position on every update (`packages/shared/src/behavior/reducer.ts`), and a new "Bring pet back" tray/context-menu item (`PetHost.recenterOnPrimary`, stimulus `world:recenter`) re-anchors the pet to the primary display and recenters it on demand.

## [0.1.0] - 2026-09-04

### Added

**Overlay and behavior:**
- Transparent pet overlay (taskbar edge strip, click-through except on sprite, drag/fall/shake).
- Behavior engine: idle/walk/sit/sleep, thinking/working/success, hatching/evolving, battle states (21 reducer tests).

**Sprites and art:**
- Complete sprite set: egg + 8 species × 3 stages + FX, authored as pixel matrices (643 invariant tests).

**Claude Code integration:**
- Go-based hook forwarder, localhost endpoint, spool fallback, settings.json auto-installer.

**Progression system:**
- XP economy with caps, daily bonus, streak; identical code on client and server (15 tests + Deno pipeline).

**Player interface:**
- Nation selection, panel (Mon / Leaderboard / Battles / Settings), hover card, system tray.

**Backend:**
- Supabase schema, RLS, 4 Edge Functions (profile, ingest, battle, heartbeat), deployed to `dbeotjfprckdrymmpexv`.

**Battles:**
- Animated turn-based battles: local/offline Wild Mon fallback or server opponent with HP bars.

**Packaging:**
- NSIS installer (Windows), AppImage/deb targets (Linux), auto-update via `electron-updater`, autostart integration, signed release workflow.

### Verified
- Pet overlay and mouse interaction (scripted tests on Windows 11).
- Behavior engine with unit tests and live headless simulation.
- Sprite pipeline and preview generation (643 tests).
- Hook binary live execution, XP credit, spool sync on restart.
- Server integration: migration, profile, ingest, battle, heartbeat operations.
- Windows packaging builds and launches; Linux builds only in CI (not yet run).

### Known gaps
- **Linux:** untested. Window flags, autostart `.desktop` file, AppImage/deb targets, and tray fallback are implemented but need live testing.
- **Smart App Control:** unsigned Go binary blocked on Windows SAC-enabled machines (reputation issue).
- **Multi-monitor:** re-anchoring on drop and display changes implemented, not exercised live.
- **Matchmaking:** real-opponent battles only tested via Wild Mon fallback (single player on test server).
- **Auto-update:** wired but untested; tag `v0.1.0` to exercise release workflow.
