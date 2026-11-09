import { PET_COLORS, PET_IDS, type PetId } from '../../shared/teammate/pet';
import type { GameVariant, WolfIn, WolfOut, WolfSeat } from '../../shared/gameIpc';
import {
  entryLines, fillSeats, lobbyChoices, phrasesOf, roleName, rolesLine, winLine, wolfAnswer, wolfAsk, wolfText,
} from '../../shared/teammate/gameText';
import {
  CRESCENT_SEATS, SEATS, WerewolfGame, isWolfSide, rolesOf, seatsOf, type Answer, type Mode, type Question, type Role, type Who,
} from '../../shared/teammate/werewolf';
import { chatPrompt, gravePrompt, makeAi, parseChat } from '../../shared/teammate/werewolfMind';
import { BoomButton, Stopped, runGame, type RunEvent } from '../../shared/teammate/werewolfRun';
import type { GameBrain } from './gameBrain';
import type { GameServices } from './gameServices';

/** The pets that sit at the table with a user who plays; a user who only watches has one more. */
export const WOLF_AI_SEATS = SEATS - 1;
const USER_COLOR = '#4a90e2';
/** The most pets that answer one chat message. */
const CHAT_REPLIES = 3;

interface Run {
  brain: GameBrain | null;
  boom: BoomButton;
  stopped: boolean;
  pending: { q: Question; resolve: (a: Answer | null) => void } | null;
  waits: Set<() => void>;
  done: boolean;
  whos: Who[];
  round: number;
  mode: Mode;
  /** The role the user asked for, kept for a rematch. */
  wish?: Role;
  /** The computer players get the god view; kept for a rematch. */
  god: boolean;
  /** Answers a message of the chat after the game; set once the game is dealt. */
  chat: (text: string) => void;
  /** The seer's cheat: shows the role of a seat from now on. */
  peek: (seat: number) => void;
  /** A line of the user's in the chat among the dead; the dead pets answer. */
  grave: (text: string) => void;
}

/**
 * A game of werewolf in its window: the lobby, then twelve players, until a side wins. The user takes a seat, or only
 * watches with every seat played by a pet. The page is shown the words and the seats, and no role the user may not
 * know; what it sends back answers the question the game is waiting on.
 */
export class WerewolfRoom {
  private run: Run | null = null;

  constructor(private readonly s: GameServices, private readonly post: (msg: WolfOut) => void) {}

  lobby(): void {
    this.stop();
    const { g, names } = this.s.words();
    const w = g.werewolf;
    const seats = Math.min(WOLF_AI_SEATS, PET_IDS.length);
    const watchSeats = Math.min(SEATS, PET_IDS.length);
    // The crescent table has more seats than there are pets, so pets sit twice and the table is never short.
    const choices = (mode: Mode): Pick<GameVariant, 'roles' | 'rolePick' | 'god'> => ({
      rolePick: w.rolePick, god: w.godMode,
      roles: [{ id: '', label: w.roleRandom }, ...[...new Set(rolesOf(mode))].map((r) => ({ id: r, label: w.role[r] }))],
    });
    const variants: GameVariant[] = [
      {
        id: 'classic', label: w.modeClassic, seats, watchSeats, rules: w.rules,
        pickPlay: w.pickPlay(seats), pickWatch: w.pickWatch(watchSeats), ...choices('classic'),
      },
      {
        id: 'crescent', label: w.modeCrescent, seats: CRESCENT_SEATS - 1, watchSeats: CRESCENT_SEATS,
        rules: w.rulesCrescent, pickPlay: w.pickPlay(CRESCENT_SEATS - 1), pickWatch: w.pickWatch(CRESCENT_SEATS), ...choices('crescent'),
      },
    ];
    this.post({
      kind: 'lobby', text: wolfText(g, seats, watchSeats), choices: lobbyChoices(this.s.petsOn(), names),
      seats, watchSeats, minds: this.s.canThink(), variants,
    });
  }

