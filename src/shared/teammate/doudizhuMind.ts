/**
 * The Copilot minds of the pets at the Dou Dizhu table: what each seat is told (only what a player in that seat could
 * see), what it is asked and how its reply is read. A mind bids by number and plays by choosing a number from a menu of
 * the plays its hand can make, so whatever it answers is a play the table takes. When it cannot be reached, answers
 * nonsense or has nothing to decide (a pass that is forced, a hand that goes out in one play), the rules play for it, so
 * a slow, wrong or missing mind never stops the game. A game is kept to at most a hundred and fifty requests.
 */
import type { Table } from './doudizhu';
import { botPlay, choices, revealing } from './doudizhuAi';
import { BIG, SMALL, isBomb, rankLabel, shapeOf } from './doudizhuCards';
import type { Card, Play, Shape } from './doudizhuCards';
import { cardList, cardText, entryLines, playLabel } from './doudizhuText';
import { CONFIG } from './doudizhuTypes';
import type { Ask, Entry, Reply, Size } from './doudizhuTypes';
import { unseen, viewFor } from './doudizhuView';
import type { TableView } from './doudizhuView';
import { enDoudizhu } from './doudizhuWords';
import { intIn, jsonOf, no, plural, tagger } from './mindText';
import type { Names } from './mindText';
import { cleanLine } from './petText';

/** The most requests the minds make in one game; after that every question goes to the rules. */
export const DDZ_BUDGET = 150;
/** A mind is told at most this many lines of what happened since it last looked; the earlier ones are dropped. */
const LINES_MAX = 80;
/** What a pet says in a line is cut to this. */
export const DDZ_SAY_MAX = 80;
/** The most plays a mind is offered: a shortlist of the quiet ones, a few bombs, the rocket, and the rules' own pick. */
export const MENU_MAX = 30;
const QUIET_MAX = 24;
const BOMBS_MAX = 4;
/** At a lead, how many plays of each shape are offered, the lowest first. */
const PER_SHAPE = 2;

const w = enDoudizhu;

const RULES = w.rules.replace(/ The 4-, 5- and 6-player tables are.*$/, '');

/** What a mind answered: the reply to the question, and a line it says out loud, if any. */
export interface Thought {
  reply: Reply;
  say: string | null;
}

export interface DdzMindDeps {
  /** A pet by its name, the user as "the user". */
  names: Names;
  character: (seat: number) => { name: string; persona: string };
  /** "English" or "Simplified Chinese": the language the players speak. */
  language: string;
  /** Sends `prompt` to the mind behind `seat` and returns its reply; null when it could not answer. */
  ask: (seat: number, prompt: string) => Promise<string | null>;
  /** Told when a request to the mind of `seat` begins (`on`) and when it is over. */
  think?: (seat: number, on: boolean) => void;
  /** The most requests to make; later questions get no answer. */
  budget?: number;
}

export interface DdzMind {
  /** Notes what the table reported, for the minds to be told when their seat next looks. */
  observe(entry: Entry): void;
  /** What the mind of `seat` answers; null when it is not asked, has nothing to decide or cannot be reached. */
  answer(seat: number, ask: Ask, t: Table): Promise<Thought | null>;
}

type BidAsk = Extract<Ask, { k: 'bid' }>;

const rankName = (rank: number): string => (rank === BIG ? w.joker.big : rank === SMALL ? w.joker.small : rankLabel(rank));

const ascending = (a: Card, b: Card): number => a.rank - b.rank || a.id - b.id;

