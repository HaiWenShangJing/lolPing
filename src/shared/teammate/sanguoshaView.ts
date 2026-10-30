/**
 * What a player at the Sanguosha table can see of it: everybody's hit points, hand sizes, equipment and waiting tricks,
 * his own hand, and the roles that are out in the open (his own, the lord's and the dead's). Nothing else of the engine
 * gets through, so a page that shows this cannot show more than a player would know.
 */
import type { Card, CardName, Suit } from './sanguoshaCards';
import { HEROES } from './sanguoshaHeroes';
import type { HeroId, Kingdom, SkillId } from './sanguoshaHeroes';
import type { Engine } from './sanguosha';
import { equipOf } from './sanguoshaTypes';
import type { DelayedName, Phase, Role } from './sanguoshaTypes';

export interface CardView {
  id: number;
  name: CardName;
  suit: Suit;
  rank: number;
}

export const cardView = (card: Card): CardView => ({ id: card.id, name: card.name, suit: card.suit, rank: card.rank });

/** A hero as it is offered to be chosen. `hp` is what the player would start with: the lord's extra point counted. */
export interface HeroInfo {
  id: HeroId;
  kingdom: Kingdom;
  hp: number;
  skills: SkillId[];
}

export const heroInfo = (id: HeroId, lord: boolean): HeroInfo => ({
  id, kingdom: HEROES[id].kingdom, hp: HEROES[id].hp + (lord ? 1 : 0), skills: [...HEROES[id].skills],
});

export interface SeatView {
  seat: number;
  hero: HeroId | null;
  kingdom: Kingdom | null;
  skills: SkillId[];
  /** Null while it is not known to the viewer. */
  role: Role | null;
  hp: number;
  maxHp: number;
  alive: boolean;
  hand: number;
  /** How far the viewer is from this seat, horses counted; 0 for the viewer himself and for all while he is out. */
  dist: number;
  /** How far this seat's weapon reaches. */
  range: number;
  /** Weapon, armour, +1 horse and -1 horse, those that are worn. */
  equip: CardView[];
  /** The delayed tricks waiting for their judgement, the card each really is and what it is played as. */
  judges: { as: DelayedName; card: CardView }[];
}

export interface TableView {
  seats: SeatView[];
  /** The viewer's own hand. */
  hand: CardView[];
  pile: number;
  /** Whose turn it is, and what part of it. */
  turn: number;
  phase: Phase;
  /** How many turns have been played. */
  turns: number;
}

export function tableView(e: Engine, me: number): TableView {
  const inGame = e.p(me).alive;
  return {
    seats: e.players.map((p) => ({
      seat: p.seat,
      hero: p.hero,
      kingdom: p.hero ? HEROES[p.hero].kingdom : null,
      skills: p.hero ? [...HEROES[p.hero].skills] : [],
      role: p.seat === me || p.role === 'lord' || !p.alive ? p.role : null,
      hp: Math.max(0, p.hp),
      maxHp: p.maxHp,
      alive: p.alive,
      hand: p.hand.length,
      dist: inGame && p.alive && p.seat !== me ? e.distance(me, p.seat) : 0,
      range: e.range(p.seat),
      equip: equipOf(p).map(cardView),
      judges: p.judges.map((j) => ({ as: j.as, card: cardView(j.card) })),
    })),
    hand: e.p(me).hand.map(cardView),
    pile: e.pile.length,
    turn: e.turn,
    phase: e.phase,
    turns: e.turns,
  };
}