  on(msg: WolfIn): void {
    switch (msg.t) {
      case 'again':
        if (this.run?.done && this.run.brain) this.rematch(this.run);
        else this.lobby();
        return;
      case 'start':
        if (!this.run) this.begin(msg.pets, msg.play, msg.mode ?? 'classic', null, msg.role, msg.god === true);
        return;
      case 'chat':
        if (this.run?.done) this.run.chat(msg.text);
        return;
      case 'grave':
        this.run?.grave(msg.text);
        return;
      case 'peek':
        this.run?.peek(msg.seat);
        return;
      case 'boom':
        this.run?.boom.press();
        return;
      default: {
        const pending = this.run?.pending;
        const answer = pending ? wolfAnswer(pending.q, msg) : null;
        if (!this.run || !pending || !answer) return;
        this.run.pending = null;
        pending.resolve(answer);
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
    run.brain?.close();
  }

  /** The same players sit down again: seats keep their pets, so each pet's session still remembers every game before. */
  private rematch(prev: Run): void {
    prev.done = false;
    this.begin([], false, prev.mode, prev, prev.wish, prev.god);
  }

  private begin(picks: readonly PetId[], play: boolean, mode: Mode, prev: Run | null = null, wish?: Role, god = false): void {
    const { g, names, language } = this.s.words();
    const w = g.werewolf;
    const random = (): number => this.s.random();
    const seatCount = seatsOf(mode);
    let whos: Who[];
    if (prev) {
      whos = prev.whos;
    } else {
      const pets = fillSeats(picks, play ? seatCount - 1 : seatCount, random);
      whos = play ? ['user', ...pets] : pets;
    }
    if (whos.length !== seatCount) return;
    const game = WerewolfGame.deal(whos, random, mode, wish);
    const brain = prev ? prev.brain : this.s.brain();
    const round = prev ? prev.round + 1 : 1;
    const run: Run = {
      brain, boom: new BoomButton(), stopped: false, pending: null, waits: new Set(), done: false, whos, round, mode, wish, god,
      chat: () => undefined, peek: () => undefined, grave: () => undefined,
    };
    this.run = run;
    brain?.warm();
    const who = (seat: number): Who => game.player(seat).who;
    // A pet that sits twice is told apart by a number: "Haru", "Haru 2".
    const seen = new Map<string, number>();
    const labels = game.players.map((p) => {
      const id = p.who;
      if (id === 'user') return g.you;
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      return n === 1 ? names[id] : `${names[id]} ${n}`;
    });
    const name = (seat: number): string => labels[seat - 1] ?? '';
    // Inside what a pet says, "you" is not a name; inside a prompt, the user is not "You" but a person.
    const spoken = (seat: number): string => (who(seat) === 'user' ? g.youLower : name(seat));
    const called = (seat: number): string => (who(seat) === 'user' ? 'the user' : name(seat));
    const me = game.seatOfUser();
    let told = false;
    // Only a seer may peek: the roles the user has asked to see, and the last table shown.
    const peeked = new Set<number>();
    let table: WolfOut | null = null;
    const spy = me !== null && game.player(me).role === 'seer';

    const emit = (e: RunEvent): void => {
      if (run.stopped) return;
      switch (e.kind) {
        case 'state': {
          const seats: WolfSeat[] = e.players.map((p) => ({
            seat: p.seat, id: p.who, name: name(p.seat), color: p.who === 'user' ? USER_COLOR : PET_COLORS[p.who],
            alive: p.alive, role: p.role ?? (peeked.has(p.seat) ? game.player(p.seat).role : null),
            roleName: roleName(p.role ?? (peeked.has(p.seat) ? game.player(p.seat).role : null), w), me: p.who === 'user', sheriff: p.sheriff,
            flipped: p.flipped, lover: p.lover,
          }));
          const label = w.day(Math.max(1, e.day));
          table = { kind: 'state', day: e.day, phase: e.phase, label, seats, boom: e.boom };
          this.post(table);
          if (me === null && !told) {
            told = true;
            this.post({ kind: 'line', tone: 'secret', seat: null, text: rolesLine(game, w, name) });
          }
          break;
        }
        case 'entry':
          for (const line of entryLines(e.entry, w, name, me)) this.post({ kind: 'line', ...line });
          break;
        case 'thinking':
          this.post({ kind: 'thinking', seats: e.seats });
          break;
        case 'ask':
          this.post({ kind: 'ask', ask: wolfAsk(game, e.seat, e.question, w, name) });
          break;
        case 'unask':
          run.pending = null;
          this.post({ kind: 'ask', ask: null });
          break;
        case 'over': {
          // A thief or a wild child may have changed sides since the deal, so the side is read now.
          const win = me === null
            ? null
            : e.winner === 'lovers'
              ? game.partnerOf(me) !== null
              : (e.winner === 'wolves') === isWolfSide(game.player(me).role);
          const title = win === null ? winLine(e.why, w) : win ? w.youWin : w.youLose;
          this.post({ kind: 'over', win, winner: e.winner, title, text: rolesLine(game, w, name) });
          break;
        }
      }
    };

    run.peek = (seat: number): void => {
      if (!spy || run.stopped || run.done || seat === me || seat < 1 || seat > game.players.length) return;
      peeked.add(seat);
      if (table?.kind !== 'state') return;
      const role = game.player(seat).role;
      table = { ...table, seats: table.seats.map((s) => (s.seat === seat ? { ...s, role, roleName: roleName(role, w) } : s)) };
      this.post(table);
    };

    let graving = false;
    run.grave = (text: string): void => {
      if (graving || run.stopped || run.done || me === null || game.player(me).alive) return;
      graving = true;
      this.post({ kind: 'grave', seat: me, text });
      const seated = new Set<string>();
      const speakers: number[] = [];
      const dead = game.players.filter((p) => !p.alive && p.who !== 'user').map((p) => p.seat);
      for (const s of dead.sort(() => random() - 0.5)) {
        if (speakers.length >= 1 + Math.floor(random() * 2) || seated.has(who(s))) continue;
        seated.add(who(s));
        speakers.push(s);
      }
      const quip = (): string => w.graveQuips[Math.floor(random() * w.graveQuips.length)] ?? '';
      const reply = async (seat: number): Promise<string> => {
        const id = who(seat);
        if (!brain || id === 'user') return quip();
        const raw = await brain.ask(seat, gravePrompt(game, {
          seat, name: name(seat), persona: this.s.persona(id), names: called, language, user: 'The user', text,
        }));
        return parseChat(raw) ?? quip();
      };
      void Promise.all(speakers.map((s) => reply(s).catch(quip))).then((lines) => {
        if (run.stopped) return;
        speakers.forEach((s, i) => this.post({ kind: 'grave', seat: s, text: lines[i] ?? '' }));
      }).finally(() => {
        graving = false;
      });
    };

    let chatting = false;
    run.chat = (text: string): void => {
      if (chatting || run.stopped) return;
      chatting = true;
      this.post(me === null
        ? { kind: 'line', tone: 'sys', seat: null, text: `${g.you}: ${text}` }
        : { kind: 'line', tone: 'say', seat: me, text });
      const pool = game.players.filter((p) => p.who !== 'user').map((p) => p.seat);
      const seated = new Set<string>();
      const speakers: number[] = [];
      for (const s of pool.sort(() => random() - 0.5)) {
        if (speakers.length >= 1 + Math.floor(random() * CHAT_REPLIES) || seated.has(who(s))) continue;
        seated.add(who(s));
        speakers.push(s);
      }
      const pickOf = (lines: readonly string[]): string =>
        lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))] ?? '';
      const reply = async (seat: number): Promise<string | null> => {
        const id = who(seat);
        if (id === 'user') return null;
        if (!brain) return pickOf(w.chatQuips);
        const raw = await brain.ask(seat, chatPrompt(game, {
          seat, name: name(seat), persona: this.s.persona(id), names: called, language, user: 'The user', text,
        }));
        return parseChat(raw) ?? pickOf(w.chatQuips);
      };
      this.post({ kind: 'thinking', seats: speakers });
      void Promise.all(speakers.map((s) => reply(s).catch(() => pickOf(w.chatQuips)))).then((lines) => {
        if (run.stopped) return;
        this.post({ kind: 'thinking', seats: [] });
        speakers.forEach((s, i) => this.post({ kind: 'line', tone: 'say', seat: s, text: lines[i] ?? '' }));
      }).finally(() => {
        chatting = false;
      });
    };

