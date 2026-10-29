// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PetLounge, type LoungeSource } from '../../../src/main/teammate/petLounge';
import type { RoomEvent } from '../../../src/main/teammate/petSociety';
import { PET_CH, type LoungeInit, type LoungeMsg, type LoungeText } from '../../../src/shared/petIpc';
import { PET_IDS, type PetId } from '../../../src/shared/teammate/pet';
import type { PetGroup } from '../../../src/shared/teammate/petGroups';
import type { RoomLine } from '../../../src/shared/teammate/petSociety';

interface FakeWin {
  loaded: string[];
  visible: boolean;
  focused: number;
  destroyed: boolean;
  destroy: () => void;
  opts: Record<string, unknown>;
  webContents: { id: number; send: ReturnType<typeof vi.fn>; emit: (event: string) => boolean };
  emit: (event: string) => boolean;
}

const h = vi.hoisted(() => ({
  windows: [] as unknown[],
  handlers: new Map<string, (event: unknown, raw: unknown) => void>(),
}));
const wins = (): FakeWin[] => h.windows as FakeWin[];

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class FakeWindow extends Emitter {
    loaded: string[] = [];
    visible = false;
    focused = 0;
    destroyed = false;
    minimized = false;
    webContents = Object.assign(new Emitter(), {
      id: 7, send: vi.fn(), setWindowOpenHandler: vi.fn(), isDestroyed: () => false,
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
      on: (channel: string, fn: (event: unknown, raw: unknown) => void) => h.handlers.set(channel, fn),
      removeListener: (channel: string) => h.handlers.delete(channel),
    },
  };
});
vi.mock('../../../src/main/paths', () => ({ preloadPath: () => 'preload.js' }));

const NAMES: Record<PetId, string> = {
  whale: 'Whale', naiwa: 'Naiwa', shenshen: 'Shenshen', airi: 'Airi', hiyori: 'Hiyori', haru: 'Haru', mao: 'Mao', rice: 'Rice',
  senko: 'Senko', mark: 'Mark', laffey: 'Laffey', unicorn: 'Unicorn', javelin: 'Javelin', shoukaku: 'Shoukaku',
  doubao: 'Doubao',
};
const TEXT: LoungeText = {
  title: 'Lounge', hint: 'Say something', everyone: 'Everyone', send: 'Send', empty: 'Nobody is out', you: 'You', noted: 'noted',
  main: 'Main', newGroup: 'New group', editGroup: 'Edit group', groupName: 'Group name', members: 'Members',
  membersHint: 'Pick at least two', save: 'Save', cancel: 'Cancel', delete: 'Delete', sure: 'Sure?', groupEmpty: 'No member is out',
};
const CLUB: PetGroup = { id: 'g1abc', name: 'Code club', members: ['naiwa', 'airi'] };

const line = (seq: number, over: Partial<RoomLine> = {}): RoomLine => ({
  seq, room: 'main', from: 'naiwa', to: null, text: `line ${seq}`, at: 0, kind: 'say', ...over,
});

function source(over: Partial<{ lines: RoomLine[]; groups: PetGroup[]; rosters: Record<string, PetId[]> }> = {}) {
  const listeners = new Set<(e: RoomEvent) => void>();
  const s = {
    lines: over.lines ?? [],
    groups: over.groups ?? [],
    rosters: over.rosters ?? ({ main: ['naiwa', 'airi'] } as Record<string, PetId[]>),
    sent: [] as unknown[],
    saved: [] as unknown[],
    deleted: [] as string[],
    listening: () => listeners.size,
    emit: (e: RoomEvent) => listeners.forEach((fn) => fn(e)),
  };
  const src: LoungeSource = {
    transcript: () => s.lines,
    groups: () => s.groups,
    rosters: () => s.rosters,
    onEvent: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    send: (room, to, text) => {
      s.sent.push({ room, to, text });
      return true;
    },
    saveGroup: (input) => {
      s.saved.push(input);
      return null;
    },
    deleteGroup: (id) => {
      s.deleted.push(id);
      return true;
    },
    words: () => ({ text: TEXT, names: NAMES }),
  };
  return { s, src };
}

const ours = { sender: { id: 7 } };

beforeEach(() => {
  h.windows.length = 0;
  h.handlers.clear();
});

