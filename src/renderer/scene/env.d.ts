import type { SceneApi } from '../../shared/sceneIpc';

declare global {
  interface Window {
    sceneApi: SceneApi;
  }
}

export {};
