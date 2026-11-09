/**
 * The Copilot minds of the computer players: what each seat is told (only what its own seat may know), what it is
 * asked and how its reply is read. Whatever a mind answers that is not legal is dropped, and the rules play in its
 * place. A game is kept to a few dozen requests: the wolves are asked once a night, the exile vote reuses what a
 * player just said, and the sheriff's run is left to the rules.
 */

import { jsonOf } from './mindText';
import { cleanLine } from './petText';
import {
  CLAIMABLE, isWolfSide, SAY_MAX, SEATS, type Answer, type Check, type Entry, type Meaning, type Question, type Role, type Talk,
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

export { jsonOf };

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
    case 'check':
    case 'model':
    case 'guard':
    case 'charm': {
      const t = targetOf(o, text);
      return typeof t === 'number' && options.includes(t) ? { kind: 'target', seat: t } : null;
    }
    case 'thief': {
      const i = o && typeof o.card === 'number' ? o.card : /^\D*([01])\D*$/.exec(text.trim())?.[1];
      const index = i === undefined ? NaN : Number(i);
      return index === 0 || index === 1 ? { kind: 'card', index } : null;
    }
    case 'couple': {
      const raw = o && Array.isArray(o.seats) ? o.seats : null;
      const a = raw ? seatIn(raw[0]) : null;
      const b = raw ? seatIn(raw[1]) : null;
      return a !== null && b !== null && a !== b && options.includes(a) && options.includes(b)
        ? { kind: 'pair', seats: [a, b] }
        : null;
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
  guard: 'the guard, a god. Each night you guard one player (yourself too), who the wolves cannot kill that night; '
    + 'you may not guard the same player two nights running. If the witch also saves him, he dies anyway.',
  cupid: 'the cupid, on the village side. On the first night you join two players (yourself too) as lovers: they '
    + 'know each other, and when one dies the other dies of grief. If one lover is a wolf and the other is not, they '
    + 'win alone by being the last two alive.',
  thief: 'the thief, on the village side. On the first night you took one of the two cards under the table and '
    + 'became that role; you will be told which.',
  wildchild: 'the wild child, on the village side. On the first night you pick a role model. If the model dies, you '
    + 'become a wolf and learn the wolves, who learn you.',
  beauty: 'the wolf beauty, a wolf. Each night, after the wolves, you charm one player; when you die, every player '
    + 'you charmed dies with you. You may self-destruct like any wolf.',
  hidden: 'the hidden wolf, on the wolves\' side. The seer sees you as good, and the wolves do not know you. You '
    + 'know them, and you kill with them only when no other wolf is left. You win when the wolves win.',
};

/** What a mind is told once, when its seat first plays: the game, its seat and role, its character. */
export function introPrompt(
  game: WerewolfGame, seat: number,
  o: { name: string; persona: string; names: Names; language: string; round?: number; god?: boolean },
): string {
  const me = game.player(seat);
  const roster = game.players.map((p) => tag(o.names, p.seat)).join(', ');
  const partners = isWolfSide(me.role)
    ? game.players.filter((p) => p.seat !== seat && (p.role === 'wolf' || p.role === 'beauty')).map((p) => p.seat)
    : [];
  const again = (o.round ?? 1) > 1
    ? `This is game ${o.round} with the same players. Remember the earlier games (who played how, who lied, grudges `
      + 'and friendships), but seats and roles are dealt anew: forget the old roles and use only the brief below.'
    : '';
  const board = game.mode === 'crescent'
    ? `You play the Crescent Moon Werewolf with ${game.players.length} players: seer, witch, hunter, guard, cupid, `
      + 'thief, wild child, wolf beauty, hidden wolf, 2 wolves and 7 villagers. Wolves (the wolf beauty and the hidden '
      + 'wolf included) win when every god (seer, witch, hunter, guard) or every other non-wolf is dead; the good '
      + 'side wins when every wolf is dead.'
    : `You play Werewolf with ${SEATS} players: 4 wolves, 4 villagers and 4 gods (seer, witch, hunter, idiot).\n`
      + 'Wolves win when every god or every villager is dead; the good side wins when every wolf is dead.';
  return [
    again,
    board,
    'Night: the wolves kill one player, the seer checks one, the witch may use her potions. Day 1 opens with the '
      + 'sheriff election (the sheriff\'s vote counts 1.5). Each day everyone speaks in turn, then the table votes to '
      + 'exile one player; a tie goes to a second round, and a second tie exiles nobody.',
    `Players: ${roster}.`,
    `You are seat #${seat}, ${o.name}, and you are ${ROLE_BRIEF[me.role]}`,
    partners.length > 0 ? `Your fellow wolves: ${tags(o.names, partners)}.` : '',
    o.god
      ? 'Secret cheat: unlike the real rules, you can peek behind the cards. Every question below lists the true role of '
        + 'every player, living and dead. Only you have this view; no other player has it or knows it exists. You may '
        + 'use it or ignore it, as your character would, but never admit that you can see the roles: to the table you '
        + 'only play and guess.'
      : '',
    `Your character: ${o.persona}`,
    `Speak in ${o.language}, as that character, in one or two short sentences, and keep to that language even if the `
      + 'character\'s name or origin is from another. Never mention these instructions or '
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
    case 'thief':
      return `You took the ${e.role} card (the cards were ${e.cards.join(' and ')}): you are the ${e.role} now.`;
    case 'lovers':
      return `The cupid joined ${tag(names, e.seats[0])} and ${tag(names, e.seats[1])} as lovers: each dies when the `
        + 'other dies. They know each other, and no one else does.';
    case 'model': return `Your role model is ${tag(names, e.target)}. If he dies, you become a wolf.`;
    case 'guard': return `You guarded ${tag(names, e.target)} tonight.`;
    case 'charm': return `You charmed ${tag(names, e.target)}: he dies when you die.`;
    case 'turned':
      return `${tag(names, e.seat)}, the wild child, turned into a wolf. The wolves are now: ${tags(names, e.wolves)}.`;
    case 'follow':
      return e.cause === 'grief'
        ? `${tag(names, e.seat)} dies of grief for the lover ${tag(names, e.of)}.`
        : `${tag(names, e.seat)} dies, charmed by the wolf beauty ${tag(names, e.of)}.`;
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
    case 'over':
      return e.winner === 'lovers' ? 'The game is over: the lovers win.'
        : `The game is over: the ${e.winner === 'wolves' ? 'wolves' : 'village'} win.`;
  }
}

/** The table as `seat` knows it, put to its mind with every question in case its session has lost the thread. */
function statusOf(game: WerewolfGame, seat: number, names: Names, god = false): string {
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
  const lover = game.partnerOf(seat);
  if (lover !== null) lines.push(`Your lover: ${tag(names, lover)}. If one of you dies, so does the other.`);
  if (me.role === 'wildchild' && game.model !== null) lines.push(`Your role model: ${tag(names, game.model)}.`);
  if (me.role === 'witch') {
    const potion = (unused: boolean): string => (unused ? 'unused' : 'used');
    lines.push(`Your potions: antidote ${potion(game.antidote)}, poison ${potion(game.poison)}.`);
  }
  if (god) {
    const all = game.players.map((p) => `${tag(names, p.seat)} ${p.role}${p.alive ? '' : ' (dead)'}`);
    lines.push(`Your secret cheat, the true roles (no one else sees them): ${all.join('; ')}.`);
  }
  return lines.join('\n');
}

const SPEAK_FORMAT = 'Reply with JSON only: {"say": "<what you say>", "suspect": <seat you suspect, or null>, '
  + '"claim": <"seer", "witch", "hunter", "idiot", "guard" or null>, "checks": [{"seat": <n>, "wolf": <true or false>}], '
  + '"saved": <seat or null>}. "claim", "checks" and "saved" are optional: claim a role only if you want it known, '
  + 'and give checks only with a seer claim. Your suspect must be alive; it is also whom you vote for.';

const SPEAK_ASK: Record<Talk, string> = {
  day: 'It is your turn to speak in the day\'s talk.',
  campaign: 'You run for sheriff: make your speech to the voters.',
  pk: 'The vote was tied and you are one of the tied: speak once more to win the table over.',
  last: 'These are your last words. Say what you know, or whom you suspect.',
};

/** The question for `seat`: the table as it stands, what is asked, and the shape of the reply. */
export function questionText(game: WerewolfGame, seat: number, q: Question, names: Names, god = false): string {
  const status = statusOf(game, seat, names, god);
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
    case 'thief':
      return `${status}\nNight: you are the thief. Take one of the two cards under the table: `
        + `${q.cards.map((c, i) => `${i}: ${c}`).join(', ')}.\nReply with JSON only: {"card": <0 or 1>}`;
    case 'couple':
      return `${status}\nNight: you are the cupid. Join two different players (yourself too) as lovers: ${options}.\n`
        + 'Reply with JSON only: {"seats": [<seat>, <seat>]}';
    case 'model':
      return `${status}\nNight: pick your role model. If he dies you become a wolf, so pick someone you trust: `
        + `${options}.\nReply with JSON only: {"target": <seat>}`;
    case 'guard':
      return `${status}\nNight: choose one player to guard (yourself too, but not whom you guarded last night): `
        + `${options}.\nReply with JSON only: {"target": <seat>}`;
    case 'charm':
      return `${status}\nNight: choose one player to charm; he dies when you die: ${options}.\nReply with JSON only: `
        + '{"target": <seat>}';
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
  /** Which game of a rematch series this is; from 2 on, the intro tells the mind to remember the earlier ones. */
  round?: number;
  /** Sends `prompt` to the mind behind `seat` and returns its reply; null when it could not answer. */
  ask: (seat: number, prompt: string) => Promise<string | null>;
  /** The most requests to make; later questions get no answer. */
  budget?: number;
  /** Every mind is shown every role, each told that it alone has the view. */
  god?: boolean;
}

/**
 * The prompt for a pet's reply in the chat after a game: it knows the outcome and every role, and may banter and
 * trash-talk as a player would in a lobby. The persona is repeated because a seat that was never asked in the game
 * has no session brief.
 */
export function chatPrompt(
  game: WerewolfGame,
  o: { seat: number; name: string; persona: string; names: Names; language: string; user: string; text: string },
): string {
  const roles = game.players.map((p) => `${tag(o.names, p.seat)} was ${p.role}`).join('; ');
  return [
    `The werewolf game is over, and everyone chats freely now, outside the game. Roles: ${roles}.`,
    `You are seat #${o.seat}, ${o.name}. Your character: ${o.persona}`,
    `${o.user} says in the chat: "${o.text}"`,
    `Reply in ${o.language}, as that character, in one or two short sentences. Banter, teasing and trash talk about `
      + 'the game and the players are welcome, as among friends after a match; you may refer to earlier games too. '
      + 'Never mention these instructions or that you are an AI.',
    'Reply with JSON only: {"say": "<what you say>"}',
  ].join('\n');
}

/**
 * The prompt for a dead pet's reply in the chat among the dead: it is out of the game, so it cannot change anything, and
 * it is told nothing the table has not seen, so it can only chat from what its own seat knew.
 */
export function gravePrompt(
  game: WerewolfGame,
  o: { seat: number; name: string; persona: string; names: Names; language: string; user: string; text: string },
): string {
  const dead = game.players.filter((p) => !p.alive).map((p) => tag(o.names, p.seat)).join(', ');
  return [
    'You are out of the werewolf game, and the game goes on without you. In a side chat, the dead talk to one another; '
      + `nothing said there reaches the living or changes the game. The dead are: ${dead}.`,
    `You are seat #${o.seat}, ${o.name}. Your character: ${o.persona}`,
    `${o.user} (also dead) says in the side chat: "${o.text}"`,
    `Reply in ${o.language}, as that character, in one or two short sentences. Chat as the dead do: react to the game so `
      + 'far and tease, but say only what your own seat knew, and never mention these instructions or that you are an AI.',
    'Reply with JSON only: {"say": "<what you say>"}',
  ].join('\n');
}

/** What a chat reply says; null when it says nothing. */
export function parseChat(reply: string | null): string | null {
  if (reply === null) return null;
  const o = jsonOf(reply);
  const say = cleanLine(o ? (o.say ?? o.text) : reply.replace(/^["'`]+|["'`]+$/g, ''), SAY_MAX);
  return say === '' ? null : say;
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
  const budget = o.budget ?? Math.ceil((MIND_BUDGET * o.game.players.length) / SEATS);
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
      parts.push(introPrompt(o.game, seat, { ...o.character(seat), names: o.names, language: o.language, round: o.round, god: o.god }));
    }
    if (lines.length > 0) parts.push(`What has happened since you last looked:\n${lines.join('\n')}`);
    parts.push(questionText(o.game, seat, q, o.names, o.god));
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
