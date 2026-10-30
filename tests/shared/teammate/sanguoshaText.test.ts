import { describe, expect, it } from 'vitest';
import { strings } from '../../../src/shared/i18n';
import { CARD_NAMES, type CardInfo } from '../../../src/shared/teammate/sanguoshaCards';
import { HERO_IDS, KINGDOMS, SKILLS } from '../../../src/shared/teammate/sanguoshaHeroes';
import {
  askTitle, cardText, chatter, entryLines, moods, overText, sanguoshaText, type Mood, type Voice,
} from '../../../src/shared/teammate/sanguoshaText';
import type { Ask, Entry } from '../../../src/shared/teammate/sanguoshaTypes';

const LANGS = ['en', 'zh-CN'] as const;
type Lang = (typeof LANGS)[number];
type Of<K extends Entry['k']> = Extract<Entry, { k: K }>;

const games =  (lang: Lang) => strings(lang, 'win').teammate.games;
const wordsOf = (lang: Lang) => games(lang).sanguosha;

const NAMES = ['Me', 'Ann', 'Bob', 'Cy', 'Di'];
/** Seat 0 is the user: `who` names him as a speaker would and `whom` as a sentence does. */
const voice = (lang: Lang): Voice => ({
  who: (seat) => (seat === 0 ? games(lang).you : (NAMES[seat] ?? '?')),
  whom: (seat) => (seat === 0 ? games(lang).youLower : (NAMES[seat] ?? '?')),
});

const card = (name: CardInfo['name'], suit: CardInfo['suit'], rank: number): CardInfo => ({ name, suit, rank });
const strike = card('sha', 'spade', 7);
const dodge = card('shan', 'heart', 2);
const peach = card('tao', 'heart', 3);
const dilu = card('dilu', 'spade', 5);

const lines = (lang: Lang, e: Entry, me = 0, turns = 3) => entryLines(e, wordsOf(lang), voice(lang), me, turns);
const texts = (lang: Lang, e: Entry, me = 0, turns = 3): string[] => lines(lang, e, me, turns).map((l) => l.text);

describe('cardText', () => {
  it('names a card and then its suit and rank, in English as in Chinese', () => {
    expect(cardText(strike, wordsOf('en'))).toBe('Strike ♠7');
    expect(cardText(strike, wordsOf('zh-CN'))).toBe('【杀】♠7');
  });

  it('writes the faces and the ranks that are not numbers', () => {
    const w = wordsOf('en');
    expect(cardText(card('sha', 'heart', 1), w)).toBe('Strike ♥A');
    expect(cardText(card('sha', 'club', 10), w)).toBe('Strike ♣10');
    expect(cardText(card('sha', 'diamond', 11), w)).toBe('Strike ♦J');
    expect(cardText(card('sha', 'diamond', 12), w)).toBe('Strike ♦Q');
    expect(cardText(card('sha', 'spade', 13), w)).toBe('Strike ♠K');
  });
});

