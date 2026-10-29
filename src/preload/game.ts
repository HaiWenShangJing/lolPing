import { contextBridge, ipcRenderer } from 'electron';
import type { GameApi } from '../shared/gameIpc';

// Channel names are inlined: a sandboxed preload can't require a shared chunk.
const api: GameApi = {
  onMsg: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: unknown): void => cb(msg);
    ipcRenderer.on('game:msg', listener);
    return () => ipcRenderer.removeListener('game:msg', listener);
  },
  send: (msg) => ipcRenderer.send('game:send', msg),
};

contextBridge.exposeInMainWorld('gameApi', api);
