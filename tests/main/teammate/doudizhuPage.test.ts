// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DOUDIZHU_PAGE } from '../../../src/main/teammate/doudizhuPage';
import {
  parseDdzIn, type DdzIn, type DdzOut, type DdzPhase, type DdzSeat, type DdzShown, type GameApi,
} from '../../../src/shared/gameIpc';
import { strings } from '../../../src/shared/i18n';
import {
  BIG, SMALL, SUITS, buildDeck, sortHand, type Card, type Suit,
} from '../../../src/shared/teammate/doudizhuCards';
import { doudizhuText } from '../../../src/shared/teammate/doudizhuText';
import { MAX_DOUBLINGS, SIZES, type Role, type Size } from '../../../src/shared/teammate/doudizhuTypes';
import { lobbyChoices } from '../../../src/shared/teammate/gameText';
import { PET_IDS, type PetId } from '../../../src/shared/teammate/pet';

const LANGS = ['en', 'zh-CN'] as const;
type Lang = (typeof LANGS)[number];
const gamesOf = (lang: Lang) => strings(lang, 'win').teammate.games;
const namesOf = (lang: Lang) => strings(lang, 'win').teammate.ask.petName;

/** The words the page reads, so that a word that is misspelt here is an error and not an `undefined`. */
type Words = Record<
  | 'again' | 'thinking' | 'yourTurn' | 'waiting' | 'pickHint' | 'noHint' | 'stake' | 'called' | 'calledTip' | 'holes'
  | 'count' | 'pass' | 'play' | 'hint' | 'clear' | 'bidNone' | 'bidOf' | 'smallJoker' | 'bigJoker'
  | `role_${Role | 'unknown' | 'hidden'}` | `roleHint_${Role | 'hidden'}` | `phase_${DdzPhase}`,
  string
>;
const textOf = (lang: Lang): Words => doudizhuText(gamesOf(lang)) as Words;

const g = gamesOf('en');
const W = g.doudizhu;
const T = textOf('en');
const withN = (text: string, n: number): string => text.replace('{n}', String(n));
const bidOf = (n: number): string => withN(T.bidOf, n);
const stakeOf = (base: number, mult: number): string =>
  T.stake.replace('{base}', String(base)).replace('{mult}', String(mult));

const lobbyOf = (lang: Lang = 'en', picked: readonly PetId[] = [], minds = false): DdzOut => ({
  kind: 'lobby', text: doudizhuText(gamesOf(lang)), choices: lobbyChoices(picked, namesOf(lang)), seats: 5,
  watchSeats: 5, minds, sizes: [...SIZES],
});

let deliver: (msg: DdzOut) => void = () => undefined;
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
  const script = /<script>([\s\S]*)<\/script>/.exec(DOUDIZHU_PAGE)?.[1];
  if (script === undefined) throw new Error('The page has no script.');
  document.documentElement.innerHTML = DOUDIZHU_PAGE.replace(/<script>[\s\S]*<\/script>/, '');
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

/** A message the page sent, as the room would read it: one it would refuse is an error here. */
const parsed = (raw: unknown): DdzIn => {
  const m = parseDdzIn(raw);
  if (!m) throw new Error(`The page sent a message the room would refuse: ${JSON.stringify(raw)}`);
  return m;
};
const sentOnce = (): DdzIn => {
  expect(sent).toHaveLength(1);
  return parsed(sent[0]);
};
const lastSent = (): DdzIn => {
  const m = sent[sent.length - 1];
  if (m === undefined) throw new Error('Nothing was sent.');
  return parsed(m);
};

/** The cards of the first pack: a card's id is its suit's place times 13 plus its rank, the jokers 52 and 53. */
const pip = (rank: number, suit: Suit): Card => ({ id: SUITS.indexOf(suit) * 13 + rank, rank, suit });
const SMALL_JOKER: Card = { id: 52, rank: SMALL, suit: null };
const BIG_JOKER: Card = { id: 53, rank: BIG, suit: null };
const TWO_S = pip(12, 'spade');
const KING_H = pip(10, 'heart');
const KING_D = pip(10, 'diamond');
const NINE_C = pip(6, 'club');
const NINE_S = pip(6, 'spade');
const FOUR_D = pip(1, 'diamond');
/** Highest first, as the room sends it. */
const HAND: Card[] = [BIG_JOKER, SMALL_JOKER, TWO_S, KING_H, KING_D, NINE_C, NINE_S, FOUR_D];

/** The user is `You` and the others `Pet<seat>`, whatever seat the user sits in. */
const seat = (n: number, me: number, over: Partial<DdzSeat> = {}): DdzSeat => ({
  seat: n, id: n === me ? 'user' : (PET_IDS[n - 1] ?? 'whale'), name: n === me ? 'You' : `Pet${n}`, color: '#336699',
  me: n === me, role: null, hidden: false, cards: 17, shown: null, ...over,
});
const table = (size: Size = 3, over: (n: number) => Partial<DdzSeat> = () => ({}), me = 0): DdzSeat[] =>
  Array.from({ length: size }, (_, n) => seat(n, me, over(n)));

type State = Extract<DdzOut, { kind: 'state' }>;
const state = (seats: DdzSeat[], over: Partial<State> = {}): DdzOut => ({
  kind: 'state', size: seats.length as Size, seats, hand: [], phase: 'play', turn: 0, top: null, base: 1, bombs: 0,
  call: null, holes: [], ...over,
});
/** The sides are known to the user once the landlord is decided: the user a farmer, the first of the others the landlord. */
const sides = (n: number): Partial<DdzSeat> => ({ role: n === 1 ? 'landlord' : 'farmer' });

const seatNo = (e: HTMLElement): number => {
  const name = e.querySelector('.nm')?.textContent ?? '';
  return name === 'You' ? 0 : Number(name.slice(3));
};
/** The seats, the user's own among them, that are marked `cls`. */
const marked = (cls: string): number[] => all(`.seat.${cls}`).map(seatNo).sort((a, b) => a - b);
const oppSeat = (n: number): HTMLElement => {
  const s = all('#opps .seat').find((e) => seatNo(e) === n);
  if (!s) throw new Error(`No seat ${n}`);
  return s;
};
const handCard = (id: number): HTMLElement => {
  const e = all('#hand .card').find((x) => x.dataset.id === String(id));
  if (!e) throw new Error(`No card ${id}`);
  return e;
};
const pick = (...ids: number[]): void => {
  for (const id of ids) handCard(id).click();
};
const handClasses = (): string[] => all('#hand .card').map((e) => {
  const has = (k: string) => e.classList.contains(k);
  return has('sel') ? 'sel' : has('ok') ? 'ok' : '';
});
const picked = (): number[] => all('#hand .card.sel').map((e) => Number(e.dataset.id));
const expectWaiting = (): void => {
  expect(labels('#prompt .sub')).toEqual([T.waiting]);
  expect(all('#prompt button')).toHaveLength(0);
};

