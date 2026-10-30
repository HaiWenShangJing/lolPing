import { describe, expect, it } from 'vitest';
import { Table } from '../../../src/shared/teammate/doudizhu';
import { BIG, MAX_CARDS, PACK, SMALL, buildDeck, checkPlay, countRanks, sortHand } from '../../../src/shared/teammate/doudizhuCards';
import type { Card } from '../../../src/shared/teammate/doudizhuCards';
import { runDoudizhu } from '../../../src/shared/teammate/doudizhuRun';
import { CONFIG, MAX_DEALS, MAX_DOUBLINGS, SIZES, Stopped, isSize } from '../../../src/shared/teammate/doudizhuTypes';
import type { Entry, Reply, Role, Size } from '../../../src/shared/teammate/doudizhuTypes';
import { botDeps, selfPlay } from './doudizhuRig';

const kinds = (entries: readonly Entry[]): string[] => entries.map((e) => e.k);
const only = <K extends Entry['k']>(entries: readonly Entry[], k: K): Extract<Entry, { k: K }>[] =>
  entries.filter((e): e is Extract<Entry, { k: K }> => e.k === k);

/** A table with nothing dealt, for looking at the parts. */
const bare = (size: Size, seed = 1): Table => new Table(botDeps(seed, []), size);

describe('the sizes of a table', () => {
  it('knows the sizes, and nothing else', () => {
    expect([...SIZES]).toEqual([3, 4, 5, 6]);
    for (const size of SIZES) expect(isSize(size)).toBe(true);
    for (const raw of [2, 7, '3', null, undefined, 3.5, NaN]) expect(isSize(raw)).toBe(false);
  });

  it.each(SIZES)('deals every card of the packs for %i seats, with none over', (size) => {
    const c = CONFIG[size];
    expect(c.hand * size + c.holes).toBe(54 * c.decks);
    expect(c.decks * 54).toBeLessThanOrEqual(MAX_CARDS);
    expect(c.landlords).toBeLessThan(size);
  });

  it('plays three seats with one pack, and calls a card at the tables of five and six', () => {
    expect(CONFIG[3]).toMatchObject({ decks: 1, hand: 17, holes: 3, mode: 'bid', landlords: 1 });
    expect(CONFIG[4]).toMatchObject({ decks: 2, hand: 25, holes: 8, mode: 'bid', landlords: 1 });
    expect(CONFIG[5]).toMatchObject({ decks: 2, hand: 21, holes: 3, mode: 'call', landlords: 2 });
    expect(CONFIG[6]).toMatchObject({ decks: 3, hand: 27, holes: 0, mode: 'call', landlords: 3 });
  });
});

describe('the deal', () => {
  it.each(SIZES)('gives each of %i seats a hand of its own cards and keeps the rest in the holes', (size) => {
    const t = bare(size);
    t.deal();
    const all = [...t.players.flatMap((p) => p.hand), ...t.holes];
    expect(all).toHaveLength(54 * CONFIG[size].decks);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    for (const p of t.players) {
      expect(p.hand).toHaveLength(CONFIG[size].hand);
      expect(p.hand).toEqual(sortHand(p.hand));
      expect(p.role).toBe('farmer');
      expect(p.open).toBe(false);
    }
    expect(t.holes).toHaveLength(CONFIG[size].holes);
    expect(t.lord).toBeNull();
    expect(t.call).toBeNull();
  });

  it('deals the same cards for the same random, other cards for another', () => {
    const a = bare(3, 5);
    const b = bare(3, 5);
    const c = bare(3, 6);
    for (const t of [a, b, c]) t.deal();
    expect(a.players.map((p) => p.hand.map((x) => x.id))).toEqual(b.players.map((p) => p.hand.map((x) => x.id)));
    expect(a.players.map((p) => p.hand.map((x) => x.id))).not.toEqual(c.players.map((p) => p.hand.map((x) => x.id)));
  });

  it('gives the landlord the holes, in the open, with the table knowing who is who', () => {
    const t = bare(3);
    t.deal();
    const holes = [...t.holes];
    t.crown(1, 2);
    expect(t.p(1).hand).toHaveLength(20);
    expect(t.p(1).hand).toEqual(sortHand(t.p(1).hand));
    for (const h of holes) expect(t.p(1).hand.map((c) => c.id)).toContain(h.id);
    expect(t.p(1).role).toBe('landlord');
    expect(t.p(0).role).toBe('farmer');
    expect(t.lord).toBe(1);
    expect(t.base).toBe(2);
    expect(t.players.every((p) => p.open)).toBe(true);
  });
});

