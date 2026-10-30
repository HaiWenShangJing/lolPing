import { describe, expect, it } from 'vitest';
import {
  BIG, MAX_CARDS, PACK, RANKS, SMALL, SUITS, TWO, beats, buildDeck, canonical, checkPlay, countRanks, isBomb, plays,
  readings, shapeOf, shuffle, sortHand, rankLabel,
} from '../../../src/shared/teammate/doudizhuCards';
import type { Card, Combo, Kind } from '../../../src/shared/teammate/doudizhuCards';
import { lcg } from '../../main/teammate/gameFakes';

const LABEL = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'S', 'B'];

/** Cards from a spelled-out hand such as '3 3 4 J S': every copy of a rank gets a card of its own. */
function cards(spec: string): Card[] {
  const seen = new Array<number>(RANKS).fill(0);
  return spec.split(/\s+/).filter(Boolean).map((tok) => {
    const rank = LABEL.indexOf(tok);
    if (rank < 0) throw new Error(`bad card ${tok}`);
    const k = seen[rank]++ as number;
    if (rank >= SMALL) return { id: k * PACK + 52 + (rank - SMALL), rank, suit: null };
    const suit = SUITS[k % 4] as (typeof SUITS)[number];
    return { id: Math.floor(k / 4) * PACK + SUITS.indexOf(suit) * 13 + rank, rank, suit };
  });
}

const combo = (kind: Kind, rank: number, len: number, wing: 0 | 1 | 2, size: number): Combo =>
  ({ kind, rank, len, wing, size });
const read = (spec: string, decks = 1): Combo[] => readings(cards(spec), decks);
const r = (label: string): number => LABEL.indexOf(label);
const key = (c: Combo): string => `${c.kind}:${c.rank}:${c.len}:${c.wing}:${c.size}`;

describe('the deck', () => {
  it.each([1, 2, 3])('has 54 cards a pack, each with an id of its own, for %i packs', (decks) => {
    const deck = buildDeck(decks);
    expect(deck).toHaveLength(PACK * decks);
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
    expect(Math.max(...deck.map((c) => c.id))).toBe(deck.length - 1);
    expect(deck.length).toBeLessThanOrEqual(MAX_CARDS);
    const counts = countRanks(deck);
    for (let rank = 0; rank <= TWO; rank++) expect(counts[rank]).toBe(4 * decks);
    expect(counts[SMALL]).toBe(decks);
    expect(counts[BIG]).toBe(decks);
  });

  it('has the four suits of every plain rank and no suit on a joker', () => {
    const deck = buildDeck(1);
    for (const suit of SUITS) expect(deck.filter((c) => c.suit === suit)).toHaveLength(13);
    expect(deck.filter((c) => c.suit === null).map((c) => c.rank)).toEqual([SMALL, BIG]);
  });

  it('puts the cards of a pack in ids of its own range', () => {
    const deck = buildDeck(2);
    expect(deck.slice(0, PACK).every((c) => c.id < PACK)).toBe(true);
    expect(deck.slice(PACK).every((c) => c.id >= PACK)).toBe(true);
  });

  it('shuffles to the same cards in another order, the same way for the same random', () => {
    const deck = buildDeck(1);
    const a = shuffle(deck, lcg(7));
    const b = shuffle(deck, lcg(7));
    const c = shuffle(deck, lcg(8));
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a.map((x) => x.id)).not.toEqual(c.map((x) => x.id));
    expect(a.map((x) => x.id).sort((x, y) => x - y)).toEqual(deck.map((x) => x.id));
    expect(a.map((x) => x.id)).not.toEqual(deck.map((x) => x.id));
  });

  it('lays a hand out from the highest card down', () => {
    const sorted = sortHand(cards('3 S 7 2 B A 7'));
    expect(sorted.map((c) => c.rank)).toEqual([BIG, SMALL, TWO, r('A'), r('7'), r('7'), r('3')]);
  });

  it('labels the plain ranks and leaves the jokers to the words', () => {
    expect(RANKS).toBe(15);
    expect([0, 7, 8, 11, 12].map(rankLabel)).toEqual(['3', '10', 'J', 'A', '2']);
    expect(rankLabel(SMALL)).toBe('');
  });
});

