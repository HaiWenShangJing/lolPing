import { describe, expect, it } from 'vitest';
import type { Card, CardName, Suit } from '../../../src/shared/teammate/sanguoshaCards';
import {
  ACTIVE_SKILLS, HERO_IDS, HEROES, KINGDOMS, SKILLS, isActiveSkill, isHeroId,
} from '../../../src/shared/teammate/sanguoshaHeroes';
import { drawPhase, endPhase, skillOptions, startPhase } from '../../../src/shared/teammate/sanguoshaSkills';
import type { Entry } from '../../../src/shared/teammate/sanguoshaTypes';
import { legalUses, serving } from '../../../src/shared/teammate/sanguoshaUse';
import {
  area, become, cast, end, first, game, hold, info, no, out, over, pick, plant, rig, seats, stack, use, wear, yes,
  type Rig,
} from './sanguoshaRig';

const endOfTurn = (en: Entry): boolean => en.k === 'phase' && en.phase === 'end';
const aim = (r: Rig, seat: number, as: CardName): number[] | undefined =>
  legalUses(r.e, seat).find((u) => u.as === as)?.targets.options;

/** Plays a Strike at `to`, which the table must accept, and hands it back. */
async function strike(r: Rig, from = 0, to = 1, suit: Suit = 'spade'): Promise<Card> {
  const [sha] = hold(r.e, from, ['sha', suit, 5]);
  expect(await use(r, from, sha, 'sha', [to])).toBe(true);
  return sha;
}

describe('the heroes', () => {
  it('are 25 figures of the Three Kingdoms with three or four hit points and one or two skills each', () => {
    expect(HERO_IDS).toHaveLength(25);
    expect(new Set(HERO_IDS).size).toBe(25);
    expect(Object.keys(HEROES).sort()).toEqual([...HERO_IDS].sort());
    for (const id of HERO_IDS) {
      const hero = HEROES[id];
      expect([3, 4], id).toContain(hero.hp);
      expect(hero.skills.length, id).toBeGreaterThanOrEqual(1);
      expect(hero.skills.length, id).toBeLessThanOrEqual(2);
      expect(new Set(hero.skills).size, id).toBe(hero.skills.length);
      expect(KINGDOMS, id).toContain(hero.kingdom);
    }
  });

  it('come from four kingdoms', () => {
    const count = (kingdom: string): number => HERO_IDS.filter((id) => HEROES[id].kingdom === kingdom).length;
    expect(KINGDOMS).toEqual(['shu', 'wei', 'wu', 'qun']);
    expect(KINGDOMS.map(count)).toEqual([7, 7, 8, 3]);
  });

  it('hold the 33 skills between them, each skill by one hero only', () => {
    expect(SKILLS).toHaveLength(33);
    expect(new Set(SKILLS).size).toBe(33);
    expect(HERO_IDS.flatMap((id) => HEROES[id].skills).sort()).toEqual([...SKILLS].sort());
  });

  it('start four of those skills from a button of their own', () => {
    expect(ACTIVE_SKILLS).toEqual(['rende', 'zhiheng', 'kurou', 'qingnang']);
    expect(SKILLS.filter(isActiveSkill)).toEqual([...ACTIVE_SKILLS]);
  });

  it('are told from other words by isHeroId', () => {
    expect(HERO_IDS.every(isHeroId)).toBe(true);
    expect(['liu', '', null, 3, undefined, {}].map(isHeroId)).toEqual([false, false, false, false, false, false]);
  });

  it.each(HERO_IDS)('%s is offered the skills it starts itself, and no others', (id) => {
    const r = rig(5, { heroes: { 0: id } });
    hold(r.e, 0, 'sha', 'shan');
    r.e.p(1).hp = 1;
    expect(skillOptions(r.e, 0).map((o) => o.skill)).toEqual(HEROES[id].skills.filter(isActiveSkill));
  });
});

describe('Liu Bei: Rende', () => {
  it('is offered to a player with a hand and someone to give it to, and not otherwise', () => {
    const r = rig();
    expect(skillOptions(r.e, 0)).toEqual([]);
    const [a, b] = hold(r.e, 0, 'sha', 'shan');
    expect(skillOptions(r.e, 0)).toEqual([
      { skill: 'rende', cards: { min: 1, max: 2, ids: [a.id, b.id] }, targets: { min: 1, max: 1, options: [1, 2, 3, 4] } },
    ]);
    out(r.e, 1, 2, 3);
    expect(skillOptions(r.e, 0)[0]?.targets?.options).toEqual([4]);
    out(r.e, 4);
    expect(skillOptions(r.e, 0)).toEqual([]);
  });

  it('gives the cards chosen to the player chosen', async () => {
    const r = rig();
    const [sha, shan, tao] = hold(r.e, 0, 'sha', 'shan', 'tao');
    expect(await cast(r, 0, 'rende', [sha, tao], [2])).toBe(true);
    expect(r.log).toEqual([
      { k: 'skill', seat: 0, skill: 'rende', targets: [2] },
      { k: 'give', seat: 0, to: 2, cards: [info(sha), info(tao)] },
    ]);
    expect(r.e.p(2).hand).toEqual([sha, tao]);
    expect(r.e.p(0).hand).toEqual([shan]);
    expect(r.e.flags.given).toBe(2);
  });

  it('heals him one hit point when two cards have been given away in a turn, and not again', async () => {
    const r = rig();
    r.e.p(0).hp = 2;
    const [a, b, c, d] = hold(r.e, 0, 'sha', 'sha', 'sha', 'sha');
    await cast(r, 0, 'rende', [a], [1]);
    expect(r.e.p(0).hp).toBe(2);
    await cast(r, 0, 'rende', [b], [2]);
    expect(r.e.p(0).hp).toBe(3);
    await cast(r, 0, 'rende', [c, d], [3]);
    expect(r.e.p(0).hp).toBe(3);
    expect(r.e.flags.given).toBe(4);
    expect(r.entries('heal')).toEqual([{ k: 'heal', seat: 0, n: 1 }]);
  });

  it('heals him when two cards are given at once, or three', async () => {
    const two = rig();
    two.e.p(0).hp = 1;
    await cast(two, 0, 'rende', hold(two.e, 0, 'sha', 'sha'), [1]);
    expect(two.e.p(0).hp).toBe(2);
    const three = rig();
    three.e.p(0).hp = 1;
    await cast(three, 0, 'rende', hold(three.e, 0, 'sha', 'sha', 'sha'), [1]);
    expect(three.e.p(0).hp).toBe(2);
  });

  it('refuses what the skill does not allow, and then nothing happens', async () => {
    const r = rig();
    const [mine] = hold(r.e, 0, 'sha');
    const [theirs] = hold(r.e, 1, 'sha');
    out(r.e, 3);
    const attempts: [string, Card[], number[]][] = [
      ['no card', [], [1]],
      ['a card of another player', [theirs], [1]],
      ['the same card twice', [mine, mine], [1]],
      ['no one to give to', [mine], []],
      ['two to give to', [mine], [1, 2]],
      ['himself', [mine], [0]],
      ['a player who is out', [mine], [3]],
    ];
    for (const [why, cards, targets] of attempts) expect(await cast(r, 0, 'rende', cards, targets), why).toBe(false);
    expect(r.log).toEqual([]);
    expect(r.e.p(0).hand).toEqual([mine]);
  });

  it('is refused for a hero that has not got it', async () => {
    const r = rig(5, { heroes: { 0: 'guanyu' } });
    const [sha] = hold(r.e, 0, 'sha');
    expect(await cast(r, 0, 'rende', [sha], [1])).toBe(false);
    expect(r.log).toEqual([]);
  });
});

