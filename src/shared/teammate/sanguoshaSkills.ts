/**
 * What the heroes' skills do, apart from the ones that only change what a card may be played as or at whom (those are in
 * `sanguoshaUse.ts`) and the ones the table itself reads off a hero (Mashu, Lianying, Xiaoji, Tiandu, Keji: see
 * `sanguosha.ts` and `sanguoshaRun.ts`). The skills here wait for something to happen or for the player to choose them.
 */
import { infoOf, isBlack } from './sanguoshaCards';
import type { Card } from './sanguoshaCards';
import type { Engine } from './sanguosha';
import { equipOf } from './sanguoshaTypes';
import type { JudgeWhy, Reply, SkillOption } from './sanguoshaTypes';

/** After `seat` has taken damage and lived. `cards` are those that dealt it. */
export async function afterDamage(e: Engine, seat: number, source: number | null, cards: readonly Card[]): Promise<void> {
  const me = e.p(seat);
  const from = source !== null && source !== seat && e.p(source).alive ? e.p(source) : null;

  if (e.has(seat, 'jianxiong')) {
    const loose = cards.filter((c) => e.limbo.includes(c));
    if (loose.length) {
      await e.emit({ k: 'skill', seat, skill: 'jianxiong' });
      await e.emit({ k: 'take', seat, from: null, cards: loose.map(infoOf), zone: 'limbo' });
      await e.toHand(seat, loose);
    }
  }
  if (e.has(seat, 'fankui') && from && (from.hand.length || equipOf(from).length)) {
    await e.emit({ k: 'skill', seat, skill: 'fankui', targets: [from.seat] });
    await e.pick(seat, from.seat, 'fankui');
  }
  if (e.has(seat, 'ganglie') && from && me.alive) {
    await e.emit({ k: 'skill', seat, skill: 'ganglie', targets: [from.seat] });
    const flip = await e.judge(seat, 'ganglie');
    if (flip.suit !== 'heart' && from.alive) {
      const paid = from.hand.length >= 2 ? await e.askCards(from.seat, 'ganglie', { from: seat }, from.hand, 0, 2) : [];
      if (paid.length === 2) await e.discard(from.seat, paid);
      else await e.damage(from.seat, 1, seat);
    }
  }
  if (e.has(seat, 'yiji') && me.alive) {
    await e.emit({ k: 'skill', seat, skill: 'yiji' });
    await e.draw(seat, 2);
  }
}

/** Guicai: whoever has it may swap a hand card in for a judgement before it counts. Returns the card that counts. */
export async function judged(e: Engine, seat: number, card: Card, why: JudgeWhy): Promise<Card> {
  let current = card;
  for (const p of e.order(seat)) {
    if (!e.has(p.seat, 'guicai') || !p.hand.length) continue;
    const [swap] = await e.askCards(p.seat, 'guicai', { target: seat, card: infoOf(current) }, p.hand, 0, 1);
    if (!swap) continue;
    await e.emit({ k: 'skill', seat: p.seat, skill: 'guicai' });
    await e.toTrash([current]);
    await e.toLimbo([swap]);
    current = swap;
    await e.emit({ k: 'judge', seat, card: infoOf(current), why });
  }
  return current;
}

// Turn phases

export async function startPhase(e: Engine, seat: number): Promise<void> {
  const me = e.p(seat);
  if (e.has(seat, 'guanxing')) {
    const n = Math.min(5, e.alive().length);
    await e.refill(n);
    const top = e.pile.slice(0, n);
    if (top.length) {
      await e.emit({ k: 'skill', seat, skill: 'guanxing' });
      // The cards picked go under the pile; the rest stay on top as they were.
      const bottom = await e.askCards(seat, 'guanxing', {}, top, 0, top.length);
      if (bottom.length) e.pile = [...e.pile.filter((c) => !bottom.includes(c)), ...bottom];
    }
  }
  if (e.has(seat, 'luoshen')) {
    for (let i = 0; i < 30 && me.alive && (await e.askYes(seat, 'luoshen')); i++) {
      if (i === 0) await e.emit({ k: 'skill', seat, skill: 'luoshen' });
      const card = await e.judge(seat, 'luoshen', true);
      if (!e.card(card.id)) break;
      if (!isBlack(card)) {
        await e.toTrash([card]);
        break;
      }
      await e.emit({ k: 'take', seat, from: null, cards: [infoOf(card)], zone: 'limbo' });
      await e.toHand(seat, [card]);
    }
  }
}

