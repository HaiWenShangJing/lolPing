import type { DdzAsk, DdzIn, DdzOut, DdzPhase, DdzSeat, DdzShown, DdzTone } from '../../shared/gameIpc';
import type { Table } from '../../shared/teammate/doudizhu';
import { botBid, botPlay, hintList } from '../../shared/teammate/doudizhuAi';
import { checkPlay, isBomb } from '../../shared/teammate/doudizhuCards';
import { makeDdzMind } from '../../shared/teammate/doudizhuMind';
import { runDoudizhu } from '../../shared/teammate/doudizhuRun';
import {
  askTitle, chatter, doudizhuText, entryLines, moods, overText, playLabel,
} from '../../shared/teammate/doudizhuText';
import { SIZES, Stopped } from '../../shared/teammate/doudizhuTypes';
import type { Ask, Deps, Entry, Reply, Result, Size } from '../../shared/teammate/doudizhuTypes';
import { viewFor, type TableView } from '../../shared/teammate/doudizhuView';
import { fillSeats, lobbyChoices } from '../../shared/teammate/gameText';
import { PET_COLORS, PET_IDS, type PetId } from '../../shared/teammate/pet';
import type { GameBrain } from './gameBrain';
import type { GameServices } from './gameServices';

const USER_COLOR = '#4a90e2';
/** The user always sits in seat 0. */
const ME = 0;
/** How likely a pet is to say something when something happens to it. */
const CHATTER = 0.3;

/** How long the table lingers on each kind of entry, in milliseconds, so the user can follow the play. */
const PACE: Partial<Record<Entry['k'], number>> = {
  start: 400, deal: 700, redeal: 500, bid: 550, landlord: 900, call: 1100, play: 700, pass: 350, reveal: 900,
};
/** A bomb lingers a little longer than a play. */
const BOMB_PACE = 1000;

/** The pause after `entry`: short for the user's own moves, which he has just made. */
export function pace(entry: Entry): number {
  const own = 'seat' in entry && entry.seat === ME ? 0.4 : 1;
  const ms = entry.k === 'play' && isBomb(entry.play.combo) ? BOMB_PACE : (PACE[entry.k] ?? 0);
  return Math.round(ms * own);
}

/** Whether `reply` answers `ask`: a bid in range or none, a play that is legal, or a pass where passing is allowed. */
export function fits(ask: Ask, reply: Reply, view: TableView): boolean {
  if (ask.k === 'bid') {
    return reply.k === 'bid' && Number.isInteger(reply.bid)
      && (reply.bid === 0 || (reply.bid >= ask.min && reply.bid <= ask.max));
  }
  if (reply.k !== 'play') return false;
  if (reply.ids.length === 0) return !ask.lead;
  return checkPlay(view.hand, reply.ids, view.top?.combo ?? null, view.decks) !== null;
}

/** The question as the page is shown it, with the words for it. */
export const askView = (ask: Ask, title: string): DdzAsk =>
  ask.k === 'bid' ? { k: 'bid', title, min: ask.min, max: ask.max } : { k: 'play', title, lead: ask.lead };

interface Pending {
  ask: Ask;
  /** What the user sees, kept for as long as he is asked: the table does not move until he answers. */
  view: TableView;
  shown: DdzAsk;
  resolve: (reply: Reply | null) => void;
  /** The plays offered as hints, made when the first is asked for, and which one comes next. */
  hints: number[][] | null;
  next: number;
}

interface Run {
  brain: GameBrain | null;
  stopped: boolean;
  pending: Pending | null;
  waits: Set<() => void>;
}

/**
 * A game of Dou Dizhu in its window: the lobby, then a table of three to six with the user in seat 0 and pets in the
 * rest, until a hand is empty. The page is shown what a player at the table can see; what it sends back answers the
 * question the table is waiting on, and may ask whether the cards it has picked make a play, or for a hint. A pet
 * thinks with Copilot CLI when it is set up, and plays by the rules of its own whenever its mind has nothing legal to say.
 */
export class DoudizhuRoom {
  private run: Run | null = null;

  constructor(private readonly s: GameServices, private readonly post: (msg: DdzOut) => void) {}

  lobby(): void {
    this.stop();
    const { g, names } = this.s.words();
    const pets = Math.min((SIZES[SIZES.length - 1] ?? 6) - 1, PET_IDS.length);
    this.post({
      kind: 'lobby', text: doudizhuText(g), choices: lobbyChoices(this.s.petsOn(), names), seats: pets,
      watchSeats: pets, minds: this.s.canThink(), sizes: [...SIZES],
    });
  }

