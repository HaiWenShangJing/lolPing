import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneWindow, TABLE_SEATS, readRoster } from '../../../src/main/teammate/sceneWindow';
import { SCENE_CH, type SceneInit } from '../../../src/shared/sceneIpc';
import { PET_COLORS, PET_FACES, type PetId } from '../../../src/shared/teammate/pet';
import { fakeServices } from './gameFakes';

interface FakeWin {
  loaded: string[];
  visible: boolean;
  focused: number;
  minimized: boolean;
  destroyed: boolean;
  opts: Record<string, unknown>;
  webContents: { id: number };
  emit: (event: string) => boolean;
  loadURL: (url: string) => Promise<void>;
  destroy: () => void;
}

type Handler = (event: { sender: { id: number } }) => unknown;

const h = vi.hoisted(() => ({ windows: [] as unknown[], handlers: new Map<string, unknown>() }));
const wins = (): FakeWin[] => h.windows as FakeWin[];

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  let nextId = 40;
  class FakeWindow extends Emitter {
    loaded: string[] = [];
    visible = false;
    focused = 0;
    minimized = false;
    destroyed = false;
    webContents = Object.assign(new Emitter(), {
      id: nextId++, setWindowOpenHandler: vi.fn(), isDestroyed: () => false,
    });
    constructor(readonly opts: Record<string, unknown>) {
      super();
      h.windows.push(this);
    }
    removeMenu(): void {}
    loadURL(url: string): Promise<void> {
      this.loaded.push(url);
      return Promise.resolve();
    }
    show(): void { this.visible = true; }
    focus(): void { this.focused++; }
    restore(): void { this.minimized = false; }
    isMinimized(): boolean { return this.minimized; }
    isDestroyed(): boolean { return this.destroyed; }
    destroy(): void {
      this.destroyed = true;
      this.emit('closed');
    }
  }
  return {
    BrowserWindow: FakeWindow,
    ipcMain: {
      handle: (channel: string, fn: unknown) => h.handlers.set(channel, fn),
      removeHandler: (channel: string) => h.handlers.delete(channel),
    },
  };
});
vi.mock('../../../src/main/paths', () => ({
  preloadPath: (name: string) => `${name}.js`,
  loadPage: (win: FakeWin, page: string, hash: string) => win.loadURL(`app://${page}/index.html#${hash}`),
}));
vi.mock('../../../src/main/appProtocol', () => ({ APP_SCHEME: 'lolping' }));

const NAMES = Object.fromEntries(
  ['whale', 'naiwa', 'shenshen', 'airi', 'hiyori', 'haru', 'mao', 'rice', 'senko', 'mark', 'laffey', 'unicorn', 'javelin',
    'shoukaku', 'doubao'].map((id) => [id, id.toUpperCase()]),
) as Record<PetId, string>;

const frames = (): unknown => ({
  id: 'x', width: 128, height: 128,
  anims: Object.fromEntries(['idle', 'walk', 'think', 'happy', 'held'].map((p) => [p, { frames: [`${p}1.png`], fps: 8 }])),
});
const live2d = (): unknown => ({ id: 'x', width: 200, height: 320, live2d: { model: 'm/m.model3.json', core: 'core.js' } });

