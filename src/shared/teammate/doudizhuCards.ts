/**
 * The cards of a Dou Dizhu table and the hands they make: the deck for one, two or three packs, what a set of cards
 * counts as when it is played (a pair, a straight, a plane with wings, a bomb…), which play beats which, and every play
 * a hand can make. Pure: nothing here knows about seats or turns.
 */

export type Suit = 'spade' | 'heart' | 'club' | 'diamond';
export const SUITS: readonly Suit[] = ['spade', 'heart', 'club', 'diamond'];
export const SUIT_SIGN: Record<Suit, string> = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };

/** Ranks run from 3 (0) up to the big joker (14): the order in which cards beat each other. */
export const RANKS = 15;
export const ACE = 11;
export const TWO = 12;
export const SMALL = 13;
export const BIG = 14;
const LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
/** The label of a plain rank; the jokers have no label here, the words name them. */
export const rankLabel = (rank: number): string => LABELS[rank] ?? '';
export const isJoker = (rank: number): boolean => rank === SMALL || rank === BIG;

export interface Card {
  /** Unique across the deck: the pack it comes from times 54, plus its place in the pack. */
  readonly id: number;
  readonly rank: number;
  /** Null for a joker. */
  readonly suit: Suit | null;
}

export const PACK = 54;
/** The most packs a table plays with: ids run from 0 up to this many cards. */
export const MAX_CARDS = PACK * 3;

/** `decks` packs of 54, each card with an id of its own. */
export function buildDeck(decks: number): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) {
    let id = d * PACK;
    for (const suit of SUITS) for (let rank = 0; rank <= TWO; rank++) cards.push({ id: id++, rank, suit });
    cards.push({ id: id++, rank: SMALL, suit: null }, { id: id++, rank: BIG, suit: null });
  }
  return cards;
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The cards of a hand from the highest to the lowest, as they are laid out on the table. */
export const sortHand = (cards: readonly Card[]): Card[] =>
  [...cards].sort((a, b) => b.rank - a.rank || (a.suit ?? '').localeCompare(b.suit ?? '') || a.id - b.id);

/** How many cards there are of each rank. */
export function countRanks(cards: readonly { rank: number }[]): number[] {
  const counts = new Array<number>(RANKS).fill(0);
  for (const c of cards) counts[c.rank] = (counts[c.rank] ?? 0) + 1;
  return counts;
}

export type Kind = 'single' | 'pair' | 'triple' | 'straight' | 'pairs' | 'plane' | 'four' | 'bomb' | 'rocket';

/** What a set of cards is when it is played, and what it takes to beat it. */
export interface Combo {
  kind: Kind;
  /** The rank of a single, a pair, a triple, a four or a bomb; the lowest rank of a run. */
  rank: number;
  /** How many ranks the body runs over: 1 but for a straight, pairs and a plane. */
  len: number;
  /** What rides along with a triple, a plane or a four: nothing, a single each or a pair each. */
  wing: 0 | 1 | 2;
  size: number;
}

/** A play: the cards by id and what they count as. */
export interface Play {
  ids: number[];
  combo: Combo;
}

export type Shape =
  | 'single' | 'pair' | 'triple' | 'tripleOne' | 'triplePair' | 'straight' | 'pairs' | 'plane' | 'planeOne'
  | 'planePair' | 'fourTwo' | 'fourPairs' | 'bomb' | 'rocket';

export function shapeOf(c: Combo): Shape {
  switch (c.kind) {
    case 'triple': return c.wing === 0 ? 'triple' : c.wing === 1 ? 'tripleOne' : 'triplePair';
    case 'plane': return c.wing === 0 ? 'plane' : c.wing === 1 ? 'planeOne' : 'planePair';
    case 'four': return c.wing === 1 ? 'fourTwo' : 'fourPairs';
    default: return c.kind;
  }
}

export const isBomb = (c: Combo): boolean => c.kind === 'bomb' || c.kind === 'rocket';

/**
 * Every way a set of cards can be read as a play, `decks` being how many packs the table plays with. Most sets have one
 * reading; a run of triples that could be a longer plane or a shorter one with wings has more. Jokers pair up and make
 * triples when a table has more than one of them, but they never join a run and only all of them together make a bomb.
 * Cards that ride along with a triple, a plane or a four are never of the rank of its body.
 */
