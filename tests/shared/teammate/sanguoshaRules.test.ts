import { describe, expect, it } from 'vitest';
import type { Card, Suit } from '../../../src/shared/teammate/sanguoshaCards';
import { HERO_IDS, HEROES } from '../../../src/shared/teammate/sanguoshaHeroes';
import { MAX_TURNS } from '../../../src/shared/teammate/sanguoshaRun';
import {
  ROLE_SETS, SIZES, equipOf, freshFlags, isSize, sideOf, type Entry, type Flags, type Reply,
} from '../../../src/shared/teammate/sanguoshaTypes';
import { actUse, legalUses } from '../../../src/shared/teammate/sanguoshaUse';
import { tableView } from '../../../src/shared/teammate/sanguoshaView';
import {
  area, become, end, first, game, hold, info, no, out, over, pick, plant, rig, stack, use, wear, yes,
  type Asked, type Rig, type Spec,
} from './sanguoshaRig';

const heroAsks = (asked: Asked[]) =>
  asked.flatMap(({ seat, ask }) => (ask.k === 'hero' ? [{ seat, heroes: ask.heroes, lord: ask.lord }] : []));
const turnsOf = (log: Entry[]): number[] => log.flatMap((en) => (en.k === 'turn' ? [en.seat] : []));
const endOfTurn = (en: Entry): boolean => en.k === 'phase' && en.phase === 'end';

/** Plays a Strike from `from` (a spade 5 unless told) at `to`, which the table must accept. */
async function strike(r: Rig, suit: Suit = 'spade', from = 0, to = 1): Promise<Card> {
  const [sha] = hold(r.e, from, ['sha', suit, 5]);
  expect(await use(r, from, sha, 'sha', [to])).toBe(true);
  return sha;
}

describe('the roles', () => {
  it('are a lord, a loyalist, two rebels and a traitor at five seats, and two loyalists and four rebels at eight', () => {
    expect(ROLE_SETS[5]).toEqual(['lord', 'loyalist', 'rebel', 'rebel', 'traitor']);
    expect(ROLE_SETS[8]).toEqual(['lord', 'loyalist', 'loyalist', 'rebel', 'rebel', 'rebel', 'rebel', 'traitor']);
    expect(SIZES).toEqual([5, 8]);
    expect([5, 8, 6, '5', null].map(isSize)).toEqual([true, true, false, false, false]);
  });

  it('put the lord and his loyalists on one side, and the rebels and the traitor each on their own', () => {
    expect(['lord', 'loyalist', 'rebel', 'traitor'].map((r) => sideOf(r as 'lord'))).toEqual(['lord', 'lord', 'rebel', 'traitor']);
  });
});

