import { describe, expect, it } from 'vitest';
import { strings } from '../../../src/shared/i18n';
import { checkPlay, type Card, type Combo, type Play } from '../../../src/shared/teammate/doudizhuCards';
import {
  askTitle, cardList, cardText, chatter, doudizhuText, entryLines, moods, overText, playLabel, type Mood,
} from '../../../src/shared/teammate/doudizhuText';
import type { Entry, Result } from '../../../src/shared/teammate/doudizhuTypes';
import { cards } from './doudizhuRig';

const LANGS = ['en', 'zh-CN'] as const;
type Lang = (typeof LANGS)[number];

const games = (lang: Lang) => strings(lang, 'win').teammate.games;
const wordsOf = (lang: Lang) => games(lang).doudizhu;

const NAMES = ['Me', 'Ann', 'Bob', 'Cy', 'Di', 'Ed'];
/** Seat 0 is the user, whom the words call "you". */
const nameOf = (lang: Lang) => (seat: number): string => (seat === 0 ? games(lang).you : (NAMES[seat] ?? '?'));

/** The cards of a spelled-out hand, played as one play at a table of `decks` packs. */
function played(spec: string, decks = 1): { cards: Card[]; play: Play } {
  const hand = cards(spec);
  const play = checkPlay(hand, hand.map((c) => c.id), null, decks);
  if (play === null) throw new Error(`not a play: ${spec}`);
  return { cards: hand, play };
}

const lines = (lang: Lang, e: Entry) => entryLines(e, wordsOf(lang), nameOf(lang));
const texts = (lang: Lang, e: Entry): string[] => lines(lang, e).map((l) => l.text);
const playEntry = (seat: number, spec: string, decks = 1): Entry => ({ k: 'play', seat, ...played(spec, decks) });

describe('doudizhuText', () => {
  it.each(LANGS)('is one flat set of strings with every label of the page in %s', (lang) => {
    const t = doudizhuText(games(lang));
    for (const [key, value] of Object.entries(t)) {
      expect(typeof value, key).toBe('string');
      expect(value.trim(), key).not.toBe('');
    }
    const w = wordsOf(lang);
    expect(t.title).toBe(w.title);
    expect(t.start).toBe(games(lang).start);
    expect(t.again).toBe(games(lang).again);
    expect(t.mindsOn).toBe(w.minds);
    expect(t.mindsOff).toBe(games(lang).mindsOff);
    expect(t.thinking).toBe(w.thinking);
    expect(t.rules).toBe(w.rules);
    expect([t.size_3, t.size_4, t.size_5, t.size_6]).toEqual([w.size3, w.size4, w.size5, w.size6]);
    expect([t.phase_bid, t.phase_play, t.phase_over]).toEqual([w.phase.bid, w.phase.play, w.phase.over]);
    expect([t.role_landlord, t.role_farmer, t.role_unknown, t.role_hidden]).toEqual([
      w.role.landlord, w.role.farmer, w.role.unknown, w.role.hidden,
    ]);
    expect([t.roleHint_landlord, t.roleHint_farmer, t.roleHint_hidden]).toEqual([
      w.roleHint.landlord, w.roleHint.farmer, w.roleHint.hidden,
    ]);
    expect([t.smallJoker, t.bigJoker]).toEqual([w.joker.small, w.joker.big]);
    for (const key of [
      'pick', 'stake', 'called', 'calledTip', 'holes', 'count', 'pass', 'play', 'hint', 'clear', 'bidNone', 'bidOf',
      'yourTurn', 'waiting', 'pickHint', 'noHint',
    ] as const) expect(t[key], key).toBe(w[key]);
  });

  it('has the same keys in both languages', () => {
    expect(Object.keys(doudizhuText(games('zh-CN'))).sort()).toEqual(Object.keys(doudizhuText(games('en'))).sort());
  });
});

