/**
 * What the Dou Dizhu page says for what happens at the table: the words of its lobby, the line of the log for each
 * entry, the question put to the user, the headline at the end and what the pets say. All pure, so a test can feed it
 * every case.
 */
import type { DdzTone, GameText } from '../gameIpc';
import { BIG, SUIT_SIGN, isBomb, rankLabel, shapeOf } from './doudizhuCards';
import type { Card, Combo } from './doudizhuCards';
import type { Ask, Entry, Result } from './doudizhuTypes';
import type { DoudizhuWords } from './doudizhuWords';
import { lobbyText, type GameWords } from './gameText';

const TAGS = ['landlord', 'farmer', 'unknown', 'hidden'] as const;
const HINTS = ['landlord', 'farmer', 'hidden'] as const;

export interface DdzLine {
  tone: DdzTone;
  seat: number | null;
  text: string;
}

/** The lobby's words and everything the table's page needs to name: one flat set of strings. */
export function doudizhuText(g: GameWords): GameText {
  const w = g.doudizhu;
  const text: GameText = {
    ...lobbyText(g, w.title),
    mindsOn: w.minds,
    thinking: w.thinking,
    rules: w.rules,
    pick: w.pick,
    size_3: w.size3,
    size_4: w.size4,
    size_5: w.size5,
    size_6: w.size6,
    phase_bid: w.phase.bid,
    phase_play: w.phase.play,
    phase_over: w.phase.over,
    stake: w.stake,
    called: w.called,
    calledTip: w.calledTip,
    holes: w.holes,
    count: w.count,
    pass: w.pass,
    play: w.play,
    hint: w.hint,
    clear: w.clear,
    bidNone: w.bidNone,
    bidOf: w.bidOf,
    yourTurn: w.yourTurn,
    waiting: w.waiting,
    pickHint: w.pickHint,
    noHint: w.noHint,
    smallJoker: w.joker.small,
    bigJoker: w.joker.big,
  };
  for (const tag of TAGS) text[`role_${tag}`] = w.role[tag];
  for (const hint of HINTS) text[`roleHint_${hint}`] = w.roleHint[hint];
  return text;
}

/** A card as a sentence names it: its suit and rank, or which joker it is. */
export function cardText(card: Card, w: DoudizhuWords): string {
  if (card.suit === null) return card.rank === BIG ? w.joker.big : w.joker.small;
  return `${SUIT_SIGN[card.suit]}${rankLabel(card.rank)}`;
}

export const cardList = (cards: readonly Card[], w: DoudizhuWords): string => w.cards(cards.map((c) => cardText(c, w)));

/** What a play is called: a bomb of more than four cards says how many. */
export const playLabel = (combo: Combo, w: DoudizhuWords): string =>
  combo.kind === 'bomb' && combo.size > 4 ? w.bombOf(combo.size) : w.shape[shapeOf(combo)];

/** The lines for one thing that happened, `name` being what a seat is called. */
export function entryLines(e: Entry, w: DoudizhuWords, name: (seat: number) => string): DdzLine[] {
  const L = w.log;
  const one = (tone: DdzTone, seat: number | null, text: string): DdzLine[] => [{ tone, seat, text }];
  switch (e.k) {
    case 'start': return one('sys', null, L.start(e.size));
    case 'deal': return one('sys', null, L.deal);
    case 'redeal': return one('sys', null, L.redeal);
    case 'bid': return one(e.bid > 0 ? 'act' : 'pass', e.seat, L.bid(name(e.seat), e.bid));
    case 'landlord': return one('head', e.seat, L.landlord(name(e.seat), e.bid, cardList(e.holes, w)));
    case 'call':
      return one('head', e.seat, L.call(
        name(e.seat), cardText(e.card, w), e.holes.length > 0 ? cardList(e.holes, w) : null,
      ));
    case 'turn': return [];
    case 'play':
      return one(isBomb(e.play.combo) ? 'bomb' : 'act', e.seat, L.play(
        name(e.seat), cardList(e.cards, w), playLabel(e.play.combo, w),
      ));
    case 'pass': return one('pass', e.seat, L.pass(name(e.seat)));
    case 'reveal': return one('sys', e.seat, L.reveal(name(e.seat)));
    case 'end': return [];
  }
}

/** The question put to the user, in words; `top` is the play on the table that a follow has to beat. */
export function askTitle(a: Ask, w: DoudizhuWords, top: { who: string; combo: Combo } | null): string {
  if (a.k === 'bid') return w.ask.bid(a.min, a.max);
  return a.lead || top === null ? w.ask.lead : w.ask.follow(top.who, playLabel(top.combo, w));
}

/** How the game came out for the user in seat `me`: the headline, and the side, the stakes and the points. */
export function overText(
  r: Result, me: number, name: (seat: number) => string, w: DoudizhuWords,
): { win: boolean; title: string; text: string } {
  const win = (r.scores[me] ?? 0) > 0;
  const lines = [r.winner === 'landlord' ? w.winLandlord : w.winFarmers];
  if (r.spring === 'spring') lines.push(w.spring);
  if (r.spring === 'counter') lines.push(w.counter);
  lines.push(w.stakeLine(r.base, r.bombs, 2 ** r.doublings));
  lines.push(w.landlords(w.join(r.landlords.map(name))));
  lines.push(w.scores(r.scores.map((s, seat) => `${name(seat)} ${s > 0 ? '+' : ''}${s}`).join(' / ')));
  return { win, title: win ? w.win : w.lose, text: lines.join('\n') };
}

export type Mood = 'grab' | 'bomb' | 'last' | 'reveal' | 'win' | 'lose';

/** Who might say something about this, and in what mood; the table decides whether anybody does. */
export function moods(e: Entry, left: (seat: number) => number): { seat: number; mood: Mood }[] {
  switch (e.k) {
    case 'landlord':
    case 'call': return [{ seat: e.seat, mood: 'grab' }];
    case 'reveal': return [{ seat: e.seat, mood: 'reveal' }];
    case 'play': {
      if (isBomb(e.play.combo)) return [{ seat: e.seat, mood: 'bomb' }];
      const n = left(e.seat);
      return n > 0 && n <= 2 ? [{ seat: e.seat, mood: 'last' }] : [];
    }
    default: return [];
  }
}

/** One of a pet's stock lines for `mood`. */
export function chatter(mood: Mood, w: DoudizhuWords, random: () => number): string {
  const lines = w.chat[mood];
  return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))] ?? '';
}
