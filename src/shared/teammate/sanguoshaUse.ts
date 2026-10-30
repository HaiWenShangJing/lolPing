/**
 * Playing cards: which cards a player may play and at whom, how each card works out, and the answers the other players
 * give to them (闪, 杀, 桃, 无懈可击). The card-turning skills (Wusheng and the like) are in here too, since they decide
 * what a card may be played as.
 */
import { infoOf, isBlack, isRed, kindOf, slotOf } from './sanguoshaCards';
import type { Card, CardName } from './sanguoshaCards';
import type { SkillId } from './sanguoshaHeroes';
import type { Engine } from './sanguosha';
import { equipOf, hasAny } from './sanguoshaTypes';
import type { Ctx, DelayedName, Player, Reply, Targets, Use } from './sanguoshaTypes';

/** What a card can be played as in answer to something. */
export type Answer = 'sha' | 'shan' | 'tao' | 'wuxie';

function canServe(e: Engine, seat: number, card: Card, as: Answer): boolean {
  switch (as) {
    case 'shan':
      return card.name === 'shan' || (card.name === 'sha' && e.has(seat, 'longdan')) || (isBlack(card) && e.has(seat, 'qingguo'));
    case 'sha':
      return card.name === 'sha' || (card.name === 'shan' && e.has(seat, 'longdan')) || (isRed(card) && e.has(seat, 'wusheng'));
    case 'tao':
      return card.name === 'tao' || (isRed(card) && e.turn !== seat && e.has(seat, 'jijiu'));
    default:
      return card.name === 'wuxie';
  }
}

/** The cards in `seat`'s hand that may be played as `as`. */
export function serving(e: Engine, seat: number, as: Answer): Card[] {
  return e.p(seat).hand.filter((card) => canServe(e, seat, card, as));
}

/** The skill that lets `card` stand in for `as`, when it is not that card itself. */
function skillFor(e: Engine, seat: number, card: Card, as: CardName): SkillId | undefined {
  if (card.name === as) return undefined;
  const skills: SkillId[] = as === 'shan' ? ['longdan', 'qingguo'] : as === 'sha' ? ['longdan', 'wusheng'] : as === 'tao' ? ['jijiu'] : [];
  return skills.find((skill) => e.has(seat, skill));
}

/** Plays a card from the hand as an answer: a 闪 to a 杀, a 桃 to save someone, a 无懈可击 to a trick. */
export async function playCard(e: Engine, seat: number, card: Card, as: Answer, target?: number): Promise<void> {
  await e.emit({ k: 'play', seat, name: as, cards: [infoOf(card)], skill: skillFor(e, seat, card, as), for: target });
  if (as === 'sha' && seat === e.turn) e.flags.shaPlayed = true;
  await e.toTrash([card]);
}

/** Asks `seat` for `need` cards played as a 杀 or 闪, one after the other. Anything short of that fails. */
async function respond(e: Engine, seat: number, as: 'sha' | 'shan', ctx: Ctx, need: number): Promise<boolean> {
  for (let i = 0; i < need; i++) {
    const cards = serving(e, seat, as);
    if (!cards.length) return false;
    const [card] = await e.askCards(seat, as, { ...ctx, need: need - i }, cards, 0, 1);
    if (!card) return false;
    await playCard(e, seat, card, as);
  }
  return true;
}

/** Like `respond` for a 闪, with 八卦阵 to try first when the armour is worn and not ignored. */
async function dodge(e: Engine, seat: number, ctx: Ctx, need: number, ignoreArmor: boolean): Promise<boolean> {
  for (let i = 0; i < need; i++) {
    let met = false;
    if (!ignoreArmor && e.p(seat).equip.armor?.name === 'bagua' && (await e.askYes(seat, 'bagua', ctx))) {
      await e.emit({ k: 'armor', seat, name: 'bagua' });
      met = isRed(await e.judge(seat, 'bagua'));
    }
    if (!met) {
      const cards = serving(e, seat, 'shan');
      const [card] = cards.length ? await e.askCards(seat, 'shan', { ...ctx, need: need - i }, cards, 0, 1) : [];
      if (card) {
        await playCard(e, seat, card, 'shan');
        met = true;
      }
    }
    if (!met) return false;
  }
  return true;
}

/**
 * Gives everyone with a 无懈可击 the chance to cancel the trick, and to cancel each other's, until nobody wants to.
 * True when the trick ends up cancelled.
 */
export async function negated(e: Engine, name: CardName, user: number | null, target: number | null): Promise<boolean> {
  let on = true;
  for (let playing = true; playing; ) {
    playing = false;
    for (const p of e.order(user ?? target ?? e.turn)) {
      const cards = serving(e, p.seat, 'wuxie');
      if (!cards.length) continue;
      const ctx: Ctx = { name, on };
      if (user !== null) ctx.from = user;
      if (target !== null) ctx.target = target;
      const [card] = await e.askCards(p.seat, 'wuxie', ctx, cards, 0, 1);
      if (!card) continue;
      await playCard(e, p.seat, card, 'wuxie');
      on = !on;
      playing = true;
      break;
    }
  }
  if (!on) await e.emit({ k: 'cancel', name, target });
  return !on;
}

