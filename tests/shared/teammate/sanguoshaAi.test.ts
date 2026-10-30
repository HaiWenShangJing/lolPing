import { describe, expect, it } from 'vitest';
import { Bots } from '../../../src/shared/teammate/sanguoshaAi';
import { shuffle } from '../../../src/shared/teammate/sanguoshaCards';
import type { Card } from '../../../src/shared/teammate/sanguoshaCards';
import type { HeroId } from '../../../src/shared/teammate/sanguoshaHeroes';
import { runSanguosha } from '../../../src/shared/teammate/sanguoshaRun';
import { skillOptions } from '../../../src/shared/teammate/sanguoshaSkills';
import { ROLE_SETS } from '../../../src/shared/teammate/sanguoshaTypes';
import type { Ask, CardsWhy, Ctx, Entry, Outcome, Reply, Size } from '../../../src/shared/teammate/sanguoshaTypes';
import { legalUses } from '../../../src/shared/teammate/sanguoshaUse';
import { area, end, hold, info, no, pick, plant, rig, seats, wear, yes, type RigOptions } from './sanguoshaRig';

/** A seeded generator whose first values differ from one seed to the next (mulberry32). */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Whether an answer is one the question allows

const distinct = (xs: readonly number[]): boolean => new Set(xs).size === xs.length;
const among = (xs: readonly number[], options: readonly number[]): boolean => xs.every((x) => options.includes(x));
const within = (n: number, min: number, max: number): boolean => n >= min && n <= max;
const picks = (xs: readonly number[], options: readonly number[], min: number, max: number): boolean =>
  distinct(xs) && among(xs, options) && within(xs.length, min, max);

/** What is wrong with `reply` to `ask`, or null when it is an answer the question allows. */
function fault(ask: Ask, reply: Reply | null): string | null {
  if (!reply) return ask.k === 'hero' && !ask.heroes.length ? null : 'no answer';
  switch (ask.k) {
    case 'hero':
      return reply.k === 'hero' && ask.heroes.includes(reply.hero) ? null : 'a hero that was not offered';
    case 'confirm':
      return reply.k === 'confirm' && typeof reply.yes === 'boolean' ? null : 'not a yes or a no';
    case 'cards':
      return reply.k === 'cards' && picks(reply.ids, ask.cards, ask.min, ask.max) ? null : 'cards that do not fit';
    case 'seat':
      return reply.k === 'seat' && picks(reply.seats, ask.options, ask.min, ask.max) ? null : 'seats that do not fit';
    case 'area': {
      if (reply.k !== 'area') return 'not a choice of card';
      if (reply.zone === 'hand') return ask.hand > 0 && reply.card === null ? null : 'a hand that is not there';
      const ids = reply.zone === 'equip' ? ask.equip : ask.judges;
      return reply.card !== null && ids.includes(reply.card) ? null : 'a card that is not there';
    }
    default:
      break;
  }
  if (reply.k === 'end') return null;
  if (reply.k === 'use') {
    const offered = ask.uses.find((u) => u.card === reply.card && u.as === reply.as && u.skill === reply.skill);
    if (!offered) return 'a play that was not offered';
    const { options, min, max } = offered.targets;
    return picks(reply.targets, options, min, max) ? null : 'targets that do not fit';
  }
  if (reply.k !== 'skill') return 'not a play';
  const option = ask.skills.find((s) => s.skill === reply.skill);
  if (!option) return 'a skill that was not offered';
  const cards = option.cards
    ? picks(reply.cards, option.cards.ids, option.cards.min, option.cards.max)
    : reply.cards.length === 0;
  const targets = option.targets
    ? picks(reply.targets, option.targets.options, option.targets.min, option.targets.max)
    : reply.targets.length === 0;
  return cards && targets ? null : 'cards or targets that do not fit the skill';
}

