/**
 * A Sanguosha table for testing the rules by hand. `rig` is a real engine whose questions the test answers and whose
 * hands, equipment and pile the test arranges; `game` runs a whole game through `runSanguosha` and lets the test set
 * the table when the first turn begins. Cards made here are new ones (ids from 1000), so a test can have any suit and
 * rank it needs; the deck is not kept whole.
 */
import { Engine } from '../../../src/shared/teammate/sanguosha';
import { infoOf, slotOf } from '../../../src/shared/teammate/sanguoshaCards';
import type { Card, CardInfo, CardName, Suit } from '../../../src/shared/teammate/sanguoshaCards';
import { HEROES } from '../../../src/shared/teammate/sanguoshaHeroes';
import type { HeroId, SkillId } from '../../../src/shared/teammate/sanguoshaHeroes';
import { runSanguosha } from '../../../src/shared/teammate/sanguoshaRun';
import { actSkill, skillOptions } from '../../../src/shared/teammate/sanguoshaSkills';
import { GameOver, ROLE_SETS } from '../../../src/shared/teammate/sanguoshaTypes';
import type {
  Ask, AreaWhy, CardsWhy, ConfirmWhy, DelayedName, Deps, Entry, Outcome, Reply, Role, SeatWhy, Size, Winner,
} from '../../../src/shared/teammate/sanguoshaTypes';
import { actUse, legalUses } from '../../../src/shared/teammate/sanguoshaUse';

/** A card: a name alone is a spade 7; otherwise name, suit and rank. */
export type Spec = CardName | readonly [CardName, Suit, number];
type Made<S extends readonly Spec[]> = { -readonly [K in keyof S]: Card };

let serial = 1000;
function make(e: Engine, spec: Spec): Card {
  const [name, suit, rank] = typeof spec === 'string' ? ([spec, 'spade', 7] as const) : spec;
  const card: Card = { id: serial++, name, suit, rank };
  e.registry.set(card.id, card);
  return card;
}

/** Puts new cards in a player's hand. */
export function hold<S extends readonly Spec[]>(e: Engine, seat: number, ...specs: S): Made<S> {
  const cards = specs.map((spec) => make(e, spec));
  e.p(seat).hand.push(...cards);
  return cards as unknown as Made<S>;
}

/** Puts new cards on top of the pile, the first of them to be drawn first. */
export function stack<S extends readonly Spec[]>(e: Engine, ...specs: S): Made<S> {
  const cards = specs.map((spec) => make(e, spec));
  e.pile.unshift(...cards);
  return cards as unknown as Made<S>;
}

/** Puts a new piece of equipment on a player, in its slot. */
export function wear(e: Engine, seat: number, spec: Spec): Card {
  const card = make(e, spec);
  const slot = slotOf(card.name);
  if (!slot) throw new Error(`${card.name} is not equipment`);
  e.p(seat).equip[slot] = card;
  return card;
}

/** Puts a delayed trick in front of a player; `spec` is the card it really is, which a skill may have turned into it. */
export function plant(e: Engine, seat: number, as: DelayedName, spec: Spec = as): Card {
  const card = make(e, spec);
  e.p(seat).judges.push({ card, as });
  return card;
}

/** Gives a seat a hero, with all its hit points. */
export function become(e: Engine, seat: number, hero: HeroId): void {
  const p = e.p(seat);
  p.hero = hero;
  p.maxHp = HEROES[hero].hp + (p.role === 'lord' ? 1 : 0);
  p.hp = p.maxHp;
}

/** Puts a player out of the game without anything happening. */
export function out(e: Engine, ...seats: number[]): void {
  for (const seat of seats) {
    const p = e.p(seat);
    p.alive = false;
    p.hp = 0;
    p.hand = [];
  }
}

export const info = (card: Card): CardInfo => infoOf(card);

// What a test says to a question

export const yes: Reply = { k: 'confirm', yes: true };
export const no: Reply = { k: 'confirm', yes: false };
export const pick = (...cards: Card[]): Reply => ({ k: 'cards', ids: cards.map((c) => c.id) });
export const seats = (...chosen: number[]): Reply => ({ k: 'seat', seats: chosen });
export const area = (zone: 'hand' | 'equip' | 'judge', card: Card | null = null): Reply => ({ k: 'area', zone, card: card?.id ?? null });
export const hero = (id: HeroId): Reply => ({ k: 'hero', hero: id });
export const end: Reply = { k: 'end' };
/** Plays the first card that is offered, whatever it is. */
export const first = (ask: Ask): Reply | null => (ask.k === 'cards' ? { k: 'cards', ids: ask.cards.slice(0, 1) } : null);

export type Key = 'hero' | 'play' | CardsWhy | AreaWhy | SeatWhy | ConfirmWhy;
const keyOf = (ask: Ask): Key => (ask.k === 'hero' || ask.k === 'play' ? ask.k : ask.why);

/** A reply, or a function that works it out from the question. */
export type Say = Reply | null | ((ask: Ask, e: Engine) => Reply | null);
export type Script = (seat: number, ask: Ask, e: Engine) => Reply | null | undefined;
export interface Asked {
  seat: number;
  ask: Ask;
}

