---
doc_type: runbook
purpose: "Read this before shipping any change to the panel, onboarding, hover card or reminder UI: how to prove it works without touching your real pet."
audience: both
last_verified: 2026-09-13
last_verified_commit: 44486b0
related_files:
  - scripts/ui-probe.mjs
  - apps/desktop/test/styleContract.test.ts
  - apps/desktop/src/renderer/panel/panel.css
  - apps/desktop/src/renderer/ui/theme.css
  - apps/desktop/src/main/App.ts
  - apps/desktop/README.md
  - docs/design/ui-panels.md
  - docs/design/ui-style.md
  - docs/runbooks/reset-local-state.md
  - docs/runbooks/delete-a-player.md
---

# Verify a UI change

Unit tests cover pure logic, not what the user sees. The 0.2.0 panel redesign shipped a Battles view
whose loadout editor rendered ~700 px below the fold in a container with `scrollbar-width: none`, so
"Edit loadout" looked like a dead button; every test passed. Run the checks below on any change to
`apps/desktop/src/renderer/**` before committing.

## 1. Never test against your own pet

`pnpm dev` with no flags uses your real profile (`%APPDATA%\claude-mons`, `~/.config/claude-mons`)
**and the real backend** — a test run can level your mon, spend battles from the daily cap, or leave
a junk trainer on the global leaderboard that then has to be deleted by hand
(`docs/runbooks/delete-a-player.md`). Always launch UI tests with a throwaway profile:

```bash
export CLAUDE_MONS_PROFILE=/tmp/mons-ui       # any empty directory; %TEMP%\mons-ui on Windows
export CLAUDE_MONS_OFFLINE=1                  # no Supabase calls at all
```

`CLAUDE_MONS_OFFLINE=1` (`apps/desktop/src/main/net/config.ts`) makes the app run with no backend:
the Leaderboard tab shows its offline placeholder and battles fall back to wild opponents. If the
change you are verifying *needs* the server (leaderboard rows, real matchmaking), you are creating a
real player row — use a throwaway profile anyway and delete the row afterwards with
`docs/runbooks/delete-a-player.md`.

Hook installation writes to `<CLAUDE_CONFIG_DIR>/settings.json` (default `~/.claude`). It only happens
when something asks for it — the Connect button, the tray toggle, `--dev-install-hooks`, or a stored
install whose mode no longer matches. A fresh profile has none, so nothing touches your real hooks;
if you are testing the Connect step itself, point `CLAUDE_CONFIG_DIR` at a throwaway directory too.

## 2. Run the static checks

```bash
pnpm test
```

`apps/desktop/test/styleContract.test.ts` fails if a renderer writes a class name no stylesheet it
loads defines (comments stripped, so a class surviving only in a CSS comment does not count). That is
the exact 0.2.0 failure mode. `pnpm lint` and `pnpm typecheck` catch the rest; `pnpm check` runs all
of them plus the docs check.

## 3. Start the app with a debugging port

```bash
pnpm dev -- --user-data-dir="$CLAUDE_MONS_PROFILE" --remote-debugging-port=9333 --dev-nation water --dev-xp 400
```

Everything after `--` goes to Electron. `--user-data-dir` is Electron's own flag (a per-directory
single-instance lock, so this runs alongside your installed app). `--dev-nation` skips onboarding and
`--dev-xp` grants levels; both are ignored in packaged builds. Other dev flags — `--dev-battle`,
`--dev-onboarding-step`, `--dev-water-in`, `--simulate` — are listed in `apps/desktop/README.md`.

Confirm the renderers are up:

```bash
node scripts/ui-probe.mjs targets
```

## 4. Drive the UI and assert

`scripts/ui-probe.mjs` speaks the Chrome DevTools Protocol (Node ≥ 22, no dependencies). `click`
dispatches real `Input.dispatchMouseEvent` presses at the element's center — Preact handlers do not
fire for synthetic `el.click()` in every case, and a real dispatch also proves the element is
actually hittable where it is drawn. `text=LABEL` matches a button by its visible label, which
survives a redesign that renames every class.

```bash
node scripts/ui-probe.mjs click panel "text=BATTLE"
node scripts/ui-probe.mjs click panel "text=Edit loadout"
node scripts/ui-probe.mjs eval panel "(()=>{const r=document.querySelector('.loadout-overlay').getBoundingClientRect();return {top:r.top,onScreen:r.top<innerHeight&&r.bottom>0};})()"
node scripts/ui-probe.mjs text panel ".loadout-card h3"
```

`click` refuses an element that is present but outside the viewport ("present but not on screen"),
which is how you find a control stranded below the fold — the panel's scroll containers hide their
scrollbars, so nothing on screen hints that more content exists.

Assert the things a screenshot cannot: that the element is **on screen** (`getBoundingClientRect`
inside the viewport, not merely present in the DOM), that a click **changed state**, and that a save
**round-trips** — re-read the value from the main tab after saving, so the IPC write is proven, not
just the local component state. Use `CLAUDE_MONS_DEBUG_PORT` if 9333 is taken.

## 5. Look at it

The probe cannot see color, spacing or clipping. GDI screenshots cannot capture the composited
overlay, so use the app's own capture (it writes the pet window, plus `.panel.png` and
`.reminder.png` for any visible panel/reminder window):

```bash
pnpm dev -- --user-data-dir="$CLAUDE_MONS_PROFILE" --dev-nation water --dev-xp 400 --capture "$CLAUDE_MONS_PROFILE/shot.png"
```

Check it against `docs/design/ui-style.md` (palette, spacing scale, type scale, the ~11 px floor for
the pixel display font) and `docs/design/ui-panels.md` (per-view layout). If the change contradicts
either spec, update the spec in the same commit.

## 6. Clean up

Stop the app (close the tray icon or kill the Electron process started from your repo — check the
command line for your throwaway profile path before killing anything) and delete the profile
directory. Nothing else on the machine was written to.

## Acceptance

`pnpm check` is green, the probe's assertions in step 4 hold on a freshly started throwaway instance,
the capture from step 5 matches the specs, and `%APPDATA%\claude-mons` / `~/.config/claude-mons` and
`~/.claude/settings.json` are unchanged.