describe('what a set of cards is', () => {
  it('reads single cards, pairs and triples', () => {
    expect(read('7')).toEqual([combo('single', r('7'), 1, 0, 1)]);
    expect(read('S')).toEqual([combo('single', SMALL, 1, 0, 1)]);
    expect(read('B')).toEqual([combo('single', BIG, 1, 0, 1)]);
    expect(read('2 2')).toEqual([combo('pair', TWO, 1, 0, 2)]);
    expect(read('9 9 9')).toEqual([combo('triple', r('9'), 1, 0, 3)]);
    expect(read('')).toEqual([]);
  });

  it('reads a triple with a single or a pair riding along, and nothing else of that size', () => {
    expect(read('9 9 9 4')).toEqual([combo('triple', r('9'), 1, 1, 4)]);
    expect(read('9 9 9 B')).toEqual([combo('triple', r('9'), 1, 1, 4)]);
    expect(read('9 9 9 4 4')).toEqual([combo('triple', r('9'), 1, 2, 5)]);
    expect(read('2 2 2 3 3')).toEqual([combo('triple', TWO, 1, 2, 5)]);
    expect(read('9 9 9 4 5')).toEqual([]);
    expect(read('9 9 4 4')).toEqual([]);
    expect(read('9 9 9 S B')).toEqual([]);
  });

  it('reads four or more of a rank as a bomb, of every size the table has', () => {
    expect(read('5 5 5 5')).toEqual([combo('bomb', r('5'), 1, 0, 4)]);
    expect(read('2 2 2 2')).toEqual([combo('bomb', TWO, 1, 0, 4)]);
    expect(read('5 5 5 5 5', 2)).toEqual([combo('bomb', r('5'), 1, 0, 5)]);
    expect(read('5 5 5 5 5 5 5 5', 2)).toEqual([combo('bomb', r('5'), 1, 0, 8)]);
    expect(read('K K K K K K K K K K K K', 3)).toEqual([combo('bomb', r('K'), 1, 0, 12)]);
  });

  it('reads a four with two singles or two pairs riding along', () => {
    expect(read('5 5 5 5 3 4')).toEqual([combo('four', r('5'), 1, 1, 6)]);
    expect(read('5 5 5 5 3 3')).toEqual([combo('four', r('5'), 1, 1, 6)]);
    expect(read('5 5 5 5 S B')).toEqual([combo('four', r('5'), 1, 1, 6)]);
    expect(read('5 5 5 5 3 3 4 4')).toEqual([combo('four', r('5'), 1, 2, 8)]);
    expect(read('5 5 5 5 3 4')).toHaveLength(1);
    expect(read('5 5 5 5 3 4 6 7')).toEqual([]);
    expect(read('5 5 5 5 5 3', 2)).toEqual([]);
    expect(read('5 5 5 5 3 3 4 4 6 6')).toEqual([]);
  });

  it('reads two fours as a four with two pairs, either one the body', () => {
    const both = read('3 3 3 3 4 4 4 4', 2);
    expect(both.map(key).sort()).toEqual([key(combo('four', 0, 1, 2, 8)), key(combo('four', 1, 1, 2, 8))].sort());
    expect(canonical(both)).toEqual(combo('four', 1, 1, 2, 8));
  });

  it('reads a straight of five to twelve cards from 3 up to the ace, and no other', () => {
    expect(read('3 4 5 6 7')).toEqual([combo('straight', 0, 5, 0, 5)]);
    expect(read('10 J Q K A')).toEqual([combo('straight', r('10'), 5, 0, 5)]);
    expect(read('3 4 5 6 7 8 9 10 J Q K A')).toEqual([combo('straight', 0, 12, 0, 12)]);
    expect(read('3 4 5 6')).toEqual([]);
    expect(read('J Q K A 2')).toEqual([]);
    expect(read('3 4 5 6 8')).toEqual([]);
    expect(read('3 4 5 6 S')).toEqual([]);
    expect(read('4 5 6 7 7')).toEqual([]);
  });

  it('reads a run of three or more pairs, and no other', () => {
    expect(read('3 3 4 4 5 5')).toEqual([combo('pairs', 0, 3, 0, 6)]);
    expect(read('Q Q K K A A')).toEqual([combo('pairs', r('Q'), 3, 0, 6)]);
    expect(read('3 3 4 4 5 5 6 6 7 7 8 8 9 9 10 10 J J Q Q K K A A')).toEqual([combo('pairs', 0, 12, 0, 24)]);
    expect(read('3 3 4 4')).toEqual([]);
    expect(read('K K A A 2 2')).toEqual([]);
    expect(read('3 3 4 4 5 5 7 7')).toEqual([]);
    expect(read('3 3 4 4 5 6')).toEqual([]);
  });

  it('reads a run of triples as a plane, with a single or a pair for each triple or with nothing', () => {
    expect(read('3 3 3 4 4 4')).toEqual([combo('plane', 0, 2, 0, 6)]);
    expect(read('K K K A A A')).toEqual([combo('plane', r('K'), 2, 0, 6)]);
    expect(read('3 3 3 4 4 4 5 5 5')).toEqual([combo('plane', 0, 3, 0, 9)]);
    expect(read('3 3 3 4 4 4 5 6')).toEqual([combo('plane', 0, 2, 1, 8)]);
    expect(read('3 3 3 4 4 4 5 5')).toEqual([combo('plane', 0, 2, 1, 8)]);
    expect(read('3 3 3 4 4 4 S B')).toEqual([combo('plane', 0, 2, 1, 8)]);
    expect(read('3 3 3 4 4 4 5 5 6 6')).toEqual([combo('plane', 0, 2, 2, 10)]);
    expect(read('3 3 3 4 4 4 5 5 5 7 8 9')).toEqual([combo('plane', 0, 3, 1, 12)]);
    expect(read('3 3 3 4 4 4 5 5 5 7 7 8 8 9 9')).toEqual([combo('plane', 0, 3, 2, 15)]);
  });

  it('turns down planes that are not planes', () => {
    expect(read('A A A 2 2 2')).toEqual([]);
    expect(read('3 3 3 5 5 5')).toEqual([]);
    expect(read('3 3 3 4 4 4 5 5 5 6')).toEqual([]);
    expect(read('3 3 3 4 4 4 5 6 7')).toEqual([]);
    expect(read('3 3 3 4 4 4 5 6 6 6')).toEqual([]);
    expect(read('3 3 3 4 4 4 5 5 5 6 6 6 6', 2)).toEqual([]);
    expect(read('3 3 3 4 4 4 5 5 6 7')).toEqual([]);
  });

  it('does not let the cards that ride along share the rank of the body', () => {
    expect(read('3 3 3 3 4 4 4 5')).toEqual([]);
    expect(read('3 3 3 3 4')).toEqual([]);
    expect(read('3 3 3 3 4 4')).toEqual([combo('four', 0, 1, 1, 6)]);
  });

  it('reads a run of triples that could be a longer or a shorter plane every way', () => {
    const twelve = read('3 3 3 4 4 4 5 5 5 6 6 6');
    expect(twelve.map(key).sort()).toEqual([
      key(combo('plane', 0, 4, 0, 12)), key(combo('plane', 0, 3, 1, 12)), key(combo('plane', 1, 3, 1, 12)),
    ].sort());
    expect(canonical(twelve)).toEqual(combo('plane', 0, 4, 0, 12));
    expect(canonical([])).toBeNull();
  });

  it('keeps the jokers out of every run, but lets them pair and triple when the table has several', () => {
    expect(read('S S', 2)).toEqual([combo('pair', SMALL, 1, 0, 2)]);
    expect(read('B B', 2)).toEqual([combo('pair', BIG, 1, 0, 2)]);
    expect(read('S B', 2)).toEqual([]);
    expect(read('S S B', 2)).toEqual([]);
    expect(read('S S S', 3)).toEqual([combo('triple', SMALL, 1, 0, 3)]);
    expect(read('S S S S', 3)).toEqual([]);
    expect(read('2 2 2 S S', 2)).toEqual([combo('triple', TWO, 1, 2, 5)]);
    expect(read('K A S B B')).toEqual([]);
  });

  it('reads all the jokers of the table together as the rocket, and nothing less', () => {
    expect(read('S B', 1)).toEqual([combo('rocket', BIG, 1, 0, 2)]);
    expect(read('S S B B', 2)).toEqual([combo('rocket', BIG, 1, 0, 4)]);
    expect(read('S S S B B B', 3)).toEqual([combo('rocket', BIG, 1, 0, 6)]);
    expect(read('S S B B B', 3)).toEqual([]);
    expect(read('S S S B B B 3', 3)).toEqual([]);
  });

  it('names every shape, and calls only the bomb and the rocket bombs', () => {
    const shapes = new Map<string, string>([
      ['7', 'single'], ['7 7', 'pair'], ['7 7 7', 'triple'], ['7 7 7 3', 'tripleOne'], ['7 7 7 3 3', 'triplePair'],
      ['3 4 5 6 7', 'straight'], ['3 3 4 4 5 5', 'pairs'], ['3 3 3 4 4 4', 'plane'], ['3 3 3 4 4 4 5 6', 'planeOne'],
      ['3 3 3 4 4 4 5 5 6 6', 'planePair'], ['7 7 7 7 3 4', 'fourTwo'], ['7 7 7 7 3 3 4 4', 'fourPairs'],
      ['7 7 7 7', 'bomb'], ['S B', 'rocket'],
    ]);
    for (const [spec, shape] of shapes) {
      const c = read(spec)[0] as Combo;
      expect(shapeOf(c), spec).toBe(shape);
      expect(isBomb(c), spec).toBe(shape === 'bomb' || shape === 'rocket');
    }
  });
});