describe('the check that an answer fits its question', () => {
  const play: Ask = {
    k: 'play',
    uses: [{ card: 5, as: 'sha', targets: { min: 1, max: 1, options: [1, 4] } }, { card: 6, as: 'sha', skill: 'wusheng', targets: { min: 1, max: 1, options: [1] } }],
    skills: [
      { skill: 'rende', cards: { min: 1, max: 3, ids: [5, 6, 7] }, targets: { min: 1, max: 1, options: [2, 3] } },
      { skill: 'kurou', cards: null, targets: null },
    ],
  };

  it('lets through the answers that fit', () => {
    const fine: [Ask, Reply | null][] = [
      [play, { k: 'end' }],
      [play, { k: 'use', card: 5, as: 'sha', targets: [4] }],
      [play, { k: 'use', card: 6, as: 'sha', skill: 'wusheng', targets: [1] }],
      [play, { k: 'skill', skill: 'rende', cards: [5, 7], targets: [3] }],
      [play, { k: 'skill', skill: 'kurou', cards: [], targets: [] }],
      [{ k: 'hero', heroes: ['liubei', 'guanyu'], lord: false }, { k: 'hero', hero: 'guanyu' }],
      [{ k: 'hero', heroes: [], lord: false }, null],
      [{ k: 'confirm', why: 'luoyi', ctx: {} }, { k: 'confirm', yes: false }],
      [{ k: 'cards', why: 'discard', ctx: {}, cards: [1, 2, 3], min: 1, max: 2 }, { k: 'cards', ids: [3] }],
      [{ k: 'cards', why: 'shan', ctx: {}, cards: [1], min: 0, max: 1 }, { k: 'cards', ids: [] }],
      [{ k: 'seat', why: 'tuxi', ctx: {}, options: [1, 2, 3], min: 0, max: 2 }, { k: 'seat', seats: [3, 1] }],
      [{ k: 'area', why: 'chai', ctx: {}, owner: 1, hand: 2, equip: [8], judges: [9] }, { k: 'area', zone: 'hand', card: null }],
      [{ k: 'area', why: 'chai', ctx: {}, owner: 1, hand: 0, equip: [8], judges: [9] }, { k: 'area', zone: 'judge', card: 9 }],
    ];
    for (const [ask, reply] of fine) expect(fault(ask, reply), JSON.stringify([ask.k, reply])).toBeNull();
  });

  it('stops the answers that do not', () => {
    const bad: [Ask, Reply | null][] = [
      [play, null],
      [play, { k: 'use', card: 5, as: 'sha', targets: [2] }],
      [play, { k: 'use', card: 5, as: 'sha', targets: [] }],
      [play, { k: 'use', card: 5, as: 'sha', targets: [1, 4] }],
      [play, { k: 'use', card: 6, as: 'sha', targets: [1] }],
      [play, { k: 'use', card: 9, as: 'sha', targets: [1] }],
      [play, { k: 'skill', skill: 'rende', cards: [5, 5], targets: [3] }],
      [play, { k: 'skill', skill: 'rende', cards: [9], targets: [3] }],
      [play, { k: 'skill', skill: 'rende', cards: [5], targets: [1] }],
      [play, { k: 'skill', skill: 'kurou', cards: [5], targets: [] }],
      [play, { k: 'skill', skill: 'zhiheng', cards: [5], targets: [] }],
      [{ k: 'hero', heroes: ['liubei'], lord: false }, { k: 'hero', hero: 'guanyu' }],
      [{ k: 'hero', heroes: ['liubei'], lord: false }, null],
      [{ k: 'confirm', why: 'luoyi', ctx: {} }, { k: 'cards', ids: [] }],
      [{ k: 'cards', why: 'discard', ctx: {}, cards: [1, 2, 3], min: 2, max: 2 }, { k: 'cards', ids: [1] }],
      [{ k: 'cards', why: 'discard', ctx: {}, cards: [1, 2, 3], min: 0, max: 1 }, { k: 'cards', ids: [1, 2] }],
      [{ k: 'cards', why: 'discard', ctx: {}, cards: [1, 2, 3], min: 0, max: 2 }, { k: 'cards', ids: [4] }],
      [{ k: 'cards', why: 'discard', ctx: {}, cards: [1, 2, 3], min: 0, max: 2 }, { k: 'cards', ids: [1, 1] }],
      [{ k: 'seat', why: 'tuxi', ctx: {}, options: [1, 2, 3], min: 0, max: 2 }, { k: 'seat', seats: [1, 2, 3] }],
      [{ k: 'seat', why: 'tuxi', ctx: {}, options: [1, 2, 3], min: 0, max: 2 }, { k: 'seat', seats: [4] }],
      [{ k: 'area', why: 'chai', ctx: {}, owner: 1, hand: 0, equip: [8], judges: [9] }, { k: 'area', zone: 'hand', card: null }],
      [{ k: 'area', why: 'chai', ctx: {}, owner: 1, hand: 2, equip: [8], judges: [9] }, { k: 'area', zone: 'equip', card: 9 }],
      [{ k: 'area', why: 'chai', ctx: {}, owner: 1, hand: 2, equip: [8], judges: [9] }, { k: 'area', zone: 'judge', card: null }],
    ];
    for (const [ask, reply] of bad) expect(fault(ask, reply), JSON.stringify([ask.k, reply])).not.toBeNull();
  });
});

