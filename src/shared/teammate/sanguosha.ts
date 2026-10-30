/**
 * The Sanguosha table: who sits where, what they hold, and the few things every rule is built from (drawing, moving
 * cards, damage and dying, judgements, asking a player). The rules for playing cards are `sanguoshaUse.ts`, the hero
 * skills `sanguoshaSkills.ts` and the order of a turn `sanguoshaRun.ts`.
 *
 * Every question goes through `deps.ask`, so a seat is a person or a bot and the table cannot tell. An answer that does
 * not fit the question is read as no answer, which always has a harmless meaning.
 */
import { RANGE, SLOTS, buildDeck, infoOf, shuffle, slotOf } from './sanguoshaCards';
import type { Card } from './sanguoshaCards';
import { HEROES } from './sanguoshaHeroes';
import type { HeroId, SkillId } from './sanguoshaHeroes';
import { afterDamage, judged } from './sanguoshaSkills';
import { playCard, serving } from './sanguoshaUse';
import { GameOver, Stopped, equipOf, freshFlags } from './sanguoshaTypes';
import type {
  Ask, AreaWhy, CardsWhy, ConfirmWhy, Ctx, DelayedName, Deps, Entry, Equip, Flags, JudgeWhy, Phase, Player, Reply,
  Role, SeatWhy, Winner, Zone,
} from './sanguoshaTypes';

const emptyEquip = (): Equip => ({ weapon: null, armor: null, plus: null, minus: null });

type Where = { z: 'hand' | 'equip' | 'judge'; seat: number } | { z: 'pile' | 'trash' | 'limbo' };
interface Loss {
  seat: number;
  hand: number;
  equip: number;
}

/** Stands in for the card of a judgement when there is none left anywhere, which only a broken deck could cause. */
const BLANK: Card = { id: 0, name: 'sha', suit: 'spade', rank: 1 };

export class Engine {
  readonly players: Player[];
  readonly registry = new Map<number, Card>();
  pile: Card[];
  trash: Card[] = [];
  /** Cards that are being played and have not reached the discard pile yet. */
  limbo: Card[] = [];
  /** Whose turn it is. */
  turn = 0;
  turns = 0;
  phase: Phase = 'start';
  flags: Flags = freshFlags();

  constructor(readonly deps: Deps, roles: readonly Role[]) {
    this.players = roles.map((role, seat) => ({
      seat, role, hero: null, maxHp: 0, hp: 0, alive: true, hand: [], equip: emptyEquip(), judges: [],
    }));
    const deck = buildDeck();
    for (const card of deck) this.registry.set(card.id, card);
    this.pile = shuffle([...deck], deps.random);
  }

  // Who and where

  p(seat: number): Player {
    const player = this.players[seat];
    if (!player) throw new Error(`no seat ${seat}`);
    return player;
  }

  get lord(): Player {
    return this.players.find((p) => p.role === 'lord') ?? this.p(0);
  }

  alive(): Player[] {
    return this.players.filter((p) => p.alive);
  }

  /** The living players in turn order, starting with `from` itself if it is still in the game. */
  order(from: number): Player[] {
    const n = this.players.length;
    const out: Player[] = [];
    for (let i = 0; i < n; i++) {
      const p = this.players[(from + i) % n];
      if (p?.alive) out.push(p);
    }
    return out;
  }

  next(seat: number): Player | undefined {
    return this.order(seat + 1)[0];
  }

  has(seat: number, skill: SkillId): boolean {
    const hero = this.p(seat).hero;
    return hero !== null && HEROES[hero].skills.includes(skill);
  }

  card(id: number): Card | undefined {
    return this.registry.get(id);
  }

  /** The seats between two players, going the shorter way round the living, with horses counted. At least 1. */
  distance(a: number, b: number): number {
    if (a === b) return 0;
    const ring = this.alive();
    const ia = ring.findIndex((p) => p.seat === a);
    const ib = ring.findIndex((p) => p.seat === b);
    const n = ring.length;
    const around = (ib - ia + n) % n;
    let d = Math.min(around, n - around);
    if (this.p(b).equip.plus) d += 1;
    if (this.p(a).equip.minus) d -= 1;
    if (this.has(a, 'mashu')) d -= 1;
    return Math.max(1, d);
  }