export function readings(cards: readonly Card[], decks: number): Combo[] {
  const n = cards.length;
  if (n === 0) return [];
  const c = countRanks(cards);
  const present: number[] = [];
  for (let r = 0; r < RANKS; r++) if ((c[r] ?? 0) > 0) present.push(r);
  const at = (r: number): number => c[r] ?? 0;
  const combo = (kind: Kind, rank: number, len: number, wing: 0 | 1 | 2): Combo => ({ kind, rank, len, wing, size: n });

  if (n === 2 * decks && at(SMALL) === decks && at(BIG) === decks) return [combo('rocket', BIG, 1, 0)];
  const first = present[0] as number;
  if (n === 1) return [combo('single', first, 1, 0)];
  if (present.length === 1) {
    if (n === 2) return [combo('pair', first, 1, 0)];
    if (n === 3) return [combo('triple', first, 1, 0)];
    return first <= TWO ? [combo('bomb', first, 1, 0)] : [];
  }

  const out: Combo[] = [];
  const last = present[present.length - 1] as number;
  const run = last <= ACE && last - first === present.length - 1;
  const each = (k: number): boolean => present.every((r) => at(r) === k);
  if (n >= 5 && run && each(1)) out.push(combo('straight', first, n, 0));
  if (n >= 6 && run && each(2)) out.push(combo('pairs', first, present.length, 0));

  for (let len = 2; len * 3 <= n; len++) {
    const rest = n - 3 * len;
    if (rest !== 0 && rest !== len && rest !== 2 * len) continue;
    const wing = rest === 0 ? 0 : rest === len ? 1 : 2;
    for (let s = 0; s + len - 1 <= ACE; s++) {
      let body = true;
      for (let r = s; r < s + len; r++) if (at(r) !== 3) body = false;
      if (!body) continue;
      if (wing === 2 && !present.every((r) => (r >= s && r < s + len) || at(r) % 2 === 0)) continue;
      out.push({ kind: 'plane', rank: s, len, wing, size: n });
    }
  }

  if ((n === 4 || n === 5) && present.length === 2) {
    const r = present.find((q) => at(q) === 3 && q <= TWO);
    if (r !== undefined) out.push(combo('triple', r, 1, n === 4 ? 1 : 2));
  }

  if (n === 6 || n === 8) {
    for (const r of present) {
      if (r > TWO || at(r) !== 4) continue;
      if (n === 6) out.push(combo('four', r, 1, 1));
      else if (present.every((q) => q === r || at(q) % 2 === 0)) out.push(combo('four', r, 1, 2));
    }
  }
  return out;
}

/** The reading a play is kept under when it has more than one: the longest body, then the highest. */
export function canonical(list: readonly Combo[]): Combo | null {
  let best: Combo | null = null;
  for (const c of list) {
    if (best === null || c.len > best.len || (c.len === best.len && c.rank > best.rank)) best = c;
  }
  return best;
}

/**
 * Whether `a` beats `b`, the play on the table. The rocket beats everything. A bomb beats everything but a bigger
 * bomb: more cards, or as many and a higher rank. The rest beat only their own kind, of the same size, with a higher
 * rank.
 */
export function beats(a: Combo, b: Combo): boolean {
  if (b.kind === 'rocket') return false;
  if (a.kind === 'rocket') return true;
  if (a.kind === 'bomb' || b.kind === 'bomb') {
    if (a.kind !== 'bomb') return false;
    if (b.kind !== 'bomb') return true;
    return a.size > b.size || (a.size === b.size && a.rank > b.rank);
  }
  return a.kind === b.kind && a.len === b.len && a.wing === b.wing && a.size === b.size && a.rank > b.rank;
}

/**
 * The play that `ids` make out of the cards of `hand` after `top` (null for a lead), or null when it is not a legal
 * play: a card that is not in the hand, a repeated card, cards that make nothing, or a play that does not beat `top`.
 */
export function checkPlay(hand: readonly Card[], ids: readonly number[], top: Combo | null, decks: number): Play | null {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return null;
  const mine = new Map(hand.map((card) => [card.id, card]));
  const cards: Card[] = [];
  for (const id of ids) {
    const card = mine.get(id);
    if (!card) return null;
    cards.push(card);
  }
  const combo = canonical(readings(cards, decks).filter((r) => top === null || beats(r, top)));
  return combo ? { ids: [...ids], combo } : null;
}

export interface PlayOptions {
  /** A card to take before the others of its rank, so that a play that has the rank has it. */
  prefer?: number | null;
  /** Ranks that no play but a bomb or the rocket may use, not even for the cards that ride along. */
  keep?: ReadonlySet<number>;
}

/** What it costs to give up a card of rank `r` when `left` of its rank are still in the hand. */
const singleCost = (r: number, left: number): number =>
  r + (left === 1 ? 0 : left === 2 ? 25 : left === 3 ? 40 : 80) + (r >= SMALL ? 30 : r === TWO ? 15 : 0);

const pairCost = (r: number, left: number): number =>
  r + (left >= 4 ? 80 : left === 3 ? 20 : 0) + (r >= SMALL ? 30 : r === TWO ? 15 : 0);

/**
 * The cheapest cards to ride along: `need` singles, or `need` pairs, from ranks that are not blocked. Singles that are
 * alone come first, then those that break a pair or more; a pair is not broken for a single while there is a single to
 * give. Null when the hand has not got them.
 */
function riders(by: readonly (readonly Card[])[], blocked: (r: number) => boolean, need: number, pairs: boolean): Card[] | null {
  const left = by.map((list) => list.length);
  const out: Card[] = [];
  for (let i = 0; i < need; i++) {
    let best = -1;
    let cost = Infinity;
    for (let r = 0; r < RANKS; r++) {
      const have = left[r] ?? 0;
      if (blocked(r) || have < (pairs ? 2 : 1)) continue;
      const k = pairs ? pairCost(r, have) : singleCost(r, have);
      if (k < cost) {
        best = r;
        cost = k;
      }
    }
    if (best < 0) return null;
    const list = by[best] as readonly Card[];
    const have = left[best] as number;
    const take = pairs ? 2 : 1;
    for (let k = 0; k < take; k++) out.push(list[list.length - have + k] as Card);
    left[best] = have - take;
  }
  return out;
}