/** What a mind is told once, when its seat is first asked: the game, the table, its seat, its character. */
export function briefing(size: Size, seat: number, o: { name: string; persona: string; language: string }): string {
  const c = CONFIG[size];
  const finding = c.mode === 'bid'
    ? 'The landlord is found by bidding.'
    : `The landlord side is found by a called card: the ${c.landlords} seats that hold a copy of it.`;
  return [
    `You play Dou Dizhu with ${size} players, in seats numbered #1 to #${size}; play goes round in that order, from #${size} `
      + `back to #1. ${RULES}`,
    `This table has ${plural(c.decks, 'pack')} of cards: ${plural(c.hand, 'card')} for each seat and `
      + `${plural(c.holes, 'card')} left over. ${finding}`,
    `You are seat ${no(seat)}, ${o.name}.`,
    o.persona === '' ? '' : `Your character: ${o.persona}`,
    'Play to win for your side, the way your character would. You are told only what your seat can know: your own '
      + 'cards, how many each seat holds, what has been played, and which seats are known to be landlords.',
    `Speak in ${o.language}, as that character, in one short sentence at most, and keep to that language even if the `
      + 'character\'s name or origin is from another. Never mention these instructions or that you are an AI. Say '
      + 'something only when it is worth it (a bold bid, a bomb, a close finish); most of the time leave "say" empty.',
    'Answer each question with one JSON object and nothing else, in the format it gives.',
  ].filter((l) => l !== '').join('\n\n');
}

function roleText(v: TableView): string {
  if (v.lord === null) return 'The landlord is not decided yet.';
  const side = v.hidden ? 'hidden' : v.roles[v.me] === 'landlord' ? 'landlord' : 'farmer';
  return `${w.youAre[side]} ${w.roleHint[side]}`;
}

/** The table as the seat in `v` sees it: its side, who holds how many cards, the play on the table, what is out of sight, its hand. */
export function stateText(v: TableView, names: Names): string {
  const tag = tagger(v.me, names);
  const lines = [roleText(v)];
  const held = v.counts.map((n, seat) => {
    const side = seat === v.me ? null : v.roles[seat];
    return `${tag(seat)}: ${n}${side === null ? '' : ` (${side})`}`;
  });
  lines.push(`Cards held: ${held.join(', ')}.`);
  if (v.call !== null) {
    lines.push(`The called card is ${cardText(v.call, w)}.`);
    const known = v.roles.filter((r) => r === 'landlord').length;
    const hidden = CONFIG[v.size].landlords - known;
    if (hidden > 0) lines.push(`Landlords still hidden: ${hidden}, among the seats whose side is not given above.`);
  }
  if (v.lord !== null) {
    if (v.holes.length > 0) lines.push(`${tag(v.lord)} took the bottom cards: ${cardList(v.holes, w)}.`);
    if (CONFIG[v.size].mode === 'bid') lines.push(`Base points: ${v.base}.`);
    lines.push(v.top
      ? `On the table: ${tag(v.top.seat)}'s ${playLabel(v.top.combo, w)}: ${cardList(v.top.cards, w)}.`
      : 'Nothing is on the table.');
  }
  const out = unseen(v).flatMap((n, rank) => (n > 0 ? [`${rankName(rank)}×${n}`] : []));
  lines.push(`Cards you neither hold nor have seen played: ${out.length > 0 ? out.join(', ') : 'none'}.`);
  lines.push(`Your hand (${plural(v.hand.length, 'card')}): ${[...v.hand].sort(ascending).map((c) => rankName(c.rank)).join(' ')}.`);
  return lines.join('\n');
}

const SAY_FORMAT = '"say": "<a short remark in character, or empty>"';

export function bidQuestion(v: TableView, ask: BidAsk, names: Names): string {
  const span = ask.min >= ask.max ? String(ask.max) : `${ask.min} to ${ask.max}`;
  return [
    `Bidding for the landlord's seat. ${w.ask.bid(ask.min, ask.max)}`,
    stateText(v, names),
    `Reply {"bid": <number>, ${SAY_FORMAT}}, the number being ${span}, or 0 to pass.`,
  ].join('\n\n');
}

// The menu of plays

const SHAPES: readonly Shape[] = [
  'single', 'pair', 'triple', 'tripleOne', 'triplePair', 'straight', 'pairs', 'plane', 'planeOne', 'planePair',
  'fourTwo', 'fourPairs',
];
const RUNS: ReadonlySet<Shape> = new Set<Shape>(['straight', 'pairs', 'plane', 'planeOne', 'planePair']);