  on(msg: DdzIn): void {
    switch (msg.t) {
      case 'again':
        this.lobby();
        return;
      case 'start':
        if (!this.run) this.begin(msg.pets, msg.size);
        return;
      case 'bid':
        this.answer({ k: 'bid', bid: msg.bid });
        return;
      case 'play':
        this.answer({ k: 'play', ids: msg.ids });
        return;
      case 'check':
        this.check(msg.ids);
        return;
      case 'hint':
        this.hint();
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
    run.brain?.close();
  }

  private answer(reply: Reply): void {
    const pending = this.run?.pending;
    if (!this.run || !pending) return;
    if (!fits(pending.ask, reply, pending.view)) {
      // The page has put its question away, so it is put to it again.
      this.post({ kind: 'ask', ask: pending.shown });
      return;
    }
    this.run.pending = null;
    this.post({ kind: 'ask', ask: null });
    pending.resolve(reply);
  }

  /** Whether the cards the user has picked make a play now, and what it is called, or why it is none. */
  private check(ids: number[]): void {
    const pending = this.run?.pending;
    if (!pending || pending.ask.k !== 'play') return;
    const w = this.s.words().g.doudizhu;
    if (ids.length === 0) {
      this.post({ kind: 'verdict', ids, ok: false, label: '' });
      return;
    }
    const { hand, decks } = pending.view;
    const top = pending.view.top?.combo ?? null;
    const fit = checkPlay(hand, ids, top, decks);
    if (fit) {
      this.post({ kind: 'verdict', ids, ok: true, label: playLabel(fit.combo, w) });
      return;
    }
    // A set of cards that is a play of its own but does not beat the table is told apart from one that is no play.
    const shape = top !== null && checkPlay(hand, ids, null, decks) !== null;
    this.post({ kind: 'verdict', ids, ok: false, label: shape ? w.verdict.low : w.verdict.bad });
  }

  /** The next play to offer the user as a hint, from the best, and round to the best again when there are no more. */
  private hint(): void {
    const pending = this.run?.pending;
    if (!pending || pending.ask.k !== 'play') return;
    const w = this.s.words().g.doudizhu;
    pending.hints ??= hintList(pending.view);
    const list = pending.hints;
    const ids = list[pending.next % Math.max(1, list.length)];
    if (!ids) {
      this.post({ kind: 'hint', ids: [], label: '' });
      return;
    }
    pending.next += 1;
    const { hand, decks } = pending.view;
    const fit = checkPlay(hand, ids, pending.view.top?.combo ?? null, decks);
    this.post({ kind: 'hint', ids, label: fit ? playLabel(fit.combo, w) : '' });
  }

  private begin(picks: readonly PetId[], size: Size): void {
    const { g, names, language } = this.s.words();
    const w = g.doudizhu;
    const random = (): number => this.s.random();
    const pets = fillSeats(picks, size - 1, random);
    // Fewer pets than seats can't happen with the pets there are; the lobby stays rather than a short table.
    if (pets.length !== size - 1) return;
    const ids: ('user' | PetId)[] = ['user', ...pets];
    const brain = this.s.brain();
    const run: Run = { brain, stopped: false, pending: null, waits: new Set() };
    this.run = run;
    brain?.warm();

    /** What each seat last did, which stays on the table until it acts again or the table is cleared. */
    const marks: (DdzShown | null)[] = Array.from({ length: size }, () => null);
    /** Whether the landlords are found; until they are, nobody's side is shown. */
    let decided = false;
    let finished = false;
    let turn: number | null = null;

    const pet = (seat: number): PetId | null => {
      const id = ids[seat];
      return id === undefined || id === 'user' ? null : id;
    };
    const who = (seat: number): string => {
      const id = pet(seat);
      return id === null ? g.you : names[id];
    };

    const busy = new Set<number>();
    /** The seat whose pet has just said a line of its own, which it need not follow with a stock one. */
    let voiced: number | null = null;
    const mind = brain
      ? makeDdzMind({
        // Inside a prompt the user is not "You" but a person.
        names: (seat) => {
          const id = pet(seat);
          return id === null ? 'the user' : names[id];
        },
        character: (seat) => {
          const id = pet(seat);
          return id === null ? { name: g.you, persona: '' } : { name: names[id], persona: this.s.persona(id) };
        },
        language,
        ask: (seat, prompt) => brain.ask(seat, prompt),
        think: (seat, on) => {
          if (on) busy.add(seat);
          else busy.delete(seat);
          if (!run.stopped) this.post({ kind: 'thinking', seats: [...busy] });
        },
      })
      : null;

    const state = (t: Table): void => {
      const v = viewFor(t, ME);
      const seats: DdzSeat[] = ids.map((id, seat) => {
        const mine = seat === ME;
        const role = finished ? t.p(seat).role : decided ? (v.roles[seat] ?? null) : null;
        const hidden = decided && !finished && mine && t.p(ME).role === 'landlord' && !t.p(ME).open;
        return {
          seat, id, name: who(seat), color: id === 'user' ? USER_COLOR : PET_COLORS[id], me: mine, role, hidden,
          cards: v.counts[seat] ?? 0, shown: marks[seat] ?? null,
        };
      });
      const phase: DdzPhase = finished ? 'over' : decided || t.cfg.mode === 'call' ? 'play' : 'bid';
      this.post({
        kind: 'state', size, seats, hand: [...v.hand], phase, turn, top: v.top?.seat ?? null, base: t.base,
        bombs: t.bombs, call: v.call, holes: [...v.holes],
      });
    };
    const line = (tone: DdzTone, seat: number | null, text: string): void => {
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

    /** What the table now shows: who acted, what is on the table, and whose turn it is. */
    const track = (entry: Entry): void => {
      switch (entry.k) {
        case 'start':
          marks.fill(null);
          decided = false;
          finished = false;
          turn = null;
          break;
        case 'deal':
        case 'redeal':
          marks.fill(null);
          break;
        case 'bid':
          marks[entry.seat] = { k: 'bid', bid: entry.bid };
          turn = entry.seat;
          break;
        case 'landlord':
        case 'call':
          marks.fill(null);
          decided = true;
          turn = entry.seat;
          break;
        case 'turn':
          turn = entry.seat;
          if (entry.lead) marks.fill(null);
          else marks[entry.seat] = null;
          break;
        case 'play':
          marks[entry.seat] = {
            k: 'play', cards: entry.cards, label: playLabel(entry.play.combo, w), bomb: isBomb(entry.play.combo),
          };
          break;
        case 'pass':
          marks[entry.seat] = { k: 'pass' };
          break;
        case 'end':
          finished = true;
          turn = null;
          break;
        case 'reveal':
          break;
      }
    };

    /** A pet may say something about what has just happened to it or by it; at the end one of each side does. */
    const speak = (entry: Entry, t: Table): void => {
      const quiet = voiced;
      voiced = null;
      if (entry.k === 'end') {
        const r: Result = entry.result;
        const sideWon = (seat: number): boolean => (r.landlords.includes(seat) ? 'landlord' : 'farmer') === r.winner;
        for (const [wins, mood] of [[true, 'win'], [false, 'lose']] as const) {
          const seats = pets.map((_, i) => i + 1).filter((seat) => sideWon(seat) === wins);
          const seat = seats[Math.floor(random() * seats.length)];
          if (seat !== undefined) line('say', seat, chatter(mood, w, random));
        }
        return;
      }
      for (const { seat, mood } of moods(entry, (s) => t.p(s).hand.length)) {
        if (pet(seat) === null || seat === quiet || random() >= CHATTER) continue;
        line('say', seat, chatter(mood, w, random));
        return;
      }
    };

    const emit = async (entry: Entry, t: Table): Promise<void> => {
      if (run.stopped) return;
      mind?.observe(entry);
      track(entry);
      state(t);
      for (const l of entryLines(entry, w, who)) line(l.tone, l.seat, l.text);
      if (entry.k === 'landlord' || entry.k === 'call') {
        const me = t.p(ME);
        const kind = me.role === 'landlord' ? (me.open ? 'landlord' : 'hidden') : 'farmer';
        line('secret', null, w.youAre[kind]);
        line('secret', null, w.roleHint[kind]);
      }
      speak(entry, t);
      if (entry.k === 'end') {
        const over = overText(entry.result, ME, who, w);
        this.post({ kind: 'over', win: over.win, winner: entry.result.winner, title: over.title, text: over.text });
        return;
      }
      const ms = pace(entry);
      if (ms > 0) await wait(ms);
    };

    const ask = async (seat: number, question: Ask, t: Table): Promise<Reply | null> => {
      turn = seat;
      if (seat !== ME) {
        const thought = mind ? await mind.answer(seat, question, t) : null;
        if (run.stopped) return null;
        if (thought) {
          if (thought.say !== null) {
            line('say', seat, thought.say);
            voiced = seat;
          }
          return thought.reply;
        }
        const v = viewFor(t, seat);
        return question.k === 'bid'
          ? { k: 'bid', bid: botBid(v, question.min, question.max) }
          : { k: 'play', ids: botPlay(v) };
      }
      state(t);
      const view = viewFor(t, ME);
      const top = view.top === null ? null : { who: who(view.top.seat), combo: view.top.combo };
      const shown = askView(question, askTitle(question, w, top));
      this.post({ kind: 'ask', ask: shown });
      return new Promise<Reply | null>((resolve) => {
        run.pending = { ask: question, view, shown, resolve, hints: null, next: 0 };
      });
    };

    const deps: Deps = { random, ask, emit, stopped: () => run.stopped };
    runDoudizhu(deps, size).catch((err: unknown) => {
      if (!(err instanceof Stopped) && !run.stopped) {
        line('sys', null, String(err instanceof Error ? err.message : err).slice(0, 200));
      }
    }).finally(() => {
      run.brain?.close();
    });
  }
}