describe('beginning a game', () => {
  it.each(SIZES)('offers the lord five heroes and each of the others three, in seat order and never a taken one (%i seats)', async (size) => {
    const g = await game({ size, until: (en) => en.k === 'turn' });
    const asks = heroAsks(g.asked);
    expect(g.log[0]).toEqual({ k: 'start', size });
    expect(asks.map((a) => a.seat)).toEqual([...Array(size).keys()]);
    expect(asks.map((a) => a.lord)).toEqual(asks.map((_, i) => i === 0));
    expect(asks.map((a) => a.heroes.length)).toEqual(asks.map((_, i) => (i === 0 ? 5 : 3)));
    asks.forEach((a, i) => {
      expect(new Set(a.heroes).size, `seat ${i}`).toBe(a.heroes.length);
      for (const b of asks.slice(0, i)) expect(a.heroes, `seat ${i}`).not.toContain(b.heroes[0]);
      expect(g.e.p(i).hero, `seat ${i}`).toBe(a.heroes[0]);
    });
  });

  it('takes the first hero offered when the answer names another, or is no hero at all', async () => {
    const g = await game({
      script: (seat, ask) => {
        if (ask.k !== 'hero') return null;
        if (seat === 0) return { k: 'hero', hero: HERO_IDS.find((h) => !ask.heroes.includes(h)) ?? 'liubei' };
        if (seat === 1) return { k: 'hero', hero: ask.heroes[1] ?? 'liubei' };
        return pick();
      },
      until: (en) => en.k === 'turn',
    });
    const asks = heroAsks(g.asked);
    expect(g.e.players.map((p) => p.hero)).toEqual([
      asks[0]?.heroes[0], asks[1]?.heroes[1], asks[2]?.heroes[0], asks[3]?.heroes[0], asks[4]?.heroes[0],
    ]);
  });

  it('gives each player the hit points of his hero, and the lord one more', async () => {
    const g = await game({ size: 8, until: (en) => en.k === 'turn' });
    for (const p of g.e.players) {
      const hero = p.hero;
      expect(hero, `seat ${p.seat}`).not.toBeNull();
      if (hero) expect(p.maxHp, `seat ${p.seat}`).toBe(HEROES[hero].hp + (p.role === 'lord' ? 1 : 0));
      expect(p.hp).toBe(p.maxHp);
    }
  });

  it('deals four cards to each player, the lord first, once everyone has a hero', async () => {
    const g = await game({ until: (en) => en.k === 'turn' });
    const kinds = g.log.map((en) => en.k);
    expect(g.log.flatMap((en) => (en.k === 'draw' ? [[en.seat, en.n]] : []))).toEqual([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
    expect(kinds.lastIndexOf('hero')).toBeLessThan(kinds.indexOf('draw'));
    expect(g.e.players.map((p) => p.hand.length)).toEqual([4, 4, 4, 4, 4]);
  });

  it('lets the lord play first and then each seat still in the game, in order', async () => {
    const g = await game({ stage: (e) => out(e, 2), until: (en, e) => en.k === 'turn' && e.turns === 6 });
    expect(turnsOf(g.log)).toEqual([0, 1, 3, 4, 0, 1]);
  });

  it('plays a turn in six phases', async () => {
    const g = await game({ until: (en) => en.k === 'turn' && en.seat === 1 });
    expect(g.log.flatMap((en) => (en.k === 'phase' ? [`${en.seat}:${en.phase}`] : []))).toEqual([
      '0:start', '0:judge', '0:draw', '0:play', '0:discard', '0:end',
    ]);
  });

  it('draws two cards for the draw phase', async () => {
    const g = await game({ stage: (e) => become(e, 0, 'liubei'), until: (en) => en.k === 'phase' && en.phase === 'play' });
    const i = g.log.findIndex((en) => en.k === 'phase' && en.phase === 'draw');
    expect(g.log[i + 1]).toMatchObject({ k: 'draw', seat: 0, n: 2 });
    expect(g.e.p(0).hand).toHaveLength(6);
  });

  it('is called off with no winner after 600 turns that hurt nobody', async () => {
    const g = await game();
    expect(g.outcome).toEqual({ winner: null, turns: MAX_TURNS });
    expect(g.log.at(-1)).toEqual({ k: 'end', winner: null });
    expect(MAX_TURNS).toBe(600);
  }, 60_000);

  it('stops with no outcome, and no last entry, when nobody is watching any more', async () => {
    const g = await game({ until: (en, e) => en.k === 'turn' && e.turns === 3 });
    expect(g.outcome).toBeNull();
    expect(g.log.some((en) => en.k === 'end')).toBe(false);
  });
});

describe('the turn: the play phase and the discard phase', () => {
  const bad: Reply = { k: 'use', card: 99999, as: 'sha', targets: [1] };
  const liubei = (e: Parameters<typeof become>[0]): void => become(e, 0, 'liubei');

  it('asks no one who has nothing to play', async () => {
    const g = await game({
      stage: (e) => {
        become(e, 0, 'zhangfei');
        e.p(0).hand = [];
        hold(e, 0, 'shan');
        stack(e, 'shan', 'wuxie');
      },
      until: endOfTurn,
    });
    expect(g.asked.filter((a) => a.seat === 0 && a.ask.k === 'play')).toEqual([]);
    expect(g.log.some((en) => en.k === 'phase' && en.phase === 'play')).toBe(true);
  });

  it('ends the phase on an answer to end it, and asks no more', async () => {
    const g = await game({
      stage: liubei,
      script: (seat, ask) => (seat === 0 && ask.k === 'play' ? end : null),
      until: endOfTurn,
    });
    expect(g.asked.filter((a) => a.seat === 0 && a.ask.k === 'play')).toHaveLength(1);
  });

  it('ends the phase after three answers in a row that cannot be played', async () => {
    const g = await game({
      stage: liubei,
      script: (seat, ask) => (seat === 0 && ask.k === 'play' ? bad : null),
      until: endOfTurn,
    });
    expect(g.asked.filter((a) => a.seat === 0 && a.ask.k === 'play')).toHaveLength(3);
    expect(g.log.some((en) => en.k === 'use')).toBe(false);
  });

  it('counts the three again from a play that works', async () => {
    let n = 0;
    const g = await game({
      stage: liubei,
      script: (seat, ask) => {
        if (seat !== 0 || ask.k !== 'play') return null;
        n += 1;
        const rende = ask.skills.find((s) => s.skill === 'rende');
        return n === 3 && rende?.cards ? { k: 'skill', skill: 'rende', cards: rende.cards.ids.slice(0, 1), targets: [1] } : bad;
      },
      until: endOfTurn,
    });
    expect(g.asked.filter((a) => a.seat === 0 && a.ask.k === 'play')).toHaveLength(6);
    expect(g.log.filter((en) => en.k === 'give')).toHaveLength(1);
  });

  it('makes a player discard down to his hit points, of the cards he chooses', async () => {
    const g = await game({
      stage: (e) => {
        liubei(e);
        e.p(0).hp = 2;
      },
      script: (_seat, ask) => (ask.k === 'cards' && ask.why === 'discard' ? { k: 'cards', ids: ask.cards.slice(-4) } : null),
      until: endOfTurn,
    });
    const asks = g.asked.filter((a) => a.ask.k === 'cards' && a.ask.why === 'discard');
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ seat: 0, ask: { ctx: { amount: 4 }, min: 4, max: 4 } });
    expect(g.e.p(0).hand).toHaveLength(2);
    expect(g.log.filter((en) => en.k === 'discard')).toHaveLength(1);
  });

  it('takes the first cards of the hand when the answer does not fit', async () => {
    const g = await game({
      stage: (e) => {
        liubei(e);
        e.p(0).hp = 3;
      },
      script: (_seat, ask) => (ask.k === 'cards' && ask.why === 'discard' ? pick() : null),
      until: endOfTurn,
    });
    expect(g.e.p(0).hand).toHaveLength(3);
  });

  it('asks for no discard when the hand fits', async () => {
    const g = await game({
      stage: (e) => {
        liubei(e);
        e.p(0).hand = [];
      },
      until: endOfTurn,
    });
    expect(g.asked.some((a) => a.ask.k === 'cards' && a.ask.why === 'discard')).toBe(false);
    expect(g.log.some((en) => en.k === 'discard')).toBe(false);
  });

  it('starts each turn from a clean slate, whatever the turn before had set', async () => {
    let turns = 0;
    let atSecond: Flags | undefined;
    await game({
      stage: (e) => {
        Object.assign(e.flags, {
          sha: 3, given: 4, zhiheng: true, qingnang: true, luoyi: true, shaPlayed: true, skipPlay: true, skipDraw: true,
        });
      },
      until: (en, e) => {
        if (en.k !== 'turn') return false;
        turns += 1;
        if (turns === 2) atSecond = { ...e.flags };
        return turns === 2;
      },
    });
    expect(atSecond).toEqual(freshFlags());
  });

  it('skips the draw and play phases of a turn whose flags say so, and says it did', async () => {
    const g = await game({
      stage: (e) => {
        e.flags.skipDraw = true;
        e.flags.skipPlay = true;
      },
      until: endOfTurn,
    });
    expect(g.log.filter((en) => en.k === 'skip')).toEqual([
      { k: 'skip', seat: 0, phase: 'draw' },
      { k: 'skip', seat: 0, phase: 'play' },
    ]);
    const turnLog = g.log.slice(g.log.findIndex((en) => en.k === 'turn'));
    expect(turnLog.some((en) => en.k === 'draw')).toBe(false);
    expect(g.asked.some((a) => a.ask.k === 'play')).toBe(false);
  });
});

describe('distance and reach', () => {
  it('is the number of seats between two players, the shorter way round', () => {
    const five = rig(5);
    expect([1, 2, 3, 4].map((s) => five.e.distance(0, s))).toEqual([1, 2, 2, 1]);
    expect(five.e.distance(0, 0)).toBe(0);
    const eight = rig(8);
    expect([1, 2, 3, 4, 5, 6, 7].map((s) => eight.e.distance(0, s))).toEqual([1, 2, 3, 4, 3, 2, 1]);
    expect(eight.e.distance(6, 1)).toBe(3);
  });

  it('does not count the seats of players who are out', () => {
    const r = rig(5);
    expect(r.e.distance(0, 2)).toBe(2);
    out(r.e, 1);
    expect(r.e.distance(0, 2)).toBe(1);
    expect(r.e.distance(4, 2)).toBe(2);
  });

  it('grows by one with the +1 horse of the one aimed at, and shrinks by one with the -1 horse of the one aiming, but not below one', () => {
    const r = rig(5);
    wear(r.e, 1, 'dilu');
    expect(r.e.distance(0, 1)).toBe(2);
    expect(r.e.distance(1, 0)).toBe(1);
    wear(r.e, 0, 'chitu');
    expect([1, 2, 3, 4].map((s) => r.e.distance(0, s))).toEqual([1, 1, 1, 1]);
  });

  it('shrinks by one for Ma Chao, who rides well', () => {
    const r = rig(5);
    become(r.e, 0, 'machao');
    expect([2, 3].map((s) => r.e.distance(0, s))).toEqual([1, 1]);
    expect(r.e.distance(2, 0)).toBe(2);
  });

  it('is matched by the reach of a weapon, one seat with none', () => {
    const r = rig(8);
    expect(r.e.range(0)).toBe(1);
    const reach: [Spec, number][] = [['zhuge', 1], ['qinggang', 2], ['qinglong', 3], ['guanshi', 3], ['fangtian', 4], ['qilin', 5]];
    for (const [weapon, n] of reach) {
      wear(r.e, 0, weapon);
      expect(r.e.range(0), String(weapon)).toBe(n);
    }
    expect([2, 3, 4, 5, 6].map((s) => r.e.inRange(0, s))).toEqual([true, true, true, true, true]);
    wear(r.e, 0, 'qinglong');
    expect([2, 3, 4, 5].map((s) => r.e.inRange(0, s))).toEqual([true, true, false, true]);
  });
});

