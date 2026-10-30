/**
 * What the Sanguosha page says for what happens at the table: the words of its lobby, the line of the log for each
 * entry, the question put to the user, the headline at the end and what the pets say. All pure, so a test can feed it
 * every case.
 */
import type { GameText, SgsTone } from '../gameIpc';
import { CARD_NAMES, SUIT_SIGN, rankLabel, slotOf } from './sanguoshaCards';
import type { CardInfo, CardName } from './sanguoshaCards';
import { HEROES, HERO_IDS, KINGDOMS, SKILLS } from './sanguoshaHeroes';
import type { SkillId } from './sanguoshaHeroes';
import { sideOf } from './sanguoshaTypes';
import type { Ask, Entry, JudgeWhy, Phase, Role, Winner } from './sanguoshaTypes';
import type { SanguoshaWords } from './sanguoshaWords';
import { lobbyText, type GameWords } from './gameText';

const PHASES: readonly Phase[] = ['start', 'judge', 'draw', 'play', 'discard', 'end'];
const ROLES: readonly Role[] = ['lord', 'loyalist', 'rebel', 'traitor'];

/** How a line names the people at the table: `who` for the one who acts, `whom` for the one it happens to. */
export interface Voice {
  who: (seat: number) => string;
  whom: (seat: number) => string;
}

export interface SgsLine {
  tone: SgsTone;
  seat: number | null;
  text: string;
}

/** The lobby's words and everything the table's page needs to name: one flat set of strings. */
export function sanguoshaText(g: GameWords): GameText {
  const w = g.sanguosha;
  const text: GameText = {
    ...lobbyText(g, w.title),
    mindsOn: w.minds,
    thinking: w.thinking,
    rules: w.rules,
    pick: w.pick,
    size_5: w.size5,
    size_8: w.size8,
    turnNo: w.turnNo,
    pile: w.pile,
    hand: w.hand,
    dist: w.dist,
    range: w.range,
    out: w.out,
    spectating: w.spectating,
    waiting: w.waiting,
    yourTurn: w.yourTurn,
    endTurn: w.endTurn,
    ok: w.ok,
    cancel: w.cancel,
    pass: w.pass,
    yes: w.yes,
    no: w.no,
    pickTarget: w.pickTarget,
    pickTargets: w.pickTargets,
    pickCards: w.pickCards,
    playAs: w.playAs,
    yourSkills: w.yourSkills,
    hiddenCard: w.hiddenCard,
  };
  for (const phase of PHASES) text[`phase_${phase}`] = w.phase[phase];
  for (const role of ROLES) {
    text[`role_${role}`] = w.role[role];
    text[`roleHint_${role}`] = w.roleHint[role];
  }
  for (const kingdom of KINGDOMS) text[`kingdom_${kingdom}`] = w.kingdom[kingdom];
  for (const name of CARD_NAMES) {
    text[`card_${name}`] = w.card[name].name;
    text[`tip_${name}`] = w.card[name].tip;
  }
  for (const hero of HERO_IDS) text[`hero_${hero}`] = w.hero[hero];
  for (const skill of SKILLS) {
    text[`skill_${skill}`] = w.skill[skill].name;
    text[`skillTip_${skill}`] = w.skill[skill].tip;
  }
  return text;
}

/** A card as a sentence names it: what it is, then its suit and rank. */
export const cardText = (card: CardInfo, w: SanguoshaWords): string =>
  w.cardTag(w.card[card.name].name, `${SUIT_SIGN[card.suit]}${rankLabel(card.rank)}`);

const cardList = (cards: readonly CardInfo[], w: SanguoshaWords): string => w.join(cards.map((c) => cardText(c, w)));

/** What was played: the cards, and what a skill made of them when it did. */
function played(cards: readonly CardInfo[], name: CardName, w: SanguoshaWords): string {
  const as = w.cardRef(w.card[name].name);
  const first = cards[0];
  if (!first) return as;
  return cards.length === 1 && first.name !== name ? w.log.turned(cardText(first, w), as) : cardList(cards, w);
}