describe('Sun Quan: Zhiheng', () => {
  const quan = (): Rig => rig(5, { heroes: { 0: 'sunquan' } });

  it('is offered with all he holds or wears to throw away, once a turn', async () => {
    const r = quan();
    expect(skillOptions(r.e, 0)).toEqual([]);
    const [sha, shan] = hold(r.e, 0, 'sha', 'shan');
    const weapon = wear(r.e, 0, 'zhuge');
    expect(skillOptions(r.e, 0)).toEqual([
      { skill: 'zhiheng', cards: { min: 1, max: 3, ids: [sha.id, shan.id, weapon.id] }, targets: null },
    ]);
    await cast(r, 0, 'zhiheng', [sha]);
    expect(skillOptions(r.e, 0)).toEqual([]);
  });

  it('throws away the cards chosen and draws as many', async () => {
    const r = quan();
    const [sha, shan] = hold(r.e, 0, 'sha', 'shan');
    const weapon = wear(r.e, 0, 'zhuge');
    const drawn = stack(r.e, ['tao', 'heart', 2], ['tao', 'heart', 3], ['tao', 'heart', 4]);
    expect(await cast(r, 0, 'zhiheng', [sha, weapon])).toBe(true);
    expect(r.log).toEqual([
      { k: 'skill', seat: 0, skill: 'zhiheng' },
      { k: 'discard', seat: 0, cards: [info(sha), info(weapon)] },
      { k: 'draw', seat: 0, n: 2, cards: [info(drawn[0]), info(drawn[1])] },
    ]);
    expect(r.e.p(0).hand).toEqual([shan, drawn[0], drawn[1]]);
    expect(r.e.p(0).equip.weapon).toBeNull();
    expect(r.e.flags.zhiheng).toBe(true);
  });

  it('works once in a turn, and again in the next', async () => {
    const r = quan();
    const [a, b] = hold(r.e, 0, 'sha', 'sha');
    expect(await cast(r, 0, 'zhiheng', [a])).toBe(true);
    expect(await cast(r, 0, 'zhiheng', [b])).toBe(false);
    r.e.flags.zhiheng = false;
    expect(await cast(r, 0, 'zhiheng', [b])).toBe(true);
  });

  it('refuses no cards, a card that is not his, and a target', async () => {
    const r = quan();
    const [mine] = hold(r.e, 0, 'sha');
    const [theirs] = hold(r.e, 1, 'sha');
    expect(await cast(r, 0, 'zhiheng', [])).toBe(false);
    expect(await cast(r, 0, 'zhiheng', [theirs])).toBe(false);
    expect(await cast(r, 0, 'zhiheng', [mine], [1])).toBe(false);
    expect(r.log).toEqual([]);
  });
});

describe('Huang Gai: Kurou', () => {
  const gai = (): Rig => rig(5, { heroes: { 0: 'huanggai' } });

  it('costs a hit point and draws two cards', async () => {
    const r = gai();
    const drawn = stack(r.e, ['tao', 'heart', 2], ['tao', 'heart', 3]);
    expect(skillOptions(r.e, 0)).toEqual([{ skill: 'kurou', cards: null, targets: null }]);
    expect(await cast(r, 0, 'kurou')).toBe(true);
    expect(r.log).toEqual([
      { k: 'skill', seat: 0, skill: 'kurou' },
      { k: 'lose', seat: 0, n: 1 },
      { k: 'draw', seat: 0, n: 2, cards: drawn.map(info) },
    ]);
    expect(r.e.p(0).hp).toBe(4);
    expect(r.e.p(0).hand).toEqual(drawn);
  });

  it('may be done as often as he likes, until he is down to one hit point', async () => {
    const r = gai();
    for (const hp of [5, 4, 3, 2]) {
      expect(r.e.p(0).hp).toBe(hp);
      expect(await cast(r, 0, 'kurou')).toBe(true);
    }
    expect(r.e.p(0).hp).toBe(1);
    expect(skillOptions(r.e, 0)).toEqual([]);
    expect(await cast(r, 0, 'kurou')).toBe(false);
    expect(r.entries('die')).toEqual([]);
    expect(r.e.p(0).hand).toHaveLength(8);
  });

  it('refuses cards and targets', async () => {
    const r = gai();
    const [sha] = hold(r.e, 0, 'sha');
    expect(await cast(r, 0, 'kurou', [sha])).toBe(false);
    expect(await cast(r, 0, 'kurou', [], [1])).toBe(false);
    expect(r.log).toEqual([]);
  });
});

describe('Hua Tuo: Qingnang', () => {
  const tuo = (): Rig => rig(5, { heroes: { 0: 'huatuo' } });

  it('is offered with a hand card to throw away and a hurt player to heal', () => {
    const r = tuo();
    const [sha] = hold(r.e, 0, 'sha');
    expect(skillOptions(r.e, 0)).toEqual([]);
    r.e.p(2).hp = 1;
    r.e.p(4).hp = 2;
    expect(skillOptions(r.e, 0)).toEqual([
      { skill: 'qingnang', cards: { min: 1, max: 1, ids: [sha.id] }, targets: { min: 1, max: 1, options: [2, 4] } },
    ]);
    r.e.p(0).hand = [];
    expect(skillOptions(r.e, 0)).toEqual([]);
  });

  it('throws the card away and heals the player chosen by one hit point, once a turn', async () => {
    const r = tuo();
    const [sha, spare] = hold(r.e, 0, 'sha', 'shan');
    r.e.p(2).hp = 1;
    expect(await cast(r, 0, 'qingnang', [sha], [2])).toBe(true);
    expect(r.log).toEqual([
      { k: 'skill', seat: 0, skill: 'qingnang', targets: [2] },
      { k: 'discard', seat: 0, cards: [info(sha)] },
      { k: 'heal', seat: 2, n: 1 },
    ]);
    expect(r.e.p(2).hp).toBe(2);
    expect(r.e.p(0).hand).toEqual([spare]);
    expect(skillOptions(r.e, 0)).toEqual([]);
    expect(await cast(r, 0, 'qingnang', [spare], [2])).toBe(false);
  });

  it('may be used on himself', async () => {
    const r = tuo();
    const [sha] = hold(r.e, 0, 'sha');
    r.e.p(0).hp = 2;
    expect(skillOptions(r.e, 0)[0]?.targets?.options).toEqual([0]);
    expect(await cast(r, 0, 'qingnang', [sha], [0])).toBe(true);
    expect(r.e.p(0).hp).toBe(3);
  });

  it('refuses a player who is not hurt, two cards, or two players', async () => {
    const r = tuo();
    const [a, b] = hold(r.e, 0, 'sha', 'sha');
    r.e.p(2).hp = 1;
    r.e.p(3).hp = 1;
    expect(await cast(r, 0, 'qingnang', [a], [1])).toBe(false);
    expect(await cast(r, 0, 'qingnang', [a, b], [2])).toBe(false);
    expect(await cast(r, 0, 'qingnang', [a], [2, 3])).toBe(false);
    expect(await cast(r, 0, 'qingnang', [a], [])).toBe(false);
    expect(r.log).toEqual([]);
  });
});

describe('Guan Yu: Wusheng', () => {
  const yu = (seat = 0): Rig => rig(5, { heroes: { [seat]: 'guanyu' } });

  it('lets any red card, and no black one, be played as a Strike', () => {
    const r = yu();
    const [heart, diamond, , , redSha] = hold(
      r.e, 0, ['tao', 'heart', 3], ['wuzhong', 'diamond', 4], ['tao', 'spade', 5], ['tao', 'club', 6], ['sha', 'heart', 7],
    );
    const strikes = legalUses(r.e, 0).filter((u) => u.as === 'sha');
    expect(strikes.map((u) => [u.card, u.skill])).toEqual([[heart.id, 'wusheng'], [diamond.id, 'wusheng'], [redSha.id, undefined]]);
  });

  it('plays it as a Strike that counts as one, and says what it was', async () => {
    const r = yu();
    const [tao] = hold(r.e, 0, ['tao', 'heart', 3]);
    expect(await use(r, 0, tao, 'sha', [1])).toBe(false);
    expect(await use(r, 0, tao, 'sha', [1], 'wusheng')).toBe(true);
    expect(r.entries('use')).toEqual([{ k: 'use', seat: 0, name: 'sha', cards: [info(tao)], targets: [1], skill: 'wusheng' }]);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
    expect(r.e.flags.sha).toBe(1);
    expect(legalUses(r.e, 0)).toEqual([]);
  });

  it('lets a red card answer for a Strike, in a Duel for one', async () => {
    const r = yu(1);
    const [duel] = hold(r.e, 0, 'juedou');
    const [heart] = hold(r.e, 1, ['tao', 'heart', 3]);
    r.answer(1, 'sha', first);
    await use(r, 0, duel, 'juedou', [1]);
    expect(r.entries('play')).toEqual([{ k: 'play', seat: 1, name: 'sha', cards: [info(heart)], skill: 'wusheng' }]);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 0, n: 1, source: 1 }]);
  });

  it('does not let a black card answer', () => {
    const r = yu();
    hold(r.e, 0, ['tao', 'spade', 3], ['shan', 'club', 4]);
    expect(serving(r.e, 0, 'sha')).toEqual([]);
  });
});

