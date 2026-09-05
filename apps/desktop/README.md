---
doc_type: reference
purpose: "Understand the desktop app's process model, module map, IPC channels, and CLI flags."
audience: agent
last_verified: 2026-09-05
last_verified_commit: ab12392
related_files:
  - apps/desktop/src/**
  - apps/desktop/IPC.md
  - docs/decisions/0014-curl-script-mode-hook-fallback.md
---

# Desktop App Reference

The Electron app consists of three windows (pet overlay, main panel, hover card), a preload script, and three renderer entries. The main process owns all services: pet host, game logic, battle rules, hook endpoint, sync queue, and updater. Data persists in `<userData>/state.json`; IPC channel names live in `src/common/ipc.ts`.

## Process model

```
src/main/index.ts (single-instance lock, transparency switch, GPU disable flag)
    ↓
src/main/App.ts (composition root)
    ├─ PetHost (owns PetWindow, tray, cursor tracking; broadcasts stimulus)
    │   ├─ PetWindow (strip/follow overlay)
    │   ├─ AppTray (context menu, tooltip)
    │   └─ CursorTracker (cursor polling, click-through toggle)
    │
    ├─ PanelWindow (main UI: onboarding, mon, battles, leaderboard, settings)
    │
    ├─ HoverCardWindow (240×92 delayed stat card)
    │
    ├─ GameService (XP → level-ups, hatch/evolve)
    ├─ BattleService (cooldown, daily cap, offline fallback)
    ├─ JsonStore (atomic persistence)
    │
    ├─ HookServer + SpoolDrainer + ActivityTracker (event ingestion, binary or script mode)
    ├─ SupabaseClient (Edge Functions, anonymous auth)
    ├─ SyncQueue (batched XP upload with exponential backoff)
    └─ Updater + Autostart
```

All windows share one preload (`src/preload/index.ts`); three renderers (pet, panel, hovercard) each carry CSP `default-src 'self'`. Renderers access main via `window.mons` (pet) and `window.monsUi` (panel/hovercard). Persistence uses `<userData>/state.json`.

## Module map

| Path | Responsibility |
|---|---|
| `src/main/index.ts` | Bootstrap: single instance, Linux transparency, app quit override, `new App().start()` |
| `src/main/App.ts` | Composition root; IPC; snapshot feed; nation choice; battle request/finish; hook fan-out |
| `src/main/PetHost.ts` | Pet window, tray, cursor tracking; drag/shake/click; world bounds; stimulus forwarding |
| `src/main/display.ts` | Pure geometry (strip/follow bounds, anchor memory, display lookup) |
| `src/main/windows/*` | PetWindow (strip/follow, geo broadcast), PanelWindow (lazy, remembered pos), HoverCardWindow (delayed card) |
| `src/main/game/GameService.ts` | Hook events → provisional XP, buckets, daily bonus/streak, level-ups, hatch/evolve |
| `src/main/game/BattleService.ts` | Cooldown/daily cap, remote or offline wild battle, battle history |
| `src/main/game/species.ts` | Species lookup per nation (offline hatching only) |
| `src/main/hooks/HookServer.ts` | HTTP endpoint: `/event` (bearer token, Go binary) and `/hook` (stable header token, script mode); 64 KB cap; port persisted with +1..+20 fallback |
| `src/main/hooks/rawHook.ts` | `rawHookToEnvelope`: reduces raw Claude Code hook JSON to the same whitelist as `packages/hook-cli/main.go:buildEnvelope`, for the `/hook` route |
| `src/main/hooks/mode.ts` | `probeBinary` (exec-time check) and `computeEffectiveMode` (`auto`/`binary`/`script`) |
| `src/main/hooks/SpoolDrainer.ts` | Drains `hook-spool.jsonl` every 30 s; marks `spooled: true` (binary mode only; script mode has no spool) |
| `src/main/hooks/ActivityTracker.ts` | Collapses Claude Code sessions into stimuli; TTL pruning |
| `src/main/hooks/HookInstaller.ts` | Safe merge/remove of hooks in `~/.claude/settings.json` for either mode (5-backup rotation); `scriptCommand` builds the `curl` command line |
| `src/main/hooks/binary.ts` | Locates and installs Go hook binary with sha256 verify + atomic rename |
| `src/main/net/config.ts` | Supabase URL/anon key with env overrides, offline switch |
| `src/main/net/SupabaseClient.ts` | supabase-js wrapper; anonymous auth; typed Edge Function invoke |
| `src/main/net/Backend.ts` | Server-resolved battles; leaderboard via PostgREST views |
| `src/main/net/SyncQueue.ts` | Batches minute buckets → `ingest-xp` (idempotent, exponential backoff) |
| `src/main/persistence/state.ts` | LocalState shape, defaults, migration list |
| `src/main/persistence/JsonStore.ts` | Atomic debounced JSON store with `.bak` recovery and versioned migrations |
| `src/main/sim/ScriptRunner.ts` | Scripted stimulus timeline (dev aid); CLI arg parsers |
| `src/main/tray/Tray.ts` | Tray icon, tooltip, context menu; pet right-click menu |
| `src/main/updater/Updater.ts` | electron-updater over GitHub Releases (unsupported in dev, on `.deb`) |
| `src/main/autostart/Autostart.ts` | Windows `setLoginItemSettings`; Linux `~/.config/autostart/claude-mons.desktop` |
| `src/main/input/CursorTracker.ts` | OS cursor polling (60 Hz hot / 12 Hz cold); click-through toggle; drag streams |
| `src/main/util/png.ts` | PNG encoder + RGBA scale/crop (no dependencies) |
| `src/preload/index.ts` | ContextBridge APIs: `window.mons` (PetApi), `window.monsUi` (UiApi) |
| `src/renderer/pet/main.ts` | Pet entry: pointer binding, wires listeners to PetLoop |
| `src/renderer/pet/loop.ts` | rAF loop: steps reducer, applies effects, drives battle playback, reports hitbox |
| `src/renderer/pet/PetRenderer.ts` | Canvas drawing: sprite, FX, battle HUD, debug overlay |
| `src/renderer/pet/SpriteCache.ts` | Caches rasterized frames by `id\|anim\|frame\|palette` |
| `src/renderer/pet/BattlePlayer.ts` | Time-based battle playback; schedules attack/hit steps |
| `src/renderer/panel/main.tsx` | Panel entry: snapshot feed |
| `src/renderer/panel/App.tsx` | Tab router (mon/leaderboard/battles/settings); Onboarding while no nation |
| `src/renderer/panel/views/*` | Onboarding, Mon, Battles, Leaderboard, Settings |
| `src/renderer/hovercard/main.tsx` | Hover card entry: compact stat card |
| `src/renderer/ui/useSnapshot.ts` | Shared snapshot signal + one-time feed subscription |
| `src/renderer/ui/SpriteView.tsx` | Animated sprite preview (nation-tinted) |

## IPC channels

All channel names and payload types live in `src/common/ipc.ts`. See `apps/desktop/IPC.md` for the full table (4 directions: pet→main, main→pet, panel/hovercard→main, main→panel/hovercard).

## LocalState (`<userData>/state.json`)

| Top-level key | Contents |
|---|---|
| `schemaVersion` | Current = 1 (no migrations yet) |
| `device` | `{ id, createdAt }` (random device UUID) |
| `profile` | `{ userId, nickname, nation }` |
| `pet` | `{ speciesId, seed }` (seed stable per install) |
| `progress` | `{ localXp, serverXp, stage, hatchedAt, evolvedAt }` |
| `ledger` | `{ credited, pending, lastSyncAt, batchId }` (XP buckets, 48 h history) |
| `streak` | `{ streakDays, lastActiveDay }` |
| `bonusXp` / `battleXp` | Cumulative rewards |
| `behavior` | `{ anchor }` (display ID + fractional X for remembered position) |
| `settings` | `{ spriteScale: 2\|3\|4, autostart, focusable, disableGpu }` |
| `hooks` | `{ installedAt, port, token, mode }` — `port`/`token` are the persisted `/hook` endpoint (script mode); `mode` is `'auto' \| 'binary' \| 'script'` |
| `ui` | `{ panel }` (window position or null) |
| `auth` | `{ session }` (serialized supabase-js session) |
| `battles` | `{ history (≤50), lastBattleAt, today }` |

**Migrations:** `MIGRATIONS[i]` upgrades version i+1 → i+2; run in order. `MIGRATIONS[0]` (v1 → v2) adds `hooks.port`/`hooks.token`/`hooks.mode`. JsonStore uses 500 ms debounce; loads fall back to backup or defaults when unparsable.

## Dev CLI flags (parsed in `src/main/App.ts`)

| Flag | Development only | Effect |
|---|---|---|
| `--simulate <script.json>` | No | Load SimScript (shared with `pnpm sim`), start timeline 1.5 s after boot |
| `--capture <path.png>` | No | Screenshot pet window 3 s after boot; also `<path>.panel.png` if visible |
| `--dev-nation <water\|fire\|earth\|air>` | Yes | Auto-choose nation after 1 s |
| `--dev-battle` | Yes | Trigger `onBattleRequest()` after 2.5 s |
| `--dev-xp <n>` | Yes | Grant XP via `game.grantXp(n, 'server')` after 2 s |
| `--dev-install-hooks` | Yes | Install hooks (`toggleHooks()`) 1.5 s after boot, in the effective mode; used for manual testing against `CLAUDE_CONFIG_DIR` |
| `--autostart` | No | Marker for installer (not read by app) |

## Environment variables

| Variable | Effect |
|---|---|
| `CLAUDE_MONS_DEBUG=1` | PetHost logging + renderer debug overlay |
| `CLAUDE_MONS_DISABLE_GPU=1` | Disable GPU acceleration |
| `CLAUDE_MONS_OFFLINE=1` | No backend; local game + wild battles only |
| `CLAUDE_MONS_SUPABASE_URL` | Override Supabase URL |
| `CLAUDE_MONS_SUPABASE_ANON_KEY` | Override Supabase anon key |
| `CLAUDE_CONFIG_DIR` | Override Claude config path (HookInstaller) |
| `ELECTRON_RENDERER_URL` | electron-vite dev server URL |
| `APPIMAGE` | Set by AppImage runtime (Updater/Autostart) |
| `XDG_CONFIG_HOME` | Used for autostart path on Linux |
| `CI` | Affects vitest reporter |

## Build config

- **Vite config** (`electron.vite.config.ts`): Main input `src/main/index.ts` (excludes shared/sprites from externalization); preload input forced to CJS format; renderer uses Preact vite preset with three HTML entries (pet, panel, hovercard).
- **electron-builder** (`electron-builder.yml`): appId `dev.claude-mons.desktop`; publishes to GitHub releases (IcaruzSoftware/claude-mons). Win: NSIS x64, per-user, changeable install dir. Linux: AppImage + deb x64; deb depends libgtk-3, libnotify, libnss3, libxss, libxtst, xdg-utils, libatspi, libuuid, libsecret.
- **Bundled binary:** Hook CLI (Go) copied from `packages/hook-cli/dist/` into `<bin>` with sha256 verify.

## Tests

| File | Coverage |
|---|---|
| `test/BattleService.test.ts` | Offline wild mon, egg refusal, cross-nation opponent, cooldown/daily cap, busy refusal |
| `test/CursorTracker.test.ts` | Click-through toggle, hitbox inflation, drag streaming, poll-rate switch |
| `test/GameService.test.ts` | Provisional XP, bucket fill, local hatch, daily bonus, spooled events |
| `test/HookInstaller.test.ts` | Hook merge/remove (both modes), purity + idempotence, partial/mixed-mode status, fs install/uninstall, mode-switch reinstall, backup rotation |
| `test/rawHook.test.ts` | `rawHookToEnvelope` whitelist parity with `buildEnvelope`, cwd hashing, unknown event → null |
| `test/mode.test.ts` | `probeBinary` classification (ok/blocked/missing/timeout) via injected spawn, `computeEffectiveMode` |
| `test/JsonStore.test.ts` | Atomic write, `.bak` recovery, corrupt recovery, ordered migrations, debouncing |
| `test/display.test.ts` | Strip/follow bounds, displayContaining, fractional anchor memory |
| `test/hooks.test.ts` | HookServer `/event` and `/hook` auth, port persistence/fallback, SpoolDrainer junk skip, ActivityTracker collapsing/pruning |