describe('cardText', () => {
  it('names a card by its suit and rank, and a joker by its name', () => {
    const [three, , king, ace, two, small, big] = cards('3 3 K A 2 S B') as [Card, Card, Card, Card, Card, Card, Card];
    expect(cardText(three, wordsOf('en'))).toBe('♠3');
    expect(cardText(king, wordsOf('en'))).toBe('♠K');
    expect(cardText(ace, wordsOf('en'))).toBe('♠A');
    expect(cardText(two, wordsOf('en'))).toBe('♠2');
    expect(cardText(small, wordsOf('en'))).toBe('Small Joker');
    expect(cardText(big, wordsOf('en'))).toBe('Big Joker');
    expect(cardText(small, wordsOf('zh-CN'))).toBe('小王');
    expect(cardText(big, wordsOf('zh-CN'))).toBe('大王');
    expect(cardText(king, wordsOf('zh-CN'))).toBe('♠K');
  });

  it('writes the ten as 10 and every suit with its own sign', () => {
    const ten = cards('10 10 10 10');
    expect(ten.map((c) => cardText(c, wordsOf('en')))).toEqual(['♠10', '♥10', '♣10', '♦10']);
  });

  it('lists cards as each language lists them', () => {
    const hand = cards('3 3 S');
    expect(cardList(hand, wordsOf('en'))).toBe('♠3, ♥3, Small Joker');
    expect(cardList(hand, wordsOf('zh-CN'))).toBe('♠3 ♥3 小王');
  });
});

describe('playLabel', () => {
  it('names a play by its shape', () => {
    const en = wordsOf('en');
    expect(playLabel(played('3').play.combo, en)).toBe('Single');
    expect(playLabel(played('3 3').play.combo, en)).toBe('Pair');
    expect(playLabel(played('3 3 3 4').play.combo, en)).toBe('Triple + single');
    expect(playLabel(played('3 4 5 6 7').play.combo, en)).toBe('Straight');
    expect(playLabel(played('3 3 4 4 5 5').play.combo, en)).toBe('Pair run');
    expect(playLabel(played('3 3 3 4 4 4').play.combo, en)).toBe('Plane');
    expect(playLabel(played('7 7 7 7').play.combo, en)).toBe('Bomb');
    expect(playLabel(played('S B').play.combo, en)).toBe('Rocket');
    const zh = wordsOf('zh-CN');
    expect(playLabel(played('3 3 3 4').play.combo, zh)).toBe('三带一');
    expect(playLabel(played('S B').play.combo, zh)).toBe('火箭');
  });

  it('says how many cards a bomb of more than four has', () => {
    const five = played('7 7 7 7 7', 2).play.combo;
    expect(playLabel(five, wordsOf('en'))).toBe('Bomb of 5');
    expect(playLabel(five, wordsOf('zh-CN'))).toBe('5 张炸弹');
    const four: Combo = played('7 7 7 7').play.combo;
    expect(playLabel(four, wordsOf('en'))).toBe('Bomb');
  });
});

