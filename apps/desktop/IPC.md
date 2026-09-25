---
doc_type: reference
purpose: "Look up IPC channel names and payload types for renderer-to-main and main-to-renderer communication."
audience: agent
last_verified: 2026-09-25
last_verified_commit: 8b64f38
related_files:
  - apps/desktop/src/common/ipc.ts
  - apps/desktop/README.md
  - docs/decisions/0014-curl-script-mode-hook-fallback.md
  - docs/decisions/0018-compact-window-and-fail-closed-click-through.md
  - docs/design/talent-tree.md
  - docs/architecture/overlay-window.md
  - docs/architecture/input-and-gestures.md
---

# IPC Channels

All channel names and payload type definitions live in `src/common/ipc.ts`. Coordinate systems: "world" = Electron screen DIPs; "window-local" = CSS pixels from window top-left.

## Pet renderer → main (`ipcRenderer.send`)

Handled by `PetHost.registerIpc`, sender-guarded.

| Channel | Payload type | Purpose |
|---|---|---|
| `pet:ready` | — | Triggers `sendConfig()` with initial pet state |
| `pet:hitbox` | `HitboxMessage` (`{hitbox: Hitbox, geometryVersion: number}`, window-local) | Reports sprite bounds + the geometry version they were computed against, for click-through toggle |
| `pet:pointer` | `PointerMessage` | Pointer events (down/up/move/enter/leave/contextmenu) |
| `pet:state` | `StateMessage` | Current pet state + anchor position (world DIPs) |
| `pet:request-battle` | — | Shake gesture triggered; asks main to start battle |
| `pet:landed` | — | Pet finished falling, now idle on ground |
| `pet:battle-done` | `string` (battle id) | Battle animation complete; requests history update |

## Main → pet renderer (`PetWindow.send`)

