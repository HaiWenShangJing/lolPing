/**
 * How a bot plays at the Sanguosha table. A bot sees what a player at the table sees: its own hand, everyone's equipment,
 * hit points and hand sizes, and what has been played. It does not see the roles of the others until they are out, so it
 * works out who is on whose side from what they do, and plays for its own side.
 */
import { RANGE, isBlack, isRed, slotOf } from './sanguoshaCards';
import type { Card, CardInfo, CardName, Weapon } from './sanguoshaCards';
import type { Engine } from './sanguosha';
import { equipOf } from './sanguoshaTypes';
import type { Ask, Entry, JudgeWhy, Reply, Role, SkillOption, Use } from './sanguoshaTypes';
import { serving } from './sanguoshaUse';

/** What a card is worth keeping, for choosing what to throw away and what a skill may spend. */
const KEEP: Record<CardName, number> = {
  tao: 90, wuzhong: 80, wuxie: 55, juedou: 55, shan: 50, chai: 50, shun: 50, lebu: 50, bing: 50,
  nanman: 40, wanjian: 40, taoyuan: 40, sha: 35, bagua: 35, renwang: 35,
  zhuge: 30, qinggang: 30, qinglong: 30, fangtian: 30, qilin: 30, guanshi: 25,
  chitu: 25, dawan: 25, zixing: 25, dilu: 20, jueying: 20, zhuahuang: 20, shandian: 5,
};
const byKeep = (a: Card, b: Card): number => KEEP[a.name] - KEEP[b.name];

/** Cards played at someone to their harm; being on the receiving end says something about who plays them. */
const HOSTILE: ReadonlySet<CardName> = new Set<CardName>(['sha', 'juedou', 'chai', 'shun', 'lebu', 'bing']);

const ALLY = 10;
const FOE = -10;
/** Evidence of where a player stands is kept between these. */
const LIMIT = 9;

const reach = (name: CardName): number => (name in RANGE ? RANGE[name as Weapon] : 0);

interface Rated {
  score: number;
  targets: number[];
}

export class Bots {
  /** How much each seat has looked like it is on the lord's side (up) or against him (down). */
  private readonly rep: number[];
  private readonly against: number;
  private deadAgainst = 0;
  private judging: { seat: number; why: JudgeWhy } | null = null;
  private kurou = 0;

  constructor(roles: readonly Role[], private readonly random: () => number) {
    this.rep = roles.map(() => 0);
    this.against = roles.filter((r) => r === 'rebel' || r === 'traitor').length;
  }

  // What the table has shown

  observe(entry: Entry, e: Engine): void {
    switch (entry.k) {
      case 'turn':
        this.kurou = 0;
        break;
      case 'judge':
        this.judging = { seat: entry.seat, why: entry.why };
        break;
      case 'use':
        if (HOSTILE.has(entry.name)) for (const target of entry.targets) this.strike(e, entry.seat, target);
        break;
      case 'give':
        this.help(e, entry.seat, entry.to);
        break;
      case 'play':
        if (entry.name === 'tao' && entry.for !== undefined) this.help(e, entry.seat, entry.for);
        break;
      case 'die':
        if (entry.role === 'rebel' || entry.role === 'traitor') this.deadAgainst += 1;
        if (entry.killer !== null && entry.killer !== entry.seat && entry.killer !== e.lord.seat) {
          this.bump(entry.killer, entry.role === 'rebel' ? 2 : entry.role === 'loyalist' ? -3 : 0);
        }
        break;
      default:
    }
  }

  private bump(seat: number, by: number): void {
    this.rep[seat] = Math.max(-LIMIT, Math.min(LIMIT, (this.rep[seat] ?? 0) + by));
  }

  /** `from` went for `to`: against the lord is the strongest sign, against one of his side a weaker one. */
  private strike(e: Engine, from: number, to: number): void {
    if (from === to || from === e.lord.seat) return;
    const known = this.rep[to] ?? 0;
    this.bump(from, to === e.lord.seat ? -3 : known >= 1 ? -1 : known <= -1 ? 1 : 0);
  }

  private help(e: Engine, from: number, to: number): void {
    if (from === to || from === e.lord.seat) return;
    const known = this.rep[to] ?? 0;
    this.bump(from, to === e.lord.seat ? 2 : known >= 1 ? 1 : known <= -1 ? -1 : 0);
  }

  // Who is whose

