import { describe, expect, it } from 'vitest';
import type { Table, Top } from '../../../src/shared/teammate/doudizhu';
import { BID_AT, botBid, botPlay, choices, hintList, revealing, strength, turnsToGo } from '../../../src/shared/teammate/doudizhuAi';
import { RANKS, SMALL, buildDeck, canonical, checkPlay, countRanks, isBomb, plays, readings, shuffle } from '../../../src/shared/teammate/doudizhuCards';
import type { Card, Combo, Play } from '../../../src/shared/teammate/doudizhuCards';
import { SIZES } from '../../../src/shared/teammate/doudizhuTypes';
import type { Ask, Reply, Role } from '../../../src/shared/teammate/doudizhuTypes';
import { sides } from '../../../src/shared/teammate/doudizhuView';
import type { TableView } from '../../../src/shared/teammate/doudizhuView';
import { lcg } from '../../main/teammate/gameFakes';
import { cards, selfPlay } from './doudizhuRig';
import type { Script } from './doudizhuRig';

const counts = (spec: string): number[] => countRanks(cards(spec));
const sorted = (list: readonly number[]): number[] => [...list].sort((a, b) => a - b);
const idsOf = (list: readonly Card[]): number[] => sorted(list.map((c) => c.id));

function topOf(seat: number, spec: string): Top {
  const list = cards(spec);
  return { seat, combo: canonical(readings(list, 1)) as Combo, cards: list };
}

/** A table as seen from seat 0, the landlord of a plain 3-seat table, unless told otherwise. */
function view(hand: Card[], over: Partial<TableView> = {}): TableView {
  const size = over.size ?? 3;
  const me = over.me ?? 0;
  const top = over.top ?? null;
  return {
    size,
    decks: 1,
    me,
    hand,
    counts: Array.from({ length: size }, (_, seat) => (seat === me ? hand.length : 10)),
    roles: Array.from({ length: size }, (_, seat): Role => (seat === 0 ? 'landlord' : 'farmer')),
    hidden: false,
    top,
    lead: top === null,
    lord: 0,
    call: null,
    holes: [],
    base: 1,
    seen: new Array<number>(RANKS).fill(0),
    plays: new Array<number>(size).fill(1),
    turn: 6,
    ...over,
  };
}

const RICH = 'S B 3 3 3 3 2 2 A A K K Q Q J J 10';
const MID = 'S 2 2 A A K K Q J 10 9 8 7 6 5 4 3';
const POOR = '3 3 4 4 5 6 6 7 7 9 9 10 10 Q Q K K';

describe('turnsToGo', () => {
  it.each([
    ['', 0],
    ['3', 1],
    ['3 5 7', 3],
    ['3 4 5 6', 4],
    ['3 3 5 5', 2],
    ['3 4 5 6 7', 1],
    ['3 4 5 6 7 8 9 10 J Q K A', 1],
    ['3 3 4 4 5 5', 1],
    ['3 3 3', 1],
    ['3 3 3 4', 1],
    ['3 3 3 4 4', 1],
    ['3 3 3 4 4 4 5 6', 1],
    ['3 3 3 3', 1],
    ['3 3 3 3 5 7', 3],
    ['S', 1],
    ['S B', 1],
  ])('takes %j %i turn(s) to play out', (spec, turns) => {
    expect(turnsToGo(counts(spec), 1)).toBe(turns);
  });

  it('counts the rocket of a table with more packs only when every joker is in the hand', () => {
    expect(turnsToGo(counts('S S B B'), 2)).toBe(1);
    expect(turnsToGo(counts('S S B'), 2)).toBe(2);
    expect(turnsToGo(counts('S B'), 2)).toBe(2);
  });

  it('counts a rank of four or more as one bomb', () => {
    expect(turnsToGo(counts('3 3 3 3 3'), 1)).toBe(1);
    expect(turnsToGo(counts('3 3 3 3 3 3 3 3'), 2)).toBe(1);
  });

  it('lets the wings of a triple take loose cards along', () => {
    expect(turnsToGo(counts('3 3 3 5 7 9'), 1)).toBe(3);
    expect(turnsToGo(counts('3 3 3 4 4 4 6 8'), 1)).toBe(1);
  });
});

