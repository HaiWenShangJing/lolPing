/**
 * The shapes the Sanguosha table passes around: players, what the rules ask of them and what they answer, and the
 * entries the table reports as it goes. Nothing here has behaviour apart from the two errors that end a game early.
 */
import { SLOTS } from './sanguoshaCards';
import type { Card, CardInfo, CardName, Slot } from './sanguoshaCards';
import type { HeroId, SkillId } from './sanguoshaHeroes';
import type { Engine } from './sanguosha';

export type Size = 5 | 8;
export const SIZES: readonly Size[] = [5, 8];
export const isSize = (raw: unknown): raw is Size => raw === 5 || raw === 8;

export type Role = 'lord' | 'loyalist' | 'rebel' | 'traitor';
/** The side that wins: the lord with his loyalists, the rebels, or the traitor alone. */
export type Winner = 'lord' | 'rebel' | 'traitor';

export const ROLE_SETS: Record<Size, readonly Role[]> = {
  5: ['lord', 'loyalist', 'rebel', 'rebel', 'traitor'],
  8: ['lord', 'loyalist', 'loyalist', 'rebel', 'rebel', 'rebel', 'rebel', 'traitor'],
};

export const sideOf = (role: Role): Winner => (role === 'lord' || role === 'loyalist' ? 'lord' : role);

export type Equip = Record<Slot, Card | null>;
export type DelayedName = 'lebu' | 'bing' | 'shandian';
/** A delayed trick waiting in a judgement area. `card` may be any card, for one a skill turned into the trick. */
export interface Judge {
  readonly card: Card;
  readonly as: DelayedName;
}

export interface Player {
  readonly seat: number;
  readonly role: Role;
  hero: HeroId | null;
  maxHp: number;
  hp: number;
  alive: boolean;
  hand: Card[];
  equip: Equip;
  judges: Judge[];
}

export const equipOf = (p: Player): Card[] => SLOTS.flatMap((slot) => p.equip[slot] ?? []);
/** Whether there is any card of the player's to take: in the hand, on the body or waiting in the judgement area. */
export const hasAny = (p: Player): boolean => p.hand.length > 0 || equipOf(p).length > 0 || p.judges.length > 0;

export type Phase = 'start' | 'judge' | 'draw' | 'play' | 'discard' | 'end';

/** What has happened during the current turn. */
export interface Flags {
  /** 杀 used in the play phase. */
  sha: number;
  /** Cards given away by Rende this turn. */
  given: number;
  zhiheng: boolean;
  qingnang: boolean;
  luoyi: boolean;
  /** A 杀 was used or played in the play phase, which is what Keji looks at. */
  shaPlayed: boolean;
  skipPlay: boolean;
  skipDraw: boolean;
}

export const freshFlags = (): Flags => ({
  sha: 0, given: 0, zhiheng: false, qingnang: false, luoyi: false, shaPlayed: false, skipPlay: false, skipDraw: false,
});

/** The players a card may be aimed at, and how many of them. */
export interface Targets {
  min: number;
  max: number;
  options: number[];
}

/** One way to play a card from the hand in the play phase. */
export interface Use {
  card: number;
  as: CardName;
  skill?: SkillId;
  targets: Targets;
}

/** A skill that is started by choosing it in the play phase. */
export interface SkillOption {
  skill: SkillId;
  cards: { min: number; max: number; ids: number[] } | null;
  targets: Targets | null;
}

/** The scene around a question, for the words that go with it. */
export interface Ctx {
  from?: number;
  target?: number;
  name?: CardName;
  /** How many of the card asked for must be played. */
  need?: number;
  amount?: number;
  card?: CardInfo;
  /** For 无懈可击: whether the trick would go through as things stand. */
  on?: boolean;
}

export type CardsWhy =
  | 'shan' | 'sha' | 'tao' | 'wuxie' | 'discard' | 'ganglie' | 'guanshi' | 'guicai' | 'guanxing' | 'qilin' | 'qinglong';