  /** How `me` takes `seat`: up for a friend, down for an enemy, around nought when it cannot tell. */
  private attitude(e: Engine, me: number, seat: number): number {
    if (seat === me) return 100;
    const lord = e.lord.seat;
    const alive = e.alive();
    const role = e.p(me).role;
    const rep = this.rep[seat] ?? 0;
    if (alive.length === 2) return -100;
    if (role === 'lord' || role === 'loyalist') {
      if (seat === lord) return 100;
      // Everyone left who is not on the lord's side is against him, so when that is all there is, that is who they are.
      const others = alive.filter((p) => p.seat !== me && p.seat !== lord).length;
      return this.against - this.deadAgainst >= others ? -50 : rep * ALLY;
    }
    if (role === 'rebel') return seat === lord ? -100 : -rep * ALLY;
    if (seat === lord) {
      const rest = alive.filter((p) => p.seat !== me && p.seat !== lord && (this.rep[p.seat] ?? 0) <= 0).length;
      return rest > 0 ? 20 : -100;
    }
    return rep < 0 ? -15 : rep > 0 ? -5 : 0;
  }

  /** 1 for a friend, -1 for an enemy, 0 when `me` cannot tell. */
  private side(e: Engine, me: number, seat: number): number {
    const a = this.attitude(e, me, seat);
    return a >= ALLY ? 1 : a <= FOE ? -1 : 0;
  }

  // Answering

  answer(seat: number, ask: Ask, e: Engine): Reply | null {
    switch (ask.k) {
      case 'hero': {
        const hero = ask.heroes[Math.floor(this.random() * ask.heroes.length)];
        return hero ? { k: 'hero', hero } : null;
      }
      case 'play':
        return this.play(e, seat, ask);
      case 'cards':
        return this.cards(e, seat, ask);
      case 'area':
        return this.area(e, seat, ask);
      case 'seat':
        return this.seats(e, seat, ask);
      default:
        return this.confirm(e, seat, ask);
    }
  }

  private confirm(e: Engine, me: number, ask: Extract<Ask, { k: 'confirm' }>): Reply {
    if (ask.why !== 'luoyi') return { k: 'confirm', yes: true };
    return { k: 'confirm', yes: e.p(me).hand.some((c) => c.name === 'sha' || c.name === 'juedou') };
  }

  private seats(e: Engine, me: number, ask: Extract<Ask, { k: 'seat' }>): Reply {
    const foes = ask.options
      .filter((s) => this.side(e, me, s) < 0)
      .sort((a, b) => e.p(b).hand.length - e.p(a).hand.length);
    return { k: 'seat', seats: foes.slice(0, ask.max) };
  }

  private area(e: Engine, me: number, ask: Extract<Ask, { k: 'area' }>): Reply {
    const friend = this.side(e, me, ask.owner) > 0;
    if (friend && ask.judges.length) return { k: 'area', zone: 'judge', card: ask.judges[0] ?? null };
    const gear = ask.equip.flatMap((id) => e.card(id) ?? []).sort((a, b) => KEEP[b.name] - KEEP[a.name]);
    const best = gear[0];
    if (best && (!ask.hand || (KEEP[best.name] >= 30 && this.random() < 0.6))) return { k: 'area', zone: 'equip', card: best.id };
    if (ask.hand) return { k: 'area', zone: 'hand', card: null };
    return { k: 'area', zone: 'judge', card: ask.judges[0] ?? null };
  }

  // Questions about a card

  private cards(e: Engine, me: number, ask: Extract<Ask, { k: 'cards' }>): Reply {
    const self = e.p(me);
    const pool = ask.cards.flatMap((id) => e.card(id) ?? []).sort(byKeep);
    const take = (cards: readonly Card[]): Reply => ({ k: 'cards', ids: cards.map((c) => c.id) });
    const none = take([]);
    const { ctx } = ask;
    const need = ctx.need ?? 1;
    switch (ask.why) {
      case 'shan':
        return pool.length >= need ? take(pool.slice(0, 1)) : none;
      case 'sha': {
        if (pool.length < need) return none;
        const theirs = ctx.from === undefined ? 0 : e.p(ctx.from).hand.length;
        const worth = self.hp <= 2 || pool.length >= 2 || (ctx.name === 'juedou' && theirs <= 1);
        return worth ? take(pool.slice(0, 1)) : none;
      }
      case 'tao': {
        const victim = ctx.target ?? me;
        const a = this.attitude(e, me, victim);
        const save = victim === me || a >= ALLY || (a > FOE && this.random() < 0.3);
        return save ? take(pool.slice(0, 1)) : none;
      }
      case 'wuxie': {
        const want = this.wants(e, me, ctx.name, ctx.from, ctx.target);
        return want !== null && want !== ctx.on ? take(pool.slice(0, 1)) : none;
      }
      case 'discard':
        return take(pool.slice(0, ask.min));
      case 'ganglie':
        return pool.length >= 2 && (self.hp <= 1 || pool.length >= 5) ? take(pool.slice(0, 2)) : none;
      case 'guanshi': {
        const t = ctx.target;
        const kills = t !== undefined && e.p(t).hp <= 1;
        return t !== undefined && this.side(e, me, t) < 0 && pool.length >= 2 && (kills || self.hand.length > self.hp + 1)
          ? take(pool.slice(0, 2))
          : none;
      }
      case 'guicai':
        return this.guicai(e, me, ask, pool);
      case 'guanxing':
        return take(pool.filter((c) => KEEP[c.name] < 30));
      default:
        // 麒麟弓 and 青龙偃月刀: only against someone on the other side.
        return ctx.target !== undefined && this.side(e, me, ctx.target) < 0 ? take(pool.slice(0, 1)) : none;
    }
  }