const bidAsk = (min = 1, max = 3, title = 'Bid for the landlord.'): DdzOut => ({ kind: 'ask', ask: { k: 'bid', min, max, title } });
const playAsk = (lead = false, title = lead ? 'You lead.' : 'Beat Pet1’s pair.'): DdzOut =>
  ({ kind: 'ask', ask: { k: 'play', lead, title } });

describe('the Dou Dizhu page: the lobby', () => {
  it('shows the lobby first, with the sizes of table to pick from and no choice of watching', () => {
    expect($('#lobby').hidden).toBe(false);
    expect($('#game').hidden).toBe(true);
    expect(document.title).toBe(W.title);
    expect($('#lTitle').textContent).toBe(W.title);
    expect($('#lRules').textContent).toBe(W.rules);
    expect($('#lMode').hidden).toBe(true);
    expect($('#lSize').hidden).toBe(false);
    expect(labels('#lSize label')).toEqual([W.size3, W.size4, W.size5, W.size6]);
    expect(all('#lSize input').map((r) => (r as HTMLInputElement).checked)).toEqual([true, false, false, false]);
    expect(all('#lGrid label')).toHaveLength(PET_IDS.length);
    expect($('#lMinds').textContent).toBe(g.mindsOff);
    expect($('#lStart').textContent).toBe(g.start);
  });

  it('says in the lobby whether the pets think with Copilot CLI or play by simple rules, in both languages', () => {
    for (const lang of LANGS) {
      const words = gamesOf(lang);
      deliver(lobbyOf(lang, [], true));
      expect($('#lMinds').textContent).toBe(words.doudizhu.minds);
      expect($('#lMinds').textContent).toContain('Copilot CLI');
      deliver(lobbyOf(lang, [], false));
      expect($('#lMinds').textContent).toBe(words.mindsOff);
    }
  });

  it('says in the lobby that the tables of four, five and six are this app’s own, with no official art', () => {
    expect($('#lRules').textContent).toMatch(/own variants/);
    expect($('#lRules').textContent).toMatch(/no official art/);
    deliver(lobbyOf('zh-CN'));
    expect($('#lRules').textContent).toContain('自拟的变体');
    expect($('#lRules').textContent).toContain('没有官方美术');
  });

  it('lets the size of the table set how many pets may sit with the user', () => {
    expect($('#lPick').textContent).toBe(withN(W.pick, 2));
    const classes = (): string[] => all('#lSize label').map((l) => l.className);
    expect(classes()).toEqual(['on', '', '', '']);
    for (const [i, pets] of [[1, 3], [2, 4], [3, 5], [0, 2]] as const) {
      nth('#lSize input', i).click();
      expect($('#lPick').textContent).toBe(withN(W.pick, pets));
      expect(classes()).toEqual([0, 1, 2, 3].map((k) => (k === i ? 'on' : '')));
    }
  });

  it('starts a table of three with the pets that were on, at most two', () => {
    deliver(lobbyOf('en', PET_IDS));
    const boxes = all('#lGrid input') as HTMLInputElement[];
    expect(boxes.filter((b) => b.checked)).toHaveLength(2);
    expect(boxes.filter((b) => b.disabled)).toHaveLength(PET_IDS.length - 2);
    $('#lStart').click();
    expect(sentOnce()).toEqual({ t: 'start', pets: PET_IDS.slice(0, 2), size: 3 });
  });

  it('starts a table of six with up to five pets, and drops the extra ones when the user goes back to three', () => {
    deliver(lobbyOf('en', PET_IDS));
    const boxes = all('#lGrid input') as HTMLInputElement[];
    nth('#lSize input', 3).click();
    expect(boxes.filter((b) => b.checked)).toHaveLength(2);
    expect(boxes.some((b) => b.disabled)).toBe(false);
    for (const b of boxes.filter((x) => !x.checked).slice(0, 3)) b.click();
    expect(boxes.filter((b) => b.checked)).toHaveLength(5);
    expect(boxes.filter((b) => !b.checked).every((b) => b.disabled)).toBe(true);
    $('#lStart').click();
    expect(sentOnce()).toEqual({ t: 'start', pets: PET_IDS.slice(0, 5), size: 6 });

    sent.length = 0;
    nth('#lSize input', 0).click();
    expect(boxes.filter((b) => b.checked)).toHaveLength(2);
    $('#lStart').click();
    expect(sentOnce()).toEqual({ t: 'start', pets: PET_IDS.slice(0, 2), size: 3 });
  });

  it('starts every size of table with a message the room accepts', () => {
    deliver(lobbyOf('en', PET_IDS));
    SIZES.forEach((size, i) => {
      nth('#lSize input', i).click();
      sent.length = 0;
      $('#lStart').click();
      const m = sentOnce();
      expect(m.t).toBe('start');
      if (m.t === 'start') {
        expect(m.size).toBe(size);
        expect(m.pets.length).toBeLessThanOrEqual(size - 1);
      }
    });
  });

  it('starts with no pets when none were picked, and the room fills the seats', () => {
    $('#lStart').click();
    expect(sentOnce()).toEqual({ t: 'start', pets: [], size: 3 });
  });

  it('speaks the language it is sent', () => {
    deliver(lobbyOf('zh-CN'));
    const zh = gamesOf('zh-CN').doudizhu;
    expect(zh.title).not.toBe(W.title);
    expect(document.title).toBe(zh.title);
    expect(labels('#lSize label')).toEqual([zh.size3, zh.size4, zh.size5, zh.size6]);
    expect($('#lPick').textContent).toBe(withN(zh.pick, 2));
    expect($('#lMinds').textContent).toBe(gamesOf('zh-CN').mindsOff);
  });
});

