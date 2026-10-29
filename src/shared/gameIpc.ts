/**
 * The one-seat-at-a-time game windows (werewolf for now) and what they say to each other; the pages are plain HTML
 * with this bridge.
 */

import { PET_IDS, isPetId, type PetId } from './teammate/pet';
import { SEATS, type Role, type Side } from './teammate/werewolf';
import type { Phase } from './teammate/werewolfRun';

/** `msg`: main → page. `send`: page → main. */
export const GAME_CH = { msg: 'game:msg', send: 'game:send' } as const;

/** The games the pets play with the user, the mahjong scene they act out and the boxing match they put on. */
export const PET_GAMES = ['werewolf', 'mahjong', 'fight'] as const;
export type PetGame = (typeof PET_GAMES)[number];
export const isPetGame = (raw: unknown): raw is PetGame => (PET_GAMES as readonly unknown[]).includes(raw);

/** A pet that may take a seat; `on` when it is one of the pets out on the desktop. */
export interface GameChoice {
  id: PetId;
  name: string;
  color: string;
  on: boolean;
}

/** The words of the window's chrome, in the user's language; each game has its own set. */
export type GameText = Record<string, string>;

export interface GameLobby {
  kind: 'lobby';
  text: GameText;
  choices: GameChoice[];
  /** How many pets sit at the table with the user, and how many when the user only watches. */
  seats: number;
  watchSeats: number;
  /** Whether the computer players have a Copilot CLI mind (else they play by simple rules). */
  minds: boolean;
}

/** One seat at the werewolf table. `role` is null while the user may not know it. */
export interface WolfSeat {
  seat: number;
  id: 'user' | PetId;
  name: string;
  color: string;
  alive: boolean;
  role: Role | null;
  roleName: string | null;
  me: boolean;
  sheriff: boolean;
  /** The idiot, once revealed: still in the game, but without a vote. */
  flipped: boolean;
}

/** What the user is asked to do now. */
export interface WolfAsk {
  kind: 'kill' | 'check' | 'witch' | 'run' | 'speak' | 'vote' | 'shoot' | 'badge';
  title: string;
  options: number[];
  /** The witch: she may use the antidote on `victim` and/or the poison on one of `options`. */
  save: boolean;
  poison: boolean;
  victim: number | null;
}

export type WolfOut =
  | GameLobby
  /** `boom`: the user is a living wolf and may blow himself up now. */
  | { kind: 'state'; day: number; phase: Phase; label: string; seats: WolfSeat[]; boom: boolean }
  | { kind: 'line'; tone: 'sys' | 'say' | 'secret' | 'vote'; seat: number | null; text: string }
  | { kind: 'thinking'; seats: number[] }
  | { kind: 'ask'; ask: WolfAsk | null }
  /** `win` is null for a spectator; `title` is the headline and `text` the roles. */
  | { kind: 'over'; win: boolean | null; winner: Side; title: string; text: string };

export type WolfIn =
  /** `play`: the user takes a seat; false to only watch, with every seat played by a pet. */
  | { t: 'start'; pets: PetId[]; play: boolean }
  | { t: 'target'; seat: number }
  | { t: 'vote'; seat: number | null }
  | { t: 'say'; text: string }
  | { t: 'witch'; save: boolean; poison: number | null }
  | { t: 'run'; run: boolean }
  /** A hunter's shot or a sheriff's badge: null is no shot, and tearing the badge. */
  | { t: 'pick'; seat: number | null }
  | { t: 'boom' }
  | { t: 'again' };

const record = (raw: unknown): Record<string, unknown> | null =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

/** The pets a start message names: only real pets, each once, at most `max`. */
export function parsePicks(raw: unknown, max: number): PetId[] | null {
  if (!Array.isArray(raw) || raw.length > PET_IDS.length) return null;
  const picks: PetId[] = [];
  for (const r of raw) {
    if (!isPetId(r)) return null;
    if (!picks.includes(r)) picks.push(r);
  }
  return picks.slice(0, max);
}

const seatNo = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= SEATS ? raw : null;

/** A seat or null (the page says "nobody"); undefined for anything else. */
const seatOrNone = (raw: unknown): number | null | undefined => (raw === null ? null : (seatNo(raw) ?? undefined));

/**
 * What the werewolf page sent; null for anything that is not one of its messages. `table` is the seats at the table:
 * a user who plays takes one of them, so a start names at most one pet fewer than a user who only watches.
 */
export function parseWolfIn(raw: unknown, table: number = SEATS): WolfIn | null {
  const r = record(raw);
  if (!r) return null;
  switch (r.t) {
    case 'start': {
      if (r.play !== undefined && typeof r.play !== 'boolean') return null;
      const play = r.play ?? true;
      const pets = parsePicks(r.pets, play ? table - 1 : table);
      return pets ? { t: 'start', pets, play } : null;
    }
    case 'target': {
      const seat = seatNo(r.seat);
      return seat === null ? null : { t: 'target', seat };
    }
    case 'vote': {
      const seat = seatOrNone(r.seat);
      return seat === undefined ? null : { t: 'vote', seat };
    }
    case 'pick': {
      const seat = seatOrNone(r.seat);
      return seat === undefined ? null : { t: 'pick', seat };
    }
    case 'say': return typeof r.text === 'string' ? { t: 'say', text: r.text.slice(0, 400) } : null;
    case 'witch': {
      const poison = seatOrNone(r.poison);
      return typeof r.save === 'boolean' && poison !== undefined ? { t: 'witch', save: r.save, poison } : null;
    }
    case 'run': return typeof r.run === 'boolean' ? { t: 'run', run: r.run } : null;
    case 'boom': return { t: 'boom' };
    case 'again': return { t: 'again' };
    default: return null;
  }
}

/** The page's bridge to main, in the pages' global `gameApi`. */
export interface GameApi {
  onMsg(cb: (msg: unknown) => void): () => void;
  send(msg: unknown): void;
}
