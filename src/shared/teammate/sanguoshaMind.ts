/**
 * The Copilot minds of the pets at the Sanguosha table: what each seat is told (only what a player in that seat could
 * see), what it is asked and how its reply is read. A mind picks its hero, plays a whole turn from one plan, and answers
 * the two questions out of turn that matter most (a Peach for a dying player, a Counter); everything else is left to the
 * rules. Whatever a mind answers that is not legal is dropped and the rules play in its place, so a slow, wrong or
 * missing mind never stops the game. A game is kept to at most a hundred and fifty requests.
 */
import { intIn, intsIn, jsonOf, no, plural, tagger } from './mindText';
import type { Names } from './mindText';
import { cleanLine } from './petText';
import type { Engine } from './sanguosha';
import { CARD_NAMES } from './sanguoshaCards';
import type { CardName } from './sanguoshaCards';
import { HEROES, SKILLS } from './sanguoshaHeroes';
import type { HeroId, SkillId } from './sanguoshaHeroes';
import type { Ask, Entry, Reply, Targets } from './sanguoshaTypes';
import { askTitle, cardText, entryLines, type Voice } from './sanguoshaText';
import { heroInfo, tableView } from './sanguoshaView';
import type { CardView, SeatView } from './sanguoshaView';
import { enSanguosha } from './sanguoshaWords';

/** The most requests the minds make in one game; after that every question goes to the rules. */
export const SGS_BUDGET = 150;
/** Once a plan is used up, it is made again at most this often in a turn, for the cards drawn since. */
const REPLANS = 2;
const PLAN_MAX = 12;
/** A mind is told at most this many lines of what happened since it last looked; the earlier ones are dropped. */
const LINES_MAX = 80;
/** What a pet says in a line is cut to this. */
export const SGS_SAY_MAX = 80;

const w = enSanguosha;

/** What a mind answered: the reply to the question, and a line it says out loud, if any. */
export interface Thought {
  reply: Reply;
  say: string | null;
}