describe('which play beats which', () => {
  const one = (spec: string, decks = 1): Combo => canonical(read(spec, decks)) as Combo;

  it('beats a play of its own kind and size with a higher rank, and nothing else', () => {
    expect(beats(one('6'), one('5'))).toBe(true);
    expect(beats(one('5'), one('6'))).toBe(false);
    expect(beats(one('5'), one('5'))).toBe(false);
    expect(beats(one('7 7'), one('6')) || beats(one('6 6'), one('7'))).toBe(false);
    expect(beats(one('7 7'), one('6 6'))).toBe(true);
    expect(beats(one('4 4 4'), one('3 3 3'))).toBe(true);
    expect(beats(one('4 5 6 7 8'), one('3 4 5 6 7'))).toBe(true);
    expect(beats(one('4 5 6 7 8 9'), one('3 4 5 6 7'))).toBe(false);
    expect(beats(one('4 4 5 5 6 6'), one('3 3 4 4 5 5'))).toBe(true);
    expect(beats(one('4 4 4 5 5 5'), one('3 3 3 4 4 4'))).toBe(true);
  });

  it('ranks the jokers above the two, and the big one above the small', () => {
    expect(beats(one('2'), one('A'))).toBe(true);
    expect(beats(one('S'), one('2'))).toBe(true);
    expect(beats(one('B'), one('S'))).toBe(true);
    expect(beats(one('S'), one('B'))).toBe(false);
  });

  it('judges what rides along by the body only, and the same kind of rider with the same body', () => {
    expect(beats(one('8 8 8 3'), one('7 7 7 9'))).toBe(true);
    expect(beats(one('8 8 8 3 3'), one('7 7 7 9'))).toBe(false);
    expect(beats(one('8 8 8 3'), one('7 7 7'))).toBe(false);
    expect(beats(one('4 4 4 5 5 5 7 8'), one('3 3 3 4 4 4 5 5 6 6'))).toBe(false);
    expect(beats(one('4 4 4 5 5 5 7 8'), one('3 3 3 4 4 4 9 J'))).toBe(true);
    expect(beats(one('9 9 9 9 3 4'), one('8 8 8 8 K A'))).toBe(true);
    expect(beats(one('9 9 9 9 3 3 4 4'), one('8 8 8 8 K A'))).toBe(false);
  });

  it('lets a bomb beat every other kind, and nothing but a bigger bomb beat it', () => {
    expect(beats(one('3 3 3 3'), one('B'))).toBe(true);
    expect(beats(one('3 3 3 3'), one('A A A 3 4'.replace(' 3 4', '')))).toBe(true);
    expect(beats(one('3 4 5 6 7 8 9 10 J Q K A'), one('3 3 3 3'))).toBe(false);
    expect(beats(one('2'), one('3 3 3 3'))).toBe(false);
    expect(beats(one('4 4 4 4'), one('3 3 3 3'))).toBe(true);
    expect(beats(one('3 3 3 3'), one('4 4 4 4'))).toBe(false);
    expect(beats(one('3 3 3 3'), one('3 3 3 3'))).toBe(false);
  });

  it('puts a bomb of more cards above one of fewer, whatever the rank', () => {
    expect(beats(one('3 3 3 3 3', 2), one('2 2 2 2', 2))).toBe(true);
    expect(beats(one('2 2 2 2', 2), one('3 3 3 3 3', 2))).toBe(false);
    expect(beats(one('3 3 3 3 3 3', 2), one('K K K K K', 2))).toBe(true);
    expect(beats(one('4 4 4 4 4', 2), one('3 3 3 3 3', 2))).toBe(true);
  });

  it('lets the rocket beat everything, bombs of any size included, and nothing beat it', () => {
    const rocket = one('S S B B', 2);
    for (const other of ['3 3 3 3', '2 2 2 2 2 2 2 2', 'B B', '3 4 5 6 7']) {
      expect(beats(rocket, one(other, 2)), other).toBe(true);
      expect(beats(one(other, 2), rocket), other).toBe(false);
    }
    expect(beats(rocket, rocket)).toBe(false);
  });
});

