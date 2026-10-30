// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SANGUOSHA_PAGE } from '../../../src/main/teammate/sanguoshaPage';
import { parseSgsIn, type GameApi, type SgsIn, type SgsOut, type SgsSeat } from '../../../src/shared/gameIpc';
import { strings } from '../../../src/shared/i18n';
import { lobbyChoices } from '../../../src/shared/teammate/gameText';
import { PET_IDS, type PetId } from '../../../src/shared/teammate/pet';
import { CARD_NAMES, SUITS, type CardName, type Suit } from '../../../src/shared/teammate/sanguoshaCards';
import {
  HERO_IDS, HEROES, KINGDOMS, SKILLS, type HeroId, type Kingdom, type SkillId,
} from '../../../src/shared/teammate/sanguoshaHeroes';
import { sanguoshaText } from '../../../src/shared/teammate/sanguoshaText';
import type { Phase, Reply, Role, SkillOption, Use } from '../../../src/shared/teammate/sanguoshaTypes';
import { heroInfo, type CardView } from '../../../src/shared/teammate/sanguoshaView';

const LANGS = ['en', 'zh-CN'] as const;
type Lang = (typeof LANGS)[number];
const gamesOf = (lang: Lang) => strings(lang, 'win').teammate.games;
const namesOf = (lang: Lang) => strings(lang, 'win').teammate.ask.petName;

/** The words the page reads, so that a word that is misspelt here is an error and not an `undefined`. */
type Words = Record<
  | 'again' | 'turnNo' | 'pile' | 'hand' | 'dist' | 'range' | 'out' | 'spectating' | 'waiting' | 'yourTurn' | 'endTurn'
  | 'ok' | 'cancel' | 'pass' | 'yes' | 'no' | 'pickTarget' | 'pickTargets' | 'pickCards' | 'playAs' | 'yourSkills'
  | 'hiddenCard'
  | `card_${CardName}` | `tip_${CardName}` | `skill_${SkillId}` | `skillTip_${SkillId}` | `hero_${HeroId}`
  | `kingdom_${Kingdom}` | `role_${Role}` | `roleHint_${Role}` | `phase_${Phase}`,
  string
>;
const textOf = (lang: Lang): Words => sanguoshaText(gamesOf(lang)) as Words;

const g = gamesOf('en');
const W = g.sanguosha;
const T = textOf('en');
const fill = (text: string, n: number): string => text.replace('{n}', String(n));

const lobbyOf = (lang: Lang = 'en', picked: readonly PetId[] = []): SgsOut => ({
  kind: 'lobby', text: sanguoshaText(gamesOf(lang)), choices: lobbyChoices(picked, namesOf(lang)), seats: 7,
  watchSeats: 7, minds: false, sizes: [5, 8],
});

let deliver: (msg: SgsOut) => void = () => undefined;
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
  const script = /<script>([\s\S]*)<\/script>/.exec(SANGUOSHA_PAGE)?.[1];
  if (script === undefined) throw new Error('The page has no script.');
  document.documentElement.innerHTML = SANGUOSHA_PAGE.replace(/<script>[\s\S]*<\/script>/, '');
  (new Function('gameApi', script) as (api: GameApi) => void)(api);
});

beforeEach(() => {
  sent.length = 0;
  deliver(lobbyOf());
});

const $ = (sel: string): HTMLElement => {
  const e = document.querySelector<HTMLElement>(sel);
  if (!e) throw new Error(`No ${sel}`);
  return e;
};
const all = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const nth = (sel: string, i: number): HTMLElement => {
  const e = all(sel)[i];
  if (!e) throw new Error(`No ${sel} number ${i}`);
  return e;
};
const labels = (sel: string): string[] => all(sel).map((e) => e.textContent ?? '');
const button = (label: string): HTMLButtonElement => {
  const b = all('#prompt button').find((x): x is HTMLButtonElement => x.textContent === label);
  if (!b) throw new Error(`No button ${label}: ${labels('#prompt button').join(' | ')}`);
  return b;
};

/** The one message the page sent, as the room would read it. */
const sentOnce = (): SgsIn => {
  expect(sent).toHaveLength(1);
  const m = parseSgsIn(sent[0]);
  if (!m) throw new Error(`The page sent a message the room would refuse: ${JSON.stringify(sent[0])}`);
  return m;
};
const sentReply = (): Reply => {
  const m = sentOnce();
  if (m.t !== 'reply') throw new Error(`Not a reply: ${JSON.stringify(m)}`);
  return m.reply;
};

const c = (id: number, name: CardName, suit: Suit = 'spade', rank = 7): CardView => ({ id, name, suit, rank });

const HERO_AT: readonly HeroId[] = ['zhugeliang', 'caocao', 'sunquan', 'lvbu', 'huatuo', 'guanyu', 'zhouyu', 'diaochan'];
const seat = (n: number, me: number, over: Partial<SgsSeat> = {}): SgsSeat => {
  const hero = HERO_AT[n] ?? 'liubei';
  return {
    seat: n, id: n === me ? 'user' : (PET_IDS[n] ?? 'whale'), name: n === me ? 'You' : `Pet${n}`, color: '#336699',
    me: n === me, hero, kingdom: HEROES[hero].kingdom, skills: [...HEROES[hero].skills],
    role: n === me ? 'rebel' : n === 1 ? 'lord' : null, hp: HEROES[hero].hp, maxHp: HEROES[hero].hp, alive: true,
    hand: 4, dist: n === me ? 0 : 1, range: 1, equip: [], judges: [], ...over,
  };
};
const table = (size = 5, over: (n: number) => Partial<SgsSeat> = () => ({}), me = 0): SgsSeat[] =>
  Array.from({ length: size }, (_, n) => seat(n, me, over(n)));

type State = Extract<SgsOut, { kind: 'state' }>;
const state = (seats: SgsSeat[], over: Partial<State> = {}): SgsOut => ({
  kind: 'state', seats, hand: [], pile: 60, turn: 0, phase: 'play', turns: 3, ...over,
});

