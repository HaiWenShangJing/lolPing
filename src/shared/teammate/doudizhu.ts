/**
 * The state of a Dou Dizhu table and what changes it: the deal, which side each seat is on, the cards played and the
 * points at the end. The order of a game is in doudizhuRun.ts.
 */
import { PACK, RANKS, buildDeck, checkPlay, isBomb, shuffle, sortHand } from './doudizhuCards';
import type { Card, Combo, Play } from './doudizhuCards';
import { CONFIG, MAX_DOUBLINGS, Stopped } from './doudizhuTypes';
import type { Ask, Config, Deps, Entry, Reply, Result, Role, Size } from './doudizhuTypes';

/** The play on the table that the others have to beat. */
export interface Top {
  readonly seat: number;
  readonly combo: Combo;
  readonly cards: Card[];
}

export interface Player {
  readonly seat: number;
  role: Role;
  hand: Card[];
  /** Hands played so far. */
  plays: number;
  /** Whether the whole table knows which side the seat is on. */
  open: boolean;
}

export class Table {
  readonly cfg: Config;
  readonly players: Player[];
  /** The cards no hand was dealt. */
  holes: Card[] = [];
  /** What a game is worth before the doublings: the winning bid, or 1 at a table that calls a card. */
  base = 1;
  /** The card called, at a table that calls one. */
  call: Card | null = null;
  /** The landlord in the open, once there is one. */
  lord: number | null = null;
  top: Top | null = null;
  /** Passes in a row since the last play. */
  passes = 0;
  /** Whose turn it is to play. */
  turn = 0;
  turns = 0;
  /** Bombs and rockets played. */
  bombs = 0;
  fallbacks = 0;
  /** How many cards of each rank have been played. */
  readonly seen: number[] = new Array<number>(RANKS).fill(0);

  constructor(readonly deps: Deps, readonly size: Size) {
    this.cfg = CONFIG[size];
    this.players = Array.from({ length: size }, (_, seat) => ({
      seat, role: 'farmer' as Role, hand: [] as Card[], plays: 0, open: false,
    }));
  }

  get decks(): number {
    return this.cfg.decks;
  }

  p(seat: number): Player {
    return this.players[seat] as Player;
  }

  /** The seats on the landlord side, as things are known to the table itself. */
  landlords(): number[] {
    return this.players.filter((p) => p.role === 'landlord').map((p) => p.seat);
  }

  async emit(entry: Entry): Promise<void> {
    await this.deps.emit(entry, this);
    if (this.deps.stopped()) throw new Stopped();
  }

  async ask(seat: number, ask: Ask): Promise<Reply | null> {
    if (this.deps.stopped()) throw new Stopped();
    const reply = await this.deps.ask(seat, ask, this);
    if (this.deps.stopped()) throw new Stopped();
    return reply;
  }

  /** Deals afresh: a hand to every seat, the rest to the holes. Nobody is a landlord yet. */
  deal(): void {
    const deck = shuffle(buildDeck(this.cfg.decks), this.deps.random);
    const n = this.cfg.hand;
    for (const p of this.players) {
      p.hand = sortHand(deck.slice(p.seat * n, (p.seat + 1) * n));
      p.role = 'farmer';
      p.plays = 0;
      p.open = false;
    }
    this.holes = deck.slice(this.size * n);
    this.base = 1;
    this.call = null;
    this.lord = null;
  }

  /** A bid is won: the landlord takes the cards that were left, and the table knows who is who. */
  crown(seat: number, bid: number): void {
    const p = this.p(seat);
    p.role = 'landlord';
    p.hand = sortHand([...p.hand, ...this.holes]);
    this.lord = seat;
    this.base = bid;
    for (const q of this.players) q.open = true;
  }

  /**
   * Finds a card to call: one of which every copy is in a different hand and none among the holes, so that the copies
   * mark the landlord side. The holder of the first copy is the landlord in the open; the others are landlords still
   * hidden. With `any` the card need only be somewhere in a hand, for when no deal has had a better one. Null when no
   * card will do.
   */
  findCall(any = false): { card: Card; held: number[] } | null {
    const owner = new Map<number, number>();
    for (const p of this.players) for (const c of p.hand) owner.set(c.id, p.seat);
    const slots = 52;
    const start = Math.floor(this.deps.random() * slots);
    for (let i = 0; i < slots; i++) {
      const slot = (start + i) % slots;
      const held: number[] = [];
      for (let d = 0; d < this.cfg.decks; d++) {
        const seat = owner.get(d * PACK + slot);
        if (seat !== undefined) held.push(seat);
      }
      const whole = held.length === this.cfg.decks && new Set(held).size === held.length;
      if (held.length === 0 || (!any && !whole)) continue;
      const card = this.p(held[0] as number).hand.find((c) => c.id % PACK === slot) as Card;
      return { card, held };
    }
    return null;
  }