    const ai = brain
      ? makeAi({
        game, names: called, language, round, god,
        character: (seat) => {
          const id = who(seat);
          return id === 'user' ? { name: g.you, persona: '' } : { name: names[id], persona: this.s.persona(id) };
        },
        ask: (seat, prompt) => brain.ask(seat, prompt),
      })
      : (): Promise<Answer | null> => Promise.resolve(null);

    runGame({
      game, ai, emit, nameOf: spoken, phrases: phrasesOf(w, random), random, minds: brain !== null, boom: run.boom,
      human: (_seat, q) => new Promise<Answer | null>((resolve) => {
        run.pending = { q, resolve };
      }),
      wait: (ms) => new Promise<void>((resolve) => {
        let cancel: () => void = () => undefined;
        const release = (): void => {
          cancel();
          run.waits.delete(release);
          resolve();
        };
        run.waits.add(release);
        cancel = this.s.after(ms, release);
      }),
      stopped: () => run.stopped,
    }).catch((err: unknown) => {
      if (!(err instanceof Stopped) && !run.stopped) {
        const text = String(err instanceof Error ? err.message : err).slice(0, 200);
        this.post({ kind: 'line', tone: 'sys', seat: null, text });
        run.brain?.close();
      }
    }).finally(() => {
      run.done = true;
    });
  }
}
