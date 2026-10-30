import { describe, expect, it } from 'vitest';
import {
  ARMORS, BASIC, CARD_NAMES, DECK_COUNTS, DECK_SIZE, DELAYED, HORSES_MINUS, HORSES_PLUS, RANGE, SLOTS, SUITS,
  SUIT_SIGN, TRICKS, WEAPONS, buildDeck, infoOf, isBlack, isImmediateTrick, isRed, isRedSuit, kindOf, rankLabel,
  shuffle, slotOf, type Card, type CardName, type Kind,
} from '../../../src/shared/teammate/sanguoshaCards';

const count = (cards: readonly Card[], name: CardName): number => cards.filter((c) => c.name === name).length;

describe('the deck', () => {
  const deck = buildDeck();

  it('holds 102 cards, numbered from 1 in order', () => {
    expect(DECK_SIZE).toBe(102);
    expect(deck).toHaveLength(102);
    expect(deck.map((c) => c.id)).toEqual(Array.from({ length: 102 }, (_, i) => i + 1));
  });

  it('lists every card name once, and every name in the list is a card of the game', () => {
    const names = DECK_COUNTS.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...CARD_NAMES].sort());
    expect(DECK_COUNTS.every(([, n]) => Number.isInteger(n) && n >= 1)).toBe(true);
  });

  it('has as many of each card as the list says, in the order of the list', () => {
    for (const [name, n] of DECK_COUNTS) expect(count(deck, name), name).toBe(n);
    expect(deck.map((c) => c.name)).toEqual(DECK_COUNTS.flatMap(([name, n]) => Array<CardName>(n).fill(name)));
  });

  it('is 53 basic cards, 27 tricks, 6 delayed tricks, 7 weapons, 3 armours and 6 horses', () => {
    const by = (kind: Kind): number => deck.filter((c) => kindOf(c.name) === kind).length;
    expect([by('basic'), by('trick'), by('delayed'), by('weapon'), by('armor'), by('plus'), by('minus')]).toEqual([
      53, 27, 6, 7, 3, 3, 3,
    ]);
    expect([count(deck, 'sha'), count(deck, 'shan'), count(deck, 'tao')]).toEqual([30, 15, 8]);
  });

  it('gives card number n the suit n mod 4 and the rank (7n mod 13) + 1', () => {
    deck.forEach((card, n) => {
      expect(card.suit).toBe(SUITS[n % 4]);
      expect(card.rank).toBe(((n * 7) % 13) + 1);
    });
  });

  it('walks through all 52 suit and rank pairs before it repeats one', () => {
    const pairs = deck.map((c) => `${c.suit}${c.rank}`);
    expect(new Set(pairs.slice(0, 52)).size).toBe(52);
    expect(new Set(pairs).size).toBe(52);
    const seen = new Map<string, number>();
    for (const pair of pairs) seen.set(pair, (seen.get(pair) ?? 0) + 1);
    expect([...seen.values()].every((n) => n === 1 || n === 2)).toBe(true);
    expect(deck.every((c) => Number.isInteger(c.rank) && c.rank >= 1 && c.rank <= 13)).toBe(true);
  });

  it('mixes the suits in every card that comes four or more times', () => {
    for (const [name, n] of DECK_COUNTS.filter(([, k]) => k >= 4)) {
      const suits = new Set(deck.filter((c) => c.name === name).map((c) => c.suit));
      expect(suits.size, `${name} ×${n}`).toBe(4);
    }
  });

  it('is a new deck, not shared, whenever it is built', () => {
    const other = buildDeck();
    expect(other).toEqual(deck);
    expect(other[0]).not.toBe(deck[0]);
    other.reverse();
    expect(buildDeck()).toEqual(deck);
  });
});

