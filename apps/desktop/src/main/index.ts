import { app } from 'electron';
import { App } from './App.ts';

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