describe('strength', () => {
  it('ranks a hand of bombs and jokers over a middling hand over a poor one', () => {
    const rich = strength(cards(RICH), 1);
    const mid = strength(cards(MID), 1);
    const poor = strength(cards(POOR), 1);
    expect(rich).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(poor);
    expect(rich).toBeGreaterThanOrEqual(BID_AT[2]);
    expect(mid).toBeGreaterThanOrEqual(BID_AT[1]);
    expect(mid).toBeLessThan(BID_AT[2]);
    expect(poor).toBeLessThan(BID_AT[0]);
  });

  it('is worth more for a bomb, a joker or a two in the hand', () => {
    const plain = strength(cards('3 4 5 6 7 8 9 10 J Q K 3 4 5 6 7 8'), 1);
    expect(strength(cards('3 3 3 3 4 5 6 7 8 9 10 J Q K 5 6 7'), 1)).toBeGreaterThan(plain);
    expect(strength(cards('B 4 5 6 7 8 9 10 J Q K 3 4 5 6 7 8'), 1)).toBeGreaterThan(plain);
    expect(strength(cards('2 4 5 6 7 8 9 10 J Q K 3 4 5 6 7 8'), 1)).toBeGreaterThan(plain);
  });
});

describe('botBid', () => {
  it('bids what the hand is worth', () => {
    expect(botBid(view(cards(RICH)), 1, 3)).toBe(3);
    expect(botBid(view(cards(MID)), 1, 3)).toBe(2);
    expect(botBid(view(cards(POOR)), 1, 3)).toBe(0);
  });

  it('never bids under the least it may, and passes with 0 when the hand is worth less', () => {
    expect(botBid(view(cards(MID)), 2, 3)).toBe(2);
    expect(botBid(view(cards(MID)), 3, 3)).toBe(0);
    expect(botBid(view(cards(RICH)), 3, 3)).toBe(3);
  });

  it('never bids over the most it may', () => {
    expect(botBid(view(cards(RICH)), 1, 2)).toBe(2);
    expect(botBid(view(cards(MID)), 1, 1)).toBe(1);
  });
});

describe('botPlay at a lead', () => {
  it('goes out when the whole hand is one play', () => {
    const hand = cards('3 3 3 4');
    expect(sorted(botPlay(view(hand)))).toEqual(idsOf(hand));
  });

  it('leads the lowest of a hand with nothing that joins up', () => {
    const hand = cards('3 5 8 10 Q A');
    expect(botPlay(view(hand))).toEqual([(hand[0] as Card).id]);
  });

  it('keeps a bomb back while there are other leads', () => {
    const hand = cards('3 3 3 3 5 7 9');
    expect(botPlay(view(hand))).toEqual([(hand[4] as Card).id]);
  });

  it('plays a bomb first when it leaves the hand one turn from the end', () => {
    const hand = cards('3 3 3 3 5');
    expect(sorted(botPlay(view(hand)))).toEqual(idsOf(hand.slice(0, 4)));
  });

  it('does not lead a single the foe about to go out can beat', () => {
    const hand = cards('3 5 5 9');
    const ids = botPlay(view(hand, { counts: [4, 1, 10] }));
    expect(sorted(ids)).toEqual(idsOf(hand.slice(1, 3)));
  });

  it('does not lead a pair into a foe down to two cards', () => {
    const hand = cards('3 3 7 9 Q');
    const ids = botPlay(view(hand, { counts: [5, 2, 10] }));
    expect(ids).toHaveLength(1);
  });

  it('leads a single nothing can beat into a foe with one card', () => {
    const hand = cards('3 B');
    const ids = botPlay(view(hand, { counts: [2, 1, 10], seen: Array.from({ length: RANKS }, (_, r) => (r === 13 ? 1 : 0)) }));
    expect(ids).toEqual([(hand[1] as Card).id]);
  });
});

