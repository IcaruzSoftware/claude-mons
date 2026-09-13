---
doc_type: reference
purpose: "Understand the desktop app's process model, module map, IPC channels, and CLI flags."
audience: agent
last_verified: 2026-09-13
last_verified_commit: cfc8bc7
related_files:
  - apps/desktop/src/**
  - apps/desktop/IPC.md
  - apps/desktop/electron-builder.yml
  - apps/desktop/scripts/after-pack.mjs
  - docs/decisions/0014-curl-script-mode-hook-fallback.md
  - docs/decisions/0017-force-x11-backend-on-linux.md
  - docs/decisions/0018-compact-window-and-fail-closed-click-through.md
  - docs/runbooks/release.md
---

# Desktop App Reference

The Electron app consists of four windows (pet overlay, main panel, hover card, water reminder card), a preload script, and four renderer entries. The main process owns all services: pet host, game logic, battle rules, hook endpoint, sync queue, water reminder scheduler, and updater. Data persists in `<userData>/state.json`; IPC channel names live in `src/common/ipc.ts`.

## Process model

```
src/main/index.ts (single-instance lock, transparency switch, GPU disable flag)
    ↓
src/main/App.ts (composition root)
    ├─ PetHost (owns PetWindow, tray, cursor tracking; broadcasts stimulus)
    │   ├─ PetWindow (compact follow / motion-arena drag-fall / battle-arena overlay)
    │   ├─ AppTray (context menu, tooltip)
    │   └─ CursorTracker (cursor polling, click-through toggle)
    │
    ├─ PanelWindow (main UI: onboarding, mon, battles, leaderboard, settings)
    │
    ├─ HoverCardWindow (240×92 delayed stat card)
    │
    ├─ ReminderWindow (260×110 water reminder card) + WaterReminder (scheduling)
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

All windows share one preload (`src/preload/index.ts`); four renderers (pet, panel, hovercard, reminder) each carry CSP `default-src 'self'`. Renderers access main via `window.mons` (pet) and `window.monsUi` (panel/hovercard/reminder; `window.monsUi.water.done()`/`.snooze()` for the reminder card). Persistence uses `<userData>/state.json`.

## Module map

| Path | Responsibility |
|---|---|
| `src/main/index.ts` | Bootstrap: single instance, Linux transparency, app quit override, `new App().start()`; installs `uncaughtException`/`unhandledRejection` handlers that log to `<userData>/crash.log` (capped ~1 MB) instead of letting Electron show its blocking crash dialog |
| `src/main/App.ts` | Composition root; IPC; snapshot feed; nation choice; battle request/finish; hook fan-out |
| `src/main/PetHost.ts` | Pet window, tray, cursor tracking; drag/shake/click; world bounds; stimulus forwarding; withholds the window and stimuli until a nation is chosen (`canRevealPet`/`canStimulatePet`) |
| `src/main/petGate.ts` | Pure `canRevealPet`/`canStimulatePet` helpers deciding whether the pet window may be shown or animated before onboarding picks a nation |
| `src/main/display.ts` | Pure geometry (`compactBounds`/`battleBounds`/`motionBounds`, `needsHop` hop threshold, anchor memory, display lookup); `nextArenaMode`/`canHopFollow` pure mode-transition helpers for `PetWindow`'s follow/motion/battle machine (see "Motion mode" in `docs/architecture/overlay-and-input.md`); `toIntPoint`/`toIntRect` round-and-validate coordinates before any `BrowserWindow.setBounds`/`setPosition` call |
| `src/main/windows/*` | PetWindow (compact `follow` / full-work-area `motion` arena for the whole of a drag through landing / `battle` arena, geometry-version counter + geo broadcast; every bounds/position change goes through the integer-safe `setBoundsSafe`; re-asserts always-on-top + z-order via `reassertTopmost()` on every mode switch), PanelWindow (lazy, remembered pos), HoverCardWindow (delayed card), ReminderWindow (interactive water reminder card; same family as HoverCardWindow but not click-through, since it has Done/Snooze buttons) |
| `src/main/game/GameService.ts` | Hook events → provisional XP, buckets, daily bonus/streak, level-ups, hatch/evolve |
| `src/main/game/BattleService.ts` | Cooldown/daily cap, remote or offline wild battle, battle history |
| `src/main/game/species.ts` | Species lookup per nation (offline hatching only) |
| `src/main/reminders/WaterReminder.ts` | Electron-free water reminder scheduler: `nextDueAt`/`todayCount` pure helpers plus a `WaterReminder` class (`tick`/`done`/`snooze`/`onConfigChanged`/`devForceDueInSeconds`) with an injected clock, so it is unit-testable without a running app |
| `src/main/hooks/HookServer.ts` | HTTP endpoint: `/event` (bearer token, Go binary) and `/hook` (stable header token, script mode); 64 KB cap; port persisted with +1..+20 fallback |
| `src/main/hooks/rawHook.ts` | `rawHookToEnvelope`: reduces raw Claude Code hook JSON to the same whitelist as `packages/hook-cli/main.go:buildEnvelope`, for the `/hook` route |
| `src/main/hooks/mode.ts` | `probeBinary` (exec-time check) and `computeEffectiveMode` (`auto`/`binary`/`script`) |
| `src/main/hooks/SpoolDrainer.ts` | Drains `hook-spool.jsonl` every 30 s; marks `spooled: true` (binary mode only; script mode has no spool) |
| `src/main/hooks/ActivityTracker.ts` | Collapses Claude Code sessions into stimuli; TTL pruning |
| `src/main/hooks/HookInstaller.ts` | Safe merge/remove of hooks in `~/.claude/settings.json` for either mode (5-backup rotation); `scriptCommand` builds the `curl` command line |
| `src/main/hooks/binary.ts` | Locates and installs Go hook binary with sha256 verify + atomic rename |
| `src/main/net/config.ts` | Supabase URL/anon key with env overrides, offline switch |
| `src/main/net/SupabaseClient.ts` | supabase-js wrapper; anonymous auth; typed Edge Function invoke; account linking (`linkEmail`/`verifyLinkCode`/`requestSignInCode`/`verifySignInCode`/`linkedEmail`/`signOutToAnonymous`) — see `docs/architecture/flows/account-linking.md` |
| `src/main/net/account.ts` | Pure account-linking helpers: email format check, the `buildAdoptedProfile`/`resetToAnonymousProfile` local-state transforms |
| `src/main/net/Backend.ts` | Server-resolved battles; leaderboard via PostgREST views |
| `src/main/net/SyncQueue.ts` | Batches minute buckets → `ingest-xp` (idempotent, exponential backoff) |
| `src/main/persistence/state.ts` | LocalState shape, defaults, migration list |
| `src/main/persistence/JsonStore.ts` | Atomic debounced JSON store with `.bak` recovery and versioned migrations |
| `src/main/sim/ScriptRunner.ts` | Scripted stimulus timeline (dev aid); CLI arg parsers |
| `src/main/tray/Tray.ts` | Tray icon, tooltip, context menu; pet right-click menu; while no nation is chosen the tooltip reads "claude-mons — choose your nation" and the menu is reduced to a single "Finish setup" item; "Bring pet back" (`PetHost.recenterOnPrimary`) re-anchors the pet to the primary display and recenters it if it ever walks out of frame; "Battle now" initiates a battle without shaking |
| `src/main/updater/Updater.ts` | electron-updater over GitHub Releases (unsupported in dev, on `.deb`) |
| `src/main/updater/interop.ts` | Resolves electron-updater's `autoUpdater` from either the named or the CommonJS default export shape; maps update errors to one readable line | `pickAutoUpdater`, `describeUpdateError`, `UpdatePayload` |
| `src/main/autostart/Autostart.ts` | Windows `setLoginItemSettings`; Linux `~/.config/autostart/claude-mons.desktop` |
| `src/main/input/CursorTracker.ts` | OS cursor polling (60 Hz hot / 12 Hz cold); fail-closed, self-healing click-through toggle (freshness + geometry-version checks, re-asserted every tick); drag streams |
| `src/main/util/png.ts` | PNG encoder + RGBA scale/crop (no dependencies) |
| `src/preload/index.ts` | ContextBridge APIs: `window.mons` (PetApi), `window.monsUi` (UiApi) |
| `src/renderer/pet/main.ts` | Pet entry: pointer binding, wires listeners to PetLoop |
| `src/renderer/pet/loop.ts` | rAF loop: steps reducer, applies effects, drives battle playback, reports hitbox |
| `src/renderer/pet/PetRenderer.ts` | Canvas drawing: sprite, FX, battle HUD, debug overlay |
| `src/renderer/pet/SpriteCache.ts` | Caches rasterized frames by `id\|anim\|frame\|palette` |
| `src/renderer/pet/BattlePlayer.ts` | Time-based battle playback; schedules attack/hit steps |
| `src/renderer/panel/main.tsx` | Panel entry: snapshot feed |
| `src/renderer/panel/App.tsx` | Bottom game-menu tab router (mon/leaderboard/battles/settings, `BottomTabBar`); Onboarding while no nation |
| `src/renderer/panel/onboardingSteps.ts` | Pure step arithmetic (`nextOnboardingStep`/`prevOnboardingStep`/`canGoBack`/`canGoNext`) for the onboarding wizard |
| `src/renderer/panel/accountCopy.ts` | Copy for account linking, shared by Settings' Account section and Onboarding's sign-in sub-step |
| `src/renderer/panel/views/*` | Onboarding (5-step wizard: welcome, what-is, controls, connect Claude Code, nation picker; welcome also offers a "sign in" sub-step, see account-linking flow doc), Mon, Battles, Leaderboard, Settings (Account section: link/switch/sign-out) |
| `src/renderer/panel/views/battleTreeLayout.ts` | Pure talent-tree SVG coordinate lookup (`treeNodePosition`) for Battles' tree, dependency-free so it's unit-testable |
| `src/renderer/panel/views/leaderboardHelpers.ts` | Pure podium ordering (`podiumOrder`: 2nd/1st/3rd) for Leaderboard, dependency-free so it's unit-testable |
| `src/renderer/hovercard/main.tsx` | Hover card entry: compact stat card |
| `src/renderer/reminder/main.tsx` | Water reminder card entry: nation-tinted sprite (or a `drop` glyph before hatch) + "Time for a sip of water" + Done/Snooze buttons; always renders the same content since the window is only shown while due |
| `src/renderer/ui/theme.css` | Design tokens (palette, spacing scale, radii, bevel shadows, type scale) and the bundled display font's `@font-face` — see [Fonts](#fonts) below |
| `src/renderer/ui/PixelPanel.tsx` | Bevelled card chrome (`.pixel-panel`), used wherever a generic card container is needed |
| `src/renderer/ui/SegmentedBar.tsx` | Discrete-segment XP bar (cosmetic segment count, not a real unit) |
| `src/renderer/ui/StatGem.tsx` | Diamond stat gem with a fixed per-stat color (HP/ATK/DEF/SPD), independent of nation |
| `src/renderer/ui/TypeChip.tsx` | Move-type chip: solid nation color + ink text, or neutral grey |
| `src/renderer/ui/NationBadge.tsx` | Small nation crest tile (3-letter code) for Leaderboard's banner tiles |
| `src/renderer/ui/Glyph.tsx` | 8×8 pixel glyph set (mon, trophy, swords, gear, flame, clock, leaf, drop, spark, wind) drawn as inline SVG rects from a string grid; the only icon language besides a mon's own sprite (no emoji) |
| `src/renderer/ui/BottomTabBar.tsx` | Bottom game-menu tab bar (glyph + label, bevelled active state) used by `src/renderer/panel/App.tsx` |
| `src/renderer/ui/useSnapshot.ts` | Shared snapshot signal + one-time feed subscription |
| `src/renderer/ui/SpriteView.tsx` | Animated sprite preview (nation-tinted); on an unknown sprite id, sizes the canvas to the standard 32px sprite grid instead of the browser's 300x150 default so a missing sprite degrades to a same-sized blank box rather than blowing out its flex layout |
| `src/renderer/ui/hookStatus.ts` | Shared `HookStatusValue` label/dot-class helpers (Settings hook row + onboarding Connect step) |
| `src/renderer/ui/AccountEmailCode.tsx` | Shared email → 6-digit-code widget for account linking (link, switch, onboarding sign-in) |

### Fonts

The panel's display font (`--font-display` in `src/renderer/ui/theme.css`, used for headings/tab labels/short bold
text at 12px and up — see `docs/design/ui-style.md`) is **Pixelify Sans** (SIL Open Font License
1.1, `src/renderer/ui/fonts/LICENSE.txt`), bundled as a local `.woff2`
(`src/renderer/ui/fonts/PixelifySans.woff2`) loaded via a relative `@font-face` `url()` — no CDN or
network request. Text below ~12px stays in the system font instead of the display font: a real
capture showed the display face's "2" misread as "8" at 9px, so anything that size or smaller
(section headers, badges, chip labels, the talent tree's rank pips) uses the bold system font
instead — see `docs/design/ui-panels.md`'s noted deviation.

## IPC channels

All channel names and payload types live in `src/common/ipc.ts`. See `apps/desktop/IPC.md` for the full table (4 directions: pet→main, main→pet, panel/hovercard→main, main→panel/hovercard).

## LocalState (`<userData>/state.json`)

| Top-level key | Contents |
|---|---|
| `schemaVersion` | Current = 4 |
| `device` | `{ id, createdAt }` (random device UUID) |
| `profile` | `{ userId, nickname, nation, email }` — `email` is null while the account is anonymous-only |
| `pet` | `{ speciesId, seed }` (seed stable per install) |
| `progress` | `{ localXp, serverXp, stage, hatchedAt, evolvedAt }` |
| `ledger` | `{ credited, pending, lastSyncAt, batchId }` (XP buckets, 48 h history) |
| `streak` | `{ streakDays, lastActiveDay }` |
| `bonusXp` / `battleXp` | Cumulative rewards |
| `behavior` | `{ anchor }` (display ID + fractional X for remembered position) |
| `settings` | `{ spriteScale: 2\|3\|4, autostart, focusable, disableGpu, waterReminder: { enabled, intervalMin: 30\|45\|60\|90\|120 } }` |
| `hooks` | `{ installedAt, port, token, mode }` — `port`/`token` are the persisted `/hook` endpoint (script mode); `mode` is `'auto' \| 'binary' \| 'script'` |
| `ui` | `{ panel }` (window position or null) |
| `auth` | `{ session }` (serialized supabase-js session) |
| `battles` | `{ history (≤50), lastBattleAt, today, streak }` — `streak` mirrors the server's `mons.win_streak` when online, or is derived locally for offline wild battles; each `history` entry's `opponent` also carries `loadout` (the opponent's stance/moves/tree at battle time, `docs/design/progression.md` Phase D: recent-opponent intel) |
| `loadout` | `{ stance, moves?, tree?, lastRespecAt }` (`docs/design/progression.md` Stances / Move pool and effects, `docs/design/talent-tree.md` for `tree`/respec; `stance` defaults to `DEFAULT_STANCE` = `'bulwark'`, `moves`/`tree` are set by the loadout editor and left `undefined` until then — `snapshotFor` fills in a level-appropriate move default and treats an absent `tree` as empty; `lastRespecAt` is a local mirror of the server's `mons.last_respec_at`, re-synced from every `set-loadout` response) |
| `water` | `{ lastDoneAt, snoozedUntil, todayCount, todayKey }` — `snoozedUntil` is reused both for an explicit "Snooze 10 min" and to re-arm after an ignored card auto-hides; see `src/main/reminders/WaterReminder.ts` |

**Migrations:** `MIGRATIONS[i]` upgrades version i+1 → i+2; run in order. `MIGRATIONS[0]` (v1 → v2) adds `hooks.port`/`hooks.token`/`hooks.mode`. `MIGRATIONS[1]` (v2 → v3) adds `settings.waterReminder` (on by default, 60 min) and the top-level `water` state. `MIGRATIONS[2]` (v3 → v4) adds `profile.email` (null). `MIGRATIONS[3]` (v4 → v5) adds `battles.streak` (0) and the top-level `loadout` (`{ stance: 'bulwark' }`). `MIGRATIONS[4]` (v5 → v6) adds `loadout.lastRespecAt` (null). `MIGRATIONS[5]` (v6 → v7) backfills `battles.history[].opponent.loadout` with `{}` on every existing entry (Phase D: recent-opponent intel; the original opponent's loadout at battle time was never stored before this field existed, so there is nothing truthful to backfill it with). JsonStore uses 500 ms debounce; loads fall back to backup or defaults when unparsable.

## Dev CLI flags (parsed in `src/main/App.ts`)

| Flag | Development only | Effect |
|---|---|---|
| `--simulate <script.json>` | No | Load SimScript (shared with `pnpm sim`), start timeline 1.5 s after boot |
| `--capture <path.png>` | No | Screenshot pet window 3 s after boot (later if `--dev-water-in` is set, to give the reminder time to appear); also `<path>.panel.png` if the panel is visible and `<path>.reminder.png` if the water reminder card is visible |
| `--dev-nation <water\|fire\|earth\|air>` | Yes | Auto-choose nation after 1 s |
| `--dev-battle` | Yes | Trigger `onBattleRequest()` after 2.5 s |
| `--dev-xp <n>` | Yes | Grant XP via `game.grantXp(n, 'server')` after 2 s |
| `--dev-install-hooks` | Yes | Install hooks (`toggleHooks()`) 1.5 s after boot, in the effective mode; used for manual testing against `CLAUDE_CONFIG_DIR` |
| `--dev-onboarding-step <n>` | Yes | Open the onboarding wizard on step n (via `UiSnapshot.devOnboardingStep`) instead of step 0; for capturing a specific step |
| `--dev-water-in <seconds>` | Yes | Force the water reminder due N seconds after start (`WaterReminder.devForceDueInSeconds`), so the card appears quickly for manual testing or `--capture` instead of waiting out a full interval |
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

- **Vite config** (`electron.vite.config.ts`): Main input `src/main/index.ts` (excludes shared/sprites from externalization); preload input forced to CJS format; renderer uses Preact vite preset with four HTML entries (pet, panel, hovercard, reminder).
- **electron-builder** (`electron-builder.yml`): appId `dev.claude-mons.desktop`; publishes to GitHub releases (IcaruzSoftware/claude-mons); `extraMetadata.name: claude-mons` overrides the packaging metadata name (package.json's own `name` is the pnpm workspace name @claude-mons/desktop, which would otherwise give electron-builder-derived values like `updaterCacheDirName` a scope-mangled value). Win: NSIS x64, per-user, changeable install dir. Linux: AppImage + deb x64; deb depends libgtk-3, libnotify, libnss3, libxss, libxtst, xdg-utils, libatspi, libuuid, libsecret. `scripts/after-pack.mjs` (`afterPack:` hook) writes the packaged app-update.yml (e.g. `apps/desktop/release/win-unpacked/resources/app-update.yml`) when electron-builder's own packaging pass skipped it (the `--dir` + `--prepackaged` two-step CI uses to sign in between); see [docs/runbooks/release.md](../../docs/runbooks/release.md).
- **Bundled binary:** Hook CLI (Go) copied from `packages/hook-cli/dist/` into `<bin>` with sha256 verify.

## Tests

| File | Coverage |
|---|---|
| `test/BattleService.test.ts` | Offline wild mon, egg refusal, cross-nation opponent, cooldown/daily cap, busy refusal |
| `test/CursorTracker.test.ts` | Fail-closed/self-healing click-through (re-asserted every tick), hitbox inflation, hitbox/cursor freshness, geometry-version mismatch discarded, `forceIgnore`, exception-forces-closed, `isPointAccepted`, drag streaming, poll-rate switch, non-finite cursor sample dropped |
| `test/GameService.test.ts` | Provisional XP, bucket fill, local hatch, daily bonus, spooled events |
| `test/HookInstaller.test.ts` | Hook merge/remove (both modes), purity + idempotence, partial/mixed-mode status, fs install/uninstall, mode-switch reinstall, backup rotation |
| `test/rawHook.test.ts` | `rawHookToEnvelope` whitelist parity with `buildEnvelope`, cwd hashing, unknown event → null |
| `test/mode.test.ts` | `probeBinary` classification (ok/blocked/missing/timeout) via injected spawn, `computeEffectiveMode` |
| `test/JsonStore.test.ts` | Atomic write, `.bak` recovery, corrupt recovery, ordered migrations, debouncing |
| `test/display.test.ts` | `compactBounds`/`battleBounds`/`motionBounds` (incl. fractional-work-area rounding, clamping to a small display), `needsHop` threshold, `nextArenaMode`/`canHopFollow` mode-transition table, displayContaining, fractional anchor memory, `toIntPoint`/`toIntRect` |
| `test/hooks.test.ts` | HookServer `/event` and `/hook` auth, port persistence/fallback, SpoolDrainer junk skip, ActivityTracker collapsing/pruning |
| `test/petGate.test.ts` | `canRevealPet`/`canStimulatePet`: withheld until nation + window-ready + user-visible, refused while any is missing |
| `test/onboardingSteps.test.ts` | Onboarding wizard step clamping (`nextOnboardingStep`/`prevOnboardingStep`) and Back/Next availability at the edges |
| `test/WaterReminder.test.ts` | `nextDueAt` derivation, `tick`/`done`/`snooze`/auto-hide re-arm, skip-while-asleep and skip-while-in-battle, daily sip counter rollover across a UTC day boundary, `onConfigChanged`, `devForceDueInSeconds` |
| `test/account.test.ts` | Email format validation, `describeAuthError` code mapping, `buildAdoptedProfile`/`resetToAnonymousProfile` state transforms |