  /** Calls the card: the holders of its copies are the landlords, and the first of them takes the holes in the open. */
  setCall(card: Card, held: readonly number[]): void {
    for (const seat of held) this.p(seat).role = 'landlord';
    const lord = this.p(held[0] as number);
    lord.open = true;
    lord.hand = sortHand([...lord.hand, ...this.holes]);
    this.lord = lord.seat;
    this.call = card;
    this.base = 1;
  }

  /**
   * The play a reply comes to, null for a pass. A reply that does not fit is put right, and counted: a pass, or at a
   * lead the lowest card there is.
   */
  accept(seat: number, reply: Reply | null): Play | null {
    const hand = this.p(seat).hand;
    const top = this.top?.combo ?? null;
    if (reply?.k === 'play') {
      if (reply.ids.length === 0 && top !== null) return null;
      const play = checkPlay(hand, reply.ids, top, this.decks);
      if (play) return play;
    }
    this.fallbacks += 1;
    if (top !== null) return null;
    const low = hand[hand.length - 1] as Card;
    return { ids: [low.id], combo: { kind: 'single', rank: low.rank, len: 1, wing: 0, size: 1 } };
  }

  /** Takes the cards of a play out of the hand and lays them on the table. */
  put(seat: number, play: Play): Card[] {
    const p = this.p(seat);
    const gone = new Set(play.ids);
    const cards = p.hand.filter((c) => gone.has(c.id));
    p.hand = p.hand.filter((c) => !gone.has(c.id));
    p.plays += 1;
    for (const c of cards) this.seen[c.rank] = (this.seen[c.rank] ?? 0) + 1;
    if (isBomb(play.combo)) this.bombs += 1;
    this.top = { seat, combo: play.combo, cards };
    this.passes = 0;
    return cards;
  }

  /** A pass. When everyone else has passed on the play, the table is cleared and the one who made it leads again. */
  pass(): void {
    this.passes += 1;
    if (this.passes < this.size - 1) return;
    this.passes = 0;
    this.top = null;
  }

  /** Whether the cards just played give away a landlord who was hidden: one of them is the card that was called. */
  reveals(seat: number, cards: readonly Card[]): boolean {
    const call = this.call;
    const p = this.p(seat);
    return call !== null && p.role === 'landlord' && !p.open
      && cards.some((c) => c.rank === call.rank && c.suit === call.suit);
  }

  /** The seat is known to be a landlord. Once all of them are, the others are known for farmers. */
  reveal(seat: number): void {
    this.p(seat).open = true;
    if (this.players.every((p) => p.role !== 'landlord' || p.open)) for (const p of this.players) p.open = true;
  }

  /** The result of the game, `out` being the seat that played its last card. */
  settle(out: number): Result {
    const winner = this.p(out).role;
    const landlords = this.landlords();
    const lordPlays = landlords.reduce((sum, seat) => sum + this.p(seat).plays, 0);
    const farmerPlays = this.players.reduce((sum, p) => sum + p.plays, 0) - lordPlays;
    let spring: Result['spring'] = null;
    if (winner === 'landlord' && farmerPlays === 0) spring = 'spring';
    if (winner === 'farmer' && lordPlays <= 1) spring = 'counter';
    const doublings = Math.min(MAX_DOUBLINGS, this.bombs + (spring ? 1 : 0));
    const unit = this.base * 2 ** doublings;
    // Each side pays or is paid by the other, so that what one seat wins is what the seats on the other side lose.
    const lords = landlords.length;
    const farmers = this.size - lords;
    const scores = this.players.map((p) => {
      const sign = p.role === winner ? 1 : -1;
      return sign * unit * (p.role === 'landlord' ? farmers : lords);
    });
    return { winner, out, base: this.base, bombs: this.bombs, spring, doublings, scores, landlords };
  }
}
