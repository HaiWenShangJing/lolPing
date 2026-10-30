/**
 * The one-seat-at-a-time game windows (werewolf, Sanguosha and Dou Dizhu) and what they say to each other; the pages are
 * plain HTML with this bridge.
 */

import { PET_IDS, isPetId, type PetId } from './teammate/pet';
import { MAX_CARDS } from './teammate/doudizhuCards';
import type { Card as DdzCard } from './teammate/doudizhuCards';
import { MAX_BID, isSize as isDdzSize } from './teammate/doudizhuTypes';
import type { Role as DdzRole, Size as DdzSize } from './teammate/doudizhuTypes';
import { CARD_NAMES, DECK_SIZE, type CardName } from './teammate/sanguoshaCards';
import { SKILLS, isHeroId, type SkillId } from './teammate/sanguoshaHeroes';
import type { CardsWhy, Phase as SgsPhase, Reply, Size, SkillOption, Use, Winner } from './teammate/sanguoshaTypes';
import { isSize } from './teammate/sanguoshaTypes';
import type { CardView, HeroInfo, SeatView } from './teammate/sanguoshaView';
import { SEATS, type Role, type Side } from './teammate/werewolf';
import type { Phase } from './teammate/werewolfRun';

/** `msg`: main → page. `send`: page → main. */
export const GAME_CH = { msg: 'game:msg', send: 'game:send' } as const;

/** The games the pets play with the user, the mahjong scene they act out and the boxing match they put on. */
export const PET_GAMES = ['werewolf', 'sanguosha', 'doudizhu', 'mahjong', 'fight'] as const;
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
  /** The sizes of table to choose from, for a game that has more than one; a table of `n` seats `n - 1` pets. */
  sizes?: number[];
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

/** One seat at the Sanguosha table as the user sees it: what any player may see, and who sits there. */
export interface SgsSeat extends SeatView {
  id: 'user' | PetId;
  name: string;
  color: string;
  me: boolean;
}

/** What the user is asked to do now, with the words for it; the rest of each is the question the rules put. */
export type SgsAsk = { title: string } & (
  | { k: 'hero'; heroes: HeroInfo[] }
  | { k: 'play'; uses: Use[]; skills: SkillOption[] }
  | { k: 'cards'; why: CardsWhy; cards: CardView[]; min: number; max: number }
  | { k: 'area'; owner: number; hand: number; equip: CardView[]; judges: SeatView['judges'] }
  | { k: 'seat'; options: number[]; min: number; max: number }
  | { k: 'confirm' }
);

export type SgsTone = 'sys' | 'turn' | 'act' | 'hit' | 'heal' | 'say' | 'secret';

export type SgsOut =
  | GameLobby
  | {
    kind: 'state';
    seats: SgsSeat[];
    hand: CardView[];
    pile: number;
    turn: number;
    phase: SgsPhase;
    turns: number;
  }
  | { kind: 'line'; tone: SgsTone; seat: number | null; text: string }
  /** The seats whose pet is thinking with Copilot CLI just now. */
  | { kind: 'thinking'; seats: number[] }
  | { kind: 'ask'; ask: SgsAsk | null }
  /** `win` is true when the user's side has won; `title` is the headline and `text` the roles. */
  | { kind: 'over'; win: boolean; winner: Winner | null; title: string; text: string };

export type SgsIn =
  | { t: 'start'; pets: PetId[]; size: Size }
  | { t: 'reply'; reply: Reply }
  | { t: 'again' };

/** What a seat last did, which stays on the table until its next turn: a bid, a pass or the cards it played. */
export type DdzShown =
  | { k: 'bid'; bid: number }
  | { k: 'pass' }
  | { k: 'play'; cards: DdzCard[]; label: string; bomb: boolean };

/** One seat at the Dou Dizhu table as the user sees it: what anyone may see, and who sits there. */
export interface DdzSeat {
  seat: number;
  id: 'user' | PetId;
  name: string;
  color: string;
  me: boolean;
  /** The side the user knows the seat to be on; null while he does not. */
  role: DdzRole | null;
  /** True for the user's own seat when it is a landlord that nobody else knows yet. */
  hidden: boolean;
  /** The cards left in the hand. */
  cards: number;
  shown: DdzShown | null;
}

export type DdzPhase = 'bid' | 'play' | 'over';

/** What the user is asked to do now, with the words for it. */
export type DdzAsk = { title: string } & (
  | { k: 'bid'; min: number; max: number }
  | { k: 'play'; lead: boolean }
);

export type DdzTone = 'sys' | 'head' | 'act' | 'pass' | 'bomb' | 'say' | 'secret';

export type DdzOut =
  | GameLobby
  | {
    kind: 'state';
    size: DdzSize;
    seats: DdzSeat[];
    /** The user's own cards, highest first. */
    hand: DdzCard[];
    phase: DdzPhase;
    turn: number | null;
    /** The seat whose play is on the table for the others to beat; nobody's at a lead. */
    top: number | null;
    base: number;
    bombs: number;
    /** The card called, at a table that calls one. */
    call: DdzCard | null;
    /** The cards the landlord in the open took from the bottom. */
    holes: DdzCard[];
  }
  | { kind: 'line'; tone: DdzTone; seat: number | null; text: string }
  /** The seats whose pet is thinking with Copilot CLI just now. */
  | { kind: 'thinking'; seats: number[] }
  | { kind: 'ask'; ask: DdzAsk | null }
  /** The answer to a `check`: whether `ids` make a play now, and what the play is called or why it is none. */
  | { kind: 'verdict'; ids: number[]; ok: boolean; label: string }
  /** The next play the user may make, from the best; no cards when nothing he holds beats the table. */
  | { kind: 'hint'; ids: number[]; label: string }
  /** `win` is true when the user's side has won; `title` is the headline and `text` the stakes and the points. */
  | { kind: 'over'; win: boolean; winner: DdzRole; title: string; text: string };