// Whole games

interface Watched {
  outcome: Outcome | null;
  entries: Entry[];
  faults: string[];
  asked: Set<string>;
}

/** A game with a bot in every seat, checking each answer before the table gets it. */
async function watched(size: Size, seed: number): Promise<Watched> {
  const random = seeded(seed);
  const roles = shuffle([...ROLE_SETS[size]], random);
  const bots = new Bots(roles, random);
  const entries: Entry[] = [];
  const faults: string[] = [];
  const asked = new Set<string>();
  const outcome = await runSanguosha(
    {
      random,
      ask: async (seat, ask, e) => {
        const reply = bots.answer(seat, ask, e);
        asked.add(ask.k === 'hero' || ask.k === 'play' ? ask.k : `${ask.k}:${ask.why}`);
        const wrong = fault(ask, reply);
        if (wrong) faults.push(`seed ${seed}, seat ${seat}: ${wrong}: ${JSON.stringify(ask)} -> ${JSON.stringify(reply)}`);
        return reply;
      },
      emit: (entry, e) => {
        entries.push(entry);
        bots.observe(entry, e);
      },
      stopped: () => false,
    },
    roles,
  );
  return { outcome, entries, faults, asked };
}

const SEEDS = Number(process.env.SGS_SEEDS ?? 30);

describe.each([5, 8] as const)('bots at a table of %i', (size) => {
  it('only ever give answers that the question allows', async () => {
    const faults: string[] = [];
    const asked = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const game = await watched(size, seed);
      faults.push(...game.faults);
      game.asked.forEach((k) => asked.add(k));
    }
    expect(faults.slice(0, 5)).toEqual([]);
    for (const kind of ['hero', 'play', 'cards:shan', 'cards:discard', 'area:chai']) expect([...asked], kind).toContain(kind);
  }, 120_000);

  it('play the same game again from the same seed', async () => {
    const a = await watched(size, 7);
    const b = await watched(size, 7);
    expect(b.entries).toEqual(a.entries);
    expect(b.entries.length).toBeGreaterThan(50);
    expect((await watched(size, 8)).entries).not.toEqual(a.entries);
  });
});

// How a bot plays, on a table made for the purpose: seat 0 is the lord, 1 his loyalist, 2 and 3 rebels, 4 the traitor.

function table(options: RigOptions = {}, luck = 0) {
  const r = rig(5, options);
  const bots = new Bots(ROLE_SETS[5], () => luck);
  const ask = (seat: number, question: Ask): Reply | null => bots.answer(seat, question, r.e);
  const play = (seat: number): Reply | null =>
    ask(seat, { k: 'play', uses: legalUses(r.e, seat), skills: skillOptions(r.e, seat) });
  const cards = (seat: number, why: CardsWhy, held: readonly Card[], ctx: Ctx = {}, min = 0, max = 1): Reply | null =>
    ask(seat, { k: 'cards', why, ctx, cards: held.map((c) => c.id), min, max });
  /** Lets the bots see something happen without making it happen. */
  const watch = (entry: Entry): void => bots.observe(entry, r.e);
  return { r, bots, ask, play, cards, watch };
}

/** A bot is a plain Zhang Fei, so that no skill of the hero's own gets in the way of what is being looked at. */
const plain = (...seatsOf: number[]): RigOptions['heroes'] =>
  Object.fromEntries(seatsOf.map((s) => [s, 'zhangfei' as HeroId]));

describe('a bot choosing a hero', () => {
  it('takes one of those offered, by its random number', () => {
    const heroes: HeroId[] = ['liubei', 'guanyu', 'zhangfei'];
    const ask: Ask = { k: 'hero', heroes, lord: false };
    expect(table({}, 0).ask(1, ask)).toEqual({ k: 'hero', hero: 'liubei' });
    expect(table({}, 0.5).ask(1, ask)).toEqual({ k: 'hero', hero: 'guanyu' });
    expect(table({}, 0.99).ask(1, ask)).toEqual({ k: 'hero', hero: 'zhangfei' });
    expect(table().ask(1, { k: 'hero', heroes: [], lord: false })).toBeNull();
  });
});

