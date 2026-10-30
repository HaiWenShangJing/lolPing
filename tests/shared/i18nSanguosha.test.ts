import { describe, expect, it } from 'vitest';
import { strings } from '../../src/shared/i18n';
import { CARD_NAMES, DECK_SIZE, RANGE, WEAPONS } from '../../src/shared/teammate/sanguoshaCards';
import { HERO_IDS, KINGDOMS, SKILLS } from '../../src/shared/teammate/sanguoshaHeroes';

const LANGS = ['en', 'zh-CN'] as const;
type Lang = (typeof LANGS)[number];

const words = (lang: Lang) => strings(lang).teammate.games.sanguosha;
const settings = (lang: Lang) => strings(lang).teammate.settings;

// Ideographs and the full-width punctuation of Chinese text: what English must not have and Chinese must.
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
const BROKEN = /undefined|NaN|\[object|\bnull\b/;

type Arg = string | number | boolean | null | string[];
interface Call {
  args: Arg[];
  echo: string[];
}
const call = (args: Arg[], ...echo: string[]): Call => ({ args, echo });

/** Sample arguments for every function of the words, and what each of its texts must say of them. */
const CALLS: Record<string, Call[]> = {
  join: [call([['Ann', 'Bob', 'Cy']], 'Ann', 'Bob', 'Cy')],
  cardRef: [call(['Strike'], 'Strike')],
  cardTag: [call(['Strike', '♠7'], 'Strike', '♠7')],
  youAre: [call(['Rebel'], 'Rebel')],
  'ask.dodge': [call(['Ann', 'Strike', 1], 'Ann', 'Strike'), call(['Ann', 'Strike', 2], 'Ann', 'Strike', '2')],
  'ask.strike': [call(['Ann', 'Duel', 1], 'Ann', 'Duel'), call(['Ann', 'Duel', 2], 'Ann', 'Duel', '2')],
  'ask.peach': [call(['Ann', false], 'Ann'), call(['Ann', true])],
  'ask.counter': [
    call(['Duel', 'Ann', 'Bob', true], 'Duel', 'Ann', 'Bob'),
    call(['Duel', 'Ann', 'Bob', false], 'Duel', 'Ann', 'Bob'),
    call(['Duel', 'Ann', null, true], 'Duel', 'Ann'),
    call(['Duel', null, 'Bob', true], 'Duel', 'Bob'),
    call(['Duel', null, null, false], 'Duel'),
  ],
  'ask.discard': [call([1], '1'), call([4], '4')],
  'ask.ganglie': [call(['Ann', 'Fierce Temper'], 'Ann', 'Fierce Temper')],
  'ask.guanshi': [call(['Ann'], 'Ann')],
  'ask.guicai': [call(['Ann', '♠7'], 'Ann', '♠7')],
  'ask.qilin': [call(['Ann'], 'Ann')],
  'ask.qinglong': [call(['Ann'], 'Ann')],
  'ask.chai': [call(['Ann'], 'Ann')],
  'ask.shun': [call(['Ann'], 'Ann')],
  'ask.fankui': [call(['Ann'], 'Ann')],
  'log.start': [call([5], '5'), call([8], '8')],
  'log.hero': [call(['Ann', 'Liu Bei', 'Shu'], 'Ann', 'Liu Bei', 'Shu')],
  'log.turn': [call([7, 'Ann'], '7', 'Ann')],
  'log.use': [
    call(['Ann', 'Strike', null, 'Bob'], 'Ann', 'Strike', 'Bob'),
    call(['Ann', 'Strike', 'Skill', 'Bob'], 'Ann', 'Strike', 'Skill', 'Bob'),
    call(['Ann', 'Windfall', null, null], 'Ann', 'Windfall'),
  ],
  'log.answer': [call(['Ann', 'Dodge', null], 'Ann', 'Dodge'), call(['Ann', 'Dodge', 'Skill'], 'Ann', 'Dodge', 'Skill')],
  'log.save': [
    call(['Ann', 'Peach', null, 'Bob'], 'Ann', 'Peach', 'Bob'),
    call(['Ann', 'Peach', 'Skill', 'Bob'], 'Ann', 'Peach', 'Skill', 'Bob'),
  ],
  'log.turned': [call(['Strike ♠7', 'Dodge'], 'Strike ♠7', 'Dodge')],
  'log.skill': [call(['Ann', 'Skill', 'Bob'], 'Ann', 'Skill', 'Bob'), call(['Ann', 'Skill', null], 'Ann', 'Skill')],
  'log.damage': [call(['Ann', 2, 'Bob'], 'Ann', '2', 'Bob'), call(['Ann', 3, null], 'Ann', '3')],
  'log.lose': [call(['Ann', 2], 'Ann', '2')],
  'log.heal': [call(['Ann', 2], 'Ann', '2')],
  'log.draw': [call(['Ann', 1], 'Ann'), call(['Ann', 3], 'Ann', '3')],
  'log.drawn': [call(['Ann', 'Strike ♠7, Dodge ♥2'], 'Ann', 'Strike ♠7, Dodge ♥2')],
  'log.discard': [call(['Ann', 'Strike ♠7', null], 'Ann', 'Strike ♠7'), call(['Ann', 'Strike ♠7', 'Bob'], 'Ann', 'Strike ♠7', 'Bob')],
  'log.takeFrom': [call(['Ann', 'Strike ♠7', 'Bob'], 'Ann', 'Strike ♠7', 'Bob')],
  'log.takeHidden': [call(['Ann', 1, 'Bob'], 'Ann', 'Bob'), call(['Ann', 3, 'Bob'], 'Ann', '3', 'Bob')],
  'log.take': [call(['Ann', 'Strike ♠7'], 'Ann', 'Strike ♠7')],
  'log.give': [call(['Ann', 1, 'Bob'], 'Ann', 'Bob'), call(['Ann', 3, 'Bob'], 'Ann', '3', 'Bob')],
  'log.giveCards': [call(['Ann', 'Strike ♠7', 'Bob'], 'Ann', 'Strike ♠7', 'Bob')],
  'log.equip': [call(['Ann', 'Dilu ♠5'], 'Ann', 'Dilu ♠5')],
  'log.judge': [call(['Ann', 'Lightning', 'Strike ♠7'], 'Ann', 'Lightning', 'Strike ♠7')],
  'log.armorUsed': [call(['Ann', 'Eight Trigrams'], 'Ann', 'Eight Trigrams')],
  'log.armorBlocked': [call(['Ann', 'Benevolent Shield'], 'Ann', 'Benevolent Shield')],
  'log.cancel': [call(['Strike', 'Ann'], 'Strike', 'Ann'), call(['Strike', null], 'Strike')],
  'log.skip': [call(['Ann', 'Play'], 'Ann', 'Play')],
  'log.die': [call(['Ann', 'Rebel', 'Bob'], 'Ann', 'Rebel', 'Bob'), call(['Ann', 'Rebel', null], 'Ann', 'Rebel')],
  reveal: [call(['1. Ann Lord / 2. Bob Rebel'], '1. Ann Lord / 2. Bob Rebel')],
};

function leaves(value: unknown, path: string): [string, unknown][] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, inner]) => leaves(inner, path === '' ? key : `${path}.${key}`));
  }
  return [[path, value]];
}

