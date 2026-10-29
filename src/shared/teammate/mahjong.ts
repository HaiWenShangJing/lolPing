/**
 * A mahjong table for the pets' scene: the wall, four hands and the discards, with turns that go round. A pet may claim
 * a thrown tile for a triplet or a run (then throws without drawing), and a round ends in a hand that wins. It is only
 * as much of the rules as the scene needs: no scoring, no kongs, no flowers. The pets throw the tile that fits their hand
 * least; a hand is sorted and the tile just drawn is kept apart until it is thrown or kept.
 */

/** 34 kinds: 0-8 characters, 9-17 bamboo, 18-26 circles, 27-30 winds, 31-33 dragons; four of each. */
export const KINDS = 34;
export const HAND_SIZE = 13;
export const SEAT_COUNT = 4;
/** The last tiles of the wall are not drawn, as at a real table. */
export const DEAD_WALL = 14;

/** The tile's face as a character of the Unicode mahjong block. */
export function tileChar(kind: number): string {
  if (kind < 0 || kind >= KINDS) return '';
  if (kind < 27) return String.fromCodePoint([0x1f007, 0x1f010, 0x1f019][Math.floor(kind / 9)] as number + (kind % 9));
  if (kind < 31) return String.fromCodePoint(0x1f000 + (kind - 27));
  return String.fromCodePoint(0x1f004 + (kind - 31));
}

const suitOf = (kind: number): number => (kind < 27 ? Math.floor(kind / 9) : -1);

const sorted = (tiles: readonly number[]): number[] => [...tiles].sort((a, b) => a - b);

/** A set a pet claimed from a thrown tile: three tiles laid face up beside its hand. */
export interface Meld {
  kind: 'pong' | 'chow';
  /** The three tiles, a run in ascending order. */
  tiles: number[];
  /** The seat the claimed tile came from. */
  from: number;
  /** The tile that was claimed. */
  claimed: number;
}

/** How many of each of the 34 kinds `tiles` holds. */
export function countKinds(tiles: readonly number[]): number[] {
  const counts = Array.from({ length: KINDS }, () => 0);
  for (const t of tiles) if (t >= 0 && t < KINDS) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}

/** Whether the counts are all triplets and runs: the smallest tile left must start one of them. */
function setsOnly(counts: number[]): boolean {
  const k = counts.findIndex((c) => c > 0);
  if (k < 0) return true;
  if ((counts[k] ?? 0) >= 3) {
    counts[k] = (counts[k] ?? 0) - 3;
    const ok = setsOnly(counts);
    counts[k] = (counts[k] ?? 0) + 3;
    if (ok) return true;
  }
  if (k < 27 && k % 9 <= 6 && (counts[k + 1] ?? 0) > 0 && (counts[k + 2] ?? 0) > 0) {
    for (const i of [k, k + 1, k + 2]) counts[i] = (counts[i] ?? 0) - 1;
    const ok = setsOnly(counts);
    for (const i of [k, k + 1, k + 2]) counts[i] = (counts[i] ?? 0) + 1;
    return ok;
  }
  return false;
}

/** Whether `tiles` (two more than a multiple of three) are triplets and runs and one pair, or seven different pairs. */
export function isWinning(tiles: readonly number[]): boolean {
  const counts = countKinds(tiles);
  if (tiles.length === 14 && counts.every((c) => c === 0 || c === 2)) return true;
  if (tiles.length % 3 !== 2) return false;
  for (let k = 0; k < KINDS; k++) {
    if ((counts[k] ?? 0) < 2) continue;
    counts[k] = (counts[k] ?? 0) - 2;
    const ok = setsOnly(counts);
    counts[k] = (counts[k] ?? 0) + 2;
    if (ok) return true;
  }
  return false;
}

/**
 * A hand that wins, made of `sets` triplets and runs and a pair (so `3 * sets + 2` tiles, sorted), that only uses the
 * tiles still unseen: `seen` is how many of each kind lie face up on the table. Null if no such hand turns up.
 */