describe('Zhao Yun: Longdan', () => {
  it('lets a Dodge be played as a Strike', async () => {
    const r = rig(5, { heroes: { 0: 'zhaoyun' } });
    const [shan] = hold(r.e, 0, 'shan');
    expect(legalUses(r.e, 0)).toEqual([{ card: shan.id, as: 'sha', skill: 'longdan', targets: { min: 1, max: 1, options: [1, 4] } }]);
    expect(await use(r, 0, shan, 'sha', [1], 'longdan')).toBe(true);
    expect(r.entries('use')).toEqual([{ k: 'use', seat: 0, name: 'sha', cards: [info(shan)], targets: [1], skill: 'longdan' }]);
    expect(r.entries('damage')).toHaveLength(1);
    expect(r.e.flags.sha).toBe(1);
  });

  it('lets a Strike be played as a Dodge', async () => {
    const r = rig(5, { heroes: { 1: 'zhaoyun' } });
    const [sha] = hold(r.e, 1, 'sha');
    r.answer(1, 'shan', first);
    await strike(r);
    expect(r.entries('play')).toEqual([{ k: 'play', seat: 1, name: 'shan', cards: [info(sha)], skill: 'longdan' }]);
    expect(r.entries('damage')).toEqual([]);
  });

  it('lets a Dodge answer a Duel as a Strike', async () => {
    const r = rig(5, { heroes: { 1: 'zhaoyun' } });
    const [duel] = hold(r.e, 0, 'juedou');
    const [shan] = hold(r.e, 1, 'shan');
    r.answer(1, 'sha', first);
    await use(r, 0, duel, 'juedou', [1]);
    expect(r.entries('play')).toEqual([{ k: 'play', seat: 1, name: 'sha', cards: [info(shan)], skill: 'longdan' }]);
  });
});

describe('Zhen Ji: Qingguo', () => {
  it('lets a black card, and no red one, be played as a Dodge', async () => {
    const r = rig(5, { heroes: { 1: 'zhenji' } });
    const [red, black] = hold(r.e, 1, ['sha', 'heart', 5], ['tao', 'club', 6]);
    expect(serving(r.e, 1, 'shan')).toEqual([black]);
    r.answer(1, 'shan', first);
    await strike(r);
    expect(r.entries('play')).toEqual([{ k: 'play', seat: 1, name: 'shan', cards: [info(black)], skill: 'qingguo' }]);
    expect(r.entries('damage')).toEqual([]);
    expect(r.e.p(1).hand).toEqual([red]);
  });
});

describe('Hua Tuo: Jijiu', () => {
  it('lets a red card be played as a Peach to save a player in a turn that is not his', async () => {
    const r = rig(5, { turn: 2, heroes: { 1: 'huatuo' } });
    const [heart] = hold(r.e, 1, ['sha', 'heart', 5]);
    r.e.p(3).hp = 1;
    r.answer(1, 'tao', first);
    await r.e.damage(3, 1, 2);
    expect(r.asks('tao').map((a) => a.seat)).toEqual([1]);
    expect(r.entries('play')).toEqual([{ k: 'play', seat: 1, name: 'tao', cards: [info(heart)], skill: 'jijiu', for: 3 }]);
    expect(r.e.p(3)).toMatchObject({ hp: 1, alive: true });
  });

  it('does not on his own turn, and never with a black card', () => {
    const r = rig(5, { turn: 1, heroes: { 1: 'huatuo' } });
    const [heart, spade] = hold(r.e, 1, ['sha', 'heart', 5], ['sha', 'spade', 5]);
    expect(serving(r.e, 1, 'tao')).toEqual([]);
    r.e.turn = 2;
    expect(serving(r.e, 1, 'tao')).toEqual([heart]);
    expect(serving(r.e, 1, 'tao')).not.toContain(spade);
  });

  it('is not a way to play a Peach in the play phase', () => {
    const r = rig(5, { heroes: { 0: 'huatuo' } });
    r.e.p(0).hp = 1;
    hold(r.e, 0, ['sha', 'heart', 5]);
    expect(legalUses(r.e, 0).map((u) => u.as)).toEqual(['sha']);
  });
});

describe('Da Qiao: Guose', () => {
  it('lets a diamond card be played as Lebu', async () => {
    const r = rig(5, { heroes: { 0: 'daqiao' } });
    const [diamond, heart] = hold(r.e, 0, ['sha', 'diamond', 5], ['sha', 'heart', 5]);
    expect(legalUses(r.e, 0).filter((u) => u.as === 'lebu')).toEqual([
      { card: diamond.id, as: 'lebu', skill: 'guose', targets: { min: 1, max: 1, options: [1, 2, 3, 4] } },
    ]);
    expect(await use(r, 0, heart, 'lebu', [2], 'guose')).toBe(false);
    expect(await use(r, 0, diamond, 'lebu', [2], 'guose')).toBe(true);
    expect(r.entries('use')).toEqual([{ k: 'use', seat: 0, name: 'lebu', cards: [info(diamond)], targets: [2], skill: 'guose' }]);
    expect(r.e.p(2).judges).toEqual([{ card: diamond, as: 'lebu' }]);
  });

  it('plays a diamond Lebu as itself', () => {
    const r = rig(5, { heroes: { 0: 'daqiao' } });
    const [lebu] = hold(r.e, 0, ['lebu', 'diamond', 5]);
    expect(legalUses(r.e, 0)).toEqual([{ card: lebu.id, as: 'lebu', targets: { min: 1, max: 1, options: [1, 2, 3, 4] } }]);
  });
});

describe('Gan Ning: Qixi', () => {
  it('lets a black card be played as Dismantle', async () => {
    const r = rig(5, { heroes: { 0: 'ganning' } });
    const [spade, heart] = hold(r.e, 0, ['sha', 'spade', 5], ['sha', 'heart', 5]);
    const [theirs] = hold(r.e, 1, 'shan');
    expect(legalUses(r.e, 0).filter((u) => u.as === 'chai')).toEqual([
      { card: spade.id, as: 'chai', skill: 'qixi', targets: { min: 1, max: 1, options: [1] } },
    ]);
    expect(await use(r, 0, heart, 'chai', [1], 'qixi')).toBe(false);
    r.answer(0, 'chai', area('hand'));
    expect(await use(r, 0, spade, 'chai', [1], 'qixi')).toBe(true);
    expect(r.entries('use')).toEqual([{ k: 'use', seat: 0, name: 'chai', cards: [info(spade)], targets: [1], skill: 'qixi' }]);
    expect(r.entries('discard')).toEqual([{ k: 'discard', seat: 0, from: 1, cards: [info(theirs)] }]);
    expect(r.e.trash).toEqual(expect.arrayContaining([spade, theirs]));
  });

  it('plays a black Dismantle as itself', () => {
    const r = rig(5, { heroes: { 0: 'ganning' } });
    const [chai] = hold(r.e, 0, ['chai', 'club', 5]);
    hold(r.e, 1, 'shan');
    expect(legalUses(r.e, 0).filter((u) => u.as === 'chai')).toEqual([
      { card: chai.id, as: 'chai', targets: { min: 1, max: 1, options: [1] } },
    ]);
  });
});

describe('Zhang Fei: Paoxiao', () => {
  it('sets no limit to the Strikes he plays in a turn', async () => {
    const r = rig(5, { heroes: { 0: 'zhangfei' } });
    for (let i = 0; i < 3; i++) await strike(r);
    expect(r.e.flags.sha).toBe(3);
    expect(r.entries('damage')).toHaveLength(3);
    hold(r.e, 0, 'sha');
    expect(legalUses(r.e, 0)).toHaveLength(1);
  });
});

