---
doc_type: reference
purpose: "Check this for what is shipping next and blocked work items for v1 and beyond."
audience: both
last_verified: 2026-09-05
last_verified_commit: ab12392
related_files:
  - docs/history/v1-design-2026-09-04.md
  - docs/history/v1-handoff-2026-09-04.md
  - docs/CODE_SIGNING_POLICY.md
  - docs/decisions/0014-curl-script-mode-hook-fallback.md
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

- **Account linking.** Email or GitHub OAuth so players can keep their pet and stats across device reinstalls; replaces anonymous-only session.
- **Changing nation.** UI + server-side support for a one-time or cooldown nation swap (ties to leaderboard changes for nation stats).
- **More species.** Add 2–3 per nation on top of the [current roster](design/species-and-nations.md) with new sprite sets and balancing.
- **Seasonal nation events.** Nation-wide challenges with special battle mechanics, bonus XP, limited-time cosmetics.
- **Public web leaderboard.** Standalone site showing nation standings and top trainers (read-only view of the Supabase data).

## Later (non-blocking, nice-to-have)

- **Native Wayland support.** Electron protocol forbids app-positioned always-on-top windows on native Wayland; XWayland works by design, so a Wayland rewrite is out of scope until Electron or Wayland evolves.
- **Sounds.** SFX for battles, hatch, level-up, and ambient idle loops; requires asset pipeline and cross-platform audio API.
- **Code-signing Linux artifacts.** AppImage and deb signing is not applicable; Linux users trust package managers or reproducible builds. Document this as the stance.
