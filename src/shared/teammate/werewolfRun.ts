/**
 * Plays a game of werewolf through `WerewolfGame` from the first night to the last: the night's choices, the dawn,
 * the deaths and what follows from each (last words, the hunter's shot, the badge), the sheriff's election, the day's
 * talk and the exile vote. The players are asked in turn: the user through `human`, a computer player through `ai`
 * (and on null, through its own simple play). Everything the user may see is `emit`ted for the window. Nothing here
 * knows about Electron.
 */

import {
  plurality, SEATS, type Answer, type Entry, type Question, type Role, type Side, type Talk, type WerewolfGame,
  type Who, type WinReason,
} from './werewolf';
import type { Mind } from './werewolfMind';
import { fallbackAnswer, wantsBoom, type Phrases } from './werewolfPlay';

export type Phase = 'night' | 'sheriff' | 'talk' | 'vote' | 'over';

/** One player as the window may show it: `role` is null while the user may not know it. */
export interface SeatView {
  seat: number;
  who: Who;
  alive: boolean;
  role: Role | null;
  sheriff: boolean;
  flipped: boolean;
}

export type RunEvent =
  /** `boom`: the user is a living wolf and may blow himself up now. */
  | { kind: 'state'; day: number; phase: Phase; players: SeatView[]; boom: boolean }
  | { kind: 'entry'; entry: Entry }
  | { kind: 'thinking'; seats: number[] }
  | { kind: 'ask'; seat: number; question: Question; options: number[] }
  /** The question put to the user is closed: answered, or cut short. */
  | { kind: 'unask' }
  | { kind: 'over'; winner: Side; why: WinReason };

/** The user ended the game (closed its window): everything under way stops. */
export class Stopped extends Error {}

/** A wolf blows itself up: the day is cut short. `seat` is null for the user's own button. */
export class Boomed extends Error {
  constructor(readonly seat: number | null = null) {
    super('A wolf self-destructs.');
  }
}

/** The user's self-destruct button: live only for a living wolf in the day, and read at the next pause or question. */
export class BoomButton {
  private live = false;
  private down = false;
  private hooks = new Set<() => void>();

  get armed(): boolean {
    return this.live;
  }

  arm(live: boolean): void {
    this.live = live;
    if (!live) this.down = false;
  }

  /** The user presses it; false when it is not live. */
  press(): boolean {
    if (!this.live || this.down) return false;
    this.down = true;
    for (const hook of this.hooks) hook();
    return true;
  }

  /** Whether it was pressed since it was last looked at; looking clears it. */
  take(): boolean {
    const was = this.down;
    this.down = false;
    return was;
  }

  /** The result of `work`, or `Boomed` if the button is pressed before it is done. */
  async during<T>(work: Promise<T>): Promise<T> {
    if (!this.live) return work;
    let hook = (): void => undefined;
    const pressed = new Promise<never>((_, reject) => {
      hook = () => reject(new Boomed());
      if (this.down) hook();
      else this.hooks.add(hook);
    });
    try {
      return await Promise.race([work, pressed]);
    } finally {
      this.hooks.delete(hook);
    }
  }
}

export interface RunDeps {
  game: WerewolfGame;
  /** A computer player's reply to `q`; null when it has none and its own simple play answers. */
  ai: Mind;
  /** The user's answer; null when the window was closed. */
  human: (seat: number, q: Question) => Promise<Answer | null>;
  emit: (e: RunEvent) => void;
  wait: (ms: number) => Promise<void>;
  random: () => number;
  phrases: Phrases;
  nameOf: (seat: number) => string;
  /** True once the game was ended from outside. */
  stopped: () => boolean;
  /** Whether the computer players think with minds, which take their own time: the pauses are shorter. */
  minds: boolean;
  boom: BoomButton;
}

/** Pauses in ms, so that what is said and done can be followed: between players' lines, and between steps. */
export const SAY_PAUSE_MS: readonly [number, number] = [600, 1200];
export const MIND_PAUSE_MS: readonly [number, number] = [250, 600];
export const STEP_MS = 800;
const FIRST_MS = 1500;