// What may be played

const NONE: Targets = { min: 0, max: 0, options: [] };

/** 空城: a hero with no hand cards cannot be the target of a 杀 or 决斗. */
const hollow = (e: Engine, p: Player): boolean => e.has(p.seat, 'kongcheng') && p.hand.length === 0;
const unlimited = (e: Engine, seat: number): boolean => e.p(seat).equip.weapon?.name === 'zhuge' || e.has(seat, 'paoxiao');

function targetsFor(e: Engine, seat: number, as: CardName): Targets | null {
  const me = e.p(seat);
  const others = e.alive().filter((p) => p.seat !== seat);
  const pick = (from: Player[], max = 1): Targets | null =>
    from.length ? { min: 1, max: Math.min(max, from.length), options: from.map((p) => p.seat) } : null;
  const near = (p: Player): boolean => e.has(seat, 'qicai') || e.distance(seat, p.seat) <= 1;
  switch (as) {
    case 'sha': {
      if (e.flags.sha >= 1 && !unlimited(e, seat)) return null;
      const reach = others.filter((p) => e.inRange(seat, p.seat) && !hollow(e, p));
      return pick(reach, me.equip.weapon?.name === 'fangtian' && me.hand.length === 1 ? 3 : 1);
    }
    case 'tao':
      return me.hp < me.maxHp ? NONE : null;
    case 'wuzhong':
    case 'nanman':
    case 'wanjian':
    case 'taoyuan':
      return NONE;
    case 'juedou':
      return pick(others.filter((p) => !hollow(e, p)));
    case 'chai':
      return pick(others.filter(hasAny));
    case 'shun':
      return pick(others.filter((p) => hasAny(p) && near(p) && !e.has(p.seat, 'qianxun')));
    case 'lebu':
      return pick(others.filter((p) => !e.has(p.seat, 'qianxun') && !p.judges.some((j) => j.as === 'lebu')));
    case 'bing':
      return pick(others.filter((p) => near(p) && !p.judges.some((j) => j.as === 'bing')));
    case 'shandian':
      return me.judges.some((j) => j.as === 'shandian') ? null : NONE;
    case 'shan':
    case 'wuxie':
      return null;
    default:
      return slotOf(as) ? NONE : null;
  }
}

/** What a card in the hand can be played as, in the play phase. */
function asOptions(e: Engine, seat: number, card: Card): { as: CardName; skill?: SkillId }[] {
  const out: { as: CardName; skill?: SkillId }[] = [];
  if (card.name !== 'shan' && card.name !== 'wuxie') out.push({ as: card.name });
  const turn = (skill: SkillId, as: CardName, fits: boolean): void => {
    if (fits && card.name !== as && e.has(seat, skill)) out.push({ as, skill });
  };
  turn('wusheng', 'sha', isRed(card));
  turn('longdan', 'sha', card.name === 'shan');
  turn('qixi', 'chai', isBlack(card));
  turn('guose', 'lebu', card.suit === 'diamond');
  return out;
}

/** Every card in `seat`'s hand that may be played right now, one entry for each way to play it. */
export function legalUses(e: Engine, seat: number): Use[] {
  const uses: Use[] = [];
  for (const card of e.p(seat).hand) {
    for (const way of asOptions(e, seat, card)) {
      const targets = targetsFor(e, seat, way.as);
      if (!targets) continue;
      const use: Use = { card: card.id, as: way.as, targets };
      if (way.skill) use.skill = way.skill;
      uses.push(use);
    }
  }
  return uses;
}

/** Plays what a player chose in the play phase, if it is one of the legal uses. False when it is not. */
export async function actUse(e: Engine, seat: number, reply: Extract<Reply, { k: 'use' }>, uses: readonly Use[]): Promise<boolean> {
  const use = uses.find((u) => u.card === reply.card && u.as === reply.as && u.skill === reply.skill);
  const card = use ? e.card(use.card) : undefined;
  if (!use || !card || !e.p(seat).hand.includes(card)) return false;
  const chosen = new Set(reply.targets);
  const { min, max, options } = use.targets;
  if (chosen.size !== reply.targets.length || chosen.size < min || chosen.size > max) return false;
  if (!reply.targets.every((t) => options.includes(t))) return false;
  const targets = e.order(seat).map((p) => p.seat).filter((s) => chosen.has(s));
  await useCard(e, seat, card, use.as, use.skill, targets);
  return true;
}

// How cards work out