describe('a bot in the play phase', () => {
  it('ends the phase when it has nothing to play', () => {
    const t = table({ turn: 1, heroes: plain(1) });
    expect(t.play(1)).toEqual(end);
    hold(t.r.e, 1, 'shan', 'wuxie');
    expect(t.play(1)).toEqual(end);
  });

  it('holds back a Strike it has no reason to throw, and throws a spare one at someone it cannot read', () => {
    const t = table({ turn: 3, heroes: plain(3) });
    const [sha] = hold(t.r.e, 3, 'sha');
    expect(t.play(3)).toEqual(end);
    hold(t.r.e, 3, 'shan', 'shan', 'shan', 'shan');
    expect(t.play(3)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [2] });
  });

  it('strikes the lord, if it is a rebel and he is in reach', () => {
    const t = table({ turn: 2, heroes: plain(2) });
    wear(t.r.e, 2, 'qinggang');
    const [sha] = hold(t.r.e, 2, 'sha');
    expect(legalUses(t.r.e, 2)[0]?.targets.options).toEqual([0, 1, 3, 4]);
    expect(t.play(2)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [0] });
  });

  it('strikes the weakest of those it knows are against the lord, if it is on his side', () => {
    const t = table({ turn: 1, heroes: plain(1) });
    wear(t.r.e, 1, 'qinggang');
    const [sha] = hold(t.r.e, 1, 'sha');
    expect(legalUses(t.r.e, 1)[0]?.targets.options).toEqual([0, 2, 3, 4]);
    expect(t.play(1)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [2] });
    t.r.e.p(3).hp = 1;
    expect(t.play(1)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [3] });
  });

  it('spares a player it has seen go for the lord, when it is a rebel itself', () => {
    const t = table({ turn: 3, heroes: plain(3) });
    const [sha] = hold(t.r.e, 3, 'sha', 'shan', 'shan', 'shan', 'shan');
    expect(t.play(3)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [2] });
    t.watch({ k: 'use', seat: 2, name: 'sha', cards: [], targets: [0] });
    expect(t.play(3)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [4] });
  });

  it('takes a player who has killed a rebel to be on the lord’s side', () => {
    const t = table({ turn: 3, heroes: plain(3) });
    const [sha] = hold(t.r.e, 3, 'sha', 'shan', 'shan', 'shan', 'shan');
    t.watch({ k: 'die', seat: 1, role: 'rebel', killer: 4 });
    expect(t.play(3)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [4] });
  });

  it('takes a player who has helped the lord to be on his side', () => {
    const t = table({ turn: 3, heroes: plain(3) });
    const [sha] = hold(t.r.e, 3, 'sha', 'shan', 'shan', 'shan', 'shan');
    expect(t.play(3)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [2] });
    t.watch({ k: 'give', seat: 4, to: 0, cards: [] });
    expect(t.play(3)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [4] });
    const saved = table({ turn: 3, heroes: plain(3) });
    const [other] = hold(saved.r.e, 3, 'sha', 'shan', 'shan', 'shan', 'shan');
    saved.watch({ k: 'play', seat: 4, name: 'tao', for: 0, cards: [] });
    expect(saved.play(3)).toEqual({ k: 'use', card: other.id, as: 'sha', targets: [4] });
  });

  it('a traitor lets the lord be while there are others to deal with, and goes for him when they are done', () => {
    const t = table({ turn: 4, heroes: plain(4) });
    const [sha] = hold(t.r.e, 4, 'sha', 'shan', 'shan', 'shan', 'shan');
    expect(legalUses(t.r.e, 4)[0]?.targets.options).toEqual([0, 3]);
    expect(t.play(4)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [3] });
    for (const seat of [1, 2, 3]) t.watch({ k: 'give', seat, to: 0, cards: [] });
    expect(t.play(4)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [0] });
  });

  it('drinks a Peach when it is hurt and has more cards than it can keep, or has two', () => {
    const t = table({ turn: 1, heroes: plain(1) });
    t.r.e.p(1).hp = 3;
    const [tao] = hold(t.r.e, 1, 'tao');
    expect(t.play(1)).toEqual(end);
    hold(t.r.e, 1, 'shan', 'shan', 'shan');
    expect(t.play(1)).toEqual({ k: 'use', card: tao.id, as: 'tao', targets: [] });
    const pair = table({ turn: 1, heroes: plain(1) });
    pair.r.e.p(1).hp = 3;
    const [one] = hold(pair.r.e, 1, 'tao', 'tao');
    expect(pair.play(1)).toEqual({ k: 'use', card: one.id, as: 'tao', targets: [] });
  });

  it('puts on equipment for a free slot, and changes a weapon only for one that reaches farther', () => {
    const t = table({ turn: 1, heroes: plain(1) });
    const [gun] = hold(t.r.e, 1, 'zhuge');
    expect(t.play(1)).toEqual({ k: 'use', card: gun.id, as: 'zhuge', targets: [] });
    const worse = table({ turn: 1, heroes: plain(1) });
    wear(worse.r.e, 1, 'qilin');
    hold(worse.r.e, 1, 'zhuge');
    expect(worse.play(1)).toEqual(end);
    const better = table({ turn: 1, heroes: plain(1) });
    wear(better.r.e, 1, 'zhuge');
    const [bow] = hold(better.r.e, 1, 'qilin');
    expect(better.play(1)).toEqual({ k: 'use', card: bow.id, as: 'qilin', targets: [] });
    const armour = table({ turn: 1, heroes: plain(1) });
    wear(armour.r.e, 1, 'bagua');
    hold(armour.r.e, 1, 'renwang');
    expect(armour.play(1)).toEqual(end);
  });

  it('makes a Strike of a card that is worth little, but not of a Peach', () => {
    const cheap = table({ turn: 2, heroes: { 2: 'guanyu' } });
    wear(cheap.r.e, 2, 'qinggang');
    const [bolt] = hold(cheap.r.e, 2, ['shandian', 'heart', 5]);
    expect(cheap.play(2)).toEqual({ k: 'use', card: bolt.id, as: 'sha', targets: [0], skill: 'wusheng' });
    const dear = table({ turn: 2, heroes: { 2: 'guanyu' } });
    wear(dear.r.e, 2, 'qinggang');
    hold(dear.r.e, 2, ['tao', 'heart', 5]);
    expect(dear.play(2)).toEqual(end);
  });
});

