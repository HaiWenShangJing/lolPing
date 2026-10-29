import { describe, expect, it } from 'vitest';
import { strings } from '../../src/shared/i18n';

const LANGS = ['en', 'zh-CN'] as const;
type Lang = (typeof LANGS)[number];

const games = (lang: Lang) => strings(lang).teammate.games;
const wolf = (lang: Lang) => games(lang).werewolf;
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

/** Sample arguments for every function of the werewolf words, and what each of its texts must say of them. */
const CALLS: Record<string, Call[]> = {
  pickPlay: [call([11], '11')],
  pickWatch: [call([12], '12')],
  day: [call([3], '3')],
  youAre: [call(['Seer'], 'Seer')],
  join: [call([['Ann', 'Bob']], 'Ann', 'Bob')],
  sentences: [call([['One.', 'Two.']], 'One.', 'Two.')],
  saveHim: [call(['Ann'], 'Ann')],
  askWitch: [call(['Ann'], 'Ann'), call([null])],
  night: [call([2], '2')],
  wolves: [call(['Ann, Bob'], 'Ann, Bob')],
  wolfPick: [call(['Ann', 'Bob'], 'Ann', 'Bob')],
  wolfKill: [call(['Bob'], 'Bob')],
  check: [call(['Ann', true], 'Ann'), call(['Ann', false], 'Ann')],
  seerCheck: [call(['Zed', 'Ann', true], 'Zed', 'Ann'), call(['Zed', 'Ann', false], 'Zed', 'Ann')],
  witchInfo: [call(['Ann'], 'Ann'), call([null])],
  witchDid: [call(['Ann', null], 'Ann'), call([null, 'Bob'], 'Bob'), call([null, null])],
  witchActs: [
    call(['Wy', 'Ann', null], 'Wy', 'Ann'), call(['Wy', null, 'Bob'], 'Wy', 'Bob'), call(['Wy', null, null], 'Wy'),
  ],
  dawn: [call(['Ann, Bob'], 'Ann, Bob')],
  runners: [call(['Ann, Bob'], 'Ann, Bob')],
  voteHead: [call(['sheriff', 1]), call(['sheriff', 2]), call(['exile', 1]), call(['exile', 2])],
  ballot: [call(['Ann', 'Bob, Cy', 2], 'Ann', 'Bob, Cy', '2'), call(['Ann', 'Bob', 1.5], 'Ann', 'Bob', '1.5')],
  abstained: [call(['Ann, Bob'], 'Ann, Bob')],
  exiled: [call(['Ann'], 'Ann')],
  tie: [call(['Ann, Bob'], 'Ann, Bob')],
  sheriffIs: [call(['Ann'], 'Ann')],
  badgePass: [call(['Ann', 'Bob'], 'Ann', 'Bob')],
  badgeTear: [call(['Ann'], 'Ann')],
  flip: [call(['Ann'], 'Ann')],
  boomed: [call(['Ann'], 'Ann')],
  shot: [call(['Hal', 'Ann'], 'Hal', 'Ann')],
  reveal: [call(['Ann: wolf'], 'Ann: wolf')],
  accuse: [call(['Ann'], 'Ann')],
  trust: [call(['Ann'], 'Ann')],
  claimSeer: [call(['Ann: wolf'], 'Ann: wolf')],
  checkWolf: [call(['Ann'], 'Ann')],
  checkGood: [call(['Ann'], 'Ann')],
  claimWitch: [call(['Ann'], 'Ann'), call([null])],
  last: [call(['Ann'], 'Ann'), call([null])],
};

/** They only join what they are given, so a Chinese one of them may have no Chinese in it. */
const JOINERS = new Set(['join', 'sentences']);

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