describe('a Strike', () => {
  it('may be aimed at one player within reach', () => {
    const r = rig(5);
    const [sha] = hold(r.e, 0, 'sha');
    expect(legalUses(r.e, 0)).toEqual([{ card: sha.id, as: 'sha', targets: { min: 1, max: 1, options: [1, 4] } }]);
    wear(r.e, 0, 'qinggang');
    expect(legalUses(r.e, 0)[0]?.targets.options).toEqual([1, 2, 3, 4]);
  });

  it('may be played once in a turn', async () => {
    const r = rig();
    const [, spare] = hold(r.e, 0, 'sha', 'sha');
    await strike(r);
    expect(r.e.flags.sha).toBe(1);
    expect(legalUses(r.e, 0)).toEqual([]);
    expect(await use(r, 0, spare, 'sha', [1])).toBe(false);
  });

  it('may be played any number of times with a Zhuge crossbow, or by Zhang Fei', async () => {
    const r = rig();
    wear(r.e, 0, 'zhuge');
    await strike(r);
    await strike(r);
    expect(r.entries('use')).toHaveLength(2);
    const p = rig();
    become(p.e, 0, 'zhangfei');
    await strike(p);
    await strike(p);
    expect(p.entries('use')).toHaveLength(2);
  });

  it('does not count against the turn when it is played in answer, in a duel', async () => {
    const r = rig();
    const [duel] = hold(r.e, 1, 'juedou');
    hold(r.e, 0, 'sha');
    r.answer(0, 'sha', first);
    r.e.turn = 1;
    expect(await use(r, 1, duel, 'juedou', [0])).toBe(true);
    expect(r.entries('play').map((p) => p.seat)).toEqual([0]);
    expect(r.e.flags.sha).toBe(0);
  });

  it('is dodged by a Dodge, which only a player who holds one is asked for', async () => {
    const r = rig();
    const [shan] = hold(r.e, 1, 'shan');
    r.answer(1, 'shan', first);
    const sha = await strike(r);
    expect(r.asks('shan')).toEqual([
      { seat: 1, ask: { k: 'cards', why: 'shan', ctx: { from: 0, name: 'sha', need: 1 }, cards: [shan.id], min: 0, max: 1 } },
    ]);
    expect(r.entries('play')).toEqual([{ k: 'play', seat: 1, name: 'shan', cards: [info(shan)] }]);
    expect(r.entries('damage')).toEqual([]);
    expect(r.e.p(1).hp).toBe(4);
    expect(r.e.trash).toEqual(expect.arrayContaining([shan, sha]));
  });

  it('hurts a player who holds no Dodge, without asking him', async () => {
    const r = rig();
    await strike(r);
    expect(r.asks('shan')).toEqual([]);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
    expect(r.e.p(1).hp).toBe(3);
  });

  it.each([
    ['plays none', null],
    ['names a card that was not offered', pick({ id: 12345, name: 'shan', suit: 'heart', rank: 2 })],
    ['plays too many', pick({ id: 12345, name: 'shan', suit: 'heart', rank: 2 }, { id: 12346, name: 'shan', suit: 'heart', rank: 3 })],
  ] as const)('hurts a player who holds a Dodge and %s', async (_why, reply) => {
    const r = rig();
    const [shan] = hold(r.e, 1, 'shan');
    r.answer(1, 'shan', reply);
    await strike(r);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
    expect(r.e.p(1).hand).toEqual([shan]);
  });
});

describe('Peach', () => {
  it('may be played by a player who is hurt, and heals him one hit point', async () => {
    const r = rig();
    const [tao] = hold(r.e, 0, 'tao');
    expect(legalUses(r.e, 0)).toEqual([]);
    r.e.p(0).hp = 3;
    expect(legalUses(r.e, 0)).toEqual([{ card: tao.id, as: 'tao', targets: { min: 0, max: 0, options: [] } }]);
    await use(r, 0, tao);
    expect(r.e.p(0).hp).toBe(4);
    expect(r.entries('heal')).toEqual([{ k: 'heal', seat: 0, n: 1 }]);
    expect(r.e.trash).toEqual([tao]);
  });

  it('never heals past the hit points a hero has, and heals nobody who is out', async () => {
    const r = rig();
    r.e.p(2).hp = 3;
    await r.e.heal(2, 5);
    expect(r.e.p(2).hp).toBe(4);
    await r.e.heal(2, 1);
    out(r.e, 3);
    await r.e.heal(3, 1);
    expect(r.entries('heal')).toEqual([{ k: 'heal', seat: 2, n: 1 }]);
    expect(r.e.p(3).hp).toBe(0);
  });
});

describe('a player at death’s door', () => {
  it('may be saved by a Peach from anyone, asked in turn order from the one whose turn it is', async () => {
    const r = rig(5, { turn: 2 });
    const [mine] = hold(r.e, 1, 'tao');
    const [theirs] = hold(r.e, 4, 'tao');
    r.e.p(1).hp = 1;
    r.answer(4, 'tao', first);
    r.answer(1, 'tao', first);
    await strike(r, 'spade', 2, 1);
    expect(r.asks('tao')).toEqual([
      { seat: 4, ask: { k: 'cards', why: 'tao', ctx: { target: 1 }, cards: [theirs.id], min: 0, max: 1 } },
    ]);
    expect(r.entries('play')).toMatchObject([{ seat: 4, name: 'tao', for: 1 }]);
    expect(r.e.p(1)).toMatchObject({ hp: 1, alive: true });
    expect(r.e.p(1).hand).toEqual([mine]);
  });

  it('may be saved by his own Peach', async () => {
    const r = rig(5, { turn: 2 });
    const [mine] = hold(r.e, 1, 'tao');
    r.e.p(1).hp = 1;
    r.answer(1, 'tao', first);
    await strike(r, 'spade', 2, 1);
    expect(r.asks('tao').map((a) => a.seat)).toEqual([1]);
    expect(r.e.p(1).hp).toBe(1);
    expect(r.e.trash).toContain(mine);
  });

  it('needs as many Peaches as he is below one, and asks again until he has them or nobody will play one', async () => {
    const r = rig(5, { turn: 2 });
    hold(r.e, 4, 'tao');
    hold(r.e, 0, 'tao');
    r.e.p(1).hp = 1;
    r.answer(4, 'tao', first);
    r.answer(0, 'tao', first);
    await r.e.damage(1, 2, 2);
    expect(r.asks('tao').map((a) => a.seat)).toEqual([4, 0]);
    expect(r.e.p(1)).toMatchObject({ hp: 1, alive: true });
  });

  it('is not asked again for the same Peach by a player who said no', async () => {
    const r = rig(5, { turn: 2 });
    hold(r.e, 3, 'tao');
    hold(r.e, 4, 'tao');
    r.e.p(1).hp = 1;
    r.answer(3, 'tao', null);
    r.answer(4, 'tao', first);
    await r.e.damage(1, 1, 2);
    expect(r.asks('tao').map((a) => a.seat)).toEqual([3, 4]);
    expect(r.e.p(1).alive).toBe(true);
  });

  it('dies if nobody saves him, and all he held goes to the discards', async () => {
    const r = rig(5, { turn: 2 });
    const hand = hold(r.e, 1, 'sha', 'shan');
    const weapon = wear(r.e, 1, 'zhuge');
    const trick = plant(r.e, 1, 'lebu');
    await r.e.damage(1, 4, 2);
    expect(r.entries('die')).toEqual([{ k: 'die', seat: 1, role: 'loyalist', killer: 2 }]);
    const p = r.e.p(1);
    expect([p.alive, p.hand, equipOf(p), p.judges]).toEqual([false, [], [], []]);
    expect(r.e.trash).toEqual(expect.arrayContaining([...hand, weapon, trick]));
  });

  it('can be put there by a loss of hit points that is not damage, which has no killer', async () => {
    const r = rig();
    await r.e.loseHp(2, 4);
    expect(r.log).toEqual([
      { k: 'lose', seat: 2, n: 4 },
      { k: 'die', seat: 2, role: 'rebel', killer: null },
    ]);
  });
});