  /** Whether `me` wants the trick to go through: true or false, or null when it has no stake in it. */
  private wants(e: Engine, me: number, name: CardName | undefined, from?: number, target?: number): boolean | null {
    const of = (seat: number | undefined): number => (seat === undefined ? 0 : this.side(e, me, seat));
    if (name === 'wuzhong') return of(from) > 0 ? true : of(from) < 0 ? false : null;
    if (name === 'taoyuan') return of(target) > 0 ? true : of(target) < 0 ? false : null;
    // The rest do harm to `target`: wanted against a foe, not against a friend.
    return of(target) < 0 ? true : of(target) > 0 ? false : null;
  }

  /** Whether the player being judged comes out ahead with `card`. */
  private static gains(why: JudgeWhy, card: CardInfo): boolean {
    switch (why) {
      case 'lebu':
        return card.suit === 'heart';
      case 'bing':
        return card.suit === 'club';
      case 'shandian':
        return !(card.suit === 'spade' && card.rank >= 2 && card.rank <= 9);
      case 'bagua':
      case 'tieqi':
        return isRed(card);
      case 'luoshen':
        return isBlack(card);
      default:
        return card.suit !== 'heart';
    }
  }

  private guicai(e: Engine, me: number, ask: Extract<Ask, { k: 'cards' }>, pool: readonly Card[]): Reply {
    const none: Reply = { k: 'cards', ids: [] };
    const judging = this.judging;
    const now = ask.ctx.card;
    if (!judging || !now) return none;
    const side = this.side(e, me, judging.seat);
    // A friend should come out ahead of the judgement and a foe should not.
    const want = side > 0;
    if (!side || Bots.gains(judging.why, now) === want) return none;
    const swap = pool.find((c) => Bots.gains(judging.why, c) === want && KEEP[c.name] < 70);
    return swap ? { k: 'cards', ids: [swap.id] } : none;
  }

  // The play phase

  private play(e: Engine, me: number, ask: Extract<Ask, { k: 'play' }>): Reply {
    const top: { score: number; reply: Reply } = { score: 20, reply: { k: 'end' } };
    const offer = (score: number, reply: Reply): void => {
      if (score > top.score) {
        top.score = score;
        top.reply = reply;
      }
    };
    for (const use of ask.uses) {
      const card = e.card(use.card);
      const rated = card ? this.rate(e, me, card, use) : null;
      if (!card || !rated) continue;
      // A card turned into another by a skill costs what the card itself was worth.
      const spent = use.skill ? KEEP[card.name] : 0;
      offer(rated.score - spent, {
        k: 'use', card: use.card, as: use.as, targets: rated.targets, ...(use.skill ? { skill: use.skill } : {}),
      });
    }
    for (const option of ask.skills) {
      const rated = this.rateSkill(e, me, option);
      if (rated) offer(rated.score, rated.reply);
    }
    if (top.reply.k === 'skill' && top.reply.skill === 'kurou') this.kurou += 1;
    return top.reply;
  }

