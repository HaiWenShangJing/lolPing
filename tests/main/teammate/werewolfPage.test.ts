// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WEREWOLF_PAGE } from '../../../src/main/teammate/werewolfPage';
import {
  parseWolfIn, type GameApi, type WolfAsk, type WolfIn, type WolfOut, type WolfSeat,
} from '../../../src/shared/gameIpc';
import { strings } from '../../../src/shared/i18n';
import { lobbyChoices, wolfText } from '../../../src/shared/teammate/gameText';
import { PET_IDS, type PetId } from '../../../src/shared/teammate/pet';

const g = strings('en', 'win').teammate.games;
const names = strings('en', 'win').teammate.ask.petName;
const T = wolfText(g, 11, 12);
const lobbyOf = (picked: readonly PetId[], minds: boolean): WolfOut => ({
  kind: 'lobby', text: T, choices: lobbyChoices(picked, names), seats: 11, watchSeats: 12, minds,
});

let deliver: (msg: WolfOut) => void = () => undefined;
const sent: unknown[] = [];

beforeAll(() => {
  const api: GameApi = {
    onMsg: (cb) => {
      deliver = (msg) => cb(msg);
      return () => undefined;
    },
    send: (msg) => {
      sent.push(msg);
    },
  };
  // The page's own script is run here, in the test's window, against the markup it came with.
  const script = /<script>([\s\S]*)<\/script>/.exec(WEREWOLF_PAGE)?.[1];
  if (script === undefined) throw new Error('The page has no script.');
  document.documentElement.innerHTML = WEREWOLF_PAGE.replace(/<script>[\s\S]*<\/script>/, '');
  (new Function('gameApi', script) as (api: GameApi) => void)(api);
});

beforeEach(() => {
  sent.length = 0;
  deliver(lobbyOf([], false));
});

const $ = (sel: string): HTMLElement => {
  const e = document.querySelector<HTMLElement>(sel);
  if (!e) throw new Error(`No ${sel}`);
  return e;
};
const all = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const button = (label: string): HTMLElement => {
  const b = all('#ask button').find((x) => x.textContent === label);
  if (!b) throw new Error(`No button ${label}: ${all('#ask button').map((x) => x.textContent).join(' | ')}`);
  return b;
};
const labels = (sel: string): string[] => all(sel).map((e) => e.textContent ?? '');

/** The one message the page sent, as the room would read it. */
const sentOnce = (): WolfIn => {
  expect(sent).toHaveLength(1);
  const m = parseWolfIn(sent[0], 12);
  if (!m) throw new Error(`The page sent a message the room would refuse: ${JSON.stringify(sent[0])}`);
  return m;
};

const seat = (n: number, over: Partial<WolfSeat> = {}): WolfSeat => ({
  seat: n, id: 'mao', name: `Pet${n}`, color: '#336699', alive: true, role: null, roleName: null, me: false,
  sheriff: false, flipped: false, ...over,
});
const table = (over: (n: number) => Partial<WolfSeat> = () => ({})): WolfSeat[] =>
  PET_IDS.slice(0, 12).map((id, i) => seat(i + 1, { id, ...over(i + 1) }));
const state = (seats: WolfSeat[], boom = false, phase: 'night' | 'talk' | 'over' = 'talk'): WolfOut =>
  ({ kind: 'state', day: 1, phase, label: 'Day 1', seats, boom });
const ask = (over: Partial<WolfAsk> & { kind: WolfAsk['kind'] }): WolfOut => ({
  kind: 'ask', ask: { title: 'Question?', options: [], save: false, poison: false, victim: null, ...over },
});

