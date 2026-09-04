---
doc_type: reference
purpose: "Release notes and version history; check this when seeing claude-mons updates or deciding what version to expect features in."
audience: both
last_verified: 2026-09-05
last_verified_commit: 6d99ae3
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

### Fixed
- Linux packaging: explicit executable name and homepage/maintainer metadata required by deb target.
- App builder: blockmap regeneration with pure JS builder, corrected pnpm dependency resolution in `refresh-latest-yml`.

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
