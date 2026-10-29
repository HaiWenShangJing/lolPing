/**
 * One round of the pets' mahjong scene, planned ahead as a list of events with the time each one happens. The page only
 * plays the plan, so what the pets do is decided (and tested) here: tiles are shuffled, dealt, drawn and thrown on a
 * real table, a pet claims a thrown tile now and then, and the round ends when a pet wins with a hand that really wins
 * and that only uses tiles nobody has seen yet.
 */

import { MahjongTable, SEAT_COUNT, countKinds, winningHand, type Meld } from './mahjong';

/** What a pet says, by kind: the page picks the line from the pool of that kind with `variant`, a number from 0 up to 1. */
export type ChatKind = 'draw' | 'think' | 'throw' | 'tease' | 'pong' | 'chow' | 'win' | 'lose' | 'cheer';
/** How a pet that did not win takes the end of the round. */
export type Reaction = 'shock' | 'lose' | 'cheer' | 'laugh';

export type PlanEvent =
  | { at: number; type: 'shuffle'; ms: number }
  | { at: number; type: 'dice'; ms: number; dice: [number, number] }
  | { at: number; type: 'deal'; ms: number }
  /** A tile comes off the wall into the hand of `seat`; `left` is what is left to draw. */
  | { at: number; type: 'draw'; seat: number; left: number }
  | { at: number; type: 'think'; seat: number; ms: number }
  /** `seat` throws `tile`; `fromDrawn` when it is the tile it has just drawn. */
  | { at: number; type: 'throw'; seat: number; tile: number; fromDrawn: boolean }
  /** `seat` claims the tile just thrown, which leaves the pool of `meld.from`, and lays out `meld`. */
  | { at: number; type: 'call'; seat: number; kind: Meld['kind']; meld: Meld }
  | { at: number; type: 'chat'; seat: number; kind: ChatKind; variant: number }
  | { at: number; type: 'react'; seat: number; reaction: Reaction }
  /**
   * `seat` wins: `hand` is the tiles it holds in the hand (sorted), `tile` the one that completes it, either drawn
   * (`from` is null) or thrown by seat `from` just before; `melds` are the sets it laid out earlier.
   */
  | { at: number; type: 'win'; seat: number; from: number | null; tile: number; hand: number[]; melds: Meld[] }
  | { at: number; type: 'end' };

export interface RoundPlan {
  events: PlanEvent[];
  /** The seat that won, or null if nobody did. */
  winner: number | null;
  /** The dealer of the round after: the same one if it won (or nobody did), else the next seat. */
  next: number;
  /** When the round is over, in ms from its start. */
  end: number;
}

export const SHUFFLE_MS = 3200;
export const DICE_MS = 1300;
export const DEAL_MS = 2300;
/** How many tiles are thrown before the round ends in a win. */
export const THROWS = { min: 26, max: 40 } as const;
/** How long the winning hand stays on show before the next round starts. */
export const WIN_SHOW_MS = 6000;

const TSUMO_SHARE = 0.4;
const PONG_CHANCE = 0.8;
const CHOW_CHANCE = 0.5;

const between = (random: () => number, lo: number, hi: number): number => lo + Math.min(hi - lo, Math.floor(random() * (hi - lo + 1)));
const chance = (random: () => number, p: number): boolean => random() < p;
const die = (random: () => number): number => between(random, 1, 6);
const pickOne = <T>(random: () => number, from: readonly T[]): T => from[Math.min(from.length - 1, Math.floor(random() * from.length))] as T;

