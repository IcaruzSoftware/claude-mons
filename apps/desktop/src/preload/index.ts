/**
 * The single preload script for all windows. Sandboxed preloads cannot load split chunks, so the
 * pet API and the UI API live in one file; each window only uses the part it needs.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { World } from '@claude-mons/shared';
import {
  IPC,
  type BattlePlayMessage,
  type Hitbox,
  type LeaderboardPayload,
  type PetConfig,
  type PointerMessage,
  type StateMessage,
  type StimulusMessage,
  type UiSnapshot,
  type WindowGeometry,
} from '../common/ipc.ts';

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const petApi = {
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
  onBattlePlay: (cb: (b: BattlePlayMessage) => void) =>
    on<BattlePlayMessage>(IPC.petBattlePlay, cb),
  battleDone(id: string): void {
    ipcRenderer.send(IPC.petBattleDone, id);
  },
};

const uiApi = {
  getSnapshot: (): Promise<UiSnapshot> => ipcRenderer.invoke(IPC.uiGetSnapshot),
  onSnapshot: (cb: (s: UiSnapshot) => void) => on<UiSnapshot>(IPC.uiSnapshot, cb),
  chooseNation: (nation: string): Promise<UiSnapshot> =>
    ipcRenderer.invoke(IPC.uiChooseNation, nation),
  toggleHooks: (): Promise<UiSnapshot> => ipcRenderer.invoke(IPC.uiToggleHooks),
  setSpriteScale: (scale: number): Promise<UiSnapshot> =>
    ipcRenderer.invoke(IPC.uiSetSpriteScale, scale),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.uiOpenExternal, url),
  quit: (): Promise<void> => ipcRenderer.invoke(IPC.uiQuit),
  devGrantXp: (amount: number): Promise<UiSnapshot> => ipcRenderer.invoke(IPC.uiDevGrantXp, amount),
  setAutostart: (enabled: boolean): Promise<UiSnapshot> =>
    ipcRenderer.invoke(IPC.uiSetAutostart, enabled),
  checkUpdates: (): Promise<UiSnapshot> => ipcRenderer.invoke(IPC.uiCheckUpdates),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.uiInstallUpdate),
  getLeaderboard: (): Promise<LeaderboardPayload> => ipcRenderer.invoke(IPC.uiGetLeaderboard),
  setNickname: (nickname: string): Promise<{ ok: boolean; error: string | null }> =>
    ipcRenderer.invoke(IPC.uiSetNickname, nickname),
  syncNow: (): Promise<UiSnapshot> => ipcRenderer.invoke(IPC.uiSyncNow),
};

export type PetApi = typeof petApi;
export type UiApi = typeof uiApi;

contextBridge.exposeInMainWorld('mons', petApi);
contextBridge.exposeInMainWorld('monsUi', uiApi);
