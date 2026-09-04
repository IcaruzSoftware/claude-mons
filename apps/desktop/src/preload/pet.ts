import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type Hitbox,
  type PetConfig,
  type PointerMessage,
  type StateMessage,
  type StimulusMessage,
  type WindowGeometry,
} from '../common/ipc.ts';
import type { World } from '@claude-mons/shared';

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const api = {
  ready(): void {
    ipcRenderer.send(IPC.petReady);
  },
  onConfig: (cb: (config: PetConfig) => void) => on<PetConfig>(IPC.petConfig, cb),
  onWindowMoved: (cb: (g: WindowGeometry) => void) => on<WindowGeometry>(IPC.petWindowMoved, cb),
  onStimulus: (cb: (s: StimulusMessage) => void) => on<StimulusMessage>(IPC.petStimulus, cb),
  onWorld: (cb: (w: World) => void) => on<World>(IPC.petWorld, cb),
  sendHitbox(hitbox: Hitbox): void {
    ipcRenderer.send(IPC.petHitbox, hitbox);
  },
  sendPointer(msg: PointerMessage): void {
    ipcRenderer.send(IPC.petPointer, msg);
  },
  sendState(msg: StateMessage): void {
    ipcRenderer.send(IPC.petState, msg);
  },
  requestBattle(): void {
    ipcRenderer.send(IPC.petRequestBattle);
  },
  landed(): void {
    ipcRenderer.send(IPC.petLanded);
  },
};

export type PetApi = typeof api;

contextBridge.exposeInMainWorld('mons', api);