| Channel | Payload type | Purpose |
|---|---|---|
| `pet:config` | `PetConfig` | Sprite scale, version, stage, species, nation, world bounds, x, seed, debug flag, `windowGeometry` (the window's own geometry at send time) |
| `pet:window-moved` | `WindowGeometry` | Window bounds (x, y, width, height), display scale factor, and `geometryVersion` |
| `pet:stimulus` | `StimulusMessage` (= shared `Stimulus`) | Hook event converted to stimulus (hook:prompt, hook:tool_start, etc.) or internal stimulus (input:shake, activity:update) |
| `pet:world` | shared `World` | World bounds and display list (used by BattlePlayer to position opponent) |
| `pet:battle-play` | `BattlePlayMessage` | Resolved battle data: id, result, both snapshots, reward XP, isBot flag, isElite flag, winStreak |

## Panel/hover card/reminder renderer → main (`ipcRenderer.invoke`)

Handled by `App.registerUiIpc`.

| Channel | Request payload | Response payload | Purpose |
|---|---|---|---|
| `ui:get-snapshot` | — | `UiSnapshot` | Fetch current state for rendering |
| `ui:choose-nation` | `string` (validated by `isNation`) | `UiSnapshot` | Choose starting nation; idempotent |
| `ui:toggle-hooks` | `HookAgent` (`'claude' \| 'codex'`, defaults to `'claude'` when omitted) | `UiSnapshot` | Enable/disable hook installation for the given agent, in the effective mode |
| `ui:set-hook-mode` | `'auto' \| 'binary' \| 'script'` | `UiSnapshot` | Set the hook mode preference; reinstalls in place if already connected |
| `ui:set-sprite-scale` | `2 \| 3 \| 4` | `UiSnapshot` | Change sprite scale |
| `ui:open-external` | `string` (allow-listed https://github.com/… or https://claude-mons.dev/…) | void | Open URL in browser |
| `ui:quit` | — | void | Quit the app |
| `ui:dev-grant-xp` | `number` | `UiSnapshot` | Grant XP (ignored when packaged) |
| `ui:set-autostart` | `boolean` | `UiSnapshot` | Enable/disable launch-on-startup |
| `ui:check-updates` | — | `UiSnapshot` | Check for new app version |
| `ui:install-update` | — | void | Install downloaded update (and quit) |
| `ui:get-leaderboard` | — | `LeaderboardPayload` | Fetch leaderboard (30 s cache) |
| `ui:set-nickname` | `string` | `{ok, error}` | Set profile nickname |
| `ui:sync-now` | — | `UiSnapshot` | Force sync of pending XP buckets |
| `ui:set-water-enabled` | `boolean` | `UiSnapshot` | Turn the water reminder on/off (mirrored by the tray checkbox) |
| `ui:set-water-interval` | `number` (one of 30\|45\|60\|90\|120, validated by `isWaterIntervalMin`) | `UiSnapshot` | Change the reminder interval |
| `battle:set-stance` | `Stance` (validated by `isStance`; `'fury' \| 'bulwark' \| 'gale'`) | `{ok, error}` | Set the mon's battle stance (`docs/design/progression.md`); stored locally and, when online, via the `set-loadout` Edge Function |
| `battle:set-loadout` | `SetLoadoutPayload` (`{ stance?, moves?, tree?, respec? }`) | `{ok, error}` | Set stance, the 3 equipped move ids, and/or the talent tree (`docs/design/progression.md` Move pool and effects, `docs/design/talent-tree.md` for `tree`/`respec`), validated locally with the shared `validateLoadout` (mon level/species/existing tree/respec cooldown) before being stored and, when online, forwarded to `set-loadout` (whose response re-syncs `loadout.lastRespecAt`) |
| `water:done` | — | `UiSnapshot` | Reminder card "Done": hides the card, records the sip, sends a `game:cheer` celebration stimulus to the pet (no XP) |
| `water:snooze` | — | `UiSnapshot` | Reminder card "Snooze 10 min": hides the card, re-arms in 10 minutes |
| `account:link-start` | `string` (email) | `AccountOpResult` | Sends a 6-digit code to link an email to the current (anonymous) account |
| `account:link-verify` | `string` (email), `string` (code) | `AccountOpResult` | Verifies the code; on success sets `profile.email` (same auth id, no new profile) |
| `account:link-refresh` | — | `AccountOpResult` (with `account`) | Confirmation-link fallback: re-checks whether the pending link was completed by clicking the email link instead of entering the code (`docs/architecture/flows/account-linking.md`) |
| `account:signin-start` | `string` (email) | `AccountOpResult` | Sends a sign-in code for an *existing* linked account (`shouldCreateUser: false`) |
| `account:signin-verify` | `string` (email), `string` (code) | `AccountOpResult` | Verifies the code, then adopts that account's server profile onto this device |
| `account:signout` | — | `AccountOpResult` | Signs out and resets this device to a fresh anonymous profile |
| `account:start-fresh` | — | `AccountOpResult` | Signed-out banner's "Start fresh": abandons the known account (keeps nation/pet) so a new anonymous player is created (`docs/architecture/flows/account-linking.md#signed-out`) |

## Main → panel/hover card/reminder renderer (`App.pushSnapshot()`)

| Channel | Payload type | Purpose |
|---|---|---|
| `ui:snapshot` | `UiSnapshot` | Pushed on every change (state, progress, battles, leaderboard, update status, notifications) |

## Payload type reference

- **PetConfig:** Sprite scale (2, 3, 4), version, stage, speciesId, nation, world bounds, x position, seed (PRNG stable per install), debug flag, `windowGeometry` (the window's own geometry at the moment this config was sent — seeds `PetRenderer`'s initial geometry so the very first hitbox isn't computed against a `{0,0,0,0}` placeholder before the separate `pet:window-moved` message arrives).
- **WindowGeometry:** x, y, width, height in world DIPs, plus display scaleFactor and `geometryVersion` (bumped by `PetWindow` on every bounds/position change; see `docs/architecture/overlay-window.md`).
- **Hitbox:** `{x, y, w, h}` (window-local) or null when nothing drawn.
- **HitboxMessage:** `{hitbox: Hitbox, geometryVersion: number}` — the geometry version the renderer had in hand when it computed the hitbox, so `CursorTracker` can discard one computed against a since-superseded window position/size (window hop, mode switch, or resize) — see "Geometry versions" in [`docs/architecture/input-and-gestures.md`](../../docs/architecture/input-and-gestures.md#geometry-versions).
- **PointerMessage:** type (down/up/move/enter/leave/contextmenu), button, x, y (window-local).
- **StateMessage:** pet state, stage, x/y (world DIPs).
- **StimulusMessage:** = shared Stimulus (union type from @claude-mons/shared).
- **BattlePlayMessage:** id, result (BattleResult, whose `turns[].actions[]` now carry `moveId`/`effect`/`charge` per docs/design/progression.md Move pool and effects), me/opponent (MonSnapshot, now carrying `loadout.stance`/`loadout.moves`), reward XP, isBot, isElite (10% elite Wild Mon encounter), winStreak (challenger's streak after this battle).
- **BattleSummary:** id, at (timestamp), won, xp, isBot, isElite, winStreak, turns, reason, me (speciesId, stage, level), opponent (nickname, speciesId, stage, level, nation, `loadout: MonLoadout` — the opponent's stance/moves/tree at battle time, `{}` for history recorded before this field existed; docs/design/progression.md Phase D: recent-opponent intel). The Battles tab's "Recent opponents" cards rebuild a `MonSnapshot`-shaped object from `opponent` and pass it to the shared pure `explainMatchup` (`packages/shared/src/battle/matchup.ts`) against the player's current loadout.
- **UiSnapshot:** version, isDev, `devOnboardingStep` (dev builds only: open the onboarding wizard on step n for a capture, from `--dev-onboarding-step <n>`), profile (nickname, nation, userId), account (email, anonymous, signedOut — the last true when a known account lost its session, driving the sign-in-again banner), pet (speciesId, stage, state), progress (localXp, serverXp, streakDays), hooks (status, mode, effectiveMode, probe, codex), settings (scale, autostart), online (connected, lastSyncAt, lastError, configured), update status, notifications, battles (history, cooldownUntil, remainingToday, winStreak, loadout, unlockedMoveIds, treePoints, sharedPassivePoints, lastRespecAt), water (enabled, intervalMin, todayCount, nextDueAt).
- **SetLoadoutPayload:** `{ stance?: Stance, moves?: string[], tree?: Record<string, number>, respec?: boolean }` — same shape the `set-loadout` Edge Function accepts (`packages/shared/src/api.ts:SetLoadoutRequest`); `tree`/`respec` are docs/design/talent-tree.md.
- **AccountOpResult:** `{ok: boolean, error: string | null}`; `error` is a short user-facing string (see `apps/desktop/src/main/net/SupabaseClient.ts`'s `describeAuthError`). See `docs/architecture/flows/account-linking.md`.
- **`water:done`/`water:snooze` are bridged as `window.monsUi.water.done()`/`window.monsUi.water.snooze()`** (a nested object on the shared `uiApi`, alongside the flat `setWaterEnabled`/`setWaterInterval` methods), used only by `src/renderer/reminder/main.tsx`.
- **hooks.status:** `'installed-binary' | 'installed-script' | 'partial' | 'not-installed' | 'unreadable' | 'no-binary'`. **hooks.mode:** the configured preference (`'auto' | 'binary' | 'script'`). **hooks.effectiveMode:** what `'auto'` resolved to (`'binary' | 'script'`). **hooks.probe:** last `probeBinary()` result (`'ok' | 'blocked' | 'missing' | null`). These four describe Claude Code only (the shared install mode); Codex has its own independent hook install, tracked separately in **hooks.codex**: `{status: HookStatusValue, detected: boolean, feature: 'ok' | 'unsupported' | null}` — `status` is the same enum as above for Codex's own `~/.codex/hooks.json`, `detected` is whether `~/.codex` (or `$CODEX_HOME`) exists at all (the panel/tray only offer to connect Codex when it does), and `feature` is the last result of the app enabling `[features] hooks = true` in Codex's `~/.codex/config.toml` (`null` before any attempt, `'unsupported'` when that file's `[features]` table has a form the app refuses to edit automatically). **HookAgent** (`'claude' | 'codex'`) is the `ui:toggle-hooks` payload type, defined once in `src/common/ipc.ts` and re-exported by `src/main/hooks/agents.ts`.
- **LeaderboardPayload:** nations rows, alltime rows, weekly rows, myRank, fetchedAt, error.