/** Every text of the werewolf words of a language: its plain lines, its pools, and what its functions say. */
function said(lang: Lang): { all: Map<string, Said>; missing: string[] } {
  const all = new Map<string, Said>();
  const missing: string[] = [];
  const add = (key: string, out: unknown, echo: string[]): void => {
    const list: unknown[] = Array.isArray(out) ? out : [out];
    const texts = list.filter((text): text is string => typeof text === 'string');
    if (texts.length !== list.length) throw new Error(`${lang} ${key} is not text`);
    all.set(key, { texts, echo, pool: Array.isArray(out) });
  };
  for (const [path, value] of leaves(wolf(lang), '')) {
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

describe('the werewolf words', () => {
  it('have a sample call for every function, so that every line is checked', () => {
    expect(found.en.missing).toEqual([]);
    expect(found['zh-CN'].missing).toEqual([]);
    expect(found.en.all.size).toBeGreaterThan(100);
  });

  it('are the same lines, pools and functions in both languages', () => {
    expect([...found['zh-CN'].all.keys()].sort()).toEqual([...found.en.all.keys()].sort());
    for (const [key, line] of found.en.all) {
      const other = found['zh-CN'].all.get(key);
      expect(other?.pool, key).toBe(line.pool);
      expect(other?.texts.length, key).toBe(line.texts.length);
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
      if (JOINERS.has(key.split('#')[0] ?? '')) continue;
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
    expect(pools).toBeGreaterThanOrEqual(13);
  });

  it.each(LANGS)('word each branch of a line differently in %s', (lang) => {
    const w = wolf(lang);
    const apart = (...texts: string[]): number => new Set(texts).size;
    expect(apart(w.check('Ann', true), w.check('Ann', false))).toBe(2);
    expect(apart(w.seerCheck('Zed', 'Ann', true), w.seerCheck('Zed', 'Ann', false))).toBe(2);
    expect(apart(w.witchInfo('Ann'), w.witchInfo(null))).toBe(2);
    expect(apart(w.askWitch('Ann'), w.askWitch(null))).toBe(2);
    expect(apart(w.witchDid('Ann', null), w.witchDid(null, 'Ann'), w.witchDid(null, null))).toBe(3);
    const acts = [w.witchActs('Wy', 'Ann', null), w.witchActs('Wy', null, 'Ann'), w.witchActs('Wy', null, null)];
    expect(apart(...acts)).toBe(3);
    const heads = [w.voteHead('sheriff', 1), w.voteHead('sheriff', 2), w.voteHead('exile', 1), w.voteHead('exile', 2)];
    expect(apart(...heads)).toBe(4);
    expect(apart(w.dawn('Ann'), w.dawnNone)).toBe(2);
    expect(apart(w.badgePass('Ann', 'Bob'), w.badgeTear('Ann'))).toBe(2);
    expect(apart(w.winVillage, w.winGods, w.winVillagers)).toBe(3);
    expect(apart(w.youWin, w.youLose)).toBe(2);
    expect(apart(w.noSheriff, w.sheriffOff, w.noRunners)).toBe(3);
    expect(apart(w.noExile, w.exiled('Ann'))).toBe(2);
    expect(apart(w.askSpeak.day, w.askSpeak.campaign, w.askSpeak.pk, w.askSpeak.last)).toBe(4);
    expect(apart(w.askVote.exile, w.askVote.sheriff, w.askVote.again)).toBe(3);
    expect(apart(...Object.values(w.role))).toBe(6);
    expect(apart(...Object.values(w.roleHint))).toBe(6);
    expect(apart(...Object.values(w.phase))).toBe(5);
    expect(apart(...Object.values(w.talk))).toBe(3);
  });

  it('name the roles and the moves as Chinese players do', () => {
    const w = wolf('zh-CN');
    expect(w.role).toEqual({ wolf: '狼人', villager: '平民', seer: '预言家', witch: '女巫', hunter: '猎人', idiot: '白痴' });
    expect(w.boomButton).toBe('自爆');
    expect(w.talk.last).toBe('遗言');
    expect(w.sheriff).toBe('警长');
    expect(w.checkWolf('Ann')).toBe('查杀 Ann');
    expect(w.checkGood('Ann')).toBe('金水 Ann');
    expect(w.dawnNone).toContain('平安夜');
    expect(w.badgePass('Ann', 'Bob')).toContain('警徽');
    expect(w.badgeTear('Ann')).toContain('警徽');
    expect(w.phase.sheriff).toContain('警长');
    expect(w.rules).toContain('十二');
    expect(w.rules).toContain('屠边');
    expect(w.winGods).toContain('神职');
    expect(w.winVillagers).toContain('平民');
    expect(w.flip('Ann')).toContain('白痴');
    expect(w.shot('Hal', 'Ann')).toContain('猎人');
    expect(w.seerCheck('Zed', 'Ann', true)).toContain('预言家');
    expect(w.witchActs('Wy', 'Ann', null)).toContain('女巫');
  });

  it('name the roles of the board in English', () => {
    const w = wolf('en');
    expect(w.role).toEqual({
      wolf: 'Wolf', villager: 'Villager', seer: 'Seer', witch: 'Witch', hunter: 'Hunter', idiot: 'Idiot',
    });
    expect(w.rules).toContain('Twelve players');
    expect(w.rules).toContain('four wolves, four villagers');
  });

  it('join names and sentences as each language does', () => {
    expect(wolf('en').join(['Ann', 'Bob', 'Cy'])).toBe('Ann, Bob, Cy');
    expect(wolf('zh-CN').join(['Ann', 'Bob', 'Cy'])).toBe('Ann、Bob、Cy');
    expect(wolf('en').join(['Ann'])).toBe('Ann');
    expect(wolf('zh-CN').join(['Ann'])).toBe('Ann');
    expect(wolf('en').sentences(['One.', 'Two.'])).toBe('One. Two.');
    expect(wolf('zh-CN').sentences(['一。', '二。'])).toBe('一。二。');
  });
});

describe('the words of the game window', () => {
  it.each(LANGS)('has the title, the buttons and the notes in %s', (lang) => {
    const g = games(lang);
    for (const key of ['werewolfTitle', 'start', 'again', 'you', 'youLower', 'mindsOn', 'mindsOff'] as const) {
      expect(g[key].trim(), key).not.toBe('');
      expect(CJK.test(g[key]), `${lang} ${key}`).toBe(lang === 'zh-CN');
    }
  });

  it('says that the pets think with Copilot CLI and that it uses its quota, in the window and in the settings', () => {
    const quota: [Lang, RegExp][] = [['en', /quota/], ['zh-CN', /额度/]];
    for (const [lang, word] of quota) {
      expect(games(lang).mindsOn, lang).toContain('Copilot CLI');
      expect(games(lang).mindsOn, lang).toMatch(word);
      expect(games(lang).mindsOff, lang).toContain('Copilot CLI');
      expect(settings(lang).petGameWerewolfDesc, lang).toContain('Copilot CLI');
      expect(settings(lang).petGameWerewolfDesc, lang).toMatch(word);
    }
  });

  it('describes the game in the settings as a twelve-player game that can also just be watched', () => {
    const en = settings('en');
    const zh = settings('zh-CN');
    expect(en.petGameWerewolfDesc).toMatch(/twelve/i);
    expect(en.petGameWerewolfDesc).toMatch(/only watch/);
    expect(zh.petGameWerewolfDesc).toContain('十二');
    expect(zh.petGameWerewolfDesc).toContain('预女猎白');
    expect(zh.petGameWerewolfDesc).toContain('只看');
    for (const lang of LANGS) {
      expect(settings(lang).petGameWerewolf.trim(), lang).not.toBe('');
      expect(CJK.test(settings(lang).petGameWerewolf), lang).toBe(lang === 'zh-CN');
      expect(CJK.test(settings(lang).petGameWerewolfDesc), lang).toBe(lang === 'zh-CN');
    }
  });

  it('asks the user to play or to watch, and tells how many pets he may pick, in both languages', () => {
    for (const lang of LANGS) {
      const w = wolf(lang);
      expect(w.modePlay, lang).not.toBe(w.modeWatch);
      expect(w.pickPlay(11), lang).toContain('11');
      expect(w.pickWatch(12), lang).toContain('12');
      expect(w.watching.trim(), lang).not.toBe('');
    }
  });
});