describe('the lines of the log: English', () => {
  it('says how the game begins and that the cards are dealt', () => {
    expect(lines('en', { k: 'start', size: 3 })).toEqual([{ tone: 'sys', seat: null, text: 'A 3-player game begins.' }]);
    expect(texts('en', { k: 'start', size: 6 })).toEqual(['A 6-player game begins.']);
    expect(lines('en', { k: 'deal' })).toEqual([{ tone: 'sys', seat: null, text: 'The cards are dealt.' }]);
    expect(texts('en', { k: 'redeal' })).toEqual(['Nobody bid, so the cards are dealt again.']);
  });

  it('says a bid, and a pass of the bidding in a tone of its own', () => {
    expect(lines('en', { k: 'bid', seat: 1, bid: 2 })).toEqual([{ tone: 'act', seat: 1, text: 'Ann bid 2.' }]);
    expect(lines('en', { k: 'bid', seat: 0, bid: 0 })).toEqual([{ tone: 'pass', seat: 0, text: 'You did not bid.' }]);
    expect(texts('en', { k: 'bid', seat: 0, bid: 3 })).toEqual(['You bid 3.']);
  });

  it('says who is the landlord, and what they took from the bottom', () => {
    expect(lines('en', { k: 'landlord', seat: 2, bid: 3, holes: cards('3 K A') })).toEqual([
      { tone: 'head', seat: 2, text: 'Bob won the bidding at 3 and took the bottom cards: ♠3, ♠K, ♠A.' },
    ]);
    expect(texts('en', { k: 'landlord', seat: 0, bid: 1, holes: cards('S B 2') })).toEqual([
      'You won the bidding at 1 and took the bottom cards: Small Joker, Big Joker, ♠2.',
    ]);
  });

  it('says the card that was called, and takes the bottom cards only where there are some', () => {
    const [king] = cards('K') as [Card];
    expect(lines('en', { k: 'call', seat: 1, card: king, holes: [] })).toEqual([
      { tone: 'head', seat: 1, text: 'The called card is ♠K. Ann held its first copy and became the landlord.' },
    ]);
    expect(texts('en', { k: 'call', seat: 0, card: king, holes: cards('3 4 5') })).toEqual([
      'The called card is ♠K. You held its first copy and became the landlord, taking the bottom cards: ♠3, ♠4, ♠5.',
    ]);
  });

  it('says what is played, and what it counts as', () => {
    expect(lines('en', playEntry(1, '3 3'))).toEqual([{ tone: 'act', seat: 1, text: 'Ann played ♠3, ♥3 (Pair).' }]);
    expect(texts('en', playEntry(0, '3 4 5 6 7'))).toEqual(['You played ♠3, ♠4, ♠5, ♠6, ♠7 (Straight).']);
    expect(texts('en', playEntry(2, '9 9 9 5'))).toEqual(['Bob played ♠9, ♥9, ♣9, ♠5 (Triple + single).']);
  });

  it('plays a bomb and a rocket in a tone of their own', () => {
    expect(lines('en', playEntry(1, '7 7 7 7'))).toEqual([
      { tone: 'bomb', seat: 1, text: 'Ann played ♠7, ♥7, ♣7, ♦7 (Bomb).' },
    ]);
    expect(lines('en', playEntry(1, 'S B'))).toEqual([
      { tone: 'bomb', seat: 1, text: 'Ann played Small Joker, Big Joker (Rocket).' },
    ]);
    expect(texts('en', playEntry(3, '7 7 7 7 7', 2))).toEqual(['Cy played ♠7, ♥7, ♣7, ♦7, ♠7 (Bomb of 5).']);
  });

  it('says a pass, and who played the called card', () => {
    expect(lines('en', { k: 'pass', seat: 1 })).toEqual([{ tone: 'pass', seat: 1, text: 'Ann passed.' }]);
    expect(texts('en', { k: 'pass', seat: 0 })).toEqual(['You passed.']);
    expect(lines('en', { k: 'reveal', seat: 3 })).toEqual([
      { tone: 'sys', seat: 3, text: 'Cy played the called card: another landlord!' },
    ]);
  });

  it('says nothing of whose turn it is, and nothing of the end, which the page shows by itself', () => {
    expect(lines('en', { k: 'turn', seat: 1, lead: true })).toEqual([]);
    expect(lines('en', { k: 'turn', seat: 2, lead: false })).toEqual([]);
    expect(lines('en', { k: 'end', result: result() })).toEqual([]);
  });
});

describe('the lines of the log: Chinese', () => {
  it('says how the game begins and that the cards are dealt', () => {
    expect(texts('zh-CN', { k: 'start', size: 3 })).toEqual(['3 人局开始。']);
    expect(texts('zh-CN', { k: 'deal' })).toEqual(['发牌。']);
    expect(texts('zh-CN', { k: 'redeal' })).toEqual(['没人叫分，重新发牌。']);
  });

  it('says a bid and the bottom cards', () => {
    expect(texts('zh-CN', { k: 'bid', seat: 1, bid: 2 })).toEqual(['Ann叫了 2 分。']);
    expect(lines('zh-CN', { k: 'bid', seat: 0, bid: 0 })).toEqual([{ tone: 'pass', seat: 0, text: '你不叫。' }]);
    expect(texts('zh-CN', { k: 'landlord', seat: 2, bid: 3, holes: cards('3 K A') })).toEqual([
      'Bob以 3 分当上地主，拿了底牌：♠3 ♠K ♠A。',
    ]);
  });

  it('says the card that was called', () => {
    const [king] = cards('K') as [Card];
    expect(texts('zh-CN', { k: 'call', seat: 1, card: king, holes: [] })).toEqual(['叫的牌是♠K。Ann手里有第一张，成了地主。']);
    expect(texts('zh-CN', { k: 'call', seat: 0, card: king, holes: cards('3 4 5') })).toEqual([
      '叫的牌是♠K。你手里有第一张，成了地主，拿了底牌：♠3 ♠4 ♠5。',
    ]);
  });

  it('says what is played and passed', () => {
    expect(texts('zh-CN', playEntry(1, '3 3'))).toEqual(['Ann出了♠3 ♥3（对子）。']);
    expect(lines('zh-CN', playEntry(0, '7 7 7 7'))).toEqual([{ tone: 'bomb', seat: 0, text: '你出了♠7 ♥7 ♣7 ♦7（炸弹）。' }]);
    expect(texts('zh-CN', playEntry(2, 'S B'))).toEqual(['Bob出了小王 大王（火箭）。']);
    expect(texts('zh-CN', { k: 'pass', seat: 2 })).toEqual(['Bob不出。']);
    expect(texts('zh-CN', { k: 'reveal', seat: 3 })).toEqual(['Cy打出了叫的牌，原来也是地主！']);
  });
});