describe('botPlay when following', () => {
  it('goes out when it can beat the play with what it has left', () => {
    const hand = cards('9 9');
    expect(sorted(botPlay(view(hand, { me: 1, top: topOf(0, '7 7') })))).toEqual(idsOf(hand));
  });

  it('passes on a play of a friend', () => {
    expect(botPlay(view(cards('9 9 K A 2'), { me: 1, top: topOf(2, '5') }))).toEqual([]);
  });

  it('passes on a play it cannot beat', () => {
    expect(botPlay(view(cards('3 4 5'), { top: topOf(1, 'A') }))).toEqual([]);
  });

  it('beats a play with the lowest card that does it, when that costs nothing', () => {
    const hand = cards('5 7 9 J A');
    expect(botPlay(view(hand, { me: 1, top: topOf(0, '6') }))).toEqual([(hand[1] as Card).id]);
  });

  it('beats a small play even if it has to split a pair for it', () => {
    const hand = cards('3 3 7 7 9 9 Q Q');
    const ids = botPlay(view(hand, { me: 1, top: topOf(0, '5') }));
    expect(ids).toHaveLength(1);
    expect(hand.find((c) => c.id === ids[0])?.rank).toBeLessThan(11);
  });

  it('does not split a pair of aces or twos to beat a king', () => {
    expect(botPlay(view(cards('3 3 7 7 A A 2 2'), { me: 1, top: topOf(0, 'K') }))).toEqual([]);
  });

  it('beats a play it would rather not once a foe is down to three cards', () => {
    const hand = cards('3 3 7 7 A A 2 2');
    const ids = botPlay(view(hand, { me: 1, top: topOf(0, 'K'), counts: [3, 8, 10] }));
    expect(ids).toHaveLength(1);
    expect(hand.find((c) => c.id === ids[0])?.rank).toBeGreaterThan(10);
  });

  it('keeps a bomb for when the foe is about to go out', () => {
    const hand = cards('3 3 3 3 5 7');
    expect(botPlay(view(hand, { me: 1, top: topOf(0, 'K') }))).toEqual([]);
    expect(sorted(botPlay(view(hand, { me: 1, top: topOf(0, 'K'), counts: [2, 6, 10] })))).toEqual(idsOf(hand.slice(0, 4)));
  });
});

describe('sides', () => {
  it('takes the landlord for the foe of the farmers, and the farmers for his', () => {
    expect(sides(view(cards('3'), { me: 1 }))).toEqual({ friends: [2], foes: [0] });
    expect(sides(view(cards('3')))).toEqual({ friends: [], foes: [1, 2] });
  });

  it('takes a landlord in the open for the friend of a hidden landlord, and a seat unknown to him for a foe', () => {
    const roles: (Role | null)[] = ['landlord', null, 'landlord', null, null];
    expect(sides(view(cards('3'), { size: 5, me: 2, roles, lord: 0 }))).toEqual({ friends: [0], foes: [1, 3, 4] });
  });

  it('takes the seats a farmer cannot place for foes while a third of them or more may be landlords', () => {
    const six: (Role | null)[] = ['landlord', null, null, 'farmer', null, null];
    expect(sides(view(cards('3'), { size: 6, me: 3, roles: six, lord: 0 }))).toEqual({ friends: [], foes: [0, 1, 2, 4, 5] });
    const five: (Role | null)[] = ['landlord', null, null, 'farmer', null];
    expect(sides(view(cards('3'), { size: 5, me: 3, roles: five, lord: 0 }))).toEqual({ friends: [], foes: [0, 1, 2, 4] });
  });

  it('takes the seats a farmer cannot place for friends once the landlords are all in the open', () => {
    const all: (Role | null)[] = ['landlord', 'landlord', 'landlord', 'farmer', null, null];
    expect(sides(view(cards('3'), { size: 6, me: 3, roles: all, lord: 0 }))).toEqual({ friends: [4, 5], foes: [0, 1, 2] });
  });
});