export type AreaWhy = 'chai' | 'shun' | 'fankui';
export type SeatWhy = 'tuxi';
export type ConfirmWhy = 'bagua' | 'luoshen' | 'luoyi';

export type Ask =
  | { k: 'hero'; heroes: HeroId[]; lord: boolean }
  | { k: 'play'; uses: Use[]; skills: SkillOption[] }
  | { k: 'cards'; why: CardsWhy; ctx: Ctx; cards: number[]; min: number; max: number }
  | { k: 'area'; why: AreaWhy; ctx: Ctx; owner: number; hand: number; equip: number[]; judges: number[] }
  | { k: 'seat'; why: SeatWhy; ctx: Ctx; options: number[]; min: number; max: number }
  | { k: 'confirm'; why: ConfirmWhy; ctx: Ctx };

export type Reply =
  | { k: 'hero'; hero: HeroId }
  | { k: 'use'; card: number; as: CardName; skill?: SkillId; targets: number[] }
  | { k: 'skill'; skill: SkillId; cards: number[]; targets: number[] }
  | { k: 'end' }
  | { k: 'cards'; ids: number[] }
  | { k: 'area'; zone: 'hand' | 'equip' | 'judge'; card: number | null }
  | { k: 'seat'; seats: number[] }
  | { k: 'confirm'; yes: boolean };

export type JudgeWhy = DelayedName | 'bagua' | 'luoshen' | 'tieqi' | 'ganglie';
export type Zone = 'hand' | 'equip' | 'judge' | 'pile' | 'limbo' | 'trash';

export type Entry =
  | { k: 'start'; size: Size }
  | { k: 'hero'; seat: number; hero: HeroId }
  | { k: 'turn'; seat: number }
  | { k: 'phase'; seat: number; phase: Phase }
  | { k: 'use'; seat: number; name: CardName; cards: CardInfo[]; targets: number[]; skill?: SkillId }
  | { k: 'play'; seat: number; name: CardName; cards: CardInfo[]; skill?: SkillId; for?: number }
  | { k: 'skill'; seat: number; skill: SkillId; targets?: number[] }
  | { k: 'damage'; seat: number; n: number; source: number | null }
  | { k: 'lose'; seat: number; n: number }
  | { k: 'heal'; seat: number; n: number }
  | { k: 'draw'; seat: number; n: number; cards: CardInfo[] }
  | { k: 'discard'; seat: number; cards: CardInfo[]; from?: number }
  | { k: 'take'; seat: number; from: number | null; cards: CardInfo[]; zone: Zone }
  | { k: 'give'; seat: number; to: number; cards: CardInfo[] }
  | { k: 'equip'; seat: number; card: CardInfo }
  | { k: 'judge'; seat: number; card: CardInfo; why: JudgeWhy }
  | { k: 'armor'; seat: number; name: 'bagua' | 'renwang' }
  | { k: 'cancel'; name: CardName; target: number | null }
  | { k: 'skip'; seat: number; phase: 'play' | 'draw' | 'discard' }
  | { k: 'die'; seat: number; role: Role; killer: number | null }
  | { k: 'shuffle' }
  | { k: 'end'; winner: Winner | null };

export interface Deps {
  random: () => number;
  /** Puts a question to a player. `null` means no answer, which the rules take as the default (pass, end turn). */
  ask: (seat: number, ask: Ask, engine: Engine) => Promise<Reply | null>;
  /** Reports what happened; the table waits for it, so a screen may pause here. */
  emit: (entry: Entry, engine: Engine) => Promise<void> | void;
  /** True once nobody is watching the game any more. */
  stopped: () => boolean;
}

export interface Outcome {
  /** `null` when the game was called off for running too long. */
  winner: Winner | null;
  turns: number;
}

/** Thrown through the table when the window is closed. */
export class Stopped extends Error {
  constructor() {
    super('stopped');
    this.name = 'Stopped';
  }
}

/** Thrown through the table the moment a side has won. */
export class GameOver extends Error {
  constructor(readonly winner: Winner) {
    super('game over');
    this.name = 'GameOver';
  }
}