export function winningHand(random: () => number, sets: number, seen: readonly number[]): number[] | null {
  const pick = <T>(from: readonly T[]): T => from[Math.min(from.length - 1, Math.floor(random() * from.length))] as T;
  for (let attempt = 0; attempt < 80; attempt++) {
    const left = Array.from({ length: KINDS }, (_, k) => 4 - (seen[k] ?? 0));
    const tiles: number[] = [];
    const pairs = left.flatMap((n, k) => (n >= 2 ? [k] : []));
    if (pairs.length === 0) return null;
    const pair = pick(pairs);
    left[pair] = (left[pair] ?? 0) - 2;
    tiles.push(pair, pair);
    let ok = true;
    for (let s = 0; s < sets && ok; s++) {
      const triplets = left.flatMap((n, k) => (n >= 3 ? [k] : []));
      const runs = left.flatMap((n, k) => (k < 27 && k % 9 <= 6 && n > 0 && (left[k + 1] ?? 0) > 0 && (left[k + 2] ?? 0) > 0 ? [k] : []));
      const triplet = triplets.length > 0 && (runs.length === 0 || random() < 0.28);
      if (triplet) {
        const k = pick(triplets);
        left[k] = (left[k] ?? 0) - 3;
        tiles.push(k, k, k);
      } else if (runs.length > 0) {
        const k = pick(runs);
        for (const i of [k, k + 1, k + 2]) left[i] = (left[i] ?? 0) - 1;
        tiles.push(k, k + 1, k + 2);
      } else {
        ok = false;
      }
    }
    if (ok) return sorted(tiles);
  }
  return null;
}

/** The shuffled 136 tiles. */
export function buildWall(random: () => number): number[] {
  const wall = Array.from({ length: KINDS * 4 }, (_, i) => i % KINDS);
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [wall[i], wall[j]] = [wall[j] as number, wall[i] as number];
  }
  return wall;
}

/** How well `tile` goes with the rest of the tiles: pairs and neighbours in its suit keep it, a lone tile does not. */
function fit(tile: number, hand: readonly number[]): number {
  let score = 0;
  let same = 0;
  for (const other of hand) {
    if (other === tile) {
      same += 1;
      continue;
    }
    if (suitOf(tile) >= 0 && suitOf(other) === suitOf(tile)) {
      const gap = Math.abs(other - tile);
      if (gap === 1) score += 1.5;
      else if (gap === 2) score += 1;
    }
  }
  // One of the same is the tile itself; each more is a pair or a triplet kept together.
  score += (same - 1) * 3;
  return suitOf(tile) < 0 && same === 1 ? 0.2 : score;
}

export class MahjongTable {
  readonly wall: number[];
  readonly hands: number[][];
  readonly discards: number[][];
  /** The sets each seat has claimed. */
  readonly melds: Meld[][];
  readonly dealer: number;
  turn: number;
  /** The tile the player whose turn it is has just drawn, kept apart from the hand. */
  drawn: number | null = null;
  last: { seat: number; tile: number } | null = null;
  /** The player whose turn it is has just claimed a tile: it throws one without drawing first. */
  calling = false;
  /** The wall ran out. */
  over = false;

  private constructor(wall: number[], hands: number[][], dealer: number) {
    this.wall = wall;
    this.hands = hands;
    this.discards = hands.map(() => []);
    this.melds = hands.map(() => []);
    this.dealer = dealer;
    this.turn = dealer;
  }

  /** A shuffled wall and 13 tiles each; the dealer is `dealer`, or any seat at random. */
  static deal(random: () => number, dealer?: number): MahjongTable {
    const wall = buildWall(random);
    const hands = Array.from({ length: SEAT_COUNT }, () => sorted(wall.splice(wall.length - HAND_SIZE, HAND_SIZE)));
    return new MahjongTable(wall, hands, dealer ?? Math.min(SEAT_COUNT - 1, Math.floor(random() * SEAT_COUNT)));
  }

  /** Tiles that can still be drawn. */
  get left(): number {
    return Math.max(0, this.wall.length - DEAD_WALL);
  }

  /** The player whose turn it is draws; the tile, or null when the wall has run out (and the game is over). */
  draw(): number | null {
    if (this.over || this.drawn !== null || this.calling) return this.drawn;
    const tile = this.left > 0 ? this.wall.pop() : undefined;
    if (tile === undefined) {
      this.over = true;
      return null;
    }
    this.drawn = tile;
    return tile;
  }

