import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_SCHEME } from '../appProtocol';
import { loadPage, preloadPath } from '../paths';
import { SCENE_CH, type SceneInit, type SceneMode, type SceneText, type ScenePet } from '../../shared/sceneIpc';
import { mahjongSceneText, pickCast } from '../../shared/teammate/scene';
import { PET_COLORS, PET_FACES, PET_IDS, parsePetManifest } from '../../shared/teammate/pet';
import type { PetId } from '../../shared/teammate/pet';
import type { GameServices } from './gameServices';

/** How many pets sit at the mahjong table. */
export const TABLE_SEATS = 4;

/** Every pet whose pack is installed in `dir`: one whose manifest is missing or unreadable is left out. */
export async function readRoster(dir: string, names: Record<PetId, string>): Promise<ScenePet[]> {
  const pets: ScenePet[] = [];
  for (const id of PET_IDS) {
    try {
      const manifest = parsePetManifest(JSON.parse(await readFile(join(dir, id, 'manifest.json'), 'utf8')));
      if (!manifest) continue;
      pets.push({ id, name: names[id], color: PET_COLORS[id], base: `${APP_SCHEME}://pets/${id}`, manifest, face: PET_FACES[id] });
    } catch {
      // not installed
    }
  }
  return pets;
}

/** Normal windows that each show one scene (pets acting something out together): one window per scene. */
export class SceneWindow {
  private readonly wins = new Map<SceneMode, BrowserWindow>();

  constructor(private readonly services: GameServices) {
    ipcMain.handle(SCENE_CH.init, this.onInit);
  }

  isOpen(mode: SceneMode): boolean {
    const win = this.wins.get(mode);
    return win !== undefined && !win.isDestroyed();
  }

  /** Opens the window of `mode`, or brings the open one to the front. */
  open(mode: SceneMode): void {
    const existing = this.wins.get(mode);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 1120, height: 700, minWidth: 720, minHeight: 480, title: this.textFor(mode).title, show: false,
      autoHideMenuBar: true, backgroundColor: '#1d1612',
      webPreferences: { preload: preloadPath('scene'), spellcheck: false },
    });
    win.removeMenu();
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('page-title-updated', (event) => event.preventDefault());
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
    });
    win.on('closed', () => {
      if (this.wins.get(mode) === win) this.wins.delete(mode);
    });
    this.wins.set(mode, win);
    void loadPage(win, 'scene', mode).catch(() => {
      if (!win.isDestroyed()) win.destroy();
    });
  }

  destroy(): void {
    ipcMain.removeHandler(SCENE_CH.init);
    const wins = [...this.wins.values()];
    this.wins.clear();
    for (const win of wins) if (!win.isDestroyed()) win.destroy();
  }

  private textFor(mode: SceneMode): SceneText {
    switch (mode) {
      case 'mahjong': return mahjongSceneText(this.services.words().g);
    }
  }

  private readonly onInit = async (event: IpcMainInvokeEvent): Promise<SceneInit | null> => {
    const mode = [...this.wins].find(([, win]) => !win.isDestroyed() && win.webContents.id === event.sender.id)?.[0];
    if (mode === undefined) return null;
    const pets = await readRoster(this.services.petsDir, this.services.words().names);
    const picks = pickCast(this.services.petsOn(), pets.map((p) => p.id), TABLE_SEATS, this.services.random);
    return { mode, text: this.textFor(mode), pets, picks };
  };
}