  range(seat: number): number {
    const weapon = this.p(seat).equip.weapon;
    return weapon && weapon.name in RANGE ? RANGE[weapon.name as keyof typeof RANGE] : 1;
  }

  inRange(a: number, b: number): boolean {
    return this.distance(a, b) <= this.range(a);
  }

  /** The side that has won, if any side has. */
  winner(): Winner | null {
    const alive = this.alive();
    if (!this.lord.alive) return alive.length === 1 && alive[0]?.role === 'traitor' ? 'traitor' : 'rebel';
    return alive.every((p) => p.role === 'lord' || p.role === 'loyalist') ? 'lord' : null;
  }

  // Reporting and asking

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

  /** Asks for `min` to `max` of `cards`. An answer that does not fit gives the first `min` of them. */
  async askCards(
    seat: number, why: CardsWhy, ctx: Ctx, cards: readonly Card[], min: number, max: number,
  ): Promise<Card[]> {
    if (!cards.length || max < 1) return [];
    const reply = await this.ask(seat, { k: 'cards', why, ctx, cards: cards.map((c) => c.id), min, max });
    const ids = reply?.k === 'cards' ? reply.ids : [];
    const picked = ids.map((id) => cards.find((c) => c.id === id));
    const fits = ids.length >= min && ids.length <= max && new Set(ids).size === ids.length;
    if (fits && picked.every((c) => c !== undefined)) return picked as Card[];
    return cards.slice(0, min);
  }

  async askSeats(
    seat: number, why: SeatWhy, ctx: Ctx, options: readonly number[], min: number, max: number,
  ): Promise<number[]> {
    if (!options.length || max < 1) return [];
    const reply = await this.ask(seat, { k: 'seat', why, ctx, options: [...options], min, max });
    const seats = reply?.k === 'seat' ? reply.seats : [];
    const fits = seats.length >= min && seats.length <= max && new Set(seats).size === seats.length;
    return fits && seats.every((s) => options.includes(s)) ? seats : options.slice(0, min);
  }

  async askYes(seat: number, why: ConfirmWhy, ctx: Ctx = {}): Promise<boolean> {
    const reply = await this.ask(seat, { k: 'confirm', why, ctx });
    return reply?.k === 'confirm' && reply.yes;
  }

  // Moving cards

  /** Takes a card out of wherever it lies. */
  private remove(card: Card): Where {
    const out = (list: Card[]): boolean => {
      const i = list.indexOf(card);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    };
    if (out(this.limbo)) return { z: 'limbo' };
    for (const p of this.players) {
      if (out(p.hand)) return { z: 'hand', seat: p.seat };
      for (const slot of SLOTS) {
        if (p.equip[slot] === card) {
          p.equip[slot] = null;
          return { z: 'equip', seat: p.seat };
        }
      }
      const j = p.judges.findIndex((x) => x.card === card);
      if (j >= 0) {
        p.judges.splice(j, 1);
        return { z: 'judge', seat: p.seat };
      }
    }
    if (out(this.trash)) return { z: 'trash' };
    if (out(this.pile)) return { z: 'pile' };
    throw new Error(`card ${card.id} is nowhere`);
  }

  private detach(cards: readonly Card[]): Loss[] {
    const losses = new Map<number, Loss>();
    for (const card of cards) {
      const from = this.remove(card);
      if (from.z !== 'hand' && from.z !== 'equip') continue;
      const loss = losses.get(from.seat) ?? { seat: from.seat, hand: 0, equip: 0 };
      loss[from.z] += 1;
      losses.set(from.seat, loss);
    }
    return [...losses.values()];
  }

  /** What losing cards sets off: Lianying for the last card of a hand, Xiaoji for each piece of equipment. */
  private async settle(losses: readonly Loss[]): Promise<void> {
    for (const loss of losses) {
      const p = this.p(loss.seat);
      if (!p.alive) continue;
      if (loss.hand && !p.hand.length && this.has(loss.seat, 'lianying')) {
        await this.emit({ k: 'skill', seat: loss.seat, skill: 'lianying' });
        await this.draw(loss.seat, 1);
      }
      if (this.has(loss.seat, 'xiaoji')) {
        for (let i = 0; i < loss.equip; i++) {
          await this.emit({ k: 'skill', seat: loss.seat, skill: 'xiaoji' });
          await this.draw(loss.seat, 2);
        }
      }
    }
  }