describe('who wins', () => {
  it('the rebels, when the lord falls while others are still standing', async () => {
    const r = rig();
    expect(await over(r.e.damage(0, 99, 2))).toBe('rebel');
    expect(r.entries('die')).toEqual([{ k: 'die', seat: 0, role: 'lord', killer: 2 }]);
  });

  it('the rebels, when the lord falls with the traitor and another still standing', async () => {
    const r = rig();
    out(r.e, 2, 3);
    expect(await over(r.e.damage(0, 99, 4))).toBe('rebel');
  });

  it('the traitor, when he is the one left standing after the lord falls', async () => {
    const r = rig();
    out(r.e, 1, 2, 3);
    expect(await over(r.e.damage(0, 99, 4))).toBe('traitor');
  });

  it('the lord and his loyalists, when the rebels and the traitor are all out', async () => {
    const r = rig();
    out(r.e, 3, 4);
    expect(await over(r.e.damage(2, 99, 0))).toBe('lord');
  });

  it('the lord’s side, at eight seats, only when all four rebels and the traitor are out', async () => {
    const r = rig(8);
    out(r.e, 3, 4, 5);
    expect(await over(r.e.damage(7, 99, 0))).toBeNull();
    expect(r.e.winner()).toBeNull();
    expect(await over(r.e.damage(6, 99, 0))).toBe('lord');
  });

  it('the rebels, at eight seats, when the lord falls with a loyalist still standing', async () => {
    const r = rig(8);
    out(r.e, 1);
    expect(await over(r.e.damage(0, 99, 3))).toBe('rebel');
  });

  it('the traitor, at eight seats, when he alone is left once the lord falls', async () => {
    const r = rig(8);
    out(r.e, 1, 2, 3, 4, 5, 6);
    expect(await over(r.e.damage(0, 99, 7))).toBe('traitor');
  });

  it('nobody yet, at eight seats, when the lord’s loyalists all fall', async () => {
    const r = rig(8);
    expect(await over(r.e.damage(1, 99, 3))).toBeNull();
    expect(await over(r.e.damage(2, 99, 3))).toBeNull();
    expect(r.e.winner()).toBeNull();
  });

  it('nobody yet, when a rebel falls and others are left on both sides', async () => {
    const r = rig();
    expect(await over(r.e.damage(2, 99, 0))).toBeNull();
    expect(r.e.winner()).toBeNull();
  });

  it('nobody yet, when only the lord and a rebel are left to stand against the traitor', async () => {
    const r = rig();
    out(r.e, 1, 3);
    expect(await over(r.e.damage(4, 99, 0))).toBeNull();
    expect(r.e.winner()).toBeNull();
  });

  it('nobody yet, when a loyalist falls', async () => {
    const r = rig();
    expect(await over(r.e.damage(1, 99, 2))).toBeNull();
  });
});

describe('the price of a kill', () => {
  it('is three cards for whoever kills a rebel', async () => {
    const r = rig();
    await r.e.damage(2, 99, 0);
    expect(r.entries('draw')).toMatchObject([{ seat: 0, n: 3 }]);
    expect(r.e.p(0).hand).toHaveLength(3);
  });

  it('is all his cards for a lord who kills a loyalist', async () => {
    const r = rig();
    const hand = hold(r.e, 0, 'sha', 'shan');
    const weapon = wear(r.e, 0, 'zhuge');
    await r.e.damage(1, 99, 0);
    expect(r.entries('discard')).toEqual([{ k: 'discard', seat: 0, cards: [...hand, weapon].map(info) }]);
    expect([r.e.p(0).hand, equipOf(r.e.p(0))]).toEqual([[], []]);
  });

  it('is nothing for a rebel who kills a loyalist, or for anyone who kills the traitor', async () => {
    const r = rig();
    hold(r.e, 2, 'sha');
    await r.e.damage(1, 99, 2);
    await r.e.damage(4, 99, 0);
    expect(r.entries('draw')).toEqual([]);
    expect(r.entries('discard')).toEqual([]);
    expect(r.e.p(2).hand).toHaveLength(1);
  });

  it('is nothing when nobody dealt the blow', async () => {
    const r = rig();
    await r.e.damage(2, 99, null);
    expect(r.entries('draw')).toEqual([]);
  });
});

describe('a card that is not played by the book', () => {
  it.each<[string, (card: Card) => Extract<Reply, { k: 'use' }>]>([
    ['one that is not in the hand', () => ({ k: 'use', card: 4242, as: 'sha', targets: [1] })],
    ['one played as something it is not', (c) => ({ k: 'use', card: c.id, as: 'chai', targets: [1] })],
    ['one with a skill it has not got', (c) => ({ k: 'use', card: c.id, as: 'sha', skill: 'wusheng', targets: [1] })],
    ['one aimed out of reach', (c) => ({ k: 'use', card: c.id, as: 'sha', targets: [2] })],
    ['one aimed at no one', (c) => ({ k: 'use', card: c.id, as: 'sha', targets: [] })],
    ['one aimed at two', (c) => ({ k: 'use', card: c.id, as: 'sha', targets: [1, 4] })],
    ['one aimed at the same player twice', (c) => ({ k: 'use', card: c.id, as: 'sha', targets: [1, 1] })],
    ['one aimed at oneself', (c) => ({ k: 'use', card: c.id, as: 'sha', targets: [0] })],
  ])('is refused, and nothing happens: %s', async (_why, reply) => {
    const r = rig();
    const [sha] = hold(r.e, 0, 'sha');
    expect(await actUse(r.e, 0, reply(sha), legalUses(r.e, 0))).toBe(false);
    expect(r.log).toEqual([]);
    expect(r.e.p(0).hand).toEqual([sha]);
    expect(r.e.flags.sha).toBe(0);
  });

  it('is refused for a player holding someone else’s card, and a Peach aimed at someone', async () => {
    const r = rig();
    const [theirs] = hold(r.e, 1, 'sha');
    r.e.p(0).hp = 2;
    const [tao] = hold(r.e, 0, 'tao');
    expect(await use(r, 0, theirs, 'sha', [1])).toBe(false);
    expect(await use(r, 0, tao, 'tao', [1])).toBe(false);
    expect(r.log).toEqual([]);
  });
});

