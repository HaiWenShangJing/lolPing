import { contextBridge, ipcRenderer } from 'electron';
import type { SceneApi, SceneInit } from '../shared/sceneIpc';

// Channel names are inlined: a sandboxed preload can't require a shared chunk.
const api: SceneApi = {
  init: () => ipcRenderer.invoke('scene:init') as Promise<SceneInit | null>,
};

contextBridge.exposeInMainWorld('sceneApi', api);