describe('hintList', () => {
  const HAND = '3 3 5 7 7 7 9 J Q K A 2 2 2 2';

  it('starts with what a bot would play and lists only plays that are legal, each once', () => {
    const hand = cards(HAND);
    const v = view(hand);
    const list = hintList(v);
    expect(list[0]).toEqual(botPlay(v));
    const keys = list.map((ids) => sorted(ids).join(','));
    expect(new Set(keys).size).toBe(keys.length);
    for (const ids of list) {
      expect(ids.length).toBeGreaterThan(0);
      expect(checkPlay(hand, ids, null, 1)).not.toBeNull();
    }
  });

  it('puts the bombs after the other plays, but for the first', () => {
    const hand = cards(HAND);
    const list = hintList(view(hand));
    const flags = list.slice(1).map((ids) => isBomb((checkPlay(hand, ids, null, 1) as Play).combo));
    expect(flags).toEqual([...flags].sort());
    expect(flags).toContain(true);
  });

  it('offers what beats the top, and no pass', () => {
    const hand = cards(HAND);
    const top = topOf(1, '8');
    const list = hintList(view(hand, { top }));
    expect(list.length).toBeGreaterThan(0);
    for (const ids of list) {
      expect(ids.length).toBeGreaterThan(0);
      expect(checkPlay(hand, ids, top.combo, 1)).not.toBeNull();
    }
  });

  it('still offers plays when a bot would pass on a friend', () => {
    const hand = cards(HAND);
    const v = view(hand, { me: 1, top: topOf(2, '5') });
    expect(botPlay(v)).toEqual([]);
    const list = hintList(v);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((ids) => ids.length > 0)).toBe(true);
  });

  it('has nothing to offer for a play the hand cannot beat', () => {
    expect(hintList(view(cards('3 4 5'), { top: topOf(1, 'A') }))).toEqual([]);
  });
});

describe('revealing', () => {
  const second = cards('5 5')[1] as Card;
  const roles: (Role | null)[] = ['landlord', null, null, null, null];
  const five = (hand: string, over: Partial<TableView> = {}): TableView =>
    view(cards(hand), { size: 5, call: second, hidden: true, roles, ...over });

  it('names the called card, and no other of its rank, in the hand of a landlord nobody knows yet', () => {
    expect(revealing(five('3 5 5 7'))).toBe(second.id);
  });

  it('names nothing when the hand has only the other copy, when the landlord is known, or when no card is called', () => {
    expect(revealing(five('3 5 7'))).toBeNull();
    expect(revealing(five('3 5 5 7', { hidden: false }))).toBeNull();
    expect(revealing(five('3 5 5 7', { call: null }))).toBeNull();
  });
});

describe('choices', () => {
  const key = (ids: readonly number[]): string => sorted(ids).join(',');

  it('lists every play but those that would break up a bomb, and the bomb itself', () => {
    const hand = cards('3 3 3 3 5 9');
    const threes = new Set(idsOf(hand.slice(0, 4)));
    const list = choices(view(hand));
    expect(list.map((p) => key(p.ids))).toContain(key([...threes]));
    for (const play of list) {
      if (key(play.ids) !== key([...threes])) expect(play.ids.some((id) => threes.has(id)), key(play.ids)).toBe(false);
    }
    expect(list.map((p) => key(p.ids))).toContain(key([hand[4]?.id as number]));
  });

  it('keeps the jokers for the rocket when the hand has both', () => {
    const hand = cards('S B 4 6');
    const jokers = hand.filter((c) => c.rank >= SMALL);
    const list = choices(view(hand)).map((p) => key(p.ids));
    expect(list).toContain(key(jokers.map((c) => c.id)));
    for (const joker of jokers) expect(list).not.toContain(key([joker.id]));
  });

  it('breaks up nothing on a single joker, which it lists as a single', () => {
    const hand = cards('S 4 6');
    expect(choices(view(hand)).map((p) => key(p.ids))).toContain(key([hand[0]?.id as number]));
  });

  it('uses the called card first for a hidden landlord, where it takes a card of that rank', () => {
    const hand = cards('3 5 5 7');
    const second = hand[2] as Card;
    const v = view(hand, { size: 5, call: second, hidden: true, roles: ['landlord', null, null, null, null] });
    const singles = choices(v).filter((p) => p.ids.length === 1 && p.combo.rank === second.rank);
    expect(singles.map((p) => p.ids[0])).toEqual([second.id]);
    const plain = choices({ ...v, hidden: false });
    expect(plain.filter((p) => p.ids.length === 1 && p.combo.rank === second.rank).map((p) => p.ids[0])).not.toEqual([second.id]);
  });

  it.each([RICH, MID, POOR])('has every play a bot makes, from the hand %s, at a lead and after a single and a pair', (spec) => {
    for (const top of [null, topOf(1, '4'), topOf(1, '6 6'), topOf(2, 'K')]) {
      const v = view(cards(spec), { me: 1, top });
      const pick = botPlay(v);
      if (pick.length === 0) continue;
      expect(choices(v).map((p) => key(p.ids))).toContain(key(pick));
    }
  });
});

