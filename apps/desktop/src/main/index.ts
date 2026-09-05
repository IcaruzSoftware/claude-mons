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
}
if (process.env.CLAUDE_MONS_DISABLE_GPU === '1') {
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