describe('Ma Chao: Mashu and Tieqi', () => {
  const chao = (): Rig => rig(5, { heroes: { 0: 'machao' } });

  it('Mashu: brings every other player one seat nearer, so a Strike reaches two seats away', () => {
    const r = chao();
    hold(r.e, 0, 'sha');
    expect(legalUses(r.e, 0)[0]?.targets.options).toEqual([1, 2, 3, 4]);
    const other = rig();
    hold(other.e, 0, 'sha');
    expect(legalUses(other.e, 0)[0]?.targets.options).toEqual([1, 4]);
  });

  it('Tieqi: a red judgement means the Strike cannot be dodged', async () => {
    const r = chao();
    hold(r.e, 1, 'shan');
    const [flip] = stack(r.e, ['sha', 'heart', 2]);
    r.answer(1, 'shan', first);
    await strike(r);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 0, skill: 'tieqi', targets: [1] }]);
    expect(r.entries('judge')).toEqual([{ k: 'judge', seat: 0, card: info(flip), why: 'tieqi' }]);
    expect(r.asks('shan')).toEqual([]);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
  });

  it('Tieqi: a black judgement leaves the Dodge to the player aimed at', async () => {
    const r = chao();
    hold(r.e, 1, 'shan');
    stack(r.e, ['sha', 'club', 2]);
    r.answer(1, 'shan', first);
    await strike(r);
    expect(r.asks('shan')).toHaveLength(1);
    expect(r.entries('damage')).toEqual([]);
  });

  it('Tieqi: judges once for each player a Strike is aimed at', async () => {
    const r = chao();
    wear(r.e, 0, 'fangtian');
    const [sha] = hold(r.e, 0, 'sha');
    stack(r.e, ['sha', 'heart', 2], ['sha', 'heart', 3]);
    expect(await use(r, 0, sha, 'sha', [1, 2])).toBe(true);
    expect(r.entries('judge')).toHaveLength(2);
    expect(r.entries('damage').map((d) => d.seat)).toEqual([1, 2]);
  });
});

describe('Zhuge Liang: Kongcheng', () => {
  it('keeps a Strike and a Duel off him while his hand is empty, but no other card', () => {
    const r = rig(5, { heroes: { 1: 'zhugeliang' } });
    hold(r.e, 0, 'sha', 'juedou', 'chai', 'shun');
    wear(r.e, 1, 'bagua');
    expect(aim(r, 0, 'sha')).toEqual([4]);
    expect(aim(r, 0, 'juedou')).toEqual([2, 3, 4]);
    expect(aim(r, 0, 'chai')).toEqual([1]);
    expect(aim(r, 0, 'shun')).toEqual([1]);
    hold(r.e, 1, 'shan');
    expect(aim(r, 0, 'sha')).toEqual([1, 4]);
    expect(aim(r, 0, 'juedou')).toEqual([1, 2, 3, 4]);
  });
});

describe('Zhuge Liang: Guanxing', () => {
  const liang = (): Rig => rig(5, { heroes: { 0: 'zhugeliang' } });

  it('shows the top five cards of the pile and puts the ones chosen at the bottom', async () => {
    const r = liang();
    const top = stack(r.e, 'sha', 'shan', 'tao', 'wuzhong', 'chai', 'shun');
    const before = [...r.e.pile];
    r.answer(0, 'guanxing', pick(top[0], top[2]));
    await startPhase(r.e, 0);
    expect(r.asks('guanxing')).toEqual([
      { seat: 0, ask: { k: 'cards', why: 'guanxing', ctx: {}, cards: top.slice(0, 5).map((c) => c.id), min: 0, max: 5 } },
    ]);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 0, skill: 'guanxing' }]);
    expect(r.e.pile).toEqual([top[1], top[3], top[4], top[5], ...before.slice(6), top[0], top[2]]);
  });

  it('puts them at the bottom in the order chosen', async () => {
    const r = liang();
    const top = stack(r.e, 'sha', 'shan', 'tao');
    r.answer(0, 'guanxing', pick(top[2], top[0], top[1]));
    await startPhase(r.e, 0);
    expect(r.e.pile.slice(-3)).toEqual([top[2], top[0], top[1]]);
  });

  it.each([['no one answers', null], ['none is chosen', pick()], ['a card is chosen that was not shown', pick({ id: 7777, name: 'sha', suit: 'spade', rank: 7 })]] as const)(
    'leaves the pile as it was when %s',
    async (_why, reply) => {
      const r = liang();
      stack(r.e, 'sha', 'shan', 'tao');
      const before = [...r.e.pile];
      r.answer(0, 'guanxing', reply);
      await startPhase(r.e, 0);
      expect(r.e.pile).toEqual(before);
    },
  );

  it('looks at as many cards as there are players left, up to five', async () => {
    const r = liang();
    out(r.e, 3, 4);
    stack(r.e, 'sha', 'shan', 'tao', 'wuzhong', 'chai');
    await startPhase(r.e, 0);
    const ask = r.asks('guanxing')[0]?.ask;
    expect(ask).toMatchObject({ k: 'cards', min: 0, max: 3 });
    expect(ask?.k === 'cards' ? ask.cards : []).toHaveLength(3);
  });

  it('shuffles the discards into a short pile before it looks', async () => {
    const r = liang();
    const cards = stack(r.e, 'sha', 'shan', 'tao', 'chai', 'shun', 'wuzhong', 'nanman');
    r.e.pile.splice(0, r.e.pile.length, cards[0], cards[1]);
    r.e.trash.splice(0, r.e.trash.length, ...cards.slice(2));
    await startPhase(r.e, 0);
    expect(r.entries('shuffle')).toEqual([{ k: 'shuffle' }]);
    const ask = r.asks('guanxing')[0]?.ask;
    expect(ask?.k === 'cards' ? ask.cards.slice(0, 2) : []).toEqual([cards[0].id, cards[1].id]);
    expect(ask).toMatchObject({ max: 5 });
    expect(r.e.pile).toHaveLength(7);
    expect(r.e.trash).toEqual([]);
  });

  it('has nothing to look at when no card is left anywhere', async () => {
    const r = liang();
    r.e.pile.length = 0;
    r.e.trash.length = 0;
    await startPhase(r.e, 0);
    expect(r.asked).toEqual([]);
    expect(r.log).toEqual([]);
  });
});

describe('Zhen Ji: Luoshen', () => {
  const ji = (): Rig => rig(5, { heroes: { 0: 'zhenji' } });

  it('flips cards while they are black, keeping them, and stops at the first red one, which goes to the discards', async () => {
    const r = ji();
    const flips = stack(r.e, ['sha', 'spade', 3], ['sha', 'club', 4], ['sha', 'heart', 5], ['sha', 'spade', 6]);
    r.answer(0, 'luoshen', yes);
    await startPhase(r.e, 0);
    expect(r.asks('luoshen')).toEqual(Array(3).fill({ seat: 0, ask: { k: 'confirm', why: 'luoshen', ctx: {} } }));
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 0, skill: 'luoshen' }]);
    expect(r.entries('judge')).toEqual(flips.slice(0, 3).map((c) => ({ k: 'judge', seat: 0, card: info(c), why: 'luoshen' })));
    expect(r.entries('take')).toEqual(
      flips.slice(0, 2).map((c) => ({ k: 'take', seat: 0, from: null, cards: [info(c)], zone: 'limbo' })),
    );
    expect(r.e.p(0).hand).toEqual([flips[0], flips[1]]);
    expect(r.e.trash).toContain(flips[2]);
    expect(r.e.pile[0]).toBe(flips[3]);
  });

  it('stops when she says she has had enough', async () => {
    const r = ji();
    const flips = stack(r.e, ['sha', 'spade', 3], ['sha', 'club', 4], ['sha', 'spade', 5]);
    r.answer(0, 'luoshen', no);
    r.once(0, 'luoshen', yes);
    await startPhase(r.e, 0);
    expect(r.asks('luoshen')).toHaveLength(2);
    expect(r.entries('judge')).toHaveLength(1);
    expect(r.e.p(0).hand).toEqual([flips[0]]);
  });

  it('does nothing if she says no at once, or is not asked at all when she is another hero', async () => {
    const r = ji();
    r.answer(0, 'luoshen', no);
    await startPhase(r.e, 0);
    expect(r.asks('luoshen')).toHaveLength(1);
    expect(r.log).toEqual([]);
    const other = rig();
    await startPhase(other.e, 0);
    expect(other.asked).toEqual([]);
  });

  it('stops when no card is left to flip, taking nothing', async () => {
    const r = ji();
    r.e.pile.length = 0;
    r.e.trash.length = 0;
    r.answer(0, 'luoshen', yes);
    await startPhase(r.e, 0);
    expect(r.asks('luoshen')).toHaveLength(1);
    expect(r.entries('judge')).toEqual([]);
    expect(r.e.p(0).hand).toEqual([]);
  });

  it('flips no more than thirty times, however kind the cards are', async () => {
    const r = ji();
    stack(r.e, ...Array.from({ length: 40 }, () => ['sha', 'spade', 3] as const));
    r.answer(0, 'luoshen', yes);
    await startPhase(r.e, 0);
    expect(r.asks('luoshen')).toHaveLength(30);
    expect(r.e.p(0).hand).toHaveLength(30);
  });

  it('lets Guicai change what she flips, and counts the card that stands', async () => {
    const r = rig(5, { heroes: { 0: 'zhenji', 2: 'simayi' } });
    stack(r.e, ['sha', 'heart', 3]);
    const [swap] = hold(r.e, 2, ['sha', 'spade', 9]);
    r.answer(0, 'luoshen', yes);
    r.once(0, 'luoshen', yes);
    r.answer(2, 'guicai', pick(swap));
    await startPhase(r.e, 0);
    expect(r.e.p(0).hand).toContain(swap);
  });
});

