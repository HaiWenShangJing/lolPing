/**
 * What the game windows say, in the user's language: the lobby's words, the lines of a werewolf game, and who fills
 * the empty seats.
 */

import type { Strings } from '../i18n';
import type { GameChoice, GameText, WolfAsk, WolfIn } from '../gameIpc';
import { PET_COLORS, PET_IDS, type PetId } from './pet';
import type { Answer, Entry, Question, Role, WerewolfGame, WinReason } from './werewolf';
import type { Phrases } from './werewolfPlay';

export type GameWords = Strings['teammate']['games'];
export type WolfWords = GameWords['werewolf'];

export interface WolfLine {
  tone: 'sys' | 'say' | 'secret' | 'vote';
  seat: number | null;
  text: string;
}

/** `picks` first, then other pets in random order, until there are `count`; the pets that are not out play too. */
export function fillSeats(picks: readonly PetId[], count: number, random: () => number): PetId[] {
  const seated = picks.slice(0, count);
  const rest = PET_IDS.filter((id) => !seated.includes(id));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j] as PetId, rest[i] as PetId];
  }
  return [...seated, ...rest].slice(0, count);
}

/** Every pet that can take a seat, those that are out on the desktop marked. */
export function lobbyChoices(on: readonly PetId[], names: Record<PetId, string>): GameChoice[] {
  return PET_IDS.map((id) => ({ id, name: names[id], color: PET_COLORS[id], on: on.includes(id) }));
}

const lobbyText = (g: GameWords, title: string): GameText => ({
  title, start: g.start, again: g.again, mindsOn: g.mindsOn, mindsOff: g.mindsOff,
});

/** The words of the werewolf page; `seats` pets sit with a user who plays, `watchSeats` when he only watches. */
export function wolfText(g: GameWords, seats: number, watchSeats: number): GameText {
  const w = g.werewolf;
  return {
    ...lobbyText(g, g.werewolfTitle), rules: w.rules,
    modePlay: w.modePlay, modeWatch: w.modeWatch, pickPlay: w.pickPlay(seats), pickWatch: w.pickWatch(watchSeats),
    watching: w.watching, out: w.out, sheriff: w.sheriff, flipped: w.flipped, thinking: w.thinking, waiting: w.waiting,
    abstain: w.abstain, saveHim: w.saveHim('{name}'), poisonHint: w.poisonHint, noPotion: w.noPotion,
    noSelfSave: w.noSelfSave, sendHint: w.sendHint, send: w.send, pass: w.pass, runYes: w.runYes, runNo: w.runNo,
    noShot: w.noShot, tearBadge: w.tearBadge, boomButton: w.boomButton, boomSure: w.boomSure,
    phase_night: w.phase.night, phase_sheriff: w.phase.sheriff, phase_talk: w.phase.talk, phase_vote: w.phase.vote,
    phase_over: w.phase.over,
  };
}

/** How the game ended, as one line. */
export const winLine = (why: WinReason, w: WolfWords): string =>
  why === 'wolves' ? w.winVillage : why === 'gods' ? w.winGods : w.winVillagers;

/**
 * What the page shows for one thing that happened. `me` is the user's seat; null for a spectator, who is told the same
 * things about the others in the third person, and the roles in one line at the start.
 */
export function entryLines(e: Entry, w: WolfWords, name: (seat: number) => string, me: number | null): WolfLine[] {
  const sys = (text: string): WolfLine => ({ tone: 'sys', seat: null, text });
  const secret = (text: string): WolfLine => ({ tone: 'secret', seat: null, text });
  const vote = (text: string): WolfLine => ({ tone: 'vote', seat: null, text });
  const names = (seats: readonly number[]): string => w.join(seats.map(name));
  const spectator = me === null;
  switch (e.kind) {
    case 'start': return spectator ? [] : [secret(`${w.youAre(w.role[e.role])} ${w.roleHint[e.role]}`)];
    case 'wolves': {
      const mates = e.seats.filter((s) => s !== me);
      return spectator || mates.length === 0 ? [] : [secret(w.wolves(names(mates)))];
    }
    case 'night': return [sys(w.night(e.day))];
    case 'wolfPick': return [secret(w.wolfPick(name(e.seat), name(e.target)))];
    case 'wolfKill': return [secret(w.wolfKill(name(e.target)))];
    case 'check':
      return [secret(spectator ? w.seerCheck(name(e.seat), name(e.target), e.wolf) : w.check(name(e.target), e.wolf))];
    case 'witchInfo': return spectator ? [] : [secret(w.witchInfo(e.victim === null ? null : name(e.victim)))];
    case 'witchDid': {
      const saved = e.saved === null ? null : name(e.saved);
      const poisoned = e.poisoned === null ? null : name(e.poisoned);
      return [secret(spectator ? w.witchActs(name(e.seat), saved, poisoned) : w.witchDid(saved, poisoned))];
    }
    case 'dawn': return [sys(e.died.length === 0 ? w.dawnNone : w.dawn(names(e.died)))];
    case 'say': {
      const text = e.talk === 'day' ? e.text : `(${w.talk[e.talk]}) ${e.text}`;
      return [{ tone: 'say', seat: e.seat, text }];
    }
    case 'runners': return [sys(e.seats.length === 0 ? w.noRunners : w.runners(names(e.seats)))];
    case 'votes': {
      const lines = [vote(w.voteHead(e.why, e.round))];
      for (const b of e.ballots) lines.push(vote(w.ballot(name(b.target), names(b.voters), b.total)));
      if (e.abstained.length > 0) lines.push(vote(w.abstained(names(e.abstained))));
      if (e.tied.length > 0 && e.round === 1) lines.push(sys(w.tie(names(e.tied))));
      else if (e.why === 'exile') lines.push(sys(e.out === null ? w.noExile : w.exiled(name(e.out))));
      return lines;
    }
    case 'sheriff':
      return [sys(e.cancelled ? w.sheriffOff : e.seat === null ? w.noSheriff : w.sheriffIs(name(e.seat)))];
    case 'badge': return [sys(e.to === null ? w.badgeTear(name(e.from)) : w.badgePass(name(e.from), name(e.to)))];
    case 'flip': return [sys(w.flip(name(e.seat)))];
    case 'boom': return [sys(w.boomed(name(e.seat)))];
    case 'shot': return [sys(w.shot(name(e.hunter), name(e.target)))];
    case 'over': return [sys(winLine(e.why, w))];
  }
}