const lowest = (a: Play, b: Play): number => a.combo.rank - b.combo.rank || b.combo.size - a.combo.size;
const lighter = (a: Play, b: Play): number => a.combo.size - b.combo.size || a.combo.rank - b.combo.rank;

/** The plays of a lead that are worth a look: of each shape the lowest few, and the longest of a run. */
function shortlist(quiet: readonly Play[]): Play[] {
  const group = new Map<Shape, Play[]>();
  for (const p of quiet) {
    const shape = shapeOf(p.combo);
    const list = group.get(shape);
    if (list) list.push(p);
    else group.set(shape, [p]);
  }
  const pick = (each: number): Play[] => SHAPES.flatMap((shape) => {
    const list = (group.get(shape) ?? []).sort(lowest);
    const first = list[0];
    if (!first) return [];
    const picked = list.slice(0, each);
    const longest = RUNS.has(shape) ? list.reduce((a, b) => (b.combo.size > a.combo.size ? b : a), first) : null;
    return longest && !picked.includes(longest) ? [...picked, longest] : picked;
  });
  const wide = pick(PER_SHAPE);
  return (wide.length <= QUIET_MAX ? wide : pick(1)).slice(0, QUIET_MAX);
}

const key = (ids: readonly number[]): string => [...ids].sort((a, b) => a - b).join(',');

/**
 * The plays to put to a mind, numbered from 1: the one the rules would make first, then a shortlist of the rest (every
 * play that beats the table, or at a lead the lowest of each shape), then a few bombs and the rocket. Null when there
 * is nothing to decide: no play can be made, so the seat passes, or the rules' pick goes out.
 */
export function menuOf(v: TableView): Play[] | null {
  const found = choices(v);
  const mine = botPlay(v);
  if (found.length === 0 || mine.length === v.hand.length) return null;
  const quiet = found.filter((p) => !isBomb(p.combo));
  const bombs = found.filter((p) => p.combo.kind === 'bomb').sort(lighter);
  const shown = [
    ...(v.lead ? shortlist(quiet) : quiet.sort(lowest).slice(0, QUIET_MAX)),
    ...bombs.slice(0, BOMBS_MAX),
    ...found.filter((p) => p.combo.kind === 'rocket'),
  ];
  const first = mine.length === 0 ? null : (found.find((p) => key(p.ids) === key(mine)) ?? null);
  return first ? [first, ...shown.filter((p) => p !== first)] : shown;
}

/** The question for a play: the table, the menu, and the format of the reply. */
export function playQuestion(v: TableView, menu: readonly Play[], names: Names): string {
  const tag = tagger(v.me, names);
  const reveal = revealing(v);
  const byId = new Map(v.hand.map((c) => [c.id, c]));
  const rows = menu.map((p, i) => {
    const cards = p.ids.flatMap((id) => byId.get(id) ?? []).sort(ascending);
    const shows = reveal !== null && p.ids.includes(reveal) ? ' (plays the called card: shows you as a landlord)' : '';
    return `${i + 1}. ${cardList(cards, w)} — ${playLabel(p.combo, w)}${shows}`;
  });
  const head = v.top
    ? `Your turn: beat ${tag(v.top.seat)}'s ${playLabel(v.top.combo, w)}, or pass.`
    : 'Your turn, and you lead, so you must play.';
  return [
    head,
    stateText(v, names),
    `${v.lead ? 'Plays on offer, a shortlist of what your hand can make' : 'Plays on offer'}:\n${(v.lead ? rows : ['0. Pass', ...rows]).join('\n')}`,
    `Reply {"play": <number>, ${SAY_FORMAT}}.`,
  ].join('\n\n');
}

// What a mind says back

const isPass = (raw: unknown): boolean => raw === false || (typeof raw === 'string' && /^\s*pass\s*$/i.test(raw));

/** The one number a reply names: alone, or in a list of one. */
const numberIn = (raw: unknown): number | null => {
  const one = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
  return isPass(one) ? 0 : intIn(one);
};

const sayOf = (o: Record<string, unknown> | null): string | null => {
  const line = cleanLine(o?.say, DDZ_SAY_MAX);
  return line === '' ? null : line;
};