interface Said {
  texts: string[];
  echo: string[];
  pool: boolean;
}

/** Every text of the Sanguosha words of a language: its plain lines, its pools, and what its functions say. */
function said(lang: Lang): { all: Map<string, Said>; missing: string[] } {
  const all = new Map<string, Said>();
  const missing: string[] = [];
  const add = (key: string, out: unknown, echo: string[]): void => {
    const list: unknown[] = Array.isArray(out) ? out : [out];
    const texts = list.filter((text): text is string => typeof text === 'string');
    if (texts.length !== list.length) throw new Error(`${lang} ${key} is not text`);
    all.set(key, { texts, echo, pool: Array.isArray(out) });
  };
  for (const [path, value] of leaves(words(lang), '')) {
    if (typeof value !== 'function') {
      add(path, value, []);
      continue;
    }
    const samples = CALLS[path];
    if (samples === undefined) {
      missing.push(path);
      continue;
    }
    const fn = value as (...args: unknown[]) => unknown;
    samples.forEach((sample, i) => add(`${path}#${i}`, fn(...sample.args), sample.echo));
  }
  return { all, missing };
}

const found: Record<Lang, ReturnType<typeof said>> = { en: said('en'), 'zh-CN': said('zh-CN') };

describe('the Sanguosha words', () => {
  it('have a sample call for every function, so that every line is checked', () => {
    expect(found.en.missing).toEqual([]);
    expect(found['zh-CN'].missing).toEqual([]);
    expect(found.en.all.size).toBeGreaterThan(200);
  });

  it('are the same lines, pools and functions in both languages', () => {
    expect([...found['zh-CN'].all.keys()].sort()).toEqual([...found.en.all.keys()].sort());
    for (const [key, line] of found.en.all) {
      const other = found['zh-CN'].all.get(key);
      expect(other?.pool, key).toBe(line.pool);
      expect(other?.texts.length, key).toBe(line.texts.length);
    }
  });

  it('name every card, hero, skill, kingdom, role and phase, and no others', () => {
    for (const lang of LANGS) {
      const w = words(lang);
      expect(Object.keys(w.card).sort(), lang).toEqual([...CARD_NAMES].sort());
      expect(Object.keys(w.hero).sort(), lang).toEqual([...HERO_IDS].sort());
      expect(Object.keys(w.skill).sort(), lang).toEqual([...SKILLS].sort());
      expect(Object.keys(w.kingdom).sort(), lang).toEqual([...KINGDOMS].sort());
      expect(Object.keys(w.role).sort(), lang).toEqual(['lord', 'loyalist', 'rebel', 'traitor']);
      expect(Object.keys(w.roleHint).sort(), lang).toEqual(['lord', 'loyalist', 'rebel', 'traitor']);
      expect(Object.keys(w.phase).sort(), lang).toEqual(['discard', 'draw', 'end', 'judge', 'play', 'start']);
      expect(Object.keys(w.ask.confirm).sort(), lang).toEqual(['bagua', 'luoshen', 'luoyi']);
      expect(Object.keys(w.chat).sort(), lang).toEqual(['fall', 'heal', 'hit', 'hurt', 'kill', 'lose', 'win']);
    }
  });

  it.each(LANGS)('have no empty, untrimmed or broken text in %s', (lang) => {
    for (const [key, line] of found[lang].all) {
      for (const text of line.texts) {
        expect(text.trim(), key).not.toBe('');
        expect(text, key).toBe(text.trim());
        expect(text, key).not.toMatch(BROKEN);
      }
    }
  });

  it.each(LANGS)('say what they are given, in every way of saying it, in %s', (lang) => {
    for (const [key, line] of found[lang].all) {
      for (const text of line.texts) for (const part of line.echo) expect(text, key).toContain(part);
    }
  });

  it.each(LANGS)('are written in their own language, with nothing of the other, in %s', (lang) => {
    for (const [key, line] of found[lang].all) {
      for (const text of line.texts) expect(CJK.test(text), `${lang} ${key}: ${text}`).toBe(lang === 'zh-CN');
    }
  });

  it.each(LANGS)('give every pool several different ways to say it in %s', (lang) => {
    let pools = 0;
    for (const [key, line] of found[lang].all) {
      if (!line.pool) continue;
      pools++;
      expect(line.texts.length, key).toBeGreaterThanOrEqual(2);
      expect(new Set(line.texts).size, key).toBe(line.texts.length);
    }
    expect(pools).toBe(7);
  });

  it.each(LANGS)('word each branch of a line differently in %s', (lang) => {
    const w = words(lang);
    const apart = (...texts: string[]): number => new Set(texts).size;
    expect(apart(w.ask.peach('Ann', true), w.ask.peach('Ann', false))).toBe(2);
    expect(apart(w.ask.dodge('Ann', 'S', 1), w.ask.dodge('Ann', 'S', 2))).toBe(2);
    expect(apart(w.ask.strike('Ann', 'S', 1), w.ask.strike('Ann', 'S', 2))).toBe(2);
    const counters = [
      w.ask.counter('S', 'Ann', 'Bob', true), w.ask.counter('S', 'Ann', 'Bob', false), w.ask.counter('S', 'Ann', null, true),
      w.ask.counter('S', null, 'Bob', true), w.ask.counter('S', null, null, true),
    ];
    expect(apart(...counters)).toBe(5);
    expect(apart(w.ask.hero, w.ask.heroLord)).toBe(2);
    expect(apart(w.ask.chai('Ann'), w.ask.shun('Ann'))).toBe(2);
    expect(apart(w.log.use('Ann', 'S', null, 'Bob'), w.log.use('Ann', 'S', null, null), w.log.use('Ann', 'S', 'K', 'Bob'))).toBe(3);
    expect(apart(w.log.answer('Ann', 'S', null), w.log.answer('Ann', 'S', 'K'), w.log.save('Ann', 'S', null, 'Bob'))).toBe(3);
    expect(apart(w.log.damage('Ann', 1, 'Bob'), w.log.damage('Ann', 1, null))).toBe(2);
    expect(apart(w.log.discard('Ann', 'S', null), w.log.discard('Ann', 'S', 'Bob'))).toBe(2);
    expect(apart(w.log.take('Ann', 'S'), w.log.takeFrom('Ann', 'S', 'Bob'), w.log.takeHidden('Ann', 2, 'Bob'))).toBe(3);
    expect(apart(w.log.give('Ann', 2, 'Bob'), w.log.giveCards('Ann', 'S', 'Bob'))).toBe(2);
    expect(apart(w.log.armorUsed('Ann', 'A'), w.log.armorBlocked('Ann', 'A'))).toBe(2);
    expect(apart(w.log.cancel('S', 'Ann'), w.log.cancel('S', null))).toBe(2);
    expect(apart(w.log.die('Ann', 'R', 'Bob'), w.log.die('Ann', 'R', null))).toBe(2);
    expect(apart(w.log.draw('Ann', 2), w.log.drawn('Ann', 'S'))).toBe(2);
    expect(apart(w.win, w.lose, w.calledOff)).toBe(3);
    expect(apart(w.winLord, w.winRebel, w.winTraitor)).toBe(3);
    expect(apart(...Object.values(w.role))).toBe(4);
    expect(apart(...Object.values(w.roleHint))).toBe(4);
    expect(apart(...Object.values(w.phase))).toBe(6);
    expect(apart(...Object.values(w.kingdom))).toBe(4);
    expect(apart(...Object.values(w.ask.confirm))).toBe(3);
  });

  it.each(LANGS)('give every card, hero and skill a name of its own, and every card and skill a tip, in %s', (lang) => {
    const w = words(lang);
    const cards = CARD_NAMES.map((n) => w.card[n].name);
    const heroes = HERO_IDS.map((h) => w.hero[h]);
    const skills = SKILLS.map((s) => w.skill[s].name);
    expect(new Set(cards).size).toBe(CARD_NAMES.length);
    expect(new Set(heroes).size).toBe(HERO_IDS.length);
    expect(new Set(skills).size).toBe(SKILLS.length);
    expect(new Set([...cards, ...skills]).size, 'no skill is named like a card').toBe(cards.length + skills.length);
    const tips = [...CARD_NAMES.map((n) => w.card[n].tip), ...SKILLS.map((s) => w.skill[s].tip)];
    const stop = lang === 'zh-CN' ? /。$/ : /[.]$/;
    for (const tip of tips) {
      expect(tip.length, tip).toBeGreaterThan(lang === 'zh-CN' ? 4 : 8);
      expect(tip, tip).toMatch(stop);
    }
    expect(new Set(tips).size, 'a tip each, apart from the horses of a kind').toBeGreaterThanOrEqual(tips.length - 4);
  });

  it.each(LANGS)('give the plain labels one {n} or {card} each, and nothing else in braces, in %s', (lang) => {
    const w = words(lang);
    const withN = [w.pick, w.turnNo, w.pile, w.hand, w.dist, w.range, w.pickTargets];
    for (const text of withN) expect(text.split('{n}'), text).toHaveLength(2);
    expect(w.playAs.split('{card}')).toHaveLength(2);
    for (const [key, line] of found[lang].all) {
      for (const text of line.texts) {
        const left = text.replace('{n}', '').replace('{card}', '');
        expect(left, `${key}: ${text}`).not.toMatch(/[{}]/);
      }
    }
  });

  it.each(LANGS)('name the cards that a question asks for as the card table does in %s', (lang) => {
    const w = words(lang);
    const ref = (name: (typeof CARD_NAMES)[number]): string => w.cardRef(w.card[name].name);
    expect(w.ask.dodge('Ann', ref('sha'), 1)).toContain(ref('shan'));
    expect(w.ask.strike('Ann', ref('juedou'), 1)).toContain(ref('sha'));
    expect(w.ask.peach('Ann', false)).toContain(ref('tao'));
    expect(w.ask.peach('Ann', true)).toContain(ref('tao'));
    expect(w.ask.counter(ref('sha'), 'Ann', 'Bob', true)).toContain(ref('wuxie'));
    expect(w.ask.counter(ref('sha'), 'Ann', 'Bob', false)).toContain(ref('wuxie'));
    expect(w.ask.guanshi('Ann')).toContain(ref('sha'));
    expect(w.ask.qinglong('Ann')).toContain(ref('sha'));
    expect(w.ask.confirm.bagua).toContain(w.card.bagua.name);
    expect(w.ask.confirm.bagua).toContain(ref('shan'));
    expect(w.ask.confirm.luoshen).toContain(w.skill.luoshen.name);
    expect(w.ask.confirm.luoyi).toContain(w.skill.luoyi.name);
    expect(w.ask.confirm.luoyi).toContain(ref('sha'));
    expect(w.ask.confirm.luoyi).toContain(ref('juedou'));
  });

  it.each(LANGS)('say of every weapon the range the rules give it in %s', (lang) => {
    const w = words(lang);
    for (const weapon of WEAPONS) {
      const tip = w.card[weapon].tip;
      const range = lang === 'zh-CN' ? /攻击范围 (\d)/ : /range (\d)/;
      expect(tip.match(range)?.[1], `${weapon}: ${tip}`).toBe(String(RANGE[weapon]));
    }
  });

  it('name the roles, the kingdoms and the moves as Chinese players do', () => {
    const w = words('zh-CN');
    expect(w.title).toBe('三国杀');
    expect(w.role).toEqual({ lord: '主公', loyalist: '忠臣', rebel: '反贼', traitor: '内奸' });
    expect(w.kingdom).toEqual({ shu: '蜀', wei: '魏', wu: '吴', qun: '群' });
    expect(w.phase).toEqual({ start: '准备', judge: '判定', draw: '摸牌', play: '出牌', discard: '弃牌', end: '结束' });
    expect(w.card.sha.name).toBe('杀');
    expect(w.card.shan.name).toBe('闪');
    expect(w.card.tao.name).toBe('桃');
    expect(w.card.wuxie.name).toBe('无懈可击');
    expect(w.card.juedou.name).toBe('决斗');
    expect(w.card.chai.name).toBe('过河拆桥');
    expect(w.card.shun.name).toBe('顺手牵羊');
    expect(w.card.lebu.name).toBe('乐不思蜀');
    expect(w.card.bing.name).toBe('兵粮寸断');
    expect(w.hero.liubei).toBe('刘备');
    expect(w.hero.caocao).toBe('曹操');
    expect(w.hero.sunquan).toBe('孙权');
    expect(w.hero.lvbu).toBe('吕布');
    expect(w.skill.rende.name).toBe('仁德');
    expect(w.skill.jianxiong.name).toBe('奸雄');
    expect(w.skill.zhiheng.name).toBe('制衡');
    expect(w.cardRef('杀')).toBe('【杀】');
    expect(w.cardTag('杀', '♠7')).toBe('【杀】♠7');
    expect(w.join(['甲', '乙', '丙'])).toBe('甲、乙、丙');
    expect(w.youAre('反贼')).toBe('你的身份是反贼。');
    expect(w.endTurn).toBe('结束回合');
    expect(w.size5).toBe('5 人场');
    expect(w.size8).toBe('8 人场');
  });

  it('name the roles and the moves in English', () => {
    const w = words('en');
    expect(w.title).toBe('Sanguosha');
    expect(w.role).toEqual({ lord: 'Lord', loyalist: 'Loyalist', rebel: 'Rebel', traitor: 'Traitor' });
    expect(w.kingdom).toEqual({ shu: 'Shu', wei: 'Wei', wu: 'Wu', qun: 'Qun' });
    expect(w.card.sha.name).toBe('Strike');
    expect(w.card.shan.name).toBe('Dodge');
    expect(w.card.tao.name).toBe('Peach');
    expect(w.hero.liubei).toBe('Liu Bei');
    expect(w.cardRef('Strike')).toBe('Strike');
    expect(w.cardTag('Strike', '♠7')).toBe('Strike ♠7');
    expect(w.join(['Ann', 'Bob', 'Cy'])).toBe('Ann, Bob, Cy');
    expect(w.size5).toBe('5 players');
    expect(w.size8).toBe('8 players');
  });

  it('say singular and plural as each language does', () => {
    const en = words('en');
    expect(en.log.draw('Ann', 1)).toBe('Ann drew 1 card.');
    expect(en.log.draw('Ann', 2)).toBe('Ann drew 2 cards.');
    expect(en.log.takeHidden('Ann', 1, 'Bob')).toBe('Ann took a hand card from Bob.');
    expect(en.log.takeHidden('Ann', 2, 'Bob')).toBe('Ann took 2 hand cards from Bob.');
    expect(en.log.give('Ann', 1, 'Bob')).toBe('Ann gave 1 card to Bob.');
    expect(en.log.give('Ann', 2, 'Bob')).toBe('Ann gave 2 cards to Bob.');
    expect(en.ask.discard(1)).toBe('Discard 1 card.');
    expect(en.ask.discard(3)).toBe('Discard 3 cards.');
  });

  it('say the rules are this game’s own, an unofficial fan version without official art, in both languages', () => {
    const en = words('en').rules;
    expect(en).toMatch(/unofficial/i);
    expect(en).toContain('Yoka Games');
    expect(en).toMatch(/no official art/);
    const zh = words('zh-CN').rules;
    expect(zh).toContain('非官方');
    expect(zh).toContain('游卡');
    expect(zh).toContain('没有官方美术');
    for (const [lang, rules] of [['en', en], ['zh-CN', zh]] as const) {
      expect(rules, lang).toMatch(/5/);
      expect(rules, lang).toMatch(/8/);
    }
  });

  it('say that the pets play by rules of their own and use no Copilot CLI quota', () => {
    expect(words('en').bots).toContain('Copilot CLI');
    expect(words('en').bots).toMatch(/no quota/);
    expect(words('zh-CN').bots).toContain('Copilot CLI');
    expect(words('zh-CN').bots).toContain('额度');
  });
});