  /** What the player whose turn it is may throw: the hand, then the drawn tile last. */
  choices(): number[] {
    const hand = this.hands[this.turn] ?? [];
    return this.drawn === null ? [...hand] : [...hand, this.drawn];
  }

  /** The player throws the tile at `at` of `choices()`, and the turn goes to the next seat. Null for a bad index. */
  discard(at: number): number | null {
    const all = this.choices();
    const tile = all[at];
    if (tile === undefined || (this.drawn === null && !this.calling)) return null;
    all.splice(at, 1);
    this.hands[this.turn] = sorted(all);
    this.discards[this.turn]?.push(tile);
    this.last = { seat: this.turn, tile };
    this.drawn = null;
    this.calling = false;
    this.turn = (this.turn + 1) % SEAT_COUNT;
    return tile;
  }

  /** The tile just thrown, if `seat` could still claim it: not its own, and nobody has drawn since. */
  private claimable(seat: number): { seat: number; tile: number } | null {
    const l = this.last;
    return l && l.seat !== seat && !this.over && this.drawn === null && !this.calling ? l : null;
  }

  /** Whether `seat` holds two of the tile just thrown, to claim it for a triplet. */
  canPong(seat: number): boolean {
    const l = this.claimable(seat);
    return l !== null && (this.hands[seat] ?? []).filter((t) => t === l.tile).length >= 2;
  }

  /** The pairs from `seat`'s hand that make a run with the tile just thrown by the seat before it. */
  chowChoices(seat: number): [number, number][] {
    const l = this.claimable(seat);
    if (!l || (l.seat + 1) % SEAT_COUNT !== seat || l.tile >= 27) return [];
    const hand = this.hands[seat] ?? [];
    const rank = l.tile % 9;
    const has = (k: number): boolean => hand.includes(k);
    const t = l.tile;
    const out: [number, number][] = [];
    if (rank >= 2 && has(t - 2) && has(t - 1)) out.push([t - 2, t - 1]);
    if (rank >= 1 && rank <= 7 && has(t - 1) && has(t + 1)) out.push([t - 1, t + 1]);
    if (rank <= 6 && has(t + 1) && has(t + 2)) out.push([t + 1, t + 2]);
    return out;
  }

  /** Takes the tile just thrown into `own` of `seat`'s tiles and lays the three out; then `seat` throws without drawing. */
  private claim(seat: number, kind: Meld['kind'], own: readonly number[]): Meld | null {
    const l = this.claimable(seat);
    if (!l) return null;
    const hand = [...(this.hands[seat] ?? [])];
    for (const t of own) {
      const at = hand.indexOf(t);
      if (at < 0) return null;
      hand.splice(at, 1);
    }
    this.hands[seat] = hand;
    this.discards[l.seat]?.pop();
    const meld: Meld = { kind, tiles: sorted([...own, l.tile]), from: l.seat, claimed: l.tile };
    this.melds[seat]?.push(meld);
    this.last = null;
    this.turn = seat;
    this.calling = true;
    return meld;
  }

  /** `seat` claims the tile just thrown for a triplet; null if it cannot. */
  pong(seat: number): Meld | null {
    const l = this.last;
    return this.canPong(seat) && l ? this.claim(seat, 'pong', [l.tile, l.tile]) : null;
  }

  /** `seat` claims the tile just thrown for a run with `pair` from its hand; null if it cannot. */
  chow(seat: number, pair: readonly [number, number]): Meld | null {
    const ok = this.chowChoices(seat).some(([a, b]) => a === pair[0] && b === pair[1]);
    return ok ? this.claim(seat, 'chow', pair) : null;
  }

  /** The index of the tile a pet throws now: the one that fits the others least, any such at random. */
  pick(random: () => number): number {
    const all = this.choices();
    const scores = all.map((t) => fit(t, all));
    const least = Math.min(...scores);
    const at = all.flatMap((_, i) => (scores[i] === least ? [i] : []));
    return at[Math.min(at.length - 1, Math.floor(random() * at.length))] ?? all.length - 1;
  }
}