/** The game from the first night to the last; resolves with the side that won. */
export async function runGame(d: RunDeps): Promise<Side> {
  const { game } = d;
  const user = game.seatOfUser();
  const userWolf = user !== null && game.player(user).role === 'wolf';
  let phase: Phase = 'night';
  let ended = false;
  let electing = false;
  let flushed = 0;
  let unseen = false;
  let shown = '';
  // Nobody blows up while the dead have their say: it would cut short the shot and the badge that follow.
  let settling = false;
  const thinking = new Set<number>();

  const check = (): void => {
    if (d.stopped()) throw new Stopped();
  };

  /** A seat's role as the user may know it: his own, his pack's, a revealed one; all of them for a spectator. */
  const views = (): SeatView[] => game.players.map((p) => ({
    seat: p.seat, who: p.who, alive: p.alive, sheriff: game.sheriff === p.seat, flipped: p.flipped,
    role: user === null || ended || p.seat === user || p.flipped || p.boomed || (userWolf && p.role === 'wolf')
      ? p.role
      : null,
  }));

  /** Tells the window the table as it stands, when that has changed. */
  const refresh = (): void => {
    const me = user === null ? null : game.player(user);
    const day = phase === 'sheriff' || phase === 'talk' || phase === 'vote';
    const boom = !settling && me !== null && me.alive && me.role === 'wolf' && day;
    d.boom.arm(boom);
    const players = views();
    const key = JSON.stringify([phase, game.day, boom, players]);
    if (key === shown) return;
    shown = key;
    d.emit({ kind: 'state', day: game.day, phase, players, boom });
  };

  const setPhase = (p: Phase): void => {
    phase = p;
    refresh();
  };

  /** Sends what happened since last time that the user may read. */
  const flush = (): void => {
    for (; flushed < game.log.length; flushed++) {
      const l = game.log[flushed];
      if (l && (user === null || ended || l.to === 'all' || l.to.includes(user))) {
        d.emit({ kind: 'entry', entry: l.entry });
        unseen = true;
      }
    }
    refresh();
  };

  /** A moment to read what was just shown, when something was. */
  const beat = async (ms = STEP_MS): Promise<void> => {
    if (!unseen) return;
    unseen = false;
    check();
    await d.wait(ms);
    check();
  };

  const range = d.minds ? MIND_PAUSE_MS : SAY_PAUSE_MS;
  const saying = (): number => range[0] + Math.floor(d.random() * (range[1] - range[0] + 1));

  /** Whether `a` answers `q` legally; the user's speech may be empty (a pass), a computer player's may not. */
  const legal = (seat: number, q: Question, a: Answer | null, human: boolean): Answer | null => {
    if (a === null) return null;
    const options = game.options(seat, q);
    switch (q.kind) {
      case 'kill':
      case 'check': return a.kind === 'target' && options.includes(a.seat) ? a : null;
      case 'witch': {
        if (a.kind !== 'witch' || (a.save && !q.save)) return null;
        return a.poison === null || (q.poison && options.includes(a.poison)) ? a : null;
      }
      case 'run': return a.kind === 'run' ? a : null;
      case 'speak': return a.kind === 'text' && (human || a.text.trim() !== '') ? a : null;
      case 'vote': return a.kind === 'vote' && (a.seat === null || options.includes(a.seat)) ? a : null;
      case 'shoot':
      case 'badge': return a.kind === 'pick' && (a.seat === null || options.includes(a.seat)) ? a : null;
    }
  };

  const simple = (seat: number, q: Question): Answer =>
    fallbackAnswer(game, seat, q, d.random, d.phrases, d.nameOf);

  const person = async (seat: number, q: Question): Promise<Answer> => {
    d.emit({ kind: 'ask', seat, question: q, options: game.options(seat, q) });
    try {
      const a = await d.boom.during(d.human(seat, q));
      check();
      if (a === null) throw new Stopped();
      return legal(seat, q, a, true) ?? simple(seat, q);
    } finally {
      d.emit({ kind: 'unask' });
    }
  };

  const bot = async (seat: number, q: Question): Promise<Answer> => {
    // Only what takes a while is shown as thought about: speeches, and with minds every question put to one. A night
    // move is not, to a user who plays: who is thinking at night would tell him the wolves, the seer and the witch.
    const night = q.kind === 'kill' || q.kind === 'check' || q.kind === 'witch';
    const slow = (q.kind === 'speak' || (d.minds && q.kind !== 'run' && q.kind !== 'vote')) &&
      (user === null || !night);
    if (slow) {
      thinking.add(seat);
      d.emit({ kind: 'thinking', seats: [...thinking] });
    }
    try {
      const mind = (async (): Promise<Answer | null> => {
        try {
          return await d.ai(seat, q);
        } catch (err) {
          if (err instanceof Stopped) throw err;
          return null;
        }
      })();
      const pause = q.kind === 'speak' ? d.wait(saying()) : Promise.resolve();
      const [a] = await d.boom.during(Promise.all([mind, pause]));
      check();
      return legal(seat, q, a, false) ?? simple(seat, q);
    } finally {
      if (thinking.delete(seat)) d.emit({ kind: 'thinking', seats: [...thinking] });
    }
  };

  const answer = async (seat: number, q: Question): Promise<Answer> => {
    check();
    if (d.boom.take()) throw new Boomed();
    return game.player(seat).who === 'user' ? person(seat, q) : bot(seat, q);
  };

  const target = async (seat: number, q: Question): Promise<number> => {
    const a = await answer(seat, q);
    return a.kind === 'target' ? a.seat : seat;
  };

  /** Before someone speaks and before a vote, a computer wolf may blow itself up, or the user press his button. */
  const maybeBoom = (when: 'campaign' | 'talk' | 'vote'): void => {
    check();
    if (d.boom.take()) throw new Boomed();
    for (const w of game.wolves()) {
      if (w.who !== 'user' && wantsBoom(game, w.seat, when, d.random)) throw new Boomed(w.seat);
    }
  };

  const speak = async (seat: number, talk: Talk): Promise<void> => {
    const a = await answer(seat, { kind: 'speak', talk });
    if (a.kind === 'text') game.say(seat, talk, a.text, a.meaning);
    flush();
    unseen = false;
  };

  const collect = async (why: 'sheriff' | 'exile', among: number[] | null, seats: readonly number[]) => {
    const votes: { seat: number; target: number | null }[] = [];
    for (const seat of seats) {
      const a = await answer(seat, { kind: 'vote', why, among });
      votes.push({ seat, target: a.kind === 'vote' ? a.seat : null });
    }
    return votes;
  };

  const shoot = async (hunter: number): Promise<void> => {
    if (game.options(hunter, { kind: 'shoot' }).length === 0) return;
    const a = await answer(hunter, { kind: 'shoot' });
    if (a.kind !== 'pick' || a.seat === null) return;
    game.shoot(hunter, a.seat);
    flush();
    await beat();
  };

  const badge = async (from: number): Promise<void> => {
    const a = game.options(from, { kind: 'badge' }).length === 0 ? null : await answer(from, { kind: 'badge' });
    game.passBadge(from, a?.kind === 'pick' ? a.seat : null);
    flush();
    await beat();
  };

  /** Settles the deaths one by one: the win is looked at first; else last words, the hunter's shot, the badge. */
  const settle = async (): Promise<boolean> => {
    settling = true;
    try {
      for (let death = game.nextDeath(); death !== null; death = game.nextDeath()) {
        refresh();
        if (game.winner() !== null) return true;
        if (game.hasLastWords(death)) await speak(death.seat, 'last');
        if (game.mayShoot(death)) {
          await shoot(death.seat);
          if (game.winner() !== null) return true;
        }
        if (game.sheriff === death.seat) await badge(death.seat);
      }
      return game.winner() !== null;
    } finally {
      settling = false;
    }
  };

  const night = async (): Promise<void> => {
    game.startNight();
    setPhase('night');
    flush();
    await beat(game.day === 1 ? FIRST_MS : STEP_MS);

    // The computer wolves propose in turn, each told what its partners proposed; a user wolf has the last word.
    const wolves = game.wolves();
    const pack = wolves.map((w) => w.seat);
    const proposals: number[] = [];
    for (const w of wolves) {
      if (w.who === 'user') continue;
      const t = await target(w.seat, { kind: 'kill' });
      proposals.push(t);
      game.record(pack.filter((s) => s !== w.seat), { kind: 'wolfPick', seat: w.seat, target: t });
      flush();
      await beat();
    }
    const human = wolves.find((w) => w.who === 'user');
    const kill = human
      ? await target(human.seat, { kind: 'kill' })
      : (plurality(proposals, d.random) ?? game.alive()[0]?.seat ?? 1);
    game.record(pack, { kind: 'wolfKill', target: kill });
    flush();
    await beat();

    const seer = game.alive().find((p) => p.role === 'seer');
    if (seer && game.options(seer.seat, { kind: 'check' }).length > 0) {
      const t = await target(seer.seat, { kind: 'check' });
      game.record([seer.seat], { kind: 'check', seat: seer.seat, target: t, wolf: game.player(t).role === 'wolf' });
      flush();
      await beat();
    }

    let saved = false;
    let poisoned: number | null = null;
    const witch = game.alive().find((p) => p.role === 'witch');
    if (witch && (game.antidote || game.poison)) {
      const q = game.witchQuestion(kill);
      game.record([witch.seat], {
        kind: 'witchInfo', seat: witch.seat, victim: q.victim, save: q.save, poison: q.poison,
      });
      flush();
      const a = q.save || q.poison ? await answer(witch.seat, q) : null;
      if (a?.kind === 'witch') {
        if (a.save) {
          saved = true;
          game.antidote = false;
        } else if (a.poison !== null) {
          poisoned = a.poison;
          game.poison = false;
        }
      }
      game.record([witch.seat], { kind: 'witchDid', seat: witch.seat, saved: saved ? kill : null, poisoned });
      flush();
      await beat();
    }

    game.endNight({ kill, saved, poisoned });
    flush();
    await beat();
  };

  /** The first day's election: who runs, what they say, and the vote of those who do not. */
  const election = async (): Promise<void> => {
    electing = true;
    setPhase('sheriff');
    const runners: number[] = [];
    for (const p of game.alive()) {
      const a = await answer(p.seat, { kind: 'run' });
      if (a.kind === 'run' && a.run) runners.push(p.seat);
    }
    game.record('all', { kind: 'runners', seats: runners });
    flush();
    await beat();

    let winner: number | null = runners.length === 1 ? (runners[0] ?? null) : null;
    const voters = game.voters().filter((s) => !runners.includes(s));
    if (runners.length > 1 && voters.length > 0) {
      let among = runners;
      for (const round of [1, 2] as const) {
        for (const seat of among) {
          maybeBoom('campaign');
          await speak(seat, round === 1 ? 'campaign' : 'pk');
        }
        maybeBoom('vote');
        const t = game.tally('sheriff', round, await collect('sheriff', among, voters));
        flush();
        await beat();
        winner = t.out;
        if (t.out !== null || t.tied.length < 2) break;
        among = t.tied;
      }
    }
    electing = false;
    game.elect(winner);
    flush();
    await beat();
  };

  const talk = async (): Promise<void> => {
    setPhase('talk');
    for (const seat of game.talkOrder(game.sheriff ?? 0)) {
      maybeBoom('talk');
      await speak(seat, 'day');
    }
  };

  /** The exile vote; a tie sends the tied to speak again and the others to vote once more among them. */
  const exileVote = async (): Promise<void> => {
    setPhase('vote');
    maybeBoom('vote');
    const voters = game.voters();
    let tally = game.tally('exile', 1, await collect('exile', null, voters));
    flush();
    await beat();
    if (tally.out === null && tally.tied.length > 1) {
      const tied = tally.tied;
      for (const seat of tied) {
        maybeBoom('talk');
        await speak(seat, 'pk');
      }
      maybeBoom('vote');
      tally = game.tally('exile', 2, await collect('exile', tied, voters.filter((s) => !tied.includes(s))));
      flush();
      await beat();
    }
    if (tally.out !== null) {
      game.exile(tally.out);
      flush();
      await beat();
    }
    await settle();
  };

  /** A wolf blew itself up: it is out, the election if there was one is off, and the day ends without a vote. */
  const explode = async (seat: number | null): Promise<void> => {
    if (seat === null) throw new Error('No wolf blew itself up.');
    d.boom.take();
    if (electing) {
      electing = false;
      game.elect(null, true);
    }
    game.boom(seat);
    setPhase('night');
    flush();
    await beat();
    await settle();
  };

  const day = async (): Promise<void> => {
    try {
      if (game.day === 1) await election();
      await talk();
      await exileVote();
    } catch (err) {
      if (!(err instanceof Boomed)) throw err;
      await explode(err.seat ?? user);
    }
  };

  flush();
  setPhase('night');
  while (true) {
    if (game.day > SEATS * 2) throw new Error('The game does not end.');
    await night();
    if (await settle()) break;
    await day();
    if (game.winner() !== null) break;
  }

  const winner = game.winner();
  const why = game.reason();
  if (winner === null || why === null) throw new Error('The game ended without a winner.');
  ended = true;
  setPhase('over');
  flush();
  d.emit({ kind: 'over', winner, why });
  return winner;
}
