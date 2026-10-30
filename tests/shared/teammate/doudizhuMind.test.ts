import { describe, expect, it } from 'vitest';
import { Table } from '../../../src/shared/teammate/doudizhu';
import type { Top } from '../../../src/shared/teammate/doudizhu';
import { botBid, botPlay, choices } from '../../../src/shared/teammate/doudizhuAi';
import {
  RANKS, buildDeck, canonical, checkPlay, isBomb, plays, rankLabel, readings, shapeOf, shuffle,
} from '../../../src/shared/teammate/doudizhuCards';
import type { Card, Combo, Play } from '../../../src/shared/teammate/doudizhuCards';
import {
  DDZ_BUDGET, DDZ_SAY_MAX, MENU_MAX, bidQuestion, briefing, makeDdzMind, menuOf, parseBid, parsePlay, playQuestion,
  stateText,
} from '../../../src/shared/teammate/doudizhuMind';
import type { DdzMind } from '../../../src/shared/teammate/doudizhuMind';
import { runDoudizhu } from '../../../src/shared/teammate/doudizhuRun';
import { CONFIG, SIZES } from '../../../src/shared/teammate/doudizhuTypes';
import type { Ask, Deps, Entry, Outcome, Role, Size } from '../../../src/shared/teammate/doudizhuTypes';
import { viewFor } from '../../../src/shared/teammate/doudizhuView';
import type { TableView } from '../../../src/shared/teammate/doudizhuView';
import { enDoudizhu as w } from '../../../src/shared/teammate/doudizhuWords';
import { lcg } from '../../main/teammate/gameFakes';
import { cards, selfPlay } from './doudizhuRig';

const names = (seat: number): string => (seat === 0 ? 'the user' : `Pet${seat}`);
const sorted = (list: readonly number[]): number[] => [...list].sort((a, b) => a - b);

function topOf(seat: number, spec: string, decks = 1): Top {
  const list = cards(spec);
  return { seat, combo: canonical(readings(list, decks)) as Combo, cards: list };
}

/** A table as seen from seat `me` (the first, by default): the landlord is seat 0 of a plain 3-seat table, unless told otherwise. */
function view(hand: Card[], over: Partial<TableView> = {}): TableView {
  const size = over.size ?? 3;
  const me = over.me ?? 0;
  const top = over.top ?? null;
  return {
    size,
    decks: CONFIG[size].decks,
    me,
    hand,
    counts: Array.from({ length: size }, (_, seat) => (seat === me ? hand.length : 10)),
    roles: Array.from({ length: size }, (_, seat): Role | null => (seat === 0 ? 'landlord' : seat === me ? 'farmer' : null)),
    hidden: false,
    top,
    lead: top === null,
    lord: 0,
    call: null,
    holes: [],
    base: 2,
    seen: new Array<number>(RANKS).fill(0),
    plays: new Array<number>(size).fill(1),
    turn: 6,
    ...over,
  };
}

/** A table, dealt, and with its landlords found the way its size finds them; nobody has played yet. */
function tableOf(size: Size, seed: number): Table {
  const deps: Deps = { random: lcg(seed), ask: () => Promise.resolve(null), emit: () => undefined, stopped: () => false };
  const t = new Table(deps, size);
  t.deal();
  if (t.cfg.mode === 'bid') {
    t.crown(0, 2);
  } else {
    const found = t.findCall(true);
    if (!found) throw new Error('no card to call');
    t.setCall(found.card, found.held);
  }
  return t;
}

const BID = { k: 'bid', min: 1, max: 3 } as const;
const LEAD: Ask = { k: 'play', lead: true };
const FOLLOW: Ask = { k: 'play', lead: false };

/** A mind whose model answers with `reply`; what it was asked and when it was thinking are kept. */
function harness(
  reply: (seat: number, prompt: string) => string | null | Promise<string | null> = () => null,
  budget?: number,
) {
  const asked: { seat: number; prompt: string }[] = [];
  const events: string[] = [];
  const mind: DdzMind = makeDdzMind({
    names,
    character: (seat) => ({ name: names(seat), persona: `the persona of ${names(seat)}` }),
    language: 'English',
    ask: (seat, prompt) => {
      asked.push({ seat, prompt });
      return Promise.resolve(reply(seat, prompt));
    },
    think: (seat, on) => events.push(`${seat}${on ? '+' : '-'}`),
    budget,
  });
  return { mind, asked, events };
}

