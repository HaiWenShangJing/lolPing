/**
 * What one seat can see of a Dou Dizhu table: its own cards, how many the others hold, what has been played and which
 * side each seat is known to be on. The bots and the screen both look through this, so neither sees more than a player
 * would.
 */
import { RANKS, SMALL, countRanks } from './doudizhuCards';
import type { Card } from './doudizhuCards';
import type { Table, Top } from './doudizhu';
import { CONFIG } from './doudizhuTypes';
import type { Role, Size } from './doudizhuTypes';

export interface TableView {
  readonly size: Size;
  readonly decks: number;
  readonly me: number;
  /** The seat's own cards, highest first. */
  readonly hand: readonly Card[];
  /** The cards left in every hand, the seat's own included. */
  readonly counts: readonly number[];
  /** The side each seat is known to the viewer to be on; null when it is not known. A seat knows its own. */
  readonly roles: readonly (Role | null)[];
  /** Whether the seat is a landlord that the others do not know yet: it holds a copy of the called card and has not played it. */
  readonly hidden: boolean;
  readonly top: Top | null;
  /** Whether the seat has to lead. */
  readonly lead: boolean;
  /** The landlord in the open. */
  readonly lord: number | null;
  /** The card called, at a table that calls one. */
  readonly call: Card | null;
  /** The cards the landlord in the open took from the holes. */
  readonly holes: readonly Card[];
  readonly base: number;
  /** How many cards of each rank have been played. */
  readonly seen: readonly number[];
  /** The hands each seat has played. */
  readonly plays: readonly number[];
  readonly turn: number;
}

export function viewFor(t: Table, seat: number): TableView {
  const me = t.p(seat);
  return {
    size: t.size,
    decks: t.decks,
    me: seat,
    hand: [...me.hand],
    counts: t.players.map((p) => p.hand.length),
    roles: t.players.map((p) => (p.seat === seat || p.open ? p.role : null)),
    hidden: me.role === 'landlord' && !me.open,
    top: t.top,
    lead: t.top === null,
    lord: t.lord,
    call: t.call,
    holes: t.lord === null ? [] : [...t.holes],
    base: t.base,
    seen: [...t.seen],
    plays: t.players.map((p) => p.plays),
    turn: t.turn,
  };
}

/** How many cards there are of a rank on the whole table. */
export const copies = (rank: number, decks: number): number => (rank >= SMALL ? decks : 4 * decks);

/** How many cards of each rank are out of sight: neither in the viewer's hand nor played. */
export function unseen(v: TableView): number[] {
  const mine = countRanks(v.hand);
  return Array.from({ length: RANKS }, (_, r) => copies(r, v.decks) - (v.seen[r] ?? 0) - (mine[r] ?? 0));
}

/**
 * Who the viewer takes for a friend and who for a foe. What is not known is taken as the table is most likely to be: a
 * landlord does not know his partners, so every unknown seat is a foe to him; a farmer counts the landlords still hidden
 * against the seats he cannot place, and takes an unknown seat for a foe when it is at least as likely a landlord as not.
 */
export function sides(v: TableView): { friends: number[]; foes: number[] } {
  const friends: number[] = [];
  const foes: number[] = [];
  const mine = v.roles[v.me] ?? 'farmer';
  const open = v.roles.filter((r, seat) => seat !== v.me && r === 'landlord').length;
  const unknown = v.roles.filter((r, seat) => seat !== v.me && r === null).length;
  const hidden = Math.max(0, CONFIG[v.size].landlords - open);
  const suspect = unknown > 0 && hidden * 3 >= unknown;
  for (let seat = 0; seat < v.size; seat++) {
    if (seat === v.me) continue;
    const known = v.roles[seat] ?? null;
    if (mine === 'landlord') (known === 'landlord' ? friends : foes).push(seat);
    else (known === 'landlord' || (known === null && suspect) ? foes : friends).push(seat);
  }
  return { friends, foes };
}