/** The question put to the user, with the seats it may be answered with. */
export function wolfAsk(
  game: WerewolfGame, seat: number, q: Question, w: WolfWords, name: (seat: number) => string,
): WolfAsk {
  const options = game.options(seat, q);
  const plain = (kind: WolfAsk['kind'], title: string): WolfAsk =>
    ({ kind, title, options, save: false, poison: false, victim: null });
  switch (q.kind) {
    case 'kill': return plain('kill', w.askKill);
    case 'check': return plain('check', w.askCheck);
    case 'witch': return {
      kind: 'witch', title: w.askWitch(q.victim === null ? null : name(q.victim)), options: q.poison ? options : [],
      save: q.save && q.victim !== null, poison: q.poison, victim: q.victim,
    };
    case 'run': return plain('run', w.askRun);
    case 'speak': return plain('speak', w.askSpeak[q.talk]);
    case 'vote': {
      const title = q.why === 'sheriff' ? w.askVote.sheriff : q.among !== null ? w.askVote.again : w.askVote.exile;
      return plain('vote', title);
    }
    case 'shoot': return plain('shoot', w.askShoot);
    case 'badge': return plain('badge', w.askBadge);
  }
}

/** Who was who, at the end. */
export function rolesLine(game: WerewolfGame, w: WolfWords, name: (seat: number) => string): string {
  return w.reveal(game.players.map((p) => `${p.seat}. ${name(p.seat)} ${w.role[p.role]}`).join(' / '));
}

export const roleName = (role: Role | null, w: WolfWords): string | null => (role === null ? null : w.role[role]);

/** What the user's message answers, if it answers the question being asked. */
export function wolfAnswer(q: Question, m: WolfIn): Answer | null {
  switch (q.kind) {
    case 'kill':
    case 'check': return m.t === 'target' ? { kind: 'target', seat: m.seat } : null;
    case 'vote': return m.t === 'vote' ? { kind: 'vote', seat: m.seat } : null;
    case 'speak': return m.t === 'say' ? { kind: 'text', text: m.text } : null;
    case 'witch': return m.t === 'witch' ? { kind: 'witch', save: m.save, poison: m.poison } : null;
    case 'run': return m.t === 'run' ? { kind: 'run', run: m.run } : null;
    case 'shoot':
    case 'badge': return m.t === 'pick' ? { kind: 'pick', seat: m.seat } : null;
  }
}

/** The stock words of a computer player that has no mind to ask. */
export function phrasesOf(w: WolfWords, random: () => number): Phrases {
  const pick = (lines: readonly string[]): string =>
    lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))] ?? '';
  return {
    accuse: (name) => pick(w.accuse(name)),
    trust: (name) => pick(w.trust(name)),
    innocent: () => pick(w.innocent),
    quiet: () => pick(w.quiet),
    defend: () => pick(w.defend),
    campaign: () => pick(w.campaign),
    claimSeer: (checks) =>
      pick(w.claimSeer(w.join(checks.map((c) => (c.wolf ? w.checkWolf(c.name) : w.checkGood(c.name)))))),
    claimWitch: (saved) => pick(w.claimWitch(saved)),
    claimHunter: () => pick(w.claimHunter),
    claimIdiot: () => pick(w.claimIdiot),
    last: (suspect) => pick(w.last(suspect)),
    join: (parts) => w.sentences([...parts]),
  };
}