describe('Huang Yueying: Jizhi', () => {
  const ying = (): Rig => rig(5, { heroes: { 0: 'huangyueying' } });

  it('draws a card for each trick she plays that works at once, before the trick works', async () => {
    const r = ying();
    const [windfall] = hold(r.e, 0, 'wuzhong');
    const drawn = stack(r.e, ['sha', 'heart', 2], ['sha', 'heart', 3], ['sha', 'heart', 4]);
    await use(r, 0, windfall);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 0, skill: 'jizhi' }]);
    expect(r.entries('draw').map((d) => d.n)).toEqual([1, 2]);
    expect(r.e.p(0).hand).toEqual(drawn);
  });

  it('draws even if the trick is then cancelled', async () => {
    const r = ying();
    const [duel] = hold(r.e, 0, 'juedou');
    hold(r.e, 2, 'wuxie');
    r.answer(2, 'wuxie', first);
    await use(r, 0, duel, 'juedou', [1]);
    expect(r.entries('cancel')).toHaveLength(1);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 0, skill: 'jizhi' }]);
    expect(r.e.p(0).hand).toHaveLength(1);
  });

  it('draws nothing for a Strike, a Peach, equipment or a trick that waits', async () => {
    const r = ying();
    r.e.p(0).hp = 2;
    const [sha, tao, gun, lebu, bolt] = hold(r.e, 0, 'sha', 'tao', 'zhuge', 'lebu', 'shandian');
    await use(r, 0, sha, 'sha', [1]);
    await use(r, 0, tao);
    await use(r, 0, gun);
    await use(r, 0, lebu, 'lebu', [2]);
    await use(r, 0, bolt);
    expect(r.entries('use')).toHaveLength(5);
    expect(r.entries('skill')).toEqual([]);
    expect(r.entries('draw')).toEqual([]);
  });

  it('draws nothing for a Nullification she plays', async () => {
    const r = ying();
    hold(r.e, 0, 'wuxie');
    const [windfall] = hold(r.e, 1, 'wuzhong');
    r.answer(0, 'wuxie', first);
    await use(r, 1, windfall);
    expect(r.entries('cancel')).toHaveLength(1);
    expect(r.entries('skill')).toEqual([]);
  });
});

describe('Huang Yueying: Qicai', () => {
  it('lets her aim Steal and Bing at players beyond arm’s reach', () => {
    const r = rig(8, { heroes: { 0: 'huangyueying' } });
    hold(r.e, 0, 'shun', 'bing');
    for (const seat of [1, 2, 3, 4, 5, 6, 7]) hold(r.e, seat, 'sha');
    expect(aim(r, 0, 'shun')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(aim(r, 0, 'bing')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    become(r.e, 0, 'liubei');
    expect(aim(r, 0, 'shun')).toEqual([1, 7]);
    expect(aim(r, 0, 'bing')).toEqual([1, 7]);
  });

  it('does not let her Strike reach farther', () => {
    const r = rig(8, { heroes: { 0: 'huangyueying' } });
    hold(r.e, 0, 'sha');
    expect(aim(r, 0, 'sha')).toEqual([1, 7]);
  });
});

describe('Lu Xun: Qianxun', () => {
  it('keeps Steal and Lebu off him, but not any other card', () => {
    const r = rig(5, { heroes: { 1: 'luxun' } });
    hold(r.e, 0, 'shun', 'lebu', 'bing', 'chai', 'sha', 'juedou');
    hold(r.e, 1, 'shan');
    hold(r.e, 4, 'shan');
    expect(aim(r, 0, 'shun')).toEqual([4]);
    expect(aim(r, 0, 'lebu')).toEqual([2, 3, 4]);
    expect(aim(r, 0, 'bing')).toEqual([1, 4]);
    expect(aim(r, 0, 'chai')).toEqual([1, 4]);
    expect(aim(r, 0, 'sha')).toEqual([1, 4]);
    expect(aim(r, 0, 'juedou')).toEqual([1, 2, 3, 4]);
  });
});

describe('Lu Xun: Lianying', () => {
  const xun = (): Rig => rig(5, { heroes: { 1: 'luxun' } });

  it('draws a card when his last hand card is taken by Dismantle', async () => {
    const r = xun();
    const [chai] = hold(r.e, 0, 'chai');
    const [only] = hold(r.e, 1, 'sha');
    const [fresh] = stack(r.e, ['tao', 'heart', 5]);
    r.answer(0, 'chai', area('hand'));
    await use(r, 0, chai, 'chai', [1]);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 1, skill: 'lianying' }]);
    expect(r.entries('draw')).toEqual([{ k: 'draw', seat: 1, n: 1, cards: [info(fresh)] }]);
    expect(r.e.p(1).hand).toEqual([fresh]);
    expect(r.e.trash).toContain(only);
  });

  it('draws nothing while cards are left in his hand', async () => {
    const r = xun();
    const [chai] = hold(r.e, 0, 'chai');
    const [one, two] = hold(r.e, 1, 'sha', 'shan');
    r.answer(0, 'chai', area('hand'));
    await use(r, 0, chai, 'chai', [1]);
    expect(r.e.p(1).hand).toEqual([two]);
    expect(r.entries('skill')).toEqual([]);
    expect(r.e.trash).toContain(one);
  });

  it('draws one card when the last card leaves by his own play, before it works', async () => {
    const r = xun();
    const [windfall] = hold(r.e, 1, 'wuzhong');
    stack(r.e, ['tao', 'heart', 2], ['tao', 'heart', 3], ['tao', 'heart', 4]);
    await use(r, 1, windfall);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 1, skill: 'lianying' }]);
    expect(r.entries('draw').map((d) => d.n)).toEqual([1, 2]);
  });

  it('draws one card when the last card is taken by Tuxi, or thrown away', async () => {
    const r = rig(5, { heroes: { 0: 'zhangliao', 1: 'luxun' } });
    hold(r.e, 1, 'sha');
    r.answer(0, 'tuxi', seats(1));
    await drawPhase(r.e, 0);
    expect(r.entries('skill').map((s) => s.skill)).toEqual(['tuxi', 'lianying']);
    expect(r.e.p(1).hand).toHaveLength(1);
    const d = xun();
    const [card] = hold(d.e, 1, 'sha');
    await d.e.discard(1, [card]);
    expect(d.entries('draw')).toHaveLength(1);
  });

  it('draws nothing for equipment lost while his hand is empty', async () => {
    const r = xun();
    const [chai] = hold(r.e, 0, 'chai');
    const gun = wear(r.e, 1, 'zhuge');
    r.answer(0, 'chai', area('equip', gun));
    await use(r, 0, chai, 'chai', [1]);
    expect(r.entries('skill')).toEqual([]);
  });
});

