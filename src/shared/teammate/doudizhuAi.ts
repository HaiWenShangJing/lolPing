/**
 * The bots of a Dou Dizhu table: how much a hand is worth for a bid, and which play to make or whether to pass. They look
 * at the table only through a TableView, so they know no more than a player would. The same choice, put first, is the
 * hint a person is given.
 */
import { ACE, BIG, RANKS, SMALL, TWO, isBomb, plays } from './doudizhuCards';
import type { Card, Play } from './doudizhuCards';
import { sides, unseen } from './doudizhuView';
import type { TableView } from './doudizhuView';

/** The longest run of ranks, from 3 up to the ace, that all have at least `need` cards, as [start, length]. */
function longestRun(c: readonly number[], need: number, min: number): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  for (let r = 0; r <= ACE + 1; r++) {
    const ok = r <= ACE && (c[r] ?? 0) >= need;
    if (ok && start < 0) start = r;
    if (!ok && start >= 0) {
      const len = r - start;
      if (len >= min && (best === null || len > best[1])) best = [start, len];
      start = -1;
    }
  }
  return best;
}

/**
 * About how many turns it takes to play out a hand, given how many cards it has of each rank: the rocket and every
 * bomb in one play each, then planes, triples, runs of pairs and straights, then what is left as pairs and singles,
 * the triples and planes taking some of those along with them.
 */
export function turnsToGo(counts: readonly number[], decks: number): number {
  const c = [...counts];
  let turns = 0;
  let wings = 0;
  if (c[SMALL] === decks && c[BIG] === decks) {
    turns += 1;
    c[SMALL] = 0;
    c[BIG] = 0;
  }
  for (let r = 0; r <= TWO; r++) {
    if ((c[r] ?? 0) >= 4) {
      turns += 1;
      c[r] = 0;
    }
  }
  for (let run = longestRun(c, 3, 2); run; run = longestRun(c, 3, 2)) {
    for (let r = run[0]; r < run[0] + run[1]; r++) c[r] = (c[r] ?? 0) - 3;
    turns += 1;
    wings += run[1];
  }
  for (let r = 0; r <= TWO; r++) {
    if (c[r] === 3) {
      turns += 1;
      wings += 1;
      c[r] = 0;
    }
  }
  for (let run = longestRun(c, 2, 3); run; run = longestRun(c, 2, 3)) {
    for (let r = run[0]; r < run[0] + run[1]; r++) c[r] = (c[r] ?? 0) - 2;
    turns += 1;
  }
  for (let run = longestRun(c, 1, 5); run; run = longestRun(c, 1, 5)) {
    for (let r = run[0]; r < run[0] + run[1]; r++) c[r] = (c[r] ?? 0) - 1;
    turns += 1;
  }
  let loose = 0;
  for (let r = 0; r < RANKS; r++) if ((c[r] ?? 0) > 0) loose += 1;
  return turns + loose - Math.min(wings, loose);
}

/** The bid a hand is worth: the strength it has to reach for a bid of 1, 2 and 3. */
export const BID_AT: readonly [number, number, number] = [3.5, 5.5, 7.5];

/**
 * How strong a hand is for the landlord's seat: what it has to win a trick whenever it likes (bombs, the jokers, twos,
 * aces) and how few turns it takes to play out, scaled to the 17 cards of a plain table.
 */
export function strength(hand: readonly Card[], decks: number): number {
  const c = new Array<number>(RANKS).fill(0);
  for (const card of hand) c[card.rank] = (c[card.rank] ?? 0) + 1;
  let s = 0;
  for (let r = 0; r <= TWO; r++) if ((c[r] ?? 0) >= 4) s += 2;
  s += 2 * (c[BIG] ?? 0) + 1.5 * (c[SMALL] ?? 0);
  if (c[SMALL] === decks && c[BIG] === decks) s += 1;
  s += (c[TWO] ?? 0) + 0.5 * (c[ACE] ?? 0);
  const expected = hand.length * 0.55;
  s += Math.max(-2, Math.min(2, 0.5 * (expected - turnsToGo(c, decks))));
  return (s * 17) / hand.length;
}

/** What a seat bids, from `min` to `max`; 0 when it passes. */
export function botBid(v: TableView, min: number, max: number): number {
  const s = strength(v.hand, v.decks);
  const want = s >= BID_AT[2] ? 3 : s >= BID_AT[1] ? 2 : s >= BID_AT[0] ? 1 : 0;
  return want >= min ? Math.min(want, max) : 0;
}

interface Option {
  play: Play;
  /** The turns the rest of the hand will take after this play. */
  rest: number;
}

/** The ranks no play but a bomb may use: the bombs the hand holds, and the jokers when it holds the rocket. */
function keepRanks(counts: readonly number[], decks: number): Set<number> {
  const keep = new Set<number>();
  for (let r = 0; r <= TWO; r++) if ((counts[r] ?? 0) >= 4) keep.add(r);
  if (counts[SMALL] === decks && counts[BIG] === decks) keep.add(SMALL).add(BIG);
  return keep;
}

const rankCounts = (hand: readonly Card[]): number[] => {
  const c = new Array<number>(RANKS).fill(0);
  for (const card of hand) c[card.rank] = (c[card.rank] ?? 0) + 1;
  return c;
};