describe('a bot using a skill', () => {
  it('Rende: gives the two cards it values least to the lord, when it is on his side and has three', () => {
    const t = table({ turn: 1, heroes: { 1: 'liubei' } });
    const [a, b] = hold(t.r.e, 1, 'shan', 'shan', 'wuxie');
    expect(t.play(1)).toEqual({ k: 'skill', skill: 'rende', cards: [a.id, b.id], targets: [0] });
    const few = table({ turn: 1, heroes: { 1: 'liubei' } });
    hold(few.r.e, 1, 'shan', 'wuxie');
    expect(few.play(1)).toEqual(end);
  });

  it('Rende: gives to no one it takes for an enemy', () => {
    const t = table({ turn: 3, heroes: { 3: 'liubei' } });
    hold(t.r.e, 3, 'shan', 'shan', 'wuxie');
    expect(t.play(3)).toEqual(end);
  });

  it('Zhiheng: throws away Dodges beyond the second', () => {
    const t = table({ turn: 1, heroes: { 1: 'sunquan' } });
    const [, , c, d] = hold(t.r.e, 1, 'shan', 'shan', 'shan', 'shan');
    expect(t.play(1)).toEqual({ k: 'skill', skill: 'zhiheng', cards: [c.id, d.id], targets: [] });
    const two = table({ turn: 1, heroes: { 1: 'sunquan' } });
    hold(two.r.e, 1, 'shan', 'shan');
    expect(two.play(1)).toEqual(end);
  });

  it('Zhiheng: throws away what is worth little, four cards at most, and keeps the rest', () => {
    // With a Qilin Bow on, a Guanshi Axe is of no use to wear, so it is the Axes that go.
    const t = table({ turn: 1, heroes: { 1: 'sunquan' } });
    wear(t.r.e, 1, 'qilin');
    const axes = hold(t.r.e, 1, 'guanshi', 'guanshi', 'guanshi', 'guanshi', 'guanshi', 'shan', 'wuxie');
    expect(t.play(1)).toEqual({ k: 'skill', skill: 'zhiheng', cards: axes.slice(0, 4).map((c) => c.id), targets: [] });
  });

  it('Kurou: at most twice in a turn, and only while it is safe', () => {
    const t = table({ turn: 1, heroes: { 1: 'huanggai' } });
    const kurou: Reply = { k: 'skill', skill: 'kurou', cards: [], targets: [] };
    expect([t.play(1), t.play(1), t.play(1)]).toEqual([kurou, kurou, end]);
    t.watch({ k: 'turn', seat: 1 });
    expect(t.play(1)).toEqual(kurou);
    const low = table({ turn: 1, heroes: { 1: 'huanggai' } });
    low.r.e.p(1).hp = 2;
    expect(low.play(1)).toEqual(end);
    hold(low.r.e, 1, 'tao');
    expect(low.play(1)).toEqual(kurou);
  });

  it('Qingnang: heals a friend, with the card it values least', () => {
    const t = table({ turn: 1, heroes: { 1: 'huatuo' } });
    const [shan] = hold(t.r.e, 1, 'shan', 'wuxie');
    expect(t.play(1)).toEqual(end);
    t.r.e.p(0).hp = 2;
    expect(t.play(1)).toEqual({ k: 'skill', skill: 'qingnang', cards: [shan.id], targets: [0] });
  });

  it('Qingnang: puts a friend in danger before taking a card off an enemy, but a friend only hurt after', () => {
    const t = table({ turn: 1, heroes: { 1: 'huatuo' } });
    const [shan, chai] = hold(t.r.e, 1, 'shan', 'chai');
    hold(t.r.e, 2, 'shan');
    t.r.e.p(0).hp = 3;
    expect(t.play(1)).toEqual({ k: 'use', card: chai.id, as: 'chai', targets: [2] });
    t.r.e.p(0).hp = 2;
    expect(t.play(1)).toEqual({ k: 'skill', skill: 'qingnang', cards: [shan.id], targets: [0] });
  });
});