describe('the tricks that work at once', () => {
  it('Windfall: draws two cards, and needs no target', async () => {
    const r = rig();
    const [windfall] = hold(r.e, 0, 'wuzhong');
    const drawn = stack(r.e, ['sha', 'heart', 2], ['shan', 'club', 3]);
    expect(legalUses(r.e, 0)).toEqual([{ card: windfall.id, as: 'wuzhong', targets: { min: 0, max: 0, options: [] } }]);
    await use(r, 0, windfall);
    expect(r.e.p(0).hand).toEqual(drawn);
    expect(r.entries('draw')).toEqual([{ k: 'draw', seat: 0, n: 2, cards: drawn.map(info) }]);
    expect(r.e.trash).toEqual([windfall]);
  });

  it('Duel: the one aimed at plays a Strike, then the one who played the card, and so on until one cannot', async () => {
    const r = rig();
    const [duel] = hold(r.e, 0, 'juedou');
    hold(r.e, 1, 'sha', 'sha');
    hold(r.e, 0, 'sha');
    r.answer(1, 'sha', first);
    r.answer(0, 'sha', first);
    await use(r, 0, duel, 'juedou', [1]);
    expect(r.entries('play').map((p) => [p.seat, p.name])).toEqual([[1, 'sha'], [0, 'sha'], [1, 'sha']]);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 0, n: 1, source: 1 }]);
    expect(r.asks('sha')[0]?.ask).toMatchObject({ ctx: { from: 0, name: 'juedou', need: 1 } });
  });

  it('Duel: costs the one aimed at a hit point at once if he has no Strike, or will not play one', async () => {
    const r = rig();
    const [duel, extra] = hold(r.e, 0, 'juedou', 'juedou');
    await use(r, 0, duel, 'juedou', [1]);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
    hold(r.e, 2, 'sha');
    r.answer(2, 'sha', null);
    await use(r, 0, extra, 'juedou', [2]);
    expect(r.entries('damage').at(-1)).toEqual({ k: 'damage', seat: 2, n: 1, source: 0 });
    expect(r.asks('sha').map((a) => a.seat)).toEqual([2]);
  });

  it('Dismantle: throws away a card of the one aimed at, from his hand at random, or from what he wears or what waits for him', async () => {
    const r = rig();
    const [mine, theirs] = hold(r.e, 1, 'sha', 'shan');
    const weapon = wear(r.e, 1, 'zhuge');
    const trick = plant(r.e, 1, 'lebu');
    const cards = hold(r.e, 0, 'chai', 'chai', 'chai', 'chai');
    const ask = r.answer.bind(r, 0, 'chai');
    ask(area('equip', weapon));
    await use(r, 0, cards[0], 'chai', [1]);
    expect(r.entries('discard')).toEqual([{ k: 'discard', seat: 0, from: 1, cards: [info(weapon)] }]);
    expect(r.e.p(1).equip.weapon).toBeNull();
    ask(area('judge', trick));
    await use(r, 0, cards[1], 'chai', [1]);
    expect(r.e.p(1).judges).toEqual([]);
    ask(area('hand'));
    await use(r, 0, cards[2], 'chai', [1]);
    expect(r.e.p(1).hand).toEqual([theirs]);
    expect(r.e.trash).toEqual(expect.arrayContaining([weapon, trick, mine]));
    expect(r.asks('chai')[0]?.ask).toMatchObject({ owner: 1, hand: 2, equip: [weapon.id], judges: [trick.id], ctx: { target: 1 } });
  });

  it('Dismantle: takes a card from the hand at random, and the first card if the answer does not fit', async () => {
    const r = rig(5, { random: () => 0.99 });
    const [first_, last] = hold(r.e, 1, 'sha', 'shan');
    const [chai, chai2] = hold(r.e, 0, 'chai', 'chai');
    r.answer(0, 'chai', area('hand'));
    await use(r, 0, chai, 'chai', [1]);
    expect(r.e.p(1).hand).toEqual([first_]);
    expect(r.e.trash).toContain(last);
    r.answer(0, 'chai', area('equip', null));
    await use(r, 0, chai2, 'chai', [1]);
    expect(r.e.p(1).hand).toEqual([]);
  });

  it('Dismantle: has no reach to speak of, and no use against a player with nothing', () => {
    const r = rig(8);
    hold(r.e, 0, 'chai');
    expect(legalUses(r.e, 0)).toEqual([]);
    hold(r.e, 4, 'sha');
    hold(r.e, 6, 'sha');
    expect(legalUses(r.e, 0)[0]?.targets.options).toEqual([4, 6]);
  });

  it('Steal: takes the card into his own hand, from a player at one seat', async () => {
    const r = rig();
    const [shun] = hold(r.e, 0, 'shun');
    hold(r.e, 1, 'sha');
    const gun = wear(r.e, 4, 'zhuge');
    hold(r.e, 2, 'sha');
    expect(legalUses(r.e, 0)[0]?.targets.options).toEqual([1, 4]);
    r.answer(0, 'shun', area('equip', gun));
    await use(r, 0, shun, 'shun', [4]);
    expect(r.entries('take')).toEqual([{ k: 'take', seat: 0, from: 4, cards: [info(gun)], zone: 'equip' }]);
    expect(r.e.p(0).hand).toEqual([gun]);
    expect(r.e.p(4).equip.weapon).toBeNull();
  });

  it('Steal: is out of reach of a player whose +1 horse puts him two seats away', () => {
    const r = rig();
    hold(r.e, 0, 'shun');
    hold(r.e, 4, 'sha');
    expect(legalUses(r.e, 0)[0]?.targets.options).toEqual([4]);
    wear(r.e, 4, 'dilu');
    expect(legalUses(r.e, 0)).toEqual([]);
    wear(r.e, 0, 'chitu');
    expect(legalUses(r.e, 0)[0]?.targets.options).toEqual([4]);
  });

  it('Steal: cannot reach a player two seats away, nor one who has nothing, nor Lu Xun', () => {
    const r = rig();
    hold(r.e, 0, 'shun');
    hold(r.e, 2, 'sha');
    expect(legalUses(r.e, 0)).toEqual([]);
    hold(r.e, 1, 'sha');
    become(r.e, 1, 'luxun');
    expect(legalUses(r.e, 0)).toEqual([]);
    become(r.e, 1, 'liubei');
    expect(legalUses(r.e, 0)[0]?.targets.options).toEqual([1]);
  });

  it('Barbarians: every other player in turn order plays a Strike or loses a hit point', async () => {
    const r = rig();
    const [barbarians] = hold(r.e, 0, 'nanman');
    hold(r.e, 2, 'sha');
    hold(r.e, 3, 'sha');
    r.answer(2, 'sha', first);
    r.answer(3, 'sha', null);
    await use(r, 0, barbarians);
    expect(r.entries('damage').map((d) => [d.seat, d.n, d.source])).toEqual([[1, 1, 0], [3, 1, 0], [4, 1, 0]]);
    expect(r.asks('sha').map((a) => a.seat)).toEqual([2, 3]);
    expect(r.asks('sha')[0]?.ask).toMatchObject({ ctx: { from: 0, name: 'nanman' } });
    expect(r.e.p(0).hp).toBe(5);
  });

  it('Arrows: every other player plays a Dodge or loses a hit point', async () => {
    const r = rig();
    const [arrows] = hold(r.e, 0, 'wanjian');
    hold(r.e, 4, 'shan');
    r.answer(4, 'shan', first);
    await use(r, 0, arrows);
    expect(r.entries('damage').map((d) => d.seat)).toEqual([1, 2, 3]);
    expect(r.asks('shan').map((a) => a.seat)).toEqual([4]);
  });

  it('Peach Garden: heals each player who is hurt, from the one who played it round the table', async () => {
    const r = rig();
    const [garden] = hold(r.e, 0, 'taoyuan');
    r.e.p(0).hp = 3;
    r.e.p(2).hp = 1;
    r.e.p(4).hp = 3;
    await use(r, 0, garden);
    expect(r.entries('heal')).toEqual([
      { k: 'heal', seat: 0, n: 1 }, { k: 'heal', seat: 2, n: 1 }, { k: 'heal', seat: 4, n: 1 },
    ]);
    expect(r.e.players.map((p) => p.hp)).toEqual([4, 4, 2, 4, 4]);
  });
});