describe('the werewolf page: the lobby', () => {
  it('shows the lobby first, with the choice of playing or only watching and the pets to pick', () => {
    expect($('#lobby').hidden).toBe(false);
    expect($('#game').hidden).toBe(true);
    expect($('#lTitle').textContent).toBe(g.werewolfTitle);
    expect(labels('#lMode label')).toEqual([g.werewolf.modePlay, g.werewolf.modeWatch]);
    expect($('#lMode').hidden).toBe(false);
    expect($('#lPick').textContent).toBe(g.werewolf.pickPlay(11));
    expect(all('#lGrid label')).toHaveLength(PET_IDS.length);
    expect($('#lMinds').textContent).toBe(g.mindsOff);
  });

  it('says that the pets think when they can', () => {
    deliver(lobbyOf([], true));
    expect($('#lMinds').textContent).toBe(g.mindsOn);
  });

  it('starts a game for a user who plays, with the pets that were on, at most one fewer than the seats', () => {
    deliver(lobbyOf(PET_IDS, false));
    const boxes = all('#lGrid input');
    expect(boxes.filter((b) => (b as HTMLInputElement).checked)).toHaveLength(11);
    expect(boxes.filter((b) => (b as HTMLInputElement).disabled)).toHaveLength(PET_IDS.length - 11);
    $('#lStart').click();
    const m = sentOnce();
    expect(m).toMatchObject({ t: 'start', play: true });
    if (m.t === 'start') expect(m.pets).toHaveLength(11);
  });

  it('lets a user who only watches pick one more pet', () => {
    deliver(lobbyOf([], false));
    all('#lMode input')[1]?.click();
    expect($('#lPick').textContent).toBe(g.werewolf.pickWatch(12));
    const boxes = all('#lGrid input') as HTMLInputElement[];
    for (const b of boxes.slice(0, 12)) if (!b.checked) b.click();
    expect(boxes.filter((b) => b.checked)).toHaveLength(12);
    expect(boxes.filter((b) => !b.checked).every((b) => b.disabled)).toBe(true);
    $('#lStart').click();
    const m = sentOnce();
    expect(m).toMatchObject({ t: 'start', play: false });
    if (m.t === 'start') expect(m.pets).toHaveLength(12);
  });

  it('drops the pet over the cap when the user goes back to playing', () => {
    deliver(lobbyOf(PET_IDS, false));
    all('#lMode input')[1]?.click();
    const boxes = all('#lGrid input') as HTMLInputElement[];
    boxes.find((b) => !b.checked && !b.disabled)?.click();
    expect(boxes.filter((b) => b.checked)).toHaveLength(12);
    all('#lMode input')[0]?.click();
    expect(boxes.filter((b) => b.checked)).toHaveLength(11);
    $('#lStart').click();
    expect(sentOnce()).toMatchObject({ t: 'start', play: true });
  });
});

