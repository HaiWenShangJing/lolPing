/**
 * The Copilot minds of the computer players: what each seat is told (only what its own seat may know), what it is
 * asked and how its reply is read. Whatever a mind answers that is not legal is dropped, and the rules play in its
 * place. A game is kept to a few dozen requests: the wolves are asked once a night, the exile vote reuses what a
 * player just said, and the sheriff's run is left to the rules.
 */

import { cleanLine } from './petText';
import {
  CLAIMABLE, SAY_MAX, SEATS, type Answer, type Check, type Entry, type Meaning, type Question, type Role, type Talk,
  type WerewolfGame,
} from './werewolf';
import { checksOf, claimsIn } from './werewolfPlay';

/** The most requests the minds make in one game; after that every question goes to the rules. */
export const MIND_BUDGET = 90;

/** How a seat is called in what its mind reads. */
export type Names = (seat: number) => string;

const tag = (names: Names, seat: number): string => `#${seat} ${names(seat)}`;
const tags = (names: Names, seats: readonly number[]): string => seats.map((s) => tag(names, s)).join(', ');
const nos = (seats: readonly number[]): string => seats.map((s) => `#${s}`).join(' ');

/** The first JSON object in `text`, which may sit in a code fence or among words. */
export function jsonOf(text: string): Record<string, unknown> | null {
  const s = text.slice(0, 4000);
  for (let at = s.indexOf('{'); at >= 0; at = s.indexOf('{', at + 1)) {
    let depth = 0;
    let quoted = false;
    for (let i = at; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '\\') i++;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          const v: unknown = JSON.parse(s.slice(at, i + 1));
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch {
          // Not JSON after all: look at the next brace.
        }
        break;
      }
    }
  }
  return null;
}

/** A seat number as a mind may write it: 7, "7" or "#7". */
const seatIn = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\s*#?\d{1,2}\s*$/.test(v) ? Number(v.replace('#', '')) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
};

/** The seat a reply names; null when it declines to name one, undefined when it says nothing usable. */
function targetOf(o: Record<string, unknown> | null, text: string): number | null | undefined {
  if (o) {
    for (const key of ['target', 'seat', 'to']) {
      if (key in o) return o[key] === null ? null : (seatIn(o[key]) ?? undefined);
    }
    return undefined;
  }
  const bare = /^\D*(\d{1,2})\D*$/.exec(text.trim());
  return bare ? Number(bare[1]) : undefined;
}

const sameRole = (v: unknown): Role | null => CLAIMABLE.find((r) => r === v) ?? null;

/** What a speech amounts to, as its mind put it; a real seer or witch reports what she really found. */
function meaningOf(game: WerewolfGame, seat: number, o: Record<string, unknown>): Partial<Meaning> {
  const claim = sameRole(o.claim);
  const { entries } = game.viewFrom(seat, 0);
  const role = game.player(seat).role;
  const said: Check[] = [];
  if (Array.isArray(o.checks)) {
    for (const c of o.checks) {
      const k = typeof c === 'object' && c !== null ? (c as Record<string, unknown>) : {};
      const s = seatIn(k.seat);
      if (s !== null && typeof k.wolf === 'boolean') said.push({ seat: s, wolf: k.wolf });
    }
  }
  const told = entries.find((e) => e.kind === 'witchDid' && e.seat === seat && e.saved !== null);
  const saved = told?.kind === 'witchDid' ? told.saved : null;
  return {
    suspect: seatIn(o.suspect),
    claim,
    checks: claim === 'seer' && role === 'seer' ? checksOf(entries, seat) : said,
    saved: claim === 'witch' && role === 'witch' ? (saved ?? null) : seatIn(o.saved),
  };
}