describe('Sun Shangxiang: Xiaoji', () => {
  const xiang = (): Rig => rig(5, { heroes: { 1: 'sunshangxiang' } });

  it('draws two cards each time a piece of her equipment is taken away', async () => {
    const r = xiang();
    const [chai] = hold(r.e, 0, 'chai');
    const gun = wear(r.e, 1, 'zhuge');
    const drawn = stack(r.e, ['tao', 'heart', 2], ['tao', 'heart', 3]);
    r.answer(0, 'chai', area('equip', gun));
    await use(r, 0, chai, 'chai', [1]);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 1, skill: 'xiaoji' }]);
    expect(r.entries('draw')).toEqual([{ k: 'draw', seat: 1, n: 2, cards: drawn.map(info) }]);
    expect(r.e.p(1).hand).toEqual(drawn);
  });

  it('draws two when a piece she wears is replaced, but nothing for putting a piece on a free slot', async () => {
    const r = xiang();
    const [first_, second] = hold(r.e, 1, 'qilin', 'zhuge');
    await use(r, 1, first_);
    expect(r.entries('skill')).toEqual([]);
    await use(r, 1, second);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 1, skill: 'xiaoji' }]);
    expect(r.entries('draw').map((d) => d.n)).toEqual([2]);
    expect(r.e.trash).toContain(first_);
  });

  it('draws two for each of several pieces lost at once', async () => {
    const r = xiang();
    wear(r.e, 1, 'guanshi');
    const horse = wear(r.e, 1, 'dilu');
    const armor = wear(r.e, 1, 'bagua');
    hold(r.e, 0, 'shan');
    hold(r.e, 0, 'shan');
    r.answer(0, 'shan', first);
    r.answer(1, 'guanshi', pick(horse, armor));
    await strike(r, 1, 0);
    expect(r.entries('skill').filter((s) => s.skill === 'xiaoji')).toHaveLength(2);
    expect(r.entries('draw').map((d) => d.n)).toEqual([2, 2]);
  });

  it('draws nothing for the equipment of anyone else', async () => {
    const r = xiang();
    const [chai] = hold(r.e, 0, 'chai');
    const gun = wear(r.e, 2, 'zhuge');
    r.answer(0, 'chai', area('equip', gun));
    await use(r, 0, chai, 'chai', [2]);
    expect(r.entries('skill')).toEqual([]);
  });
});

describe('Guo Jia: Tiandu and Yiji', () => {
  const jia = (): Rig => rig(5, { heroes: { 1: 'guojia' } });

  it('Tiandu: takes the card of his own judgement into his hand', async () => {
    const r = jia();
    const [flip] = stack(r.e, ['sha', 'heart', 5]);
    expect(await r.e.judge(1, 'lebu')).toBe(flip);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 1, skill: 'tiandu' }]);
    expect(r.entries('take')).toEqual([{ k: 'take', seat: 1, from: null, cards: [info(flip)], zone: 'limbo' }]);
    expect(r.e.p(1).hand).toEqual([flip]);
    expect(r.e.trash).not.toContain(flip);
  });

  it('Tiandu: leaves the judgement of anyone else to the discards', async () => {
    const r = jia();
    const [flip] = stack(r.e, ['sha', 'heart', 5]);
    await r.e.judge(2, 'lebu');
    expect(r.e.trash).toContain(flip);
    expect(r.e.p(1).hand).toEqual([]);
    expect(r.entries('skill')).toEqual([]);
  });

  it('Yiji: draws two cards each time he is hurt and lives, however much he is hurt', async () => {
    const r = jia();
    await r.e.damage(1, 2, 0);
    expect(r.e.p(1).hp).toBe(1);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 1, skill: 'yiji' }]);
    expect(r.entries('draw')).toMatchObject([{ seat: 1, n: 2 }]);
    expect(r.e.p(1).hand).toHaveLength(2);
  });

  it('Yiji: draws nothing when the blow kills him', async () => {
    const r = jia();
    await r.e.damage(1, 3, 0);
    expect(r.entries('die')).toHaveLength(1);
    expect(r.entries('skill')).toEqual([]);
    expect(r.entries('draw')).toEqual([]);
  });
});

describe('Cao Cao: Jianxiong', () => {
  const cao = (): Rig => rig(5, { heroes: { 1: 'caocao' } });

  it('takes the Strike that hurt him, if it is still on the table', async () => {
    const r = cao();
    const sha = await strike(r);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 1, skill: 'jianxiong' }]);
    expect(r.entries('take')).toEqual([{ k: 'take', seat: 1, from: null, cards: [info(sha)], zone: 'limbo' }]);
    expect(r.e.p(1).hand).toEqual([sha]);
    expect(r.e.trash).not.toContain(sha);
  });

  it('takes the trick that hurt him', async () => {
    const r = cao();
    const [duel] = hold(r.e, 0, 'juedou');
    await use(r, 0, duel, 'juedou', [1]);
    expect(r.e.p(1).hand).toEqual([duel]);
    const raid = cao();
    const [barbarians] = hold(raid.e, 0, 'nanman');
    await use(raid, 0, barbarians);
    expect(raid.e.p(1).hand).toEqual([barbarians]);
  });

  it('takes nothing for damage that no card dealt', async () => {
    const r = cao();
    await r.e.damage(1, 1, 0);
    await r.e.damage(1, 1, null);
    expect(r.entries('skill')).toEqual([]);
    expect(r.e.p(1).hand).toEqual([]);
  });

  it('takes nothing when the blow kills him', async () => {
    const r = cao();
    r.e.p(1).hp = 1;
    const sha = await strike(r);
    expect(r.entries('die')).toHaveLength(1);
    expect(r.entries('skill')).toEqual([]);
    expect(r.e.trash).toContain(sha);
  });
});

describe('Si Ma Yi: Fankui', () => {
  const yi = (): Rig => rig(5, { heroes: { 1: 'simayi' } });

  it('takes a card of the player who hurt him, from his hand or what he wears but not what waits for him', async () => {
    const r = yi();
    const [sha, tao] = hold(r.e, 0, 'sha', 'tao');
    const gun = wear(r.e, 0, 'zhuge');
    plant(r.e, 0, 'lebu');
    r.answer(1, 'fankui', area('equip', gun));
    await use(r, 0, sha, 'sha', [1]);
    expect(r.asks('fankui')).toEqual([
      { seat: 1, ask: { k: 'area', why: 'fankui', ctx: { target: 0 }, owner: 0, hand: 1, equip: [gun.id], judges: [] } },
    ]);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 1, skill: 'fankui', targets: [0] }]);
    expect(r.entries('take')).toEqual([{ k: 'take', seat: 1, from: 0, cards: [info(gun)], zone: 'equip' }]);
    expect(r.e.p(1).hand).toEqual([gun]);
    expect(r.e.p(0).hand).toEqual([tao]);
  });

  it('takes a card at random from the hand when that is what he chooses', async () => {
    const r = rig(5, { heroes: { 1: 'simayi' }, random: () => 0.99 });
    const [sha] = hold(r.e, 0, 'sha');
    const [, last] = hold(r.e, 0, 'tao', 'shan');
    r.answer(1, 'fankui', area('hand'));
    await use(r, 0, sha, 'sha', [1]);
    expect(r.e.p(1).hand).toEqual([last]);
  });

  it('takes nothing from a player who has no card to take, or from no one', async () => {
    const r = yi();
    await strike(r);
    await r.e.damage(1, 1, null);
    expect(r.asks('fankui')).toEqual([]);
    expect(r.entries('skill')).toEqual([]);
  });
});

describe('Si Ma Yi: Guicai', () => {
  it('lets a hand card take the place of a judgement before it counts', async () => {
    const r = rig(5, { heroes: { 2: 'simayi' } });
    const [flip] = stack(r.e, ['sha', 'club', 5]);
    const [swap] = hold(r.e, 2, ['sha', 'heart', 9]);
    r.answer(2, 'guicai', pick(swap));
    expect(await r.e.judge(0, 'lebu')).toBe(swap);
    expect(r.asks('guicai')).toEqual([
      { seat: 2, ask: { k: 'cards', why: 'guicai', ctx: { target: 0, card: info(flip) }, cards: [swap.id], min: 0, max: 1 } },
    ]);
    expect(r.entries('judge')).toEqual([
      { k: 'judge', seat: 0, card: info(flip), why: 'lebu' },
      { k: 'judge', seat: 0, card: info(swap), why: 'lebu' },
    ]);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 2, skill: 'guicai' }]);
    expect(r.e.trash).toEqual(expect.arrayContaining([flip, swap]));
    expect(r.e.p(2).hand).toEqual([]);
  });

  it('works for the judgement of anyone, each holder in turn order from the player judged, who sees the card as it then stands', async () => {
    const r = rig(5, { heroes: { 1: 'simayi', 3: 'simayi' } });
    const [flip] = stack(r.e, ['sha', 'club', 5]);
    const [late] = hold(r.e, 1, ['sha', 'diamond', 6]);
    const [early] = hold(r.e, 3, ['sha', 'heart', 5]);
    r.answer(3, 'guicai', pick(early));
    r.answer(1, 'guicai', pick(late));
    expect(await r.e.judge(2, 'bing')).toBe(late);
    expect(r.asks('guicai').map((a) => [a.seat, a.ask.k === 'cards' ? a.ask.ctx.card : null])).toEqual([
      [3, info(flip)], [1, info(early)],
    ]);
    expect(r.e.trash).toEqual(expect.arrayContaining([flip, early, late]));
  });

  it('may be left alone, which leaves the card flipped', async () => {
    const r = rig(5, { heroes: { 2: 'simayi' } });
    const [flip] = stack(r.e, ['sha', 'club', 5]);
    const [keep] = hold(r.e, 2, ['sha', 'heart', 9]);
    expect(await r.e.judge(0, 'lebu')).toBe(flip);
    expect(r.entries('skill')).toEqual([]);
    expect(r.e.p(2).hand).toEqual([keep]);
  });

  it('is not asked of a player with no hand', async () => {
    const r = rig(5, { heroes: { 2: 'simayi' } });
    await r.e.judge(0, 'lebu');
    expect(r.asks('guicai')).toEqual([]);
  });

  it('may change his own judgement', async () => {
    const r = rig(5, { heroes: { 2: 'simayi' } });
    stack(r.e, ['sha', 'club', 5]);
    const [swap] = hold(r.e, 2, ['sha', 'heart', 9]);
    r.answer(2, 'guicai', pick(swap));
    expect(await r.e.judge(2, 'lebu')).toBe(swap);
  });
});