/** Plays `card` as `as`: pays for it, then lets it do what it does. */
export async function useCard(
  e: Engine, seat: number, card: Card, as: CardName, skill: SkillId | undefined, targets: number[],
): Promise<void> {
  await e.emit({ k: 'use', seat, name: as, cards: [infoOf(card)], targets, skill });
  await e.toLimbo([card]);
  if (slotOf(as)) {
    await e.equip(seat, card);
    return;
  }
  if (kindOf(as) === 'delayed') {
    await e.place(card, as as DelayedName, targets[0] ?? seat);
    return;
  }
  if (as === 'sha' && seat === e.turn) {
    e.flags.sha += 1;
    e.flags.shaPlayed = true;
  }
  if (kindOf(as) === 'trick' && e.has(seat, 'jizhi')) {
    await e.emit({ k: 'skill', seat, skill: 'jizhi' });
    await e.draw(seat, 1);
  }
  await resolve(e, seat, card, as, targets);
  if (e.limbo.includes(card)) await e.toTrash([card]);
}

async function resolve(e: Engine, seat: number, card: Card, as: CardName, targets: number[]): Promise<void> {
  const target = targets[0];
  switch (as) {
    case 'sha':
      for (const t of targets) {
        if (!e.p(seat).alive) break;
        await shaOn(e, seat, t, card);
      }
      return;
    case 'tao':
      await e.heal(seat, 1);
      return;
    case 'wuzhong':
      if (!(await negated(e, as, seat, seat))) await e.draw(seat, 2);
      return;
    case 'juedou':
      if (target !== undefined && !(await negated(e, as, seat, target))) await duel(e, seat, target, card);
      return;
    case 'chai':
    case 'shun':
      if (target !== undefined && !(await negated(e, as, seat, target))) await e.pick(seat, target, as);
      return;
    case 'nanman':
    case 'wanjian':
      for (const p of e.order(seat + 1)) {
        if (p.seat === seat || !p.alive) continue;
        if (await negated(e, as, seat, p.seat)) continue;
        const answered = as === 'nanman'
          ? await respond(e, p.seat, 'sha', { from: seat, name: as }, 1)
          : await dodge(e, p.seat, { from: seat, name: as }, 1, false);
        if (!answered) await e.damage(p.seat, 1, seat, [card]);
      }
      return;
    case 'taoyuan':
      for (const p of e.order(seat)) {
        if (!p.alive || p.hp >= p.maxHp) continue;
        if (await negated(e, as, seat, p.seat)) continue;
        await e.heal(p.seat, 1);
      }
      return;
    default:
  }
}

/** One 杀 at one target: armour, 闪, and what the weapon does about it. */
async function shaOn(e: Engine, src: number, tgt: number, card: Card): Promise<void> {
  const t = e.p(tgt);
  if (!t.alive) return;
  const weapon = e.p(src).equip.weapon;
  const ignore = weapon?.name === 'qinggang';
  if (!ignore && t.equip.armor?.name === 'renwang' && isBlack(card)) {
    await e.emit({ k: 'armor', seat: tgt, name: 'renwang' });
    return;
  }
  let unavoidable = false;
  if (e.has(src, 'tieqi')) {
    await e.emit({ k: 'skill', seat: src, skill: 'tieqi', targets: [tgt] });
    unavoidable = isRed(await e.judge(src, 'tieqi'));
  }
  const need = e.has(src, 'wushuang') ? 2 : 1;
  const dodged = !unavoidable && (await dodge(e, tgt, { from: src, name: 'sha', need }, need, ignore));
  const hit = async (): Promise<void> => {
    await e.damage(tgt, 1 + (e.flags.luoyi && src === e.turn ? 1 : 0), src, [card]);
    if (e.p(src).equip.weapon?.name !== 'qilin' || !t.alive) return;
    const horses = [t.equip.plus, t.equip.minus].filter((c): c is Card => c !== null);
    const [horse] = await e.askCards(src, 'qilin', { target: tgt }, horses, 0, 1);
    if (!horse) return;
    await e.emit({ k: 'discard', seat: src, from: tgt, cards: [infoOf(horse)] });
    await e.toTrash([horse]);
  };
  if (!dodged) {
    await hit();
    return;
  }
  if (!t.alive || !e.p(src).alive || !weapon) return;
  if (weapon.name === 'qinglong') {
    const [again] = await e.askCards(src, 'qinglong', { target: tgt }, serving(e, src, 'sha'), 0, 1);
    if (again) await useCard(e, src, again, 'sha', skillFor(e, src, again, 'sha'), [tgt]);
  } else if (weapon.name === 'guanshi') {
    const cost = [...e.p(src).hand, ...equipOf(e.p(src)).filter((c) => c !== weapon)];
    const paid = await e.askCards(src, 'guanshi', { target: tgt }, cost, 0, 2);
    if (paid.length === 2) {
      await e.discard(src, paid);
      await hit();
    }
  }
}

/** The two take turns playing a 杀 until one cannot; that one takes the damage. */
async function duel(e: Engine, src: number, tgt: number, card: Card): Promise<void> {
  let loser = tgt;
  let winner = src;
  for (;;) {
    const need = e.has(winner, 'wushuang') ? 2 : 1;
    if (!(await respond(e, loser, 'sha', { from: winner, name: 'juedou' }, need))) break;
    [loser, winner] = [winner, loser];
  }
  await e.damage(loser, 1 + (e.flags.luoyi && winner === e.turn ? 1 : 0), winner, [card]);
}