/** Draws for the turn, the way the hero's skills have it. */
export async function drawPhase(e: Engine, seat: number): Promise<void> {
  if (e.has(seat, 'tuxi')) {
    const options = e.alive().filter((p) => p.seat !== seat && p.hand.length > 0).map((p) => p.seat);
    const picked = await e.askSeats(seat, 'tuxi', {}, options, 0, 2);
    if (picked.length) {
      await e.emit({ k: 'skill', seat, skill: 'tuxi', targets: picked });
      for (const target of picked) await e.steal(seat, target);
      return;
    }
  }
  let n = e.has(seat, 'yingzi') ? 3 : 2;
  if (e.has(seat, 'luoyi') && (await e.askYes(seat, 'luoyi'))) {
    n -= 1;
    e.flags.luoyi = true;
    await e.emit({ k: 'skill', seat, skill: 'luoyi' });
  }
  await e.draw(seat, n);
}

export async function endPhase(e: Engine, seat: number): Promise<void> {
  if (!e.has(seat, 'biyue')) return;
  await e.emit({ k: 'skill', seat, skill: 'biyue' });
  await e.draw(seat, 1);
}

// Skills a player starts in the play phase

/** The skills `seat` may start right now, with what each needs picked. */
export function skillOptions(e: Engine, seat: number): SkillOption[] {
  const me = e.p(seat);
  const hand = me.hand.map((c) => c.id);
  const everything = [...hand, ...equipOf(me).map((c) => c.id)];
  const others = e.alive().filter((p) => p.seat !== seat).map((p) => p.seat);
  const hurt = e.alive().filter((p) => p.hp < p.maxHp).map((p) => p.seat);
  const out: SkillOption[] = [];
  if (e.has(seat, 'rende') && hand.length && others.length) {
    out.push({ skill: 'rende', cards: { min: 1, max: hand.length, ids: hand }, targets: { min: 1, max: 1, options: others } });
  }
  if (e.has(seat, 'zhiheng') && !e.flags.zhiheng && everything.length) {
    out.push({ skill: 'zhiheng', cards: { min: 1, max: everything.length, ids: everything }, targets: null });
  }
  if (e.has(seat, 'kurou') && me.hp > 1) out.push({ skill: 'kurou', cards: null, targets: null });
  if (e.has(seat, 'qingnang') && !e.flags.qingnang && hand.length && hurt.length) {
    out.push({ skill: 'qingnang', cards: { min: 1, max: 1, ids: hand }, targets: { min: 1, max: 1, options: hurt } });
  }
  return out;
}

const fits = (picked: readonly number[], min: number, max: number, allowed: readonly number[]): boolean =>
  picked.length >= min && picked.length <= max && new Set(picked).size === picked.length && picked.every((x) => allowed.includes(x));

/** Starts the skill a player chose, if it is one of the options. False when it is not. */
export async function actSkill(e: Engine, seat: number, reply: Extract<Reply, { k: 'skill' }>, options: readonly SkillOption[]): Promise<boolean> {
  const option = options.find((o) => o.skill === reply.skill);
  if (!option) return false;
  const { cards: want, targets: aim } = option;
  if (want ? !fits(reply.cards, want.min, want.max, want.ids) : reply.cards.length) return false;
  if (aim ? !fits(reply.targets, aim.min, aim.max, aim.options) : reply.targets.length) return false;
  const cards = reply.cards.flatMap((id) => e.card(id) ?? []);
  const target = reply.targets[0];
  switch (reply.skill) {
    case 'rende': {
      if (target === undefined) return false;
      await e.emit({ k: 'skill', seat, skill: 'rende', targets: [target] });
      await e.emit({ k: 'give', seat, to: target, cards: cards.map(infoOf) });
      await e.toHand(target, cards);
      const before = e.flags.given;
      e.flags.given += cards.length;
      if (before < 2 && e.flags.given >= 2) await e.heal(seat, 1);
      return true;
    }
    case 'zhiheng':
      e.flags.zhiheng = true;
      await e.emit({ k: 'skill', seat, skill: 'zhiheng' });
      await e.discard(seat, cards);
      await e.draw(seat, cards.length);
      return true;
    case 'kurou':
      await e.emit({ k: 'skill', seat, skill: 'kurou' });
      await e.loseHp(seat, 1);
      if (e.p(seat).alive) await e.draw(seat, 2);
      return true;
    case 'qingnang':
      if (target === undefined) return false;
      e.flags.qingnang = true;
      await e.emit({ k: 'skill', seat, skill: 'qingnang', targets: [target] });
      await e.discard(seat, cards);
      await e.heal(target, 1);
      return true;
    default:
      return false;
  }
}
