---
doc_type: reference
purpose: "Check this for what is shipping next and open work items past v1."
audience: both
last_verified: 2026-09-13
last_verified_commit: 8a24ac9
related_files:
  - docs/design/progression.md
  - docs/design/talent-tree.md
  - docs/CODE_SIGNING_POLICY.md
  - docs/decisions/0015-apt-repository-on-github-pages.md
  - docs/decisions/0016-email-otp-account-linking.md
  - docs/decisions/0017-force-x11-backend-on-linux.md
  - docs/runbooks/apt-repository.md
  - docs/runbooks/verify-on-linux.md
  - docs/runbooks/auth-email-config.md
---

# claude-mons — Product Roadmap

v1 shipped and has iterated through four tagged pre-releases (`v0.1.1`–`v0.2.0`; see
[`CHANGELOG.md`](../CHANGELOG.md)) — Windows and Linux builds, the full progression system
(stances, moves, talent trees, recent-opponent intel), account linking, the water reminder and a
game-styled panel redesign are all live. This is no longer a pre-release checklist; below is the
actual open work, grouped by urgency.

## Now (near-term infra)

- **SignPath Foundation certificate.** Windows builds are still signed with the `test-signing`
  policy's self-signed certificate; the repository variable `SIGNPATH_ENABLED` is `false` because
  the Foundation certificate has not been attached to the `release-signing` policy yet. Apply for
  the certificate, attach it, and flip `SIGNPATH_ENABLED` to `true`. See
  [`docs/CODE_SIGNING_POLICY.md`](CODE_SIGNING_POLICY.md) and
  [`docs/runbooks/release.md`](runbooks/release.md).
- **APT repository publish.** [ADR 0015](decisions/0015-apt-repository-on-github-pages.md)
  decided to host a signed APT repository on GitHub Pages, but the one-time setup — generating the
  `APT_GPG_PRIVATE_KEY`/`APT_GPG_PASSPHRASE` secrets and enabling GitHub Pages from `gh-pages` — is
  still manual and has not been done: the `gh-pages` branch does not exist yet and
  `https://icaruzsoftware.github.io/claude-mons/install.sh` 404s. Until this is finished, Linux
  users install from the AppImage or `.deb` published on
  [GitHub Releases](https://github.com/IcaruzSoftware/claude-mons/releases). See
  [`docs/runbooks/apt-repository.md`](runbooks/apt-repository.md) for the exact steps and current
  state of what's automated vs. manual.
- **Linux retest with the 0.2.0 build.** The X11-backend force and GPU-off fallback shipped
  recently ([ADR 0017](decisions/0017-force-x11-backend-on-linux.md)); the issues catalogued in
  [`docs/runbooks/verify-on-linux.md`](runbooks/verify-on-linux.md) (#1–#8: window placement,
  drag/fall bounds, click-through, tray fallback) need a fresh pass against `v0.2.0` to confirm
  which are actually fixed.

## Next (v1.1 features & cleanup)

- **Talent tree tier-3/4 flavor effects.** The unique per-branch effects for tier-3/4 nodes
  validate, cost points and gate on prereqs like every other node, but are not wired into
  `simulateBattle` (`packages/shared/src/battle/battle.ts`) — only stat nodes, move-upgrade,
  capstones and the shared passives affect a battle today. See
  [`docs/design/talent-tree.md`](design/talent-tree.md) Implementation notes.
- **Talent tree tier-2 rank-3 alternative.** The design's "rank 3 may instead grant +2pp
  crit/dodge" choice isn't modeled — `{ [nodeId]: rank }` has no per-rank choice storage, so rank 3
  always grants the stat bonus (`packages/shared/src/game/tree.ts`). Same doc as above.
- **Rename the original 3 species moves.** Move slots 1–3 kept their pre-Phase-B
  `normal`/`typed`/`special` names (e.g. "Drip Tap"); slots 4–6 use the element-themed convention.
  Purely cosmetic, in `packages/shared/src/game/species.ts`.
- **Custom SMTP for sign-in codes.** The default Supabase mailer can only deliver a confirmation
  *link*, not the 6-digit code, so signing in on a second device still doesn't work end-to-end.
  See [`docs/runbooks/auth-email-config.md`](runbooks/auth-email-config.md) for the Gmail
  app-password recipe and the exact fields to configure.
- **Multi-monitor drag verification.** Re-anchoring on drop and display changes is implemented
  (`apps/desktop/src/main/display.ts`) but has not been exercised live on real multi-monitor
  hardware — see step 7 of [`docs/runbooks/verify-on-linux.md`](runbooks/verify-on-linux.md).
- **Cross-device sign-in test.** Account linking shipped ([ADR 0016](decisions/0016-email-otp-account-linking.md)),
  but a real pass of "link on device A, sign in with the same email on device B, confirm the same
  mon" with a live inbox has not been run — see the manual end-to-end test in
  [`docs/runbooks/auth-email-config.md`](runbooks/auth-email-config.md).
- **Remove the unused `ui:route` IPC message.** `apps/desktop/src/main/windows/PanelWindow.ts`'s
  `show(route)` still sends `'ui:route'` to the renderer, but `PanelWindow.show()` is never called
  with a route argument anywhere and the renderer routes off `location.hash` instead
  (`apps/desktop/src/renderer/panel/App.tsx`) — dead code, not wired through
  `apps/desktop/src/common/ipc.ts` like every other channel.
- **Deduplicate species tables.** `apps/desktop/src/main/game/species.ts` still mirrors a
  simplified version of `packages/shared/src/game/species.ts` for `LOCAL_GAME`/offline mode;
  consolidate into the one shared source.
- **Wire the `--autostart` flag.** `Autostart.setEnabled` (`apps/desktop/src/main/autostart/Autostart.ts`)
  writes `--autostart` into the Windows login-item args and the Linux `.desktop` `Exec` line, but
  no code reads `process.argv` for it on startup (`apps/desktop/src/main/App.ts`) — the flag has no
  effect yet.
- **Changing nation.** UI + server-side support for a one-time or cooldown nation swap (ties to
  leaderboard changes for nation stats).
- **More species.** Add 2–3 per nation on top of the [current roster](design/species-and-nations.md)
  with new sprite sets and balancing.
- **Seasonal nation events.** Nation-wide challenges with special battle mechanics, bonus XP,
  limited-time cosmetics.
- **Public web leaderboard.** Standalone site showing nation standings and top trainers (read-only
  view of the Supabase data).

## Later (non-blocking, deferred)

- **GitHub OAuth as a second linking option.** Email OTP linking shipped
  ([ADR 0016](decisions/0016-email-otp-account-linking.md)); OAuth was rejected for v1 (needs a
  registered app and a hosted redirect target) but could sit alongside it later.
- **Elo-based matchmaking.** Deferred, not planned near-term; today's matchmaking uses widened
  asymmetric level windows instead (see [`docs/design/progression.md`](design/progression.md)).
- **Native Wayland via layer-shell.** Electron forbids app-positioned always-on-top windows on
  native Wayland; see [ADR 0017](decisions/0017-force-x11-backend-on-linux.md). A Wayland rewrite
  using wlr-layer-shell is blocked on either Electron exposing the protocol or Wayland evolving to
  permit client window positioning. XWayland is the fallback for all Linux users today.
- **Sounds.** SFX for battles, hatch, level-up, and ambient idle loops; requires asset pipeline and
  cross-platform audio API.
- **Code-signing Linux artifacts.** AppImage and deb signing is not applicable; Linux users trust
  package managers or reproducible builds. Document this as the stance.