  async toTrash(cards: readonly Card[]): Promise<void> {
    const losses = this.detach(cards);
    this.trash.push(...cards);
    await this.settle(losses);
  }

  async toLimbo(cards: readonly Card[]): Promise<void> {
    const losses = this.detach(cards);
    this.limbo.push(...cards);
    await this.settle(losses);
  }

  async toHand(seat: number, cards: readonly Card[]): Promise<void> {
    const losses = this.detach(cards);
    this.p(seat).hand.push(...cards);
    await this.settle(losses);
  }

  /** Puts a delayed trick in front of `target`. */
  async place(card: Card, as: DelayedName, target: number): Promise<void> {
    const losses = this.detach([card]);
    this.p(target).judges.push({ card, as });
    await this.settle(losses);
  }

  async equip(seat: number, card: Card): Promise<void> {
    const slot = slotOf(card.name);
    if (!slot) return;
    const losses = this.detach([card]);
    const p = this.p(seat);
    const old = p.equip[slot];
    p.equip[slot] = card;
    if (old) this.trash.push(old);
    await this.emit({ k: 'equip', seat, card: infoOf(card) });
    await this.settle(old ? [...losses, { seat, hand: 0, equip: 1 }] : losses);
  }

  /** Discards cards the player chose, in plain sight. */
  async discard(seat: number, cards: readonly Card[]): Promise<void> {
    if (!cards.length) return;
    await this.emit({ k: 'discard', seat, cards: cards.map(infoOf) });
    await this.toTrash(cards);
  }

  /** The next card of the pile, shuffling the discards in when it has run out. */
  private async top(): Promise<Card | undefined> {
    if (!this.pile.length) await this.refill(1);
    return this.pile.shift();
  }

  /** Makes sure the pile holds at least `n` cards, if the discards can make up the difference. */
  async refill(n: number): Promise<void> {
    if (this.pile.length >= n || !this.trash.length) return;
    this.pile.push(...shuffle(this.trash.splice(0), this.deps.random));
    await this.emit({ k: 'shuffle' });
  }

  async draw(seat: number, n: number): Promise<Card[]> {
    const got: Card[] = [];
    for (let i = 0; i < n; i++) {
      const card = await this.top();
      if (!card) break;
      got.push(card);
    }
    this.p(seat).hand.push(...got);
    if (got.length) await this.emit({ k: 'draw', seat, n: got.length, cards: got.map(infoOf) });
    return got;
  }

  /** Takes one card of `owner`'s hand at random into `seat`'s. */
  async steal(seat: number, owner: number): Promise<void> {
    const hand = this.p(owner).hand;
    const card = hand[Math.floor(this.deps.random() * hand.length)];
    if (!card) return;
    await this.emit({ k: 'take', seat, from: owner, cards: [infoOf(card)], zone: 'hand' });
    await this.toHand(seat, [card]);
  }

  /** Lets `chooser` pick one card out of `owner`'s hand, equipment or (when it may) judgement area. */
  async pick(chooser: number, owner: number, why: AreaWhy): Promise<void> {
    const o = this.p(owner);
    const equip = equipOf(o);
    const judges = why === 'fankui' ? [] : o.judges.map((j) => j.card);
    if (!o.hand.length && !equip.length && !judges.length) return;
    const reply = await this.ask(chooser, {
      k: 'area', why, ctx: { target: owner }, owner, hand: o.hand.length,
      equip: equip.map((c) => c.id), judges: judges.map((c) => c.id),
    });
    let card: Card | undefined;
    if (reply?.k === 'area') {
      if (reply.zone === 'hand') card = o.hand[Math.floor(this.deps.random() * o.hand.length)];
      else if (reply.zone === 'equip') card = equip.find((c) => c.id === reply.card);
      else card = judges.find((c) => c.id === reply.card);
    }
    card ??= o.hand[0] ?? equip[0] ?? judges[0];
    if (!card) return;
    const zone: Zone = o.hand.includes(card) ? 'hand' : equip.includes(card) ? 'equip' : 'judge';
    if (why === 'chai') {
      await this.emit({ k: 'discard', seat: chooser, from: owner, cards: [infoOf(card)] });
      await this.toTrash([card]);
    } else {
      await this.emit({ k: 'take', seat: chooser, from: owner, cards: [infoOf(card)], zone });
      await this.toHand(chooser, [card]);
    }
  }

