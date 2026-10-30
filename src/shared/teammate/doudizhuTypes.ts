/**
 * The shapes the Dou Dizhu table passes around: how each size of table is dealt, what the rules ask of a player and what
 * they answer, and the entries the table reports as it goes. Nothing here has behaviour apart from the error that ends
 * a game early.
 */
import type { Card, Play } from './doudizhuCards';
import type { Table } from './doudizhu';

export type Size = 3 | 4 | 5 | 6;
export const SIZES: readonly Size[] = [3, 4, 5, 6];
export const isSize = (raw: unknown): raw is Size => raw === 3 || raw === 4 || raw === 5 || raw === 6;

/** The landlord side plays against the farmers; a table of one landlord has him alone against the rest. */
export type Role = 'landlord' | 'farmer';

/**
 * How the landlords are found. At a table of `bid` the players bid for the landlord's seat and the winner takes the
 * cards no hand was dealt. At a table of `call` a card is called after the deal and whoever holds a copy of it is on the
 * landlord side: the holder of the first copy in the open, the others hidden until they play theirs.
 */
export type Mode = 'bid' | 'call';

export interface Config {
  readonly decks: number;
  /** The cards dealt to each seat. */
  readonly hand: number;
  /** The cards left over, which go to the landlord who is in the open. */
  readonly holes: number;
  readonly mode: Mode;
  /** The seats on the landlord side. */
  readonly landlords: number;
}

export const CONFIG: Record<Size, Config> = {
  3: { decks: 1, hand: 17, holes: 3, mode: 'bid', landlords: 1 },
  4: { decks: 2, hand: 25, holes: 8, mode: 'bid', landlords: 1 },
  5: { decks: 2, hand: 21, holes: 3, mode: 'call', landlords: 2 },
  6: { decks: 3, hand: 27, holes: 0, mode: 'call', landlords: 3 },
};

/** The highest bid; it ends the bidding at once. */
export const MAX_BID = 3;
/** The points double for each bomb and for a spring, but only so many times, so that a run of bombs cannot run away. */
export const MAX_DOUBLINGS = 6;
/** A table where everyone passes is dealt again; after this many deals the first to bid is made the landlord. */
export const MAX_DEALS = 4;

export type Ask =
  /** A bid from `min` to `max`, or none at all. */
  | { k: 'bid'; min: number; max: number }
  /** A play, or a pass when `lead` is false: whoever leads has to play. */
  | { k: 'play'; lead: boolean };

export type Reply =
  /** 0 is no bid. */
  | { k: 'bid'; bid: number }
  /** No cards is a pass. */
  | { k: 'play'; ids: number[] };

/** How a game came out, for the points and for the words that tell of it. */
export interface Result {
  /** The side that went out first. */
  winner: Role;
  /** The seat that played its last card. */
  out: number;
  /** The points a game is worth before the doublings: the bid, or 1 at a table that calls a card. */
  base: number;
  /** The bombs and rockets played. */
  bombs: number;
  /**
   * A spring is a win in which the farmers never got to play; the opposite, a landlord side that played a single hand
   * and lost, is a counter-spring. Either doubles the points.
   */
  spring: 'spring' | 'counter' | null;
  /** How many times the points were doubled, after the cap. */
  doublings: number;
  /** What each seat wins or loses; the seats add up to nothing. */
  scores: number[];
  /** The seats of the landlord side. */
  landlords: number[];
}

export type Entry =
  | { k: 'start'; size: Size }
  /** Everyone passed on the landlord's seat, so the cards are dealt again. */
  | { k: 'redeal' }
  | { k: 'deal' }
  /** A bid, or a pass when `bid` is 0. */
  | { k: 'bid'; seat: number; bid: number }
  /** The bid is won and the landlord has taken the cards that were left. */
  | { k: 'landlord'; seat: number; bid: number; holes: Card[] }
  /** A card is called and the holder of its first copy is the landlord in the open. */
  | { k: 'call'; seat: number; card: Card; holes: Card[] }
  | { k: 'turn'; seat: number; lead: boolean }
  | { k: 'play'; seat: number; play: Play; cards: Card[] }
  | { k: 'pass'; seat: number }
  /** A landlord played the card that was called, so the table knows him. */
  | { k: 'reveal'; seat: number }
  | { k: 'end'; result: Result };

export interface Deps {
  random: () => number;
  /** Puts a question to a player. `null` means no answer, which the rules take as the default (no bid, a pass). */
  ask: (seat: number, ask: Ask, table: Table) => Promise<Reply | null>;
  /** Reports what happened; the table waits for it, so a screen may pause here. */
  emit: (entry: Entry, table: Table) => Promise<void> | void;
  /** True once nobody is watching the game any more. */
  stopped: () => boolean;
}

export interface Outcome {
  result: Result;
  /** Turns taken in the play, passes included. */
  turns: number;
  /** Answers that were missing or did not fit and so were put right by the rules. */
  fallbacks: number;
}

/** Thrown through the table when the window is closed. */
export class Stopped extends Error {
  constructor() {
    super('stopped');
    this.name = 'Stopped';
  }
}