describe('a bot asked for a card', () => {
  it('plays a Dodge it can, keeps one that would not be enough, and has none to play with none', () => {
    const t = table();
    const [shan, other] = hold(t.r.e, 1, 'shan', 'shan');
    expect(t.cards(1, 'shan', [shan])).toEqual(pick(shan));
    expect(t.cards(1, 'shan', [shan], { need: 2 })).toEqual(pick());
    expect(t.cards(1, 'shan', [shan, other], { need: 2 })).toEqual(pick(shan));
    expect(t.cards(1, 'shan', [])).toEqual(pick());
  });

  it('answers a Duel with its Strike when its life is at stake, or it has two', () => {
    const t = table();
    const [a, b] = hold(t.r.e, 1, 'sha', 'sha');
    hold(t.r.e, 2, 'sha', 'sha', 'sha', 'sha', 'sha');
    const duel = { from: 2, name: 'juedou' } as const;
    expect(t.cards(1, 'sha', [a], duel)).toEqual(pick());
    expect(t.cards(1, 'sha', [a, b], duel)).toEqual(pick(a));
    t.r.e.p(1).hp = 2;
    expect(t.cards(1, 'sha', [a], duel)).toEqual(pick(a));
  });

  it('saves itself with a Peach, a friend too, but not the lord if it is a rebel', () => {
    // Out of luck, so that only whose side it is on can make a difference.
    const t = table({}, 0.99);
    const [tao] = hold(t.r.e, 3, 'tao');
    expect(t.cards(3, 'tao', [tao], { target: 3 })).toEqual(pick(tao));
    expect(t.cards(3, 'tao', [tao], { target: 0 })).toEqual(pick());
    const [mine] = hold(t.r.e, 1, 'tao');
    expect(t.cards(1, 'tao', [mine], { target: 0 })).toEqual(pick(mine));
  });

  it('saves a player it cannot read only now and then, three times in ten', () => {
    for (const [luck, saved] of [[0, true], [0.29, true], [0.3, false], [0.99, false]] as const) {
      const t = table({}, luck);
      const [tao] = hold(t.r.e, 3, 'tao');
      expect(t.cards(3, 'tao', [tao], { target: 4 }), `luck ${luck}`).toEqual(saved ? pick(tao) : pick());
    }
  });

  it('cancels a trick against the lord if it is on his side, and a rebel lets it through', () => {
    const t = table();
    const [mine] = hold(t.r.e, 1, 'wuxie');
    const [theirs] = hold(t.r.e, 3, 'wuxie');
    const duel = { name: 'juedou', from: 2, target: 0 } as const;
    expect(t.cards(1, 'wuxie', [mine], { ...duel, on: true })).toEqual(pick(mine));
    expect(t.cards(3, 'wuxie', [theirs], { ...duel, on: true })).toEqual(pick());
    expect(t.cards(1, 'wuxie', [mine], { ...duel, on: false })).toEqual(pick());
    expect(t.cards(3, 'wuxie', [theirs], { ...duel, on: false })).toEqual(pick(theirs));
  });

  it('cancels the lord’s Windfall if it is a rebel, and not if it is on his side', () => {
    const t = table();
    const [mine] = hold(t.r.e, 1, 'wuxie');
    const [theirs] = hold(t.r.e, 3, 'wuxie');
    const windfall = { name: 'wuzhong', from: 0, on: true } as const;
    expect(t.cards(3, 'wuxie', [theirs], windfall)).toEqual(pick(theirs));
    expect(t.cards(1, 'wuxie', [mine], windfall)).toEqual(pick());
  });

  it('throws away what it values least, and keeps its Peaches to the last', () => {
    const t = table();
    const [tao, windfall, sha, horse, bolt] = hold(t.r.e, 1, 'tao', 'wuzhong', 'sha', 'dilu', 'shandian');
    const held = [tao, windfall, sha, horse, bolt];
    expect(t.cards(1, 'discard', held, { amount: 3 }, 3, 3)).toEqual(pick(bolt, horse, sha));
    expect(t.cards(1, 'discard', held, { amount: 5 }, 5, 5)).toEqual(pick(bolt, horse, sha, windfall, tao));
  });

  it('pays for Ganglie only when it is near death or has plenty', () => {
    const t = table();
    const [shan, sha, tao] = hold(t.r.e, 3, 'shan', 'sha', 'tao');
    expect(t.cards(3, 'ganglie', [shan, sha, tao], { from: 1 }, 0, 2)).toEqual(pick());
    t.r.e.p(3).hp = 1;
    expect(t.cards(3, 'ganglie', [shan, sha, tao], { from: 1 }, 0, 2)).toEqual(pick(sha, shan));
    const rich = table();
    const many = hold(rich.r.e, 3, 'shan', 'shan', 'shan', 'shan', 'shan');
    expect(rich.cards(3, 'ganglie', many, { from: 1 }, 0, 2)).toEqual(pick(many[0], many[1]));
    expect(rich.cards(3, 'ganglie', many.slice(0, 1), { from: 1 }, 0, 2)).toEqual(pick());
  });

  it('pays for Guanshi to finish off an enemy, or when it has cards to spare, and never against one it cannot read', () => {
    const t = table();
    const [a, b, c] = hold(t.r.e, 3, 'dilu', 'sha', 'tao');
    expect(t.cards(3, 'guanshi', [a, b, c], { target: 0 }, 0, 2)).toEqual(pick());
    t.r.e.p(0).hp = 1;
    expect(t.cards(3, 'guanshi', [a, b, c], { target: 0 }, 0, 2)).toEqual(pick(a, b));
    t.r.e.p(1).hp = 1;
    expect(t.cards(3, 'guanshi', [a, b, c], { target: 1 }, 0, 2)).toEqual(pick());
    t.r.e.p(0).hp = 5;
    hold(t.r.e, 3, 'shan', 'shan', 'shan');
    expect(t.cards(3, 'guanshi', t.r.e.p(3).hand, { target: 0 }, 0, 2)).toEqual(pick(a, b));
  });

  it('follows up a Strike with its weapon only against an enemy', () => {
    const t = table();
    const [sha] = hold(t.r.e, 3, 'sha');
    expect(t.cards(3, 'qinglong', [sha], { target: 0 })).toEqual(pick(sha));
    expect(t.cards(3, 'qinglong', [sha], { target: 2 })).toEqual(pick());
    expect(t.cards(3, 'qilin', [sha], { target: 0 })).toEqual(pick(sha));
    expect(t.cards(1, 'qilin', [sha], { target: 0 })).toEqual(pick());
  });

  it('puts back the cards of Guanxing that are not worth keeping on top', () => {
    const t = table();
    const [tao, horse, windfall, bolt, sha] = hold(t.r.e, 1, 'tao', 'dilu', 'wuzhong', 'shandian', 'sha');
    expect(t.cards(1, 'guanxing', [tao, horse, windfall, bolt, sha], {}, 0, 5)).toEqual(pick(bolt, horse));
  });
});

