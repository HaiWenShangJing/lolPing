import { PET_COLORS, PET_IDS, type PetId } from '../../shared/teammate/pet';
import type { SgsAsk, SgsIn, SgsOut, SgsSeat, SgsTone } from '../../shared/gameIpc';
import { fillSeats, lobbyChoices } from '../../shared/teammate/gameText';
import type { Engine } from '../../shared/teammate/sanguosha';
import { Bots } from '../../shared/teammate/sanguoshaAi';
import { shuffle } from '../../shared/teammate/sanguoshaCards';
import { runSanguosha } from '../../shared/teammate/sanguoshaRun';
import { ROLE_SETS, SIZES, Stopped, sideOf } from '../../shared/teammate/sanguoshaTypes';
import type { Ask, Deps, Entry, Reply, Role, Size } from '../../shared/teammate/sanguoshaTypes';
import {
  askTitle, chatter, entryLines, moods, overText, sanguoshaText, type Voice,
} from '../../shared/teammate/sanguoshaText';
import { cardView, heroInfo, tableView } from '../../shared/teammate/sanguoshaView';
import type { GameServices } from './gameServices';

const USER_COLOR = '#4a90e2';
/** The user always sits in seat 0. */
const ME = 0;
/** How likely a pet is to say something when something happens to it. */
const CHATTER = 0.3;

/** How long the table lingers on each kind of entry, in milliseconds, so the user can follow the play. */
const PACE: Partial<Record<Entry['k'], number>> = {
  start: 400, hero: 200, turn: 450, use: 650, play: 450, skill: 450, damage: 550, lose: 450, heal: 400, discard: 350,
  take: 450, give: 450, equip: 400, judge: 450, armor: 300, cancel: 350, skip: 300, die: 900, shuffle: 200,
};

/** The pause after `entry`: short for the user's own moves, which he has just made, and once he is out of the game. */
export function pace(entry: Entry, userAlive: boolean): number {
  const own = 'seat' in entry && entry.seat === ME ? 0.4 : 1;
  return Math.round((PACE[entry.k] ?? 0) * own * (userAlive ? 1 : 0.4));
}

/** Whether `reply` answers `ask`; a play is answered by a card, a skill or the end of the turn. */
export const fits = (ask: Ask, reply: Reply): boolean =>
  ask.k === 'play' ? reply.k === 'use' || reply.k === 'skill' || reply.k === 'end' : ask.k === reply.k;

/** The question as the page is shown it: the cards by what they are, and the words for it. */
export function askView(ask: Ask, e: Engine, title: string): SgsAsk {
  const cards = (ids: readonly number[]) => ids.flatMap((id) => {
    const card = e.card(id);
    return card ? [cardView(card)] : [];
  });
  switch (ask.k) {
    case 'hero': return { k: 'hero', title, heroes: ask.heroes.map((h) => heroInfo(h, ask.lord)) };
    case 'play': return { k: 'play', title, uses: ask.uses, skills: ask.skills };
    case 'cards': return { k: 'cards', title, why: ask.why, cards: cards(ask.cards), min: ask.min, max: ask.max };
    case 'area': {
      const judges = e.p(ask.owner).judges
        .filter((j) => ask.judges.includes(j.card.id))
        .map((j) => ({ as: j.as, card: cardView(j.card) }));
      return { k: 'area', title, owner: ask.owner, hand: ask.hand, equip: cards(ask.equip), judges };
    }
    case 'seat': return { k: 'seat', title, options: ask.options, min: ask.min, max: ask.max };
    case 'confirm': return { k: 'confirm', title };
  }
}

interface Run {
  stopped: boolean;
  pending: { ask: Ask; view: SgsAsk; resolve: (reply: Reply | null) => void } | null;
  waits: Set<() => void>;
}

/**
 * A game of Sanguosha in its window: the lobby, then a table of five or eight with the user in seat 0 and pets in the
 * rest, until a side has won. The page is shown what a player at the table can see; what it sends back answers the
 * question the table is waiting on.
 */
export class SanguoshaRoom {
  private run: Run | null = null;

  constructor(private readonly s: GameServices, private readonly post: (msg: SgsOut) => void) {}

  lobby(): void {
    this.stop();
    const { g, names } = this.s.words();
    const pets = Math.min((SIZES[SIZES.length - 1] ?? 8) - 1, PET_IDS.length);
    this.post({
      kind: 'lobby', text: sanguoshaText(g), choices: lobbyChoices(this.s.petsOn(), names), seats: pets,
      watchSeats: pets, minds: false, sizes: [...SIZES],
    });
  }

  on(msg: SgsIn): void {
    switch (msg.t) {
      case 'again':
        this.lobby();
        return;
      case 'start':
        if (!this.run) this.begin(msg.pets, msg.size);
        return;
      case 'reply': {
        const pending = this.run?.pending;
        if (!this.run || !pending) return;
        if (!fits(pending.ask, msg.reply)) {
          // The page has put its question away, so it is put to it again.
          this.post({ kind: 'ask', ask: pending.view });
          return;
        }
        this.run.pending = null;
        this.post({ kind: 'ask', ask: null });
        pending.resolve(msg.reply);
      }
    }
  }