let dir: string;
const install = (id: string, manifest: unknown): void => {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lolping-scene-'));
  h.windows.length = 0;
  h.handlers.clear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('readRoster', () => {
  it('lists the pets whose packs are installed, in the order the app lists pets', async () => {
    install('shoukaku', live2d());
    install('whale', frames());
    install('airi', frames());
    const roster = await readRoster(dir, NAMES);
    expect(roster.map((p) => p.id)).toEqual(['whale', 'airi', 'shoukaku']);
    const shoukaku = roster[2];
    expect(shoukaku).toMatchObject({
      id: 'shoukaku', name: 'SHOUKAKU', color: PET_COLORS.shoukaku, base: 'lolping://pets/shoukaku', face: PET_FACES.shoukaku,
    });
    expect(shoukaku?.manifest.live2d?.model).toBe('m/m.model3.json');
    expect(roster[0]?.manifest.live2d).toBeUndefined();
  });

  it('leaves out a pet whose manifest is missing, broken, or half written', async () => {
    install('whale', frames());
    install('naiwa', '{ not json');
    install('shenshen', { id: 'shenshen', anims: { idle: { frames: ['a.png'] } } });
    install('hiyori', { id: 'hiyori', live2d: { model: '../x.model3.json', core: 'core.js' } });
    mkdirSync(join(dir, 'haru'));
    expect((await readRoster(dir, NAMES)).map((p) => p.id)).toEqual(['whale']);
  });

  it('is empty when there is no folder at all', async () => {
    expect(await readRoster(join(dir, 'nowhere'), NAMES)).toEqual([]);
  });
});

describe('SceneWindow', () => {
  const init = async (win: FakeWin | undefined, id = win?.webContents.id ?? 0): Promise<SceneInit | null> => {
    const handler = h.handlers.get(SCENE_CH.init) as Handler | undefined;
    return (await handler?.({ sender: { id } })) as SceneInit | null;
  };

  it('opens one window for the mahjong scene and loads the scene page', () => {
    const { services } = fakeServices({ petsDir: dir });
    const scenes = new SceneWindow(services);
    expect(scenes.isOpen('mahjong')).toBe(false);
    scenes.open('mahjong');
    expect(wins()).toHaveLength(1);
    expect(wins()[0]?.loaded).toEqual(['app://scene/index.html#mahjong']);
    expect(wins()[0]?.opts.title).toBe(services.words().g.mahjongTitle);
    expect((wins()[0]?.opts.webPreferences as { preload: string }).preload).toBe('scene.js');
    expect(scenes.isOpen('mahjong')).toBe(true);
    wins()[0]?.emit('ready-to-show');
    expect(wins()[0]?.visible).toBe(true);
  });

  it('brings the open window to the front instead of opening another', () => {
    const { services } = fakeServices({ petsDir: dir });
    const scenes = new SceneWindow(services);
    scenes.open('mahjong');
    const win = wins()[0];
    if (win) win.minimized = true;
    scenes.open('mahjong');
    expect(wins()).toHaveLength(1);
    expect(win?.minimized).toBe(false);
    expect(win?.focused).toBe(1);
  });

  it('opens a new one after the window is closed', () => {
    const { services } = fakeServices({ petsDir: dir });
    const scenes = new SceneWindow(services);
    scenes.open('mahjong');
    wins()[0]?.destroy();
    expect(scenes.isOpen('mahjong')).toBe(false);
    scenes.open('mahjong');
    expect(wins()).toHaveLength(2);
    expect(scenes.isOpen('mahjong')).toBe(true);
  });

  it('tells its page who is installed, who sits down, and the words in the user\'s language', async () => {
    for (const id of ['whale', 'naiwa', 'shenshen', 'airi']) install(id, frames());
    for (const id of ['hiyori', 'shoukaku']) install(id, live2d());
    const { services } = fakeServices({ petsDir: dir, petsOn: () => ['shoukaku', 'javelin', 'airi'] });
    const scenes = new SceneWindow(services);
    scenes.open('mahjong');
    const answer = await init(wins()[0]);
    expect(answer?.mode).toBe('mahjong');
    expect(answer?.pets.map((p) => p.id)).toEqual(['whale', 'naiwa', 'shenshen', 'airi', 'hiyori', 'shoukaku']);
    expect(answer?.picks).toHaveLength(TABLE_SEATS);
    expect(answer?.picks.slice(0, 2)).toEqual(['shoukaku', 'airi']);
    expect(new Set(answer?.picks).size).toBe(TABLE_SEATS);
    for (const id of answer?.picks ?? []) expect(answer?.pets.some((p) => p.id === id)).toBe(true);
    expect(answer?.text.title).toBe(services.words().g.mahjongTitle);
    expect(answer?.text.lines.win?.length).toBeGreaterThan(0);
  });

  it('seats fewer pets when fewer are installed, and none when none is', async () => {
    install('whale', frames());
    const { services } = fakeServices({ petsDir: dir });
    const scenes = new SceneWindow(services);
    scenes.open('mahjong');
    const one = await init(wins()[0]);
    expect(one?.picks).toEqual(['whale']);
    rmSync(join(dir, 'whale'), { recursive: true });
    const none = await init(wins()[0]);
    expect(none?.pets).toEqual([]);
    expect(none?.picks).toEqual([]);
  });

  it('answers nobody but the window it opened', async () => {
    const { services } = fakeServices({ petsDir: dir });
    const scenes = new SceneWindow(services);
    expect(await init(undefined, 5)).toBeNull();
    scenes.open('mahjong');
    expect(await init(wins()[0], 999)).toBeNull();
    expect(await init(wins()[0])).not.toBeNull();
  });

  it('closes its windows and stops answering when destroyed', () => {
    const { services } = fakeServices({ petsDir: dir });
    const scenes = new SceneWindow(services);
    scenes.open('mahjong');
    scenes.destroy();
    expect(wins()[0]?.destroyed).toBe(true);
    expect(scenes.isOpen('mahjong')).toBe(false);
    expect(h.handlers.has(SCENE_CH.init)).toBe(false);
  });
});