describe('Xiahou Dun: Ganglie', () => {
  const dun = (): Rig => rig(5, { heroes: { 1: 'xiahoudun' } });

  it('does nothing more when the judgement is a heart', async () => {
    const r = dun();
    const [flip] = stack(r.e, ['sha', 'heart', 3]);
    await strike(r);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 1, skill: 'ganglie', targets: [0] }]);
    expect(r.entries('judge')).toEqual([{ k: 'judge', seat: 1, card: info(flip), why: 'ganglie' }]);
    expect(r.asks('ganglie')).toEqual([]);
    expect(r.entries('damage')).toHaveLength(1);
  });

  it('makes the player who hurt him throw away two cards, if he will', async () => {
    const r = dun();
    stack(r.e, ['sha', 'spade', 3]);
    const [hit] = hold(r.e, 0, 'sha');
    const [x, y, z] = hold(r.e, 0, 'tao', 'tao', 'tao');
    r.answer(0, 'ganglie', pick(x, y));
    await use(r, 0, hit, 'sha', [1]);
    expect(r.asks('ganglie')).toEqual([
      { seat: 0, ask: { k: 'cards', why: 'ganglie', ctx: { from: 1 }, cards: [x.id, y.id, z.id], min: 0, max: 2 } },
    ]);
    expect(r.entries('discard')).toEqual([{ k: 'discard', seat: 0, cards: [info(x), info(y)] }]);
    expect(r.entries('damage')).toHaveLength(1);
    expect(r.e.p(0).hand).toEqual([z]);
  });

  it('otherwise hurts that player by one', async () => {
    const r = dun();
    stack(r.e, ['sha', 'club', 3]);
    const [hit] = hold(r.e, 0, 'sha');
    hold(r.e, 0, 'tao', 'tao');
    r.answer(0, 'ganglie', no);
    await use(r, 0, hit, 'sha', [1]);
    expect(r.entries('damage')).toEqual([
      { k: 'damage', seat: 1, n: 1, source: 0 },
      { k: 'damage', seat: 0, n: 1, source: 1 },
    ]);
    expect(r.e.p(0).hand).toHaveLength(2);
  });

  it('hurts that player at once, without asking, if he has fewer than two cards', async () => {
    const r = dun();
    stack(r.e, ['sha', 'spade', 3]);
    const [hit] = hold(r.e, 0, 'sha');
    hold(r.e, 0, 'tao');
    await use(r, 0, hit, 'sha', [1]);
    expect(r.asks('ganglie')).toEqual([]);
    expect(r.entries('damage').map((d) => [d.seat, d.n, d.source])).toEqual([[1, 1, 0], [0, 1, 1]]);
  });

  it('can kill, and the kill is his, with the reward that goes with it', async () => {
    const r = rig(5, { turn: 2, heroes: { 1: 'xiahoudun' } });
    stack(r.e, ['sha', 'spade', 3]);
    r.e.p(2).hp = 1;
    const [hit] = hold(r.e, 2, 'sha');
    await use(r, 2, hit, 'sha', [1]);
    expect(r.entries('die')).toEqual([{ k: 'die', seat: 2, role: 'rebel', killer: 1 }]);
    expect(r.entries('draw')).toMatchObject([{ seat: 1, n: 3 }]);
  });

  it('can end the game when the lord is the one he kills', async () => {
    const r = dun();
    stack(r.e, ['sha', 'spade', 3]);
    r.e.p(0).hp = 1;
    const [hit] = hold(r.e, 0, 'sha');
    expect(await over(use(r, 0, hit, 'sha', [1]))).toBe('rebel');
    expect(r.entries('die')).toEqual([{ k: 'die', seat: 0, role: 'lord', killer: 1 }]);
  });

  it('does not work when the blow kills him, or when no one dealt it', async () => {
    const r = dun();
    r.e.p(1).hp = 1;
    await strike(r);
    expect(r.entries('skill')).toEqual([]);
    const s = dun();
    await s.e.damage(1, 1, null);
    expect(s.entries('skill')).toEqual([]);
    expect(s.entries('judge')).toEqual([]);
  });
});

describe('Zhang Liao: Tuxi', () => {
  const liao = (random = () => 0): Rig => rig(5, { heroes: { 0: 'zhangliao' }, random });

  it('takes a card at random from up to two players with cards, instead of drawing', async () => {
    const r = liao(() => 0.99);
    const [, b] = hold(r.e, 1, 'sha', 'shan');
    const [c] = hold(r.e, 3, 'tao');
    r.answer(0, 'tuxi', seats(1, 3));
    await drawPhase(r.e, 0);
    expect(r.asks('tuxi')).toEqual([{ seat: 0, ask: { k: 'seat', why: 'tuxi', ctx: {}, options: [1, 3], min: 0, max: 2 } }]);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 0, skill: 'tuxi', targets: [1, 3] }]);
    expect(r.entries('take')).toEqual([
      { k: 'take', seat: 0, from: 1, cards: [info(b)], zone: 'hand' },
      { k: 'take', seat: 0, from: 3, cards: [info(c)], zone: 'hand' },
    ]);
    expect(r.entries('draw')).toEqual([]);
    expect(r.e.p(0).hand).toEqual([b, c]);
  });

  it('may take from one player only', async () => {
    const r = liao();
    const [a] = hold(r.e, 2, 'sha', 'shan');
    r.answer(0, 'tuxi', seats(2));
    await drawPhase(r.e, 0);
    expect(r.e.p(0).hand).toEqual([a]);
    expect(r.entries('draw')).toEqual([]);
  });

  it('draws as usual when he takes from no one', async () => {
    const r = liao();
    hold(r.e, 1, 'sha');
    r.answer(0, 'tuxi', seats());
    await drawPhase(r.e, 0);
    expect(r.entries('skill')).toEqual([]);
    expect(r.entries('draw').map((d) => d.n)).toEqual([2]);
    expect(r.e.p(1).hand).toHaveLength(1);
  });

  it('draws as usual when nobody has a card to take, without asking', async () => {
    const r = liao();
    await drawPhase(r.e, 0);
    expect(r.asks('tuxi')).toEqual([]);
    expect(r.entries('draw').map((d) => d.n)).toEqual([2]);
  });

  it.each([
    ['more than two players', seats(1, 2, 3)],
    ['himself', seats(0)],
    ['a player with no hand', seats(4)],
    ['the same player twice', seats(1, 1)],
  ])('draws as usual when he names %s', async (_why, reply) => {
    const r = liao();
    hold(r.e, 1, 'sha');
    hold(r.e, 2, 'sha');
    hold(r.e, 3, 'sha');
    r.answer(0, 'tuxi', reply);
    await drawPhase(r.e, 0);
    expect(r.entries('draw').map((d) => d.n)).toEqual([2]);
    expect([1, 2, 3].map((s) => r.e.p(s).hand.length)).toEqual([1, 1, 1]);
  });
});