describe('the werewolf page: the table', () => {
  it('shows twelve seats with their names, and who the user is', () => {
    deliver(state(table((n) => (n === 5 ? { me: true, role: 'seer', roleName: 'Seer' } : {}))));
    expect($('#lobby').hidden).toBe(true);
    expect($('#game').hidden).toBe(false);
    const cards = all('#seats .seat');
    expect(cards).toHaveLength(12);
    expect(cards[0]?.querySelector('.nm')?.textContent).toBe('1. Pet1');
    expect(cards[11]?.querySelector('.nm')?.textContent).toBe('12. Pet12');
    expect(all('#seats .seat.me')).toEqual([cards[4]]);
    expect(cards[0]?.querySelector('.av')?.textContent).toBe('P');
    expect($('#day').textContent).toBe('Day 1');
    expect($('#phase').textContent).toBe(g.werewolf.phase.talk);
    expect($('#mine').textContent).toBe('Seer');
    expect($('#watch').textContent).toBe('');
  });

  it('tags the dead, the sheriff, the flipped idiot and the roles the user may know', () => {
    deliver(state(table((n) => {
      if (n === 1) return { alive: false };
      if (n === 2) return { sheriff: true };
      if (n === 3) return { flipped: true, role: 'idiot', roleName: 'Idiot' };
      if (n === 4) return { role: 'wolf', roleName: 'Wolf' };
      if (n === 5) return { role: 'seer', roleName: 'Seer' };
      if (n === 6) return { role: 'villager', roleName: 'Villager' };
      return {};
    })));
    const tags = (n: number): string[] => labels(`#seats .seat:nth-child(${n}) .tg`);
    expect(tags(1)).toEqual([g.werewolf.out]);
    expect(all('#seats .seat.dead')).toHaveLength(1);
    expect(tags(2)).toEqual([g.werewolf.sheriff]);
    expect(tags(3)).toEqual(['Idiot', g.werewolf.flipped]);
    expect(tags(4)).toEqual(['Wolf']);
    expect($('#seats .seat:nth-child(4) .tg').className).toContain('wolf');
    expect($('#seats .seat:nth-child(5) .tg').className).toContain('god');
    expect(tags(7)).toEqual([]);
  });

  it('says that the user is watching when there is no seat of his own', () => {
    deliver(state(table((n) => ({ role: 'villager', roleName: `Role${n}` }))));
    expect($('#watch').textContent).toBe(g.werewolf.watching);
    expect($('#mine').textContent).toBe('');
    expect(labels('#seats .seat .tg').filter((t) => t.startsWith('Role'))).toHaveLength(12);
  });

  it('shows the self-destruct button only to a living wolf in the day, and asks twice', () => {
    deliver(state(table((n) => (n === 2 ? { me: true, role: 'wolf', roleName: 'Wolf' } : {})), true));
    const boom = $('#boom');
    expect(boom.hidden).toBe(false);
    expect(boom.textContent).toBe(g.werewolf.boomButton);
    boom.click();
    expect(sent).toHaveLength(0);
    expect(boom.textContent).toBe(g.werewolf.boomSure);
    boom.click();
    expect(sentOnce()).toEqual({ t: 'boom' });
    expect(boom.textContent).toBe(g.werewolf.boomButton);

    deliver(state(table(), false, 'night'));
    expect($('#boom').hidden).toBe(true);
  });

  it('shows who is thinking and who spoke last', () => {
    deliver(state(table()));
    deliver({ kind: 'thinking', seats: [3, 7] });
    expect(all('#seats .seat.busy').map((e) => e.querySelector('.nm')?.textContent)).toEqual(['3. Pet3', '7. Pet7']);
    expect($('#seats .seat.busy').title).toBe(g.werewolf.thinking);
    deliver({ kind: 'thinking', seats: [] });
    expect(all('#seats .seat.busy')).toHaveLength(0);

    deliver({ kind: 'line', tone: 'say', seat: 4, text: 'Hello.' });
    expect(all('#seats .seat.talk').map((e) => e.querySelector('.nm')?.textContent)).toEqual(['4. Pet4']);
    deliver(state(table(), false, 'night'));
    expect(all('#seats .seat.talk')).toHaveLength(0);
  });
});