describe('Nullification', () => {
  it('cancels a trick when a player who holds one plays it', async () => {
    const r = rig();
    const [duel] = hold(r.e, 0, 'juedou');
    const [nullify] = hold(r.e, 2, 'wuxie');
    r.answer(2, 'wuxie', first);
    await use(r, 0, duel, 'juedou', [1]);
    expect(r.entries('cancel')).toEqual([{ k: 'cancel', name: 'juedou', target: 1 }]);
    expect(r.entries('damage')).toEqual([]);
    expect(r.entries('play')).toMatchObject([{ seat: 2, name: 'wuxie' }]);
    expect(r.e.trash).toEqual(expect.arrayContaining([nullify, duel]));
    expect(r.asks('wuxie')).toEqual([
      { seat: 2, ask: { k: 'cards', why: 'wuxie', ctx: { name: 'juedou', on: true, from: 0, target: 1 }, cards: [nullify.id], min: 0, max: 1 } },
    ]);
  });

  it('is asked of the players who hold it in turn order from the one who played the trick, and again after each one played', async () => {
    const r = rig();
    const [duel] = hold(r.e, 0, 'juedou');
    hold(r.e, 2, 'wuxie');
    hold(r.e, 3, 'wuxie');
    r.answer(2, 'wuxie', first);
    r.answer(3, 'wuxie', first);
    await use(r, 0, duel, 'juedou', [1]);
    expect(r.asks('wuxie').map((a) => [a.seat, a.ask.k === 'cards' ? a.ask.ctx.on : null])).toEqual([[2, true], [3, false]]);
    expect(r.entries('cancel')).toEqual([]);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
  });

  it('lets a trick go through when everyone who holds one says no', async () => {
    const r = rig();
    const [windfall] = hold(r.e, 0, 'wuzhong');
    hold(r.e, 3, 'wuxie');
    r.answer(3, 'wuxie', null);
    await use(r, 0, windfall);
    expect(r.entries('draw')).toHaveLength(1);
    expect(r.entries('cancel')).toEqual([]);
  });

  it('is asked about each player a Barbarian raid or a Peach Garden is aimed at, one at a time', async () => {
    const r = rig();
    const [raid] = hold(r.e, 0, 'nanman');
    hold(r.e, 4, 'wuxie');
    r.answer(4, 'wuxie', (ask) => (ask.k === 'cards' && ask.ctx.target === 1 ? pick({ id: ask.cards[0] ?? 0, name: 'wuxie', suit: 'spade', rank: 7 }) : null));
    await use(r, 0, raid);
    expect(r.entries('cancel')).toEqual([{ k: 'cancel', name: 'nanman', target: 1 }]);
    expect(r.entries('damage').map((d) => d.seat)).toEqual([2, 3, 4]);
  });
});

describe('the tricks that wait', () => {
  it('Lebu: goes in front of another player, one at a time, and never in front of Lu Xun', async () => {
    const r = rig();
    const [lebu] = hold(r.e, 0, 'lebu');
    expect(legalUses(r.e, 0)[0]?.targets).toEqual({ min: 1, max: 1, options: [1, 2, 3, 4] });
    plant(r.e, 2, 'lebu');
    become(r.e, 3, 'luxun');
    expect(legalUses(r.e, 0)[0]?.targets.options).toEqual([1, 4]);
    await use(r, 0, lebu, 'lebu', [1]);
    expect(r.e.p(1).judges).toEqual([{ card: lebu, as: 'lebu' }]);
    expect(r.entries('use')).toMatchObject([{ seat: 0, name: 'lebu', targets: [1] }]);
  });

  it('Bing: goes in front of a player one seat away, one at a time', () => {
    const r = rig();
    hold(r.e, 0, 'bing');
    expect(legalUses(r.e, 0)[0]?.targets.options).toEqual([1, 4]);
    plant(r.e, 1, 'bing');
    expect(legalUses(r.e, 0)[0]?.targets.options).toEqual([4]);
    become(r.e, 0, 'huangyueying');
    expect(legalUses(r.e, 0)[0]?.targets.options).toEqual([4, 2, 3].sort());
  });

  it('Lightning: goes in front of the one who plays it, and not while one is there already', async () => {
    const r = rig();
    const [bolt, second] = hold(r.e, 0, 'shandian', 'shandian');
    expect(legalUses(r.e, 0)[0]?.targets).toEqual({ min: 0, max: 0, options: [] });
    await use(r, 0, bolt, 'shandian');
    expect(r.e.p(0).judges).toEqual([{ card: bolt, as: 'shandian' }]);
    expect(legalUses(r.e, 0).map((u) => u.card)).not.toContain(second.id);
  });
});