/** Plans a round on a table whose dealer is seat `dealer`; the same random gives the same round. */
export function planRound(random: () => number, dealer: number): RoundPlan {
  const table = MahjongTable.deal(random, dealer);
  const events: PlanEvent[] = [];
  const add = (event: PlanEvent): void => {
    events.push(event);
  };
  const chat = (at: number, seat: number, kind: ChatKind): void => add({ at, type: 'chat', seat, kind, variant: random() });
  const others = (seat: number): number[] => Array.from({ length: SEAT_COUNT - 1 }, (_, i) => (seat + 1 + i) % SEAT_COUNT);

  let at = 0;
  add({ at, type: 'shuffle', ms: SHUFFLE_MS });
  at += SHUFFLE_MS + 150;
  add({ at, type: 'dice', ms: DICE_MS, dice: [die(random), die(random)] });
  at += DICE_MS + 150;
  add({ at, type: 'deal', ms: DEAL_MS });
  at += DEAL_MS + 600;

  const throws = between(random, THROWS.min, THROWS.max);
  const tsumo = chance(random, TSUMO_SHARE);
  let thrown = 0;
  let winner: number | null = null;
  let win: Extract<PlanEvent, { type: 'win' }> | null = null;

  /** The hand `seat` ends with: the tiles it holds, and the one that completes it. Null if no such hand can be made. */
  const finish = (seat: number): { hand: number[]; tile: number } | null => {
    const melds = table.melds[seat] ?? [];
    const seen = countKinds([...table.discards.flat(), ...table.melds.flat().flatMap((m) => m.tiles)]);
    const all = winningHand(random, 4 - melds.length, seen);
    if (!all) return null;
    const tile = pickOne(random, all);
    const hand = [...all];
    hand.splice(hand.indexOf(tile), 1);
    return { hand, tile };
  };

  for (;;) {
    const seat = table.turn;
    const finishing = !table.calling && thrown >= throws;
    const start = at;
    if (!table.calling) {
      if (table.draw() === null) break;
      add({ at, type: 'draw', seat, left: table.left });
      if (chance(random, 0.14)) chat(at + 250, seat, 'draw');
      at += 700;
    }

    if (finishing && tsumo) {
      const done = finish(seat);
      if (!done) break;
      at += between(random, 500, 900);
      win = { at, type: 'win', seat, from: null, tile: done.tile, hand: done.hand, melds: [...(table.melds[seat] ?? [])] };
      winner = seat;
      break;
    }

    if (finishing || chance(random, 0.5)) {
      const ms = finishing ? between(random, 1300, 2000) : between(random, 700, 1500);
      add({ at, type: 'think', seat, ms });
      if (chance(random, 0.3)) chat(at + 200, seat, 'think');
      at += ms + 200;
    }

    if (finishing) {
      const mate = pickOne(random, others(seat));
      const done = finish(mate);
      if (!done) break;
      add({ at, type: 'throw', seat, tile: done.tile, fromDrawn: chance(random, 0.5) });
      at += 600;
      win = { at, type: 'win', seat: mate, from: seat, tile: done.tile, hand: done.hand, melds: [...(table.melds[mate] ?? [])] };
      winner = mate;
      break;
    }

    const choices = table.choices();
    const pick = table.pick(random);
    const fromDrawn = table.drawn !== null && pick === choices.length - 1;
    const tile = table.discard(pick);
    if (tile === null) break;
    thrown += 1;
    add({ at, type: 'throw', seat, tile, fromDrawn });
    if (chance(random, 0.14)) chat(at + 300, seat, 'throw');
    if (chance(random, 0.2)) chat(at + 500, pickOne(random, others(seat)), 'tease');
    at += 450;

    const next = table.turn;
    const pong = [0, 1, 2].map((d) => (next + d) % SEAT_COUNT).find((s) => table.canPong(s));
    const runs = table.chowChoices(next);
    let meld: Meld | null = null;
    let claimer = next;
    if (pong !== undefined && chance(random, PONG_CHANCE)) {
      claimer = pong;
      meld = table.pong(pong);
    } else if (runs.length > 0 && chance(random, CHOW_CHANCE)) {
      meld = table.chow(next, pickOne(random, runs));
    }
    if (meld) {
      at += 450;
      add({ at, type: 'call', seat: claimer, kind: meld.kind, meld });
      if (chance(random, 0.5)) chat(at + 300, claimer, meld.kind);
      at += 1100;
    }
    at += between(random, 450, 850);
    if (at - start < 1800) at = start + 1800;
  }

  if (win) {
    add(win);
    const lost = win.from;
    if (lost !== null) {
      add({ at: win.at + 350, type: 'react', seat: lost, reaction: 'lose' });
      chat(win.at + 1500, lost, 'lose');
    }
    chat(win.at + 500, win.seat, 'win');
    const rest = others(win.seat).filter((s) => s !== lost);
    rest.forEach((s, i) => {
      const reaction = pickOne<Reaction>(random, lost === null ? ['shock', 'lose', 'cheer', 'laugh'] : ['shock', 'cheer', 'laugh']);
      add({ at: win.at + 600 + i * 280, type: 'react', seat: s, reaction });
    });
    if (rest.length > 0) chat(win.at + 2300, pickOne(random, rest), 'cheer');
    at = win.at + WIN_SHOW_MS;
  }
  add({ at, type: 'end' });
  events.sort((a, b) => a.at - b.at);
  return { events, winner, next: winner === null || winner === dealer ? dealer : (dealer + 1) % SEAT_COUNT, end: at };
}
