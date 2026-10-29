import type { RingMsg, RingPlate, RingSide } from '../../shared/ringMsg';
import {
  arenaStands, boutsFit, fightLine, otherSide, pairUp, planFight, ringOf,
  type FightEvent, type FightLines, type Ring, type Side,
} from '../../shared/teammate/fight';
import {
  Nudger, nudgeSettles, strikeCue, takeCue, windCue, type Dir, type FightCue,
} from '../../shared/teammate/fightMotion';
import { PET_COLORS, keepInside, stepToward, type PetId } from '../../shared/teammate/pet';
import { speechMs } from '../../shared/teammate/petControl';

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Area = Point & Size;
type Timer = ReturnType<typeof setTimeout>;
type Land = Extract<FightEvent, { type: 'land' }>;

/** The overlay of a bout, as the director uses it. */
export interface RingHandle {
  send(msgs: readonly RingMsg[]): void;
  close(): void;
}

/** What a bout needs of the desktop pets and of the screen: the windows and their poses, and a place to draw. */
export interface FightHost {
  /** The pet's window size; null when it is not showing. */
  size(id: PetId): Size | null;
  /** The pet's window position (top-left); null when it is not showing. */
  at(id: PetId): Point | null;
  /** Takes the pet for the bout; false when it cannot be taken (the user holds it, or it has gone). */
  take(id: PetId): boolean;
  /** Moves the pet's window, and its speech bubble with it. */
  place(id: PetId, to: Point): void;
  /** The pet runs, facing `dir`. */
  run(id: PetId, dir: Dir): void;
  cue(id: PetId, cue: FightCue, dir: Dir): void;
  say(id: PetId, text: string, ms: number): void;
  /** The pet is let go and walks home. */
  release(id: PetId): void;
  /** The display the bouts are on. */
  area(): Area;
  openRing(rect: Area): RingHandle;
}

/** The words of a bout, in the user's language. */
export interface FightText {
  names: Readonly<Record<PetId, string>>;
  fight: string;
  ko: string;
  win: (name: string) => string;
  draw: string;
  miss: string;
  block: string;
  crit: string;
  combo: (n: number) => string;
  lines: FightLines;
}

/** How fast the pets run to their places: as fast as they run anywhere. */
const RUN_SPEED = 900;
const MOVE_MS = 20;
const NUDGE_MS = 24;
/** Bouts on the screen at once: more would crowd it, and each pet is a window to draw. */
export const MAX_AT_ONCE = 2;
/** A shout's bubble stays this long at most. */
const SHOUT_MAX_MS = 2600;
/** A blow's cue starts this long before it lands, so the fist arrives as the number appears. */
const STRIKE_LEAD: Partial<Record<FightCue, number>> = { punch: 110, smash: 170 };
/** The one under the blow starts to move a moment before it lands when it sees it coming. */
const REACT_LEAD: Partial<Record<FightCue, number>> = { dodge: 90, block: 30 };
/** After a cue's movement is over, the pet waits this long and then stands on guard again. */
const SETTLE_PAD = 120;
const SETTLING: ReadonlySet<FightCue> = new Set<FightCue>(['punch', 'smash', 'hit', 'crit', 'block', 'dodge']);
const PLATE_ABOVE = 58;
const PLATE_MAX = 160;
const PLATE_MIN = 90;
const BANNER_MS = { fight: 1100, ko: 1800, win: 3000, draw: 2400 } as const;

const dirOf = (seat: Side): Dir => (seat === 0 ? 1 : -1);
const centre = (box: Area): number => Math.round(box.x + box.width / 2);

interface Bout {
  ids: [PetId, PetId];
  sizes: [Size, Size];
  stands: [Point, Point];
  ring: Ring;
  area: Area;
  handle: RingHandle | null;
  nudgers: [Nudger, Nudger];
  /** Fires when the pet's last cue is over and it goes back on guard, unless a new cue began first. */
  settle: [Timer | null, Timer | null];
  /** Where each window was last put, so it is only moved when it has to be. */
  placed: [Point, Point];
  /** Where the stars circle, in the overlay, while a fighter is out. */
  stars: Point | null;
  arrived: number;
  over: boolean;
}

interface Walker {
  bout: Bout;
  seat: Side;
  goal: Point;
}