const seatNo = (e: HTMLElement): number => Number(e.querySelector('.nm')?.textContent?.split('.')[0]);
/** The seats, the user's own among them, that are marked `cls` (pick: may be chosen; picked: has been). */
const marked = (cls: string): number[] => all(`.seat.${cls}`).map(seatNo).sort((a, b) => a - b);
const oppSeat = (n: number): HTMLElement => {
  const s = all('#opps .seat').find((e) => seatNo(e) === n);
  if (!s) throw new Error(`No seat ${n}`);
  return s;
};
const mySeat = (): HTMLElement => $('#meSeat .seat');
const handClasses = (): string[] => all('#hand .card').map((e) => {
  const has = (k: string) => e.classList.contains(k);
  return has('sel') ? 'sel' : has('ok') ? 'ok' : has('dim') ? 'dim' : '';
});
const expectWaiting = (): void => {
  expect(labels('#prompt .sub')).toEqual([T.waiting]);
  expect(all('#prompt button')).toHaveLength(0);
};

describe('the Sanguosha page: the lobby', () => {
  it('shows the lobby first, with the sizes of table to pick from and no choice of watching', () => {
    expect($('#lobby').hidden).toBe(false);
    expect($('#game').hidden).toBe(true);
    expect(document.title).toBe(W.title);
    expect($('#lTitle').textContent).toBe(W.title);
    expect($('#lRules').textContent).toBe(W.rules);
    expect($('#lMode').hidden).toBe(true);
    expect($('#lSize').hidden).toBe(false);
    expect(labels('#lSize label')).toEqual([W.size5, W.size8]);
    expect(all('#lSize input').map((r) => (r as HTMLInputElement).checked)).toEqual([true, false]);
    expect(all('#lGrid label')).toHaveLength(PET_IDS.length);
    expect($('#lMinds').textContent).toBe(W.bots);
    expect($('#lStart').textContent).toBe(g.start);
  });

  it('says in the lobby that this is an unofficial version', () => {
    expect($('#lRules').textContent).toMatch(/unofficial/i);
    deliver(lobbyOf('zh-CN'));
    expect($('#lRules').textContent).toContain('非官方');
  });

  it('lets the size of the table set how many pets may sit with the user', () => {
    expect($('#lPick').textContent).toBe(fill(W.pick, 4));
    nth('#lSize input', 1).click();
    expect($('#lPick').textContent).toBe(fill(W.pick, 7));
    expect(all('#lSize label').map((l) => l.className)).toEqual(['', 'on']);
    nth('#lSize input', 0).click();
    expect($('#lPick').textContent).toBe(fill(W.pick, 4));
    expect(all('#lSize label').map((l) => l.className)).toEqual(['on', '']);
  });

  it('starts a table of five with the pets that were on, at most four', () => {
    deliver(lobbyOf('en', PET_IDS));
    const boxes = all('#lGrid input') as HTMLInputElement[];
    expect(boxes.filter((b) => b.checked)).toHaveLength(4);
    expect(boxes.filter((b) => b.disabled)).toHaveLength(PET_IDS.length - 4);
    $('#lStart').click();
    expect(sentOnce()).toEqual({ t: 'start', pets: PET_IDS.slice(0, 4), size: 5 });
  });

  it('starts a table of eight with up to seven pets, and drops the extra ones when the user goes back to five', () => {
    deliver(lobbyOf('en', PET_IDS));
    const boxes = all('#lGrid input') as HTMLInputElement[];
    nth('#lSize input', 1).click();
    expect(boxes.filter((b) => b.checked)).toHaveLength(4);
    expect(boxes.some((b) => b.disabled)).toBe(false);
    for (const b of boxes.filter((x) => !x.checked).slice(0, 3)) b.click();
    expect(boxes.filter((b) => b.checked)).toHaveLength(7);
    expect(boxes.filter((b) => !b.checked).every((b) => b.disabled)).toBe(true);
    $('#lStart').click();
    expect(sentOnce()).toEqual({ t: 'start', pets: PET_IDS.slice(0, 7), size: 8 });

    sent.length = 0;
    nth('#lSize input', 0).click();
    expect(boxes.filter((b) => b.checked)).toHaveLength(4);
    $('#lStart').click();
    expect(sentOnce()).toEqual({ t: 'start', pets: PET_IDS.slice(0, 4), size: 5 });
  });

  it('starts with no pets when none were picked, and the room fills the seats', () => {
    $('#lStart').click();
    expect(sentOnce()).toEqual({ t: 'start', pets: [], size: 5 });
  });

  it('speaks the language it is sent', () => {
    deliver(lobbyOf('zh-CN'));
    const zh = gamesOf('zh-CN').sanguosha;
    expect(document.title).toBe(zh.title);
    expect(labels('#lSize label')).toEqual([zh.size5, zh.size8]);
    expect($('#lPick').textContent).toBe(fill(zh.pick, 4));
    expect($('#lMinds').textContent).toBe(zh.bots);
  });
});

