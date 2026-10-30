/**
 * The cards of the Sanguosha table: what each is called, what kind it is, and the deck. Nothing here knows how a card
 * is played; that is `sanguosha*.ts`. The deck is this game's own list: the counts, suits and ranks are not copied from
 * any printed set.
 */

export const SUITS = ['spade', 'heart', 'club', 'diamond'] as const;
export type Suit = (typeof SUITS)[number];

export const BASIC = ['sha', 'shan', 'tao'] as const;
/** Tricks that act at once. */
export const TRICKS = ['juedou', 'chai', 'shun', 'wuzhong', 'nanman', 'wanjian', 'taoyuan', 'wuxie'] as const;
/** Tricks that wait in a player's judgement area until his judgement phase. */
export const DELAYED = ['lebu', 'bing', 'shandian'] as const;
export const WEAPONS = ['zhuge', 'qinggang', 'qinglong', 'guanshi', 'fangtian', 'qilin'] as const;
export const ARMORS = ['bagua', 'renwang'] as const;
/** Horses that make their wearer one seat farther from the others (+1) and those that bring the others nearer (-1). */
export const HORSES_PLUS = ['dilu', 'jueying', 'zhuahuang'] as const;
export const HORSES_MINUS = ['chitu', 'dawan', 'zixing'] as const;

export const CARD_NAMES = [
  ...BASIC, ...TRICKS, ...DELAYED, ...WEAPONS, ...ARMORS, ...HORSES_PLUS, ...HORSES_MINUS,
] as const;
export type CardName = (typeof CARD_NAMES)[number];
export type Weapon = (typeof WEAPONS)[number];

export type Kind = 'basic' | 'trick' | 'delayed' | 'weapon' | 'armor' | 'plus' | 'minus';
export type Slot = 'weapon' | 'armor' | 'plus' | 'minus';
export const SLOTS: readonly Slot[] = ['weapon', 'armor', 'plus', 'minus'];

const has = (list: readonly string[], name: string): boolean => list.includes(name);

export function kindOf(name: CardName): Kind {
  if (has(BASIC, name)) return 'basic';
  if (has(TRICKS, name)) return 'trick';
  if (has(DELAYED, name)) return 'delayed';
  if (has(WEAPONS, name)) return 'weapon';
  if (has(ARMORS, name)) return 'armor';
  return has(HORSES_PLUS, name) ? 'plus' : 'minus';
}

/** The equipment slot a card goes in, or null for a card that is not equipment. */
export function slotOf(name: CardName): Slot | null {
  const kind = kindOf(name);
  return kind === 'weapon' || kind === 'armor' || kind === 'plus' || kind === 'minus' ? kind : null;
}

/** A trick that takes effect when it is played, the ones Jizhi answers to. */
export const isImmediateTrick = (name: CardName): boolean => kindOf(name) === 'trick';

/** How far a weapon reaches. */
export const RANGE: Record<Weapon, number> = {
  zhuge: 1, qinggang: 2, qinglong: 3, guanshi: 3, fangtian: 4, qilin: 5,
};

export interface Card {
  readonly id: number;
  readonly name: CardName;
  readonly suit: Suit;
  /** 1 (ace) to 13 (king). */
  readonly rank: number;
}

/** What is known of a card once it is out on the table. */
export type CardInfo = Pick<Card, 'name' | 'suit' | 'rank'>;

export const isRedSuit = (suit: Suit): boolean => suit === 'heart' || suit === 'diamond';
export const isRed = (card: CardInfo): boolean => isRedSuit(card.suit);
export const isBlack = (card: CardInfo): boolean => !isRedSuit(card.suit);
export const infoOf = (card: CardInfo): CardInfo => ({ name: card.name, suit: card.suit, rank: card.rank });

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const rankLabel = (rank: number): string => RANKS[rank - 1] ?? '?';

export const SUIT_SIGN: Record<Suit, string> = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };

/** How many of each card the deck holds: 102 cards. */
export const DECK_COUNTS: readonly (readonly [CardName, number])[] = [
  ['sha', 30], ['shan', 15], ['tao', 8],
  ['juedou', 3], ['chai', 6], ['shun', 5], ['wuzhong', 4], ['nanman', 3], ['wanjian', 1], ['taoyuan', 1],
  ['wuxie', 4], ['lebu', 3], ['bing', 2], ['shandian', 1],
  ['zhuge', 2], ['qinggang', 1], ['qinglong', 1], ['guanshi', 1], ['fangtian', 1], ['qilin', 1],
  ['bagua', 2], ['renwang', 1],
  ['dilu', 1], ['jueying', 1], ['zhuahuang', 1], ['chitu', 1], ['dawan', 1], ['zixing', 1],
];

export const DECK_SIZE = DECK_COUNTS.reduce((sum, [, n]) => sum + n, 0);

/**
 * A new deck in a fixed order. Card number `n` has suit `n mod 4` and rank `7n mod 13 + 1`, which walks through all
 * 52 pairs before it repeats, so each card name gets an even mix of suits and ranks.
 */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (const [name, count] of DECK_COUNTS) {
    for (let i = 0; i < count; i++) {
      const n = cards.length;
      cards.push({ id: n + 1, name, suit: SUITS[n % 4] as Suit, rank: ((n * 7) % 13) + 1 });
    }
  }
  return cards;
}

/** Shuffles `items` in place. */
export function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}