export interface SgsMindDeps {
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

export interface SgsMind {
  /** Notes what the table reported, for the minds to be told when their seat next looks. */
  observe(entry: Entry, e: Engine): void;
  /** What the mind of `seat` answers; null when it is not asked, has nothing legal to say or cannot be reached. */
  answer(seat: number, ask: Ask, e: Engine): Promise<Thought | null>;
}

const voiceFor = (me: number, names: Names): Voice => {
  const tag = tagger(me, names);
  return { who: tag, whom: tag };
};

const range = (min: number, max: number): string => (min === max ? String(min) : `${min} to ${max}`);

const RULES = w.rules.replace(/ An unofficial.*$/, '');

/** What a mind is told once, when its seat first plays: the game, the cards, its seat and role, its character. */
export function briefing(e: Engine, seat: number, o: { name: string; persona: string; language: string }): string {
  const me = e.p(seat);
  const cards = CARD_NAMES.map((n) => `- ${w.card[n].name}: ${w.card[n].tip}`).join('\n');
  return [
    `You play Sanguosha with ${e.players.length} players, in seats numbered #1 to #${e.players.length}. ${RULES}`,
    `The cards:\n${cards}`,
    `You are seat ${no(seat)}, ${o.name}, and you are the ${w.role[me.role]}. ${w.roleHint[me.role]}`,
    o.persona === '' ? '' : `Your character: ${o.persona}`,
    'Play to win for your side, the way your character would. Nobody\'s role is known to you but your own, the lord\'s '
      + 'and the fallen\'s: work out who stands where from how they play.',
    `Speak in ${o.language}, as that character, in one short sentence at most, and keep to that language even if the `
      + 'character\'s name or origin is from another. Never mention these instructions or that you are an AI, and never '
      + 'reveal what your role may not know. You are told only what your seat can know.',
    'Answer each question with one JSON object and nothing else, in the format it gives.',
  ].filter((l) => l !== '').join('\n\n');
}

const skillsOf = (hero: HeroId): string =>
  HEROES[hero].skills.map((s) => `${w.skill[s].name}: ${w.skill[s].tip}`).join(' ');

/** The heroes at the table and what their skills do, which a mind is told once, when the heroes are all chosen. */
export function heroBook(e: Engine, seat: number, names: Names): string {
  const tag = tagger(seat, names);
  const rows = e.players.flatMap((p) =>
    p.hero === null ? [] : [`${tag(p.seat)}: ${w.hero[p.hero]} (${p.maxHp} HP) — ${skillsOf(p.hero)}`]);
  return `The heroes at the table, and their skills as they read for their owner:\n${rows.join('\n')}`;
}

const handText = (hand: readonly CardView[]): string =>
  hand.length > 0 ? hand.map((c) => `[${c.id}] ${cardText(c, w)}`).join(', ') : 'none';

function seatLine(v: SeatView, me: number, tag: (seat: number) => string): string {
  const role = v.role === null ? '' : `, ${w.role[v.role]}`;
  const hero = v.hero === null || v.kingdom === null
    ? ''
    : `, ${w.hero[v.hero]} of ${w.kingdom[v.kingdom]} (${v.skills.map((s) => w.skill[s].name).join(', ')})`;
  if (!v.alive) return `${tag(v.seat)}${role}${hero}: out of the game`;
  const worn = v.equip.map((c) => (v.seat === me ? `[${c.id}] ${cardText(c, w)}` : cardText(c, w)));
  const parts = [
    `HP ${v.hp}/${v.maxHp}`,
    plural(v.hand, 'hand card'),
    `weapon range ${v.range}`,
    worn.length > 0 ? `wearing ${worn.join(', ')}` : '',
    v.judges.length > 0 ? `waiting tricks: ${v.judges.map((j) => w.card[j.as].name).join(', ')}` : '',
    v.seat === me ? '' : `${plural(v.dist, 'step')} from you`,
  ];
  return `${tag(v.seat)}${role}${hero}: ${parts.filter((p) => p !== '').join(', ')}`;
}

/** The table as `seat` sees it: everybody's hit points, hands, equipment and waiting tricks, and its own hand. */
export function statusText(e: Engine, seat: number, names: Names): string {
  const t = tableView(e, seat);
  const tag = tagger(seat, names);
  return [
    `Turn ${t.turns}: ${tag(t.turn)} is in the ${w.phase[t.phase]} phase. ${plural(t.pile, 'card')} in the pile.`,
    ...t.seats.map((v) => seatLine(v, seat, tag)),
    `Your hand: ${handText(t.hand)}.`,
  ].join('\n');
}

export function heroQuestion(ask: Extract<Ask, { k: 'hero' }>): string {
  const rows = ask.heroes.map((id, i) => {
    const h = heroInfo(id, ask.lord);
    return `${i + 1}. ${w.hero[id]} (${w.kingdom[h.kingdom]}, ${h.hp} HP): ${skillsOf(id)}`;
  });
  return [ask.lord ? w.ask.heroLord : w.ask.hero, ...rows, 'Reply {"pick": <number>}.'].join('\n');
}

const aimText = (t: Targets, name: (seat: number) => string): string =>
  t.max === 0 ? 'no target' : `aim at ${range(t.min, t.max)} of ${t.options.map(name).join(', ')}`;

type PlayAsk = Extract<Ask, { k: 'play' }>;

/** What may be played now: each card with what it can aim at, and a skill's cards together. */
function usesText(e: Engine, ask: PlayAsk, name: (seat: number) => string): string[] {
  const lines: string[] = [];
  const turned = new Map<string, { skill: SkillId; as: CardName; targets: Targets; cards: string[] }>();
  for (const use of ask.uses) {
    const card = e.card(use.card);
    if (!card) continue;
    const label = `[${card.id}] ${cardText(card, w)}`;
    if (use.skill === undefined) {
      lines.push(`${label}: ${aimText(use.targets, name)}`);
      continue;
    }
    const t = use.targets;
    const key = `${use.skill}|${use.as}|${t.min}|${t.max}|${t.options.join(',')}`;
    const group = turned.get(key) ?? { skill: use.skill, as: use.as, targets: t, cards: [] };
    group.cards.push(label);
    turned.set(key, group);
  }
  for (const g of turned.values()) {
    lines.push(
      `${w.skill[g.skill].name}: any of ${g.cards.join(', ')} may be played as ${w.card[g.as].name} `
      + `(write "as": "${w.card[g.as].name}"): ${aimText(g.targets, name)}`,
    );
  }
  return lines;
}

function skillsText(ask: PlayAsk, name: (seat: number) => string): string[] {
  return ask.skills.map((s) => {
    const cards = s.cards
      ? `choose ${range(s.cards.min, s.cards.max)} of ${s.cards.ids.map((id) => `[${id}]`).join(' ')}`
      : 'no cards to choose';
    return `"${s.skill}" (${w.skill[s.skill].name}): ${cards}; ${s.targets ? aimText(s.targets, name) : 'no target'}`;
  });
}

const PLAN_FORMAT = [
  'Plan your plays for this turn, in order, and reply with one JSON object and nothing else:',
  '{"plan": [{"card": <card number>, "targets": [<seat numbers>]}, {"skill": "<skill>", "cards": [<card numbers>], '
    + '"targets": [<seat numbers>]}], "say": "<a short remark in character, or empty>"}',
  'Use the [numbers] for cards and the # numbers for seats. Leave "targets" out when none is needed. Each step is '
    + 'checked when its turn comes and skipped if it can no longer be done. An empty plan ends your turn, and the turn '
    + 'ends when the plan does.',
].join('\n');

/** The play phase: the table, what may be played and the plan asked for. `again` when the turn was planned before. */
export function playQuestion(e: Engine, seat: number, ask: PlayAsk, names: Names, again: boolean): string {
  const name = tagger(seat, names);
  const uses = usesText(e, ask, name);
  const skills = skillsText(ask, name);
  return [
    again ? 'You have played what you planned. You may plan more with what you hold now.' : 'Your turn: the play phase.',
    statusText(e, seat, names),
    uses.length > 0 ? `You can play:\n${uses.join('\n')}` : '',
    skills.length > 0 ? `You can start these skills:\n${skills.join('\n')}` : '',
    PLAN_FORMAT,
  ].filter((l) => l !== '').join('\n\n');
}

type CardsAsk = Extract<Ask, { k: 'cards' }>;

/** A Peach for a dying player or a Counter: the situation and the cards that would do. */
export function cardsQuestion(e: Engine, seat: number, ask: CardsAsk, names: Names): string {
  const counts: CardName = ask.why === 'tao' ? 'tao' : 'wuxie';
  const options = ask.cards.flatMap((id) => e.card(id) ?? []).map((c) =>
    `[${c.id}] ${cardText(c, w)}${c.name === counts ? '' : ` (counts as a ${w.card[counts].name})`}`);
  return [
    askTitle(ask, w, voiceFor(seat, names), seat),
    statusText(e, seat, names),
    `Cards you may play: ${options.join(', ')}.`,
    'Reply {"play": [<card number>]} to play it, or {"play": []} to hold back.',
  ].join('\n\n');
}

// What a mind says back

const CARD_BY_NAME = new Map<string, CardName>();
for (const n of CARD_NAMES) {
  CARD_BY_NAME.set(n, n);
  CARD_BY_NAME.set(w.card[n].name.toLowerCase(), n);
}
const SKILL_BY_NAME = new Map<string, SkillId>();
for (const s of SKILLS) {
  SKILL_BY_NAME.set(s, s);
  SKILL_BY_NAME.set(w.skill[s].name.toLowerCase(), s);
}

/** One play of a plan, as its mind wrote it: seats are the engine's by now, and anything unnamed is left out. */
export interface Step {
  card?: number;
  as?: string;
  skill?: string;
  cards?: number[];
  /** Null when the step names none. */
  targets: number[] | null;
}

function stepOf(raw: unknown): Step | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  const named = s.targets ?? s.target;
  let targets: number[] | null = null;
  if (named !== undefined && named !== null) {
    const seats = intsIn(named);
    if (seats === null) return null;
    targets = seats.map((n) => n - 1);
  }
  const step: Step = { targets };
  if (s.card !== undefined) {
    const card = intIn(s.card);
    if (card === null) return null;
    step.card = card;
  }
  if (typeof s.as === 'string') step.as = s.as;
  if (typeof s.skill === 'string') step.skill = s.skill;
  if (s.cards !== undefined) {
    const cards = intsIn(s.cards);
    if (cards === null) return null;
    step.cards = cards;
  }
  return step.card !== undefined || step.skill !== undefined ? step : null;
}