describe('the werewolf page: the log', () => {
  it('adds each line with its tone, a speech under its speaker, and scrolls down', () => {
    deliver(state(table()));
    const log = $('#log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 777 });
    deliver({ kind: 'line', tone: 'sys', seat: null, text: 'Night falls.' });
    deliver({ kind: 'line', tone: 'secret', seat: null, text: 'You are the seer.' });
    deliver({ kind: 'line', tone: 'vote', seat: null, text: 'Pet2 voted for Pet3.' });
    deliver({ kind: 'line', tone: 'say', seat: 6, text: 'I am a good player.' });
    const lines = all('#log .ln');
    expect(lines.map((l) => l.className)).toEqual(['ln sys', 'ln secret', 'ln vote', 'ln say']);
    expect(lines[3]?.textContent).toBe('Pet6: I am a good player.');
    expect(lines[3]?.querySelector('b')?.textContent).toBe('Pet6: ');
    expect(log.scrollTop).toBe(777);
  });

  it('puts what it is sent in as text, never as markup', () => {
    deliver(state(table((n) => (n === 2 ? { name: '<img src=x onerror=alert(1)>' } : {}))));
    deliver({ kind: 'line', tone: 'say', seat: 2, text: '<b>bold</b><script>alert(1)</script>' });
    deliver({ kind: 'line', tone: 'sys', seat: null, text: '<i>x</i>' });
    expect(document.querySelector('#log b b')).toBeNull();
    expect(document.querySelector('#log i')).toBeNull();
    expect(document.querySelector('#log script')).toBeNull();
    expect(document.querySelector('#seats img')).toBeNull();
    expect($('#log').textContent).toContain('<b>bold</b>');
  });

  it('starts a new game from a clean log', () => {
    deliver(state(table()));
    deliver({ kind: 'line', tone: 'sys', seat: null, text: 'Old news.' });
    deliver(lobbyOf([], false));
    expect(all('#log .ln')).toHaveLength(0);
    expect($('#ask').hidden).toBe(true);
    expect($('#game').hidden).toBe(true);
  });
});

describe('the werewolf page: the questions', () => {
  it('lets the wolf pick whom to kill and the seer whom to check', () => {
    deliver(state(table((n) => (n === 1 ? { me: true } : {}))));
    for (const kind of ['kill', 'check'] as const) {
      sent.length = 0;
      deliver(ask({ kind, title: 'Who?', options: [2, 3, 9] }));
      expect($('#ask').hidden).toBe(false);
      expect($('#ask .q').textContent).toBe('Who?');
      expect(labels('#ask button')).toEqual(['2. Pet2', '3. Pet3', '9. Pet9']);
      button('9. Pet9').click();
      expect(sentOnce()).toEqual({ t: 'target', seat: 9 });
      expect($('#ask').hidden).toBe(true);
    }
  });

  it('lets the user vote for a player or abstain', () => {
    deliver(state(table((n) => (n === 1 ? { me: true } : {}))));
    deliver(ask({ kind: 'vote', options: [2, 4] }));
    expect(labels('#ask button')).toEqual(['2. Pet2', '4. Pet4', g.werewolf.abstain]);
    button('4. Pet4').click();
    expect(sentOnce()).toEqual({ t: 'vote', seat: 4 });

    sent.length = 0;
    deliver(ask({ kind: 'vote', options: [2, 4] }));
    button(g.werewolf.abstain).click();
    expect(sentOnce()).toEqual({ t: 'vote', seat: null });
  });

  it('gives the witch her save, her poison and the choice to do nothing', () => {
    deliver(state(table((n) => (n === 1 ? { me: true } : {}))));
    deliver(ask({ kind: 'witch', options: [2, 3, 4], save: true, poison: true, victim: 3 }));
    const save = g.werewolf.saveHim('Pet3');
    expect(labels('#ask button')).toEqual([save, g.werewolf.noPotion, '2. Pet2', '3. Pet3', '4. Pet4']);
    expect(all('#ask .sub').map((e) => e.textContent)).toEqual([g.werewolf.poisonHint]);
    button(save).click();
    expect(sentOnce()).toEqual({ t: 'witch', save: true, poison: null });

    sent.length = 0;
    deliver(ask({ kind: 'witch', options: [2, 3, 4], save: true, poison: true, victim: 3 }));
    button('4. Pet4').click();
    expect(sentOnce()).toEqual({ t: 'witch', save: false, poison: 4 });

    sent.length = 0;
    deliver(ask({ kind: 'witch', options: [2], save: true, poison: true, victim: 3 }));
    button(g.werewolf.noPotion).click();
    expect(sentOnce()).toEqual({ t: 'witch', save: false, poison: null });
  });

  it('tells a witch who may not save herself, and has no poison row once the poison is used', () => {
    deliver(state(table((n) => (n === 1 ? { me: true } : {}))));
    deliver(ask({ kind: 'witch', options: [], save: false, poison: false, victim: 1 }));
    expect(labels('#ask button')).toEqual([g.werewolf.noPotion]);
    expect(all('#ask .sub').map((e) => e.textContent)).toEqual([g.werewolf.noSelfSave]);

    deliver(ask({ kind: 'witch', options: [], save: false, poison: false, victim: null }));
    expect(labels('#ask button')).toEqual([g.werewolf.noPotion]);
    expect(all('#ask .sub')).toHaveLength(0);
  });

  it('asks whether to run for sheriff', () => {
    deliver(state(table((n) => (n === 1 ? { me: true } : {}))));
    deliver(ask({ kind: 'run' }));
    expect(labels('#ask button')).toEqual([g.werewolf.runYes, g.werewolf.runNo]);
    button(g.werewolf.runYes).click();
    expect(sentOnce()).toEqual({ t: 'run', run: true });

    sent.length = 0;
    deliver(ask({ kind: 'run' }));
    button(g.werewolf.runNo).click();
    expect(sentOnce()).toEqual({ t: 'run', run: false });
  });

  it('takes a speech, or a pass', () => {
    deliver(state(table((n) => (n === 1 ? { me: true } : {}))));
    deliver(ask({ kind: 'speak', title: 'Your turn' }));
    const input = $('#ask input') as HTMLInputElement;
    expect(input.placeholder).toBe(g.werewolf.sendHint);
    expect(input.maxLength).toBe(240);
    expect(labels('#ask button')).toEqual([g.werewolf.send, g.werewolf.pass]);
    input.value = '  I am the villager.  ';
    button(g.werewolf.send).click();
    expect(sentOnce()).toEqual({ t: 'say', text: 'I am the villager.' });
    expect($('#ask').hidden).toBe(true);

    sent.length = 0;
    deliver(ask({ kind: 'speak', title: 'Your turn' }));
    button(g.werewolf.pass).click();
    expect(sentOnce()).toEqual({ t: 'say', text: '' });
  });

  it('lets a hunter shoot or hold his fire, and a sheriff pass the badge or tear it', () => {
    deliver(state(table((n) => (n === 1 ? { me: true } : {}))));
    deliver(ask({ kind: 'shoot', options: [2, 3] }));
    expect(labels('#ask button')).toEqual(['2. Pet2', '3. Pet3', g.werewolf.noShot]);
    button('3. Pet3').click();
    expect(sentOnce()).toEqual({ t: 'pick', seat: 3 });

    sent.length = 0;
    deliver(ask({ kind: 'shoot', options: [2, 3] }));
    button(g.werewolf.noShot).click();
    expect(sentOnce()).toEqual({ t: 'pick', seat: null });

    sent.length = 0;
    deliver(ask({ kind: 'badge', options: [5, 6] }));
    expect(labels('#ask button')).toEqual(['5. Pet5', '6. Pet6', g.werewolf.tearBadge]);
    button('5. Pet5').click();
    expect(sentOnce()).toEqual({ t: 'pick', seat: 5 });

    sent.length = 0;
    deliver(ask({ kind: 'badge', options: [5, 6] }));
    button(g.werewolf.tearBadge).click();
    expect(sentOnce()).toEqual({ t: 'pick', seat: null });
  });

  it('says it is waiting for the others while the user is in the game, and never to a spectator', () => {
    deliver(state(table((n) => (n === 1 ? { me: true } : {}))));
    deliver({ kind: 'ask', ask: null });
    expect($('#ask').hidden).toBe(false);
    expect($('#ask').textContent).toBe(g.werewolf.waiting);

    deliver(state(table((n) => (n === 1 ? { me: true, alive: false } : {}))));
    deliver({ kind: 'ask', ask: null });
    expect($('#ask').hidden).toBe(true);

    deliver(state(table()));
    deliver({ kind: 'ask', ask: null });
    expect($('#ask').hidden).toBe(true);
  });
});

describe('the werewolf page: the end', () => {
  it('shows who won with the roles and a button for another game', () => {
    deliver(state(table((n) => (n === 1 ? { me: true } : {})), false, 'over'));
    deliver({ kind: 'over', win: true, winner: 'village', title: 'You win!', text: 'Roles: 1. Pet1 Seer' });
    expect($('#ask').hidden).toBe(false);
    expect($('#over').textContent).toBe('You win!');
    expect($('#ask').textContent).toContain('Roles: 1. Pet1 Seer');
    deliver({ kind: 'ask', ask: null });
    expect($('#ask').hidden).toBe(true);

    deliver({ kind: 'over', win: null, winner: 'wolves', title: 'The wolves win', text: 'Roles' });
    button(g.again).click();
    expect(sentOnce()).toEqual({ t: 'again' });
  });
});

describe('the werewolf page as a page', () => {
  it('uses no external resource and builds nothing from markup', () => {
    expect(WEREWOLF_PAGE).not.toMatch(/https?:|<link|<img|src=|href=|@import|url\(/);
    expect(WEREWOLF_PAGE).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });
});