describe('what happens to a trick that waits, in the judgement phase', () => {
  const judging = (setup: (e: Parameters<typeof become>[0]) => void) =>
    game({
      stage: (e) => {
        become(e, 0, 'liubei');
        setup(e);
      },
      until: endOfTurn,
    });
  const judgedWhy = (log: Entry[]) => log.flatMap((en) => (en.k === 'judge' ? [en.why] : []));
  const playsAsked = (asked: Asked[]) => asked.filter((a) => a.seat === 0 && a.ask.k === 'play').length;

  it('Lebu: costs the play phase unless the judgement is a heart', async () => {
    const miss = await judging((e) => {
      plant(e, 0, 'lebu');
      stack(e, ['sha', 'club', 5]);
    });
    expect(miss.log).toContainEqual({ k: 'judge', seat: 0, card: { name: 'sha', suit: 'club', rank: 5 }, why: 'lebu' });
    expect(miss.log).toContainEqual({ k: 'skip', seat: 0, phase: 'play' });
    expect(playsAsked(miss.asked)).toBe(0);
    expect(miss.e.p(0).judges).toEqual([]);

    const hit = await judging((e) => {
      plant(e, 0, 'lebu');
      stack(e, ['sha', 'heart', 5]);
    });
    expect(hit.log.some((en) => en.k === 'skip')).toBe(false);
    expect(playsAsked(hit.asked)).toBeGreaterThan(0);
  });

  it('Bing: costs the draw phase unless the judgement is a club', async () => {
    const draws = (log: Entry[]) => log.filter((en) => en.k === 'draw' && en.seat === 0 && en.n === 2).length;
    const miss = await judging((e) => {
      plant(e, 0, 'bing');
      stack(e, ['sha', 'heart', 5]);
    });
    expect(miss.log).toContainEqual({ k: 'skip', seat: 0, phase: 'draw' });
    expect(draws(miss.log)).toBe(0);
    expect(miss.e.p(0).hand).toHaveLength(4);

    const hit = await judging((e) => {
      plant(e, 0, 'bing');
      stack(e, ['sha', 'club', 5]);
    });
    expect(hit.log.some((en) => en.k === 'skip')).toBe(false);
    expect(draws(hit.log)).toBe(1);
  });

  it('works out the last to arrive first', async () => {
    const g = await judging((e) => {
      plant(e, 0, 'lebu');
      plant(e, 0, 'bing');
      stack(e, ['sha', 'club', 2], ['sha', 'heart', 2]);
    });
    expect(judgedWhy(g.log)).toEqual(['bing', 'lebu']);
    expect(g.log.some((en) => en.k === 'skip')).toBe(false);
  });

  it.each([
    ['spade', 2, true], ['spade', 9, true], ['spade', 5, true],
    ['spade', 1, false], ['spade', 10, false], ['heart', 5, false], ['club', 5, false],
  ] as const)('Lightning: a %s %i judgement strikes: %s', async (suit, rank, strikes) => {
    const g = await judging((e) => {
      plant(e, 0, 'shandian');
      stack(e, ['sha', suit, rank]);
    });
    if (strikes) {
      expect(g.log).toContainEqual({ k: 'damage', seat: 0, n: 3, source: null });
      expect(g.e.p(0)).toMatchObject({ hp: 2, judges: [] });
      expect(g.e.p(1).judges).toEqual([]);
    } else {
      expect(g.log.some((en) => en.k === 'damage')).toBe(false);
      expect(g.e.p(0).judges).toEqual([]);
      expect(g.e.p(1).judges.map((j) => j.as)).toEqual(['shandian']);
    }
  });

  it('Lightning: passes over a player who is out', async () => {
    const g = await judging((e) => {
      out(e, 1);
      plant(e, 0, 'shandian');
      stack(e, ['sha', 'heart', 5]);
    });
    expect(g.e.p(2).judges.map((j) => j.as)).toEqual(['shandian']);
  });

  it('Lightning: can kill, which ends the turn on the spot and may end the game', async () => {
    const g = await game({
      stage: (e) => {
        become(e, 0, 'liubei');
        e.p(0).hp = 3;
        plant(e, 0, 'shandian');
        stack(e, ['sha', 'spade', 5]);
      },
    });
    expect(g.outcome).toEqual({ winner: 'rebel', turns: 1 });
    const kinds = g.log.map((en) => en.k);
    expect(kinds.slice(-3)).toEqual(['damage', 'die', 'end']);
    expect(g.log.filter((en) => en.k === 'phase').map((en) => en.k === 'phase' && en.phase)).toEqual(['start', 'judge']);
  });

  it('Nullification: cancels it at the judgement, and the trick is thrown away unjudged', async () => {
    const g = await game({
      stage: (e) => {
        become(e, 0, 'liubei');
        plant(e, 0, 'lebu');
        stack(e, ['sha', 'club', 5]);
        e.p(2).hand = [];
        hold(e, 2, 'wuxie');
      },
      script: (seat, ask) => (seat === 2 ? first(ask) : null),
      until: endOfTurn,
    });
    expect(g.log).toContainEqual({ k: 'cancel', name: 'lebu', target: 0 });
    expect(g.log.some((en) => en.k === 'judge')).toBe(false);
    expect(g.log.some((en) => en.k === 'skip')).toBe(false);
    expect(g.e.p(0).judges).toEqual([]);
  });
});

