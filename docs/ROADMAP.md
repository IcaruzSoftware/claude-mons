---
doc_type: reference
purpose: "Check this for what is shipping next and blocked work items for v1 and beyond."
audience: both
last_verified: 2026-09-13
last_verified_commit: 8f6efa8
related_files:
  - docs/history/v1-design-2026-09-04.md
  - docs/history/v1-handoff-2026-09-04.md
  - docs/CODE_SIGNING_POLICY.md
  - docs/decisions/0014-curl-script-mode-hook-fallback.md
  - docs/decisions/0016-email-otp-account-linking.md
  - docs/decisions/0017-force-x11-backend-on-linux.md
  - docs/design/progression.md
---

# claude-mons — Product Roadmap

v1 is feature-complete and end-to-end tested on Windows 11. Below are the blockers before a public release, planned features for v1.1+, and out-of-scope items for later.

## Now (v1 release blockers)

- **Linux verification.** Window flags, AppImage/deb builds, autostart `.desktop` file, and tray fallback are implemented but not tested on real Linux hardware; build succeeds in CI (`apps/desktop`).
- **SignPath Foundation certificate.** Self-signed cert is working for test releases; apply for the Foundation cert and attach it to the `release-signing` policy (`docs/CODE_SIGNING_POLICY.md`).
- **Database password.** `.env.local` password does not authenticate; correct it so `npx supabase db push` works for future migrations (currently using Management API fallback).
- **First tagged release.** Tag `v0.1.0` to exercise the `.github/workflows/release.yml` workflow and auto-update; this makes the build public and starts the keepalive cron.
- **Remove unused `ui:route` IPC.** Channel sent by `PanelWindow.show()` but no renderer listener; routing off `location.hash` instead (`apps/desktop/src/common/ipc.ts`).
- **Deduplicate species.** `apps/desktop/src/main/game/species.ts` mirrors the shared species table for offline mode; consolidate into one source (`packages/shared/src/game/species.ts`).
- **Wire `--autostart` flag.** Flag is parsed and written to login item / `.desktop` Exec but never read on startup (`apps/desktop/src/main/autostart/Autostart.ts`).

## Next (v1.1 features & UX)

- **Progression system phases A–D (in progress).** Move pool per species, pre-battle loadout/stance
  selection, per-nation talent trees and richer matchmaking/streaks — see [docs/design/progression.md](design/progression.md).
- **Changing nation.** UI + server-side support for a one-time or cooldown nation swap (ties to leaderboard changes for nation stats).
- **More species.** Add 2–3 per nation on top of the [current roster](design/species-and-nations.md) with new sprite sets and balancing.
- **Seasonal nation events.** Nation-wide challenges with special battle mechanics, bonus XP, limited-time cosmetics.
- **Public web leaderboard.** Standalone site showing nation standings and top trainers (read-only view of the Supabase data).

## Later (non-blocking, nice-to-have)

- **GitHub OAuth as a second linking option.** Email OTP linking shipped ([ADR 0016](decisions/0016-email-otp-account-linking.md)); OAuth was rejected for v1 (needs a registered app and a hosted redirect target) but could sit alongside it later.
- **Native Wayland via layer-shell.** Electron protocol forbids app-positioned always-on-top windows on native Wayland; see [ADR 0017](decisions/0017-force-x11-backend-on-linux.md). A Wayland rewrite using wlr-layer-shell is blocked on either Electron exposing the protocol or Wayland evolving to permit client window positioning. XWayland is the fallback for all Linux users today.
- **Sounds.** SFX for battles, hatch, level-up, and ambient idle loops; requires asset pipeline and cross-platform audio API.
- **Code-signing Linux artifacts.** AppImage and deb signing is not applicable; Linux users trust package managers or reproducible builds. Document this as the stance.