const judgeLabel = (why: JudgeWhy, w: SanguoshaWords): string =>
  why === 'luoshen' || why === 'tieqi' || why === 'ganglie' ? w.skill[why].name : w.card[why].name;

/**
 * The lines for one thing that happened. `me` is the user's seat: the cards that change hands in secret are named only
 * to those they pass between, and the user's own draws are named to him. `turns` is how many turns have been played.
 */
export function entryLines(e: Entry, w: SanguoshaWords, v: Voice, me: number, turns: number): SgsLine[] {
  const L = w.log;
  const one = (tone: SgsTone, seat: number | null, text: string): SgsLine[] => [{ tone, seat, text }];
  const seats = (list: readonly number[]): string => w.join(list.map(v.whom));
  const skill = (id: SkillId | undefined): string | null => (id === undefined ? null : w.skill[id].name);
  switch (e.k) {
    case 'start': return one('sys', null, L.start(e.size));
    case 'hero':
      return one('sys', e.seat, L.hero(v.who(e.seat), w.hero[e.hero], w.kingdom[HEROES[e.hero].kingdom]));
    case 'turn': return one('turn', e.seat, L.turn(turns, v.who(e.seat)));
    case 'phase': return [];
    case 'use':
      // A weapon or a horse is reported when it is worn, which says the same.
      if (slotOf(e.name)) return [];
      return one('act', e.seat, L.use(
        v.who(e.seat), played(e.cards, e.name, w), skill(e.skill), e.targets.length > 0 ? seats(e.targets) : null,
      ));
    case 'play': {
      const card = played(e.cards, e.name, w);
      return one('act', e.seat, e.for !== undefined && e.for !== e.seat
        ? L.save(v.who(e.seat), card, skill(e.skill), v.whom(e.for))
        : L.answer(v.who(e.seat), card, skill(e.skill)));
    }
    case 'skill':
      return one('act', e.seat, L.skill(v.who(e.seat), w.skill[e.skill].name, e.targets?.length ? seats(e.targets) : null));
    case 'damage':
      return one('hit', e.seat, L.damage(v.who(e.seat), e.n, e.source === null ? null : v.whom(e.source)));
    case 'lose': return one('hit', e.seat, L.lose(v.who(e.seat), e.n));
    case 'heal': return one('heal', e.seat, L.heal(v.who(e.seat), e.n));
    case 'draw':
      return one('sys', e.seat, e.seat === me ? L.drawn(v.who(e.seat), cardList(e.cards, w)) : L.draw(v.who(e.seat), e.n));
    case 'discard':
      return one('act', e.seat, L.discard(v.who(e.seat), cardList(e.cards, w), e.from === undefined ? null : v.whom(e.from)));
    case 'take': {
      if (e.from === null) return one('act', e.seat, L.take(v.who(e.seat), cardList(e.cards, w)));
      const open = e.zone !== 'hand' || e.seat === me || e.from === me;
      return one('act', e.seat, open
        ? L.takeFrom(v.who(e.seat), cardList(e.cards, w), v.whom(e.from))
        : L.takeHidden(v.who(e.seat), e.cards.length, v.whom(e.from)));
    }
    case 'give':
      return one('act', e.seat, e.seat === me || e.to === me
        ? L.giveCards(v.who(e.seat), cardList(e.cards, w), v.whom(e.to))
        : L.give(v.who(e.seat), e.cards.length, v.whom(e.to)));
    case 'equip': return one('act', e.seat, L.equip(v.who(e.seat), cardText(e.card, w)));
    case 'judge': return one('act', e.seat, L.judge(v.who(e.seat), judgeLabel(e.why, w), cardText(e.card, w)));
    case 'armor':
      return one('act', e.seat, e.name === 'bagua'
        ? L.armorUsed(v.who(e.seat), w.card.bagua.name)
        : L.armorBlocked(v.whom(e.seat), w.card.renwang.name));
    case 'cancel': return one('act', e.target, L.cancel(w.cardRef(w.card[e.name].name), e.target === null ? null : v.whom(e.target)));
    case 'skip': return one('act', e.seat, L.skip(v.who(e.seat), w.phase[e.phase]));
    case 'die':
      return one('hit', e.seat, L.die(v.who(e.seat), w.role[e.role], e.killer === null ? null : v.whom(e.killer)));
    case 'shuffle': return one('sys', null, L.shuffle);
    case 'end': return [];
  }
}