describe('parseBid', () => {
  const ask = { k: 'bid', min: 2, max: 3 } as const;

  it('reads the bid in a reply, in JSON, among words or alone', () => {
    expect(parseBid('{"bid": 2}', ask)).toEqual({ bid: 2, say: null });
    expect(parseBid('{"bid": "3"}', ask)).toEqual({ bid: 3, say: null });
    expect(parseBid('I think:\n```json\n{"bid": 3, "say": "Mine!"}\n```', ask)).toEqual({ bid: 3, say: 'Mine!' });
    expect(parseBid(' 2 ', ask)).toEqual({ bid: 2, say: null });
    expect(parseBid('{"pick": 3}', ask)).toEqual({ bid: 3, say: null });
  });

  it('reads a pass in any of its forms, whatever the lowest bid is', () => {
    for (const text of ['{"bid": 0}', '{"bid": "pass"}', '{"bid": false}', '{"pass": true}', 'Pass', '0']) {
      expect(parseBid(text, ask), text).toEqual({ bid: 0, say: null });
    }
  });

  it('takes nothing but a bid the table would take', () => {
    for (const text of [
      '{"bid": 1}', '{"bid": 4}', '{"bid": -1}', '{"bid": 2.5}', '{"bid": "two"}', '{"bid": [2, 3]}', '{"bid": null}', '{}',
      'I will bid high', '', '{"bid": 2', '{"pass": false}',
    ]) {
      expect(parseBid(text, ask), text).toBeNull();
    }
  });

  it('keeps what it says to one short line', () => {
    expect(parseBid('{"bid": 2, "say": "  Leave   it\\n to me  "}', ask)?.say).toBe('Leave it to me');
    expect(parseBid(`{"bid": 2, "say": "${'a'.repeat(300)}"}`, ask)?.say).toBe('a'.repeat(DDZ_SAY_MAX));
    expect(parseBid('{"bid": 2, "say": ""}', ask)?.say).toBeNull();
    expect(parseBid('{"bid": 2, "say": 7}', ask)?.say).toBeNull();
  });
});

describe('parsePlay', () => {
  const hand = cards('3 4 5 6 7');
  const menu: Play[] = plays(hand, 1, null).filter((p) => p.combo.kind === 'single');

  it('reads a number as a play on the menu, whichever way it is written', () => {
    for (const text of ['{"play": 2}', '{"play": "2"}', '{"play": "#2"}', '{"play": [2]}', '{"pick": 2}', '{"choice": 2}', '2', ' 2\n']) {
      expect(parsePlay(text, menu, true), text).toEqual({ ids: (menu[1] as Play).ids, say: null });
    }
  });

  it('hands back a copy of the cards, so that nothing can change the menu', () => {
    const got = parsePlay('{"play": 1}', menu, true);
    got?.ids.push(999);
    expect((menu[0] as Play).ids).not.toContain(999);
  });

  it('reads 0 or the word as a pass when there is something to pass on, and never at a lead', () => {
    for (const text of ['{"play": 0}', '{"play": "pass"}', '{"pass": true}', '{"play": false}', 'pass', '0']) {
      expect(parsePlay(text, menu, false), text).toEqual({ ids: [], say: null });
      expect(parsePlay(text, menu, true), text).toBeNull();
    }
  });

  it('takes nothing that is not on the menu', () => {
    for (const text of [
      `{"play": ${menu.length + 1}}`, '{"play": -1}', '{"play": 1.5}', '{"play": [1, 2]}', '{"play": "all"}', '{}', 'play the 4',
      '', '{"play": 1', '{"bid": 1}',
    ]) {
      expect(parsePlay(text, menu, false), text).toBeNull();
    }
  });

  it('reads what is said with the play', () => {
    expect(parsePlay('{"play": 1, "say": "Boom!"}', menu, true)?.say).toBe('Boom!');
    expect(parsePlay('{"play": 0, "say": "Not this time."}', menu, false)?.say).toBe('Not this time.');
  });
});