describe('equipment', () => {
  it('goes on at once, and what it replaces goes to the discards', async () => {
    const r = rig();
    const old = wear(r.e, 0, 'zhuge');
    const [bow] = hold(r.e, 0, 'qilin');
    expect(legalUses(r.e, 0)).toEqual([{ card: bow.id, as: 'qilin', targets: { min: 0, max: 0, options: [] } }]);
    await use(r, 0, bow);
    expect(r.e.p(0).equip.weapon).toBe(bow);
    expect(r.e.trash).toContain(old);
    expect(r.entries('equip')).toEqual([{ k: 'equip', seat: 0, card: info(bow) }]);
    expect(r.e.range(0)).toBe(5);
  });

  it('has a slot of its own for a weapon, an armour, a +1 horse and a -1 horse', async () => {
    const r = rig();
    const cards = hold(r.e, 0, 'zhuge', 'bagua', 'dilu', 'chitu', 'jueying');
    for (const card of cards) await use(r, 0, card);
    expect(r.e.p(0).equip).toMatchObject({ weapon: cards[0], armor: cards[1], plus: cards[4], minus: cards[3] });
    expect(r.e.trash).toEqual([cards[2]]);
  });

  it('Qinggang: ignores armour, so Renwang and Bagua do nothing against it', async () => {
    const r = rig();
    wear(r.e, 0, 'qinggang');
    wear(r.e, 1, 'renwang');
    await strike(r, 'spade');
    expect(r.entries('armor')).toEqual([]);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
    const b = rig();
    wear(b.e, 0, 'qinggang');
    wear(b.e, 1, 'bagua');
    await strike(b);
    expect(b.asks('bagua')).toEqual([]);
    expect(b.entries('damage')).toHaveLength(1);
  });

  it('Renwang: blocks a black Strike, and not a red one', async () => {
    const black = rig();
    wear(black.e, 1, 'renwang');
    hold(black.e, 1, 'shan');
    await strike(black, 'club');
    expect(black.entries('armor')).toEqual([{ k: 'armor', seat: 1, name: 'renwang' }]);
    expect(black.entries('damage')).toEqual([]);
    expect(black.asks('shan')).toEqual([]);
    const red = rig();
    wear(red.e, 1, 'renwang');
    await strike(red, 'diamond');
    expect(red.entries('armor')).toEqual([]);
    expect(red.entries('damage')).toHaveLength(1);
  });

  it('Bagua: is asked first, and a red judgement dodges with no Dodge in the hand', async () => {
    const r = rig();
    wear(r.e, 1, 'bagua');
    const [flip] = stack(r.e, ['shan', 'heart', 3]);
    r.answer(1, 'bagua', yes);
    await strike(r);
    expect(r.asks('bagua')).toEqual([{ seat: 1, ask: { k: 'confirm', why: 'bagua', ctx: { from: 0, name: 'sha', need: 1 } } }]);
    expect(r.entries('armor')).toEqual([{ k: 'armor', seat: 1, name: 'bagua' }]);
    expect(r.entries('judge')).toEqual([{ k: 'judge', seat: 1, card: info(flip), why: 'bagua' }]);
    expect(r.entries('damage')).toEqual([]);
    expect(r.asks('shan')).toEqual([]);
  });

  it('Bagua: a black judgement falls back on a Dodge from the hand, and hurts if there is none', async () => {
    const saved = rig();
    wear(saved.e, 1, 'bagua');
    stack(saved.e, ['sha', 'spade', 3]);
    hold(saved.e, 1, 'shan');
    saved.answer(1, 'bagua', yes);
    saved.answer(1, 'shan', first);
    await strike(saved);
    expect(saved.entries('play')).toMatchObject([{ seat: 1, name: 'shan' }]);
    expect(saved.entries('damage')).toEqual([]);
    const hurt = rig();
    wear(hurt.e, 1, 'bagua');
    stack(hurt.e, ['sha', 'club', 3]);
    hurt.answer(1, 'bagua', yes);
    await strike(hurt);
    expect(hurt.entries('damage')).toHaveLength(1);
  });

  it('Bagua: may be turned down, which goes straight to the Dodges in the hand', async () => {
    const r = rig();
    wear(r.e, 1, 'bagua');
    stack(r.e, ['shan', 'heart', 3]);
    r.answer(1, 'bagua', no);
    await strike(r);
    expect(r.entries('judge')).toEqual([]);
    expect(r.entries('damage')).toHaveLength(1);
  });

  it('Qinglong: lets a Strike that was dodged be followed by another, which has its own Dodge to meet', async () => {
    const r = rig();
    wear(r.e, 0, 'qinglong');
    hold(r.e, 1, 'shan');
    const [again] = hold(r.e, 0, ['sha', 'heart', 9]);
    r.answer(1, 'shan', first);
    r.answer(0, 'qinglong', first);
    await strike(r);
    expect(r.asks('qinglong')).toEqual([
      { seat: 0, ask: { k: 'cards', why: 'qinglong', ctx: { target: 1 }, cards: [again.id], min: 0, max: 1 } },
    ]);
    expect(r.entries('use').map((u) => u.name)).toEqual(['sha', 'sha']);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
  });

  it('Guanshi: hits a Strike that was dodged anyway for two cards thrown away, and only for two', async () => {
    const paid = rig();
    wear(paid.e, 0, 'guanshi');
    hold(paid.e, 1, 'shan');
    const spare = hold(paid.e, 0, 'tao', 'chai', 'wuzhong');
    paid.answer(1, 'shan', first);
    paid.answer(0, 'guanshi', pick(spare[0], spare[1]));
    await strike(paid);
    expect(paid.entries('discard')).toEqual([{ k: 'discard', seat: 0, cards: [info(spare[0]), info(spare[1])] }]);
    expect(paid.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);

    const short = rig();
    wear(short.e, 0, 'guanshi');
    hold(short.e, 1, 'shan');
    const [one] = hold(short.e, 0, 'tao', 'chai');
    short.answer(1, 'shan', first);
    short.answer(0, 'guanshi', pick(one));
    await strike(short);
    expect(short.entries('damage')).toEqual([]);
    expect(short.entries('discard')).toEqual([]);
  });

  it('Guanshi: is paid for with cards from the hand or what is worn, but not with the weapon itself', async () => {
    const r = rig();
    const weapon = wear(r.e, 0, 'guanshi');
    const armor = wear(r.e, 0, 'bagua');
    hold(r.e, 1, 'shan');
    r.answer(1, 'shan', first);
    const [spare] = hold(r.e, 0, 'tao');
    await strike(r);
    const ask = r.asks('guanshi')[0]?.ask;
    expect(ask).toMatchObject({ min: 0, max: 2 });
    expect(ask?.k === 'cards' ? ask.cards.sort() : []).toEqual([spare.id, armor.id].sort());
    expect(ask?.k === 'cards' ? ask.cards : []).not.toContain(weapon.id);
  });

  it('Fangtian: lets the last card in the hand, a Strike, go at up to three players at once', async () => {
    const r = rig();
    wear(r.e, 0, 'fangtian');
    const [sha] = hold(r.e, 0, 'sha');
    expect(legalUses(r.e, 0)).toEqual([{ card: sha.id, as: 'sha', targets: { min: 1, max: 3, options: [1, 2, 3, 4] } }]);
    expect(await use(r, 0, sha, 'sha', [3, 1, 2])).toBe(true);
    expect(r.entries('use')).toMatchObject([{ targets: [1, 2, 3] }]);
    expect(r.entries('damage').map((d) => d.seat)).toEqual([1, 2, 3]);
    const two = rig();
    wear(two.e, 0, 'fangtian');
    hold(two.e, 0, 'sha', 'tao');
    expect(legalUses(two.e, 0)[0]?.targets.max).toBe(1);
  });

  it('Qilin: lets the one who hurts throw away a horse of the one hurt', async () => {
    const r = rig();
    wear(r.e, 0, 'qilin');
    const dilu = wear(r.e, 1, 'dilu');
    const chitu = wear(r.e, 1, 'chitu');
    r.answer(0, 'qilin', pick(dilu));
    await strike(r);
    expect(r.asks('qilin')[0]?.ask).toMatchObject({ why: 'qilin', cards: [dilu.id, chitu.id], min: 0, max: 1 });
    expect(r.entries('discard')).toEqual([{ k: 'discard', seat: 0, from: 1, cards: [info(dilu)] }]);
    expect([r.e.p(1).equip.plus, r.e.p(1).equip.minus]).toEqual([null, chitu]);
  });

  it('Qilin: asks nothing of a player with no horse', async () => {
    const r = rig();
    wear(r.e, 0, 'qilin');
    await strike(r);
    expect(r.asks('qilin')).toEqual([]);
  });
});

describe('what a player can see of the table', () => {
  it('is his own hand, his own role, the lord’s and the roles of the dead, and no other', () => {
    const r = rig();
    out(r.e, 3);
    hold(r.e, 2, 'sha', 'shan');
    const v = tableView(r.e, 2);
    expect(v.seats.map((s) => s.role)).toEqual(['lord', null, 'rebel', 'rebel', null]);
    expect(v.hand.map((c) => c.name)).toEqual(['sha', 'shan']);
    expect(tableView(r.e, 4).seats.map((s) => s.role)).toEqual(['lord', null, null, 'rebel', 'traitor']);
  });

  it('counts the other hands, shows what is worn and what waits, and how far each weapon reaches', () => {
    const r = rig();
    hold(r.e, 1, 'sha', 'shan', 'tao');
    const weapon = wear(r.e, 1, 'qinggang');
    const trick = plant(r.e, 1, 'lebu', ['sha', 'heart', 5]);
    const seat = tableView(r.e, 0).seats[1];
    expect(seat).toMatchObject({ hand: 3, range: 2, hero: 'liubei', kingdom: 'shu', skills: ['rende'], hp: 4, maxHp: 4, alive: true });
    expect(seat?.equip).toEqual([{ id: weapon.id, name: 'qinggang', suit: 'spade', rank: 7 }]);
    expect(seat?.judges).toEqual([{ as: 'lebu', card: { id: trick.id, name: 'sha', suit: 'heart', rank: 5 } }]);
  });

  it('measures how far each seat is from the viewer, with horses, and nothing for himself, the dead, or when he is out', () => {
    const r = rig();
    wear(r.e, 1, 'dilu');
    const dist = (me: number) => tableView(r.e, me).seats.map((s) => s.dist);
    expect(dist(0)).toEqual([0, 2, 2, 2, 1]);
    out(r.e, 1);
    expect(dist(0)).toEqual([0, 0, 1, 2, 1]);
    out(r.e, 0);
    expect(dist(0)).toEqual([0, 0, 0, 0, 0]);
  });

  it('has no hero before the choice, and no negative hit points', () => {
    const r = rig();
    const p = r.e.p(1);
    p.hero = null;
    p.maxHp = 0;
    p.hp = 0;
    expect(tableView(r.e, 0).seats[1]).toMatchObject({ hero: null, kingdom: null, skills: [], hp: 0, maxHp: 0 });
    r.e.p(2).hp = -3;
    expect(tableView(r.e, 0).seats[2]?.hp).toBe(0);
  });

  it('says whose turn it is, in which phase, how many turns have been played and how many cards are left', () => {
    const r = rig(5, { turn: 3 });
    r.e.phase = 'draw';
    r.e.turns = 7;
    expect(tableView(r.e, 0)).toMatchObject({ turn: 3, phase: 'draw', turns: 7, pile: r.e.pile.length });
  });
});