describe('calling a card', () => {
  it.each([5, 6] as const)('finds a card every copy of which is in another hand, at %i seats', (size) => {
    for (let seed = 1; seed <= 40; seed++) {
      const t = bare(size, seed);
      t.deal();
      const found = t.findCall();
      expect(found, `seed ${seed}`).not.toBeNull();
      const { card, held } = found as { card: Card; held: number[] };
      expect(held).toHaveLength(CONFIG[size].decks);
      expect(new Set(held).size).toBe(held.length);
      const slot = card.id % PACK;
      expect(slot).toBeLessThan(52);
      held.forEach((seat, d) => expect(t.p(seat).hand.map((c) => c.id)).toContain(d * PACK + slot));
      expect(t.holes.some((c) => c.id % PACK === slot)).toBe(false);
    }
  });

  it.each([5, 6] as const)('makes the holders landlords and the holder of the first copy the open one, at %i seats', (size) => {
    const t = bare(size, 3);
    t.deal();
    const { card, held } = t.findCall() as { card: Card; held: number[] };
    const holes = [...t.holes];
    t.setCall(card, held);
    expect(t.landlords().sort()).toEqual([...held].sort());
    expect(t.lord).toBe(held[0]);
    expect(t.call).toEqual(card);
    expect(t.base).toBe(1);
    expect(t.p(held[0] as number).open).toBe(true);
    for (const seat of held.slice(1)) expect(t.p(seat).open).toBe(false);
    for (const p of t.players.filter((x) => x.role === 'farmer')) expect(p.open).toBe(false);
    expect(t.p(held[0] as number).hand).toHaveLength(CONFIG[size].hand + holes.length);
    expect(t.p(held[0] as number).hand.map((c) => c.id)).toEqual(expect.arrayContaining(holes.map((c) => c.id)));
  });

  it('never calls a joker', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const t = bare(6, seed);
      t.deal();
      expect((t.findCall() as { card: Card }).card.rank).toBeLessThan(SMALL);
    }
  });

  it('can be made to take any card in a hand when no whole one is to be had', () => {
    const t = bare(5);
    t.deal();
    // Put both copies of every card into one hand, so that no card is in two.
    const all = buildDeck(2);
    t.players.forEach((p, i) => (p.hand = i === 0 ? sortHand(all.slice(0, 54).concat(all.slice(54, 108))) : []));
    t.holes = [];
    expect(t.findCall()).toBeNull();
    const any = t.findCall(true);
    expect(any).not.toBeNull();
    expect((any as { held: number[] }).held.every((seat) => seat === 0)).toBe(true);
  });

  it('knows a hidden landlord when he plays the card that was called, and the others when all are known', () => {
    const t = bare(6, 3);
    t.deal();
    const { card, held } = t.findCall() as { card: Card; held: number[] };
    t.setCall(card, held);
    const [open, hiddenA, hiddenB] = held as [number, number, number];
    const mine = (seat: number): Card => t.p(seat).hand.find((c) => c.id % PACK === card.id % PACK) as Card;
    const other = (seat: number): Card => t.p(seat).hand.find((c) => c.rank !== card.rank) as Card;
    expect(t.reveals(hiddenA, [other(hiddenA)])).toBe(false);
    expect(t.reveals(hiddenA, [mine(hiddenA)])).toBe(true);
    expect(t.reveals(open, [mine(open)])).toBe(false);
    const farmer = t.players.find((p) => p.role === 'farmer') as { seat: number };
    expect(t.reveals(farmer.seat, [other(farmer.seat)])).toBe(false);
    t.reveal(hiddenA);
    expect(t.p(hiddenA).open).toBe(true);
    expect(t.reveals(hiddenA, [mine(hiddenA)])).toBe(false);
    expect(t.players.filter((p) => p.role === 'farmer').some((p) => p.open)).toBe(false);
    t.reveal(hiddenB);
    expect(t.players.every((p) => p.open)).toBe(true);
  });
});

