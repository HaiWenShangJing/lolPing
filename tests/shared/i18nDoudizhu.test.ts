import { describe, expect, it } from 'vitest';
import { strings } from '../../src/shared/i18n';
import type { Shape } from '../../src/shared/teammate/doudizhuCards';
import { CONFIG, SIZES } from '../../src/shared/teammate/doudizhuTypes';

const LANGS = ['en', 'zh-CN'] as const;
type Lang = (typeof LANGS)[number];

const words = (lang: Lang) => strings(lang).teammate.games.doudizhu;
const settings = (lang: Lang) => strings(lang).teammate.settings;

// Ideographs and the full-width punctuation of Chinese text: what English must not have and Chinese must.
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
const BROKEN = /undefined|NaN|\[object|\bnull\b/;
// A list of cards is made of the cards and of nothing else, so it has no words to be in either language.
const NEUTRAL = new Set(['cards']);

const SHAPES: Shape[] = [
  'single', 'pair', 'triple', 'tripleOne', 'triplePair', 'straight', 'pairs', 'plane', 'planeOne', 'planePair',
  'fourTwo', 'fourPairs', 'bomb', 'rocket',
];

type Arg = string | number | boolean | null | string[];
interface Call {
  args: Arg[];
  echo: string[];
}
const call = (args: Arg[], ...echo: string[]): Call => ({ args, echo });

/** Sample arguments for every function of the words, and what each of its texts must say of them. */
const CALLS: Record<string, Call[]> = {
  bombOf: [call([5], '5'), call([8], '8')],
  cards: [call([['♠3', '♠4', '♥5']], '♠3', '♠4', '♥5')],
  join: [call([['Ann', 'Bob', 'Cy']], 'Ann', 'Bob', 'Cy')],
  'ask.bid': [call([1, 3], '1', '3'), call([2, 3], '2', '3'), call([3, 3], '3')],
  'ask.follow': [call(['Ann', 'Pair'], 'Ann', 'Pair')],
  'log.start': [call([3], '3'), call([6], '6')],
  'log.bid': [call(['Ann', 2], 'Ann', '2'), call(['Ann', 0], 'Ann')],
  'log.landlord': [call(['Ann', 3, '♠3 ♠4 ♠5'], 'Ann', '3', '♠3 ♠4 ♠5')],
  'log.call': [
    call(['Ann', '♦3', null], 'Ann', '♦3'),
    call(['Ann', '♦3', '♠3 ♠4 ♠5'], 'Ann', '♦3', '♠3 ♠4 ♠5'),
  ],
  'log.play': [call(['Ann', '♠3 ♥3', 'Pair'], 'Ann', '♠3 ♥3', 'Pair')],
  'log.pass': [call(['Ann'], 'Ann')],
  'log.reveal': [call(['Ann'], 'Ann')],
  stakeLine: [call([1, 0, 1], '1'), call([2, 1, 2], '2', '1'), call([1, 3, 8], '1', '3', '8')],
  landlords: [call(['Ann, Bob'], 'Ann, Bob')],
  scores: [call(['Ann +4 / Bob -2'], 'Ann +4 / Bob -2')],
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

/** Every text of the Dou Dizhu words of a language: its plain lines, its pools, and what its functions say. */
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

describe('the Dou Dizhu words', () => {
  it('have a sample call for every function, so that every line is checked', () => {
    expect(found.en.missing).toEqual([]);
    expect(found['zh-CN'].missing).toEqual([]);
    expect(found.en.all.size).toBeGreaterThan(80);
  });

  it('are the same lines, pools and functions in both languages', () => {
    expect([...found['zh-CN'].all.keys()].sort()).toEqual([...found.en.all.keys()].sort());
    for (const [key, line] of found.en.all) {
      const other = found['zh-CN'].all.get(key);
      expect(other?.pool, key).toBe(line.pool);
      expect(other?.texts.length, key).toBe(line.texts.length);
    }
  });

  it('name every shape, role, phase and joker, and no others', () => {
    for (const lang of LANGS) {
      const w = words(lang);
      expect(Object.keys(w.shape).sort(), lang).toEqual([...SHAPES].sort());
      expect(Object.keys(w.role).sort(), lang).toEqual(['farmer', 'hidden', 'landlord', 'unknown']);
      expect(Object.keys(w.youAre).sort(), lang).toEqual(['farmer', 'hidden', 'landlord']);
      expect(Object.keys(w.roleHint).sort(), lang).toEqual(['farmer', 'hidden', 'landlord']);
      expect(Object.keys(w.phase).sort(), lang).toEqual(['bid', 'over', 'play']);
      expect(Object.keys(w.joker).sort(), lang).toEqual(['big', 'small']);
      expect(Object.keys(w.verdict).sort(), lang).toEqual(['bad', 'low']);
      expect(Object.keys(w.chat).sort(), lang).toEqual(['bomb', 'grab', 'last', 'lose', 'reveal', 'win']);
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
      if (NEUTRAL.has(key.split('#')[0] ?? '')) continue;
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
    expect(pools).toBe(6);
  });

  it.each(LANGS)('word each branch of a line differently in %s', (lang) => {
    const w = words(lang);
    const apart = (...texts: string[]): number => new Set(texts).size;
    expect(apart(w.ask.bid(1, 3), w.ask.bid(3, 3))).toBe(2);
    expect(apart(w.log.bid('Ann', 1), w.log.bid('Ann', 0))).toBe(2);
    expect(apart(w.log.call('Ann', 'C', null), w.log.call('Ann', 'C', 'H'))).toBe(2);
    expect(apart(w.stakeLine(1, 0, 1), w.stakeLine(1, 1, 2), w.stakeLine(1, 2, 4))).toBe(3);
    expect(apart(w.win, w.lose)).toBe(2);
    expect(apart(w.winLandlord, w.winFarmers)).toBe(2);
    expect(apart(w.spring, w.counter)).toBe(2);
    expect(apart(w.verdict.bad, w.verdict.low)).toBe(2);
    expect(apart(w.joker.small, w.joker.big)).toBe(2);
    expect(apart(w.size3, w.size4, w.size5, w.size6)).toBe(4);
    expect(apart(...Object.values(w.role))).toBe(4);
    expect(apart(...Object.values(w.youAre))).toBe(3);
    expect(apart(...Object.values(w.roleHint))).toBe(3);
    expect(apart(...Object.values(w.phase))).toBe(3);
    expect(apart(...Object.values(w.shape))).toBe(SHAPES.length);
  });

  it.each(LANGS)('give the plain labels their placeholders, and nothing else in braces, in %s', (lang) => {
    const w = words(lang);
    for (const text of [w.pick, w.count, w.bidOf]) expect(text.split('{n}'), text).toHaveLength(2);
    expect(w.stake.split('{base}')).toHaveLength(2);
    expect(w.stake.split('{mult}')).toHaveLength(2);
    for (const [key, line] of found[lang].all) {
      for (const text of line.texts) {
        const left = text.replace('{n}', '').replace('{base}', '').replace('{mult}', '');
        expect(left, `${key}: ${text}`).not.toMatch(/[{}]/);
      }
    }
  });

  it.each(LANGS)('say of every table how it is dealt, as the rules of the game give it, in %s', (lang) => {
    const rules = words(lang).rules;
    for (const size of SIZES) {
      expect(rules, `${size}`).toContain(String(CONFIG[size].hand));
      if (CONFIG[size].holes > 0) expect(rules, `${size}`).toContain(String(CONFIG[size].holes));
    }
    expect(rules).toContain(String(SIZES[0]));
    expect(rules).toContain(String(SIZES[SIZES.length - 1]));
  });

  it('name the sides, the plays and the cards as Chinese players do', () => {
    const w = words('zh-CN');
    expect(w.title).toBe('斗地主');
    expect(w.role).toEqual({ landlord: '地主', farmer: '农民', unknown: '未知', hidden: '地主（暗）' });
    expect(w.phase).toEqual({ bid: '叫分', play: '出牌', over: '结束' });
    expect(w.joker).toEqual({ small: '小王', big: '大王' });
    expect(w.shape.single).toBe('单张');
    expect(w.shape.pair).toBe('对子');
    expect(w.shape.straight).toBe('顺子');
    expect(w.shape.pairs).toBe('连对');
    expect(w.shape.plane).toBe('飞机');
    expect(w.shape.fourTwo).toBe('四带二');
    expect(w.shape.bomb).toBe('炸弹');
    expect(w.shape.rocket).toBe('火箭');
    expect(w.bombOf(5)).toBe('5 张炸弹');
    expect(w.join(['甲', '乙', '丙'])).toBe('甲、乙、丙');
    expect(w.cards(['♠3', '♥3'])).toBe('♠3 ♥3');
    expect(w.size3).toBe('3 人场');
    expect(w.size6).toBe('6 人场');
    expect(w.bidNone).toBe('不叫');
    expect(w.bidOf).toBe('叫 {n} 分');
    expect(w.pass).toBe('不出');
    expect(w.holes).toBe('底牌');
    expect(w.rules).toMatch(/炸弹.*火箭/);
    expect(w.rules).toContain('春天');
    expect(w.rules).toContain('明');
  });

  it('name the sides and the plays in English', () => {
    const w = words('en');
    expect(w.title).toBe('Dou Dizhu');
    expect(w.role).toEqual({ landlord: 'Landlord', farmer: 'Farmer', unknown: 'Unknown', hidden: 'Landlord (hidden)' });
    expect(w.phase).toEqual({ bid: 'Bidding', play: 'Playing', over: 'Game over' });
    expect(w.joker).toEqual({ small: 'Small Joker', big: 'Big Joker' });
    expect(w.shape.straight).toBe('Straight');
    expect(w.shape.rocket).toBe('Rocket');
    expect(w.bombOf(5)).toBe('Bomb of 5');
    expect(w.join(['Ann', 'Bob', 'Cy'])).toBe('Ann, Bob, Cy');
    expect(w.cards(['♠3', '♥3'])).toBe('♠3, ♥3');
    expect(w.size3).toBe('3 players');
    expect(w.size6).toBe('6 players');
    expect(w.rules).toMatch(/bomb/i);
    expect(w.rules).toMatch(/rocket/i);
    expect(w.rules).toMatch(/spring/i);
  });

  it('say singular and plural as each language does', () => {
    const en = words('en');
    expect(en.stakeLine(1, 0, 1)).toBe('Base 1, no bombs: points ×1.');
    expect(en.stakeLine(1, 1, 2)).toBe('Base 1, 1 bomb: points ×2.');
    expect(en.stakeLine(2, 3, 8)).toBe('Base 2, 3 bombs: points ×8.');
    const zh = words('zh-CN');
    expect(zh.stakeLine(1, 0, 1)).toBe('底分 1，没有炸弹：分数 ×1。');
    expect(zh.stakeLine(2, 3, 8)).toBe('底分 2，3 个炸弹：分数 ×8。');
  });

  it('ask for a bid in the words of the range it is given', () => {
    const en = words('en');
    expect(en.ask.bid(1, 3)).toBe('Bid 1 to 3 to be the landlord, or pass.');
    expect(en.ask.bid(2, 3)).toBe('Bid 2 to 3 to be the landlord, or pass.');
    expect(en.ask.bid(3, 3)).toBe('Bid 3 to be the landlord, or pass.');
    const zh = words('zh-CN');
    expect(zh.ask.bid(1, 3)).toBe('叫 1 到 3 分当地主，或不叫。');
    expect(zh.ask.bid(3, 3)).toBe('叫 3 分当地主，或不叫。');
  });

  it('say the rules are this game’s own, with variants of its own and no official art, in both languages', () => {
    const en = words('en').rules;
    expect(en).toMatch(/own/);
    expect(en).toMatch(/no official art/);
    const zh = words('zh-CN').rules;
    expect(zh).toContain('自制');
    expect(zh).toContain('没有官方美术');
  });

  it('say that the pets think with Copilot CLI, and that it uses its quota, in both languages', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      expect(words(lang).minds, lang).toContain('Copilot CLI');
      expect(words(lang).thinking.trim(), lang).not.toBe('');
    }
    expect(words('en').minds).toMatch(/quota/);
    expect(words('zh-CN').minds).toContain('额度');
  });
});

describe('the Dou Dizhu entries of the settings and the tray', () => {
  it.each(LANGS)('are written in their own language, in %s', (lang) => {
    const s = settings(lang);
    for (const text of [s.petGameDoudizhu, s.petGameDoudizhuDesc, strings(lang).trayGameDoudizhu]) {
      expect(text.trim(), lang).not.toBe('');
      expect(text, lang).toBe(text.trim());
      expect(CJK.test(text), `${lang}: ${text}`).toBe(lang === 'zh-CN');
      expect(text, lang).not.toMatch(BROKEN);
    }
  });

  it('name the game in the tray the way the other games are, with an ellipsis', () => {
    expect(strings('en').trayGameDoudizhu).toBe('Dou Dizhu…');
    expect(strings('zh-CN').trayGameDoudizhu).toBe('斗地主…');
    for (const lang of LANGS) {
      expect(strings(lang).trayGameDoudizhu.endsWith('…'), lang).toBe(strings(lang).trayGameWerewolf.endsWith('…'));
    }
  });

  it('describe the game: 3 to 6 players, thinking with Copilot CLI when it is set up', () => {
    const en = settings('en').petGameDoudizhuDesc;
    expect(en).toMatch(/3 to 6 players/);
    expect(en).toMatch(/think with Copilot CLI when it is set up/);
    expect(en).not.toMatch(/no Copilot CLI quota/);
    const zh = settings('zh-CN').petGameDoudizhuDesc;
    expect(zh).toContain('3 至 6 人');
    expect(zh).toContain('Copilot CLI');
    expect(zh).toContain('额度');
    expect(zh).not.toContain('不消耗额度');
  });
});
