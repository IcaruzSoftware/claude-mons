---
doc_type: reference
purpose: "Release notes and version history; check this when seeing claude-mons updates or deciding what version to expect features in."
audience: both
last_verified: 2026-09-13
last_verified_commit: e3483fc
related_files:
  - docs/history/v1-handoff-2026-09-04.md
  - docs/README.md
  - docs/decisions/0016-email-otp-account-linking.md
  - docs/decisions/0017-force-x11-backend-on-linux.md
  - docs/decisions/0018-compact-window-and-fail-closed-click-through.md
  - docs/runbooks/auth-email-config.md
  - docs/design/talent-tree.md
---

# Changelog

All notable changes to claude-mons are documented here. See [Keep a Changelog](https://keepachangelog.com/) for format details.

## [Unreleased]

### Added
- Optional email account linking: Settings' Account section lets a player link an email (6-digit code, no password ever) so the same mon can be used on a second computer, and sign in with that email on a fresh install (Onboarding's "Already have a mon? Sign in") to adopt the server profile instead of choosing a nation. `apps/desktop/src/main/net/SupabaseClient.ts` gains `linkEmail`/`verifyLinkCode`/`requestSignInCode`/`verifySignInCode`/`linkedEmail`/`signOutToAnonymous`; `apps/desktop/src/main/net/account.ts` holds the pure email-validation and profile-adoption/reset transforms. `scripts/supabase-auth-config.mjs` configures the required Supabase auth settings (manual linking, autoconfirm off, code-carrying email templates). See `docs/decisions/0016-email-otp-account-linking.md` and `docs/architecture/flows/account-linking.md`. `LocalState` gains `profile.email` (`MIGRATIONS[2]`, schema v3 → v4).
- Confirmation-link fallback for linking an email on the free-tier default mailer, which cannot deliver the 6-digit code (only its own built-in link): `SupabaseClient.refreshLinkedEmail()` (`auth.refreshSession()` + `auth.getUser()`, resolved through the new pure `resolveConfirmedEmail` in `apps/desktop/src/main/net/account.ts`) detects a link the player clicked in their mail client, exposed as `IPC.accountLinkRefresh` (`account:link-refresh`). `apps/desktop/src/renderer/ui/AccountEmailCode.tsx` shows an "I clicked the link" button for the linking widget and auto-polls the same call every 5 s for up to 10 minutes so the panel notices on its own; the sign-in-on-a-new-device widgets show a one-line hint instead, since that path has no link-based equivalent and still needs custom SMTP. See `docs/architecture/flows/account-linking.md` and the updated `docs/runbooks/auth-email-config.md` (adds a Gmail app-password SMTP recipe).
- "Battle now" tray/context menu item: initiates a battle without shaking the pet (alternative gesture on platforms where shake input fails).
- **Progression system Phase A** (`docs/design/progression.md`): battle stances (Fury/Bulwark/Gale, a rock-paper-scissors triangle of ±18% stat trade-offs plus a +10%/-10% counter bonus), evolution stat multipliers (Baby ×1.00, Teen ×1.15, Adult ×1.30 in `packages/shared/src/game/levels.ts:statAtLevel`, mirrored in SQL), widened asymmetric matchmaking windows (`[-2,+1]` → `[-4,+2]` → any level) and elite Wild Mons (10% of encounters, +3 levels, double challenger XP, `isElite` flag), and win streaks (+10% challenger XP per consecutive win, capped at +50%, `mons.win_streak`). `MonSnapshot` gains an optional `loadout` (`{ stance?, moves?, tree? }`, shape ready for Phase B/C); a new `set-loadout` Edge Function validates and stores `{ stance }` via the shared pure `validateLoadout`. New migration `supabase/migrations/20260913020000_progression_phase_a.sql` (`mons.loadout`/`win_streak`/`last_respec_at`, `battles.protocol_version`, updated `pick_opponent`/`settle_battle`/`recompute_mon`). `BATTLE_PROTOCOL_VERSION` bumps to 2 (stored per battle so old logs replay from their stored snapshot, never recomputed). The Battles tab gets a stance picker and a win-streak badge. See `docs/design/battle.md` and `docs/architecture/flows/shake-to-battle.md`.
- **Progression system Phase B** (`docs/design/progression.md`): every species' move pool grows from 3 moves (`normal`/`typed`/`special`) to 6 (`packages/shared/src/game/species.ts:Move`/`movePool`), unlocking 2 at hatch (level 2) then one each at 5/10/15/20 (`unlockedMoves`). Each move carries exactly one of 8 effects (`priority`, `crit_up`, `drain`, `shield_first`, `def_down`, `burn`, `true_hit`, `charge` — new `packages/shared/src/battle/effects.ts`, with per-battle state for shield/finisher one-shots, `def_down`/`burn` turn counters and a pending `charge` release). `simulateBattle`'s move selection is now a loadout policy (turn 1 = slot 1/opener; slot 3/finisher fires once when either side drops below its HP threshold; otherwise slot 2 w.p. 0.8 else slot 1) instead of the old fixed `normal`/`typed`/`special-at-half-HP` rule; a `priority`-effect move wins the turn-order tie-break outright. `BattleAction` gains `moveId`/`effect`/`charge`, plus a synthetic burn-tick entry each affected turn. `BATTLE_PROTOCOL_VERSION` bumps to 3 (golden log regenerated). `set-loadout` now accepts and validates `moves` (3 distinct, unlocked ids) alongside `stance`, with typed rejection codes (`error.details.code`, e.g. `MOVE_LOCKED`); `MonState` gains `loadout`/`unlockedMoveIds`. `MonSnapshot.loadout.moves` is always populated by `snapshotFor` (defaulting to the first 3 unlocked moves in pool order when unset), so stored battle snapshots, `pick_opponent` rows and Wild Mons all carry a complete loadout without a backfill migration (`supabase/migrations/20260913040000_progression_phase_b.sql` is docs-only). The Battles tab's stance picker becomes a loadout editor overlay (3 move dropdowns with reorder, locked moves greyed with their unlock level, stance picker inside); battle banners now name the effect that fired (e.g. "Sparkit's Brushfire burns Pebblet"). `packages/shared/test/balance.test.ts` adds a loadout archetype matrix (aggro/bulk/dot/tempo × cross-nation × levels 10/30); `def_down`'s DEF multiplier and `crit_up`'s bonus/ceiling were retuned by simulation to keep archetypes within band (see `docs/design/progression.md` Move pool and effects). See `docs/design/battle.md` and `docs/architecture/flows/shake-to-battle.md`.
- **Progression system Phase C** (`docs/design/talent-tree.md`, new doc split out of `docs/design/progression.md`): each mon spends points (1/level from level 3, 47 by level 50) across 3 branches of 6 tiered nodes in its own nation — stat nodes (tiers 1-2), two structural-only per-branch passives (tiers 3-4, validated but not yet wired into battles), a move-upgrade node (tier 5) and a capstone (tier 6) — plus a small nation-agnostic shared-passive pool (10 passives, up to 3 picks by level 45). New `packages/shared/src/game/tree.ts` holds all node data, `pointsAvailable`/`sharedPassivePoints`, `validateTree` (typed errors `TREE_UNKNOWN_NODE`/`TREE_RANK`/`TREE_PREREQ`/`TREE_OVER_BUDGET`), `isRespec`, `resolveTree` and `defaultBotTree` (so Wild Mons spend down their first branch and scale like players). `validateLoadout` (`packages/shared/src/game/progression.ts`) now accepts `tree`/`respec` and enforces the respec rule (free below level 10, once per 7 days past it, checked against the mon's own stored `tree`/`mons.last_respec_at`; a respec is any change that lowers a node's rank, always re-derived server-side). `simulateBattle` folds stat/flat-stat-capstone bonuses into snapshot stats and wires move-upgrade, the 12 capstones and the 10 shared passives into the damage formula, turn order and crit/dodge math; `BATTLE_PROTOCOL_VERSION` bumps to 4 (the golden log itself is unchanged, since an untreed mon's battle is bit-identical to Phase B). `set-loadout` validates and stores `tree`, stamps `last_respec_at` on a genuine respec, and `MonState` gains `treePoints`/`sharedPassivePoints`/`lastRespecAt`. The Battles tab's loadout editor gains a Talents section (3-branch grid × 6 tiers, click to add/remove a rank, shared-passive toggles, a point counter, a respec confirm step and cooldown display, `IPC.battleSetLoadout`'s payload extended with `tree`/`respec`). Several of the design doc's literal magnitudes needed tuning down by simulation to hit the "+15-20% effective power at a maxed budget" and "no dominant branch" targets — see `docs/design/talent-tree.md` Balance targets for the numbers (`packages/shared/test/balance.test.ts`'s new talent-tree matrix, plus a new `packages/shared/test/tree.test.ts`).
- **Progression system Phase D** (`docs/design/progression.md` Recent-opponent intel): a new pure, deterministic `explainMatchup(me, opp)` (`packages/shared/src/battle/matchup.ts`, 12 unit tests) turns two `MonSnapshot`s into a nation-type line, a stance line, the opponent's opener/finisher move + effect, its top-invested talent branch (`topBranch`/`toRoman`, e.g. "Tremor III"), and one rule-derived suggestion (stance counter > burn-vs-shield/Stone-Skin > true-hit-vs-Gale-dodge > nation-type lean > neutral fallback), with `suggestedStance` set only for the stance-counter case. `BattleSummary.opponent` (`apps/desktop/src/common/ipc.ts`) gains `loadout: MonLoadout` (recorded by `BattleService.finish` from the resolved battle's opponent snapshot; backfilled to `{}` on existing history entries by the new `addOpponentLoadoutSummary` migration, schema v6 → v7) so the Battles tab can rebuild a snapshot-shaped opponent from history alone. The Battles tab's History list becomes "Recent opponents" cards (last 10): nickname/Wild, nation badge, species + level, stance, 3 move names, top-branch badge, result/XP/relative time, and the `explainMatchup` suggestion re-computed against the player's *current* loadout on every render; a "Counter this" button pre-selects the suggested stance in the loadout editor without saving it.

### Changed
- Battle limits: `BATTLE_RULES` (`packages/shared/src/battle/battle.ts`) raises `challengesPerDay` 10 → 50 and `cooldownMs` 5 → 10 minutes; the client (`apps/desktop/src/main/game/BattleService.ts`, `apps/desktop/src/renderer/panel/views/Battles.tsx`) and server (`claim_battle_slot`, `supabase/functions/_shared/monState.ts`) already derived their gates/countdowns from this constant, so both sides move together. `supabase/migrations/20260913010000_battle_limits.sql` replaces `claim_battle_slot` with the new interval and cap. The defender-side cap (first 10 defenses/day pay XP, in `settle_battle`) is unchanged, and battle XP remains uncapped by the work-XP daily caps. See `docs/design/battle.md`.
- Retuned Phase A stance and evolution-stage constants by simulation: stances now grant +2%/cost −6% (down from ±18%) with a ±2% counter bonus (down from ±10%), and Bulwark's cost stat moved from SPD to ATK so all three stance pairings swing symmetrically; evolution stage multipliers are now Teen ×1.03/Adult ×1.06 (down from ×1.15/×1.30). Lands every stance-counter pairing at 55–62% and both stage-boundary matchups at 38–48%, against the original numbers' 80–97%/sub-50% and ~27–28%. See `docs/design/progression.md` Stances and Evolution multipliers, `packages/shared/src/game/progression.ts`, `packages/shared/src/game/levels.ts`, and `supabase/migrations/20260913030000_progression_tuning.sql`.

### Fixed

- **Pet overlay could get stuck accepting clicks across the whole screen width, or lose track of
  the sprite's hitbox entirely.** The pet's normal window used to be a "strip" spanning the full
  work-area width so the pet could walk without the window moving; if click-through ever got stuck
  disabled (a stale/missing hitbox, a race between a mode switch and the next hitbox report), any
  click along the bottom of the screen reached the pet window — reported live as "clicking a button
  in Chrome randomly opens the claude-mons menu" and "the moment the pet walks around it can't be
  dragged." The strip window is removed: the pet's one normal window (`follow`) is now always
  compact (about 3 sprite-widths by 2.5 sprite-heights, `PetWindow.COMPACT_WIDTH_GRID`/
  `COMPACT_HEIGHT_GRID`) and only hops (`PetWindow.followTo`/`apps/desktop/src/main/display.ts:needsHop`) once the sprite
  drifts far enough from its center, or immediately during a drag/fall/landing/display change.
  `CursorTracker` now defaults to click-through closed from construction, re-derives and
  re-asserts that decision every tick instead of trusting a cached `hovering` flag, requires a
  fresh cursor sample and a fresh hitbox tagged with the window's current `geometryVersion`
  (`PetWindow`'s bounds-change counter, plumbed through `WindowGeometry`/`HitboxMessage`) before
  accepting input, forces click-through closed on any tick exception, and `PetHost` forces it
  closed outright on blur/hide/mode-switch/display-change and re-checks `isPointAccepted` before
  acting on a pointerdown/context-menu. "Bring pet back" still works but should no longer be the
  only fix. See [ADR 0018](docs/decisions/0018-compact-window-and-fail-closed-click-through.md) and
  the rewritten `docs/architecture/overlay-and-input.md`.
- **Suspicion false positive for legitimate heavy users.** `ingest-xp`'s suspicion heuristic used to increment `players.suspicion` whenever more than half of a batch's claimed XP was dropped for *any* reason, including the per-minute/hour/day caps that a heavy user (or a spooled offline replay) trips as a matter of course. `supabase/functions/_shared/pipeline.ts:runIngestPipeline` now returns `out.suspicious`, true only when a batch claimed at least 100 XP and more than half of it was dropped for a non-cap reason (`stale`/`future`/`implausible`/`no_prompt_context`); cap drops (`cap_minute`/`cap_hour`/`cap_day`) never count. `apply_xp` (`supabase/migrations/20260913000000_suspicion_and_nations_filter.sql`) also now decays `suspicion` by 1 (floor 0) every time a batch activates a new day, so a flagged player who keeps playing normally recovers. The same migration fixes `leaderboard_nations`, whose `weekly_xp` aggregate did not exclude suspicion ≥10 players even though its other columns did, so a flagged player's weekly XP still counted toward their nation while their personal entry had already dropped off `leaderboard_alltime`/`leaderboard_weekly`. See `docs/design/backend-rules.md`.
- Update check no longer fails with "Cannot read properties of undefined (reading 'checkForUpdates')": electron-updater is CommonJS and its `autoUpdater` export is only reachable through the default export in the packaged ESM bundle. Update errors are now one readable line (e.g. no release published yet, offline).
- **Linux overlay always stays on top.** The app now forces XWayland (X11 backend via `ozone-platform x11` switch) on all Linux distributions, even native Wayland sessions, because native Wayland cannot provide window positioning, cursor polling, or always-on-top semantics (see [ADR 0017](docs/decisions/0017-force-x11-backend-on-linux.md)). `PetWindow.reassertTopmost()` now runs every 5 s on Linux as well as Windows, since some X11 window managers drop the `_NET_WM_STATE_ABOVE` flag after focus changes. Set `CLAUDE_MONS_NATIVE_WAYLAND=1` to override and test native Wayland (currently unsupported).
- **Update check failed with `ENOENT: no such file or directory, open '...\resources\app-update.yml'` on every installed Windows build.** electron-builder only writes that file from its own packaging pass when the pass produces an updater-aware target directly; CI's Windows job signs in between by packaging with `--dir` (target is an internal "dir" no-op, which fails electron-builder's Windows suitability check) and then `--prepackaged` (skips its packaging step, and the write, entirely) — so no installed build ever got the file. `apps/desktop/scripts/after-pack.mjs` (wired up via `apps/desktop/electron-builder.yml`'s new `afterPack:` key) now writes it itself whenever electron-builder's own writer skipped it. `apps/desktop/electron-builder.yml` also adds `extraMetadata.name: claude-mons`, since electron-builder derives `updaterCacheDirName` from package.json's `name` (the pnpm workspace name @claude-mons/desktop, which sanitizes to a scope-mangled value) rather than `productName`. See `docs/runbooks/release.md`.

### Added
- Documentation tooling: `scripts/check-docs.mjs` script and CI job to validate doc structure and code references.
- Code signing infrastructure: SignPath Foundation signing pipeline (test certificate verified).
- Privacy policy and code signing policy documentation.
- APT repository: `scripts/build-apt-repo.sh` publishes a signed APT repository to GitHub Pages from the `apt` job in `.github/workflows/release.yml`; `curl -fsSL https://icaruzsoftware.github.io/claude-mons/install.sh | sudo bash` then `sudo apt upgrade` installs and updates claude-mons on Debian/Ubuntu. See `docs/runbooks/apt-repository.md`.
- Script-mode hook fallback: on machines where Windows Smart App Control blocks the unsigned Go hook binary, the app now installs a `curl`/`curl.exe` command instead, posting raw Claude Code hook events to a new `/hook` endpoint (`apps/desktop/src/main/hooks/HookServer.ts`) that reduces them with the same metadata whitelist as the binary. Mode is auto-detected by actually probing the binary at start (`apps/desktop/src/main/hooks/mode.ts`), with a manual override in Settings; see `docs/decisions/0014-curl-script-mode-hook-fallback.md`.
- Onboarding wizard: `apps/desktop/src/renderer/panel/views/Onboarding.tsx` is now a 5-step wizard (welcome, what-is-claude-mons, controls reference, connect Claude Code, nation picker) with Back/Next buttons and step dots, replacing the bare nation-picker screen; copy lives in one `onboardingCopy` constant and step transitions go through pure helpers in `apps/desktop/src/renderer/panel/onboardingSteps.ts`. The new "Connect Claude Code" step calls the same hook-toggle IPC as Settings (via the shared `apps/desktop/src/renderer/ui/hookStatus.ts` helpers) and never installs hooks without a click; the nation-picker step was also re-tuned (smaller cards, clamped blurbs) and the wizard's scrollbar hidden so the four-nation grid fits the 440×660 panel without scrolling.
- Water reminder: on by default, nags every 30/45/60/90/120 minutes (configurable in Settings and mirrored by a tray checkbox) with a small 260×110 card next to the pet (`apps/desktop/src/main/windows/ReminderWindow.ts`, `apps/desktop/src/renderer/reminder/`) showing the nation-tinted sprite (or a 💧 glyph before hatch), "Time for a sip of water", and **Done**/**Snooze 10 min** buttons. The card is skipped while the pet is asleep or mid-battle, auto-hides after 5 minutes if ignored and re-arms for the normal interval, and never shows more than one at a time. Scheduling is a pure, Electron-free `WaterReminder` class (`apps/desktop/src/main/reminders/WaterReminder.ts`) with an injected clock, covered by `apps/desktop/test/WaterReminder.test.ts`. **Done** records a daily sip counter (UTC day key, shown in Settings as "Today: N sips") and plays a small celebration via a new `game:cheer` behavior stimulus (`packages/shared/src/behavior/stimuli.ts`) — no XP is awarded. `LocalState` gains `settings.waterReminder` and a top-level `water` key (`MIGRATIONS[1]`, schema v2 → v3).

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