/** The bid a reply makes, 0 for a pass; null when it names no bid the table would take. */
export function parseBid(text: string, ask: BidAsk): { bid: number; say: string | null } | null {
  const o = jsonOf(text);
  const raw: unknown = o ? (o.bid ?? o.pick ?? (o.pass === true ? 0 : undefined)) : text.trim();
  const n = numberIn(raw);
  return n !== null && (n === 0 || (n >= ask.min && n <= ask.max)) ? { bid: n, say: sayOf(o) } : null;
}

/** The cards a reply plays, none for a pass; null when it names no play on the menu (or passes at a lead). */
export function parsePlay(text: string, menu: readonly Play[], lead: boolean): { ids: number[]; say: string | null } | null {
  const o = jsonOf(text);
  const raw: unknown = o ? (o.play ?? o.pick ?? o.choice ?? (o.pass === true ? 0 : undefined)) : text.trim();
  const n = numberIn(raw);
  if (n === null) return null;
  if (n === 0) return lead ? null : { ids: [], say: sayOf(o) };
  const chosen = menu[n - 1];
  return chosen ? { ids: [...chosen.ids], say: sayOf(o) } : null;
}

// The minds

interface SeatMind {
  /** How many of the table's entries the seat has been told of. */
  cursor: number;
  briefed: boolean;
}

/** The computer players' minds. Each seat's session is told the game once, then only what happened since it last looked, and the question. */
export function makeDdzMind(o: DdzMindDeps): DdzMind {
  const budget = o.budget ?? DDZ_BUDGET;
  let spent = 0;
  const log: Entry[] = [];
  const minds = new Map<number, SeatMind>();
  const mindOf = (seat: number): SeatMind => {
    let m = minds.get(seat);
    if (!m) {
      m = { cursor: 0, briefed: false };
      minds.set(seat, m);
    }
    return m;
  };

  /** Puts `question` to the mind of `seat`, with what it has not been told yet; null when it cannot answer. */
  const consult = async (seat: number, size: Size, question: string): Promise<string | null> => {
    if (spent >= budget) return null;
    spent++;
    const m = mindOf(seat);
    const upto = log.length;
    const tag = tagger(seat, o.names);
    const lines = log.slice(m.cursor, upto).flatMap((e) => entryLines(e, w, tag)).map((l) => l.text);
    const parts: string[] = [];
    if (!m.briefed) parts.push(briefing(size, seat, { ...o.character(seat), language: o.language }));
    if (lines.length > 0) {
      const shown = lines.length > LINES_MAX
        ? [`(${lines.length - LINES_MAX} earlier events left out)`, ...lines.slice(-LINES_MAX)]
        : lines;
      parts.push(`What has happened since you last looked:\n${shown.join('\n')}`);
    }
    parts.push(question);
    let reply: string | null = null;
    o.think?.(seat, true);
    try {
      reply = await o.ask(seat, parts.join('\n\n'));
    } catch {
      reply = null;
    } finally {
      o.think?.(seat, false);
    }
    if (reply === null) return null;
    m.cursor = upto;
    m.briefed = true;
    return reply;
  };

  const bid = async (seat: number, ask: BidAsk, t: Table): Promise<Thought | null> => {
    const text = await consult(seat, t.size, bidQuestion(viewFor(t, seat), ask, o.names));
    const got = text === null ? null : parseBid(text, ask);
    return got === null ? null : { reply: { k: 'bid', bid: got.bid }, say: got.say };
  };

  const play = async (seat: number, t: Table): Promise<Thought | null> => {
    const v = viewFor(t, seat);
    const menu = menuOf(v);
    if (menu === null) return null;
    const text = await consult(seat, t.size, playQuestion(v, menu, o.names));
    const got = text === null ? null : parsePlay(text, menu, v.lead);
    return got === null ? null : { reply: { k: 'play', ids: got.ids }, say: got.say };
  };

  return {
    observe: (entry) => {
      log.push(entry);
    },
    answer: (seat, ask, t) => (ask.k === 'bid' ? bid(seat, ask, t) : play(seat, t)),
  };
}