describe('the lines of the log: English', () => {
  it('says how the game begins and who chose whom', () => {
    expect(lines('en', { k: 'start', size: 5 })).toEqual([{ tone: 'sys', seat: null, text: 'A 5-player game begins. The lord plays first.' }]);
    expect(texts('en', { k: 'start', size: 8 })).toEqual(['An 8-player game begins. The lord plays first.']);
    expect(lines('en', { k: 'hero', seat: 1, hero: 'liubei' })).toEqual([
      { tone: 'sys', seat: 1, text: 'Ann chose Liu Bei (Shu).' },
    ]);
    expect(texts('en', { k: 'hero', seat: 0, hero: 'caocao' })).toEqual(['You chose Cao Cao (Wei).']);
  });

  it('numbers the turns with the count it is given', () => {
    expect(lines('en', { k: 'turn', seat: 2 }, 0, 9)).toEqual([{ tone: 'turn', seat: 2, text: 'Turn 9: Bob' }]);
    expect(texts('en', { k: 'turn', seat: 0 }, 0, 1)).toEqual(['Turn 1: You']);
  });

  it('says nothing of the phases and the end, which the page shows by itself', () => {
    expect(lines('en', { k: 'phase', seat: 1, phase: 'draw' })).toEqual([]);
    expect(lines('en', { k: 'end', winner: 'lord' })).toEqual([]);
    expect(lines('en', { k: 'end', winner: null })).toEqual([]);
  });

  it('says what is played on whom, and with which skill', () => {
    expect(lines('en', { k: 'use', seat: 1, name: 'sha', cards: [strike], targets: [2] })).toEqual([
      { tone: 'act', seat: 1, text: 'Ann played Strike ♠7 on Bob.' },
    ]);
    expect(texts('en', { k: 'use', seat: 1, name: 'sha', cards: [strike], targets: [0] })).toEqual(['Ann played Strike ♠7 on you.']);
    expect(texts('en', { k: 'use', seat: 1, name: 'wuzhong', cards: [card('wuzhong', 'club', 4)], targets: [] })).toEqual(['Ann played Windfall ♣4.']);
    expect(texts('en', { k: 'use', seat: 1, name: 'nanman', cards: [card('nanman', 'club', 4)], targets: [0, 2, 3] })).toEqual([
      'Ann played Barbarian Raid ♣4 on you, Bob, Cy.',
    ]);
  });

  it('says what a card was played as when a skill turned it into another', () => {
    expect(texts('en', { k: 'use', seat: 1, name: 'sha', cards: [peach], targets: [2], skill: 'wusheng' })).toEqual([
      'Ann (War Saint) played Peach ♥3 as Strike on Bob.',
    ]);
    expect(texts('en', { k: 'play', seat: 2, name: 'shan', cards: [strike], skill: 'longdan' })).toEqual([
      'Bob (Dragon Heart) played Strike ♠7 as Dodge.',
    ]);
  });

  it('says a card that was played with no card of its own by its name, and several cards each by theirs', () => {
    expect(texts('en', { k: 'use', seat: 1, name: 'sha', cards: [], targets: [2], skill: 'wusheng' })).toEqual([
      'Ann (War Saint) played Strike on Bob.',
    ]);
    expect(texts('en', { k: 'use', seat: 1, name: 'sha', cards: [strike, peach], targets: [2] })).toEqual([
      'Ann played Strike ♠7, Peach ♥3 on Bob.',
    ]);
  });

  it('says nothing when a weapon, an armour or a horse is played, for it is told when it is worn', () => {
    expect(lines('en', { k: 'use', seat: 1, name: 'zhuge', cards: [card('zhuge', 'club', 1)], targets: [] })).toEqual([]);
    expect(lines('en', { k: 'use', seat: 1, name: 'dilu', cards: [dilu], targets: [] })).toEqual([]);
    expect(lines('en', { k: 'use', seat: 1, name: 'bagua', cards: [card('bagua', 'spade', 2)], targets: [] })).toEqual([]);
    expect(texts('en', { k: 'equip', seat: 1, card: dilu })).toEqual(['Ann equipped Dilu ♠5.']);
  });

  it('says what is played to answer, and to save a dying player', () => {
    expect(lines('en', { k: 'play', seat: 2, name: 'shan', cards: [dodge] })).toEqual([
      { tone: 'act', seat: 2, text: 'Bob played Dodge ♥2.' },
    ]);
    expect(texts('en', { k: 'play', seat: 2, name: 'tao', cards: [peach], for: 3 })).toEqual(['Bob played Peach ♥3 to save Cy.']);
    expect(texts('en', { k: 'play', seat: 2, name: 'tao', cards: [peach], for: 0 })).toEqual(['Bob played Peach ♥3 to save you.']);
    expect(texts('en', { k: 'play', seat: 2, name: 'tao', cards: [peach], for: 2 })).toEqual(['Bob played Peach ♥3.']);
  });

  it('says which skill was used, and on whom', () => {
    expect(lines('en', { k: 'skill', seat: 1, skill: 'rende', targets: [2] })).toEqual([
      { tone: 'act', seat: 1, text: 'Ann used Benevolence on Bob.' },
    ]);
    expect(texts('en', { k: 'skill', seat: 1, skill: 'zhiheng' })).toEqual(['Ann used Balance.']);
    expect(texts('en', { k: 'skill', seat: 1, skill: 'zhiheng', targets: [] })).toEqual(['Ann used Balance.']);
  });

  it('tells the damage, the loss and the healing with their tones', () => {
    expect(lines('en', { k: 'damage', seat: 2, n: 1, source: 1 })).toEqual([{ tone: 'hit', seat: 2, text: 'Bob took 1 damage from Ann.' }]);
    expect(texts('en', { k: 'damage', seat: 0, n: 3, source: null })).toEqual(['You took 3 damage.']);
    expect(lines('en', { k: 'lose', seat: 2, n: 1 })).toEqual([{ tone: 'hit', seat: 2, text: 'Bob lost 1 HP.' }]);
    expect(lines('en', { k: 'heal', seat: 2, n: 2 })).toEqual([{ tone: 'heal', seat: 2, text: 'Bob healed 2 HP.' }]);
  });

  it('names the cards the user draws and counts the cards the others draw', () => {
    const mine: Of<'draw'> = { k: 'draw', seat: 0, n: 2, cards: [strike, dodge] };
    expect(texts('en', mine)).toEqual(['You drew Strike ♠7, Dodge ♥2.']);
    const theirs: Of<'draw'> = { k: 'draw', seat: 1, n: 2, cards: [strike, dodge] };
    expect(texts('en', theirs)).toEqual(['Ann drew 2 cards.']);
    expect(texts('en', { k: 'draw', seat: 1, n: 1, cards: [strike] })).toEqual(['Ann drew 1 card.']);
    expect(lines('en', theirs)[0]?.tone).toBe('sys');
  });

  it('names what is discarded, and whose it was', () => {
    expect(lines('en', { k: 'discard', seat: 1, cards: [strike, dodge] })).toEqual([
      { tone: 'act', seat: 1, text: 'Ann discarded Strike ♠7, Dodge ♥2.' },
    ]);
    expect(texts('en', { k: 'discard', seat: 1, cards: [strike], from: 2 })).toEqual(['Ann discarded Strike ♠7 from Bob.']);
  });

  it('keeps a hand card taken in secret secret, unless the user is the one who took it or lost it', () => {
      const hand: Of<'take'> = { k: 'take', seat: 1, from: 2, cards: [strike], zone: 'hand' };
    expect(texts('en', hand, 0)).toEqual(['Ann took a hand card from Bob.']);
    expect(texts('en', { ...hand, cards: [strike, dodge] }, 0)).toEqual(['Ann took 2 hand cards from Bob.']);
    expect(texts('en', hand, 1)).toEqual(['Ann took Strike ♠7 from Bob.']);
    expect(texts('en', hand, 2)).toEqual(['Ann took Strike ♠7 from Bob.']);
    expect(texts('en', { ...hand, from: 0 }, 0)).toEqual(['Ann took Strike ♠7 from you.']);
    for (const zone of ['equip', 'judge'] as const) {
      expect(texts('en', { ...hand, zone }, 0)).toEqual(['Ann took Strike ♠7 from Bob.']);
    }
  });

  it('names a card taken from the pile or the table, as one that nobody held', () => {
    expect(texts('en', { k: 'take', seat: 1, from: null, cards: [strike], zone: 'limbo' })).toEqual(['Ann took Strike ♠7.']);
  });

  it('keeps the cards one player gives another secret from everybody else', () => {
    const give: Of<'give'> = { k: 'give', seat: 1, to: 2, cards: [strike, dodge] };
    expect(texts('en', give, 0)).toEqual(['Ann gave 2 cards to Bob.']);
    expect(texts('en', { ...give, cards: [strike] }, 0)).toEqual(['Ann gave 1 card to Bob.']);
    expect(texts('en', give, 1)).toEqual(['Ann gave Strike ♠7, Dodge ♥2 to Bob.']);
    expect(texts('en', give, 2)).toEqual(['Ann gave Strike ♠7, Dodge ♥2 to Bob.']);
    expect(texts('en', { ...give, to: 0 }, 0)).toEqual(['Ann gave Strike ♠7, Dodge ♥2 to you.']);
  });

  it('names a judgement after what called it', () => {
    const why = (w: 'lebu' | 'bing' | 'shandian' | 'bagua' | 'luoshen' | 'tieqi' | 'ganglie'): string[] =>
      texts('en', { k: 'judge', seat: 1, card: strike, why: w });
    expect(why('lebu')).toEqual(['Judgement for Ann (Idle Pleasure): Strike ♠7.']);
    expect(why('bing')).toEqual(['Judgement for Ann (Supply Cut): Strike ♠7.']);
    expect(why('shandian')).toEqual(['Judgement for Ann (Lightning): Strike ♠7.']);
    expect(why('bagua')).toEqual(['Judgement for Ann (Eight Trigrams): Strike ♠7.']);
    expect(why('luoshen')).toEqual(['Judgement for Ann (Goddess of Luo): Strike ♠7.']);
    expect(why('tieqi')).toEqual(['Judgement for Ann (Iron Cavalry): Strike ♠7.']);
    expect(why('ganglie')).toEqual(['Judgement for Ann (Fierce Temper): Strike ♠7.']);
  });

  it('tells of the armour at work', () => {
    expect(texts('en', { k: 'armor', seat: 1, name: 'bagua' })).toEqual(['Ann used Eight Trigrams.']);
    expect(texts('en', { k: 'armor', seat: 1, name: 'renwang' })).toEqual(['Benevolent Shield shielded Ann from the Strike.']);
  });

  it('tells of a trick that was cancelled, for whom it was, and puts the line under that player', () => {
    expect(lines('en', { k: 'cancel', name: 'shandian', target: 2 })).toEqual([
      { tone: 'act', seat: 2, text: 'Lightning was cancelled for Bob.' },
    ]);
    expect(lines('en', { k: 'cancel', name: 'nanman', target: null })).toEqual([
      { tone: 'act', seat: null, text: 'Barbarian Raid was cancelled.' },
    ]);
  });

  it('tells of a skipped phase, a fall and a shuffle', () => {
    expect(texts('en', { k: 'skip', seat: 1, phase: 'play' })).toEqual(['Ann skipped the Play phase.']);
    expect(texts('en', { k: 'skip', seat: 1, phase: 'draw' })).toEqual(['Ann skipped the Draw phase.']);
    expect(texts('en', { k: 'skip', seat: 1, phase: 'discard' })).toEqual(['Ann skipped the Discard phase.']);
    expect(lines('en', { k: 'die', seat: 2, role: 'rebel', killer: 1 })).toEqual([
      { tone: 'hit', seat: 2, text: 'Bob fell (Rebel), killed by Ann.' },
    ]);
    expect(texts('en', { k: 'die', seat: 0, role: 'lord', killer: null })).toEqual(['You fell (Lord).']);
    expect(lines('en', { k: 'shuffle' })).toEqual([{ tone: 'sys', seat: null, text: 'The discards were shuffled back into the pile.' }]);
  });
});

