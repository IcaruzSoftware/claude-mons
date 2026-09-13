import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { App } from './App.ts';

/** Crash log cap (bytes): once exceeded, the oldest half is dropped rather than growing forever. */
const CRASH_LOG_MAX_BYTES = 1024 * 1024;

function crashLogPath(): string {
  return join(app.getPath('userData'), 'crash.log');
}

/**
 * Best-effort append to `<userData>/crash.log`, capped at ~1 MB (oldest half dropped once the cap
 * is passed, keeping the most recent history). Never throws — a logging failure must not cascade
 * into another uncaught exception.
 */
function appendCrashLog(line: string): void {
  try {
    const path = crashLogPath();
    appendFileSync(path, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
    if (statSync(path).size <= CRASH_LOG_MAX_BYTES) return;
    const buf = readFileSync(path);
    const tail = buf.subarray(buf.length - Math.floor(CRASH_LOG_MAX_BYTES / 2));
    const firstNewline = tail.indexOf(0x0a);
    writeFileSync(path, firstNewline >= 0 ? tail.subarray(firstNewline + 1) : tail);
  } catch {
    // best-effort only
  }
}

/**
 * Electron's default handling of an uncaught exception/unhandled rejection is a blocking modal
 * error dialog ("Uncaught Exception: ...") that the user cannot get past without closing the app —
 * for a background desktop-pet overlay that is far worse than the bug that triggered it (see bug A
 * in docs/architecture/overlay-and-input.md: a bad coordinate reaching `BrowserWindow.setBounds`/
 * `setPosition` used to crash the whole process this way). Log and keep running instead.
 */
process.on('uncaughtException', (err) => {
  console.error('[crash] uncaughtException:', err);
  appendCrashLog(`uncaughtException: ${err?.stack ?? String(err)}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('[crash] unhandledRejection:', reason);
  const detail =
    reason instanceof Error ? (reason.stack ?? reason.message) : JSON.stringify(reason);
  appendCrashLog(`unhandledRejection: ${detail}`);
});

// Single instance: a second launch just exits (later: focuses the panel).
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

if (process.platform === 'linux') {
  // Transparent windows need this before `ready` on Linux (X11/XWayland).
  app.commandLine.appendSwitch('enable-transparent-visuals');
  // Force the X11 backend (XWayland on Wayland sessions). Native Wayland (xdg-shell) gives a
  // client no window positioning, no global cursor position and no always-on-top, which breaks
  // every part of the overlay: spawn position, ground line, hover/click-through, z-order. This
  // overrides the ELECTRON_OZONE_PLATFORM_HINT=auto that some distributions set system-wide.
  // Set CLAUDE_MONS_NATIVE_WAYLAND=1 to experiment with native Wayland anyway.
  if (process.env.CLAUDE_MONS_NATIVE_WAYLAND !== '1') {
    app.commandLine.appendSwitch('ozone-platform', 'x11');
  }
}
// Linux: transparent frameless windows are most reliable with software compositing, and the GPU
// process was seen segfaulting (exit 139) on AMD radeonsi under XWayland (issue #9). Off by default
// there; CLAUDE_MONS_ENABLE_GPU=1 opts back in. Other platforms keep the GPU unless asked otherwise.
const gpuOff =
  process.env.CLAUDE_MONS_DISABLE_GPU === '1' ||
  (process.platform === 'linux' && process.env.CLAUDE_MONS_ENABLE_GPU !== '1');
if (gpuOff) {
  app.disableHardwareAcceleration();
}

async function boot(): Promise<void> {
  await app.whenReady();
  // Known Electron/Linux race: creating a transparent window immediately after `ready` can yield
  // an opaque black square. A short delay avoids it.
  if (process.platform === 'linux') await new Promise((r) => setTimeout(r, 300));
  const application = new App();
  await application.start();
}

boot().catch((err) => {
  console.error('fatal during boot:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});