describe('PetLounge window', () => {
  it('opens one window with the lounge\'s title, and brings it to the front when opened again', () => {
    const lounge = new PetLounge(source().src);
    lounge.open();
    lounge.open();
    expect(wins()).toHaveLength(1);
    expect(wins()[0].opts.title).toBe('Lounge');
    wins()[0].emit('ready-to-show');
    expect(wins()[0].visible).toBe(true);
    lounge.open();
    expect(wins()[0].focused).toBeGreaterThanOrEqual(2);
    lounge.destroy();
  });

  it('gives the page the groups, who can be spoken to in each room, and what was said, once it has loaded', () => {
    const { s, src } = source({
      lines: [line(1), line(2, { room: 'g1abc' })], groups: [CLUB], rosters: { main: ['naiwa'], g1abc: ['naiwa', 'airi'] },
    });
    const lounge = new PetLounge(src);
    lounge.open();
    wins()[0].webContents.emit('did-finish-load');
    const [channel, msg] = wins()[0].webContents.send.mock.calls[0] as [string, LoungeMsg];
    expect(channel).toBe(PET_CH.lounge);
    expect(msg.kind).toBe('init');
    const init = (msg as { kind: 'init'; init: LoungeInit }).init;
    expect(init.groups).toEqual([CLUB]);
    expect(init.rosters).toEqual(s.rosters);
    expect(init.lines.map((l) => l.room)).toEqual(['main', 'g1abc']);
    expect(init.text).toBe(TEXT);
    lounge.destroy();
  });

  it('passes on what is said as a line, and a change of the groups or of who is out as a state', () => {
    const { s, src } = source();
    const lounge = new PetLounge(src);
    lounge.open();
    const send = wins()[0].webContents.send;
    s.emit({ kind: 'line', line: line(1) });
    s.groups = [CLUB];
    s.rosters = { main: ['naiwa'], g1abc: ['airi'] };
    s.emit({ kind: 'roster' });
    expect(send.mock.calls.map(([, m]) => m)).toEqual([
      { kind: 'line', line: line(1) },
      { kind: 'state', groups: [CLUB], rosters: { main: ['naiwa'], g1abc: ['airi'] } },
    ]);
    lounge.destroy();
  });

  it('stops listening once its window is gone', () => {
    const { s, src } = source();
    const lounge = new PetLounge(src);
    lounge.open();
    expect(s.listening()).toBe(1);
    wins()[0].destroy();
    expect(s.listening()).toBe(0);
    lounge.destroy();
  });

  it('speaks for the user in the room the page names, and ignores junk or any other window', () => {
    const { s, src } = source();
    const lounge = new PetLounge(src);
    lounge.open();
    const onSend = h.handlers.get(PET_CH.loungeSend);
    onSend?.(ours, { room: 'g1abc', to: 'airi', text: ' hello there ' });
    onSend?.(ours, { room: 'main', to: 'all', text: 'hi all' });
    onSend?.(ours, { room: 'nowhere', to: 'all', text: 'lost' });
    onSend?.(ours, { room: 'main', to: 'dragon', text: 'lost' });
    onSend?.({ sender: { id: 99 } }, { room: 'main', to: 'all', text: 'from elsewhere' });
    expect(s.sent).toEqual([
      { room: 'g1abc', to: 'airi', text: 'hello there' },
      { room: 'main', to: 'all', text: 'hi all' },
    ]);
    lounge.destroy();
  });

  it('saves and deletes groups as the page asks, and ignores junk or any other window', () => {
    const { s, src } = source();
    const lounge = new PetLounge(src);
    lounge.open();
    const onGroup = h.handlers.get(PET_CH.loungeGroup);
    onGroup?.(ours, { op: 'save', id: null, name: 'Duo', members: ['airi', 'naiwa', 'dragon'] });
    onGroup?.(ours, { op: 'save', id: 'g1abc', name: 'Renamed', members: ['airi', 'hiyori'] });
    onGroup?.(ours, { op: 'delete', id: 'g1abc' });
    onGroup?.(ours, { op: 'delete', id: 'main' });
    onGroup?.(ours, { op: 'burn' });
    onGroup?.({ sender: { id: 99 } }, { op: 'delete', id: 'g2xyz' });
    expect(s.saved).toEqual([
      { id: null, name: 'Duo', members: ['naiwa', 'airi'] },
      { id: 'g1abc', name: 'Renamed', members: ['airi', 'hiyori'] },
    ]);
    expect(s.deleted).toEqual(['g1abc']);
    lounge.destroy();
  });

  it('takes no more messages once destroyed', () => {
    const lounge = new PetLounge(source().src);
    lounge.destroy();
    expect(h.handlers.size).toBe(0);
  });
});