describe('the lines of the log: Chinese', () => {
  it('says the same things the way Chinese players say them', () => {
    expect(texts('zh-CN', { k: 'start', size: 8 })).toEqual(['8 人局开始，主公先出牌。']);
    expect(texts('zh-CN', { k: 'hero', seat: 1, hero: 'liubei' })).toEqual(['Ann选择了刘备（蜀）。']);
    expect(texts('zh-CN', { k: 'turn', seat: 2 }, 0, 4)).toEqual(['第 4 回合：Bob']);
    expect(texts('zh-CN', { k: 'use', seat: 1, name: 'sha', cards: [strike], targets: [2] })).toEqual(['Ann使用了【杀】♠7，目标：Bob。']);
    expect(texts('zh-CN', { k: 'use', seat: 1, name: 'sha', cards: [peach], targets: [2], skill: 'wusheng' })).toEqual([
      'Ann（武圣）使用了【桃】♥3当作【杀】，目标：Bob。',
    ]);
    expect(texts('zh-CN', { k: 'play', seat: 2, name: 'shan', cards: [dodge] })).toEqual(['Bob打出了【闪】♥2。']);
    expect(texts('zh-CN', { k: 'play', seat: 2, name: 'tao', cards: [peach], for: 3 })).toEqual(['Bob打出【桃】♥3，救了Cy。']);
    expect(texts('zh-CN', { k: 'skill', seat: 1, skill: 'rende', targets: [2] })).toEqual(['Ann发动了仁德，目标：Bob。']);
    expect(texts('zh-CN', { k: 'damage', seat: 2, n: 1, source: 1 })).toEqual(['Bob受到 Ann 造成的 1 点伤害。']);
    expect(texts('zh-CN', { k: 'damage', seat: 0, n: 2, source: null })).toEqual(['你受到 2 点伤害。']);
    expect(texts('zh-CN', { k: 'heal', seat: 2, n: 1 })).toEqual(['Bob回复了 1 点体力。']);
    expect(texts('zh-CN', { k: 'draw', seat: 0, n: 2, cards: [strike, dodge] })).toEqual(['你摸到了【杀】♠7、【闪】♥2。']);
    expect(texts('zh-CN', { k: 'draw', seat: 1, n: 2, cards: [strike, dodge] })).toEqual(['Ann摸了 2 张牌。']);
    expect(texts('zh-CN', { k: 'discard', seat: 1, cards: [strike], from: 2 })).toEqual(['Ann弃置了Bob的【杀】♠7。']);
    expect(texts('zh-CN', { k: 'take', seat: 1, from: 2, cards: [strike], zone: 'hand' })).toEqual(['Ann获得了Bob的 1 张手牌。']);
    expect(texts('zh-CN', { k: 'judge', seat: 1, card: strike, why: 'lebu' })).toEqual(['Ann的判定（乐不思蜀）：【杀】♠7。']);
    expect(texts('zh-CN', { k: 'cancel', name: 'shandian', target: 2 })).toEqual(['【闪电】对Bob被抵消了。']);
    expect(texts('zh-CN', { k: 'skip', seat: 1, phase: 'play' })).toEqual(['Ann跳过了出牌阶段。']);
    expect(texts('zh-CN', { k: 'die', seat: 2, role: 'rebel', killer: 1 })).toEqual(['Bob阵亡了（反贼），被Ann击杀。']);
    expect(texts('zh-CN', { k: 'die', seat: 0, role: 'lord', killer: null })).toEqual(['你阵亡了（主公）。']);
  });

  it('keeps the secrets of the table in Chinese too', () => {
    const hand: Of<'take'> = { k: 'take', seat: 1, from: 2, cards: [strike], zone: 'hand' };
    expect(texts('zh-CN', hand, 0)[0]).not.toContain('杀');
    expect(texts('zh-CN', hand, 2)[0]).toContain('杀');
    expect(texts('zh-CN', { k: 'give', seat: 1, to: 2, cards: [strike] }, 0)[0]).not.toContain('杀');
    expect(texts('zh-CN', { k: 'give', seat: 1, to: 0, cards: [strike] }, 0)[0]).toContain('杀');
  });
});