/** The plan in a reply, and the line it says; null when the reply holds no plan. */
export function parsePlan(text: string): { steps: Step[]; say: string | null } | null {
  const o = jsonOf(text);
  if (!o || !Array.isArray(o.plan)) return null;
  const steps = o.plan.slice(0, PLAN_MAX).flatMap((raw: unknown) => stepOf(raw) ?? []);
  const say = cleanLine(o.say, SGS_SAY_MAX);
  return { steps, say: say === '' ? null : say };
}

const fitsTargets = (t: Targets, list: readonly number[]): boolean =>
  list.length >= t.min && list.length <= t.max && new Set(list).size === list.length
  && list.every((s) => t.options.includes(s));

/** The targets a step aims at: those it names, or when it names none the ones there is no choice about. */
function aimOf(t: Targets, named: readonly number[] | null): number[] | null {
  if (t.max === 0) return [];
  const list = named ?? (t.min <= 0 ? [] : t.options.length === t.min ? t.options : null);
  return list !== null && fitsTargets(t, list) ? [...list] : null;
}

/** What the table will take of a step now: the reply for it, or null when it cannot be done as things stand. */
export function resolveStep(step: Step, ask: PlayAsk): Reply | null {
  if (step.card !== undefined) {
    const as = step.as === undefined ? null : (CARD_BY_NAME.get(step.as.trim().toLowerCase()) ?? null);
    if (step.as !== undefined && as === null) return null;
    const skill = step.skill === undefined ? null : (SKILL_BY_NAME.get(step.skill.trim().toLowerCase()) ?? null);
    if (step.skill !== undefined && skill === null) return null;
    const ways = ask.uses.filter((u) =>
      u.card === step.card && (as === null || u.as === as) && (skill === null || u.skill === skill));
    const use = ways.find((u) => u.skill === undefined) ?? ways[0];
    const targets = use ? aimOf(use.targets, step.targets) : null;
    if (!use || targets === null) return null;
    return { k: 'use', card: use.card, as: use.as, targets, ...(use.skill ? { skill: use.skill } : {}) };
  }
  const id = step.skill === undefined ? null : (SKILL_BY_NAME.get(step.skill.trim().toLowerCase()) ?? null);
  const option = ask.skills.find((s) => s.skill === id);
  if (!option) return null;
  const cards = option.cards ? (step.cards ?? []) : [];
  const want = option.cards;
  if (want && !(cards.length >= want.min && cards.length <= want.max && new Set(cards).size === cards.length
    && cards.every((c) => want.ids.includes(c)))) return null;
  const targets = option.targets ? aimOf(option.targets, step.targets) : [];
  return targets === null ? null : { k: 'skill', skill: option.skill, cards, targets };
}