describe('a bot changing a judgement with Guicai', () => {
  const lebu = (flip: Card) => ({ k: 'judge', seat: 0, card: info(flip), why: 'lebu' }) as const;

  it('puts a hand card in place of a bad flip for a friend, with the card it values less', () => {
    const t = table();
    const [flip, hearts, dear] = hold(t.r.e, 0, ['sha', 'spade', 5], ['sha', 'heart', 5], ['tao', 'heart', 5]);
    t.watch(lebu(flip));
    expect(t.cards(1, 'guicai', [dear, hearts], { target: 0, card: info(flip) })).toEqual(pick(hearts));
    expect(t.cards(1, 'guicai', [dear], { target: 0, card: info(flip) })).toEqual(pick());
  });

  it('leaves a flip that is good for a friend alone', () => {
    const t = table();
    const [flip, swap] = hold(t.r.e, 0, ['sha', 'heart', 3], ['sha', 'heart', 5]);
    t.watch(lebu(flip));
    expect(t.cards(1, 'guicai', [swap], { target: 0, card: info(flip) })).toEqual(pick());
  });

  it('spoils a good flip for an enemy', () => {
    const t = table();
    const [flip, spoil, same] = hold(t.r.e, 0, ['sha', 'heart', 3], ['sha', 'spade', 5], ['sha', 'heart', 9]);
    t.watch(lebu(flip));
    expect(t.cards(3, 'guicai', [same, spoil], { target: 0, card: info(flip) })).toEqual(pick(spoil));
  });

  it('does nothing for a judgement it has not seen, or one of a player it cannot read', () => {
    const t = table();
    const [flip, swap] = hold(t.r.e, 0, ['sha', 'spade', 5], ['sha', 'heart', 5]);
    expect(t.cards(1, 'guicai', [swap], { target: 0, card: info(flip) })).toEqual(pick());
    t.watch({ k: 'judge', seat: 4, card: info(flip), why: 'lebu' });
    expect(t.cards(3, 'guicai', [swap], { target: 4, card: info(flip) })).toEqual(pick());
  });
});