describe('what is played', () => {
  it('turns a reply into a play, a pass into none, and puts a reply that does not fit right', () => {
    const t = bare(3);
    t.deal();
    t.crown(0, 1);
    const hand = t.p(0).hand;
    const low = hand[hand.length - 1] as Card;
    // A lead cannot pass, and a play of cards not in the hand is no play.
    expect(t.accept(0, { k: 'play', ids: [] })?.ids).toEqual([low.id]);
    expect(t.accept(0, { k: 'play', ids: [9999] })?.ids).toEqual([low.id]);
    expect(t.accept(0, null)?.ids).toEqual([low.id]);
    expect(t.accept(0, { k: 'bid', bid: 3 })?.ids).toEqual([low.id]);
    expect(t.fallbacks).toBe(4);
    const own = hand[0] as Card;
    expect(t.accept(0, { k: 'play', ids: [own.id] })?.combo).toEqual({ kind: 'single', rank: own.rank, len: 1, wing: 0, size: 1 });
    expect(t.fallbacks).toBe(4);
  });

  it('lets a pass stand after a play, and puts anything that does not beat it down as a pass', () => {
    const t = bare(3);
    t.deal();
    t.crown(0, 1);
    const hand = t.p(0).hand;
    const lead = t.accept(0, { k: 'play', ids: [(hand[hand.length - 1] as Card).id] }) as NonNullable<ReturnType<Table['accept']>>;
    t.put(0, lead);
    expect(t.accept(1, { k: 'play', ids: [] })).toBeNull();
    expect(t.fallbacks).toBe(0);
    const weak = t.p(1).hand.filter((c) => c.rank <= lead.combo.rank).map((c) => c.id).slice(0, 1);
    if (weak.length) expect(t.accept(1, { k: 'play', ids: weak })).toBeNull();
    expect(t.accept(1, null)).toBeNull();
  });

  it('takes the cards of a play out of the hand, counts them and keeps the one that is on the table', () => {
    const t = bare(3);
    t.deal();
    t.crown(2, 3);
    const rank = (t.p(2).hand[0] as Card).rank;
    const same = t.p(2).hand.filter((c) => c.rank === rank);
    const play = checkPlay(t.p(2).hand, same.map((c) => c.id), null, 1) as NonNullable<ReturnType<typeof checkPlay>>;
    const before = t.p(2).hand.length;
    const cards = t.put(2, play);
    expect(cards.map((c) => c.id).sort()).toEqual(same.map((c) => c.id).sort());
    expect(t.p(2).hand).toHaveLength(before - same.length);
    expect(t.p(2).plays).toBe(1);
    expect(t.seen[rank]).toBe(same.length);
    expect(t.top?.seat).toBe(2);
    expect(t.top?.combo).toEqual(play.combo);
    expect(t.passes).toBe(0);
  });

  it('counts bombs and the rocket, and not a four with two', () => {
    const t = bare(3);
    t.deal();
    const bomb = { ids: [], combo: { kind: 'bomb' as const, rank: 3, len: 1, wing: 0 as const, size: 4 } };
    const rocket = { ids: [], combo: { kind: 'rocket' as const, rank: BIG, len: 1, wing: 0 as const, size: 2 } };
    const four = { ids: [], combo: { kind: 'four' as const, rank: 3, len: 1, wing: 1 as const, size: 6 } };
    t.put(0, bomb);
    t.put(0, rocket);
    t.put(0, four);
    expect(t.bombs).toBe(2);
  });

  it('clears the table once everyone else has passed on a play', () => {
    for (const size of SIZES) {
      const t = bare(size);
      t.deal();
      t.crown(0, 1);
      const low = t.p(0).hand[t.p(0).hand.length - 1] as Card;
      t.put(0, { ids: [low.id], combo: { kind: 'single', rank: low.rank, len: 1, wing: 0, size: 1 } });
      for (let i = 1; i < size - 1; i++) {
        t.pass();
        expect(t.top, `${size} seats, pass ${i}`).not.toBeNull();
      }
      t.pass();
      expect(t.top).toBeNull();
      expect(t.passes).toBe(0);
    }
  });
});