/**
 * Runs the bouts of a boxing match among the desktop pets, two by two: the pets run to their places, each pair fights
 * the bout `planFight` worked out, and then they go home. It tells the pets what to do through a host, so it can be
 * tested without a window.
 */
export class PetFight {
  private readonly timers = new Set<Timer>();
  private walkers: Walker[] = [];
  private mover: ReturnType<typeof setInterval> | null = null;
  private lastMove = 0;
  private nudge: ReturnType<typeof setInterval> | null = null;
  private bouts: Bout[] = [];
  private queue: [PetId, PetId][] = [];
  private done = false;

  /** `onEnd` is called when the match is over (not when it is stopped from outside). */
  constructor(
    private readonly host: FightHost,
    private readonly text: FightText,
    private readonly random: () => number,
    private readonly onEnd: () => void,
  ) {}

  /** Starts the match among `ids`; false when there are not two to fight, or none of them could be taken. */
  start(ids: readonly PetId[]): boolean {
    const { pairs } = pairUp(ids, this.random);
    if (pairs.length === 0) return false;
    this.queue = pairs;
    if (this.next() && !this.done) return true;
    this.done = true;
    return false;
  }

  /** Whether the pet is in the match, fighting or waiting its turn. */
  has(id: PetId): boolean {
    return this.bouts.some((b) => b.ids.includes(id)) || this.queue.some((pair) => pair.includes(id));
  }

  /** Ends the match now: the pets are let go and the overlays closed. */
  stop(): void {
    if (this.done) return;
    this.done = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.walkers = [];
    this.stopMover();
    this.stopNudge();
    for (const b of this.bouts) this.close(b);
    this.bouts = [];
    this.queue = [];
  }

  /** Ends the match because a fighter has gone: like `stop`, but the owner is told. */
  private abort(): void {
    if (this.done) return;
    this.stop();
    this.onEnd();
  }

  /** The next bouts, as many as fit on the display at once; false when the queue is spent and there are none. */
  private next(): boolean {
    while (!this.done) {
      const area = this.host.area();
      const sizes = this.queue.flat().flatMap((id) => this.host.size(id) ?? []);
      const fit = Math.min(MAX_AT_ONCE, boutsFit(area, sizes));
      const ready: { ids: [PetId, PetId]; sizes: [Size, Size] }[] = [];
      for (const ids of this.queue.splice(0, fit)) {
        const a = this.host.size(ids[0]);
        const b = this.host.size(ids[1]);
        if (!a || !b || !this.host.take(ids[0])) continue;
        if (!this.host.take(ids[1])) {
          this.host.release(ids[0]);
          continue;
        }
        ready.push({ ids, sizes: [a, b] });
      }
      if (ready.length > 0) {
        this.setUp(area, ready);
        return true;
      }
      if (this.queue.length === 0) return false;
    }
    return false;
  }

  private setUp(area: Area, pairs: { ids: [PetId, PetId]; sizes: [Size, Size] }[]): void {
    const made = pairs.map(({ ids, sizes }, i): Bout => {
      const stands = arenaStands(area, i, pairs.length, sizes);
      return {
        ids, sizes, stands, area, ring: ringOf(stands, sizes, area), handle: null,
        nudgers: [new Nudger(), new Nudger()], settle: [null, null], placed: [stands[0], stands[1]],
        stars: null, arrived: 0, over: false,
      };
    });
    // All of them are on the books before any pet is sent off, so a pet that has gone lets the others go too.
    this.bouts.push(...made);
    for (const bout of made) {
      for (const seat of [0, 1] as const) {
        const from = this.host.at(bout.ids[seat]);
        if (!from) {
          this.abort();
          return;
        }
        const goal = bout.stands[seat];
        this.host.run(bout.ids[seat], goal.x >= from.x ? 1 : -1);
        this.walkers.push({ bout, seat, goal });
      }
    }
    this.lastMove = Date.now();
    this.mover ??= setInterval(() => this.moveTick(), MOVE_MS);
  }

  private moveTick(): void {
    const now = Date.now();
    const dt = Math.min(now - this.lastMove, 100);
    this.lastMove = now;
    for (const w of [...this.walkers]) {
      const id = w.bout.ids[w.seat];
      const from = this.host.at(id);
      if (!from) {
        this.abort();
        return;
      }
      const step = stepToward(from, w.goal, RUN_SPEED, dt);
      this.host.place(id, { x: Math.round(step.at.x), y: Math.round(step.at.y) });
      if (!step.arrived) continue;
      this.walkers = this.walkers.filter((other) => other !== w);
      w.bout.arrived += 1;
      if (w.bout.arrived === 2) this.begin(w.bout);
    }
    if (this.walkers.length === 0) this.stopMover();
  }