describe('the Sanguosha page: the table', () => {
  it('replaces the lobby with the game, and says in the bar the turn, whose it is, the phase, the pile and the role', () => {
    deliver(state(table(), { turn: 2, turns: 7, phase: 'draw', pile: 61 }));
    expect($('#lobby').hidden).toBe(true);
    expect($('#game').hidden).toBe(false);
    expect($('#turn').textContent).toBe(fill(T.turnNo, 7));
    expect($('#who').textContent).toBe('Pet2');
    expect($('#phase').textContent).toBe(T.phase_draw);
    expect($('#pile').textContent).toBe(fill(T.pile, 61));
    expect($('#mine').textContent).toBe(T.role_rebel);
    expect($('#mine').title).toBe(T.roleHint_rebel);
  });

  it('says that it is the user’s turn when it is, and marks his seat', () => {
    deliver(state(table(), { turn: 0 }));
    expect($('#who').textContent).toBe(T.yourTurn);
    expect(marked('turn')).toEqual([0]);
  });

  it('says nothing of the turn before the first one is played', () => {
    deliver(state(table(), { turns: 0, turn: 0, phase: 'start' }));
    expect(labels('#turn, #who, #phase')).toEqual(['', '', '']);
  });

  it('lists the others clockwise from the one after the user, at a table of five or of eight', () => {
    deliver(state(table(5, () => ({}), 2)));
    expect(labels('#opps .seat .nm')).toEqual(['3. Pet3', '4. Pet4', '0. Pet0', '1. Pet1']);
    expect($('#meSeat .nm').textContent).toBe('2. You');
    expect(all('#opps .seat.me')).toHaveLength(0);

    deliver(state(table(8)));
    expect(labels('#opps .seat .nm')).toEqual(['1. Pet1', '2. Pet2', '3. Pet3', '4. Pet4', '5. Pet5', '6. Pet6', '7. Pet7']);
    expect($('#meSeat .nm').textContent).toBe('0. You');
  });

  it('shows what is known of each seat: role, hero and kingdom, hit points, hand, distance and reach', () => {
    deliver(state(table(5, (n) => (n === 1
      ? { hero: 'caocao', kingdom: 'wei', skills: ['jianxiong'], hp: 3, maxHp: 5, hand: 6, dist: 2, range: 3 }
      : {}))));
    const lord = oppSeat(1);
    expect(labels('#opps .seat:nth-child(1) .tg')).toEqual([T.role_lord, `${T.hero_caocao} · ${T.kingdom_wei}`]);
    expect(lord.querySelector('.tg')?.className).toContain('r-lord');
    expect(lord.querySelector('.tg.k-wei')).not.toBeNull();
    expect(lord.querySelectorAll('.hp i')).toHaveLength(5);
    expect(lord.querySelectorAll('.hp i.f')).toHaveLength(3);
    expect(lord.querySelector('.st')?.textContent).toBe(`${fill(T.hand, 6)} · ${fill(T.dist, 2)} · ${fill(T.range, 3)}`);
    expect(lord.querySelector('.av')?.textContent).toBe('P');
    expect(lord.querySelector('.nm')?.textContent).toBe('1. Pet1');
  });

  it('keeps a role that is not known off the seat, and the user’s own on his', () => {
    deliver(state(table()));
    expect(labels('#opps .seat:nth-child(2) .tg')).toEqual([`${T.hero_sunquan} · ${T.kingdom_wu}`]);
    expect(labels('#meSeat .tg')).toEqual([T.role_rebel, `${T.hero_zhugeliang} · ${T.kingdom_shu}`]);
  });

  it('colours the hit points by how few are left', () => {
    deliver(state(table(5, (n) => (n === 1 ? { hp: 1 } : n === 2 ? { hp: 2 } : n === 3 ? { hp: 0, alive: false } : {}))));
    expect(all('#opps .seat').map((s) => s.querySelector('.hp')?.className)).toEqual(['hp low', 'hp mid', 'hp low', 'hp']);
  });

  it('shows a seat that is out, without a reach and without a distance, and keeps the turn off it', () => {
    deliver(state(table(5, (n) => (n === 2 ? { alive: false, hp: 0, hand: 0, dist: 0, role: 'rebel' } : {})), { turn: 2 }));
    const dead = oppSeat(2);
    expect(dead.classList.contains('dead')).toBe(true);
    expect(dead.classList.contains('turn')).toBe(false);
    expect(labels('#opps .seat:nth-child(2) .tg')).toEqual([T.role_rebel, T.out, `${T.hero_sunquan} · ${T.kingdom_wu}`]);
    expect(dead.querySelector('.st')?.textContent).toBe(fill(T.hand, 0));
    expect(dead.querySelectorAll('.hp i.f')).toHaveLength(0);
    expect(marked('turn')).toEqual([]);
  });

  it('shows what a seat wears and the tricks waiting on it, a trick as what it is played as', () => {
    deliver(state(table(5, (n) => (n === 3
      ? {
        equip: [c(10, 'zhuge', 'club', 1), c(11, 'bagua', 'spade', 2), c(12, 'dilu', 'heart', 5)],
        judges: [{ as: 'lebu', card: c(13, 'sha', 'heart', 9) }],
      }
      : {}))));
    const gear = all('#opps .seat:nth-child(3) .gear .chip');
    expect(gear.map((e) => e.textContent)).toEqual([
      `${T.card_zhuge} ♣A`, `${T.card_bagua} ♠2`, `${T.card_dilu} ♥5`, `${T.card_lebu} ♥9`,
    ]);
    expect(gear.map((e) => e.classList.contains('red'))).toEqual([false, false, true, true]);
    expect(gear.map((e) => e.classList.contains('judge'))).toEqual([false, false, false, true]);
    expect(gear[0]?.title).toBe(`${T.card_zhuge}: ${T.tip_zhuge}`);
    expect(gear[3]?.title).toBe(`${T.card_lebu}: ${T.tip_lebu}`);
    expect(all('#opps .seat:nth-child(1) .gear')).toHaveLength(0);
  });

  it('shows the user’s hand by suit, rank and name, red cards in red, each kind in its own colour', () => {
    deliver(state(table(), {
      hand: [
        c(1, 'sha', 'spade', 7), c(2, 'shan', 'heart', 11), c(3, 'chai', 'club', 12), c(4, 'lebu', 'diamond', 1),
        c(5, 'zhuge', 'club', 13),
      ],
    }));
    expect(labels('#hand .cs')).toEqual(['♠7', '♥J', '♣Q', '♦A', '♣K']);
    expect(labels('#hand .cn')).toEqual([T.card_sha, T.card_shan, T.card_chai, T.card_lebu, T.card_zhuge]);
    const kinds = ['basic', 'basic', 'trick', 'delayed', 'gear'];
    all('#hand .card').forEach((e, i) => {
      expect(e.classList.contains(kinds[i] ?? ''), `card ${i}`).toBe(true);
      expect(e.classList.contains('red'), `card ${i}`).toBe(i === 1 || i === 3);
    });
    expect(nth('#hand .card', 0).title).toBe(`${T.card_sha}: ${T.tip_sha}`);
    expect(handClasses()).toEqual(['', '', '', '', '']);
  });

  it('lists the user’s skills with what each does', () => {
    deliver(state(table()));
    expect(labels('#skills .chip.skill')).toEqual([T.skill_guanxing, T.skill_kongcheng]);
    expect(nth('#skills .chip.skill', 0).title).toBe(`${T.skill_guanxing}: ${T.skillTip_guanxing}`);
    expect($('#skills').textContent).toContain(T.yourSkills);
  });

  it('copes with a table before the heroes are chosen: no hero, no hit points, no hand', () => {
    deliver(state(table(5, () => ({ hero: null, kingdom: null, skills: [], hp: 0, maxHp: 0 })), { hand: [], turns: 0 }));
    expect(all('.hp')).toHaveLength(0);
    expect(all('.tg').map((e) => e.className)).toEqual(['tg r-lord', 'tg r-rebel']);
    expect($('#skills').textContent).toBe('');
    expect(all('#hand .card')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it('says that the table is waiting, or that the user is out and may keep watching', () => {
    deliver(state(table()));
    expectWaiting();
    deliver(state(table(5, (n) => (n === 0 ? { alive: false, hp: 0 } : {}))));
    expect(labels('#prompt .sub')).toEqual([T.spectating]);
  });

  it('puts what it is sent in as text, never as markup', () => {
    deliver(state(table(5, (n) => (n === 2 ? { name: '<img src=x onerror=alert(1)>' } : {}))));
    expect(document.querySelector('#opps img')).toBeNull();
    expect(labels('#opps .nm')).toContain('2. <img src=x onerror=alert(1)>');
  });
});

describe('the Sanguosha page: the log', () => {
  it('adds each line with its tone', () => {
    deliver(state(table()));
    const tones = ['sys', 'turn', 'act', 'hit', 'heal', 'say', 'secret'] as const;
    for (const tone of tones) deliver({ kind: 'line', tone, seat: null, text: `Line ${tone}` });
    expect(all('#log .ln').map((l) => l.className)).toEqual(tones.map((t) => `ln ${t}`));
    expect(labels('#log .ln')).toEqual(tones.map((t) => `Line ${t}`));
  });

  it('puts a speech under its speaker’s name in his colour, and names a speaker who is not at the table by his seat', () => {
    deliver(state(table()));
    deliver({ kind: 'line', tone: 'say', seat: 2, text: 'Hello.' });
    deliver({ kind: 'line', tone: 'say', seat: 9, text: 'Who am I?' });
    const [first, second] = all('#log .ln');
    expect(first?.textContent).toBe('Pet2: Hello.');
    expect(first?.querySelector('b')?.textContent).toBe('Pet2: ');
    expect(first?.querySelector('b')?.style.color).toBe('rgb(51, 102, 153)');
    expect(second?.textContent).toBe('9: Who am I?');
  });

  it('scrolls to the newest line', () => {
    deliver(state(table()));
    const log = $('#log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 777 });
    deliver({ kind: 'line', tone: 'act', seat: null, text: 'Something happens.' });
    expect(log.scrollTop).toBe(777);
  });

  it('keeps only the last 400 lines', () => {
    deliver(state(table()));
    for (let i = 0; i < 405; i++) deliver({ kind: 'line', tone: 'act', seat: null, text: `Line ${i}` });
    const lines = labels('#log .ln');
    expect(lines).toHaveLength(400);
    expect(lines[0]).toBe('Line 5');
    expect(lines[399]).toBe('Line 404');
  });

  it('puts what it is sent in as text, never as markup', () => {
    deliver(state(table()));
    deliver({ kind: 'line', tone: 'say', seat: 2, text: '<b>bold</b><script>alert(1)</script>' });
    deliver({ kind: 'line', tone: 'sys', seat: null, text: '<i>x</i>' });
    expect(document.querySelector('#log b b')).toBeNull();
    expect(document.querySelector('#log i')).toBeNull();
    expect(document.querySelector('#log script')).toBeNull();
    expect($('#log').textContent).toContain('<b>bold</b>');
  });

  it('starts a new game from a clean log and a clean table', () => {
    deliver(state(table(), { hand: [c(1, 'sha')] }));
    deliver({ kind: 'line', tone: 'sys', seat: null, text: 'Old news.' });
    deliver(lobbyOf());
    expect(all('#log .ln')).toHaveLength(0);
    expect($('#game').hidden).toBe(true);
    expect($('#lobby').hidden).toBe(false);
    expect($('#prompt').children).toHaveLength(0);
  });
});

/** The uses, skills and cards the questions below are built on. */
const one = (...options: number[]) => ({ min: 1, max: 1, options });
const none = { min: 0, max: 0, options: [] as number[] };
const HAND: CardView[] = [
  c(1, 'sha', 'spade', 7), c(2, 'shan', 'heart', 2), c(3, 'tao', 'heart', 3), c(4, 'chai', 'club', 3),
  c(5, 'nanman', 'spade', 7), c(6, 'sha', 'diamond', 9),
];
const GEAR: CardView[] = [c(20, 'zhuge', 'club', 1), c(21, 'dilu', 'heart', 5)];
const USES: Use[] = [
  { card: 1, as: 'sha', targets: one(1, 2) },
  { card: 3, as: 'tao', targets: none },
  { card: 3, as: 'sha', skill: 'wusheng', targets: one(1, 2) },
  { card: 4, as: 'chai', targets: one(1, 2, 3) },
  { card: 5, as: 'nanman', targets: none },
  { card: 6, as: 'sha', targets: { min: 1, max: 3, options: [1, 2, 3, 4] } },
];
const everything = [1, 2, 3, 4, 5, 6];
const SKILL_OPTS: SkillOption[] = [
  { skill: 'rende', cards: { min: 1, max: 2, ids: everything }, targets: one(1, 2, 3) },
  { skill: 'zhiheng', cards: { min: 1, max: 8, ids: [...everything, 20, 21] }, targets: null },
  { skill: 'kurou', cards: null, targets: null },
  { skill: 'qingnang', cards: { min: 1, max: 1, ids: everything }, targets: one(0, 1) },
];
const playAsk = (): SgsOut => ({ kind: 'ask', ask: { k: 'play', title: 'Your move.', uses: USES, skills: SKILL_OPTS } });
const START_BUTTONS = [T.skill_rende, T.skill_zhiheng, T.skill_kurou, T.skill_qingnang, T.endTurn];
const handCard = (id: number): HTMLElement => nth('#hand .card', HAND.findIndex((x) => x.id === id));

describe('the Sanguosha page: the play phase', () => {
  beforeEach(() => {
    deliver(state(table(5, (n) => (n === 0 ? { equip: GEAR } : {})), { hand: HAND }));
    deliver(playAsk());
  });

  it('lights the cards that can be played, dims the rest, and offers the skills and the end of the turn', () => {
    expect($('#prompt .q').textContent).toBe('Your move.');
    expect(labels('#prompt button')).toEqual(START_BUTTONS);
    expect(button(T.skill_rende).title).toBe(T.skillTip_rende);
    expect(handClasses()).toEqual(['ok', 'dim', 'ok', 'ok', 'ok', 'ok']);
    expect(marked('pick')).toEqual([]);
  });

  it('ends the turn, and is then back to waiting', () => {
    button(T.endTurn).click();
    expect(sentReply()).toEqual({ k: 'end' });
    expectWaiting();
    expect(handClasses()).toEqual(['', '', '', '', '', '']);
  });

  it('plays a card on the one target with a click on the target, saying nothing of a skill', () => {
    handCard(1).click();
    expect(labels('#prompt .sub')).toEqual([T.pickTarget]);
    expect(labels('#prompt button')).toEqual([T.cancel]);
    expect(handClasses()).toEqual(['sel', 'dim', 'ok', 'ok', 'ok', 'ok']);
    expect(marked('pick')).toEqual([1, 2]);
    oppSeat(2).click();
    expect(sentReply()).toEqual({ k: 'use', card: 1, as: 'sha', targets: [2] });
    expect(sent[0]).not.toHaveProperty('reply.skill');
    expectWaiting();
    expect(marked('pick')).toEqual([]);
  });

  it('does nothing for a click on a seat that cannot be chosen, or on a card that cannot be played', () => {
    handCard(2).click();
    expect(labels('#prompt button')).toEqual(START_BUTTONS);
    handCard(1).click();
    oppSeat(4).click();
    expect(sent).toHaveLength(0);
    expect(labels('#prompt .sub')).toEqual([T.pickTarget]);
  });

  it('plays a card that needs no target with OK', () => {
    handCard(5).click();
    expect(labels('#prompt .sub')).toEqual([]);
    expect(labels('#prompt button')).toEqual([T.ok, T.cancel]);
    expect(button(T.ok).disabled).toBe(false);
    button(T.ok).click();
    expect(sentReply()).toEqual({ k: 'use', card: 5, as: 'nanman', targets: [] });
  });

  it('asks how to play a card that can be played as more than one, and tells a skill’s use by the skill', () => {
    handCard(3).click();
    const as = `${T.card_sha} (${T.skill_wusheng})`;
    expect(labels('#prompt .sub')).toEqual([T.playAs.replace('{card}', T.card_tao)]);
    expect(labels('#prompt button')).toEqual([T.card_tao, as, T.cancel]);
    button(as).click();
    expect(labels('#prompt .sub')).toEqual([T.pickTarget]);
    oppSeat(1).click();
    expect(sentReply()).toEqual({ k: 'use', card: 3, as: 'sha', skill: 'wusheng', targets: [1] });
    expect(sent[0]).toHaveProperty('reply.skill', 'wusheng');
  });

  it('plays the same card the other way, with no target', () => {
    handCard(3).click();
    button(T.card_tao).click();
    expect(labels('#prompt button')).toEqual([T.ok, T.cancel]);
    button(T.ok).click();
    expect(sentReply()).toEqual({ k: 'use', card: 3, as: 'tao', targets: [] });
    expect(sent[0]).not.toHaveProperty('reply.skill');
  });

  it('takes up to as many targets as the card allows, and OK only once there is one', () => {
    handCard(6).click();
    expect(labels('#prompt .sub')).toEqual([fill(T.pickTargets, 3)]);
    expect(button(T.ok).disabled).toBe(true);
    oppSeat(3).click();
    expect(button(T.ok).disabled).toBe(false);
    oppSeat(1).click();
    oppSeat(4).click();
    expect(marked('picked')).toEqual([1, 3, 4]);
    expect(marked('pick')).toEqual([2]);
    oppSeat(2).click();
    expect(marked('picked')).toEqual([1, 3, 4]);
    oppSeat(3).click();
    expect(marked('picked')).toEqual([1, 4]);
    expect(sent).toHaveLength(0);
    button(T.ok).click();
    expect(sentReply()).toEqual({ k: 'use', card: 6, as: 'sha', targets: [1, 4] });
  });

  it('lets the user put the choice away with Cancel, or by choosing the same card again', () => {
    handCard(1).click();
    button(T.cancel).click();
    expect(labels('#prompt button')).toEqual(START_BUTTONS);
    expect(marked('pick')).toEqual([]);
    expect(handClasses()).toEqual(['ok', 'dim', 'ok', 'ok', 'ok', 'ok']);

    handCard(4).click();
    expect(marked('pick')).toEqual([1, 2, 3]);
    handCard(4).click();
    expect(labels('#prompt button')).toEqual(START_BUTTONS);
    expect(sent).toHaveLength(0);
  });

  it('moves to another card without Cancel, with the targets of that card', () => {
    handCard(1).click();
    expect(marked('pick')).toEqual([1, 2]);
    handCard(4).click();
    expect(marked('pick')).toEqual([1, 2, 3]);
    expect(handClasses()).toEqual(['ok', 'dim', 'ok', 'sel', 'ok', 'ok']);
    oppSeat(3).click();
    expect(sentReply()).toEqual({ k: 'use', card: 4, as: 'chai', targets: [3] });
  });

  it('uses a skill that needs nothing more with OK', () => {
    button(T.skill_kurou).click();
    expect(labels('#prompt button')).toEqual([T.ok, T.cancel]);
    button(T.ok).click();
    expect(sentReply()).toEqual({ k: 'skill', skill: 'kurou', cards: [], targets: [] });
  });

  it('uses a skill on cards, equipment too, once the least number of them are picked', () => {
    button(T.skill_zhiheng).click();
    expect(labels('#prompt .sub')).toEqual([T.pickCards]);
    expect(handClasses()).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(all('#meSeat .gear .chip.ok')).toHaveLength(2);
    expect(button(T.ok).disabled).toBe(true);
    handCard(1).click();
    nth('#meSeat .gear .chip', 0).click();
    expect(handClasses()).toEqual(['sel', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(all('#meSeat .gear .chip.sel')).toHaveLength(1);
    expect(button(T.ok).disabled).toBe(false);
    button(T.ok).click();
    expect(sentReply()).toEqual({ k: 'skill', skill: 'zhiheng', cards: [1, 20], targets: [] });
  });

  it('uses a skill on cards and then on a target, the click on the target ending it', () => {
    button(T.skill_rende).click();
    handCard(1).click();
    handCard(4).click();
    handCard(5).click();
    expect(handClasses()).toEqual(['sel', 'ok', 'ok', 'sel', 'ok', 'ok']);
    button(T.ok).click();
    expect(labels('#prompt .sub')).toEqual([T.pickTarget]);
    expect(labels('#prompt button')).toEqual([T.cancel]);
    expect(marked('pick')).toEqual([1, 2, 3]);
    oppSeat(2).click();
    expect(sentReply()).toEqual({ k: 'skill', skill: 'rende', cards: [1, 4], targets: [2] });
  });

  it('lets a skill that takes one card swap it for another, and aim at the user himself', () => {
    button(T.skill_qingnang).click();
    handCard(1).click();
    handCard(3).click();
    expect(handClasses()).toEqual(['ok', 'ok', 'sel', 'ok', 'ok', 'ok']);
    button(T.ok).click();
    expect(marked('pick')).toEqual([0, 1]);
    mySeat().click();
    expect(sentReply()).toEqual({ k: 'skill', skill: 'qingnang', cards: [3], targets: [0] });
  });

  it('can put a skill’s cards back, and drop the skill with Cancel', () => {
    button(T.skill_rende).click();
    handCard(1).click();
    handCard(1).click();
    expect(handClasses()).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(button(T.ok).disabled).toBe(true);
    button(T.cancel).click();
    expect(labels('#prompt button')).toEqual(START_BUTTONS);
    expect(all('#meSeat .gear .chip.ok')).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('forgets a half-made choice when the table asks again', () => {
    handCard(1).click();
    expect(marked('pick')).toEqual([1, 2]);
    deliver(playAsk());
    expect(labels('#prompt button')).toEqual(START_BUTTONS);
    expect(marked('pick')).toEqual([]);
  });

  it('is waiting once a question is taken away', () => {
    deliver({ kind: 'ask', ask: null });
    expectWaiting();
    expect(handClasses()).toEqual(['', '', '', '', '', '']);
  });
});

describe('the Sanguosha page: the other questions', () => {
  beforeEach(() => {
    deliver(state(table(), { hand: HAND }));
  });

  const cardsAsk = (min: number, max: number): SgsOut => ({
    kind: 'ask',
    ask: {
      k: 'cards', title: 'Which?', why: 'discard', min, max,
      cards: [c(2, 'shan', 'heart', 2), c(8, 'shan', 'club', 3), c(9, 'tao', 'heart', 4)],
    },
  });
  const offered = (): string[] => all('#prompt .offer .card').map((e) => (e.classList.contains('sel') ? 'sel' : 'ok'));

  it('offers cards to choose from, one at most, and lets the user pass', () => {
    deliver(cardsAsk(0, 1));
    expect($('#prompt .q').textContent).toBe('Which?');
    expect(labels('#prompt .offer .cn')).toEqual([T.card_shan, T.card_shan, T.card_tao]);
    expect(offered()).toEqual(['ok', 'ok', 'ok']);
    expect(labels('#prompt button')).toEqual([T.ok, T.pass]);
    nth('#prompt .offer .card', 0).click();
    nth('#prompt .offer .card', 1).click();
    expect(offered()).toEqual(['ok', 'sel', 'ok']);
    nth('#prompt .offer .card', 1).click();
    expect(offered()).toEqual(['ok', 'ok', 'ok']);
    nth('#prompt .offer .card', 2).click();
    button(T.ok).click();
    expect(sentReply()).toEqual({ k: 'cards', ids: [9] });
    expectWaiting();
  });

  it('passes with no cards', () => {
    deliver(cardsAsk(0, 1));
    nth('#prompt .offer .card', 0).click();
    button(T.pass).click();
    expect(sentReply()).toEqual({ k: 'cards', ids: [] });
  });

  it('wants as many cards as it asks for, with no way to pass', () => {
    deliver(cardsAsk(2, 2));
    expect(labels('#prompt button')).toEqual([T.ok]);
    expect(button(T.ok).disabled).toBe(true);
    nth('#prompt .offer .card', 2).click();
    expect(button(T.ok).disabled).toBe(true);
    nth('#prompt .offer .card', 0).click();
    expect(button(T.ok).disabled).toBe(false);
    nth('#prompt .offer .card', 1).click();
    expect(offered()).toEqual(['sel', 'ok', 'sel']);
    nth('#prompt .offer .card', 2).click();
    nth('#prompt .offer .card', 1).click();
    button(T.ok).click();
    expect(sentReply()).toEqual({ k: 'cards', ids: [2, 8] });
  });

  const seatAsk = (min: number, max: number, options: number[]): SgsOut => ({
    kind: 'ask', ask: { k: 'seat', title: 'Whose cards?', options, min, max },
  });

  it('asks for several seats, any number up to the most', () => {
    deliver(seatAsk(0, 2, [1, 2, 3]));
    expect(labels('#prompt .sub')).toEqual([fill(T.pickTargets, 2)]);
    expect(labels('#prompt button')).toEqual([T.ok, T.pass]);
    expect(marked('pick')).toEqual([1, 2, 3]);
    oppSeat(1).click();
    oppSeat(3).click();
    oppSeat(2).click();
    expect(marked('picked')).toEqual([1, 3]);
    expect(marked('pick')).toEqual([2]);
    button(T.ok).click();
    expect(sentReply()).toEqual({ k: 'seat', seats: [1, 3] });
  });

  it('can pass on the seats', () => {
    deliver(seatAsk(0, 2, [1, 2, 3]));
    oppSeat(1).click();
    button(T.pass).click();
    expect(sentReply()).toEqual({ k: 'seat', seats: [] });
  });

  it('asks for one seat, and needs OK for it', () => {
    deliver(seatAsk(1, 1, [2, 3]));
    expect(labels('#prompt .sub')).toEqual([T.pickTarget]);
    expect(labels('#prompt button')).toEqual([T.ok]);
    expect(button(T.ok).disabled).toBe(true);
    oppSeat(2).click();
    expect(sent).toHaveLength(0);
    oppSeat(3).click();
    expect(marked('picked')).toEqual([3]);
    button(T.ok).click();
    expect(sentReply()).toEqual({ k: 'seat', seats: [3] });
  });

  const areaAsk = (hand: number): SgsOut => ({
    kind: 'ask',
    ask: {
      k: 'area', title: 'Take which?', owner: 2, hand, equip: [c(10, 'zhuge', 'club', 1), c(11, 'dilu', 'heart', 5)],
      judges: [{ as: 'lebu', card: c(12, 'sha', 'heart', 9) }],
    },
  });

  it('shows a seat’s hand as one hidden card, and its equipment and waiting tricks as what they are', () => {
    deliver(areaAsk(3));
    const cards = all('#prompt .offer .card');
    expect(cards).toHaveLength(4);
    expect(cards[0]?.classList.contains('back')).toBe(true);
    expect(cards[0]?.textContent).toBe('3');
    expect(cards[0]?.title).toBe(T.hiddenCard);
    expect(labels('#prompt .offer .cn').slice(1)).toEqual([T.card_zhuge, T.card_dilu, T.card_lebu]);
    expect(labels('#prompt .offer .cs')).toEqual(['♣A', '♥5', '♥9']);
    expect(all('#prompt button')).toHaveLength(0);
  });

  it('takes a card from the hand, the equipment or the waiting tricks', () => {
    const takes: [number, Reply][] = [
      [0, { k: 'area', zone: 'hand', card: null }],
      [1, { k: 'area', zone: 'equip', card: 10 }],
      [2, { k: 'area', zone: 'equip', card: 11 }],
      [3, { k: 'area', zone: 'judge', card: 12 }],
    ];
    for (const [i, want] of takes) {
      sent.length = 0;
      deliver(areaAsk(3));
      nth('#prompt .offer .card', i).click();
      expect(sentReply()).toEqual(want);
      expectWaiting();
    }
  });

  it('shows no hidden card for a seat with no hand', () => {
    deliver(areaAsk(0));
    expect(all('#prompt .offer .card.back')).toHaveLength(0);
    expect(all('#prompt .offer .card')).toHaveLength(3);
  });

  it('asks yes or no', () => {
    deliver({ kind: 'ask', ask: { k: 'confirm', title: 'Use it?' } });
    expect($('#prompt .q').textContent).toBe('Use it?');
    expect(labels('#prompt button')).toEqual([T.yes, T.no]);
    button(T.yes).click();
    expect(sentReply()).toEqual({ k: 'confirm', yes: true });

    sent.length = 0;
    deliver({ kind: 'ask', ask: { k: 'confirm', title: 'Use it?' } });
    button(T.no).click();
    expect(sentReply()).toEqual({ k: 'confirm', yes: false });
  });

  it('offers heroes with their kingdom, hit points and skills, and sends the one that is clicked', () => {
    const heroes: HeroId[] = ['liubei', 'caocao', 'sunquan', 'lvbu', 'huatuo'];
    deliver({ kind: 'ask', ask: { k: 'hero', title: 'Choose a hero.', heroes: heroes.map((h) => heroInfo(h, true)) } });
    expect($('#prompt .q').textContent).toBe('Choose a hero.');
    expect(labels('#prompt .hero .hn')).toEqual(heroes.map((h) => `${T[`hero_${h}`]} · ${T[`kingdom_${HEROES[h].kingdom}`]}`));
    expect(nth('#prompt .hero', 0).querySelectorAll('.hp i.f')).toHaveLength(5);
    expect(nth('#prompt .hero', 1).querySelectorAll('.hp i.f')).toHaveLength(5);
    expect(labels('#prompt .hero:nth-child(1) .sk')).toEqual([`${T.skill_rende}: ${T.skillTip_rende}`]);
    expect(labels('#prompt .hero:nth-child(5) .sk')).toEqual([
      `${T.skill_qingnang}: ${T.skillTip_qingnang}`, `${T.skill_jijiu}: ${T.skillTip_jijiu}`,
    ]);
    nth('#prompt .hero', 3).click();
    expect(sentReply()).toEqual({ k: 'hero', hero: 'lvbu' });
    expectWaiting();
  });
});

describe('the Sanguosha page: the end of the game', () => {
  const over = (): SgsOut => ({
    kind: 'over', win: true, winner: 'lord', title: 'Victory!', text: 'The lord has won.\n1. Pet1 Lord\n2. You Rebel',
  });

  it('shows who won and how, and offers another game', () => {
    deliver(state(table(), { hand: HAND }));
    deliver(over());
    expect($('#over').textContent).toBe('Victory!');
    expect($('#overText').textContent).toBe('The lord has won.\n1. Pet1 Lord\n2. You Rebel');
    expect(labels('#prompt button')).toEqual([T.again]);
    button(T.again).click();
    expect(sentOnce()).toEqual({ t: 'again' });
  });

  it('takes the place of a question that was open', () => {
    deliver(state(table(), { hand: HAND }));
    deliver({ kind: 'ask', ask: { k: 'confirm', title: 'Use it?' } });
    deliver(over());
    expect(all('#prompt .q')).toHaveLength(0);
    expect(labels('#prompt button')).toEqual([T.again]);
    expect(handClasses().every((s) => s === '')).toBe(true);
  });

  it('stays on the screen when the table is shown again, and goes with the next lobby', () => {
    deliver(state(table(), { hand: HAND }));
    deliver(over());
    deliver(state(table(5, (n) => (n === 1 ? { alive: false, hp: 0 } : {})), { hand: HAND }));
    expect($('#over').textContent).toBe('Victory!');
    deliver(lobbyOf());
    expect(document.querySelector('#over')).toBeNull();
    expect($('#game').hidden).toBe(true);
    expect($('#lobby').hidden).toBe(false);
  });

  it('says what the other side won, and that a game was called off', () => {
    deliver(state(table()));
    deliver({ kind: 'over', win: false, winner: 'rebel', title: 'Defeat.', text: 'The rebels win.' });
    expect($('#over').textContent).toBe('Defeat.');
    deliver({ kind: 'over', win: false, winner: null, title: 'Called off.', text: '1. Pet1 Lord' });
    expect($('#over').textContent).toBe('Called off.');
    expect($('#overText').textContent).toBe('1. Pet1 Lord');
  });
});

describe('the Sanguosha page: the words it reads', () => {
  const own = SANGUOSHA_PAGE.slice(SANGUOSHA_PAGE.indexOf('const KIND='));
  const PHASES: readonly Phase[] = ['start', 'judge', 'draw', 'play', 'discard', 'end'];
  const ROLES: readonly Role[] = ['lord', 'loyalist', 'rebel', 'traitor'];
  const FAMILIES: Record<string, readonly string[]> = {
    card_: CARD_NAMES, tip_: CARD_NAMES, skill_: SKILLS, skillTip_: SKILLS, hero_: HERO_IDS, kingdom_: KINGDOMS,
    role_: ROLES, roleHint_: ROLES, phase_: PHASES,
  };

  it('starts reading the script of the table itself, after the lobby’s', () => {
    expect(own.startsWith('const KIND=')).toBe(true);
    expect(own).toContain('gameApi.onMsg');
  });

  it.each(LANGS)('reads only single words that the text module has, in %s', (lang) => {
    const direct = new Set([...own.matchAll(/\bT\.(\w+)/g)].map((m) => m[1] as string));
    expect(direct.size).toBeGreaterThan(15);
    const text = sanguoshaText(gamesOf(lang));
    for (const key of direct) expect(text[key], `T.${key}`).toBeTruthy();
  });

  it.each(LANGS)('reads only the families of words that it knows, each in full, in %s', (lang) => {
    const prefixes = new Set([...own.matchAll(/\bT\['(\w+_)'\+/g)].map((m) => m[1] as string));
    expect([...prefixes].sort()).toEqual(Object.keys(FAMILIES).sort());
    const text = sanguoshaText(gamesOf(lang));
    for (const [prefix, ids] of Object.entries(FAMILIES)) {
      for (const id of ids) expect(text[`${prefix}${id}`], `${prefix}${id}`).toBeTruthy();
    }
  });

  it.each(LANGS)('shows no missing word anywhere at a full table, in %s', (lang) => {
    const text = textOf(lang);
    deliver(lobbyOf(lang));
    const deck = CARD_NAMES.map((name, i) => c(i + 1, name, SUITS[i % 4] ?? 'spade', (i % 13) + 1));
    const by = (name: CardName): CardView => deck.find((x) => x.name === name) ?? c(0, name);
    deliver(state(table(8, (n) => {
      if (n === 0) return { equip: [by('zhuge'), by('bagua'), by('dilu'), by('chitu')] };
      if (n === 2) return { alive: false, hp: 0, hand: 0, dist: 0 };
      if (n === 3) {
        return { judges: [{ as: 'lebu', card: by('sha') }, { as: 'bing', card: by('shan') }, { as: 'shandian', card: by('tao') }] };
      }
      return {};
    }), { hand: deck, pile: 12, turns: 12, turn: 3, phase: 'discard' }));
    const shown = (): string => `${document.body.textContent ?? ''}\n${all('[title]').map((e) => e.title).join('\n')}`;
    const bad = /undefined|NaN|\[object|[{}]/;
    expect(shown()).not.toMatch(bad);
    expect(labels('#hand .cn')).toEqual(CARD_NAMES.map((n) => text[`card_${n}`]));
    expect(all('#hand .card').map((e) => e.title)).toEqual(CARD_NAMES.map((n) => `${text[`card_${n}`]}: ${text[`tip_${n}`]}`));
    expect(labels('#hand .cs').every((s) => /^[♠♥♣♦](A|10|[2-9]|J|Q|K)$/.test(s))).toBe(true);

    deliver({ kind: 'ask', ask: { k: 'hero', title: 'Choose.', heroes: HERO_IDS.map((h) => heroInfo(h, false)) } });
    expect(shown()).not.toMatch(bad);
    expect(labels('#prompt .hero .hn')).toEqual(HERO_IDS.map((h) => `${text[`hero_${h}`]} · ${text[`kingdom_${HEROES[h].kingdom}`]}`));
    expect(all('#prompt .hero .sk').every((e) => /\S: \S/.test(e.textContent ?? ''))).toBe(true);

    deliver({ kind: 'ask', ask: { k: 'seat', title: 'Whose?', options: [1, 2], min: 0, max: 2 } });
    expect(shown()).not.toMatch(bad);
    deliver({ kind: 'ask', ask: { k: 'play', title: 'Go.', uses: USES, skills: SKILL_OPTS } });
    expect(shown()).not.toMatch(bad);
    nth('#hand .card', 2).click();
    expect(shown()).not.toMatch(bad);
    deliver({ kind: 'over', win: false, winner: 'rebel', title: 'Done.', text: 'Text.' });
    expect(shown()).not.toMatch(bad);
    const buttons = all('button').filter((b) => b.closest('[hidden]') === null);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => (b.textContent ?? '').trim() !== '')).toBe(true);
  });
});