describe('menuOf', () => {
  const legal = (v: TableView, p: Play): boolean => checkPlay(v.hand, p.ids, v.top?.combo ?? null, v.decks) !== null;

  it('offers the plays that beat the table, and the one the rules would make first', () => {
    const hand = cards('3 4 5 5 7 7 8 8 8 9 9 K K A 2 2 S');
    const v = view(hand, { me: 1, top: topOf(0, '6 6') });
    const menu = menuOf(v) as Play[];
    expect(menu.every((p) => p.combo.kind === 'pair' && legal(v, p))).toBe(true);
    expect(menu.map((p) => p.combo.rank).sort((a, b) => a - b)).toEqual([4, 5, 6, 10, 12]);
    const mine = botPlay(v);
    expect(mine.length).toBeGreaterThan(0);
    expect(sorted((menu[0] as Play).ids)).toEqual(sorted(mine));
  });

  it('puts nothing to the mind when there is no play to make, only a pass', () => {
    expect(menuOf(view(cards('3 4 5'), { me: 1, top: topOf(0, '6 6') }))).toBeNull();
  });

  it('puts nothing to the mind when the rules\' pick goes out, at a follow or at a lead', () => {
    expect(menuOf(view(cards('5 5'), { me: 1, top: topOf(0, '3 3') }))).toBeNull();
    expect(menuOf(view(cards('3 3 3 4 4 4')))).toBeNull();
    expect(menuOf(view(cards('7')))).toBeNull();
    expect(menuOf(view(cards('S B')))).toBeNull();
  });

  it('shows a lead as the lowest plays of each shape and the longest run, within the cap', () => {
    const hand = cards('3 3 3 4 4 5 6 7 8 9 10 J Q K A A 2 2 S');
    const v = view(hand);
    const menu = menuOf(v) as Play[];
    expect(menu.length).toBeLessThanOrEqual(MENU_MAX);
    expect(new Set(menu.map((p) => sorted(p.ids).join(','))).size).toBe(menu.length);
    expect(menu.every((p) => legal(v, p))).toBe(true);
    expect(sorted((menu[0] as Play).ids)).toEqual(sorted(botPlay(v)));
    const has = (shape: string, test: (p: Play) => boolean = () => true): boolean =>
      menu.some((p) => shapeOf(p.combo) === shape && test(p));
    expect(has('single', (p) => p.combo.rank === 0)).toBe(true);
    expect(has('pair')).toBe(true);
    expect(has('triple')).toBe(true);
    expect(has('tripleOne')).toBe(true);
    expect(has('straight', (p) => p.combo.size === 12)).toBe(true);
  });

  it('shows every other play of a lead only as far as the cap allows, for the biggest hands', () => {
    const t = tableOf(6, 3);
    for (const seat of [0, 1, 2]) {
      const v = viewFor(t, seat);
      const menu = menuOf(v) as Play[];
      expect(menu.length, `seat ${seat}`).toBeLessThanOrEqual(MENU_MAX);
      expect(menu.length).toBeGreaterThan(5);
    }
  });

  it('offers the bombs and the rocket after the quiet plays, and never breaks one up for a lesser play', () => {
    const hand = cards('4 4 4 4 9 K S B');
    const v = view(hand, { me: 1, top: topOf(0, '3') });
    const menu = menuOf(v) as Play[];
    const bombs = menu.filter((p) => isBomb(p.combo));
    expect(bombs.map((p) => p.combo.kind).sort()).toEqual(['bomb', 'rocket']);
    expect(menu.filter((p) => !isBomb(p.combo)).every((p) => p.ids.every((id) => {
      const rank = (hand.find((c) => c.id === id) as Card).rank;
      return rank !== 1 && rank < 13;
    }))).toBe(true);
    const rocket = bombs.find((p) => p.combo.kind === 'rocket') as Play;
    expect(menu.indexOf(rocket) === menu.length - 1 || menu[0] === rocket).toBe(true);
  });

  it('offers the rocket alone when it is all that beats a bomb', () => {
    const menu = menuOf(view(cards('S B 3'), { me: 1, top: topOf(0, 'K K K K') })) as Play[];
    expect(menu.map((p) => p.combo.kind)).toEqual(['rocket']);
  });

  it('keeps the called card for a hidden landlord to play, and says it gives him away', () => {
    const hand = cards('5 5 9 K');
    const heart = hand[1] as Card;
    const hidden = view(hand, {
      me: 1, size: 5, hidden: true, call: heart, lord: 0, top: topOf(0, '3'), roles: ['landlord', 'landlord', null, null, null],
    });
    const single = (v: TableView): Play => (menuOf(v) as Play[]).find((p) => p.combo.kind === 'single' && p.combo.rank === 2) as Play;
    expect(single(hidden).ids).toEqual([heart.id]);
    expect(single({ ...hidden, hidden: false }).ids).toEqual([(hand[0] as Card).id]);
    const menu = menuOf(hidden) as Play[];
    const rows = playQuestion(hidden, menu, names).split('\n').filter((l) => /^\d+\. /.test(l));
    const marked = rows.filter((l) => l.includes('shows you as a landlord'));
    expect(marked.length).toBe(menu.filter((p) => p.ids.includes(heart.id)).length);
    expect(marked.length).toBeGreaterThan(0);
    expect(playQuestion({ ...hidden, hidden: false }, menu, names)).not.toContain('shows you as a landlord');
  });

  it.each(SIZES)('offers only legal plays, each once, within the cap, at %i-player tables', (size) => {
    const rnd = lcg(size * 31);
    const cfg = CONFIG[size];
    for (let round = 0; round < 40; round++) {
      const deck = shuffle(buildDeck(cfg.decks), rnd);
      const hand = deck.slice(0, cfg.hand + (round % 3 === 0 ? cfg.holes : 0));
      const rival = deck.slice(cfg.hand, 2 * cfg.hand);
      const openings = plays(rival, cfg.decks, null);
      const open = openings[Math.floor(rnd() * openings.length)] as Play;
      const top = round % 4 === 0 ? null : { seat: 1, combo: open.combo, cards: rival.filter((c) => open.ids.includes(c.id)) };
      const v = view(hand, { size, me: 2 % size, top, hand: [...hand].sort((a, b) => b.rank - a.rank || a.id - b.id) });
      const menu = menuOf(v);
      if (menu === null) continue;
      expect(menu.length).toBeGreaterThan(0);
      expect(menu.length).toBeLessThanOrEqual(MENU_MAX);
      expect(new Set(menu.map((p) => sorted(p.ids).join(','))).size).toBe(menu.length);
      expect(menu.every((p) => checkPlay(v.hand, p.ids, top?.combo ?? null, cfg.decks) !== null)).toBe(true);
      const mine = botPlay(v);
      if (mine.length > 0) expect(sorted((menu[0] as Play).ids)).toEqual(sorted(mine));
      const quiet = choices(v).filter((p) => !isBomb(p.combo));
      if (top !== null && quiet.length <= 20) {
        const offered = new Set(menu.map((p) => sorted(p.ids).join(',')));
        expect(quiet.every((p) => offered.has(sorted(p.ids).join(',')))).toBe(true);
      }
    }
  });
});