/** Opens the lounge, runs the page it loads in a fresh document, and lets a test send it what main would. */
function openPage(): {
  doc: Document;
  api: { loungeSend: ReturnType<typeof vi.fn>; loungeGroup: ReturnType<typeof vi.fn> };
  push: (msg: LoungeMsg) => void;
  init: (over?: Partial<LoungeInit>) => void;
  tabs: () => string[];
  current: () => string;
  click: (selector: string) => void;
  tab: (label: string) => void;
} {
  new PetLounge(source().src).open();
  const url = wins().at(-1)?.loaded[0] ?? '';
  const html = decodeURIComponent(url.slice(url.indexOf(',') + 1));
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
  const doc = document.implementation.createHTMLDocument('lounge');
  doc.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '');
  let listener: (msg: LoungeMsg) => void = () => undefined;
  const api = {
    onLounge: (cb: (msg: LoungeMsg) => void) => {
      listener = cb;
      return () => undefined;
    },
    loungeSend: vi.fn(),
    loungeGroup: vi.fn(),
  };
  new Function('petApi', 'document', script)(api, doc);
  const push = (msg: LoungeMsg): void => listener(msg);
  const buttons = (): HTMLButtonElement[] => [...doc.querySelectorAll<HTMLButtonElement>('#tabs button')];
  return {
    doc, api, push,
    init: (over = {}) => push({
      kind: 'init',
      init: { text: TEXT, names: NAMES, groups: [], rosters: { main: ['naiwa', 'airi'] }, lines: [], ...over },
    }),
    tabs: () => buttons().map((b) => b.textContent ?? ''),
    current: () => doc.querySelector('#tabs .cur')?.textContent ?? '',
    click: (selector) => doc.querySelector<HTMLElement>(selector)?.click(),
    tab: (label) => buttons().find((b) => b.textContent?.startsWith(label))?.click(),
  };
}

const withClub = { groups: [CLUB], rosters: { main: ['naiwa', 'airi'], g1abc: ['naiwa', 'airi'] } as Record<string, PetId[]> };