  /** Ends the game under way, if any: the window was closed or another game begins. */
  stop(): void {
    const run = this.run;
    this.run = null;
    if (!run) return;
    run.stopped = true;
    run.pending?.resolve(null);
    run.pending = null;
    for (const release of [...run.waits]) release();
  }

  private begin(picks: readonly PetId[], size: Size): void {
    const { g, names } = this.s.words();
    const w = g.sanguosha;
    const random = (): number => this.s.random();
    const pets = fillSeats(picks, size - 1, random);
    // Fewer pets than seats can't happen with the pets there are; the lobby stays rather than a short table.
    if (pets.length !== size - 1) return;
    const ids: ('user' | PetId)[] = ['user', ...pets];
    const roles = shuffle([...ROLE_SETS[size]], random);
    const run: Run = { stopped: false, pending: null, waits: new Set() };
    this.run = run;
    const bots = new Bots(roles, random);

    const pet = (seat: number): PetId | null => {
      const id = ids[seat];
      return id === undefined || id === 'user' ? null : id;
    };
    const who = (seat: number): string => {
      const id = pet(seat);
      return id === null ? g.you : names[id];
    };
    const voice: Voice = { who, whom: (seat) => (pet(seat) === null ? g.youLower : who(seat)) };
    const mineRole = roles[ME] as Role;

    const state = (e: Engine): void => {
      const t = tableView(e, ME);
      const seats: SgsSeat[] = t.seats.map((v) => {
        const id = pet(v.seat);
        return {
          ...v, id: id ?? 'user', name: who(v.seat), color: id === null ? USER_COLOR : PET_COLORS[id], me: v.seat === ME,
        };
      });
      this.post({ kind: 'state', seats, hand: t.hand, pile: t.pile, turn: t.turn, phase: t.phase, turns: t.turns });
    };
    const line = (tone: SgsTone, seat: number | null, text: string): void => {
      this.post({ kind: 'line', tone, seat, text });
    };
    const wait = (ms: number): Promise<void> => new Promise<void>((resolve) => {
      let cancel: () => void = () => undefined;
      const release = (): void => {
        cancel();
        run.waits.delete(release);
        resolve();
      };
      run.waits.add(release);
      cancel = this.s.after(ms, release);
    });
    /** A pet may say something about what has just happened to it or by it; at the end one of each side does. */
    const speak = (entry: Entry, e: Engine): void => {
      if (entry.k === 'end') {
        if (entry.winner === null) return;
        for (const [wins, mood] of [[true, 'win'], [false, 'lose']] as const) {
          const seat = roles.findIndex((role, i) => pet(i) !== null && (sideOf(role) === entry.winner) === wins);
          if (seat >= 0) line('say', seat, chatter(mood, w, random));
        }
        return;
      }
      for (const { seat, mood } of moods(entry)) {
        const gone = !e.p(seat).alive && mood !== 'fall';
        if (pet(seat) === null || gone || random() >= CHATTER) continue;
        line('say', seat, chatter(mood, w, random));
        return;
      }
    };

    const emit = async (entry: Entry, e: Engine): Promise<void> => {
      if (run.stopped) return;
      bots.observe(entry, e);
      state(e);
      if (entry.k === 'start') {
        line('secret', null, w.youAre(w.role[mineRole]));
        line('secret', null, w.roleHint[mineRole]);
      }
      for (const l of entryLines(entry, w, voice, ME, e.turns)) line(l.tone, l.seat, l.text);
      speak(entry, e);
      if (entry.k === 'end') {
        const seats = ids.map((_, seat) => ({ name: who(seat), role: roles[seat] as Role }));
        const over = overText(entry.winner, mineRole, seats, w);
        this.post({ kind: 'over', win: over.win, winner: entry.winner, title: over.title, text: over.text });
        return;
      }
      const ms = pace(entry, e.p(ME).alive);
      if (ms > 0) await wait(ms);
    };

    const ask = (seat: number, question: Ask, e: Engine): Promise<Reply | null> => {
      if (seat !== ME) return Promise.resolve(bots.answer(seat, question, e));
      state(e);
      const view = askView(question, e, askTitle(question, w, voice, ME));
      this.post({ kind: 'ask', ask: view });
      return new Promise<Reply | null>((resolve) => {
        run.pending = { ask: question, view, resolve };
      });
    };

    const deps: Deps = { random, ask, emit, stopped: () => run.stopped };
    runSanguosha(deps, roles).catch((err: unknown) => {
      if (!(err instanceof Stopped) && !run.stopped) {
        line('sys', null, String(err instanceof Error ? err.message : err).slice(0, 200));
      }
    });
  }
}
