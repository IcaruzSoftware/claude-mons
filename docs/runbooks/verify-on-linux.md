---
doc_type: runbook
purpose: "Verify that claude-mons works correctly on Linux (X11/Wayland, graphics, tray, autostart, updates, hook binary)."
audience: both
last_verified: 2026-09-09
last_verified_commit: 256f0c3
related_files:
  - docs/history/v1-handoff-2026-09-04.md
  - apps/desktop/src/main/index.ts
  - apps/desktop/src/main/windows/PetWindow.ts
  - apps/desktop/src/main/autostart/Autostart.ts
  - apps/desktop/src/main/tray/Tray.ts
  - apps/desktop/src/main/updater/Updater.ts
  - apps/desktop/electron-builder.yml
  - packages/hook-cli/README.md
  - docs/decisions/0017-force-x11-backend-on-linux.md
---

# Verify Linux builds

First Linux verification of the desktop app: obtain the AppImage or deb from a release workflow, run the app under X11 and XWayland, and confirm graphics, interactivity, tray, autostart, updates, and hook binary behavior match the Windows desktop build.

## Preamble: X11 backend by design

claude-mons forces the X11 backend via XWayland on all Linux distributions, even those running
native Wayland sessions (see [ADR 0017](../decisions/0017-force-x11-backend-on-linux.md)). This
is necessary because native Wayland cannot provide window positioning, cursor polling, or
always-on-top semantics — all required for the pet overlay to function. XWayland is present on
all mainstream distributions (GNOME, KDE, Sway with xwayland enabled).