describe('what a player may play', () => {
  const hand = cards('3 3 4 5 6 7 7 7 9 J S B');
  const ids = (spec: string): number[] => cards(spec).map((c) => c.id);

  it('turns the ids of cards in the hand into a play, or refuses them', () => {
    expect(checkPlay(hand, ids('7 7'), null, 1)).toEqual({ ids: ids('7 7'), combo: combo('pair', r('7'), 1, 0, 2) });
    expect(checkPlay(hand, ids('3 4 5 6 7'), null, 1)?.combo).toEqual(combo('straight', 0, 5, 0, 5));
    expect(checkPlay(hand, [], null, 1)).toBeNull();
    expect(checkPlay(hand, ids('7 7'.concat(' 7 7')), null, 1)).toBeNull();
    expect(checkPlay(hand, ids('3 9'), null, 1)).toBeNull();
    expect(checkPlay(hand, [ids('7')[0] as number, ids('7')[0] as number], null, 1)).toBeNull();
    expect(checkPlay(hand, [999], null, 1)).toBeNull();
    expect(checkPlay(hand, [-1, 0], null, 1)).toBeNull();
  });

  it('asks that a play beats the one on the table', () => {
    expect(checkPlay(hand, ids('7 7'), combo('pair', r('6'), 1, 0, 2), 1)).not.toBeNull();
    expect(checkPlay(hand, ids('7 7'), combo('pair', r('7'), 1, 0, 2), 1)).toBeNull();
    expect(checkPlay(hand, ids('7 7'), combo('single', r('3'), 1, 0, 1), 1)).toBeNull();
    expect(checkPlay(hand, ids('S B'), combo('triple', TWO, 1, 0, 3), 1)?.combo.kind).toBe('rocket');
    expect(checkPlay(hand, ids('S'), combo('single', TWO, 1, 0, 1), 1)).not.toBeNull();
  });

  it('keeps the reading that beats the play on the table when a set has several', () => {
    const twelve = cards('4 4 4 5 5 5 6 6 6 7 7 7');
    const all = twelve.map((c) => c.id);
    expect(checkPlay(twelve, all, null, 1)?.combo).toEqual(combo('plane', 1, 4, 0, 12));
    const shorter = checkPlay(twelve, all, combo('plane', 0, 3, 1, 12), 1)?.combo;
    expect(shorter?.len).toBe(3);
    expect(shorter?.wing).toBe(1);
    expect(checkPlay(twelve, all, combo('plane', 3, 3, 1, 12), 1)).toBeNull();
    expect(checkPlay(twelve, all, combo('plane', 0, 4, 0, 12), 1)?.combo).toEqual(combo('plane', 1, 4, 0, 12));
  });
});