  // Life and death

  async setHero(seat: number, hero: HeroId): Promise<void> {
    const p = this.p(seat);
    p.hero = hero;
    p.maxHp = HEROES[hero].hp + (p.role === 'lord' ? 1 : 0);
    p.hp = p.maxHp;
    await this.emit({ k: 'hero', seat, hero });
  }

  async heal(seat: number, n: number): Promise<void> {
    const p = this.p(seat);
    const gain = Math.min(n, p.maxHp - p.hp);
    if (!p.alive || gain <= 0) return;
    p.hp += gain;
    await this.emit({ k: 'heal', seat, n: gain });
  }

  /**
   * `source` is who dealt it, if anyone; `cards` are the cards that did, which Jianxiong may take if they are still
   * on the table.
   */
  async damage(seat: number, n: number, source: number | null, cards: readonly Card[] = []): Promise<void> {
    const p = this.p(seat);
    if (!p.alive || n <= 0) return;
    p.hp -= n;
    await this.emit({ k: 'damage', seat, n, source });
    if (p.hp <= 0) {
      await this.rescue(seat);
      if (p.hp <= 0) {
        await this.die(seat, source);
        return;
      }
    }
    await afterDamage(this, seat, source, cards);
  }

  async loseHp(seat: number, n: number): Promise<void> {
    const p = this.p(seat);
    if (!p.alive || n <= 0) return;
    p.hp -= n;
    await this.emit({ k: 'lose', seat, n });
    if (p.hp > 0) return;
    await this.rescue(seat);
    if (p.hp <= 0) await this.die(seat, null);
  }

  /** Everyone, starting with whoever's turn it is, may play 桃 until the dying player is back above zero. */
  private async rescue(victim: number): Promise<void> {
    const v = this.p(victim);
    for (const p of this.order(this.turn)) {
      while (v.hp <= 0) {
        const cards = serving(this, p.seat, 'tao');
        if (!cards.length) break;
        const [card] = await this.askCards(p.seat, 'tao', { target: victim }, cards, 0, 1);
        if (!card) break;
        await playCard(this, p.seat, card, 'tao', victim);
        await this.heal(victim, 1);
      }
      if (v.hp > 0) return;
    }
  }

  private async die(seat: number, killer: number | null): Promise<void> {
    const p = this.p(seat);
    p.alive = false;
    const cards = [...p.hand, ...equipOf(p), ...p.judges.map((j) => j.card)];
    p.hand = [];
    p.equip = emptyEquip();
    p.judges = [];
    this.trash.push(...cards);
    await this.emit({ k: 'die', seat, role: p.role, killer });
    const winner = this.winner();
    if (winner) throw new GameOver(winner);
    if (killer === null || killer === seat || !this.p(killer).alive) return;
    if (p.role === 'rebel') {
      await this.draw(killer, 3);
    } else if (p.role === 'loyalist' && this.p(killer).role === 'lord') {
      const k = this.p(killer);
      const lost = [...k.hand, ...equipOf(k)];
      if (lost.length) await this.discard(killer, lost);
    }
  }

  // Judgement

  /**
   * Flips the top card for `seat`. Skills that change a judgement get their say before the card is final. With `keep`
   * the final card is left on the table for the caller to place; otherwise it goes to the discards, or to a Tiandu hero.
   */
  async judge(seat: number, why: JudgeWhy, keep = false): Promise<Card> {
    let card = await this.top();
    if (!card) return BLANK;
    this.limbo.push(card);
    await this.emit({ k: 'judge', seat, card: infoOf(card), why });
    card = await judged(this, seat, card, why);
    if (keep) return card;
    if (this.has(seat, 'tiandu') && this.p(seat).alive) {
      await this.emit({ k: 'skill', seat, skill: 'tiandu' });
      await this.emit({ k: 'take', seat, from: null, cards: [infoOf(card)], zone: 'limbo' });
      await this.toHand(seat, [card]);
    } else {
      await this.toTrash([card]);
    }
    return card;
  }
}
