import { join } from 'node:path';
import { BrowserWindow, app, ipcMain } from 'electron';
import { IPC, type PetConfig } from '../common/ipc.ts';

// Phase 0: a plain window proving the toolchain works end to end.
// Phase 1 replaces this with the transparent always-on-top pet window.

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    title: 'claude-mons',
    webPreferences: {
      preload: join(__dirname, '../preload/pet.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pet/index.html`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/pet/index.html'));
  }
  return win;
}

ipcMain.on(IPC.petReady, (event) => {
  const config: PetConfig = { spriteScale: 3, version: app.getVersion() };
  event.sender.send(IPC.petConfig, config);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