/** Every way of choosing cards from a hand, read every way, as the shapes it comes to. */
function everyShape(hand: readonly Card[], decks: number): Set<string> {
  const found = new Set<string>();
  for (let mask = 1; mask < 1 << hand.length; mask++) {
    const pick = hand.filter((_, i) => (mask >> i) & 1);
    for (const c of readings(pick, decks)) found.add(key(c));
  }
  return found;
}

/** A random hand of `n` cards from `decks` packs. */
const deal = (decks: number, n: number, random: () => number): Card[] => shuffle(buildDeck(decks), random).slice(0, n);

/** A hand with the runs and the repeats that shapes are made of, so that most of them turn up. */
function rich(decks: number, n: number, random: () => number): Card[] {
  const deck = buildDeck(decks);
  const low = deck.filter((c) => c.rank <= 7 || c.rank >= SMALL);
  return shuffle(low, random).slice(0, n);
}

describe('every play a hand can make', () => {
  it.each([1, 2, 3])('finds every shape that some cards of the hand make, and no other, for %i packs', (decks) => {
    for (let seed = 1; seed <= 25; seed++) {
      const random = lcg(seed * 31 + decks);
      const hand = seed % 2 ? rich(decks, 11, random) : deal(decks, 11, random);
      const found = new Set(plays(hand, decks, null).map((p) => key(p.combo)));
      expect(found, `seed ${seed}`).toEqual(everyShape(hand, decks));
    }
  });

  it.each([1, 2, 3])('finds only plays that are legal, each made of cards in the hand, for %i packs', (decks) => {
    for (let seed = 1; seed <= 25; seed++) {
      const random = lcg(seed * 17 + decks);
      const hand = rich(decks, 14, random);
      const byId = new Map(hand.map((c) => [c.id, c]));
      for (const play of plays(hand, decks, null)) {
        expect(new Set(play.ids).size).toBe(play.ids.length);
        const picked = play.ids.map((id) => byId.get(id) as Card);
        expect(picked.every(Boolean)).toBe(true);
        expect(picked).toHaveLength(play.combo.size);
        expect(readings(picked, decks).map(key)).toContain(key(play.combo));
        expect(checkPlay(hand, play.ids, null, decks)).not.toBeNull();
      }
    }
  });

  it.each([1, 2, 3])('finds, after a play, exactly the plays of the lead that beat it, for %i packs', (decks) => {
    for (let seed = 1; seed <= 25; seed++) {
      const random = lcg(seed * 13 + decks);
      const hand = rich(decks, 12, random);
      const lead = plays(hand, decks, null);
      const others = plays(rich(decks, 12, lcg(seed * 7 + 1)), decks, null);
      for (const other of others.slice(0, 12)) {
        const top = other.combo;
        const follow = plays(hand, decks, top);
        expect(new Set(follow.map((p) => key(p.combo))), `seed ${seed} top ${key(top)}`)
          .toEqual(new Set(lead.filter((p) => beats(p.combo, top)).map((p) => key(p.combo))));
        for (const play of follow) expect(checkPlay(hand, play.ids, top, decks), key(top)).not.toBeNull();
      }
    }
  });

  it('plays each body once, with the cheapest cards of the hand to ride along', () => {
    const hand = cards('3 5 5 8 9 9 9 K K A');
    const triple = plays(hand, 1, null).filter((p) => p.combo.kind === 'triple' && p.combo.wing === 1);
    expect(triple).toHaveLength(1);
    const rank = (ids: number[]): number[] => ids.map((id) => (hand.find((c) => c.id === id) as Card).rank).sort((a, b) => a - b);
    expect(rank((triple[0] as { ids: number[] }).ids)).toEqual([r('3'), r('9'), r('9'), r('9')]);
    const pair = plays(hand, 1, null).filter((p) => p.combo.kind === 'triple' && p.combo.wing === 2);
    expect(rank((pair[0] as { ids: number[] }).ids)).toEqual([r('5'), r('5'), r('9'), r('9'), r('9')]);
  });

  it('breaks a pair for a rider only when no single is left to give, and a bomb last of all', () => {
    const hand = cards('4 4 5 5 5 5 8 8 8');
    const wing = plays(hand, 1, null).find((p) => p.combo.kind === 'triple' && p.combo.wing === 1 && p.combo.rank === r('8'));
    const ranks = (wing as { ids: number[] }).ids.map((id) => (hand.find((c) => c.id === id) as Card).rank);
    expect(ranks.filter((x) => x === r('8'))).toHaveLength(3);
    expect(ranks).toContain(r('4'));
    expect(ranks).not.toContain(r('5'));
  });

  it('takes a preferred card before the others of its rank', () => {
    const hand = cards('7 7 7 7 9');
    const spare = (hand[3] as Card).id;
    const single = plays(hand, 1, null, { prefer: spare }).find((p) => p.combo.kind === 'single' && p.combo.rank === r('7'));
    expect(single?.ids).toEqual([spare]);
    const pair = plays(hand, 1, null, { prefer: spare }).find((p) => p.combo.kind === 'pair');
    expect(pair?.ids[0]).toBe(spare);
    const none = plays(hand, 1, null).find((p) => p.combo.kind === 'single' && p.combo.rank === r('7'));
    expect(none?.ids).toEqual([(hand[0] as Card).id]);
  });

  it('keeps the ranks it is told to keep out of every play but a bomb or the rocket', () => {
    const hand = cards('5 5 5 5 3 4 6 7 8 9 10 S B');
    const keep = new Set([r('5'), SMALL, BIG]);
    const list = plays(hand, 1, null, { keep });
    const byId = new Map(hand.map((c) => [c.id, c]));
    expect(list.some((p) => p.combo.kind === 'bomb' && p.combo.rank === r('5'))).toBe(true);
    expect(list.some((p) => p.combo.kind === 'rocket')).toBe(true);
    for (const p of list.filter((x) => !isBomb(x.combo))) {
      for (const id of p.ids) expect(keep.has((byId.get(id) as Card).rank), key(p.combo)).toBe(false);
    }
    expect(list.some((p) => p.combo.kind === 'straight')).toBe(true);
    expect(plays(hand, 1, null).some((p) => p.combo.kind === 'four')).toBe(true);
    expect(list.some((p) => p.combo.kind === 'four')).toBe(false);
  });

  it('finds no play in a hand that has none', () => {
    expect(plays([], 1, null)).toEqual([]);
    expect(plays(cards('3 5'), 1, combo('single', BIG, 1, 0, 1))).toEqual([]);
    expect(plays(cards('3 5 S'), 1, combo('rocket', BIG, 1, 0, 2))).toEqual([]);
  });

  it('plays the rocket only when the hand has every joker of the table', () => {
    expect(plays(cards('S B 3'), 1, null).some((p) => p.combo.kind === 'rocket')).toBe(true);
    expect(plays(cards('S B B 3'), 2, null).some((p) => p.combo.kind === 'rocket')).toBe(false);
    expect(plays(cards('S S B B 3'), 2, null).some((p) => p.combo.kind === 'rocket')).toBe(true);
    const rocket = plays(cards('S S B B 3'), 2, combo('bomb', TWO, 1, 0, 8)).filter((p) => p.combo.kind === 'rocket');
    expect(rocket).toHaveLength(1);
    expect(rocket[0]?.ids).toHaveLength(4);
  });

  it('takes the riders of a four from a bomb rank when no other rank has a pair to give', () => {
    const hand = cards('3 3 3 3 5 5 5 5 5 5 5 5 7');
    expect(hand).toHaveLength(13);
    const four = plays(hand, 2, null).filter((p) => p.combo.kind === 'four' && p.combo.wing === 2 && p.combo.rank === 0);
    expect(four).toHaveLength(1);
    const ranks = (four[0] as { ids: number[] }).ids.map((id) => (hand.find((c) => c.id === id) as Card).rank);
    expect(ranks.filter((x) => x === r('5'))).toHaveLength(4);
  });
});