describe('askTitle', () => {
  it('asks for a bid in the words of the range, in both languages', () => {
    expect(askTitle({ k: 'bid', min: 1, max: 3 }, wordsOf('en'), null)).toBe('Bid 1 to 3 to be the landlord, or pass.');
    expect(askTitle({ k: 'bid', min: 3, max: 3 }, wordsOf('en'), null)).toBe('Bid 3 to be the landlord, or pass.');
    expect(askTitle({ k: 'bid', min: 2, max: 3 }, wordsOf('zh-CN'), null)).toBe('叫 2 到 3 分当地主，或不叫。');
  });

  it('asks the one who leads to play, and the one who follows to beat what is on the table', () => {
    const pair = played('3 3').play.combo;
    expect(askTitle({ k: 'play', lead: true }, wordsOf('en'), null)).toBe('Your lead. Pick cards and play them.');
    expect(askTitle({ k: 'play', lead: true }, wordsOf('en'), { who: 'Ann', combo: pair })).toBe(
      'Your lead. Pick cards and play them.',
    );
    expect(askTitle({ k: 'play', lead: false }, wordsOf('en'), { who: 'Ann', combo: pair })).toBe('Beat Ann’s Pair, or pass.');
    expect(askTitle({ k: 'play', lead: false }, wordsOf('zh-CN'), { who: 'Ann', combo: pair })).toBe('压过Ann的对子，或者不出。');
    expect(askTitle({ k: 'play', lead: true }, wordsOf('zh-CN'), null)).toBe('该你先出牌：选好牌后出牌。');
  });

  it('names the size of a bomb that is to be beaten', () => {
    const five = played('7 7 7 7 7', 2).play.combo;
    expect(askTitle({ k: 'play', lead: false }, wordsOf('en'), { who: 'Bob', combo: five })).toBe('Beat Bob’s Bomb of 5, or pass.');
  });
});

function result(over: Partial<Result> = {}): Result {
  return {
    winner: 'landlord', out: 1, base: 3, bombs: 0, spring: null, doublings: 0, scores: [-3, 6, -3], landlords: [1], ...over,
  };
}

describe('overText', () => {
  it('tells a user who loses how it came out, line by line', () => {
    const over = overText(result(), 0, nameOf('en'), wordsOf('en'));
    expect(over.win).toBe(false);
    expect(over.title).toBe('You lose.');
    expect(over.text.split('\n')).toEqual([
      'The landlord side went out first.',
      'Base 3, no bombs: points ×1.',
      'Landlord side: Ann',
      'Points: You -3 / Ann +6 / Bob -3',
    ]);
  });

  it('tells a user who wins, with the farmers', () => {
    const over = overText(
      result({ winner: 'farmer', out: 2, base: 2, bombs: 2, doublings: 2, scores: [8, -16, 8], landlords: [1] }),
      0, nameOf('en'), wordsOf('en'),
    );
    expect(over.win).toBe(true);
    expect(over.title).toBe('You win!');
    expect(over.text.split('\n')).toEqual([
      'The farmers went out first.',
      'Base 2, 2 bombs: points ×4.',
      'Landlord side: Ann',
      'Points: You +8 / Ann -16 / Bob +8',
    ]);
  });

  it('says a spring and a counter-spring, which double the points', () => {
    const spring = overText(result({ spring: 'spring', doublings: 1, scores: [-6, 12, -6] }), 0, nameOf('en'), wordsOf('en'));
    expect(spring.text.split('\n')[1]).toBe('Spring: the farmers never got to play. The points double.');
    expect(spring.text).toContain('Base 3, no bombs: points ×2.');
    const counter = overText(
      result({ winner: 'farmer', spring: 'counter', doublings: 1, scores: [6, -12, 6] }), 0, nameOf('en'), wordsOf('en'),
    );
    expect(counter.text.split('\n')[1]).toBe('Counter-spring: the landlord side played one hand only. The points double.');
  });

  it('names everyone of the landlord side at a table with several landlords, and the user himself', () => {
    const over = overText(
      result({ winner: 'landlord', base: 1, scores: [8, -4, 8, -4, -4, 8], landlords: [0, 2, 5] }), 0, nameOf('en'), wordsOf('en'),
    );
    expect(over.win).toBe(true);
    expect(over.text).toContain('Landlord side: You, Bob, Ed');
    expect(over.text).toContain('Points: You +8 / Ann -4 / Bob +8 / Cy -4 / Di -4 / Ed +8');
  });

  it('is told the same way in Chinese', () => {
    const over = overText(result({ winner: 'farmer', scores: [3, -6, 3] }), 0, nameOf('zh-CN'), wordsOf('zh-CN'));
    expect(over.win).toBe(true);
    expect(over.title).toBe('你赢了！');
    expect(over.text.split('\n')).toEqual([
      '农民先出完牌。',
      '底分 3，没有炸弹：分数 ×1。',
      '地主一方：Ann',
      '得分：你 +3 / Ann -6 / Bob +3',
    ]);
  });

  it('counts a user who made no points as having lost', () => {
    const over = overText(result({ scores: [0, 0, 0] }), 0, nameOf('en'), wordsOf('en'));
    expect(over.win).toBe(false);
  });
});

