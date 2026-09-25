---
doc_type: runbook
purpose: "Read this to understand, run or debug the Linux e2e input harness (x11 and wayland-xwayland legs)."
audience: both
last_verified: 2026-09-25
last_verified_commit: ac89a95
related_files:
  - .github/workflows/linux-e2e.yml
  - scripts/linux-e2e/run.sh
  - scripts/linux-e2e/probe.mjs
  - scripts/linux-e2e/vpointer.c
  - scripts/linux-e2e/wlr-virtual-pointer-unstable-v1.xml
  - docs/decisions/0017-force-x11-backend-on-linux.md
  - docs/runbooks/verify-on-linux.md
---

# Linux e2e input harness

The `Linux e2e` workflow verifies the pet overlay's OS-level input on Linux — hover, left-click,
drag, click-through and right-click — by driving **real pointer input** against the running app under
two display environments. It is the automated stand-in for weeks of manual "the pet does not react on
Linux" guessing: it reproduces, and gates against, the input bug on GitHub runners. The bug lives
below Chromium, so the harness never uses CDP synthetic events; it injects at the OS input layer and
reads the app's `CLAUDE_MONS_DEBUG` stdout as the "did input reach the renderer" oracle.

## Legs

| Leg | Display stack | Pointer injection |
|---|---|---|
| `x11` | `Xvfb` + `openbox` + `picom` | `xdotool` warps the X pointer (XTEST) |
| `wayland-xwayland` | headless `sway` (wlroots) + `XWayland` | a virtual-pointer client injects through the compositor |

Both run the unpackaged production build (`electron out/main/index.js`) with the same flags the
packaged `.desktop` entry passes (`--ozone-platform=x11 --disable-gpu`), so the app runs under
XWayland on the wayland leg exactly as it does on the owner's GNOME/Wayland session (see
[ADR 0017](../decisions/0017-force-x11-backend-on-linux.md)). The app is seeded with `--dev-nation`
only, so the pet stays a stationary egg whose hitbox does not change mid-run.

## Why the wayland leg cannot use xdotool

Under XWayland, XTEST pointer injection only reaches the compositor when the compositor implements
libei/EIS. Headless `weston` (an earlier fallback) does not, so `xdotool mousemove` moved nothing and
every step failed with `aimed=null` — the leg tested nothing. The x11 leg is unaffected because there
XTEST talks to a real X server.

## How the wayland leg injects input

`scripts/linux-e2e/run.sh` brings up a headless wlroots session:

```sh
WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman LIBGL_ALWAYS_SOFTWARE=1 sway -c <cfg>
```

The config gives one `HEADLESS-1` 1920x1080 output, enables XWayland and floats every window so it
keeps its client-requested geometry (sway tiles by default). `swaymsg` reaches sway over the IPC
socket discovered under `$XDG_RUNTIME_DIR`.

A headless seat has **no input devices**, so it advertises no pointer capability
(`swaymsg -t get_seats` shows `capabilities: 0`) and sway never assigns the seat to XWayland
(`no seat assigned to xwayland` in `sway.log`). `swaymsg seat … cursor set` then warps a cursor
XWayland cannot see, and no X client gets input. The fix is to attach a **real** pointer device:

- `scripts/linux-e2e/vpointer.c` is a tiny persistent client of the `wlr-virtual-pointer` protocol
  (vendored as `scripts/linux-e2e/wlr-virtual-pointer-unstable-v1.xml`, since it is not packaged).
  Creating a `zwlr_virtual_pointer_v1` gives the seat pointer capability, so sway assigns the seat to
  XWayland and events flow compositor → XWayland → app.
- `run.sh` compiles it with `wayland-scanner`/`cc`, starts it before XWayland, and feeds it one
  command per line over a FIFO (`move <x> <y>`, `down|up|click <left|right>`). stdin is the FIFO
  opened read-write so the client blocks for the next command and never sees EOF.
- `scripts/linux-e2e/probe.mjs` selects its input backend from `$MODE`: x11 keeps `xdotool`, wayland
  writes FIFO commands. X **window** management for the click-through test (locate/move the `xev`
  under-window) stays on `xdotool` — X protocol works fine under XWayland; only XTEST injection does
  not.

After the fix `get_seats` reports `capabilities: 1` with a `wlr_virtual_pointer_v1` device, and all
six checks pass. (Generated artifact files below are named in plain text, not as repo paths.)

## Run it

- **CI:** it runs on pull requests touching `apps/desktop/**`, `packages/**`,
  `scripts/linux-e2e/**` or the workflow, and via `gh workflow run linux-e2e.yml --ref <branch>`.
- **Locally (Linux only):** install the tooling listed in the workflow's *Install display + input
  tooling* step, build the app (`pnpm --filter @claude-mons/desktop build`), then:

```sh
bash scripts/linux-e2e/run.sh x11
bash scripts/linux-e2e/run.sh wayland-xwayland
```

Exit codes: `0` all steps passed, `1` a step failed, `78` the display environment could not start.

## Artifacts

Each leg uploads `artifacts-linux-e2e/<mode>/`:

| File | What it tells you |
|---|---|
| results.json / step summary | per-check pass/fail with detail |
| `app.log` | the app's `[pet]` debug stream (the input oracle) |
| cursor-diagnostic.json | injection backend, target vs observed pointer, and (wayland) `get_seats` |
| `sway.log` / `vpointer.log` | compositor and virtual-pointer client startup |
| `00-…png` … `05-…png` | screenshots per step |
| `xwininfo-*.txt` / `xprop-*.txt` / `xev.log` | X window shape, properties and click-through evidence |

## Debugging

- **`aimed=null` everywhere (wayland):** the pointer never moved. Check `vpointer.log` for
  `vpointer: ready` and cursor-diagnostic.json for `capabilities` — `0` means the virtual pointer
  did not attach.
- **`78` on wayland:** sway, XWayland or the virtual-pointer client did not come up; read
  `sway.log`, then `vpointer.log`.
- **Genuine app regressions** show as input reaching the renderer on x11 but not wayland (or vice
  versa) with the pointer demonstrably moving; cross-check `app.log` against cursor-diagnostic.json.

## Acceptance

- Both legs report `6/6 checks passed` in the step summary and results.json.
- The workflow run for the branch is green (`gh run list --workflow=linux-e2e.yml`).