/** A table in which the roles and the counts are set by hand, for the points. */
function scored(size: Size, landlords: number[], plays: number[], bombs: number, base = 1): Table {
  const t = bare(size);
  t.players.forEach((p, i) => {
    p.role = landlords.includes(i) ? 'landlord' : 'farmer';
    p.plays = plays[i] ?? 0;
  });
  t.bombs = bombs;
  t.base = base;
  return t;
}

describe('the points', () => {
  const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

  it('pays a landlord twice the farmers at three seats, whichever side wins', () => {
    const won = scored(3, [0], [4, 3, 3], 0).settle(0);
    expect(won).toMatchObject({ winner: 'landlord', out: 0, base: 1, bombs: 0, spring: null, doublings: 0, landlords: [0] });
    expect(won.scores).toEqual([2, -1, -1]);
    const lost = scored(3, [0], [4, 3, 3], 0, 3).settle(2);
    expect(lost.winner).toBe('farmer');
    expect(lost.scores).toEqual([-6, 3, 3]);
  });

  it('pays one landlord three farmers at four seats', () => {
    expect(scored(4, [2], [3, 3, 5, 3], 0, 2).settle(2).scores).toEqual([-2, -2, 6, -2]);
    expect(scored(4, [2], [3, 3, 5, 3], 0, 2).settle(1).scores).toEqual([2, 2, -6, 2]);
  });

  it('pays two landlords against three farmers at five seats, three against three at six', () => {
    expect(scored(5, [1, 3], [2, 2, 2, 2, 2], 0).settle(3).scores).toEqual([-2, 3, -2, 3, -2]);
    expect(scored(5, [1, 3], [2, 2, 2, 2, 2], 0).settle(4).scores).toEqual([2, -3, 2, -3, 2]);
    expect(scored(6, [0, 2, 4], [2, 2, 2, 2, 2, 2], 0).settle(0).scores).toEqual([3, -3, 3, -3, 3, -3]);
    expect(scored(6, [0, 2, 4], [2, 2, 2, 2, 2, 2], 0).settle(1).scores).toEqual([-3, 3, -3, 3, -3, 3]);
  });

  it('adds up to nothing at every size, whoever wins, with any bombs', () => {
    const sets: [Size, number[]][] = [[3, [1]], [4, [0]], [5, [0, 4]], [6, [1, 2, 5]]];
    for (const [size, lords] of sets) {
      for (let out = 0; out < size; out++) {
        for (const bombs of [0, 1, 3]) {
          const r = scored(size, lords, new Array(size).fill(2), bombs, 2).settle(out);
          expect(sum(r.scores), `${size} seats, out ${out}, ${bombs} bombs`).toBe(0);
        }
      }
    }
  });

  it('doubles the points for each bomb and rocket', () => {
    const r = scored(3, [0], [4, 3, 3], 2, 1).settle(0);
    expect(r.bombs).toBe(2);
    expect(r.doublings).toBe(2);
    expect(r.scores).toEqual([8, -4, -4]);
  });

  it('stops doubling after a few bombs', () => {
    const r = scored(3, [0], [4, 3, 3], 40, 1).settle(0);
    expect(r.doublings).toBe(MAX_DOUBLINGS);
    expect(r.scores).toEqual([2 * 2 ** MAX_DOUBLINGS, -(2 ** MAX_DOUBLINGS), -(2 ** MAX_DOUBLINGS)]);
  });

  it('doubles a spring, when the farmers never played, and a counter-spring, when the landlords played once', () => {
    const spring = scored(3, [0], [5, 0, 0], 0).settle(0);
    expect(spring.spring).toBe('spring');
    expect(spring.doublings).toBe(1);
    expect(spring.scores).toEqual([4, -2, -2]);
    const counter = scored(3, [0], [1, 4, 4], 0).settle(1);
    expect(counter.spring).toBe('counter');
    expect(counter.scores).toEqual([-4, 2, 2]);
    expect(scored(3, [0], [5, 1, 0], 0).settle(0).spring).toBeNull();
    expect(scored(3, [0], [2, 4, 4], 0).settle(1).spring).toBeNull();
    const both = scored(3, [0], [5, 0, 0], 1, 3).settle(0);
    expect(both.doublings).toBe(2);
    expect(both.scores).toEqual([24, -12, -12]);
  });

  it('counts the hands of every landlord when a table has several', () => {
    expect(scored(6, [0, 2, 4], [1, 5, 2, 5, 3, 5], 0).settle(1).spring).toBeNull();
    expect(scored(6, [0, 2, 4], [1, 5, 2, 5, 3, 5], 0).settle(1).winner).toBe('farmer');
    expect(scored(6, [0, 2, 4], [1, 0, 0, 0, 0, 0], 0).settle(0).spring).toBe('spring');
    expect(scored(6, [0, 2, 4], [0, 5, 1, 5, 0, 5], 0).settle(1).spring).toBe('counter');
    expect(scored(6, [0, 2, 4], [1, 5, 1, 5, 0, 5], 0).settle(1).spring).toBeNull();
    expect(scored(5, [1, 3], [3, 1, 3, 1, 3], 0).settle(0).spring).toBeNull();
  });
});