export interface Rig {
  readonly e: Engine;
  /** Everything the table has reported. */
  readonly log: Entry[];
  /** Every question put to a player. */
  readonly asked: Asked[];
  /** From now on this is `seat`'s answer to every question of this kind. A later answer takes the place of an earlier. */
  answer(seat: number, key: Key, say: Say): void;
  /** `seat`'s next answer to a question of this kind, and only that one. */
  once(seat: number, key: Key, say: Say): void;
  asks(key: Key): Asked[];
  entries<K extends Entry['k']>(k: K): Extract<Entry, { k: K }>[];
}

export interface RigOptions {
  /** Whose turn it is (the lord's, seat 0, unless told). */
  turn?: number;
  /** Heroes by seat; the others are Liu Bei, whose only skill is one the player starts himself. */
  heroes?: Readonly<Partial<Record<number, HeroId>>>;
  /** What "random" is: 0 by default, which always takes the first of anything. */
  random?: () => number;
}

interface Rule {
  seat: number;
  key: Key;
  say: Say;
  once: boolean;
  spent: boolean;
}

export function rig(table: Size | readonly Role[] = 5, options: RigOptions = {}): Rig {
  const roles = typeof table === 'number' ? ROLE_SETS[table] : table;
  const log: Entry[] = [];
  const asked: Asked[] = [];
  const rules: Rule[] = [];
  const deps: Deps = {
    random: options.random ?? (() => 0),
    ask: async (seat, ask, e) => {
      asked.push({ seat, ask });
      const key = keyOf(ask);
      const rule = rules.find((r) => r.seat === seat && r.key === key && !r.spent);
      if (!rule) return null;
      if (rule.once) rule.spent = true;
      return typeof rule.say === 'function' ? rule.say(ask, e) : rule.say;
    },
    emit: (entry) => {
      log.push(entry);
    },
    stopped: () => false,
  };
  const e = new Engine(deps, roles);
  roles.forEach((_, seat) => become(e, seat, options.heroes?.[seat] ?? 'liubei'));
  e.turn = options.turn ?? 0;
  const add = (seat: number, key: Key, say: Say, once: boolean): void => {
    rules.unshift({ seat, key, say, once, spent: false });
  };
  return {
    e,
    log,
    asked,
    answer: (seat, key, say) => add(seat, key, say, false),
    once: (seat, key, say) => add(seat, key, say, true),
    asks: (key) => asked.filter((a) => keyOf(a.ask) === key),
    entries: <K extends Entry['k']>(k: K) => log.filter((x): x is Extract<Entry, { k: K }> => x.k === k),
  };
}

/** Plays a card from a player's hand the way a player would in the play phase. False when the table refuses it. */
export function use(
  r: Rig, seat: number, card: Card, as: CardName = card.name, targets: number[] = [], skill?: SkillId,
): Promise<boolean> {
  return actUse(r.e, seat, { k: 'use', card: card.id, as, ...(skill ? { skill } : {}), targets }, legalUses(r.e, seat));
}

/** Starts a skill the way a player would in the play phase. False when the table refuses it. */
export function cast(r: Rig, seat: number, skill: SkillId, cards: Card[] = [], targets: number[] = []): Promise<boolean> {
  return actSkill(r.e, seat, { k: 'skill', skill, cards: cards.map((c) => c.id), targets }, skillOptions(r.e, seat));
}

/** The winner a play ends the game with, or null if it did not end it. */
export async function over(play: Promise<unknown>): Promise<Winner | null> {
  try {
    await play;
    return null;
  } catch (err) {
    if (err instanceof GameOver) return err.winner;
    throw err;
  }
}

// A whole game

export interface GameOptions {
  size?: Size;
  roles?: readonly Role[];
  random?: () => number;
  /** Arranges the table on the first turn, once the cards are dealt and before any phase is played. */
  stage?: (e: Engine) => void;
  /** Answers the questions; no answer is the default move, and the heroes offered are taken in order. */
  script?: (seat: number, ask: Ask, e: Engine) => Reply | null | undefined;
  /** Ends the game early, as if the window were closed, after the entry this is true of. */
  until?: (entry: Entry, e: Engine) => boolean;
}

export interface Game {
  /** Null when the game was cut short. */
  outcome: Outcome | null;
  log: Entry[];
  asked: Asked[];
  e: Engine;
}

export async function game(options: GameOptions = {}): Promise<Game> {
  const roles = options.roles ?? ROLE_SETS[options.size ?? 5];
  const log: Entry[] = [];
  const asked: Asked[] = [];
  let engine: Engine | undefined;
  let staged = false;
  let halted = false;
  const outcome = await runSanguosha(
    {
      random: options.random ?? (() => 0),
      ask: async (seat, ask, e) => {
        engine = e;
        asked.push({ seat, ask });
        return options.script?.(seat, ask, e) ?? null;
      },
      emit: (entry, e) => {
        engine = e;
        log.push(entry);
        if (entry.k === 'turn' && !staged) {
          staged = true;
          options.stage?.(e);
        }
        if (options.until?.(entry, e)) halted = true;
      },
      stopped: () => halted,
    },
    roles,
  );
  if (!engine) throw new Error('the game never began');
  return { outcome, log, asked, e: engine };
}
