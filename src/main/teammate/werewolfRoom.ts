import { PET_COLORS, PET_IDS, type PetId } from '../../shared/teammate/pet';
import type { WolfIn, WolfOut, WolfSeat } from '../../shared/gameIpc';
import {
  entryLines, fillSeats, lobbyChoices, phrasesOf, roleName, rolesLine, winLine, wolfAnswer, wolfAsk, wolfText,
} from '../../shared/teammate/gameText';
import { SEATS, WerewolfGame, type Answer, type Question, type Who } from '../../shared/teammate/werewolf';
import { makeAi } from '../../shared/teammate/werewolfMind';
import { BoomButton, Stopped, runGame, type RunEvent } from '../../shared/teammate/werewolfRun';
import type { GameBrain } from './gameBrain';
import type { GameServices } from './gameServices';

/** The pets that sit at the table with a user who plays; a user who only watches has one more. */
export const WOLF_AI_SEATS = SEATS - 1;
const USER_COLOR = '#4a90e2';

interface Run {
  brain: GameBrain | null;
  boom: BoomButton;
  stopped: boolean;
  pending: { q: Question; resolve: (a: Answer | null) => void } | null;
  waits: Set<() => void>;
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
    const seats = Math.min(WOLF_AI_SEATS, PET_IDS.length);
    const watchSeats = Math.min(SEATS, PET_IDS.length);
    this.post({
      kind: 'lobby', text: wolfText(g, seats, watchSeats), choices: lobbyChoices(this.s.petsOn(), names),
      seats, watchSeats, minds: this.s.canThink(),
    });
  }

  on(msg: WolfIn): void {
    switch (msg.t) {
      case 'again':
        this.lobby();
        return;
      case 'start':
        if (!this.run) this.begin(msg.pets, msg.play);
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

  private begin(picks: readonly PetId[], play: boolean): void {
    const { g, names, language } = this.s.words();
    const w = g.werewolf;
    const random = (): number => this.s.random();
    const pets = fillSeats(picks, play ? SEATS - 1 : SEATS, random);
    const whos: Who[] = play ? ['user', ...pets] : pets;
    // Fewer pets than seats can't happen with the pets there are; the lobby stays rather than a short table.
    if (whos.length !== SEATS) return;
    const game = WerewolfGame.deal(whos, random);
    const brain = this.s.brain();
    const run: Run = { brain, boom: new BoomButton(), stopped: false, pending: null, waits: new Set() };
    this.run = run;
    brain?.warm();
    const who = (seat: number): Who => game.player(seat).who;
    const name = (seat: number): string => {
      const id = who(seat);
      return id === 'user' ? g.you : names[id];
    };
    // Inside what a pet says, "you" is not a name; inside a prompt, the user is not "You" but a person.
    const spoken = (seat: number): string => (who(seat) === 'user' ? g.youLower : name(seat));
    const called = (seat: number): string => (who(seat) === 'user' ? 'the user' : name(seat));
    const me = game.seatOfUser();
    const mine = me === null ? null : game.player(me).role === 'wolf';
    let told = false;

    const emit = (e: RunEvent): void => {
      if (run.stopped) return;
      switch (e.kind) {
        case 'state': {
          const seats: WolfSeat[] = e.players.map((p) => ({
            seat: p.seat, id: p.who, name: name(p.seat), color: p.who === 'user' ? USER_COLOR : PET_COLORS[p.who],
            alive: p.alive, role: p.role, roleName: roleName(p.role, w), me: p.who === 'user', sheriff: p.sheriff,
            flipped: p.flipped,
          }));
          const label = w.day(Math.max(1, e.day));
          this.post({ kind: 'state', day: e.day, phase: e.phase, label, seats, boom: e.boom });
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
          const win = mine === null ? null : (e.winner === 'wolves') === mine;
          const title = win === null ? winLine(e.why, w) : win ? w.youWin : w.youLose;
          this.post({ kind: 'over', win, winner: e.winner, title, text: rolesLine(game, w, name) });
          break;
        }
      }
    };

    const ai = brain
      ? makeAi({
        game, names: called, language,
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
      }
    }).finally(() => {
      run.brain?.close();
    });
  }
}
