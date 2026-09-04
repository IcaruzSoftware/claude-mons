import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PetConfig } from '../common/ipc.ts';

const api = {
  ready(): void {
    ipcRenderer.send(IPC.petReady);
  },
  onConfig(cb: (config: PetConfig) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, config: PetConfig) => cb(config);
    ipcRenderer.on(IPC.petConfig, listener);
    return () => ipcRenderer.off(IPC.petConfig, listener);
  },
};

export type PetApi = typeof api;

contextBridge.exposeInMainWorld('mons', api);