**Confirm the app runs under XWayland:** check for an X11 window with `xprop` on the window or
`xlsclients` in the terminal; debug logs (`CLAUDE_MONS_DEBUG=1 claude-mons`) show "X11 backend forced"
at startup. To experiment with native Wayland (currently unsupported), set `CLAUDE_MONS_NATIVE_WAYLAND=1`
and expect the failures listed in steps 1–8 below (issues #1–#8): window spawns centred, sprite
lands below ground, sprite drifts past horizontal bounds, pet disappears from top z-order, and
hover/right-click/shake stop working altogether.

## Prerequisites

- Linux machine (VM is fine; 1920×1080+ recommended for multi-monitor tests)
- Either X11 or Wayland session with XWayland (check `echo $DISPLAY` for X11, `echo $WAYLAND_DISPLAY` for Wayland)
- AppImage or deb from a GitHub release workflow artifact (locate via `.github/workflows/release.yml`)

## Steps

1. **Obtain and verify the binary**

   ```bash
   # Download AppImage or .deb from GitHub Actions (release workflow)
   # For AppImage: check file size matches workflow artifact (~180 MB typical)
   ls -lh claude-mons-*.AppImage
   # For deb: 
   ls -lh claude-mons-*.deb
   ```

   Verify sha256 matches the workflow log (check build output for `AppImage artifact` or `deb artifact`).

2. **Install or extract (AppImage)**

   ```bash
   chmod +x claude-mons-*.AppImage
   ./claude-mons-*.AppImage --appimage-extract
   # Runs in extracted mode; also works unsigned without install
   ```

   Or **install (deb)**:

   ```bash
   sudo apt install ./claude-mons-*.deb
   # Launches from /opt/claude-mons/claude-mons after install
   ```

3. **Verify X11 session (if applicable)**

   ```bash
   echo $DISPLAY
   # Should print :0 or :1
   ```

   Launch the app:

   ```bash
   # AppImage extracted:
   ./squashfs-root/usr/bin/claude-mons
   # Deb installed:
   claude-mons
   ```

   Verify:
   - Pet window renders with transparent background (not opaque black; if black, compositor issue; see note below)
   - Pet sprite visible and animated (walking, idle)
   - **Pet window spawns on the bottom edge of the screen** (issue #1; if centred, this indicates native Wayland)
   - Panel and hover card open on left-click

4. **Verify Wayland/XWayland session**

   Log out and switch to Wayland (usually via Display Manager; search "Wayland" in session menu). Then:

   ```bash
   echo $WAYLAND_DISPLAY
   # Should print wayland-0 or similar
   ```

   Launch the app as in step 3. Verify the same rendering and interaction. The app forces XWayland
   (X11 backend) so behavior should be identical to step 3. If you see the native Wayland failures
   (below), the `CLAUDE_MONS_NATIVE_WAYLAND=1` override was accidentally set.

5. **Test transparency fallback**

   If step 3 or 4 produced a black opaque window, verify the GPU-disable fallback:

   ```bash
   CLAUDE_MONS_DISABLE_GPU=1 claude-mons
   ```

   (Check `apps/desktop/src/main/index.ts` for the flag.) Window should render; if still black, the compositor lacks transparency support (rare on modern systems).

6. **Verify click-through and interaction**

   - Move the mouse over the pet but not the sprite itself → click the desktop/taskbar behind it (click-through works; issue #7)
   - Move the mouse over the sprite → left-click opens the panel (sprite is clickable; issue #7)
   - Right-click the sprite → context menu appears (issue #7; menu is set in `apps/desktop/src/main/tray/Tray.ts`)
   - **Drag the pet with left-click + drag** → pet follows the cursor within bounds (issue #5 if sprite drifts past edges; issue #4 if window doesn't reposition); release and pet falls to ground (issue #2 if sprite lands below ground line)
   - **Shake the pet side-to-side** → after ~1 s of shaking, the pet enters battle (issue #7 if shake doesn't register; the tray "Battle now" menu item is an alternative if shaking fails)

7. **Test multi-monitor drag**

   (If only one display, skip.) Connect a second display or use virtual desktops. Drag the pet to the edge and onto the other monitor. Verify the window re-anchors and stays on-screen (anchor memory from `apps/desktop/src/main/display.ts`; issue #5 if sprite drifts past monitor edge).

8. **Verify tray icon and fallback**

   Top-right corner (GNOME/KDE) or bottom-right (other DMs):
   - Tray icon shows the pet sprite (size 22px on Linux vs 16px on Windows; see `apps/desktop/src/main/tray/Tray.ts`)
   - Left-click opens the panel
   - Right-click shows the context menu: Connect Claude, Hide pet, Sprite size, **Battle now**, Quit
   - **"Battle now"** is a fallback to trigger a battle without shaking (issue #8; useful if shake input fails)
   - If tray icon does not appear: no StatusNotifier host detected; right-click the pet sprite directly for the same menu

   Record in `docs/ROADMAP.md` under "Linux Desktop Environment" which DMs show a working tray.

9. **Verify autostart**

   Enable autostart in the panel Settings tab. Confirm:

   ```bash
   cat ~/.config/autostart/claude-mons.desktop
   # Should show [Desktop Entry], Exec path, Icon=claude-mons, X-GNOME-Autostart-enabled=true
   ```

   (Or `$XDG_CONFIG_HOME/autostart/` if set; see `apps/desktop/src/main/autostart/Autostart.ts`.)

   Reboot and verify the app auto-launches.

10. **Verify auto-update**

    **AppImage only:** Open the panel Settings. If an update is available:
    - Status shows "Update available v*.*.* — restart to install"
    - Quit the app; restart it
    - App loads the new version (file mtime changed; see `apps/desktop/src/main/updater/Updater.ts`)

    **Deb only:** No in-app auto-update (see `apps/desktop/src/main/updater/Updater.ts`). Users update via `apt upgrade`. Record in `docs/ROADMAP.md`.

11. **Verify hook binary permissions**

    Launch the app and open Claude Code in a Claude Code session. Grant the hook permission when prompted. Then:

    ```bash
    ls -l ~/.config/claude-mons/bin/claude-mons-hook
    # Should be -rwxr-xr-x (0755) and a valid Go binary (file says "ELF")
    ```

    (See `packages/hook-cli/README.md` for binary location and `apps/desktop/src/main/hooks/binary.ts` for install logic.) Grant XP in Claude Code; verify the pet gains XP in the app (hook endpoint reachable).

12. **Check AppArmor and user namespaces (Ubuntu 24.04+)**

    ```bash
    # AppArmor status
    sudo aa-status | grep -i electron
    # If confined: disable profile or add exemptions (rare; most distros ship unconfined)
    
    # User namespace nesting (Ubuntu 24.04 restricts by default)
    sysctl kernel.unprivileged_userns_clone
    # If = 0, Electron renderer may fail in strict sandbox; set to 1 or run with UNSAFE_DISABLE_SANDBOX
    ```

    Record findings in `docs/ROADMAP.md` under "Linux compatibility matrix".

## Acceptance

- [ ] Pet window renders and is transparent (or GPU fallback verified)
- [ ] Click-through, drag, and right-click menu work on X11
- [ ] Click-through, drag, and right-click menu work on Wayland/XWayland
- [ ] Tray icon appears (or fallback menu works) — recorded in `docs/ROADMAP.md`
- [ ] Autostart .desktop file created and app re-launches after reboot
- [ ] AppImage auto-update works; deb status recorded in `docs/ROADMAP.md`
- [ ] Hook binary installed with correct permissions and Claude Code grant succeeds
- [ ] AppArmor/user namespace notes added to `docs/ROADMAP.md`
- [ ] Any failures or unverified items added as `> Unverified:` blockquotes in `docs/ROADMAP.md`

Record the Linux distro, kernel version, display server (X11/Wayland), and session date in the entry.