describe('the Sanguosha entries of the settings and the tray', () => {
  it.each(LANGS)('are written in their own language, in %s', (lang) => {
    const s = settings(lang);
    for (const text of [s.petGameSanguosha, s.petGameSanguoshaDesc, strings(lang).trayGameSanguosha]) {
      expect(text.trim(), lang).not.toBe('');
      expect(text, lang).toBe(text.trim());
      expect(CJK.test(text), `${lang}: ${text}`).toBe(lang === 'zh-CN');
      expect(text, lang).not.toMatch(BROKEN);
    }
  });

  it('name the game in the tray the way the other games are, with an ellipsis', () => {
    expect(strings('en').trayGameSanguosha).toBe('Sanguosha…');
    expect(strings('zh-CN').trayGameSanguosha).toBe('三国杀…');
    for (const lang of LANGS) {
      expect(strings(lang).trayGameSanguosha.endsWith('…'), lang).toBe(strings(lang).trayGameWerewolf.endsWith('…'));
    }
  });

  it('describe the game: 5 or 8 players, no Copilot CLI quota, unofficial', () => {
    const en = settings('en').petGameSanguoshaDesc;
    expect(en).toMatch(/5 or 8 players/);
    expect(en).toMatch(/no Copilot CLI quota/);
    expect(en).toMatch(/unofficial/);
    const zh = settings('zh-CN').petGameSanguoshaDesc;
    expect(zh).toContain('5 人或 8 人');
    expect(zh).toContain('不消耗额度');
    expect(zh).toContain('非官方');
    for (const text of [en, zh]) {
      expect(text).toContain(String(HERO_IDS.length));
      expect(text).toContain(String(DECK_SIZE));
    }
  });
});