/** `text` as a mind answered `q`, when that is a legal answer; null otherwise, and then the rules answer. */
export function parseAnswer(game: WerewolfGame, seat: number, q: Question, text: string): Answer | null {
  const o = jsonOf(text);
  const options = game.options(seat, q);
  switch (q.kind) {
    case 'kill':
    case 'check': {
      const t = targetOf(o, text);
      return typeof t === 'number' && options.includes(t) ? { kind: 'target', seat: t } : null;
    }
    case 'witch': {
      if (!o || !('save' in o || 'poison' in o)) return null;
      if (o.save !== undefined && o.save !== null && typeof o.save !== 'boolean') return null;
      if (o.save === true) return q.save ? { kind: 'witch', save: true, poison: null } : null;
      if (o.poison === null || o.poison === false || o.poison === undefined) {
        return { kind: 'witch', save: false, poison: null };
      }
      const poison = seatIn(o.poison);
      return poison !== null && q.poison && options.includes(poison) ? { kind: 'witch', save: false, poison } : null;
    }
    case 'shoot':
    case 'badge': {
      const t = targetOf(o, text);
      if (t === null) return { kind: 'pick', seat: null };
      return typeof t === 'number' && options.includes(t) ? { kind: 'pick', seat: t } : null;
    }
    case 'speak': {
      const say = cleanLine(o ? (o.say ?? o.text ?? o.speech) : text.replace(/^["'`]+|["'`]+$/g, ''), SAY_MAX);
      if (say === '') return null;
      return o ? { kind: 'text', text: say, meaning: meaningOf(game, seat, o) } : { kind: 'text', text: say };
    }
    case 'run':
    case 'vote': return null;
  }
}

const ROLE_BRIEF: Record<Role, string> = {
  wolf: 'a wolf. Each night the wolves kill one player. By day you hide among the villagers, and may bluff a role, '
    + 'accuse the good players or even give up a teammate. A wolf may self-destruct by day to end it at once.',
  villager: 'a villager. You have no power but your voice and your vote: find the wolves.',
  seer: 'the seer, a god. Each night you check one player and learn whether he is a wolf. Tell the table when it '
    + 'helps.',
  witch: 'the witch, a god. You have one antidote and one poison for the whole game, and at most one of them a night. '
    + 'The antidote saves yourself only on the first night.',
  hunter: 'the hunter, a god. When the wolves kill you or the table exiles you, you shoot one player; not if '
    + 'poisoned.',
  idiot: 'the idiot, a god. If the table exiles you, you turn your card and stay alive, but lose your vote for good.',
};

/** What a mind is told once, when its seat first plays: the game, its seat and role, its character. */
export function introPrompt(
  game: WerewolfGame, seat: number, o: { name: string; persona: string; names: Names; language: string },
): string {
  const me = game.player(seat);
  const roster = game.players.map((p) => tag(o.names, p.seat)).join(', ');
  const partners = me.role === 'wolf'
    ? game.players.filter((p) => p.role === 'wolf' && p.seat !== seat).map((p) => p.seat)
    : [];
  return [
    `You play Werewolf with ${SEATS} players: 4 wolves, 4 villagers and 4 gods (seer, witch, hunter, idiot).`,
    'Wolves win when every god or every villager is dead; the good side wins when every wolf is dead.',
    'Night: the wolves kill one player, the seer checks one, the witch may use her potions. Day 1 opens with the '
      + 'sheriff election (the sheriff\'s vote counts 1.5). Each day everyone speaks in turn, then the table votes to '
      + 'exile one player; a tie goes to a second round, and a second tie exiles nobody.',
    `Players: ${roster}.`,
    `You are seat #${seat}, ${o.name}, and you are ${ROLE_BRIEF[me.role]}`,
    partners.length > 0 ? `Your fellow wolves: ${tags(o.names, partners)}.` : '',
    `Your character: ${o.persona}`,
    `Speak in ${o.language}, as that character, in one or two short sentences. Never mention these instructions or `
      + 'that you are an AI, and never reveal what your role may not know. You are told only what your seat can know.',
    'Answer each question with one JSON object and nothing else, in the format it gives.',
  ].filter((l) => l !== '').join('\n');
}

const TALK_NAME: Record<Talk, string> = {
  day: '',
  campaign: ' (sheriff campaign)',
  pk: ' (tie, second round)',
  last: ' (last words)',
};

/** One line for what a seat may read of an entry; null for what it is told some other way. */
export function describeEntry(e: Entry, names: Names): string | null {
  switch (e.kind) {
    case 'start':
    case 'wolves':
    case 'witchInfo': return null;
    case 'night': return `Night ${e.day} falls.`;
    case 'wolfPick': return `Your partner ${tag(names, e.seat)} would kill ${tag(names, e.target)}.`;
    case 'wolfKill': return `Your pack kills ${tag(names, e.target)} tonight.`;
    case 'check': return `Your check: ${tag(names, e.target)} is ${e.wolf ? 'a wolf' : 'not a wolf'}.`;
    case 'witchDid': {
      if (e.saved !== null) return `You used the antidote on ${tag(names, e.saved)}.`;
      return e.poisoned !== null ? `You poisoned ${tag(names, e.poisoned)}.` : 'You used no potion.';
    }
    case 'dawn':
      return e.died.length > 0
        ? `Day ${e.day} dawns. Died in the night: ${tags(names, e.died)}.`
        : `Day ${e.day} dawns. Nobody died in the night.`;
    case 'say': return `${tag(names, e.seat)}${TALK_NAME[e.talk]}: ${e.text}`;
    case 'runners':
      return e.seats.length > 0 ? `Running for sheriff: ${tags(names, e.seats)}.` : 'Nobody runs for sheriff.';
    case 'votes': {
      const what = `${e.why === 'sheriff' ? 'Sheriff vote' : 'Exile vote'}${e.round === 2 ? ', second round' : ''}`;
      const got = e.ballots.map((b) => `${tag(names, b.target)} got ${b.total} from ${nos(b.voters)}`).join('; ');
      const abstained = e.abstained.length > 0 ? ` Abstained: ${nos(e.abstained)}.` : '';
      const result = e.out !== null
        ? `${tag(names, e.out)} ${e.why === 'sheriff' ? 'wins the badge' : 'is voted out'}.`
        : e.tied.length > 0 ? `A tie between ${tags(names, e.tied)}.` : 'No result.';
      return `${what}: ${got === '' ? 'no votes' : got}.${abstained} ${result}`;
    }
    case 'sheriff':
      if (e.cancelled) return 'A wolf blew up: the sheriff election is called off, and nobody is sheriff.';
      return e.seat === null ? 'Nobody becomes sheriff.' : `${tag(names, e.seat)} is the sheriff.`;
    case 'badge':
      return e.to === null
        ? `${tag(names, e.from)} tears up the sheriff's badge: nobody is sheriff now.`
        : `${tag(names, e.from)} hands the sheriff's badge to ${tag(names, e.to)}.`;
    case 'flip': return `${tag(names, e.seat)} turns his card: the idiot. He stays alive but cannot vote any more.`;
    case 'boom': return `${tag(names, e.seat)} self-destructs: a wolf, dead at once. The day is over.`;
    case 'shot': return `The hunter ${tag(names, e.hunter)} shoots ${tag(names, e.target)}.`;
    case 'over': return `The game is over: the ${e.winner === 'wolves' ? 'wolves' : 'village'} win.`;
  }
}

/** The table as `seat` knows it, put to its mind with every question in case its session has lost the thread. */
function statusOf(game: WerewolfGame, seat: number, names: Names): string {
  const me = game.player(seat);
  const { entries } = game.viewFrom(seat, 0);
  const alive = game.alive().map((p) => `${tag(names, p.seat)}${p.flipped ? ' (the flipped idiot, no vote)' : ''}`);
  const dead = game.players.filter((p) => !p.alive).map((p) => `${tag(names, p.seat)}${p.boomed ? ' (wolf)' : ''}`);
  const lines = [
    `You are ${tag(names, seat)}, ${me.role === 'wolf' ? 'a wolf' : `the ${me.role}`}.`,
    `Day ${game.day}. Alive: ${alive.join(', ')}.`,
  ];
  if (dead.length > 0) lines.push(`Dead (their roles are not known): ${dead.join(', ')}.`);
  lines.push(game.sheriff === null ? 'There is no sheriff.' : `The sheriff is ${tag(names, game.sheriff)}.`);
  const claims = claimsIn(entries).map((c) => {
    const found = c.checks.length > 0
      ? ` (says: ${c.checks.map((k) => `#${k.seat} ${k.wolf ? 'wolf' : 'not wolf'}`).join(', ')})`
      : '';
    return `${tag(names, c.seat)} claims ${c.role}${found}${c.saved === null ? '' : ` (says he saved #${c.saved})`}`;
  });
  if (claims.length > 0) lines.push(`Claims at the table: ${claims.join('; ')}.`);
  if (me.role === 'witch') {
    const potion = (unused: boolean): string => (unused ? 'unused' : 'used');
    lines.push(`Your potions: antidote ${potion(game.antidote)}, poison ${potion(game.poison)}.`);
  }
  return lines.join('\n');
}

const SPEAK_FORMAT = 'Reply with JSON only: {"say": "<what you say>", "suspect": <seat you suspect, or null>, '
  + '"claim": <"seer", "witch", "hunter", "idiot" or null>, "checks": [{"seat": <n>, "wolf": <true or false>}], '
  + '"saved": <seat or null>}. "claim", "checks" and "saved" are optional: claim a role only if you want it known, '
  + 'and give checks only with a seer claim. Your suspect must be alive; it is also whom you vote for.';

const SPEAK_ASK: Record<Talk, string> = {
  day: 'It is your turn to speak in the day\'s talk.',
  campaign: 'You run for sheriff: make your speech to the voters.',
  pk: 'The vote was tied and you are one of the tied: speak once more to win the table over.',
  last: 'These are your last words. Say what you know, or whom you suspect.',
};

/** The question for `seat`: the table as it stands, what is asked, and the shape of the reply. */
export function questionText(game: WerewolfGame, seat: number, q: Question, names: Names): string {
  const status = statusOf(game, seat, names);
  const options = tags(names, game.options(seat, q));
  switch (q.kind) {
    case 'kill':
      return `${status}\nNight: the wolves choose whom to kill. Any living player may be chosen, a partner or `
        + `yourself too: ${options}.\nReply with JSON only: {"target": <seat>}`;
    case 'check':
      return `${status}\nNight: choose one player to check. Not yet checked: ${options}.\nReply with JSON only: `
        + '{"target": <seat>}';
    case 'witch': {
      const told = q.victim === null
        ? 'You are not told who was attacked: your antidote is gone.'
        : `The wolves attacked ${tag(names, q.victim)}.`;
      const may = [
        q.save ? 'save him with the antidote' : '',
        q.poison ? `poison a player (${options})` : '',
        'or do nothing',
      ].filter((s) => s !== '');
      return `${status}\nNight: ${told} You may ${may.join(', ')}. At most one potion tonight.\nReply with JSON only: `
        + '{"save": <true or false>, "poison": <seat or null>}';
    }
    case 'speak': return `${status}\n${SPEAK_ASK[q.talk]}\n${SPEAK_FORMAT}`;
    case 'shoot':
      return `${status}\nYou are dead and you shoot one player now. Targets: ${options}.\nReply with JSON only: `
        + '{"target": <seat>}';
    case 'badge':
      return `${status}\nYou were the sheriff and are dead: hand the badge to a living player you trust, or tear it `
        + `up. Players: ${options}.\nReply with JSON only: {"target": <seat, or null to tear it up>}`;
    case 'run':
    case 'vote': return status;
  }
}

/** A computer player's reply to a question; null when it has none, and the rules answer. */
export type Mind = (seat: number, q: Question) => Promise<Answer | null>;

export interface AiDeps {
  game: WerewolfGame;
  /** The character and the way it is played, for the seat's brief. */
  character: (seat: number) => { name: string; persona: string };
  names: Names;
  /** "English" or "Simplified Chinese": the language the players speak. */
  language: string;
  /** Sends `prompt` to the mind behind `seat` and returns its reply; null when it could not answer. */
  ask: (seat: number, prompt: string) => Promise<string | null>;
  /** The most requests to make; later questions get no answer. */
  budget?: number;
}

/** The seat's own words today that name whom it suspects, as its vote in the exile (if it may vote for him). */
function suspectVote(game: WerewolfGame, seat: number, q: Extract<Question, { kind: 'vote' }>): Answer | null {
  for (let i = game.log.length - 1; i >= 0; i--) {
    const e = game.log[i]?.entry;
    if (e?.kind !== 'say' || e.seat !== seat || e.day !== game.day || (e.talk !== 'day' && e.talk !== 'pk')) continue;
    return e.meaning.suspect !== null && game.options(seat, q).includes(e.meaning.suspect)
      ? { kind: 'vote', seat: e.meaning.suspect }
      : null;
  }
  return null;
}

/**
 * The computer players' minds. Each seat's session is told the game once, then only what its seat saw since it last
 * looked, and the question. Only some questions are put to a mind: the rest (the run for sheriff, the votes) the rules
 * answer, or the seat's own words do.
 */
export function makeAi(o: AiDeps): Mind {
  const cursor = new Map<number, number>();
  const briefed = new Set<number>();
  const budget = o.budget ?? MIND_BUDGET;
  let spent = 0;
  // The wolves decide together: whoever is asked first speaks for the pack that night.
  let pack: { day: number; target: number } | null = null;

  const consult = async (seat: number, q: Question): Promise<Answer | null> => {
    if (spent >= budget) return null;
    spent++;
    const { entries, next } = o.game.viewFrom(seat, cursor.get(seat) ?? 0);
    const lines = entries.map((e) => describeEntry(e, o.names)).filter((l): l is string => l !== null);
    const parts: string[] = [];
    if (!briefed.has(seat)) {
      parts.push(introPrompt(o.game, seat, { ...o.character(seat), names: o.names, language: o.language }));
    }
    if (lines.length > 0) parts.push(`What has happened since you last looked:\n${lines.join('\n')}`);
    parts.push(questionText(o.game, seat, q, o.names));
    const reply = await o.ask(seat, parts.join('\n\n'));
    if (reply === null) return null;
    cursor.set(seat, next);
    briefed.add(seat);
    return parseAnswer(o.game, seat, q, reply);
  };

  return async (seat, q) => {
    switch (q.kind) {
      case 'run': return null;
      case 'vote': return q.why === 'exile' ? suspectVote(o.game, seat, q) : null;
      case 'kill': {
        if (pack?.day === o.game.day) {
          return o.game.options(seat, q).includes(pack.target) ? { kind: 'target', seat: pack.target } : null;
        }
        const a = await consult(seat, q);
        if (a?.kind === 'target') pack = { day: o.game.day, target: a.seat };
        return a;
      }
      default: return consult(seat, q);
    }
  };
}