describe('a bot asked to choose a seat or a card to take', () => {
  it('Tuxi: takes only from those it knows for enemies, the ones with most cards first', () => {
    const t = table();
    hold(t.r.e, 1, 'sha', 'sha');
    const ask: Ask = { k: 'seat', why: 'tuxi', ctx: {}, options: [0, 1, 2, 4], min: 0, max: 2 };
    expect(t.ask(3, ask)).toEqual(seats(0));
    t.watch({ k: 'give', seat: 1, to: 0, cards: [] });
    expect(t.ask(3, ask)).toEqual(seats(1, 0));
  });

  it('frees a friend of a delayed trick before anything else', () => {
    const t = table();
    const bolt = plant(t.r.e, 0, 'lebu');
    expect(t.ask(1, { k: 'area', why: 'chai', ctx: {}, owner: 0, hand: 2, equip: [], judges: [bolt.id] })).toEqual(area('judge', bolt));
  });

  it('takes the weapon of an enemy with no hand, and takes from a hand rather than a poor piece of gear', () => {
    const t = table();
    const gun = wear(t.r.e, 0, 'zhuge');
    expect(t.ask(3, { k: 'area', why: 'shun', ctx: {}, owner: 0, hand: 0, equip: [gun.id], judges: [] })).toEqual(area('equip', gun));
    const horse = wear(t.r.e, 2, 'dilu');
    expect(t.ask(3, { k: 'area', why: 'shun', ctx: {}, owner: 0, hand: 2, equip: [horse.id], judges: [] })).toEqual(area('hand'));
  });

  it('takes a good weapon from an enemy who has a hand too, six times in ten', () => {
    for (const [luck, zone] of [[0, 'equip'], [0.59, 'equip'], [0.6, 'hand'], [0.99, 'hand']] as const) {
      const t = table({}, luck);
      const gun = wear(t.r.e, 0, 'zhuge');
      const reply = t.ask(3, { k: 'area', why: 'chai', ctx: {}, owner: 0, hand: 2, equip: [gun.id], judges: [] });
      expect(reply, `luck ${luck}`).toEqual(zone === 'equip' ? area('equip', gun) : area('hand'));
    }
  });

  it('says yes to what it is asked to do, except Luoyi, which it wants only with a Strike or a Duel in hand', () => {
    const t = table({ heroes: { 1: 'xuchu' } });
    const luoyi: Ask = { k: 'confirm', why: 'luoyi', ctx: {} };
    expect(t.ask(1, luoyi)).toEqual(no);
    hold(t.r.e, 1, 'shan', 'tao');
    expect(t.ask(1, luoyi)).toEqual(no);
    hold(t.r.e, 1, 'sha');
    expect(t.ask(1, luoyi)).toEqual(yes);
    const duel = table({ heroes: { 1: 'xuchu' } });
    hold(duel.r.e, 1, 'juedou');
    expect(duel.ask(1, luoyi)).toEqual(yes);
    for (const why of ['luoshen', 'bagua'] as const) expect(t.ask(1, { k: 'confirm', why, ctx: {} })).toEqual(yes);
  });
});