describe('moods', () => {
  const left = (n: number) => () => n;

  it('speaks up when someone takes the landlord’s seat, or when the card is called', () => {
    expect(moods({ k: 'landlord', seat: 2, bid: 3, holes: [] }, left(20))).toEqual([{ seat: 2, mood: 'grab' }]);
    const [king] = cards('K') as [Card];
    expect(moods({ k: 'call', seat: 1, card: king, holes: [] }, left(24))).toEqual([{ seat: 1, mood: 'grab' }]);
  });

  it('speaks up when a hidden landlord shows himself', () => {
    expect(moods({ k: 'reveal', seat: 3 }, left(10))).toEqual([{ seat: 3, mood: 'reveal' }]);
  });

  it('speaks up for a bomb and a rocket, and for a hand that is nearly gone', () => {
    expect(moods(playEntry(1, '7 7 7 7'), left(10))).toEqual([{ seat: 1, mood: 'bomb' }]);
    expect(moods(playEntry(1, 'S B'), left(0))).toEqual([{ seat: 1, mood: 'bomb' }]);
    expect(moods(playEntry(2, '3'), left(2))).toEqual([{ seat: 2, mood: 'last' }]);
    expect(moods(playEntry(2, '3'), left(1))).toEqual([{ seat: 2, mood: 'last' }]);
  });

  it('has nothing to say of a hand that is gone, a hand that is large, or the rest', () => {
    expect(moods(playEntry(2, '3'), left(0))).toEqual([]);
    expect(moods(playEntry(2, '3'), left(3))).toEqual([]);
    expect(moods({ k: 'pass', seat: 1 }, left(1))).toEqual([]);
    expect(moods({ k: 'bid', seat: 1, bid: 2 }, left(17))).toEqual([]);
    expect(moods({ k: 'deal' }, left(17))).toEqual([]);
    expect(moods({ k: 'turn', seat: 1, lead: true }, left(17))).toEqual([]);
    expect(moods({ k: 'end', result: result() }, left(0))).toEqual([]);
  });
});

describe('chatter', () => {
  const MOODS: Mood[] = ['grab', 'bomb', 'last', 'reveal', 'win', 'lose'];

  it.each(LANGS)('has a few lines for every mood, in its own language, in %s', (lang) => {
    const w = wordsOf(lang);
    for (const mood of MOODS) {
      const said = new Set<string>();
      for (let i = 0; i < 12; i++) said.add(chatter(mood, w, () => i / 12));
      expect(said.size, mood).toBeGreaterThanOrEqual(2);
      for (const line of said) {
        expect(line.trim(), mood).not.toBe('');
        expect(/[\u4e00-\u9fff]/.test(line), `${lang} ${mood}: ${line}`).toBe(lang === 'zh-CN');
      }
    }
  });

  it('picks the line the dice point at, and the last one at the edge of the dice', () => {
    const w = wordsOf('en');
    expect(chatter('bomb', w, () => 0)).toBe(w.chat.bomb[0]);
    expect(chatter('bomb', w, () => 0.5)).toBe(w.chat.bomb[1]);
    expect(chatter('bomb', w, () => 0.99)).toBe(w.chat.bomb[2]);
    expect(chatter('bomb', w, () => 1)).toBe(w.chat.bomb[2]);
  });
});
