/**
 * Plays the rounds of the mahjong scene. It asks `planRound` for a round and, as its clock runs, tells the table what to
 * show, the pets what to do and the HUD what to say at each moment of the plan; when a round ends it starts the next.
 * It is written against small interfaces instead of the pixi table and the page's elements, so a test can run it.
 */

import { DEAD_WALL, HAND_SIZE, KINDS, SEAT_COUNT, type Meld } from '../../shared/teammate/mahjong';
import { planRound, type ChatKind, type PlanEvent, type RoundPlan } from '../../shared/teammate/mahjongPlan';
import { gazeAt, type Cue } from '../../shared/teammate/sceneMotion';
import { CENTER, SEAT_X } from './layout';

/** What the director asks of the table: the stage's own methods. */
export interface TableApi {
  reset(): void;
  shuffle(ms: number): void;
  roll(ms: number, dice: readonly [number, number]): void;
  deal(ms: number, dealer: number): void;
  draw(seat: number): void;
  discard(seat: number, kind: number, fromDrawn: boolean): void;
  call(seat: number, meld: Meld): void;
  win(seat: number, from: number | null, tile: number, hand: readonly number[]): void;
}

/** What it asks of a pet at the table: an actor's own methods. */
export interface PlayerApi {
  readonly busy: boolean;
  cue(cue: Cue, ms?: number): void;
  talk(ms: number): void;
  gaze(x: number, y: number): void;
}

/** What it shows over the picture, by seat. */
export interface HudApi {
  bubble(seat: number, text: string, ms: number): void;
  shout(seat: number, text: string, ms: number): void;
  toast(text: string, ms: number): void;
  round(n: number): void;
  wall(n: number): void;
  dealer(seat: number): void;
}

export interface DirectorDeps {
  table: TableApi;
  /** The pet at a seat, or null if nobody sits there (yet). */
  player(seat: number): PlayerApi | null;
  hud: HudApi;
  words: Readonly<Record<string, string>>;
  lines: Readonly<Record<string, readonly string[]>>;
  random: () => number;
  plan?: (random: () => number, dealer: number) => RoundPlan;
}

/** How many tiles are in the wall to draw from once the hands are dealt. */
export const WALL_TILES = 4 * KINDS - SEAT_COUNT * HAND_SIZE - DEAD_WALL;
/** How long a call or a win is shouted for. */
export const SHOUT_MS = 1500;
export const WIN_SHOUT_MS = 2600;
/** How long the pets watch a thrown tile before they look back at the middle of the table. */
export const LOOK_MS = 1400;
/** How long a round with no winner stays on the table before the next one. */
export const DRAW_PAUSE_MS = 2600;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** How long a speech bubble stays up: time to read the line, but not so long that it is in the way. */
export const bubbleMs = (line: string): number => clamp(1200 + 110 * [...line].length, 1800, 4200);

/** How long the mouth moves for a line: as long as it takes to say, and no longer than the bubble. */
export const talkMs = (line: string, bubble: number): number => Math.min(bubble, 300 + 160 * [...line].length);

export class Director {
  private plan: RoundPlan | null = null;
  private cursor = 0;
  private t = 0;
  private dealer = 0;
  private roundNo = 1;
  private lookBack: number | null = null;
  /** The next round, waiting out a pause. */
  private upcoming: { dealer: number; round: number; wait: number } | null = null;

  constructor(private readonly d: DirectorDeps) {}

  get round(): number {
    return this.roundNo;
  }

  get running(): boolean {
    return this.plan !== null || this.upcoming !== null;
  }

  /** Starts over with a fresh round, the table cleared by its first event. */
  start(dealer = 0, round = 1): void {
    this.upcoming = null;
    this.begin(dealer, round);
  }

  stop(): void {
    this.plan = null;
    this.upcoming = null;
    this.lookBack = null;
  }

  /** Moves the clock on by `dtMs` and plays what has come due. */
  update(dtMs: number): void {
    const dt = Math.max(0, dtMs);
    const next = this.upcoming;
    if (next) {
      next.wait -= dt;
      if (next.wait <= 0) this.start(next.dealer, next.round);
      return;
    }
    const plan = this.plan;
    if (!plan) return;
    this.t += dt;
    if (this.lookBack !== null && this.t >= this.lookBack) {
      this.lookBack = null;
      this.lookAtMiddle();
    }
    while (this.cursor < plan.events.length) {
      const e = plan.events[this.cursor] as PlanEvent;
      if (e.at > this.t) break;
      this.cursor += 1;
      this.fire(e, plan);
      if (this.plan !== plan) return;
    }
  }