  private rate(e: Engine, me: number, card: Card, use: Use): Rated | null {
    const self = e.p(me);
    const { min, max, options } = use.targets;
    const spare = self.hand.length > self.hp;
    const aim = (worth: (seat: number) => number): Rated | null => {
      const ranked = options
        .map((seat) => ({ seat, worth: worth(seat) }))
        .filter((x) => x.worth > 0)
        .sort((a, b) => b.worth - a.worth)
        .slice(0, max);
      const first = ranked[0];
      return first && ranked.length >= min ? { score: first.worth, targets: ranked.map((x) => x.seat) } : null;
    };
    const plain = (score: number): Rated | null => (score > 0 ? { score, targets: [] } : null);
    const att = (seat: number): number => this.attitude(e, me, seat);
    const cardsOf = (seat: number): number => e.p(seat).hand.length + equipOf(e.p(seat)).length;
    switch (use.as) {
      case 'sha':
        return aim((s) => {
          const a = att(s);
          if (a <= FOE) return 60 + (e.p(s).hp <= 1 ? 15 : 0) + Math.min(10, -a / 10);
          return spare && a < ALLY ? 30 - a / 2 : 0;
        });
      case 'tao':
        return plain(spare || self.hand.filter((c) => c.name === 'tao').length >= 2 ? 55 : 0);
      case 'wuzhong':
        return plain(90);
      case 'taoyuan': {
        const gain = e.alive().reduce((sum, p) => sum + (p.hp < p.maxHp ? this.side(e, me, p.seat) : 0), 0);
        return plain(gain > 0 ? 45 + gain * 5 : 0);
      }
      case 'nanman':
      case 'wanjian': {
        let gain = spare ? 1 : 0;
        for (const p of e.alive()) {
          if (p.seat === me) continue;
          const side = this.side(e, me, p.seat);
          gain += side < 0 ? (p.hp <= 1 ? 1.5 : 1) : side > 0 ? -1.5 : -0.15;
        }
        return plain(gain >= 0.8 ? 40 + gain * 10 : 0);
      }
      case 'juedou':
        return aim((s) => {
          if (att(s) > FOE) return 0;
          const mine = serving(e, me, 'sha').filter((c) => c.id !== card.id).length;
          const theirs = e.p(s).hand.length;
          return (mine >= 1 && mine + 0.5 > theirs * 0.35) || theirs === 0 ? 55 : 0;
        });
      case 'chai':
      case 'shun':
        return aim((s) => {
          const a = att(s);
          if (a <= FOE) return cardsOf(s) ? 45 + Math.min(10, cardsOf(s) * 2) : 0;
          return a >= ALLY && e.p(s).judges.length ? 55 : 0;
        });
      case 'lebu':
        return aim((s) => (att(s) <= FOE ? 50 + Math.min(10, e.p(s).hand.length * 2) : 0));
      case 'bing':
        return aim((s) => (att(s) <= FOE ? 45 : 0));
      case 'shandian':
        return plain(self.hp >= 3 ? 25 : 0);
      default: {
        const slot = slotOf(use.as);
        if (!slot) return null;
        const old = self.equip[slot];
        if (!old) return plain(55);
        return slot === 'weapon' && reach(use.as) > reach(old.name) ? plain(40) : null;
      }
    }
  }

  /** The cards that can go without much loss: what is worth little, and what there are more of than can be used. */
  private junk(cards: readonly Card[]): Card[] {
    const seen = new Map<CardName, number>();
    return cards
      .filter((c) => {
        const n = (seen.get(c.name) ?? 0) + 1;
        seen.set(c.name, n);
        return KEEP[c.name] < 30 || (c.name === 'sha' && n > 2) || (c.name === 'shan' && n > 2);
      })
      .slice(0, 4);
  }

  private rateSkill(e: Engine, me: number, option: SkillOption): { score: number; reply: Reply } | null {
    const self = e.p(me);
    const sorted = (ids: readonly number[]): Card[] => ids.flatMap((id) => e.card(id) ?? []).sort(byKeep);
    const act = (cards: readonly Card[], targets: number[]): Reply => ({
      k: 'skill', skill: option.skill, cards: cards.map((c) => c.id), targets,
    });
    const friends = (): number[] => (option.targets?.options ?? []).filter((s) => this.side(e, me, s) > 0);
    switch (option.skill) {
      case 'rende': {
        const friend = friends().sort((a, b) => e.p(a).hand.length - e.p(b).hand.length)[0];
        const cards = sorted(option.cards?.ids ?? []);
        const first = e.flags.given < 2;
        const n = first ? (cards.length >= 3 ? 2 : 0) : Math.max(0, cards.length - self.hp);
        return friend === undefined || !n ? null : { score: first ? 35 : 25, reply: act(cards.slice(0, n), [friend]) };
      }
      case 'zhiheng': {
        const junk = this.junk(sorted(self.hand.map((c) => c.id)));
        return junk.length ? { score: 32 + junk.length, reply: act(junk, []) } : null;
      }
      case 'kurou': {
        const safe = self.hp >= 3 || (self.hp === 2 && self.hand.some((c) => c.name === 'tao'));
        return this.kurou < 2 && safe ? { score: 28, reply: act([], []) } : null;
      }
      default: {
        const patient = friends().sort((a, b) => e.p(a).hp - e.p(b).hp)[0];
        const card = sorted(option.cards?.ids ?? [])[0];
        if (patient === undefined || !card) return null;
        return { score: e.p(patient).hp <= 2 ? 50 : 30, reply: act([card], [patient]) };
      }
    }
  }
}