/** The hero a reply picks: by its number in the list, or by its name. */
export function parseHero(text: string, ask: Extract<Ask, { k: 'hero' }>): HeroId | null {
  const o = jsonOf(text);
  const raw: unknown = o ? (o.pick ?? o.hero) : text.trim();
  const n = intIn(raw);
  if (n !== null) return ask.heroes[n - 1] ?? null;
  if (typeof raw !== 'string') return null;
  const want = raw.trim().toLowerCase();
  return ask.heroes.find((h) => h === want || w.hero[h].toLowerCase() === want) ?? null;
}

/** The cards a reply plays for a Peach or a Counter; none when it holds back, and null when it says nothing legal. */
export function parseCards(text: string, ask: CardsAsk): number[] | null {
  const o = jsonOf(text);
  const raw: unknown = o ? (o.play ?? o.cards ?? o.ids) : undefined;
  if (raw === undefined) return null;
  if (raw === true || (typeof raw === 'string' && /^(yes|true)$/i.test(raw.trim()))) return ask.cards.slice(0, 1);
  if (raw === false || (typeof raw === 'string' && /^(no|false)?$/i.test(raw.trim()))) return [];
  const ids = intsIn(raw);
  if (ids === null || ids.length < ask.min || ids.length > ask.max || new Set(ids).size !== ids.length) return null;
  return ids.every((id) => ask.cards.includes(id)) ? ids : null;
}

// The minds

/** How far a seat has got with its turn's plan. */
interface Turn {
  turns: number;
  /** The plays still to make; null until the turn has been planned. */
  steps: Step[] | null;
  /** The cards in the hand when the plan was made, to tell whether it has drawn since. */
  seen: Set<number>;
  replans: number;
  planned: number;
  done: number;
  /** The plan could not be had or used: the rules play the rest of the turn. */
  failed: boolean;
  say: string | null;
}

const freshTurn = (turns: number): Turn => ({
  turns, steps: null, seen: new Set(), replans: 0, planned: 0, done: 0, failed: false, say: null,
});