describe('a game', () => {
  const noBid = (): Reply => ({ k: 'bid', bid: 0 });

  it('deals, bids, finds the landlord and plays to the end, at every size', async () => {
    for (const size of SIZES) {
      const { entries, outcome, table } = await selfPlay(size, 11);
      const ks = kinds(entries);
      expect(ks[0], `${size} seats`).toBe('start');
      expect(ks.at(-1)).toBe('end');
      expect(ks).toContain('deal');
      expect(ks).toContain(CONFIG[size].mode === 'bid' ? 'landlord' : 'call');
      expect(outcome.fallbacks).toBe(0);
      expect(outcome.turns).toBeGreaterThan(size);
      expect(table.p(outcome.result.out).hand).toHaveLength(0);
    }
  });

  it('has the landlord lead, and each seat take its turn in order', async () => {
    for (const size of SIZES) {
      const { entries, outcome } = await selfPlay(size, 4);
      const turns = only(entries, 'turn');
      expect(turns[0]?.lead).toBe(true);
      const first = (only(entries, 'landlord')[0] ?? only(entries, 'call')[0])?.seat;
      expect(turns[0]?.seat).toBe(first);
      expect(turns).toHaveLength(outcome.turns);
      for (let i = 1; i < turns.length; i++) {
        expect((turns[i] as { seat: number }).seat).toBe((((turns[i - 1] as { seat: number }).seat + 1) % size));
      }
    }
  });

  it('keeps every card: what is played and what is left make up the deal', async () => {
    for (const size of SIZES) {
      const { entries, table } = await selfPlay(size, 21);
      const played = only(entries, 'play').flatMap((e) => e.cards);
      const left = table.players.flatMap((p) => p.hand);
      const all = [...played, ...left];
      expect(all, `${size} seats`).toHaveLength(54 * CONFIG[size].decks);
      expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
      expect(countRanks(played).map((n, r) => n + (countRanks(left)[r] as number))).toEqual(countRanks(buildDeck(CONFIG[size].decks)));
    }
  });

  it('settles to a result that adds up to nothing and names the side whose seat went out', async () => {
    for (const size of SIZES) {
      for (const seed of [1, 2, 3]) {
        const { entries, outcome, table } = await selfPlay(size, seed);
        const end = only(entries, 'end')[0];
        expect(end?.result).toEqual(outcome.result);
        const r = outcome.result;
        expect(r.scores.reduce((a, b) => a + b, 0)).toBe(0);
        expect(table.p(r.out).role).toBe(r.winner);
        expect(r.landlords).toEqual(table.landlords());
        expect(r.scores.every((s, seat) => (s > 0) === (table.p(seat).role === r.winner))).toBe(true);
        expect(r.bombs).toBe(only(entries, 'play').filter((e) => e.play.combo.kind === 'bomb' || e.play.combo.kind === 'rocket').length);
      }
    }
  });

  it('is the same game for the same seed', async () => {
    const a = await selfPlay(5, 9);
    const b = await selfPlay(5, 9);
    expect(JSON.stringify(a.entries)).toBe(JSON.stringify(b.entries));
    const c = await selfPlay(5, 10);
    expect(JSON.stringify(a.entries)).not.toBe(JSON.stringify(c.entries));
  });

  it('puts the highest bidder in as landlord, at the bid, with the holes in his hand', async () => {
    const { entries, table, outcome } = await selfPlay(3, 2, (seat, ask) => {
      if (ask.k !== 'bid') return undefined;
      return seat === 2 ? { k: 'bid', bid: 2 } : seat === 1 && ask.min <= 3 ? { k: 'bid', bid: ask.min } : noBid();
    });
    const lord = only(entries, 'landlord')[0];
    expect(lord).toBeDefined();
    expect(lord?.holes).toHaveLength(3);
    expect(outcome.result.base).toBe(lord?.bid);
    expect(table.lord).toBe(lord?.seat);
    expect(table.landlords()).toEqual([lord?.seat]);
    const bids = only(entries, 'bid');
    expect(Math.max(...bids.map((b) => b.bid))).toBe(lord?.bid);
  });

  it('starts at a random seat, goes round once and lets a bid of three end it', async () => {
    const { entries } = await selfPlay(4, 3, (seat, ask) => (ask.k === 'bid' ? { k: 'bid', bid: seat % 2 === 0 ? 3 : 0 } : undefined));
    const bids = only(entries, 'bid');
    expect(bids.length).toBeLessThanOrEqual(2);
    expect(bids.at(-1)?.bid).toBe(3);
    expect(only(entries, 'landlord')[0]?.seat).toBe(bids.at(-1)?.seat);
    const seats = bids.map((b) => b.seat);
    for (let i = 1; i < seats.length; i++) expect(seats[i]).toBe(((seats[i - 1] as number) + 1) % 4);
  });

  it('counts a bid that does not beat the best as a pass, and as a reply put right', async () => {
    const { entries, outcome } = await selfPlay(3, 5, (seat, ask) => {
      if (ask.k !== 'bid') return undefined;
      return ask.min === 1 ? { k: 'bid', bid: 2 } : { k: 'bid', bid: 1 };
    });
    const bids = only(entries, 'bid');
    expect(bids[0]?.bid).toBe(2);
    expect(bids[1]?.bid).toBe(0);
    expect(bids[2]?.bid).toBe(0);
    expect(outcome.fallbacks).toBeGreaterThanOrEqual(2);
  });

  it('deals again when everyone passes, and makes the first to bid the landlord for 1 after the last deal', async () => {
    const { entries } = await selfPlay(3, 6, (_seat, ask) => (ask.k === 'bid' ? noBid() : undefined));
    const ks = kinds(entries);
    expect(ks.filter((k) => k === 'redeal')).toHaveLength(MAX_DEALS - 1);
    expect(ks.filter((k) => k === 'deal')).toHaveLength(MAX_DEALS);
    const forced = only(entries, 'landlord')[0];
    expect(forced?.bid).toBe(1);
    const bids = only(entries, 'bid');
    expect(bids.at(-1)).toMatchObject({ seat: forced?.seat, bid: 1 });
    expect(bids.slice(-4, -1).every((b) => b.bid === 0)).toBe(true);
  });

  it('does not count a pass as a reply put right', async () => {
    const { outcome } = await selfPlay(3, 7, (_seat, ask) => (ask.k === 'bid' ? { k: 'bid', bid: ask.min === 1 ? 1 : 0 } : undefined));
    expect(outcome.fallbacks).toBe(0);
  });

  it('calls a card at five and six seats, announces the landlord in the open and has him lead', async () => {
    for (const size of [5, 6] as const) {
      const { entries, table } = await selfPlay(size, 8);
      const call = only(entries, 'call')[0];
      expect(call).toBeDefined();
      expect(only(entries, 'bid')).toHaveLength(0);
      expect(call?.card.suit).not.toBeNull();
      expect(call?.holes).toHaveLength(CONFIG[size].holes);
      expect(only(entries, 'turn')[0]?.seat).toBe(call?.seat);
      expect(table.call).toEqual(call?.card);
      expect(kinds(entries).indexOf('deal')).toBeLessThan(kinds(entries).indexOf('call'));
    }
  });

  it('shows the table a hidden landlord only when he plays the card that was called', async () => {
    let revealed = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { entries, table } = await selfPlay(6, seed);
      const call = only(entries, 'call')[0] as { seat: number; card: Card };
      for (const [i, e] of entries.entries()) {
        if (e.k !== 'reveal') continue;
        revealed += 1;
        const before = entries[i - 1] as Entry;
        expect(before.k).toBe('play');
        const { seat, cards } = before as Extract<Entry, { k: 'play' }>;
        expect(seat).toBe(e.seat);
        expect(seat).not.toBe(call.seat);
        expect(cards.some((c) => c.rank === call.card.rank && c.suit === call.card.suit)).toBe(true);
        expect(table.p(seat).role).toBe('landlord');
      }
      const roles = only(entries, 'reveal').map((e) => e.seat);
      expect(new Set(roles).size).toBe(roles.length);
    }
    expect(revealed).toBeGreaterThan(0);
  });

  it('puts a play that does not fit right instead of losing the game', async () => {
    let asked = 0;
    const { outcome, table } = await selfPlay(3, 12, (_seat, ask) => {
      if (ask.k !== 'play') return undefined;
      asked += 1;
      return asked % 5 === 0 ? { k: 'play', ids: [4242] } : undefined;
    });
    expect(outcome.fallbacks).toBeGreaterThan(0);
    expect(table.players.some((p) => p.hand.length === 0)).toBe(true);
  });

  it('is a game of its own for a seat that never answers, which passes and leads its lowest card', async () => {
    const { outcome, table } = await selfPlay(3, 13, (seat, ask) => (ask.k === 'play' && seat === 1 ? null : undefined));
    expect(outcome.fallbacks).toBeGreaterThan(0);
    expect(table.players.some((p) => p.hand.length === 0)).toBe(true);
  });

  it('stops when told to, from a question, a report or between turns', async () => {
    for (const stopAt of [1, 5, 30]) {
      let n = 0;
      const entries: Entry[] = [];
      const deps = botDeps(3, entries);
      deps.stopped = () => (n += 1) > stopAt;
      expect(await runDoudizhu(deps, 3)).toBeNull();
    }
    expect(new Stopped().message).toBe('stopped');
  });

  it('asks for no bids at a table that calls a card', async () => {
    const asked = new Set<string>();
    await selfPlay(5, 14, (_seat, ask) => {
      asked.add(ask.k);
      return undefined;
    });
    expect([...asked]).toEqual(['play']);
  });
});

describe('the roles', () => {
  it.each(SIZES)('has the landlords the table is built for at %i seats', async (size) => {
    for (let seed = 1; seed <= 15; seed++) {
      const { table } = await selfPlay(size, seed);
      expect(table.landlords(), `seed ${seed}`).toHaveLength(CONFIG[size].landlords);
    }
  });

  it('makes everyone a known role once the bid is won', async () => {
    const { table } = await selfPlay(4, 1);
    const roles: Role[] = table.players.map((p) => p.role);
    expect(roles.filter((r) => r === 'landlord')).toHaveLength(1);
    expect(table.players.every((p) => p.open)).toBe(true);
  });
});
