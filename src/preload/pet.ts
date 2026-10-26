import { contextBridge, ipcRenderer } from 'electron';
import type { PetApi, PetDragMsg, PetInit, PetPoseMsg } from '../shared/petIpc';

// Channel names are inlined: a sandboxed preload can't require a shared chunk.
const api: PetApi = {
  onInit: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, init: PetInit): void => cb(init);
    ipcRenderer.on('pet:init', listener);
    return () => ipcRenderer.removeListener('pet:init', listener);
  },
  onPose: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: PetPoseMsg): void => cb(msg);
    ipcRenderer.on('pet:pose', listener);
    return () => ipcRenderer.removeListener('pet:pose', listener);
  },
  drag: (msg: PetDragMsg) => ipcRenderer.send('pet:drag', msg),
};

contextBridge.exposeInMainWorld('petApi', api);