export type DdzIn =
  | { t: 'start'; pets: PetId[]; size: DdzSize }
  /** 0 is no bid. */
  | { t: 'bid'; bid: number }
  /** No cards is a pass. */
  | { t: 'play'; ids: number[] }
  /** Asks whether the cards make a play now; answered by a `verdict`. */
  | { t: 'check'; ids: number[] }
  | { t: 'hint' }
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

const SGS_SEATS = 8;
const cardId = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= DECK_SIZE ? raw : null;

const cardIds = (raw: unknown): number[] | null => {
  if (!Array.isArray(raw) || raw.length > DECK_SIZE) return null;
  const ids: number[] = [];
  for (const r of raw) {
    const id = cardId(r);
    if (id === null) return null;
    ids.push(id);
  }
  return ids;
};

const seatNos = (raw: unknown): number[] | null => {
  if (!Array.isArray(raw) || raw.length > SGS_SEATS) return null;
  const seats: number[] = [];
  for (const r of raw) {
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 0 || r >= SGS_SEATS) return null;
    seats.push(r);
  }
  return seats;
};

const isCardName = (raw: unknown): raw is CardName => (CARD_NAMES as readonly unknown[]).includes(raw);
const isSkillId = (raw: unknown): raw is SkillId => (SKILLS as readonly unknown[]).includes(raw);

/** The answer a Sanguosha page gave to a question; null for anything that is not one. */
export function parseReply(raw: unknown): Reply | null {
  const r = record(raw);
  if (!r) return null;
  switch (r.k) {
    case 'hero': return isHeroId(r.hero) ? { k: 'hero', hero: r.hero } : null;
    case 'use': {
      const card = cardId(r.card);
      const targets = seatNos(r.targets);
      if (card === null || targets === null || !isCardName(r.as)) return null;
      if (r.skill === undefined) return { k: 'use', card, as: r.as, targets };
      return isSkillId(r.skill) ? { k: 'use', card, as: r.as, skill: r.skill, targets } : null;
    }
    case 'skill': {
      const cards = cardIds(r.cards);
      const targets = seatNos(r.targets);
      return cards && targets && isSkillId(r.skill) ? { k: 'skill', skill: r.skill, cards, targets } : null;
    }
    case 'end': return { k: 'end' };
    case 'cards': {
      const ids = cardIds(r.ids);
      return ids ? { k: 'cards', ids } : null;
    }
    case 'area': {
      if (r.zone !== 'hand' && r.zone !== 'equip' && r.zone !== 'judge') return null;
      const given = r.card ?? null;
      const card = given === null ? null : cardId(given);
      return given !== null && card === null ? null : { k: 'area', zone: r.zone, card };
    }
    case 'seat': {
      const seats = seatNos(r.seats);
      return seats ? { k: 'seat', seats } : null;
    }
    case 'confirm': return typeof r.yes === 'boolean' ? { k: 'confirm', yes: r.yes } : null;
    default: return null;
  }
}

/** What the Sanguosha page sent; null for anything that is not one of its messages. */
export function parseSgsIn(raw: unknown): SgsIn | null {
  const r = record(raw);
  if (!r) return null;
  switch (r.t) {
    case 'start': {
      if (!isSize(r.size)) return null;
      const pets = parsePicks(r.pets, r.size - 1);
      return pets ? { t: 'start', pets, size: r.size } : null;
    }
    case 'reply': {
      const reply = parseReply(r.reply);
      return reply ? { t: 'reply', reply } : null;
    }
    case 'again': return { t: 'again' };
    default: return null;
  }
}

const ddzIds = (raw: unknown): number[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_CARDS) return null;
  const ids: number[] = [];
  for (const r of raw) {
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 0 || r >= MAX_CARDS) return null;
    ids.push(r);
  }
  return ids;
};

/** What the Dou Dizhu page sent; null for anything that is not one of its messages. */
export function parseDdzIn(raw: unknown): DdzIn | null {
  const r = record(raw);
  if (!r) return null;
  switch (r.t) {
    case 'start': {
      if (!isDdzSize(r.size)) return null;
      const pets = parsePicks(r.pets, r.size - 1);
      return pets ? { t: 'start', pets, size: r.size } : null;
    }
    case 'bid': {
      const bid = r.bid;
      return typeof bid === 'number' && Number.isInteger(bid) && bid >= 0 && bid <= MAX_BID ? { t: 'bid', bid } : null;
    }
    case 'play': {
      const ids = ddzIds(r.ids);
      return ids ? { t: 'play', ids } : null;
    }
    case 'check': {
      const ids = ddzIds(r.ids);
      return ids ? { t: 'check', ids } : null;
    }
    case 'hint': return { t: 'hint' };
    case 'again': return { t: 'again' };
    default: return null;
  }
}

/** The page's bridge to main, in the pages' global `gameApi`. */
export interface GameApi {
  onMsg(cb: (msg: unknown) => void): () => void;
  send(msg: unknown): void;
}