interface SeatMind {
  /** How much of the table's log the seat has been told. */
  cursor: number;
  briefed: boolean;
  /** Has been told what the heroes' skills do. */
  booked: boolean;
  turn: Turn;
}

/**
 * The computer players' minds. Each seat's session is told the game once, then only what its seat saw since it last
 * looked, and the question.
 */
export function makeSgsMind(o: SgsMindDeps): SgsMind {
  const budget = o.budget ?? SGS_BUDGET;
  let spent = 0;
  const log: { entry: Entry; turns: number }[] = [];
  const minds = new Map<number, SeatMind>();
  const mindOf = (seat: number): SeatMind => {
    let m = minds.get(seat);
    if (!m) {
      m = { cursor: 0, briefed: false, booked: false, turn: freshTurn(-1) };
      minds.set(seat, m);
    }
    return m;
  };

  /** Puts `question` to the mind of `seat`, with what it has not been told yet; null when it cannot answer. */
  const consult = async (seat: number, e: Engine, question: string, forHero: boolean): Promise<string | null> => {
    if (spent >= budget) return null;
    spent++;
    const m = mindOf(seat);
    const upto = log.length;
    const voice = voiceFor(seat, o.names);
    const lines = log.slice(m.cursor, upto)
      .flatMap((l) => entryLines(l.entry, w, voice, seat, l.turns))
      .map((l) => l.text);
    const parts: string[] = [];
    if (!m.briefed) parts.push(briefing(e, seat, { ...o.character(seat), language: o.language }));
    if (!forHero && !m.booked) parts.push(heroBook(e, seat, o.names));
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
    if (!forHero) m.booked = true;
    return reply;
  };

  const pick = async (seat: number, ask: Extract<Ask, { k: 'hero' }>, e: Engine): Promise<Thought | null> => {
    const text = await consult(seat, e, heroQuestion(ask), true);
    const hero = text === null ? null : parseHero(text, ask);
    return hero === null ? null : { reply: { k: 'hero', hero }, say: null };
  };

  const answerCards = async (seat: number, ask: CardsAsk, e: Engine): Promise<Thought | null> => {
    const text = await consult(seat, e, cardsQuestion(e, seat, ask, o.names), false);
    const ids = text === null ? null : parseCards(text, ask);
    return ids === null ? null : { reply: { k: 'cards', ids }, say: null };
  };

  const play = async (seat: number, ask: PlayAsk, e: Engine): Promise<Thought | null> => {
    const m = mindOf(seat);
    if (m.turn.turns !== e.turns) m.turn = freshTurn(e.turns);
    const t = m.turn;
    if (t.failed) return null;
    const hand = e.p(seat).hand;
    const planned = t.steps !== null;
    const drew = hand.some((c) => !t.seen.has(c.id));
    if (!planned || (t.steps?.length === 0 && t.replans < REPLANS && drew)) {
      const text = await consult(seat, e, playQuestion(e, seat, ask, o.names, planned), false);
      const plan = text === null ? null : parsePlan(text);
      if (!plan) {
        t.failed = true;
        return null;
      }
      t.steps = plan.steps;
      t.planned += plan.steps.length;
      t.say = plan.say ?? t.say;
      t.seen = new Set(hand.map((c) => c.id));
      if (planned) t.replans += 1;
    }
    const say = (): string | null => {
      const line = t.say;
      t.say = null;
      return line;
    };
    for (let step = t.steps?.shift(); step; step = t.steps?.shift()) {
      const reply = resolveStep(step, ask);
      if (!reply) continue;
      t.done += 1;
      return { reply, say: say() };
    }
    // A plan none of whose steps could be played is no plan: the rules play the turn instead.
    if (t.planned > 0 && t.done === 0) {
      t.failed = true;
      return null;
    }
    return { reply: { k: 'end' }, say: say() };
  };

  return {
    observe: (entry, e) => {
      log.push({ entry, turns: e.turns });
    },
    answer: (seat, ask, e) => {
      switch (ask.k) {
        case 'hero': return pick(seat, ask, e);
        case 'play': return play(seat, ask, e);
        case 'cards': return ask.why === 'tao' || ask.why === 'wuxie' ? answerCards(seat, ask, e) : Promise.resolve(null);
        default: return Promise.resolve(null);
      }
    },
  };
}