describe('what a mind is told', () => {
  const hand = cards('3 3 4 J Q K A 2 S B');

  it('tells a seat the game once: the rules for its table, its seat and character, the language', () => {
    const text = briefing(5, 2, { name: 'Pet2', persona: 'brave and loud', language: 'Simplified Chinese' });
    expect(text).toContain('You play Dou Dizhu with 5 players, in seats numbered #1 to #5');
    expect(text).toContain('Dou Dizhu for 3 to 6 players');
    expect(text).toContain('doubles the points.');
    expect(text).not.toContain('official art');
    expect(text).not.toContain('own variants');
    expect(text).toContain('You are seat #3, Pet2.');
    expect(text).toContain('Your character: brave and loud');
    expect(text).toContain('Speak in Simplified Chinese');
    expect(text).toContain('2 packs of cards: 21 cards for each seat and 3 cards left over');
    expect(text).toContain('called card: the 2 seats');
    expect(text).toContain('one JSON object');
  });

  it('describes how each size of table finds its landlords, and leaves out a character it has not got', () => {
    const three = briefing(3, 0, { name: 'Pet0', persona: '', language: 'English' });
    expect(three).toContain('1 pack of cards: 17 cards for each seat and 3 cards left over. The landlord is found by bidding.');
    expect(three).not.toContain('Your character');
    expect(briefing(6, 0, { name: 'x', persona: '', language: 'English' })).toContain('3 packs of cards: 27 cards for each seat and 0 cards left over');
    expect(briefing(4, 0, { name: 'x', persona: '', language: 'English' })).toContain('found by bidding');
  });

  it('does not name a side while the landlord is still being bid for', () => {
    const v = view(hand, { lord: null, roles: [null, null, null], size: 3, counts: [10, 17, 17], me: 0 });
    const text = stateText(v, names);
    expect(text).toContain('The landlord is not decided yet.');
    expect(text).not.toContain('You are');
    expect(text).not.toMatch(/\((landlord|farmer)\)/);
    expect(text).toContain('Cards held: #1 you: 10, #2 Pet1: 17, #3 Pet2: 17.');
    expect(text).toContain('Your hand (10 cards): 3 3 4 J Q K A 2 Small Joker Big Joker.');
  });

  it('counts the cards the seat can not see: those it does not hold and has not seen played', () => {
    const seen = new Array<number>(RANKS).fill(0);
    seen[0] = 1;
    seen[12] = 2;
    const text = stateText(view(hand, { seen }), names);
    const line = text.match(/^Cards you neither hold nor have seen played: .*$/m)?.[0];
    expect(line).toBe(
      'Cards you neither hold nor have seen played: 3×1, 4×3, 5×4, 6×4, 7×4, 8×4, 9×4, 10×4, J×3, Q×3, K×3, A×3, 2×1.',
    );
  });

  it('says which side the seat is on, and what the bottom cards and the table hold', () => {
    const holes = cards('3 K S');
    const lord = stateText(view(hand, { holes, lord: 0, me: 0, roles: ['landlord', 'farmer', 'farmer'], base: 3 }), names);
    expect(lord).toContain(w.youAre.landlord);
    expect(lord).toContain(w.roleHint.landlord);
    expect(lord).toContain('#1 you took the bottom cards: ♠3, ♠K, Small Joker.');
    expect(lord).toContain('Base points: 3.');
    expect(lord).toContain('Nothing is on the table.');
    expect(lord).toContain('#2 Pet1: 10 (farmer)');
    const farmer = stateText(view(hand, { me: 1, top: topOf(0, '8 8'), roles: ['landlord', 'farmer', 'farmer'] }), names);
    expect(farmer).toContain(w.youAre.farmer);
    expect(farmer).toContain("On the table: #1 the user's Pair: ♠8, ♥8.");
    expect(farmer).toContain('#1 the user: 10 (landlord)');
  });

  it('tells a hidden landlord so, and how many more landlords there are that are still hidden', () => {
    const call = (cards('5')[0]) as Card;
    const six = { size: 6 as const, call, lord: 0, holes: [], me: 2, hidden: true };
    const text = stateText(view(hand, { ...six, roles: ['landlord', null, 'landlord', null, null, null] }), names);
    expect(text).toContain(w.youAre.hidden);
    expect(text).toContain(w.roleHint.hidden);
    expect(text).not.toContain(w.youAre.landlord);
    expect(text).toContain('The called card is ♠5.');
    expect(text).toContain('Landlords still hidden: 1, among the seats whose side is not given above.');
    expect(text).not.toContain('took the bottom cards');
    const five = stateText(view(hand, { ...six, size: 5, roles: ['landlord', null, 'landlord', null, null] }), names);
    expect(five).not.toContain('Landlords still hidden');
  });

  it('does not count a landlord still hidden as known, and counts the ones that have shown themselves', () => {
    const call = (cards('5')[0]) as Card;
    const base = { size: 5 as const, call, lord: 0, holes: cards('3 4 6') };
    const farmer = stateText(view(hand, { ...base, me: 3, roles: ['landlord', null, null, 'farmer', null] }), names);
    expect(farmer).toContain('Landlords still hidden: 1, among the seats whose side is not given above.');
    expect(farmer).not.toMatch(/#3 Pet2: \d+ \(/);
    const known = stateText(view(hand, { ...base, me: 3, roles: ['landlord', null, 'landlord', 'farmer', null] }), names);
    expect(known).not.toContain('Landlords still hidden');
    const bid = stateText(view(hand, { me: 1, roles: ['landlord', 'farmer', 'farmer'] }), names);
    expect(bid).not.toContain('Landlords still hidden');
  });

  it('asks for a bid with the range and the format', () => {
    const v = view(hand, { lord: null, roles: [null, null, null], me: 0 });
    const text = bidQuestion(v, { k: 'bid', min: 2, max: 3 }, names);
    expect(text).toContain("Bidding for the landlord's seat. Bid 2 to 3 to be the landlord, or pass.");
    expect(text).toContain('Reply {"bid": <number>, "say": "<a short remark in character, or empty>"}, the number being 2 to 3, or 0 to pass.');
    expect(bidQuestion(v, { k: 'bid', min: 3, max: 3 }, names)).toContain('the number being 3, or 0 to pass.');
  });

  it('lists the plays by number, with a pass at a follow only, and says who leads', () => {
    const h = cards('3 3 5 5 7 7 9 9 K');
    const follow = view(h, { me: 1, top: topOf(0, '4 4') });
    const fm = menuOf(follow) as Play[];
    const fText = playQuestion(follow, fm, names);
    expect(fText).toContain("Your turn: beat #1 the user's Pair, or pass.");
    expect(fText).toContain('Plays on offer:\n0. Pass\n1. ');
    expect(fText).toMatch(/\n2\. /);
    expect(fText).toContain('Reply {"play": <number>, "say": "<a short remark in character, or empty>"}.');
    expect(fText.match(/^\d+\. /gm)?.length).toBe(fm.length + 1);
    const lead = view(h, { me: 1 });
    const lm = menuOf(lead) as Play[];
    const lText = playQuestion(lead, lm, names);
    expect(lText).toContain('Your turn, and you lead, so you must play.');
    expect(lText).not.toContain('0. Pass');
    expect(lText).toContain('Plays on offer, a shortlist of what your hand can make:\n1. ');
    expect(lText.match(/^\d+\. /gm)?.length).toBe(lm.length);
  });

  it('writes a play as its cards, lowest first, and what they make', () => {
    const h = cards('3 3 3 9 K');
    const lead = view(h, { me: 1 });
    expect(playQuestion(lead, menuOf(lead) as Play[], names)).toMatch(/\d+\. ♠3, ♥3, ♣3, ♠9 — Triple \+ single/);
  });

  it('tells a seat no more than the seat knows: with other seats\' hands swapped, the questions read the same', () => {
    const me = 1;
    for (const size of SIZES) {
      for (const phase of ['dealt', 'found'] as const) {
        // At three seats only the landlord has a hand of another size, so there is no pair to swap once he is found.
        if (size === 3 && phase === 'found') continue;
        const t = phase === 'found' ? tableOf(size, size) : new Table(
          { random: lcg(size), ask: () => Promise.resolve(null), emit: () => undefined, stopped: () => false }, size,
        );
        if (phase === 'dealt') t.deal();
        const [a, b] = t.players.filter((p) => p.seat !== me && p.seat !== t.lord);
        if (!a || !b) throw new Error('no two seats to swap');
        expect(a.hand.length, `${size} ${phase}`).toBe(b.hand.length);
        const read = (): string => {
          const v = viewFor(t, me);
          const menu = menuOf(v);
          return `${menu ? playQuestion(v, menu, names) : stateText(v, names)}\n${bidQuestion(v, BID, names)}`;
        };
        const before = read();
        const swap = a.hand;
        a.hand = b.hand;
        b.hand = swap;
        expect(read(), `${size} ${phase}`).toBe(before);
      }
    }
  });
});

describe('a mind at the table', () => {
  it('briefs a seat when it is first asked, then tells it only what has happened since it last looked', async () => {
    const t = tableOf(3, 1);
    const h = harness(() => '{"bid": 2}');
    h.mind.observe({ k: 'start', size: 3 });
    h.mind.observe({ k: 'deal' });
    h.mind.observe({ k: 'bid', seat: 2, bid: 1 });
    const first = await h.mind.answer(1, BID, t);
    expect(first).toEqual({ reply: { k: 'bid', bid: 2 }, say: null });
    const one = (h.asked[0] as { prompt: string }).prompt;
    expect(one).toContain('You play Dou Dizhu with 3 players');
    expect(one).toContain('You are seat #2, Pet1.');
    expect(one).toContain('Your character: the persona of Pet1');
    expect(one).toContain('Speak in English');
    expect(one).toContain('What has happened since you last looked:\nA 3-player game begins.\nThe cards are dealt.\n#3 Pet2 bid 1.');
    expect(one.indexOf('You play Dou Dizhu')).toBeLessThan(one.indexOf('What has happened'));
    expect(one.indexOf('What has happened')).toBeLessThan(one.indexOf('Bidding for the'));

    h.mind.observe({ k: 'bid', seat: 1, bid: 2 });
    h.mind.observe({ k: 'bid', seat: 0, bid: 0 });
    await h.mind.answer(1, BID, t);
    const two = (h.asked[1] as { prompt: string }).prompt;
    expect(two).not.toContain('You play Dou Dizhu');
    expect(two).toContain('What has happened since you last looked:\n#2 you bid 2.\n#1 the user did not bid.\n');
    expect(two).not.toContain('#3 Pet2 bid 1.');

    await h.mind.answer(1, BID, t);
    expect((h.asked[2] as { prompt: string }).prompt).not.toContain('What has happened');

    await h.mind.answer(2, BID, t);
    const other = (h.asked[3] as { prompt: string }).prompt;
    expect(other).toContain('You are seat #3, Pet2.');
    expect(other).toContain('#3 you bid 1.');
    expect(other).toContain('A 3-player game begins.');
  });

  it('leaves out the entries that say nothing', async () => {
    const t = tableOf(3, 1);
    const h = harness(() => '{"bid": 1}');
    h.mind.observe({ k: 'turn', seat: 1, lead: true });
    await h.mind.answer(1, BID, t);
    expect((h.asked[0] as { prompt: string }).prompt).not.toContain('What has happened');
  });

  it('is told of at most the last eighty entries at a time, and that earlier ones were left out', async () => {
    const t = tableOf(3, 1);
    const h = harness(() => '{"bid": 1}');
    for (let i = 0; i < 100; i++) h.mind.observe({ k: 'pass', seat: i % 3 });
    await h.mind.answer(1, BID, t);
    const prompt = (h.asked[0] as { prompt: string }).prompt;
    expect(prompt).toContain('(20 earlier events left out)');
    expect(prompt.match(/ passed\./g)?.length).toBe(80);
  });

  it('does not move on when it got no answer: the seat is told it all again, the briefing too', async () => {
    const t = tableOf(3, 1);
    let answers = [null, '{"bid": 1}'];
    const h = harness(() => answers.shift() ?? null);
    h.mind.observe({ k: 'deal' });
    expect(await h.mind.answer(1, BID, t)).toBeNull();
    expect(await h.mind.answer(1, BID, t)).toEqual({ reply: { k: 'bid', bid: 1 }, say: null });
    const [a, b] = h.asked.map((x) => x.prompt) as [string, string];
    for (const p of [a, b]) {
      expect(p).toContain('You play Dou Dizhu');
      expect(p).toContain('The cards are dealt.');
    }
    answers = [];
    await h.mind.answer(1, BID, t);
    expect((h.asked[2] as { prompt: string }).prompt).not.toContain('You play Dou Dizhu');
  });

  it('is thinking exactly while it waits for its model, also when the model fails', async () => {
    const t = tableOf(3, 1);
    const h = harness((seat) => {
      if (seat === 2) throw new Error('gone');
      return '{"bid": 3}';
    });
    await h.mind.answer(1, BID, t);
    expect(await h.mind.answer(2, BID, t)).toBeNull();
    expect(h.events).toEqual(['1+', '1-', '2+', '2-']);
  });

  it('is told nothing of what a seat is not asked about: a forced pass and a hand that goes out cost no request', async () => {
    const t = tableOf(3, 1);
    const h = harness(() => '{"play": 1}');
    t.p(1).hand = cards('3 4 5');
    t.top = topOf(0, '6 6');
    expect(await h.mind.answer(1, FOLLOW, t)).toBeNull();
    t.p(1).hand = cards('7 7');
    expect(await h.mind.answer(1, FOLLOW, t)).toBeNull();
    t.top = null;
    t.p(1).hand = cards('4 4 4 5 5 5');
    expect(await h.mind.answer(1, LEAD, t)).toBeNull();
    expect(h.asked).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('plays the play it chose from the menu, and says what it said', async () => {
    const t = tableOf(3, 1);
    t.p(1).hand = cards('3 3 5 7 7 9 K');
    const menu = menuOf(viewFor(t, 1)) as Play[];
    const h = harness(() => '{"play": 2, "say": "Here we go!"}');
    const thought = await h.mind.answer(1, LEAD, t);
    expect(thought).toEqual({ reply: { k: 'play', ids: (menu[1] as Play).ids }, say: 'Here we go!' });
    const prompt = (h.asked[0] as { prompt: string }).prompt;
    expect(prompt).toContain('Your hand (7 cards): 3 3 5 7 7 9 K.');
    expect(prompt).toContain('Your turn, and you lead, so you must play.');
    expect(checkPlay(t.p(1).hand, (thought?.reply as { ids: number[] }).ids, null, 1)).not.toBeNull();
  });

  it('passes when it says so at a follow, and is not heard at a lead', async () => {
    const t = tableOf(3, 1);
    t.p(1).hand = cards('3 3 5 7 7 9 K');
    t.top = topOf(0, '4');
    const h = harness(() => '{"play": 0, "say": "Pass."}');
    expect(await h.mind.answer(1, FOLLOW, t)).toEqual({ reply: { k: 'play', ids: [] }, say: 'Pass.' });
    t.top = null;
    expect(await h.mind.answer(1, LEAD, t)).toBeNull();
  });

  it('answers nothing for a number that is not on the menu or a reply that is not JSON', async () => {
    const t = tableOf(3, 1);
    t.p(1).hand = cards('3 3 5 7 7 9 K');
    for (const text of ['{"play": 99}', 'I will play my best cards', '{"bid": 2}', '']) {
      expect(await harness(() => text).mind.answer(1, LEAD, t), text).toBeNull();
    }
    expect(await harness(() => '{"bid": 7}').mind.answer(1, BID, t)).toBeNull();
  });

  it('makes no more requests than its budget; after that the rules answer', async () => {
    const t = tableOf(3, 1);
    const h = harness(() => '{"bid": 1}', 2);
    expect(await h.mind.answer(1, BID, t)).not.toBeNull();
    expect(await h.mind.answer(2, BID, t)).not.toBeNull();
    expect(await h.mind.answer(1, BID, t)).toBeNull();
    expect(h.asked).toHaveLength(2);
    expect(h.events).toEqual(['1+', '1-', '2+', '2-']);
  });

  it('asks about a hundred and fifty times a game, at most, by default', async () => {
    const t = tableOf(3, 1);
    const h = harness(() => '{"bid": 1}');
    for (let i = 0; i < DDZ_BUDGET + 20; i++) await h.mind.answer(1, BID, t);
    expect(h.asked).toHaveLength(DDZ_BUDGET);
    expect(DDZ_BUDGET).toBe(150);
  });
});

// Whole games

interface Prompt {
  seat: number;
  text: string;
  hand: Card[];
  open: boolean[];
  size: Size;
}

interface Game {
  outcome: Outcome;
  entries: Entry[];
  prompts: Prompt[];
  events: string[];
  replies: (string | null)[];
}

const jokerName = (rank: number): string => (rank === 14 ? w.joker.big : rank === 13 ? w.joker.small : rankLabel(rank));

/** A model that picks any of the numbers it is offered, and says something now and then. */
function guess(rnd: () => number): (seat: number, prompt: string) => string {
  return (_seat, prompt) => {
    const say = rnd() < 0.3 ? ', "say": "Hmm."' : '';
    if (prompt.includes("Bidding for the landlord's seat")) {
      const m = /the number being (\d+)(?: to (\d+))?, or 0 to pass/.exec(prompt);
      const lo = Number(m?.[1] ?? 1);
      const hi = Number(m?.[2] ?? lo);
      const options = [0, ...Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)];
      return `{"bid": ${options[Math.floor(rnd() * options.length)]}${say}}`;
    }
    const menu = prompt.slice(prompt.lastIndexOf('Plays on offer'));
    const numbers = [...menu.matchAll(/^(\d+)\. /gm)].map((x) => Number(x[1]));
    return `{"play": ${numbers[Math.floor(rnd() * numbers.length)]}${say}}`;
  };
}

/** One game with minds in the seats of the pets (all but the first), whose model is `model`. */
async function mindGame(
  size: Size, seed: number, model: (seat: number, prompt: string) => string | null, budget?: number,
): Promise<Game> {
  const entries: Entry[] = [];
  const prompts: Prompt[] = [];
  const events: string[] = [];
  const replies: (string | null)[] = [];
  let current: Table | null = null;
  const mind = makeDdzMind({
    names,
    character: (seat) => ({ name: names(seat), persona: `the persona of ${names(seat)}` }),
    language: 'English',
    ask: (seat, text) => {
      const t = current as Table;
      prompts.push({ seat, text, hand: [...t.p(seat).hand], open: t.players.map((p) => p.open), size });
      const reply = model(seat, text);
      replies.push(reply);
      return Promise.resolve(reply);
    },
    think: (seat, on) => events.push(`${seat}${on ? '+' : '-'}`),
    budget,
  });
  const deps: Deps = {
    random: lcg(seed),
    ask: async (seat, ask, table) => {
      current = table;
      const thought = seat === 0 ? null : await mind.answer(seat, ask, table);
      if (thought) return thought.reply;
      const v = viewFor(table, seat);
      return ask.k === 'bid' ? { k: 'bid', bid: botBid(v, ask.min, ask.max) } : { k: 'play', ids: botPlay(v) };
    },
    emit: (entry, table) => {
      current = table;
      entries.push(entry);
      mind.observe(entry);
    },
    stopped: () => false,
  };
  const outcome = await runDoudizhu(deps, size);
  if (!outcome) throw new Error('the game did not finish');
  return { outcome, entries, prompts, events, replies };
}

describe('whole games with the minds', () => {
  it.each(SIZES)('plays %i-player games to the end, every answer legal, the pets asked and never the user', async (size) => {
    for (let seed = 1; seed <= 5; seed++) {
      const g = await mindGame(size, seed, guess(lcg(seed * 13)));
      expect(g.outcome.fallbacks, `seed ${seed}`).toBe(0);
      expect(g.entries.at(-1)?.k).toBe('end');
      expect(g.prompts.length).toBeGreaterThan(0);
      expect(g.prompts.length).toBeLessThanOrEqual(DDZ_BUDGET);
      expect(g.prompts.every((p) => p.seat !== 0)).toBe(true);
    }
  });

  it.each(SIZES)('keeps each seat thinking one request at a time, and ends with none thinking, at %i players', async (size) => {
    const g = await mindGame(size, 2, guess(lcg(5)));
    const on = new Set<number>();
    for (const e of g.events) {
      const seat = Number(e.slice(0, -1));
      if (e.endsWith('+')) {
        expect(on.has(seat), e).toBe(false);
        on.add(seat);
      } else {
        expect(on.delete(seat), e).toBe(true);
      }
    }
    expect(on.size).toBe(0);
    expect(g.events.length).toBe(2 * g.prompts.length);
  });

  it.each(SIZES)('shows each mind its own hand as it is, and no side nobody knows, at %i players', async (size) => {
    for (const seed of [1, 4]) {
      const g = await mindGame(size, seed, guess(lcg(seed)));
      for (const p of g.prompts) {
        const line = p.text.match(/Your hand \((\d+) cards?\): (.*)\.$/m);
        expect(line, p.text).not.toBeNull();
        expect(Number(line?.[1])).toBe(p.hand.length);
        const expected = [...p.hand].sort((a, b) => a.rank - b.rank || a.id - b.id).map((c) => jokerName(c.rank)).join(' ');
        expect(line?.[2]).toBe(expected);
        const held = p.text.match(/^Cards held: (.*)\.$/m)?.[1] ?? '';
        const marks = held.match(/\((landlord|farmer)\)/g)?.length ?? 0;
        expect(marks, held).toBe(p.open.filter((open, seat) => open && seat !== p.seat).length);
      }
    }
  });

  it.each(SIZES)('plays the very game the rules play when no model answers, at %i players', async (size) => {
    for (const seed of [1, 2, 3]) {
      const dumb = await mindGame(size, seed, () => null);
      const bots = await selfPlay(size, seed);
      expect(dumb.entries, `seed ${seed}`).toEqual(bots.entries);
      expect(dumb.outcome.result).toEqual(bots.outcome.result);
      expect(dumb.outcome.fallbacks).toBe(0);
    }
  });

  it.each(SIZES)('plays the very game the rules play when the model only says nonsense, at %i players', async (size) => {
    const bots = await selfPlay(size, 3);
    const g = await mindGame(size, 3, () => 'I do not play card games.');
    expect(g.entries).toEqual(bots.entries);
    expect(g.prompts.length).toBeGreaterThan(0);
  });

  it('plays out a whole game when its budget runs out part way: the rules take over', async () => {
    const g = await mindGame(5, 2, guess(lcg(2)), 6);
    expect(g.prompts).toHaveLength(6);
    expect(g.outcome.fallbacks).toBe(0);
    expect(g.entries.at(-1)?.k).toBe('end');
  });

  it('asks the same questions of the same game again, so nothing in them is left to chance', async () => {
    const a = await mindGame(4, 6, guess(lcg(9)));
    const b = await mindGame(4, 6, guess(lcg(9)));
    expect(b.prompts.map((p) => p.text)).toEqual(a.prompts.map((p) => p.text));
    expect(b.replies).toEqual(a.replies);
  });
});