describe('the Dou Dizhu page: the table', () => {
  it('replaces the lobby with the game, and says in the bar whose turn it is, the phase, the stake and the role', () => {
    deliver(state(table(3, sides), { turn: 1, base: 2, bombs: 2 }));
    expect($('#lobby').hidden).toBe(true);
    expect($('#game').hidden).toBe(false);
    expect($('#who').textContent).toBe('Pet1');
    expect($('#phase').textContent).toBe(T.phase_play);
    expect($('#stake').textContent).toBe(stakeOf(2, 4));
    expect($('#mine').textContent).toBe(T.role_farmer);
    expect($('#mine').title).toBe(T.roleHint_farmer);
  });

  it('says that it is the user’s turn when it is, and marks his seat', () => {
    deliver(state(table(3, sides), { turn: 0 }));
    expect($('#who').textContent).toBe(T.yourTurn);
    expect(marked('turn')).toEqual([0]);
  });

  it('marks the seat whose turn it is, among the others', () => {
    deliver(state(table(5, sides), { turn: 3 }));
    expect(marked('turn')).toEqual([3]);
    deliver(state(table(5, sides), { turn: 4 }));
    expect(marked('turn')).toEqual([4]);
  });

  it('says nothing of whose turn it is when it is nobody’s, or when the game is over', () => {
    deliver(state(table(3, sides), { turn: null }));
    expect($('#who').textContent).toBe('');
    expect(marked('turn')).toEqual([]);
    deliver(state(table(3, sides), { turn: 1, phase: 'over' }));
    expect($('#who').textContent).toBe('');
    expect(marked('turn')).toEqual([]);
    expect($('#phase').textContent).toBe(T.phase_over);
  });

  it('says the phase in words', () => {
    for (const phase of ['bid', 'play', 'over'] as const) {
      deliver(state(table(3, sides), { phase }));
      expect($('#phase').textContent).toBe(T[`phase_${phase}`]);
    }
    expect(new Set(['bid', 'play', 'over'].map((p) => T[`phase_${p as DdzPhase}`])).size).toBe(3);
  });

  it('shows the stake only once a side is known and the bidding is over, the bombs doubling it up to the limit', () => {
    deliver(state(table(3), { phase: 'play', base: 3 }));
    expect($('#stake').textContent).toBe('');
    deliver(state(table(3, sides), { phase: 'bid', base: 3 }));
    expect($('#stake').textContent).toBe('');
    for (const [bombs, mult] of [[0, 1], [1, 2], [3, 8], [MAX_DOUBLINGS, 2 ** MAX_DOUBLINGS], [MAX_DOUBLINGS + 3, 2 ** MAX_DOUBLINGS]]) {
      deliver(state(table(3, sides), { base: 3, bombs: bombs ?? 0 }));
      expect($('#stake').textContent, `${bombs} bombs`).toBe(stakeOf(3, mult ?? 1));
    }
  });

  it.each(SIZES)('lists the others clockwise from the one after the user, at a table of %i', (size) => {
    for (const me of [0, 1, Math.floor(size / 2), size - 1]) {
      deliver(state(table(size, () => ({}), me)));
      const others = Array.from({ length: size - 1 }, (_, k) => (me + 1 + k) % size);
      expect(labels('#opps .seat .nm')).toEqual(others.map((n) => `Pet${n}`));
      expect($('#meSeat .nm').textContent).toBe('You');
      expect(all('#opps .seat.me')).toHaveLength(0);
      expect(all('#meSeat .seat.me')).toHaveLength(1);
    }
  });

  it('shows what is known of each seat: its side, the cards it has left, its name and its colour', () => {
    deliver(state(table(5, (n) => (n === 1 ? { role: 'landlord', cards: 20, color: '#aa3300' } : { role: 'farmer', cards: n === 2 ? 1 : 17 }))));
    const lord = oppSeat(1);
    expect(labels('#opps .seat:nth-child(1) .tg')).toEqual([T.role_landlord]);
    expect(lord.querySelector('.tg')?.className).toBe('tg r-landlord');
    expect(lord.querySelector('.st')?.textContent).toBe(withN(T.count, 20));
    expect(oppSeat(2).querySelector('.st')?.textContent).toBe(withN(T.count, 1));
    expect(oppSeat(2).querySelector('.tg')?.className).toBe('tg r-farmer');
    expect(lord.querySelector('.av')?.textContent).toBe('P');
    expect((lord.querySelector('.av') as HTMLElement).style.background).toBe('rgb(170, 51, 0)');
    expect(lord.querySelector('.nm')?.textContent).toBe('Pet1');
    expect(labels('#meSeat .tg')).toEqual([T.role_farmer]);
  });

  it('keeps a side that is not known off the seat, and says that it is unknown once any side is known', () => {
    deliver(state(table(5)));
    expect(all('.tg')).toHaveLength(0);
    expect($('#mine').textContent).toBe('');
    expect($('#mine').title).toBe('');

    deliver(state(table(5, (n) => (n === 0 ? { role: 'farmer' } : n === 1 ? { role: 'landlord' } : {}))));
    expect(all('#opps .seat').map((s) => s.querySelector('.tg')?.className)).toEqual([
      'tg r-landlord', 'tg r-unknown', 'tg r-unknown', 'tg r-unknown',
    ]);
    expect(labels('#opps .seat:nth-child(2) .tg')).toEqual([T.role_unknown]);
  });

  it('shows the user’s own landlord, whom nobody knows yet, as hidden, in his seat and in the bar', () => {
    deliver(state(table(5, (n) => (n === 0 ? { role: 'landlord', hidden: true } : {}))));
    expect(labels('#meSeat .tg')).toEqual([T.role_hidden]);
    expect($('#meSeat .tg').className).toBe('tg r-hidden');
    expect($('#mine').textContent).toBe(T.role_hidden);
    expect($('#mine').title).toBe(T.roleHint_hidden);
    expect(labels('#opps .seat:nth-child(1) .tg')).toEqual([T.role_unknown]);
    deliver(state(table(5, (n) => (n === 0 ? { role: 'landlord' } : {}))));
    expect($('#mine').textContent).toBe(T.role_landlord);
    expect($('#mine').title).toBe(T.roleHint_landlord);
    // A hidden side counts as a known one even when the room sends no role with it.
    deliver(state(table(5, (n) => (n === 0 ? { hidden: true } : {})), { base: 3 }));
    expect($('#mine').textContent).toBe(T.role_hidden);
    expect(labels('#opps .seat:nth-child(1) .tg')).toEqual([T.role_unknown]);
    expect($('#stake').textContent).toBe(stakeOf(3, 1));
  });

  it('shows what each seat last did: a bid, no bid, a pass, or the cards it played and what they are called', () => {
    const pair: DdzShown = { k: 'play', cards: [pip(0, 'spade'), pip(0, 'heart')], label: 'Pair of 3s', bomb: false };
    const shown: Record<number, DdzShown> = { 1: { k: 'bid', bid: 2 }, 2: { k: 'bid', bid: 0 }, 3: { k: 'pass' }, 4: pair };
    deliver(state(table(5, (n) => ({ shown: shown[n] ?? null }))));
    const mark = (n: number): HTMLElement => {
      const e = oppSeat(n).querySelector<HTMLElement>('.shown .mark');
      if (!e) throw new Error(`No mark at seat ${n}`);
      return e;
    };
    expect([mark(1).textContent, mark(1).className]).toEqual([bidOf(2), 'mark']);
    expect([mark(2).textContent, mark(2).className]).toEqual([T.bidNone, 'mark dim']);
    expect([mark(3).textContent, mark(3).className]).toEqual([T.pass, 'mark dim']);
    expect([mark(4).textContent, mark(4).className]).toEqual(['Pair of 3s', 'mark']);
    const chips = [...oppSeat(4).querySelectorAll<HTMLElement>('.shown .chip')];
    expect(chips.map((e) => e.textContent)).toEqual(['♠3', '♥3']);
    expect(chips.map((e) => e.classList.contains('red'))).toEqual([false, true]);
    expect(chips.map((e) => e.title)).toEqual(['♠3', '♥3']);
    expect(oppSeat(1).querySelectorAll('.shown .chip')).toHaveLength(0);
    expect($('#meSeat .shown').children).toHaveLength(0);
  });

  it('shows the jokers as stars with their names, the big one in red, and marks a bomb or a rocket', () => {
    deliver(state(table(5, (n) => (n === 1
      ? { shown: { k: 'play', cards: [SMALL_JOKER, BIG_JOKER], label: 'Rocket', bomb: true } }
      : n === 2
        ? { shown: { k: 'play', cards: [pip(4, 'club'), pip(4, 'diamond'), pip(4, 'spade'), pip(4, 'heart')], label: 'Bomb of 7s', bomb: true } }
        : n === 3 ? { shown: { k: 'play', cards: [pip(9, 'club')], label: 'Single', bomb: false } } : {}))));
    const chips = [...oppSeat(1).querySelectorAll<HTMLElement>('.shown .chip')];
    expect(chips.map((e) => e.textContent)).toEqual(['☆', '★']);
    expect(chips.map((e) => e.title)).toEqual([T.smallJoker, T.bigJoker]);
    expect(chips.map((e) => e.classList.contains('red'))).toEqual([false, true]);
    for (const n of [1, 2]) {
      expect(oppSeat(n).querySelector('.shown')?.classList.contains('bomb'), `seat ${n}`).toBe(true);
      expect(oppSeat(n).querySelector('.mark')?.classList.contains('bomb'), `seat ${n}`).toBe(true);
    }
    expect(oppSeat(3).querySelector('.shown')?.classList.contains('bomb')).toBe(false);
    expect(oppSeat(3).querySelector('.mark')?.classList.contains('bomb')).toBe(false);
  });

  it('marks the seat whose play is on the table for the others to beat, and nobody’s at a lead', () => {
    deliver(state(table(5, sides), { top: 2 }));
    expect(all('.shown.top')).toHaveLength(1);
    expect(seatNo(all('.shown.top')[0]?.closest('.seat') as HTMLElement)).toBe(2);
    deliver(state(table(5, sides), { top: 0 }));
    expect(all('.shown.top')).toHaveLength(1);
    expect($('#meSeat .shown').classList.contains('top')).toBe(true);
    deliver(state(table(5, sides), { top: null }));
    expect(all('.shown.top')).toHaveLength(0);
  });

  it('shows the user’s hand as it is sent: rank and suit, red cards in red, the jokers by name', () => {
    deliver(state(table(3, sides), { hand: HAND }));
    const cards = all('#hand .card');
    expect(cards.map((e) => e.dataset.id)).toEqual(HAND.map((c) => String(c.id)));
    expect(cards.map((e) => e.textContent)).toEqual([T.bigJoker, T.smallJoker, '2♠', 'K♥', 'K♦', '9♣', '9♠', '4♦']);
    expect(cards.map((e) => e.classList.contains('red'))).toEqual([true, false, false, true, true, false, false, true]);
    expect(cards.map((e) => e.classList.contains('joker'))).toEqual([true, true, false, false, false, false, false, false]);
    expect(cards.map((e) => e.title)).toEqual([T.bigJoker, T.smallJoker, '', '', '', '', '', '']);
    expect(handClasses()).toEqual(HAND.map(() => ''));
  });

  it('squeezes a hand of more than 22 cards closer together', () => {
    const hand = (n: number): Card[] => sortHand(buildDeck(3)).slice(0, n);
    const overlap = (): string => $('#hand').style.getPropertyValue('--ov');
    deliver(state(table(6, sides), { hand: hand(22) }));
    expect(overlap()).toBe('32px');
    deliver(state(table(6, sides), { hand: hand(23) }));
    expect(overlap()).toBe('26px');
    deliver(state(table(6, sides), { hand: hand(27) }));
    expect(all('#hand .card')).toHaveLength(27);
    expect(overlap()).toBe('26px');
  });

  it('shows the called card and the cards taken from the bottom in the bar', () => {
    deliver(state(table(5, sides), { call: pip(5, 'heart'), holes: [pip(1, 'spade'), pip(2, 'club'), SMALL_JOKER] }));
    expect(labels('#call .chip')).toEqual(['♥8']);
    expect($('#call').textContent).toBe(`${T.called}:♥8`);
    expect($('#call').title).toBe(T.calledTip);
    expect(labels('#holes .chip')).toEqual(['♠4', '♣5', '☆']);
    expect($('#holes').textContent).toBe(`${T.holes}:♠4♣5☆`);
    deliver(state(table(5, sides)));
    expect($('#call').textContent).toBe('');
    expect($('#call').title).toBe('');
    expect($('#holes').textContent).toBe('');
  });

  it('copes with a table before the cards are dealt: no hand, no side, nobody’s turn', () => {
    deliver(state(table(3, () => ({ cards: 0 })), { phase: 'bid', turn: null, hand: [] }));
    expect(all('#hand .card')).toHaveLength(0);
    expect(all('.tg')).toHaveLength(0);
    expect(labels('#bar span, #bar b').join('')).toBe(T.phase_bid);
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it('says that the table is waiting while no question is open', () => {
    deliver(state(table(3, sides), { hand: HAND }));
    expectWaiting();
  });

  it('puts what it is sent in as text, never as markup', () => {
    deliver(state(table(3, (n) => (n === 2 ? { name: '<img src=x onerror=alert(1)>' } : {}))));
    expect(document.querySelector('#opps img')).toBeNull();
    expect(labels('#opps .nm')).toContain('<img src=x onerror=alert(1)>');
    deliver(state(table(3, (n) => (n === 1 ? { shown: { k: 'play', cards: [], label: '<b>x</b>', bomb: false } } : {}))));
    expect(document.querySelector('#opps b')).toBeNull();
    expect(labels('#opps .mark')).toContain('<b>x</b>');
  });
});

describe('the Dou Dizhu page: the log', () => {
  it('adds each line with its tone', () => {
    deliver(state(table(3, sides)));
    const tones = ['sys', 'head', 'act', 'pass', 'bomb', 'say', 'secret'] as const;
    for (const tone of tones) deliver({ kind: 'line', tone, seat: null, text: `Line ${tone}` });
    expect(all('#log .ln').map((l) => l.className)).toEqual(tones.map((t) => `ln ${t}`));
    expect(labels('#log .ln')).toEqual(tones.map((t) => `Line ${t}`));
  });

  it('puts a speech under its speaker’s name in his colour, and names a speaker who is not at the table by his seat', () => {
    deliver(state(table(3, sides)));
    deliver({ kind: 'line', tone: 'say', seat: 2, text: 'Hello.' });
    deliver({ kind: 'line', tone: 'say', seat: 9, text: 'Who am I?' });
    const [first, second] = all('#log .ln');
    expect(first?.textContent).toBe('Pet2: Hello.');
    expect(first?.querySelector('b')?.textContent).toBe('Pet2: ');
    expect(first?.querySelector('b')?.style.color).toBe('rgb(51, 102, 153)');
    expect(second?.textContent).toBe('9: Who am I?');
  });

  it('scrolls to the newest line', () => {
    deliver(state(table(3, sides)));
    const log = $('#log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 777 });
    deliver({ kind: 'line', tone: 'act', seat: null, text: 'Something happens.' });
    expect(log.scrollTop).toBe(777);
  });

  it('keeps only the last 400 lines', () => {
    deliver(state(table(3, sides)));
    for (let i = 0; i < 405; i++) deliver({ kind: 'line', tone: 'act', seat: null, text: `Line ${i}` });
    const lines = labels('#log .ln');
    expect(lines).toHaveLength(400);
    expect(lines[0]).toBe('Line 5');
    expect(lines[399]).toBe('Line 404');
  });

  it('puts what it is sent in as text, never as markup', () => {
    deliver(state(table(3, sides)));
    deliver({ kind: 'line', tone: 'say', seat: 2, text: '<b>bold</b><script>alert(1)</script>' });
    deliver({ kind: 'line', tone: 'sys', seat: null, text: '<i>x</i>' });
    expect(document.querySelector('#log b b')).toBeNull();
    expect(document.querySelector('#log i')).toBeNull();
    expect(document.querySelector('#log script')).toBeNull();
    expect($('#log').textContent).toContain('<b>bold</b>');
  });

  it('starts a new game from a clean log and a clean table', () => {
    deliver(state(table(3, sides), { hand: HAND, turn: 1, call: pip(5, 'heart'), holes: [SMALL_JOKER] }));
    deliver({ kind: 'line', tone: 'sys', seat: null, text: 'Old news.' });
    deliver(lobbyOf());
    expect(all('#log .ln')).toHaveLength(0);
    expect($('#game').hidden).toBe(true);
    expect($('#lobby').hidden).toBe(false);
    expect($('#prompt').children).toHaveLength(0);
    // Whatever redraws the table before the next one is sent finds nothing of the old game.
    deliver({ kind: 'ask', ask: null });
    expect(all('#hand .card')).toHaveLength(0);
    expect(all('.seat')).toHaveLength(0);
    for (const id of ['who', 'stake', 'call', 'holes', 'mine']) expect($(`#${id}`).textContent, id).toBe('');
    expect($('#phase').textContent).toBe(T.phase_bid);
  });
});

describe('the Dou Dizhu page: the bidding', () => {
  beforeEach(() => {
    deliver(state(table(3), { phase: 'bid', hand: HAND, turn: 0 }));
  });

  it('asks for a bid with a button for each bid that is allowed and one for no bid', () => {
    deliver(bidAsk(1, 3));
    expect(labels('#prompt .q')).toEqual(['Bid for the landlord.']);
    expect(labels('#prompt button')).toEqual([T.bidNone, bidOf(1), bidOf(2), bidOf(3)]);
    expect(all('#prompt button').map((b) => b.className)).toEqual(['ghost', '', '', 'primary']);
    expect(all('#prompt button').every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('offers only the bids above the one on the table', () => {
    deliver(bidAsk(2, 3));
    expect(labels('#prompt button')).toEqual([T.bidNone, bidOf(2), bidOf(3)]);
    deliver(bidAsk(3, 3));
    expect(labels('#prompt button')).toEqual([T.bidNone, bidOf(3)]);
    expect(all('#prompt button').map((b) => b.className)).toEqual(['ghost', 'primary']);
  });

  it('sends the bid that is clicked, and then waits', () => {
    deliver(bidAsk(1, 3));
    button(bidOf(2)).click();
    expect(sentOnce()).toEqual({ t: 'bid', bid: 2 });
    expectWaiting();
  });

  it('sends 0 for no bid', () => {
    deliver(bidAsk(2, 3));
    button(T.bidNone).click();
    expect(sentOnce()).toEqual({ t: 'bid', bid: 0 });
    expectWaiting();
  });

  it('sends every bid it offers as a message the room accepts', () => {
    for (const label of [T.bidNone, bidOf(1), bidOf(2), bidOf(3)]) {
      deliver(bidAsk(1, 3));
      button(label).click();
    }
    expect(sent.map(parsed)).toEqual([0, 1, 2, 3].map((bid) => ({ t: 'bid', bid })));
  });

  it('does not let the hand be played from while bidding', () => {
    deliver(bidAsk(1, 3));
    expect(handClasses()).toEqual(HAND.map(() => ''));
    handCard(KING_H.id).click();
    handCard(KING_H.id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(sent).toHaveLength(0);
    expect(picked()).toEqual([]);
  });

  it('puts what the question says in as text, never as markup', () => {
    deliver(bidAsk(1, 3, '<b>Bid!</b>'));
    expect(document.querySelector('#prompt b')).toBeNull();
    expect(labels('#prompt .q')).toEqual(['<b>Bid!</b>']);
  });

  it('is waiting once the question is taken away', () => {
    deliver(bidAsk(1, 3));
    deliver({ kind: 'ask', ask: null });
    expectWaiting();
  });
});

describe('the Dou Dizhu page: the play', () => {
  beforeEach(() => {
    deliver(state(table(3, sides), { hand: HAND, turn: 0, top: 1 }));
  });

  it('lights the cards at the user’s turn and offers Play, Pass, Hint and Clear', () => {
    deliver(playAsk());
    expect(labels('#prompt .q')).toEqual(['Beat Pet1’s pair.']);
    expect(labels('#prompt .sub')).toEqual([T.pickHint]);
    expect(labels('#prompt button')).toEqual([T.play, T.pass, T.hint, T.clear]);
    const off = all('#prompt button').map((b) => (b as HTMLButtonElement).disabled);
    expect(off).toEqual([true, false, false, true]);
    expect(handClasses()).toEqual(HAND.map(() => 'ok'));
  });

  it('does not let the user pass when he leads', () => {
    deliver(playAsk(true));
    expect(labels('#prompt .q')).toEqual(['You lead.']);
    expect(button(T.pass).disabled).toBe(true);
    button(T.pass).click();
    expect(sent).toHaveLength(0);
  });

  it('picks and unpicks a card with a click, asking main about the pick each time it is not empty', () => {
    deliver(playAsk());
    pick(KING_H.id);
    expect(handClasses()).toEqual(HAND.map((c) => (c.id === KING_H.id ? 'sel' : 'ok')));
    expect(sent.map(parsed)).toEqual([{ t: 'check', ids: [KING_H.id] }]);
    pick(NINE_S.id);
    expect(lastSent()).toEqual({ t: 'check', ids: [KING_H.id, NINE_S.id] });
    pick(KING_H.id, NINE_S.id);
    expect(picked()).toEqual([]);
    expect(sent).toHaveLength(3);
    expect(button(T.clear).disabled).toBe(true);
    expect(labels('#prompt .sub')).toEqual([T.pickHint]);
  });

  it('lets the user play the cards once main says that they make a play', () => {
    deliver(playAsk());
    pick(KING_H.id, KING_D.id);
    expect(lastSent()).toEqual({ t: 'check', ids: [KING_H.id, KING_D.id] });
    expect(button(T.play).disabled).toBe(true);
    expect(labels('#prompt .sub')).toEqual(['']);
    deliver({ kind: 'verdict', ids: [KING_H.id, KING_D.id], ok: true, label: 'Pair of Ks' });
    expect($('#prompt .sub').className).toBe('sub good');
    expect(labels('#prompt .sub')).toEqual(['Pair of Ks']);
    expect(button(T.play).disabled).toBe(false);
    expect(button(T.clear).disabled).toBe(false);
    sent.length = 0;
    button(T.play).click();
    expect(sentOnce()).toEqual({ t: 'play', ids: [KING_H.id, KING_D.id] });
    expectWaiting();
    expect(handClasses()).toEqual(HAND.map(() => ''));
  });

  it('does not let the user play cards that make no play, and says why', () => {
    deliver(playAsk());
    pick(KING_H.id, NINE_S.id);
    deliver({ kind: 'verdict', ids: [KING_H.id, NINE_S.id], ok: false, label: 'Those do not make a play.' });
    expect($('#prompt .sub').className).toBe('sub bad');
    expect(labels('#prompt .sub')).toEqual(['Those do not make a play.']);
    expect(button(T.play).disabled).toBe(true);
    const before = sent.length;
    button(T.play).click();
    expect(sent).toHaveLength(before);
  });

  it('takes a verdict for the same cards picked in another order', () => {
    deliver(playAsk());
    pick(KING_H.id, KING_D.id);
    deliver({ kind: 'verdict', ids: [KING_D.id, KING_H.id], ok: true, label: 'Pair of Ks' });
    expect(button(T.play).disabled).toBe(false);
  });

  it('ignores a verdict for a pick that is no longer the pick', () => {
    deliver(playAsk());
    pick(KING_H.id);
    pick(KING_D.id);
    deliver({ kind: 'verdict', ids: [KING_H.id], ok: true, label: 'Single K' });
    expect($('#prompt .sub').className).toBe('sub');
    expect(labels('#prompt .sub')).toEqual(['']);
    expect(button(T.play).disabled).toBe(true);
    deliver({ kind: 'verdict', ids: [KING_H.id, KING_D.id], ok: true, label: 'Pair of Ks' });
    expect(button(T.play).disabled).toBe(false);
  });

  it('forgets a verdict when the pick changes, and ignores one when no question is open', () => {
    deliver(playAsk());
    pick(KING_H.id, KING_D.id);
    deliver({ kind: 'verdict', ids: [KING_H.id, KING_D.id], ok: true, label: 'Pair of Ks' });
    pick(NINE_C.id);
    expect(button(T.play).disabled).toBe(true);
    expect(labels('#prompt .sub')).toEqual(['']);
    deliver({ kind: 'ask', ask: null });
    deliver({ kind: 'verdict', ids: [], ok: true, label: 'Stray' });
    expectWaiting();
  });

  it('passes with Pass, sending no cards, and then waits', () => {
    deliver(playAsk());
    button(T.pass).click();
    expect(sentOnce()).toEqual({ t: 'play', ids: [] });
    expectWaiting();
  });

  it('passes with cards picked as if with none', () => {
    deliver(playAsk());
    pick(KING_H.id);
    sent.length = 0;
    button(T.pass).click();
    expect(sentOnce()).toEqual({ t: 'play', ids: [] });
  });

  it('picks every card of a rank with a double click, and asks about all of them at once', () => {
    deliver(playAsk());
    const card = handCard(KING_H.id);
    card.click();
    card.click();
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(picked().sort((a, b) => a - b)).toEqual([KING_H.id, KING_D.id].sort((a, b) => a - b));
    expect(lastSent()).toEqual({ t: 'check', ids: [KING_H.id, KING_D.id] });
  });

  it('adds to the pick only the cards of that rank that were not picked yet, and does nothing when all are', () => {
    deliver(playAsk());
    pick(KING_H.id);
    handCard(KING_H.id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(lastSent()).toEqual({ t: 'check', ids: [KING_H.id, KING_D.id] });
    const before = sent.length;
    handCard(KING_D.id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(sent).toHaveLength(before);
    expect(picked()).toHaveLength(2);
  });

  it('clears the pick with Clear, asking nothing', () => {
    deliver(playAsk());
    pick(KING_H.id, KING_D.id);
    const before = sent.length;
    button(T.clear).click();
    expect(picked()).toEqual([]);
    expect(sent).toHaveLength(before);
    expect(button(T.clear).disabled).toBe(true);
    expect(labels('#prompt .sub')).toEqual([T.pickHint]);
  });

  it('asks main for a hint with Hint, and picks the cards it names, with the play they make', () => {
    deliver(playAsk());
    button(T.hint).click();
    expect(sentOnce()).toEqual({ t: 'hint' });
    deliver({ kind: 'hint', ids: [KING_H.id, KING_D.id], label: 'Pair of Ks' });
    expect(picked().sort((a, b) => a - b)).toEqual([KING_H.id, KING_D.id].sort((a, b) => a - b));
    expect($('#prompt .sub').className).toBe('sub good');
    expect(labels('#prompt .sub')).toEqual(['Pair of Ks']);
    expect(button(T.play).disabled).toBe(false);
    expect(sent).toHaveLength(1);
    sent.length = 0;
    button(T.play).click();
    expect(sentOnce()).toEqual({ t: 'play', ids: [KING_H.id, KING_D.id] });
  });

  it('says that there is nothing to play when the hint names no cards, until the user picks one', () => {
    deliver(playAsk());
    pick(KING_H.id);
    button(T.hint).click();
    deliver({ kind: 'hint', ids: [], label: '' });
    expect(picked()).toEqual([]);
    expect(labels('#prompt .sub')).toEqual([T.noHint]);
    expect(button(T.play).disabled).toBe(true);
    pick(NINE_S.id);
    expect(labels('#prompt .sub')).toEqual(['']);
  });

  it('ignores a hint when no question is open', () => {
    deliver({ kind: 'ask', ask: null });
    deliver({ kind: 'hint', ids: [KING_H.id], label: 'Single K' });
    expectWaiting();
    expect(picked()).toEqual([]);
  });

  it('forgets a half-made pick when the table asks again', () => {
    deliver(playAsk());
    pick(KING_H.id, KING_D.id);
    deliver({ kind: 'verdict', ids: [KING_H.id, KING_D.id], ok: true, label: 'Pair of Ks' });
    deliver(playAsk(true));
    expect(picked()).toEqual([]);
    expect(button(T.play).disabled).toBe(true);
    expect(labels('#prompt .sub')).toEqual([T.pickHint]);
  });

  it('keeps the pick and the question through the table’s new states, dropping cards that have left the hand', () => {
    deliver(playAsk());
    pick(KING_H.id, KING_D.id);
    deliver({ kind: 'verdict', ids: [KING_H.id, KING_D.id], ok: true, label: 'Pair of Ks' });
    deliver(state(table(3, sides), { hand: HAND, turn: 0, top: 1 }));
    expect(labels('#prompt .q')).toEqual(['Beat Pet1’s pair.']);
    expect(picked().sort((a, b) => a - b)).toEqual([KING_H.id, KING_D.id].sort((a, b) => a - b));
    expect(button(T.play).disabled).toBe(false);
    deliver(state(table(3, sides), { hand: HAND.filter((c) => c.id !== KING_D.id), turn: 0, top: 1 }));
    expect(picked()).toEqual([KING_H.id]);
    expect(button(T.play).disabled).toBe(true);
    expect(handClasses()).toEqual(HAND.filter((c) => c.id !== KING_D.id).map((c) => (c.id === KING_H.id ? 'sel' : 'ok')));
  });

  it('is waiting once the question is taken away, and the cards go dark', () => {
    deliver(playAsk());
    pick(KING_H.id);
    deliver({ kind: 'ask', ask: null });
    expectWaiting();
    expect(handClasses()).toEqual(HAND.map(() => ''));
  });

  it('sends only messages the room accepts, whichever way the cards are picked', () => {
    deliver(playAsk());
    pick(BIG_JOKER.id, SMALL_JOKER.id, TWO_S.id);
    handCard(NINE_C.id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    button(T.hint).click();
    expect(sent.length).toBeGreaterThan(3);
    expect(sent.every((m) => parseDdzIn(m) !== null)).toBe(true);
    expect(sent.map(parsed).map((m) => m.t)).toEqual(['check', 'check', 'check', 'check', 'hint']);
  });

  it('puts what the question, the verdict and the hint say in as text, never as markup', () => {
    deliver(playAsk(false, '<i>Beat it.</i>'));
    pick(KING_H.id);
    deliver({ kind: 'verdict', ids: [KING_H.id], ok: false, label: '<b>no</b>' });
    expect(document.querySelector('#prompt i')).toBeNull();
    expect(document.querySelector('#prompt b')).toBeNull();
    expect(labels('#prompt .q')).toEqual(['<i>Beat it.</i>']);
    expect(labels('#prompt .sub')).toEqual(['<b>no</b>']);
    button(T.hint).click();
    deliver({ kind: 'hint', ids: [KING_D.id], label: '<u>yes</u>' });
    expect(document.querySelector('#prompt u')).toBeNull();
    expect(labels('#prompt .sub')).toEqual(['<u>yes</u>']);
  });
});

describe('the Dou Dizhu page: the pets thinking', () => {
  it('marks the seats whose pet is thinking, with a title that says so, and unmarks them when it is done', () => {
    deliver(state(table(5, sides), { turn: 2 }));
    expect(marked('busy')).toEqual([]);
    deliver({ kind: 'thinking', seats: [2] });
    expect(marked('busy')).toEqual([2]);
    expect(oppSeat(2).title).toBe(T.thinking);
    expect(oppSeat(3).title).toBe('');
    expect(oppSeat(2).querySelector('.dots')?.textContent).toBe('…');
    deliver({ kind: 'thinking', seats: [2, 4] });
    expect(marked('busy')).toEqual([2, 4]);
    deliver({ kind: 'thinking', seats: [] });
    expect(marked('busy')).toEqual([]);
    expect(oppSeat(2).title).toBe('');
  });

  it('keeps the mark of whose turn it is on a seat that is thinking', () => {
    deliver(state(table(5, sides), { turn: 2 }));
    deliver({ kind: 'thinking', seats: [2] });
    expect(marked('turn')).toEqual([2]);
    expect(marked('busy')).toEqual([2]);
  });

  it('says it in the language it is sent', () => {
    for (const lang of LANGS) {
      deliver(lobbyOf(lang));
      deliver(state(table(3, sides)));
      deliver({ kind: 'thinking', seats: [1] });
      expect(oppSeat(1).title).toBe(textOf(lang).thinking);
      expect(oppSeat(1).title).not.toBe('');
    }
    expect(textOf('en').thinking).not.toBe(textOf('zh-CN').thinking);
  });

  it('stays on the seat through the table’s new states, and goes with the next lobby', () => {
    deliver(state(table(5, sides)));
    deliver({ kind: 'thinking', seats: [3] });
    deliver(state(table(5, sides), { turn: 4 }));
    expect(marked('busy')).toEqual([3]);
    deliver(lobbyOf());
    deliver(state(table(5, sides)));
    expect(marked('busy')).toEqual([]);
  });

  it('leaves the question the user is answering as it was', () => {
    deliver(state(table(3, sides), { hand: HAND }));
    deliver(playAsk());
    pick(KING_H.id);
    const before = labels('#prompt button');
    deliver({ kind: 'thinking', seats: [2] });
    expect(labels('#prompt .q')).toEqual(['Beat Pet1’s pair.']);
    expect(labels('#prompt button')).toEqual(before);
    expect(picked()).toEqual([KING_H.id]);
  });

  it('has the dots on every seat but shows them only for a seat that is thinking', () => {
    deliver(state(table(5, sides)));
    expect(all('.seat .dots').length).toBeGreaterThan(0);
    expect(all('.seat.busy .dots')).toHaveLength(0);
    deliver({ kind: 'thinking', seats: [3] });
    expect(all('.seat.busy .dots')).toHaveLength(1);
  });

  it('copes with a pet thinking before the table is shown', () => {
    expect(() => deliver({ kind: 'thinking', seats: [1] })).not.toThrow();
    expect($('#lobby').hidden).toBe(false);
    deliver(state(table(3, sides)));
    expect(marked('busy')).toEqual([1]);
  });
});

describe('the Dou Dizhu page: the end of the game', () => {
  const over = (): DdzOut => ({
    kind: 'over', win: true, winner: 'landlord', title: 'Victory!', text: 'Base 3, no bombs: points ×3.\nPoints: You +6 / Pet1 -3',
  });

  it('shows who won and how, and offers another game', () => {
    deliver(state(table(3, sides), { hand: HAND }));
    deliver(over());
    expect($('#over').textContent).toBe('Victory!');
    expect($('#overText').textContent).toBe('Base 3, no bombs: points ×3.\nPoints: You +6 / Pet1 -3');
    expect(labels('#prompt button')).toEqual([T.again]);
    button(T.again).click();
    expect(sentOnce()).toEqual({ t: 'again' });
  });

  it('takes the place of a question that was open', () => {
    deliver(state(table(3, sides), { hand: HAND }));
    deliver(playAsk());
    pick(KING_H.id);
    deliver(over());
    expect(all('#prompt .q')).toHaveLength(0);
    expect(labels('#prompt button')).toEqual([T.again]);
    expect(handClasses().every((s) => s === '')).toBe(true);
  });

  it('stays on the screen when the table is shown again, and goes with the next lobby', () => {
    deliver(state(table(3, sides), { hand: HAND }));
    deliver(over());
    deliver(state(table(3, sides), { hand: [], phase: 'over', turn: null }));
    expect($('#over').textContent).toBe('Victory!');
    expect($('#phase').textContent).toBe(T.phase_over);
    deliver(lobbyOf());
    expect(document.querySelector('#over')).toBeNull();
    expect($('#game').hidden).toBe(true);
    expect($('#lobby').hidden).toBe(false);
  });

  it('says what the other side won, and puts what it is sent in as text', () => {
    deliver(state(table(3, sides)));
    deliver({ kind: 'over', win: false, winner: 'farmer', title: '<b>Defeat.</b>', text: '<i>The farmers win.</i>' });
    expect($('#over').textContent).toBe('<b>Defeat.</b>');
    expect($('#overText').textContent).toBe('<i>The farmers win.</i>');
    expect(document.querySelector('#prompt b, #prompt i')).toBeNull();
  });
});

describe('the Dou Dizhu page: the words it reads', () => {
  const own = DOUDIZHU_PAGE.slice(DOUDIZHU_PAGE.indexOf('const SUIT='));
  const PHASES: readonly DdzPhase[] = ['bid', 'play', 'over'];
  const FAMILIES: Record<string, readonly string[]> = {
    role_: ['landlord', 'farmer', 'unknown', 'hidden'], roleHint_: ['landlord', 'farmer', 'hidden'], phase_: PHASES,
  };

  it('starts reading the script of the table itself, after the lobby’s', () => {
    expect(own.startsWith('const SUIT=')).toBe(true);
    expect(own).toContain('gameApi.onMsg');
  });

  it.each(LANGS)('reads only single words that the text module has, in %s', (lang) => {
    const direct = new Set([...own.matchAll(/\bT\.(\w+)/g)].map((m) => m[1] as string));
    expect(direct.size).toBeGreaterThan(15);
    const text = doudizhuText(gamesOf(lang));
    for (const key of direct) expect(text[key], `T.${key}`).toBeTruthy();
  });

  it.each(LANGS)('reads only the families of words that it knows, each in full, in %s', (lang) => {
    const prefixes = new Set([...own.matchAll(/\bT\['(\w+_)'\+/g)].map((m) => m[1] as string));
    expect([...prefixes].sort()).toEqual(Object.keys(FAMILIES).sort());
    const text = doudizhuText(gamesOf(lang));
    for (const [prefix, ids] of Object.entries(FAMILIES)) {
      for (const id of ids) expect(text[`${prefix}${id}`], `${prefix}${id}`).toBeTruthy();
    }
  });

  it.each(LANGS)('shows no missing word anywhere at a full table, in %s', (lang) => {
    const text = textOf(lang);
    deliver(lobbyOf(lang));
    const deck = buildDeck(3);
    const hand = sortHand(deck.filter((c, i) => i % 6 === 0 || c.rank >= SMALL));
    const shown = (): string => `${document.body.textContent ?? ''}\n${all('[title]').map((e) => e.title).join('\n')}`;
    const bad = /undefined|NaN|\[object|[{}]/;
    const acts: DdzShown[] = [
      { k: 'bid', bid: 3 }, { k: 'bid', bid: 0 }, { k: 'pass' },
      { k: 'play', cards: [SMALL_JOKER, BIG_JOKER], label: 'Rocket', bomb: true },
      { k: 'play', cards: [pip(3, 'club'), pip(3, 'heart')], label: 'Pair', bomb: false },
    ];
    const full = (over: (n: number) => Partial<DdzSeat>, extra: Partial<State> = {}): DdzOut =>
      state(table(6, (n) => ({ shown: acts[n - 1] ?? null, ...over(n) })), {
        hand, turn: 0, top: 4, base: 3, bombs: 2, call: pip(5, 'heart'), holes: [pip(1, 'spade'), pip(2, 'club'), SMALL_JOKER], ...extra,
      });

    for (const phase of PHASES) {
      deliver(full((n) => (n === 0 ? { role: 'farmer' } : n === 1 ? { role: 'landlord' } : {}), { phase }));
      expect(shown(), phase).not.toMatch(bad);
      expect($('#phase').textContent).toBe(text[`phase_${phase}`]);
    }
    expect($('#stake').textContent).not.toBe('');
    expect(labels('#opps .tg')).toContain(text.role_landlord);
    expect(labels('#opps .tg')).toContain(text.role_unknown);
    expect(labels('#meSeat .tg')).toEqual([text.role_farmer]);
    expect($('#mine').title).toBe(text.roleHint_farmer);
    expect(labels('#opps .mark')).toEqual(expect.arrayContaining([text.bidNone, text.pass, 'Rocket', 'Pair']));
    expect(labels('#opps .mark').some((s) => s === text.bidOf.replace('{n}', '3'))).toBe(true);
    expect(labels('#hand .card').every((s) => s !== '')).toBe(true);

    deliver(full((n) => (n === 0 ? { role: 'landlord', hidden: true } : {})));
    expect(shown()).not.toMatch(bad);
    expect(labels('#meSeat .tg')).toEqual([text.role_hidden]);
    expect($('#mine').title).toBe(text.roleHint_hidden);
    expect($('#call').title).toBe(text.calledTip);

    deliver({ kind: 'thinking', seats: [2, 5] });
    expect(shown()).not.toMatch(bad);
    expect(oppSeat(2).title).toBe(text.thinking);

    deliver(bidAsk(1, 3));
    expect(shown()).not.toMatch(bad);
    expect(labels('#prompt button')).toEqual([text.bidNone, ...[1, 2, 3].map((n) => text.bidOf.replace('{n}', String(n)))]);

    deliver(playAsk());
    expect(shown()).not.toMatch(bad);
    expect(labels('#prompt button')).toEqual([text.play, text.pass, text.hint, text.clear]);
    expect(labels('#prompt .sub')).toEqual([text.pickHint]);
    handCard(hand[0]?.id ?? 0).click();
    expect(shown()).not.toMatch(bad);
    deliver({ kind: 'hint', ids: [], label: '' });
    expect(labels('#prompt .sub')).toEqual([text.noHint]);

    deliver({ kind: 'ask', ask: null });
    expect(labels('#prompt .sub')).toEqual([text.waiting]);
    deliver({ kind: 'over', win: false, winner: 'farmer', title: 'Done.', text: 'Text.' });
    expect(shown()).not.toMatch(bad);
    expect(labels('#prompt button')).toEqual([text.again]);
    const buttons = all('button').filter((b) => b.closest('[hidden]') === null);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => (b.textContent ?? '').trim() !== '')).toBe(true);
  });
});