describe('kinds of cards', () => {
  const groups: [string, readonly CardName[], Kind][] = [
    ['basic cards', BASIC, 'basic'],
    ['tricks', TRICKS, 'trick'],
    ['delayed tricks', DELAYED, 'delayed'],
    ['weapons', WEAPONS, 'weapon'],
    ['armour', ARMORS, 'armor'],
    ['horses of +1', HORSES_PLUS, 'plus'],
    ['horses of −1', HORSES_MINUS, 'minus'],
  ];

  it('are told apart by kindOf, and every card is of exactly one kind', () => {
    for (const [what, names, kind] of groups) for (const name of names) expect(kindOf(name), `${what}: ${name}`).toBe(kind);
    expect(groups.flatMap(([, names]) => names).sort()).toEqual([...CARD_NAMES].sort());
  });

  it('send equipment to its slot with slotOf, and nothing else anywhere', () => {
    expect([...SLOTS]).toEqual(['weapon', 'armor', 'plus', 'minus']);
    for (const name of WEAPONS) expect(slotOf(name)).toBe('weapon');
    for (const name of ARMORS) expect(slotOf(name)).toBe('armor');
    for (const name of HORSES_PLUS) expect(slotOf(name)).toBe('plus');
    for (const name of HORSES_MINUS) expect(slotOf(name)).toBe('minus');
    for (const name of [...BASIC, ...TRICKS, ...DELAYED]) expect(slotOf(name), name).toBeNull();
  });

  it('count as tricks that work at once only for the tricks that are not delayed', () => {
    for (const name of TRICKS) expect(isImmediateTrick(name), name).toBe(true);
    for (const name of [...BASIC, ...DELAYED, ...WEAPONS, ...ARMORS, ...HORSES_PLUS, ...HORSES_MINUS]) {
      expect(isImmediateTrick(name), name).toBe(false);
    }
  });

  it('give each weapon the reach of its own', () => {
    expect(RANGE).toEqual({ zhuge: 1, qinggang: 2, qinglong: 3, guanshi: 3, fangtian: 4, qilin: 5 });
    expect(Object.keys(RANGE).sort()).toEqual([...WEAPONS].sort());
  });
});

describe('suits and ranks', () => {
  it('are red for hearts and diamonds and black for spades and clubs', () => {
    expect(SUITS.map(isRedSuit)).toEqual([false, true, false, true]);
    const card = (suit: (typeof SUITS)[number]): Card => ({ id: 1, name: 'sha', suit, rank: 5 });
    expect(SUITS.map((s) => isRed(card(s)))).toEqual([false, true, false, true]);
    expect(SUITS.map((s) => isBlack(card(s)))).toEqual([true, false, true, false]);
  });

  it('have a sign each', () => {
    expect(SUITS.map((s) => SUIT_SIGN[s])).toEqual(['♠', '♥', '♣', '♦']);
  });

  it('are shown as A, 2 to 10, J, Q and K', () => {
    expect([1, 2, 9, 10, 11, 12, 13].map(rankLabel)).toEqual(['A', '2', '9', '10', 'J', 'Q', 'K']);
    expect([0, 14, -1].map(rankLabel)).toEqual(['?', '?', '?']);
  });

  it('are all that is kept of a card once it is out on the table', () => {
    const card: Card = { id: 77, name: 'tao', suit: 'heart', rank: 3 };
    expect(infoOf(card)).toEqual({ name: 'tao', suit: 'heart', rank: 3 });
    expect(Object.keys(infoOf(card)).sort()).toEqual(['name', 'rank', 'suit']);
  });
});

describe('shuffle', () => {
  const seeded = (seed: number): (() => number) => {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  };

  it('shuffles in place and hands the same list back', () => {
    const items = [1, 2, 3, 4, 5];
    expect(shuffle(items, seeded(7))).toBe(items);
    expect([...items].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps every card, and a whole deck is still a whole deck', () => {
    const cards = buildDeck();
    shuffle(cards, seeded(99));
    expect(cards).toHaveLength(102);
    expect(new Set(cards.map((c) => c.id)).size).toBe(102);
    expect(cards.map((c) => c.id)).not.toEqual(buildDeck().map((c) => c.id));
  });

  it('is decided by the random numbers alone', () => {
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
    expect(shuffle([1, 2, 3, 4], () => 0.9999999)).toEqual([1, 2, 3, 4]);
    expect(shuffle(buildDeck().map((c) => c.id), seeded(5))).toEqual(shuffle(buildDeck().map((c) => c.id), seeded(5)));
  });

  it('never reaches past the end of the list, even if the random number is too large', () => {
    expect(shuffle([1, 2, 3, 4], () => 1)).toEqual([1, 2, 3, 4]);
    expect(shuffle([1, 2, 3, 4], () => 7)).toEqual([1, 2, 3, 4]);
  });

  it('leaves lists of none or one as they were', () => {
    expect(shuffle([], seeded(1))).toEqual([]);
    expect(shuffle(['only'], seeded(1))).toEqual(['only']);
  });

  it('reaches every order of three about as often as any other', () => {
    const rnd = seeded(2024);
    const seen = new Map<string, number>();
    for (let i = 0; i < 6000; i++) {
      const key = shuffle([0, 1, 2], rnd).join('');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect(seen.size).toBe(6);
    for (const n of seen.values()) {
      expect(n).toBeGreaterThan(800);
      expect(n).toBeLessThan(1200);
    }
  });
});