/**
 * The plays a hand can make: every lead when `top` is null, else every play that beats it. The cards that ride along are
 * the cheapest the hand has to give, so each body is played once, with the same cards, whatever the table.
 */
export function plays(hand: readonly Card[], decks: number, top: Combo | null, opts: PlayOptions = {}): Play[] {
  const { prefer = null, keep } = opts;
  const by: Card[][] = Array.from({ length: RANKS }, () => []);
  for (const card of [...hand].sort((a, b) => a.id - b.id)) (by[card.rank] as Card[]).push(card);
  if (prefer !== null) {
    for (const list of by) {
      const i = list.findIndex((card) => card.id === prefer);
      if (i > 0) list.unshift(...list.splice(i, 1));
    }
  }
  const cnt = by.map((list) => list.length);
  const out: Play[] = [];
  const has = (r: number): number => cnt[r] ?? 0;
  const free = (r: number): boolean => !keep?.has(r);
  const want = (combo: Combo): boolean => top === null || beats(combo, top);
  const shape = (kind: Kind, rank: number, len: number, wing: 0 | 1 | 2, size: number): Combo =>
    ({ kind, rank, len, wing, size });
  const emit = (combo: Combo, cards: readonly Card[]): void => {
    out.push({ ids: cards.map((card) => card.id), combo });
  };
  const body = (s: number, len: number, per: number): Card[] => {
    const cards: Card[] = [];
    for (let r = s; r < s + len; r++) cards.push(...(by[r] as Card[]).slice(0, per));
    return cards;
  };
  /** Each run of ranks from `s` of at least `minLen` ranks that have `per` cards or more. */
  const runs = (per: number, minLen: number, f: (s: number, len: number) => void): void => {
    for (let s = 0; s <= ACE; s++) {
      for (let len = 0; s + len <= ACE && has(s + len) >= per && free(s + len); ) {
        len++;
        if (len >= minLen) f(s, len);
      }
    }
  };
  const ride = (skip: (r: number) => boolean, need: number, pairs: boolean): Card[] | null =>
    riders(by, (r) => skip(r) || !free(r), need, pairs);

  for (let r = 0; r <= BIG; r++) {
    if (!free(r)) continue;
    if (has(r) >= 1 && want(shape('single', r, 1, 0, 1))) emit(shape('single', r, 1, 0, 1), body(r, 1, 1));
    if (has(r) >= 2 && want(shape('pair', r, 1, 0, 2))) emit(shape('pair', r, 1, 0, 2), body(r, 1, 2));
    if (has(r) < 3) continue;
    if (want(shape('triple', r, 1, 0, 3))) emit(shape('triple', r, 1, 0, 3), body(r, 1, 3));
    if (r > TWO) continue;
    for (const wing of [1, 2] as const) {
      const combo = shape('triple', r, 1, wing, wing === 1 ? 4 : 5);
      if (!want(combo)) continue;
      const extra = ride((q) => q === r, 1, wing === 2);
      if (extra) emit(combo, [...body(r, 1, 3), ...extra]);
    }
  }

  runs(1, 5, (s, len) => {
    const combo = shape('straight', s, len, 0, len);
    if (want(combo)) emit(combo, body(s, len, 1));
  });
  runs(2, 3, (s, len) => {
    const combo = shape('pairs', s, len, 0, 2 * len);
    if (want(combo)) emit(combo, body(s, len, 2));
  });
  runs(3, 2, (s, len) => {
    for (const wing of [0, 1, 2] as const) {
      const combo = shape('plane', s, len, wing, len * (3 + wing));
      if (!want(combo)) continue;
      const extra = wing === 0 ? [] : ride((q) => q >= s && q < s + len, len, wing === 2);
      if (extra) emit(combo, [...body(s, len, 3), ...extra]);
    }
  });

  for (let r = 0; r <= TWO; r++) {
    if (has(r) < 4) continue;
    if (free(r)) {
      for (const wing of [1, 2] as const) {
        const combo = shape('four', r, 1, wing, wing === 1 ? 6 : 8);
        if (!want(combo)) continue;
        const extra = ride((q) => q === r, 2, wing === 2);
        if (extra) emit(combo, [...body(r, 1, 4), ...extra]);
      }
    }
    for (let size = 4; size <= has(r); size++) {
      const combo = shape('bomb', r, 1, 0, size);
      if (want(combo)) emit(combo, body(r, 1, size));
    }
  }
  if (decks > 0 && has(SMALL) === decks && has(BIG) === decks) {
    const combo = shape('rocket', BIG, 1, 0, 2 * decks);
    if (want(combo)) emit(combo, [...by[SMALL] as Card[], ...by[BIG] as Card[]]);
  }
  return out;
}