/** The card a landlord who is still hidden takes first, so that playing the rank gives him away to his partners. */
export function revealing(v: TableView): number | null {
  const call = v.call;
  if (!call || !v.hidden) return null;
  return v.hand.find((c) => c.rank === call.rank && c.suit === call.suit)?.id ?? null;
}

/** Every play open to the seat; with `keep`, not those that would break up a bomb it holds. */
function legal(v: TableView, keep: boolean): Play[] {
  return plays(v.hand, v.decks, v.top?.combo ?? null, {
    prefer: revealing(v),
    keep: keep ? keepRanks(rankCounts(v.hand), v.decks) : undefined,
  });
}

/** The plays a bot chooses among: those open to the seat, but for any that would break up a bomb it holds. */
export const choices = (v: TableView): Play[] => legal(v, true);

/** The plays open to the seat, each with the turns it leaves; fewest turns first, then the lowest, then the most cards. */
function options(v: TableView, keep: boolean): Option[] {
  const counts = rankCounts(v.hand);
  const byId = new Map(v.hand.map((c) => [c.id, c.rank]));
  return legal(v, keep)
    .map((play) => {
      const rest = [...counts];
      for (const id of play.ids) {
        const rank = byId.get(id) as number;
        rest[rank] = (rest[rank] ?? 0) - 1;
      }
      return { play, rest: turnsToGo(rest, v.decks) };
    })
    .sort((a, b) => a.rest - b.rest || a.play.combo.rank - b.play.combo.rank || b.play.combo.size - a.play.combo.size);
}

const byWeight = (a: Option, b: Option): number =>
  a.rest - b.rest || a.play.combo.size - b.play.combo.size || a.play.combo.rank - b.play.combo.rank;

/** The fewest cards a foe has left; nobody is a foe to a seat that has none. */
const fewestFoe = (v: TableView, foes: readonly number[]): number =>
  foes.reduce((least, seat) => Math.min(least, v.counts[seat] ?? Infinity), Infinity);

/** Whether no card that is out of sight is higher than a single of rank `rank`. */
const unbeatable = (v: TableView, rank: number): boolean => unseen(v).every((n, r) => r <= rank || n <= 0);

function lead(v: TableView, foes: readonly number[]): Play {
  const all = options(v, true);
  const out = all.find((o) => o.rest === 0);
  if (out) return out.play;
  const bombs = all.filter((o) => isBomb(o.play.combo)).sort(byWeight);
  if (bombs[0] && bombs[0].rest <= 1) return bombs[0].play;
  let pool = all.filter((o) => !isBomb(o.play.combo));
  if (!pool.length) return (bombs[0] as Option).play;
  const near = fewestFoe(v, foes);
  // A foe with one card left can only beat a single, and with two only a pair or a single.
  const safer = near <= 1
    ? pool.filter((o) => o.play.combo.kind !== 'single' || unbeatable(v, o.play.combo.rank))
    : near === 2 ? pool.filter((o) => o.play.combo.kind !== 'pair') : pool;
  if (safer.length) pool = safer;
  return pool[0]?.play as Play;
}

function follow(v: TableView, friends: readonly number[], foes: readonly number[]): Play | null {
  const top = v.top;
  if (!top) return null;
  const all = options(v, true);
  const out = all.find((o) => o.rest === 0);
  if (out) return out.play;
  if (friends.includes(top.seat)) return null;
  const urgent = fewestFoe(v, foes) <= 3;
  const now = turnsToGo(rankCounts(v.hand), v.decks);
  const quiet = all.filter((o) => !isBomb(o.play.combo));
  const best = quiet[0];
  if (best) {
    const extra = best.rest - (now - 1);
    const cheap = best.play.combo.rank < ACE;
    if (extra <= 0 || urgent || (extra <= 1 && cheap)) return best.play;
  }
  const bombs = all.filter((o) => isBomb(o.play.combo)).sort(byWeight);
  const bomb = bombs[0];
  if (bomb && (urgent || bomb.rest <= 1)) return bomb.play;
  return null;
}

/** The ids a bot plays, none when it passes. */
export function botPlay(v: TableView): number[] {
  const { friends, foes } = sides(v);
  const play = v.top ? follow(v, friends, foes) : lead(v, foes);
  return play ? play.ids : [];
}

/**
 * The plays a person can be shown as hints, best first: what a bot would play, then every other play from the cheapest
 * to the dearest, the bombs last. At a lead there is no pass to offer.
 */
export function hintList(v: TableView): number[][] {
  const first = botPlay(v);
  const every = options(v, false);
  const rest = every
    .filter((o) => !isBomb(o.play.combo))
    .sort((a, b) => a.play.combo.rank - b.play.combo.rank || a.play.combo.size - b.play.combo.size)
    .concat(every.filter((o) => isBomb(o.play.combo)).sort(byWeight))
    .map((o) => o.play.ids);
  const seen = new Set<string>();
  const out: number[][] = [];
  for (const ids of first.length ? [first, ...rest] : rest) {
    const key = [...ids].sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ids);
  }
  return out;
}