  private begin(dealer: number, round: number): void {
    this.dealer = dealer;
    this.roundNo = round;
    this.plan = (this.d.plan ?? planRound)(this.d.random, dealer);
    this.cursor = 0;
    this.t = 0;
    this.lookBack = null;
    this.d.hud.round(round);
    this.d.hud.dealer(dealer);
    this.d.hud.wall(WALL_TILES);
    this.lookAtMiddle();
  }

  private everyone(fn: (player: PlayerApi, seat: number) => void): void {
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const player = this.d.player(seat);
      if (player) fn(player, seat);
    }
  }

  private lookAtMiddle(): void {
    this.everyone((p, seat) => {
      const g = gazeAt(SEAT_X[seat] ?? CENTER.x, CENTER.x);
      p.gaze(g.x, g.y);
    });
  }

  /** The pets at the other seats watch `thrower` throw. */
  private lookAt(thrower: number): void {
    this.everyone((p, seat) => {
      if (seat === thrower) return;
      const g = gazeAt(SEAT_X[seat] ?? CENTER.x, SEAT_X[thrower] ?? CENTER.x);
      p.gaze(g.x, g.y);
    });
    this.lookBack = this.t + LOOK_MS;
  }

  private shout(seat: number, word: string | undefined, ms: number): void {
    if (word) this.d.hud.shout(seat, word, ms);
  }

  private say(seat: number, kind: ChatKind, variant: number): void {
    const player = this.d.player(seat);
    const lines = this.d.lines[kind] ?? [];
    const line = lines[clamp(Math.floor(variant * lines.length), 0, lines.length - 1)];
    if (!player || !line) return;
    const ms = bubbleMs(line);
    this.d.hud.bubble(seat, line, ms);
    player.talk(talkMs(line, ms));
    if (kind === 'cheer') player.cue('cheer');
    else if (!player.busy) player.cue(kind === 'tease' ? 'laugh' : 'chat');
  }

  private fire(e: PlanEvent, plan: RoundPlan): void {
    const { table, hud, words } = this.d;
    const player = 'seat' in e ? this.d.player(e.seat) : null;
    switch (e.type) {
      case 'shuffle': {
        const ms = e.ms;
        table.reset();
        table.shuffle(ms);
        this.everyone((p) => p.cue('shuffle', ms));
        if (words.shuffle) hud.toast(words.shuffle, ms);
        break;
      }
      case 'dice':
        table.roll(e.ms, e.dice);
        break;
      case 'deal':
        table.deal(e.ms, this.dealer);
        break;
      case 'draw':
        table.draw(e.seat);
        player?.cue('draw');
        hud.wall(e.left);
        break;
      case 'think':
        player?.cue('think', e.ms);
        break;
      case 'throw':
        table.discard(e.seat, e.tile, e.fromDrawn);
        player?.cue('throw');
        this.lookAt(e.seat);
        break;
      case 'call':
        table.call(e.seat, e.meld);
        player?.cue('call');
        this.shout(e.seat, e.kind === 'pong' ? words.pong : words.chow, SHOUT_MS);
        break;
      case 'chat':
        this.say(e.seat, e.kind, e.variant);
        break;
      case 'react':
        player?.cue(e.reaction);
        break;
      case 'win':
        table.win(e.seat, e.from, e.tile, e.hand);
        player?.cue('win');
        this.shout(e.seat, e.from === null ? words.tsumo : words.ron, WIN_SHOUT_MS);
        break;
      case 'end': {
        this.plan = null;
        this.lookBack = null;
        const drawn = plan.winner === null;
        if (drawn && words.drawGame) hud.toast(words.drawGame, DRAW_PAUSE_MS);
        this.upcoming = { dealer: plan.next, round: this.roundNo + 1, wait: drawn ? DRAW_PAUSE_MS : 0 };
        break;
      }
    }
  }
}
