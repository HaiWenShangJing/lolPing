import { contextBridge, ipcRenderer } from 'electron';
import type {
  LoungeGroupMsg, LoungeMsg, LoungeSend, PetApi, PetDragMsg, PetHitMsg, PetInit, PetLookMsg, PetPoseMsg, PetTalkMsg,
} from '../shared/petIpc';

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
  onLook: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: PetLookMsg): void => cb(msg);
    ipcRenderer.on('pet:look', listener);
    return () => ipcRenderer.removeListener('pet:look', listener);
  },
  onTalk: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: PetTalkMsg): void => cb(msg);
    ipcRenderer.on('pet:talk', listener);
    return () => ipcRenderer.removeListener('pet:talk', listener);
  },
  drag: (msg: PetDragMsg) => ipcRenderer.send('pet:drag', msg),
  hit: (msg: PetHitMsg) => ipcRenderer.send('pet:hit', msg),
  chat: (text: string) => ipcRenderer.send('pet:chat', text),
  closeChat: () => ipcRenderer.send('pet:chatClose'),
  onLounge: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: LoungeMsg): void => cb(msg);
    ipcRenderer.on('pet:lounge', listener);
    return () => ipcRenderer.removeListener('pet:lounge', listener);
  },
  loungeSend: (msg: LoungeSend) => ipcRenderer.send('pet:loungeSend', msg),
  loungeGroup: (msg: LoungeGroupMsg) => ipcRenderer.send('pet:loungeGroup', msg),
};

contextBridge.exposeInMainWorld('petApi', api);