  private stopMover(): void {
    if (this.mover === null) return;
    clearInterval(this.mover);
    this.mover = null;
  }

  private stopNudge(): void {
    if (this.nudge === null) return;
    clearInterval(this.nudge);
    this.nudge = null;
  }

  /** Both pets stand in their places: the overlay opens and the bout is played out as it was planned. */
  private begin(b: Bout): void {
    const plan = planFight(this.random);
    b.handle = this.host.openRing(b.ring.rect);
    b.handle.send([{ op: 'init', plates: this.plates(b) }, this.bar(0, 100, 0), this.bar(1, 100, 0)]);
    for (const ev of plan.events) {
      this.timer(ev.at, () => this.play(b, ev));
      if (ev.type !== 'land') continue;
      const strike = strikeCue(ev.move);
      const react = takeCue(ev.move, ev.result);
      this.timer(ev.at - (STRIKE_LEAD[strike] ?? 0), () => this.cue(b, ev.by, strike));
      this.timer(ev.at - (REACT_LEAD[react] ?? 0), () => this.cue(b, otherSide(ev.by), react));
    }
  }

  private plates(b: Bout): [RingPlate, RingPlate] {
    const [a, c] = b.ring.boxes;
    const gap = Math.abs(centre(c) - centre(a));
    const width = Math.max(PLATE_MIN, Math.min(PLATE_MAX, gap - 10));
    const plate = (seat: Side): RingPlate => {
      const box = b.ring.boxes[seat];
      const id = b.ids[seat];
      return {
        x: centre(box), y: Math.max(2, Math.round(box.y - PLATE_ABOVE)), width,
        name: this.text.names[id], color: PET_COLORS[id],
      };
    };
    return [plate(0), plate(1)];
  }

  private bar(side: RingSide, hp: number, fury: number): RingMsg {
    return { op: 'bar', side, hp, fury: Math.round(fury) };
  }