describe('the bots make no illegal play', () => {
  it.each([1, 2, 3])('on any hand from %i pack(s) at any lead', (decks) => {
    const random = lcg(decks * 101);
    const deck = buildDeck(decks);
    for (let n = 0; n < 60; n++) {
      const dealt = shuffle(deck, random);
      const hand = dealt.slice(0, 2 + Math.floor(random() * 31));
      const theirs = dealt.slice(-(1 + Math.floor(random() * 12)));
      const leads = plays(theirs, decks, null);
      const pick = leads[Math.floor(random() * leads.length)] as Play;
      const me = random() < 0.5 ? 0 : 1;
      const top: Top | null = random() < 0.5
        ? null
        : { seat: me === 0 ? 1 : 0, combo: pick.combo, cards: pick.ids.map((id) => theirs.find((c) => c.id === id) as Card) };
      const v = view(hand, { decks, top, me });
      const ids = botPlay(v);
      if (top === null) expect(ids.length, `lead ${n}`).toBeGreaterThan(0);
      if (ids.length) expect(checkPlay(hand, ids, top ? top.combo : null, decks), `play ${n}`).not.toBeNull();
      for (const hint of hintList(v)) expect(checkPlay(hand, hint, top ? top.combo : null, decks), `hint ${n}`).not.toBeNull();
    }
  });
});

describe('a table of bots', () => {
  it.each(SIZES)('plays out %i seats with no wrong move', async (size) => {
    for (let seed = 1; seed <= 20; seed++) {
      const { outcome } = await selfPlay(size, seed);
      expect(outcome.fallbacks, `seed ${seed}`).toBe(0);
      expect(outcome.turns, `seed ${seed}`).toBeLessThan(400);
    }
  });

  it('bids across the whole range at a table that bids', async () => {
    const bases = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) bases.add((await selfPlay(3, seed)).outcome.result.base);
    expect([...bases].sort()).toEqual([1, 2, 3]);
  });

  it('rarely has to deal again', async () => {
    let redeals = 0;
    for (let seed = 1; seed <= 100; seed++) {
      redeals += (await selfPlay(3, seed)).entries.filter((e) => e.k === 'redeal').length;
    }
    expect(redeals).toBeLessThan(15);
  });
});

/** A seat that plays any play it may, and passes now and then when it may. */
function wander(rnd: () => number, table: Table, seat: number): Reply {
  const top = table.top;
  const all = plays(table.p(seat).hand, table.decks, top ? top.combo : null);
  if (all.length === 0 || (top !== null && rnd() < 0.3)) return { k: 'play', ids: [] };
  return { k: 'play', ids: (all[Math.floor(rnd() * all.length)] as Play).ids };
}

/** Bots on one side, seats that wander on the other. The bids are always the bots'. */
const against = (botSide: Role, rnd: () => number): Script => (seat, ask: Ask, table) => {
  const lords = table.landlords();
  if (ask.k === 'bid' || lords.length === 0) return undefined;
  return lords.includes(seat) === (botSide === 'landlord') ? undefined : wander(rnd, table, seat);
};

describe('the bots against seats that wander', () => {
  it.each(SIZES)('win most games at %i seats, on either side', async (size) => {
    const rnd = lcg(size * 17);
    const games = 60;
    for (const side of ['landlord', 'farmer'] as const) {
      let wins = 0;
      for (let seed = 1; seed <= games; seed++) {
        const { outcome } = await selfPlay(size, seed, against(side, rnd));
        if (outcome.result.winner === side) wins++;
      }
      expect(wins / games, `${side} side`).toBeGreaterThan(0.7);
    }
  });
});