/** The question put to the user, in words. */
export function askTitle(a: Ask, w: SanguoshaWords, v: Voice, me: number): string {
  const A = w.ask;
  const card = (name: CardName | undefined): string => w.cardRef(w.card[name ?? 'sha'].name);
  const seat = (s: number | undefined): string => (s === undefined ? '' : v.whom(s));
  const other = (s: number | undefined): string | null => (s === undefined ? null : v.whom(s));
  switch (a.k) {
    case 'hero': return a.lord ? A.heroLord : A.hero;
    case 'play': return A.play;
    case 'cards': {
      const c = a.ctx;
      switch (a.why) {
        case 'shan': return A.dodge(seat(c.from), card(c.name), c.need ?? 1);
        case 'sha': return A.strike(seat(c.from), card(c.name), c.need ?? 1);
        case 'tao': return A.peach(seat(c.target), c.target === me);
        case 'wuxie': return A.counter(card(c.name), other(c.from), other(c.target), c.on ?? true);
        case 'discard': return A.discard(c.amount ?? a.min);
        case 'ganglie': return A.ganglie(seat(c.from), w.skill.ganglie.name);
        case 'guanshi': return A.guanshi(seat(c.target));
        case 'guicai': return A.guicai(seat(c.target), c.card ? cardText(c.card, w) : '');
        case 'guanxing': return A.guanxing;
        case 'qilin': return A.qilin(seat(c.target));
        case 'qinglong': return A.qinglong(seat(c.target));
      }
    }
    case 'area': return A[a.why](v.whom(a.owner));
    case 'seat': return A.tuxi;
    case 'confirm': return A.confirm[a.why];
  }
}

/** Who has won and how, from the seat of the user whose role is `mine`; `seats` is everybody's name and role in order. */
export function overText(
  winner: Winner | null, mine: Role, seats: readonly { name: string; role: Role }[], w: SanguoshaWords,
): { win: boolean; title: string; text: string } {
  const win = winner !== null && sideOf(mine) === winner;
  const cause = winner === 'lord' ? w.winLord : winner === 'rebel' ? w.winRebel : winner === 'traitor' ? w.winTraitor : null;
  const roles = w.reveal(seats.map((s, i) => `${i + 1}. ${s.name} ${w.role[s.role]}`).join(' / '));
  return {
    win,
    title: winner === null ? w.calledOff : win ? w.win : w.lose,
    text: cause === null ? roles : `${cause}\n${roles}`,
  };
}

export type Mood = 'hit' | 'hurt' | 'heal' | 'kill' | 'fall' | 'win' | 'lose';

/** Who might say something about this, and in what mood; the table decides whether anybody does. */
export function moods(e: Entry): { seat: number; mood: Mood }[] {
  switch (e.k) {
    case 'damage': {
      const out: { seat: number; mood: Mood }[] = [{ seat: e.seat, mood: 'hurt' }];
      if (e.source !== null && e.source !== e.seat) out.push({ seat: e.source, mood: 'hit' });
      return out;
    }
    case 'heal': return [{ seat: e.seat, mood: 'heal' }];
    case 'die': {
      const out: { seat: number; mood: Mood }[] = [{ seat: e.seat, mood: 'fall' }];
      if (e.killer !== null && e.killer !== e.seat) out.push({ seat: e.killer, mood: 'kill' });
      return out;
    }
    default: return [];
  }
}

/** One of a pet's stock lines for `mood`. */
export function chatter(mood: Mood, w: SanguoshaWords, random: () => number): string {
  const lines = w.chat[mood];
  return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))] ?? '';
}