describe('the lines of the log, entry by entry', () => {
  const every: Entry[] = [
    { k: 'start', size: 5 }, { k: 'hero', seat: 1, hero: 'zhaoyun' }, { k: 'turn', seat: 1 },
    { k: 'phase', seat: 1, phase: 'play' }, { k: 'use', seat: 1, name: 'sha', cards: [strike], targets: [2] },
    { k: 'play', seat: 1, name: 'shan', cards: [dodge] }, { k: 'skill', seat: 1, skill: 'kurou' },
    { k: 'damage', seat: 1, n: 1, source: 2 }, { k: 'lose', seat: 1, n: 1 }, { k: 'heal', seat: 1, n: 1 },
    { k: 'draw', seat: 1, n: 2, cards: [strike, dodge] }, { k: 'discard', seat: 1, cards: [strike] },
    { k: 'take', seat: 1, from: 2, cards: [strike], zone: 'equip' }, { k: 'give', seat: 1, to: 2, cards: [strike] },
    { k: 'equip', seat: 1, card: dilu }, { k: 'judge', seat: 1, card: strike, why: 'bing' },
    { k: 'armor', seat: 1, name: 'bagua' }, { k: 'cancel', name: 'wuzhong', target: 1 },
    { k: 'skip', seat: 1, phase: 'draw' }, { k: 'die', seat: 1, role: 'traitor', killer: 2 }, { k: 'shuffle' },
    { k: 'end', winner: 'rebel' },
  ];

  it.each(LANGS)('say something clean for every kind of entry, in %s', (lang) => {
    const kinds = new Set<string>();
    for (const e of every) {
      kinds.add(e.k);
      for (const line of lines(lang, e)) {
        expect(line.text.trim(), e.k).not.toBe('');
        expect(line.text, e.k).not.toMatch(/undefined|NaN|\[object|\bnull\b/);
        expect(line.text, e.k).not.toMatch(/[{}]/);
        expect(['sys', 'turn', 'act', 'hit', 'heal', 'say', 'secret']).toContain(line.tone);
        expect(line.seat === null || Number.isInteger(line.seat), e.k).toBe(true);
      }
    }
    expect(kinds.size).toBe(22);
  });

  it('name every card of the deck in a line, in both languages', () => {
    for (const lang of LANGS) {
      for (const name of CARD_NAMES) {
        const e: Entry = { k: 'discard', seat: 1, cards: [card(name, 'club', 5)] };
        expect(texts(lang, e)[0], `${lang} ${name}`).toContain(wordsOf(lang).card[name].name);
      }
    }
  });

  it('name every hero and every skill in a line, in both languages', () => {
    for (const lang of LANGS) {
      for (const hero of HERO_IDS) {
        expect(texts(lang, { k: 'hero', seat: 1, hero })[0], `${lang} ${hero}`).toContain(wordsOf(lang).hero[hero]);
      }
      for (const skill of SKILLS) {
        expect(texts(lang, { k: 'skill', seat: 1, skill })[0], `${lang} ${skill}`).toContain(wordsOf(lang).skill[skill].name);
      }
    }
  });
});

describe('the questions', () => {
  const ask = (lang: Lang, a: Ask, me = 0): string => askTitle(a, wordsOf(lang), voice(lang), me);
  const cards = (why: Extract<Ask, { k: 'cards' }>['why'], ctx: Extract<Ask, { k: 'cards' }>['ctx'] = {}, min = 1): Ask =>
    ({ k: 'cards', why, ctx, cards: [1, 2], min, max: 2 });

  it('asks to pick a hero, and says that the lord has an extra point', () => {
    expect(ask('en', { k: 'hero', heroes: ['liubei'], lord: false })).toBe('Pick your hero.');
    expect(ask('en', { k: 'hero', heroes: ['liubei'], lord: true })).toBe('You are the lord: pick your hero. The lord starts with 1 extra HP.');
    expect(ask('zh-CN', { k: 'hero', heroes: ['liubei'], lord: false })).toBe('选择你的武将。');
    expect(ask('zh-CN', { k: 'hero', heroes: ['liubei'], lord: true })).toContain('主公');
  });

  it('asks for the turn, naming nobody', () => {
    expect(ask('en', { k: 'play', uses: [], skills: [] })).toBe('Your turn. Click a card to play it, or use a skill.');
    expect(ask('zh-CN', { k: 'play', uses: [], skills: [] })).toBe('轮到你了。点一张牌打出，或者发动技能。');
  });

  it('asks for a Dodge against a Strike, and how many when it takes more than one', () => {
    expect(ask('en', cards('shan', { from: 1, name: 'sha', need: 1 }))).toBe('Strike from Ann. Play a Dodge or take the hit.');
    expect(ask('en', cards('shan', { from: 1, name: 'sha', need: 2 }))).toBe('Strike from Ann. Play a Dodge (2 needed) or take the hit.');
    expect(ask('en', cards('shan', { from: 1, name: 'wanjian' }))).toBe('Arrow Volley from Ann. Play a Dodge or take the hit.');
    expect(ask('zh-CN', cards('shan', { from: 1, name: 'sha', need: 1 }))).toBe('Ann 的【杀】。打出一张【闪】，否则受到伤害。');
    expect(ask('zh-CN', cards('shan', { from: 1, name: 'sha', need: 2 }))).toContain('还需 2 张');
  });

  it('asks for a Strike against a Duel or a Barbarian Raid', () => {
    expect(ask('en', cards('sha', { from: 2, name: 'juedou', need: 1 }))).toBe('Duel from Bob. Play a Strike or lose 1 HP.');
    expect(ask('en', cards('sha', { from: 2, name: 'nanman' }))).toBe('Barbarian Raid from Bob. Play a Strike or lose 1 HP.');
    expect(ask('en', cards('sha', { from: 2, name: 'juedou', need: 2 }))).toContain('(2 needed)');
  });

  it('asks for a Peach for oneself, or for another who is dying', () => {
    expect(ask('en', cards('tao', { target: 0 }))).toBe('You are dying! Play a Peach to survive.');
    expect(ask('en', cards('tao', { target: 2 }))).toBe('Bob is dying. Play a Peach to save them?');
    expect(ask('zh-CN', cards('tao', { target: 0 }))).toBe('你濒死了！打出一张【桃】自救？');
    expect(ask('zh-CN', cards('tao', { target: 2 }))).toBe('Bob 濒死了。要打出【桃】救他吗？');
  });

  it('asks whether to cancel a trick, and says whether it goes through as things stand', () => {
    expect(ask('en', cards('wuxie', { name: 'juedou', from: 1, target: 2, on: true }))).toBe(
      'Duel from Ann is about to take effect on Bob. Play a Counter to cancel it?',
    );
    expect(ask('en', cards('wuxie', { name: 'juedou', from: 1, target: 2, on: false }))).toBe(
      'Duel from Ann is about to take effect on Bob. It is cancelled for now. Play a Counter to let it through?',
    );
    expect(ask('en', cards('wuxie', { name: 'taoyuan' }))).toBe('Peach Garden Oath is about to take effect. Play a Counter to cancel it?');
    expect(ask('en', cards('wuxie', { name: 'chai', target: 0 }))).toBe('Dismantle is about to take effect on you. Play a Counter to cancel it?');
    expect(ask('zh-CN', cards('wuxie', { name: 'juedou', from: 1, target: 2, on: true }))).toBe(
      'Ann 的【决斗】即将对Bob生效。要打出【无懈可击】使其无效吗？',
    );
  });

  it('asks how many to discard, from the question when it is not told', () => {
    expect(ask('en', cards('discard', { amount: 3 }, 3))).toBe('Discard 3 cards.');
    expect(ask('en', cards('discard', {}, 1))).toBe('Discard 1 card.');
    expect(ask('zh-CN', cards('discard', { amount: 2 }, 2))).toBe('请弃置 2 张牌。');
  });

  it('asks about the skills and the weapons that ask the user', () => {
    expect(ask('en', cards('ganglie', { from: 3 }))).toBe('Fierce Temper from Cy: discard 2 hand cards, or lose 1 HP.');
    expect(ask('en', cards('guanshi', { target: 2 }))).toBe('Your Strike was dodged. Discard 2 cards to hit Bob anyway?');
    expect(ask('en', cards('qilin', { target: 2 }))).toBe('Your Strike hit Bob. Discard one of the horses they wear?');
    expect(ask('en', cards('qinglong', { target: 2 }))).toBe('Your Strike was dodged. Play another Strike at Bob?');
    expect(ask('en', cards('guanxing'))).toContain('under the pile');
    expect(ask('en', cards('guicai', { target: 1, card: strike }))).toBe('A judgement for Ann flipped Strike ♠7. Play a hand card in its place?');
    expect(ask('zh-CN', cards('guicai', { target: 1, card: strike }))).toBe('Ann的判定翻出了【杀】♠7。要打出一张手牌代替它吗？');
    expect(ask('zh-CN', cards('ganglie', { from: 3 }))).toBe('Cy 的刚烈：弃置两张手牌，否则失去 1 点体力。');
  });

  it('asks which card to discard or take from a player', () => {
    const area = (why: 'chai' | 'shun' | 'fankui', owner: number): Ask => ({ k: 'area', why, ctx: {}, owner, hand: 1, equip: [], judges: [] });
    expect(ask('en', area('chai', 2))).toBe('Pick a card of Bob’s to discard.');
    expect(ask('en', area('shun', 2))).toBe('Pick a card of Bob’s to take.');
    expect(ask('en', area('fankui', 3))).toBe('Pick a card of Cy’s to take.');
    expect(ask('zh-CN', area('chai', 2))).toBe('选择 Bob 的一张牌弃置。');
    expect(ask('zh-CN', area('shun', 2))).toBe('选择 Bob 的一张牌获得。');
  });

  it('asks whom to raid, and whether to use a skill that costs something', () => {
    expect(ask('en', { k: 'seat', why: 'tuxi', ctx: {}, options: [1, 2], min: 0, max: 2 })).toContain('Pick up to 2 players');
    expect(ask('zh-CN', { k: 'seat', why: 'tuxi', ctx: {}, options: [1, 2], min: 0, max: 2 })).toContain('最多选两名角色');
    for (const lang of LANGS) {
      const a = (why: 'bagua' | 'luoshen' | 'luoyi'): string => ask(lang, { k: 'confirm', why, ctx: {} });
      expect(a('bagua')).toBe(wordsOf(lang).ask.confirm.bagua);
      expect(a('luoshen')).toBe(wordsOf(lang).ask.confirm.luoshen);
      expect(a('luoyi')).toBe(wordsOf(lang).ask.confirm.luoyi);
    }
  });

  it.each(LANGS)('has a clean title for every kind of question, in %s', (lang) => {
    const whys: Extract<Ask, { k: 'cards' }>['why'][] = [
      'shan', 'sha', 'tao', 'wuxie', 'discard', 'ganglie', 'guanshi', 'guicai', 'guanxing', 'qilin', 'qinglong',
    ];
    const all: Ask[] = [
      { k: 'hero', heroes: [], lord: true }, { k: 'play', uses: [], skills: [] },
      ...whys.map((why) => cards(why, { from: 1, target: 2, name: 'sha', amount: 1, card: strike })),
      ...(['chai', 'shun', 'fankui'] as const).map((why): Ask => ({ k: 'area', why, ctx: {}, owner: 1, hand: 0, equip: [], judges: [] })),
      { k: 'seat', why: 'tuxi', ctx: {}, options: [], min: 0, max: 2 },
      ...(['bagua', 'luoshen', 'luoyi'] as const).map((why): Ask => ({ k: 'confirm', why, ctx: {} })),
    ];
    for (const a of all) {
      const title = ask(lang, a);
      expect(title.trim(), `${a.k}`).not.toBe('');
      expect(title, `${a.k}`).not.toMatch(/undefined|NaN|\[object|\bnull\b/);
      expect(title, `${a.k}`).not.toMatch(/[{}]/);
    }
  });
});

describe('the end of a game', () => {
  const seats = [
    { name: 'Me', role: 'rebel' as const }, { name: 'Ann', role: 'lord' as const },
    { name: 'Bob', role: 'traitor' as const }, { name: 'Cy', role: 'loyalist' as const },
  ];

  it('says the user has won when his side has, and why', () => {
    const w = wordsOf('en');
    const rebel = overText('rebel', 'rebel', seats, w);
    expect(rebel.win).toBe(true);
    expect(rebel.title).toBe('You win!');
    expect(rebel.text).toBe(`The rebels win: the lord has fallen.\nRoles: 1. Me Rebel / 2. Ann Lord / 3. Bob Traitor / 4. Cy Loyalist`);
    const lord = overText('lord', 'loyalist', seats, w);
    expect(lord.win).toBe(true);
    expect(lord.text.split('\n')[0]).toBe('The lord’s side wins: every rebel and the traitor are out.');
    expect(overText('lord', 'lord', seats, w).win).toBe(true);
    expect(overText('traitor', 'traitor', seats, w).win).toBe(true);
    expect(overText('traitor', 'traitor', seats, w).text.split('\n')[0]).toBe('The traitor wins: the last one standing.');
  });

  it('says that he has lost when another side has won', () => {
    const w = wordsOf('en');
    for (const [winner, mine] of [
      ['rebel', 'lord'], ['rebel', 'loyalist'], ['rebel', 'traitor'], ['lord', 'rebel'], ['lord', 'traitor'],
      ['traitor', 'lord'], ['traitor', 'loyalist'], ['traitor', 'rebel'],
    ] as const) {
      const over = overText(winner, mine, seats, w);
      expect(over.win, `${winner} wins, I am ${mine}`).toBe(false);
      expect(over.title).toBe('You lose.');
    }
  });

  it('calls a game off with no winner and no cause', () => {
    const over = overText(null, 'rebel', seats, wordsOf('en'));
    expect(over.win).toBe(false);
    expect(over.title).toBe('The game was called off after too many turns. Nobody wins.');
    expect(over.text).toBe('Roles: 1. Me Rebel / 2. Ann Lord / 3. Bob Traitor / 4. Cy Loyalist');
  });

  it('says it in Chinese, with the roles revealed', () => {
    const w = wordsOf('zh-CN');
    expect(overText('rebel', 'rebel', seats, w)).toEqual({
      win: true, title: '你赢了！', text: '反贼获胜：主公阵亡了。\n身份：1. Me 反贼 / 2. Ann 主公 / 3. Bob 内奸 / 4. Cy 忠臣',
    });
    expect(overText('lord', 'rebel', seats, w).title).toBe('你输了。');
    expect(overText(null, 'rebel', seats, w).title).toBe('回合数太多，对局被终止，无人获胜。');
  });
});

describe('what the pets say', () => {
  it('says who might speak after a blow, a healing or a fall, in what mood', () => {
    expect(moods({ k: 'damage', seat: 2, n: 1, source: 1 })).toEqual([{ seat: 2, mood: 'hurt' }, { seat: 1, mood: 'hit' }]);
    expect(moods({ k: 'damage', seat: 2, n: 1, source: 2 })).toEqual([{ seat: 2, mood: 'hurt' }]);
    expect(moods({ k: 'damage', seat: 2, n: 1, source: null })).toEqual([{ seat: 2, mood: 'hurt' }]);
    expect(moods({ k: 'heal', seat: 3, n: 1 })).toEqual([{ seat: 3, mood: 'heal' }]);
    expect(moods({ k: 'die', seat: 2, role: 'rebel', killer: 1 })).toEqual([{ seat: 2, mood: 'fall' }, { seat: 1, mood: 'kill' }]);
    expect(moods({ k: 'die', seat: 2, role: 'rebel', killer: 2 })).toEqual([{ seat: 2, mood: 'fall' }]);
    expect(moods({ k: 'die', seat: 2, role: 'rebel', killer: null })).toEqual([{ seat: 2, mood: 'fall' }]);
  });

  it('says nothing after anything else', () => {
    const quiet: Entry[] = [
      { k: 'start', size: 5 }, { k: 'turn', seat: 1 }, { k: 'use', seat: 1, name: 'sha', cards: [strike], targets: [2] },
      { k: 'play', seat: 1, name: 'shan', cards: [dodge] }, { k: 'lose', seat: 1, n: 1 }, { k: 'draw', seat: 1, n: 2, cards: [] },
      { k: 'discard', seat: 1, cards: [] }, { k: 'equip', seat: 1, card: dilu }, { k: 'shuffle' }, { k: 'end', winner: null },
    ];
    for (const e of quiet) expect(moods(e), e.k).toEqual([]);
  });

  const MOODS: Mood[] = ['hit', 'hurt', 'heal', 'kill', 'fall', 'win', 'lose'];

  it.each(LANGS)('has a line for every mood, and takes the pool by the random number, in %s', (lang) => {
    const w = wordsOf(lang);
    for (const mood of MOODS) {
      const pool = w.chat[mood];
      expect(chatter(mood, w, () => 0), mood).toBe(pool[0]);
      expect(chatter(mood, w, () => 0.999999), mood).toBe(pool[pool.length - 1]);
      expect(chatter(mood, w, () => 1), `${mood} at 1`).toBe(pool[pool.length - 1]);
      for (const x of [0.1, 0.4, 0.7]) expect(pool).toContain(chatter(mood, w, () => x));
    }
  });
});

describe('the words of the page', () => {
  it.each(LANGS)('are all text, with the lobby words in them, in %s', (lang) => {
    const g = games(lang);
    const w = g.sanguosha;
    const t = sanguoshaText(g);
    for (const [key, value] of Object.entries(t)) {
      expect(typeof value, key).toBe('string');
      expect(value.trim(), key).not.toBe('');
    }
    expect(t.title).toBe(w.title);
    expect(t.start).toBe(g.start);
    expect(t.again).toBe(g.again);
    expect(t.mindsOn).toBe(g.mindsOn);
    expect(t.mindsOff, 'the pets here never think with Copilot CLI').toBe(w.bots);
    expect(t.rules).toBe(w.rules);
    expect(t.pick).toBe(w.pick);
    expect(t.size_5).toBe(w.size5);
    expect(t.size_8).toBe(w.size8);
    expect(t.turnNo).toBe(w.turnNo);
    expect(t.endTurn).toBe(w.endTurn);
  });

  it.each(LANGS)('name every card, hero, skill, role, kingdom and phase of the table, in %s', (lang) => {
    const w = wordsOf(lang);
    const t = sanguoshaText(games(lang));
    for (const name of CARD_NAMES) {
      expect(t[`card_${name}`], name).toBe(w.card[name].name);
      expect(t[`tip_${name}`], name).toBe(w.card[name].tip);
    }
    for (const hero of HERO_IDS) expect(t[`hero_${hero}`], hero).toBe(w.hero[hero]);
    for (const skill of SKILLS) {
      expect(t[`skill_${skill}`], skill).toBe(w.skill[skill].name);
      expect(t[`skillTip_${skill}`], skill).toBe(w.skill[skill].tip);
    }
    for (const role of ['lord', 'loyalist', 'rebel', 'traitor'] as const) {
      expect(t[`role_${role}`], role).toBe(w.role[role]);
      expect(t[`roleHint_${role}`], role).toBe(w.roleHint[role]);
    }
    for (const kingdom of KINGDOMS) expect(t[`kingdom_${kingdom}`], kingdom).toBe(w.kingdom[kingdom]);
    for (const phase of ['start', 'judge', 'draw', 'play', 'discard', 'end'] as const) {
      expect(t[`phase_${phase}`], phase).toBe(w.phase[phase]);
    }
  });

  it('has the words in English and in Chinese that differ', () => {
    const en = sanguoshaText(games('en'));
    const zh = sanguoshaText(games('zh-CN'));
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    expect(en.title).toBe('Sanguosha');
    expect(zh.title).toBe('三国杀');
    expect(en.card_sha).toBe('Strike');
    expect(zh.card_sha).toBe('杀');
    expect(en.role_lord).toBe('Lord');
    expect(zh.role_lord).toBe('主公');
  });
});