describe('Xu Chu: Luoyi', () => {
  const chu = (): Rig => rig(5, { heroes: { 0: 'xuchu' } });

  it('draws one card less, to hit harder with Strikes and Duels for the rest of the turn', async () => {
    const r = chu();
    r.answer(0, 'luoyi', yes);
    await drawPhase(r.e, 0);
    expect(r.asks('luoyi')).toEqual([{ seat: 0, ask: { k: 'confirm', why: 'luoyi', ctx: {} } }]);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 0, skill: 'luoyi' }]);
    expect(r.entries('draw').map((d) => d.n)).toEqual([1]);
    expect(r.e.flags.luoyi).toBe(true);
    await strike(r);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 2, source: 0 }]);
    const [duel] = hold(r.e, 0, 'juedou');
    await use(r, 0, duel, 'juedou', [2]);
    expect(r.entries('damage').at(-1)).toEqual({ k: 'damage', seat: 2, n: 2, source: 0 });
  });

  it('draws the usual two cards, and hits no harder, when he says no', async () => {
    const r = chu();
    r.answer(0, 'luoyi', no);
    await drawPhase(r.e, 0);
    expect(r.entries('draw').map((d) => d.n)).toEqual([2]);
    expect(r.entries('skill')).toEqual([]);
    await strike(r);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
  });

  it('makes Barbarians and Arrows no worse', async () => {
    const r = chu();
    r.e.flags.luoyi = true;
    const [raid, arrows] = hold(r.e, 0, 'nanman', 'wanjian');
    await use(r, 0, raid);
    await use(r, 0, arrows);
    expect(r.entries('damage').every((d) => d.n === 1)).toBe(true);
    expect(r.entries('damage')).toHaveLength(8);
  });

  it('does not harden the Strikes of a turn that is someone else’s', async () => {
    const r = chu();
    r.e.flags.luoyi = true;
    r.e.turn = 3;
    const [sha] = hold(r.e, 0, 'sha');
    await use(r, 0, sha, 'sha', [1]);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
  });
});

describe('Lü Meng: Keji', () => {
  it('skips the discard phase when he played no Strike all turn, however many cards he holds', async () => {
    const g = await game({
      stage: (e) => {
        become(e, 0, 'lvmeng');
        hold(e, 0, 'tao', 'tao', 'tao', 'tao', 'tao');
      },
      until: endOfTurn,
    });
    expect(g.log).toContainEqual({ k: 'skip', seat: 0, phase: 'discard' });
    expect(g.e.p(0).hand.length).toBeGreaterThan(g.e.p(0).hp);
    expect(g.asked.some((a) => a.ask.k === 'cards' && a.ask.why === 'discard')).toBe(false);
  });

  it('discards as usual when he played a Strike', async () => {
    let sha: Card | undefined;
    let played = false;
    const g = await game({
      stage: (e) => {
        become(e, 0, 'lvmeng');
        [sha] = hold(e, 0, 'sha', 'tao', 'tao', 'tao', 'tao', 'tao');
      },
      script: (seat, ask) => {
        if (seat !== 0 || ask.k !== 'play') return null;
        if (played || !sha) return end;
        played = true;
        return { k: 'use', card: sha.id, as: 'sha', targets: [1] };
      },
      until: endOfTurn,
    });
    expect(g.log.some((en) => en.k === 'skip')).toBe(false);
    const asks = g.asked.filter((a) => a.ask.k === 'cards' && a.ask.why === 'discard');
    expect(asks).toHaveLength(1);
    expect(g.e.p(0).hand).toHaveLength(g.e.p(0).hp);
  });

  it('counts a Strike he plays in answer in a Duel, and not one that someone else plays', async () => {
    const duelled = (lvMengHasStrike: boolean) =>
      game({
        stage: (e) => {
          for (const seat of [0, 1]) e.p(seat).hand = [];
          become(e, 0, 'lvmeng');
          stack(e, ['tao', 'heart', 2], ['tao', 'heart', 3]);
          hold(e, 0, 'juedou', 'tao', 'tao', 'tao', 'tao', 'tao');
          if (lvMengHasStrike) hold(e, 0, 'sha');
          hold(e, 1, 'sha');
        },
        script: (seat, ask) => {
          if (ask.k === 'play' && seat === 0) {
            const duel = ask.uses.find((u) => u.as === 'juedou');
            return duel ? { k: 'use', card: duel.card, as: 'juedou', targets: [1] } : end;
          }
          return ask.k === 'cards' && ask.why === 'sha' ? first(ask) : null;
        },
        until: endOfTurn,
      });
    const answered = await duelled(true);
    expect(answered.log.filter((en) => en.k === 'play').map((en) => en.k === 'play' && en.seat)).toEqual([1, 0]);
    expect(answered.log.some((en) => en.k === 'skip')).toBe(false);
    const lost = await duelled(false);
    expect(lost.log.filter((en) => en.k === 'play').map((en) => en.k === 'play' && en.seat)).toEqual([1]);
    expect(lost.log).toContainEqual({ k: 'skip', seat: 0, phase: 'discard' });
  });
});

describe('Zhou Yu: Yingzi', () => {
  it('draws three cards for the draw phase', async () => {
    const r = rig(5, { heroes: { 0: 'zhouyu' } });
    await drawPhase(r.e, 0);
    expect(r.entries('draw').map((d) => d.n)).toEqual([3]);
    expect(r.e.p(0).hand).toHaveLength(3);
  });

  it('is what makes the other heroes draw two', async () => {
    const r = rig();
    await drawPhase(r.e, 0);
    expect(r.entries('draw').map((d) => d.n)).toEqual([2]);
  });
});

describe('Lü Bu: Wushuang', () => {
  const bu = (seat = 0): Rig => rig(5, { heroes: { [seat]: 'lvbu' } });
  const needs = (r: Rig, why: 'shan' | 'sha'): [number, number | undefined][] =>
    r.asks(why).map((a) => [a.seat, a.ask.k === 'cards' ? a.ask.ctx.need : undefined]);

  it('needs two Dodges to meet his Strike, asked one after the other', async () => {
    const r = bu();
    hold(r.e, 1, 'shan', 'shan');
    r.answer(1, 'shan', first);
    await strike(r);
    expect(needs(r, 'shan')).toEqual([[1, 2], [1, 1]]);
    expect(r.entries('play').map((p) => p.name)).toEqual(['shan', 'shan']);
    expect(r.entries('damage')).toEqual([]);
  });

  it('hits when the other has only one, which is still lost', async () => {
    const r = bu();
    hold(r.e, 1, 'shan');
    r.answer(1, 'shan', first);
    await strike(r);
    expect(needs(r, 'shan')).toEqual([[1, 2]]);
    expect(r.entries('play')).toHaveLength(1);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
    expect(r.e.p(1).hand).toEqual([]);
  });

  it('needs two Strikes to answer him in a Duel, which he started', async () => {
    const r = bu();
    const [duel] = hold(r.e, 0, 'juedou');
    hold(r.e, 1, 'sha');
    r.answer(1, 'sha', first);
    await use(r, 0, duel, 'juedou', [1]);
    expect(needs(r, 'sha')).toEqual([[1, 2]]);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
  });

  it('needs two Strikes to answer him in a Duel, which he was drawn into', async () => {
    const r = bu(1);
    const [duel] = hold(r.e, 0, 'juedou');
    hold(r.e, 1, 'sha');
    hold(r.e, 0, 'sha', 'sha');
    r.answer(1, 'sha', first);
    r.answer(0, 'sha', first);
    await use(r, 0, duel, 'juedou', [1]);
    expect(needs(r, 'sha')).toEqual([[1, 1], [0, 2], [0, 1]]);
    expect(r.entries('damage')).toEqual([{ k: 'damage', seat: 1, n: 1, source: 0 }]);
  });
});

describe('Diao Chan: Biyue', () => {
  it('draws a card in the end phase', async () => {
    const r = rig(5, { heroes: { 0: 'diaochan' } });
    await endPhase(r.e, 0);
    expect(r.entries('skill')).toEqual([{ k: 'skill', seat: 0, skill: 'biyue' }]);
    expect(r.entries('draw')).toMatchObject([{ seat: 0, n: 1 }]);
    expect(r.e.p(0).hand).toHaveLength(1);
  });

  it('is nothing to the other heroes', async () => {
    const r = rig();
    await endPhase(r.e, 0);
    expect(r.log).toEqual([]);
  });
});