  /** Runs `fn` `ms` from now, unless the match has been stopped by then. */
  private timer(ms: number, fn: () => void): Timer {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, Math.max(0, ms));
    this.timers.add(t);
    return t;
  }

  private cancel(t: Timer | null): void {
    if (t === null) return;
    clearTimeout(t);
    this.timers.delete(t);
  }

  /** The pet of `seat` plays `cue`; one that does not hold goes back on guard when its movement is over. */
  private cue(b: Bout, seat: Side, cue: FightCue, windMs?: number): void {
    if (b.over) return;
    const dir = dirOf(seat);
    this.cancel(b.settle[seat]);
    b.settle[seat] = null;
    this.host.cue(b.ids[seat], cue, dir);
    b.nudgers[seat].start(cue, Date.now(), dir, windMs);
    this.nudge ??= setInterval(() => this.nudgeTick(), NUDGE_MS);
    if (SETTLING.has(cue)) b.settle[seat] = this.timer(nudgeSettles(cue) + SETTLE_PAD, () => this.cue(b, seat, 'guard'));
  }

  /** Puts each window where its cue's movement has it now; stops once nothing moves. */
  private nudgeTick(): void {
    const now = Date.now();
    let moving = false;
    for (const b of this.bouts) {
      if (b.over) continue;
      for (const seat of [0, 1] as const) {
        const off = b.nudgers[seat].offset(now);
        const to = keepInside({ x: b.stands[seat].x + off.dx, y: b.stands[seat].y + off.dy }, b.sizes[seat], b.area);
        const was = b.placed[seat];
        if (to.x !== was.x || to.y !== was.y) {
          b.placed[seat] = to;
          this.host.place(b.ids[seat], to);
        }
        if (b.nudgers[seat].moving(now)) moving = true;
      }
    }
    if (!moving) this.stopNudge();
  }

  private play(b: Bout, ev: FightEvent): void {
    if (b.over) return;
    switch (ev.type) {
      case 'ready':
        this.cue(b, 0, 'guard');
        this.cue(b, 1, 'guard');
        return;
      case 'bell':
        this.send(b, { op: 'banner', kind: 'fight', text: this.text.fight, ms: BANNER_MS.fight });
        return;
      case 'wind':
        this.cue(b, ev.by, windCue(ev.move), ev.ms);
        return;
      case 'land':
        this.land(b, ev);
        return;
      case 'shout': {
        const line = fightLine(this.text.lines, ev.kind, ev.variant);
        if (line) this.host.say(b.ids[ev.by], line, Math.min(speechMs(line), SHOUT_MAX_MS));
        return;
      }
      case 'ko': {
        this.cue(b, ev.seat, 'ko');
        const box = b.ring.boxes[ev.seat];
        b.stars = { x: centre(box) - dirOf(ev.seat) * 80, y: Math.round(box.y + box.height * 0.14) };
        this.send(
          b,
          { op: 'banner', kind: 'ko', text: this.text.ko, ms: BANNER_MS.ko },
          { op: 'stars', ...b.stars, on: true },
        );
        return;
      }
      case 'win': {
        this.cue(b, ev.seat, 'win');
        if (ev.how === 'points') this.cue(b, otherSide(ev.seat), 'lose');
        const box = b.ring.boxes[ev.seat];
        const msgs: RingMsg[] = [
          { op: 'banner', kind: 'win', text: this.text.win(this.text.names[b.ids[ev.seat]]), ms: BANNER_MS.win },
          { op: 'confetti', x: centre(box), y: Math.round(box.y + box.height * 0.1) },
        ];
        if (b.stars) msgs.push({ op: 'stars', ...b.stars, on: false });
        b.stars = null;
        this.send(b, ...msgs);
        return;
      }
      case 'draw':
        this.cue(b, 0, 'draw');
        this.cue(b, 1, 'draw');
        this.send(b, { op: 'banner', kind: 'draw', text: this.text.draw, ms: BANNER_MS.draw });
        return;
      case 'end':
        this.finish(b);
    }
  }

  /** The blow lands: the numbers, the flash and the bars; the pets' own cues began a moment before. */
  private land(b: Bout, ev: Land): void {
    const to = otherSide(ev.by);
    const box = b.ring.boxes[to];
    const x = Math.round(centre(box) + dirOf(to) * box.width * 0.16);
    const y = Math.round(box.y + box.height * 0.36);
    const special = ev.move === 'special';
    const msgs: RingMsg[] = [];
    switch (ev.result) {
      case 'dodge':
        msgs.push({ op: 'pop', x: centre(box), y, kind: 'dodge', text: this.text.miss });
        break;
      case 'block':
        msgs.push(
          { op: 'spark', x, y, kind: 'block' },
          { op: 'pop', x, y, kind: 'block', text: `${this.text.block} -${ev.dmg}` },
        );
        break;
      case 'crit':
        msgs.push(
          { op: 'spark', x, y, kind: special ? 'special' : 'crit' },
          { op: 'pop', x, y, kind: 'crit', text: `${this.text.crit} -${ev.dmg}` },
        );
        break;
      case 'hit':
        msgs.push(
          { op: 'spark', x, y, kind: special ? 'special' : 'hit' },
          { op: 'pop', x, y, kind: 'hit', text: `-${ev.dmg}` },
        );
        break;
    }
    msgs.push(this.bar(0, ev.hp[0], ev.fury[0]), this.bar(1, ev.hp[1], ev.fury[1]));
    if (ev.combo >= 2 && (ev.result === 'hit' || ev.result === 'crit')) {
      msgs.push({ op: 'combo', side: ev.by, text: this.text.combo(ev.combo) });
    }
    this.send(b, ...msgs);
  }

  private send(b: Bout, ...msgs: RingMsg[]): void {
    b.handle?.send(msgs);
  }

  /** The bout is over: the overlay closes, the pets are let go, and the next bouts begin once all of these are over. */
  private finish(b: Bout): void {
    this.close(b);
    this.bouts = this.bouts.filter((other) => other !== b);
    if (this.bouts.length > 0 || this.next()) return;
    this.done = true;
    this.onEnd();
  }

  private close(b: Bout): void {
    if (b.over) return;
    b.over = true;
    for (const t of b.settle) this.cancel(t);
    b.handle?.close();
    b.handle = null;
    for (const id of b.ids) this.host.release(id);
  }
}
