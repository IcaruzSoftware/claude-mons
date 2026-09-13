---
doc_type: history
purpose: "Historical record of what shipped between the v1 hand-off (2026-09-04/05) and the 0.2.0 release (2026-09-13); not authoritative, see docs/README.md for current docs."
audience: both
last_verified: 2026-09-13
last_verified_commit: 8a24ac9
related_files:
---

> **Historical document.** Frozen as written on 2026-09-13. Facts here may be outdated; the current documentation is indexed in [docs/README.md](../README.md).

# v1 first week (2026-09-04 to 2026-09-13)

A dated log of what happened between the v1 hand-off (`docs/history/v1-handoff-2026-09-04.md`,
`docs/history/v1-design-2026-09-04.md`) and the 0.2.0 release, compiled from
`git log --oneline 3fc7366..HEAD` and `CHANGELOG.md`. It records what shipped and when, not how any
of it works — the durable specs live in `docs/design/`.

## 2026-09-05 — first Linux pass and first-run fixes

The first live run on Linux (Ubuntu 24.04, GNOME/Wayland) surfaced overlay bugs: the pet spawned
centred instead of at the bottom edge, drifted past bounds, and lost input entirely. The same day
also shipped: a battle arena window mode with HUD fitting and geometry fixes; a first-run fix so
the pet overlay stays hidden until a nation is chosen instead of showing a default-tinted egg during
onboarding; a 5-step onboarding wizard replacing the bare nation picker; a script-mode fallback for
the Go hook binary on machines where Windows Smart App Control blocks unsigned executables; and an
APT repository published to GitHub Pages for Debian/Ubuntu installs. See `CHANGELOG.md`'s `[0.1.0]`
follow-on fixes and the `[Unreleased]`-at-the-time entries later folded into `[0.1.2]`/`[0.1.3]`.

## 2026-09-06 — updater fix

`electron-updater`'s `autoUpdater` export is CommonJS and only reachable through the packaged ESM
bundle's default export; the update-check crash ("Cannot read properties of undefined") was fixed by
resolving it correctly.

## 2026-09-09 — Linux X11, account linking, water reminder

Four changes landed:

- **Water reminder** shipped: a periodic sip-reminder card next to the pet, on by default,
  configurable in Settings.
- **Account linking** (`docs/decisions/0016-email-otp-account-linking.md`) shipped: an optional
  email + 6-digit code, letting a player carry one mon to a second machine. A confirmation-link
  click was added shortly after as an alternative to typing the code, for mail providers whose
  free-tier templates only carry a link.
- **Linux: force the X11 backend.** Native Wayland could not position the window, poll the cursor,
  or hold always-on-top, breaking drag/fall/click-through outright. The app now forces XWayland by
  default (`docs/decisions/0017-force-x11-backend-on-linux.md`), re-asserts topmost every 5s on
  Linux as well as Windows, and adds a "Battle now" tray/context-menu item as an alternative to the
  shake gesture.

## 2026-09-13 — compact window, progression system, four releases, and a redesign

The busiest day of the week, in the order things landed:

- **Compact window and fail-closed click-through**
  (`docs/decisions/0018-compact-window-and-fail-closed-click-through.md`): the pet's normal window
  is always a small compact rect now, not a full-width strip, and click-through defaults closed and
  re-derives every tick instead of trusting a cached flag — closing the "clicking a button in
  Chrome randomly opens the claude-mons menu" reports. Bundled with this: a GPU/updater crash fix
  (non-finite coordinates reaching `setBounds`), an ingest suspicion-heuristic false positive for
  legitimate heavy users, a leaderboard aggregate that didn't exclude flagged players, and an
  update-check ENOENT fix for the Windows CI packaging path.
- **Progression system, phases A-D** (`docs/design/progression.md`, `docs/design/talent-tree.md`):
  Phase A added battle stances, evolution stat multipliers, wider matchmaking windows and win
  streaks; Phase B grew every species' move pool and added per-move effects with a loadout policy
  and editor; Phase C added per-nation talent trees with a shared-passive pool and respec rules;
  Phase D added recent-opponent intel (`explainMatchup`) and a stance-counter suggestion. Each phase
  is its own commit; the mechanics and current numbers are specified in those two design docs, not
  here.
- **Balance retuning by simulation.** Initial numbers for the evolution-stage multipliers and stance
  magnitudes missed their target win-rate bands (matchups in the high-80s/90s percent instead of the
  designed range) and were retuned the same day; move-effect magnitudes (`def_down`, `crit_up`) and
  talent-tree magnitudes were separately retuned to keep loadout archetypes and maxed-budget power
  within their own target bands. All retunes are enforced by `packages/shared/test/balance.test.ts`
  (cross-nation and loadout/talent-tree matrices); see `docs/design/progression.md` and
  `docs/design/talent-tree.md` for the current numbers.
- **A config-push incident during Phase A's deploy.** Pushing config with `npx supabase config push`
  reset the project's live account-linking auth settings (site URL, manual linking, mailer
  autoconfirm) back to the repo's local-dev defaults, because those settings are managed out-of-band
  by `scripts/supabase-auth-config.mjs` rather than through `supabase/config.toml`. The live settings
  were restored via that script. `docs/runbooks/deploy-backend.md` (already updated, read it there
  for the current operational wording) records what to do instead.
- **Four releases published:** `0.1.1` (first published pre-release; the updater was also changed to
  accept pre-release versions), `0.1.2` (a `motion` window mode so dragging and falling no longer
  stutters or clips the sprite against a not-yet-repositioned window), `0.1.3` (a loadout-editor
  Save bug fixed for mons with fewer than 3 unlocked moves, the Mon tab's move list now hides
  locked moves instead of showing them in one flat colour, and the UI redesign specs
  `docs/design/ui-style.md`/`docs/design/ui-panels.md` were written), and `0.2.0` (the game-style
  panel redesign — see `docs/decisions/0019-game-style-panel-ui.md` — plus a fix for evolved mons
  rendering no sprite).
- **Leaderboard follow-up fix**, landed just after `0.2.0`: nation tallies now ignore orphaned
  battles and hide a win-rate bar for a nation with no tallied battles instead of drawing it at 0%.

## What this week did not cover

Nothing in this log touches anything after the `0.2.0` release or before the v1 hand-off; those are
out of scope for this document by construction. Linux verification remains partial — see
`docs/runbooks/verify-on-linux.md` for the current state, not this log.