describe('the lounge page: the room', () => {
  it('starts on the big room, with a tab for it, a button for a new group, and a box to speak to everyone or one pet', () => {
    const p = openPage();
    p.init();
    expect(p.tabs()).toEqual(['Main', '+']);
    expect(p.current()).toBe('Main');
    expect(p.doc.getElementById('who')?.hidden).toBe(true);
    expect(p.doc.getElementById('form')?.hidden).toBe(false);
    expect([...p.doc.querySelectorAll('#to option')].map((o) => o.textContent)).toEqual(['Everyone', 'Naiwa', 'Airi']);
  });

  it('shows what was said, who to, and the pets\' notes', () => {
    const p = openPage();
    p.init({ lines: [line(1, { from: 'user', to: 'all', text: 'good morning' }), line(2, { to: 'airi', text: 'hi Airi' }), line(3, { kind: 'note', text: 'likes tea' })] });
    const rows = [...p.doc.querySelectorAll('#log .row')];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('You');
    expect(rows[0].textContent).toContain('Everyone');
    expect(rows[0].textContent).toContain('good morning');
    expect(rows[1].textContent).toContain('Naiwa');
    expect(rows[1].textContent).toContain('Airi');
    expect(rows[2].className).toContain('note');
    expect(rows[2].textContent).toContain('noted likes tea');
  });

  it('puts a line that arrives at the bottom, and never reads it as markup', () => {
    const p = openPage();
    p.init();
    p.push({ kind: 'line', line: line(1, { text: '<img src=x onerror=alert(1)>' }) });
    expect(p.doc.querySelectorAll('#log img')).toHaveLength(0);
    expect(p.doc.querySelector('#log .row')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('sends what is typed to the open room and the chosen pet, and clears the box', () => {
    const p = openPage();
    p.init();
    const box = p.doc.getElementById('box') as HTMLInputElement;
    const to = p.doc.getElementById('to') as HTMLSelectElement;
    to.value = 'airi';
    box.value = '  how are you?  ';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(p.api.loungeSend).toHaveBeenCalledWith({ room: 'main', to: 'airi', text: 'how are you?' });
    expect(box.value).toBe('');
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    box.value = 'x';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    expect(p.api.loungeSend).toHaveBeenCalledTimes(1);
  });

  it('shows a note instead of the box while nobody is out to hear, and the box again when somebody is', () => {
    const p = openPage();
    p.init({ rosters: { main: [] } });
    expect(p.doc.getElementById('form')?.hidden).toBe(true);
    expect(p.doc.getElementById('empty')?.hidden).toBe(false);
    expect(p.doc.getElementById('empty')?.textContent).toBe('Nobody is out');
    p.push({ kind: 'state', groups: [], rosters: { main: ['naiwa'] } });
    expect(p.doc.getElementById('form')?.hidden).toBe(false);
    expect([...p.doc.querySelectorAll('#to option')].map((o) => o.textContent)).toEqual(['Everyone', 'Naiwa']);
  });
});

describe('the lounge page: groups', () => {
  it('has a tab for each group, and shows only that group\'s talk, its members, and a button to edit it', () => {
    const p = openPage();
    p.init({ ...withClub, lines: [line(1, { text: 'in main' }), line(2, { room: 'g1abc', text: 'in the club' })] });
    expect(p.tabs()).toEqual(['Main', 'Code club', '+']);
    expect(p.doc.getElementById('log')?.textContent).toContain('in main');
    p.tab('Code club');
    expect(p.tabs()).toEqual(['Main', 'Code club', '\u270e', '+']);
    expect(p.current()).toBe('Code club');
    expect(p.doc.getElementById('log')?.textContent).toContain('in the club');
    expect(p.doc.getElementById('log')?.textContent).not.toContain('in main');
    expect(p.doc.getElementById('who')?.hidden).toBe(false);
    expect(p.doc.getElementById('who')?.textContent).toBe('Members: Naiwa, Airi');
  });

  it('speaks in the group that is open', () => {
    const p = openPage();
    p.init(withClub);
    p.tab('Code club');
    const box = p.doc.getElementById('box') as HTMLInputElement;
    box.value = 'any ideas?';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(p.api.loungeSend).toHaveBeenCalledWith({ room: 'g1abc', to: 'all', text: 'any ideas?' });
  });

  it('shows a group\'s own note while none of its pets is out', () => {
    const p = openPage();
    p.init({ ...withClub, rosters: { main: ['naiwa'], g1abc: [] } });
    p.tab('Code club');
    expect(p.doc.getElementById('form')?.hidden).toBe(true);
    expect(p.doc.getElementById('empty')?.textContent).toBe('No member is out');
  });

  it('marks a room the pets spoke in while it was not open, and clears the mark when it is opened', () => {
    const p = openPage();
    p.init(withClub);
    p.push({ kind: 'line', line: line(1, { room: 'g1abc', from: 'user', text: 'mine' }) });
    expect(p.tabs()[1]).toBe('Code club');
    p.push({ kind: 'line', line: line(2, { room: 'g1abc', text: 'theirs' }) });
    expect(p.tabs()[1]).toBe('Code club \u2022');
    p.tab('Code club');
    expect(p.tabs()[1]).toBe('Code club');
    expect(p.doc.getElementById('log')?.textContent).toContain('mine');
    expect(p.doc.getElementById('log')?.textContent).toContain('theirs');
  });

  it('goes back to the big room when the open group is deleted, and forgets what was said in it', () => {
    const p = openPage();
    p.init({ ...withClub, lines: [line(1, { room: 'g1abc', text: 'old club talk' })] });
    p.tab('Code club');
    p.push({ kind: 'state', groups: [], rosters: { main: ['naiwa', 'airi'] } });
    expect(p.tabs()).toEqual(['Main', '+']);
    expect(p.current()).toBe('Main');
    expect(p.doc.getElementById('who')?.hidden).toBe(true);
    p.push({ kind: 'state', ...withClub });
    p.tab('Code club');
    expect(p.doc.getElementById('log')?.textContent).not.toContain('old club talk');
  });
});

describe('the lounge page: the group editor', () => {
  const members = (p: ReturnType<typeof openPage>): HTMLInputElement[] => [...p.doc.querySelectorAll<HTMLInputElement>('#eMembers input')];
  const check = (p: ReturnType<typeof openPage>, ...ids: PetId[]): void => {
    for (const box of members(p)) if (ids.includes(box.value as PetId) && !box.checked) box.click();
  };
  const name = (p: ReturnType<typeof openPage>, text: string): void => {
    const input = p.doc.getElementById('eName') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };
  const save = (p: ReturnType<typeof openPage>): HTMLButtonElement => p.doc.getElementById('eSave') as HTMLButtonElement;

  it('opens from the + button with a choice of every pet, and saves only with a name and two pets', () => {
    const p = openPage();
    p.init();
    expect(p.doc.getElementById('edit')?.hidden).toBe(true);
    p.click('#tabs .tool');
    expect(p.doc.getElementById('edit')?.hidden).toBe(false);
    expect(p.doc.getElementById('eTitle')?.textContent).toBe('New group');
    expect(members(p).map((b) => b.value)).toEqual([...PET_IDS]);
    expect(p.doc.getElementById('eDel')?.hidden).toBe(true);
    expect(save(p).disabled).toBe(true);
    name(p, 'Duo');
    check(p, 'naiwa');
    expect(save(p).disabled).toBe(true);
    check(p, 'airi');
    expect(save(p).disabled).toBe(false);
    name(p, '   ');
    expect(save(p).disabled).toBe(true);
  });

  it('makes the group the user asked for, closes, and goes to its tab when it shows up', () => {
    const p = openPage();
    p.init();
    p.click('#tabs .tool');
    name(p, ' Duo ');
    check(p, 'airi', 'naiwa');
    save(p).click();
    expect(p.api.loungeGroup).toHaveBeenCalledWith({ op: 'save', id: null, name: 'Duo', members: ['naiwa', 'airi'] });
    expect(p.doc.getElementById('edit')?.hidden).toBe(true);
    p.push({ kind: 'state', groups: [{ id: 'g2new', name: 'Duo', members: ['naiwa', 'airi'] }], rosters: { main: ['naiwa'], g2new: ['naiwa'] } });
    expect(p.current()).toBe('Duo');
  });

  it('saves from the name box with Enter, and closes with Escape or Cancel without saving', () => {
    const p = openPage();
    p.init();
    p.click('#tabs .tool');
    name(p, 'Duo');
    check(p, 'airi', 'naiwa');
    p.doc.getElementById('eName')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(p.api.loungeGroup).toHaveBeenCalledTimes(1);
    p.click('#tabs .tool');
    p.doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(p.doc.getElementById('edit')?.hidden).toBe(true);
    p.click('#tabs .tool');
    p.click('#eCancel');
    expect(p.doc.getElementById('edit')?.hidden).toBe(true);
    expect(p.api.loungeGroup).toHaveBeenCalledTimes(1);
  });

  it('edits the open group, with its name and members filled in, and keeps its id', () => {
    const p = openPage();
    p.init(withClub);
    p.tab('Code club');
    p.click('#tabs .tool');
    expect(p.doc.getElementById('eTitle')?.textContent).toBe('Edit group');
    expect((p.doc.getElementById('eName') as HTMLInputElement).value).toBe('Code club');
    expect(members(p).filter((b) => b.checked).map((b) => b.value)).toEqual(['naiwa', 'airi']);
    expect(save(p).disabled).toBe(false);
    check(p, 'hiyori');
    save(p).click();
    expect(p.api.loungeGroup).toHaveBeenCalledWith({ op: 'save', id: 'g1abc', name: 'Code club', members: ['naiwa', 'airi', 'hiyori'] });
  });

  it('deletes only when asked twice in a row', () => {
    const p = openPage();
    p.init(withClub);
    p.tab('Code club');
    p.click('#tabs .tool');
    const del = p.doc.getElementById('eDel') as HTMLButtonElement;
    expect(del.hidden).toBe(false);
    expect(del.textContent).toBe('Delete');
    del.click();
    expect(del.textContent).toBe('Sure?');
    expect(p.api.loungeGroup).not.toHaveBeenCalled();
    del.click();
    expect(p.api.loungeGroup).toHaveBeenCalledWith({ op: 'delete', id: 'g1abc' });
    expect(p.doc.getElementById('edit')?.hidden).toBe(true);
  });

  it('asks again from the start after the editor was closed in the middle of a delete', () => {
    const p = openPage();
    p.init(withClub);
    p.tab('Code club');
    p.click('#tabs .tool');
    (p.doc.getElementById('eDel') as HTMLButtonElement).click();
    p.click('#eCancel');
    p.click('#tabs .tool');
    expect(p.doc.getElementById('eDel')?.textContent).toBe('Delete');
    (p.doc.getElementById('eDel') as HTMLButtonElement).click();
    expect(p.api.loungeGroup).not.toHaveBeenCalled();
  });
});
