/**
 * The mahjong scene's table: the room, the felt and every tile on it. It plays what the director tells it (a shuffle, a
 * roll of the dice, a deal, a draw, a throw, a claim, a win) by moving tiles about with tweens. It knows where the tiles
 * are, not what the game is: the tiles in a rack are face down, so which one a pet throws is only for show.
 */

import * as PIXI from 'pixi.js';
import { HAND_SIZE, type Meld } from '../../shared/teammate/mahjong';
import { DECOR_SCALE, TABLE_PAD, type Decor } from './decor';
import {
  CENTER, MELD, RACK, SEAT_X, TABLE, claimSide, meldSlots, meldWidth, poolSlot, rackSlot, rackWidth, type Point,
} from './layout';
import type { Sounds } from './sound';
import { TILE_SCALE } from './tileArt';
import type { TileSet } from './tiles';
import { Tweens, easeInOut, easeOut, easeOutBack, linear, tumbleAt, type Ease } from './tween';

const UNIT = 1 / TILE_SCALE;
const SEATS = SEAT_X.length;
const TAU = Math.PI * 2;
/** How many tiles wash about the table while they are shuffled. */
const CLOUD = 28;
/** How much a winning hand grows, and how far the hands of the others fade. */
const WIN_ZOOM = 1.6;
const WIN_DIM = 0.5;
const CONFETTI = 90;
const CONFETTI_COLORS = [0xe8453c, 0xf5b83d, 0x4cb86a, 0x3d8be8, 0xb06ae8, 0xffffff] as const;
/** What a plain white texture measures, which the confetti is scaled from. */
const WHITE = 16;

interface Pose {
  x: number;
  y: number;
  s: number;
  r: number;
}

interface Glide {
  delay?: number;
  ease?: Ease;
  /** How high it arcs on the way, in px. */
  arc?: number;
  /** How much bigger it is half way, as a scale. */
  pop?: number;
  done?: () => void;
}

/** One tile: a box that moves, scales and turns, holding the picture, which turns over by narrowing and widening. */
class Tile {
  readonly box = new PIXI.Container();
  readonly art: PIXI.Sprite;
  /** Which tile it shows, or -1 while it shows its back. */
  kind = -1;

  constructor(private readonly set: TileSet) {
    this.art = new PIXI.Sprite(set.back);
    this.art.anchor.set(0.5);
    this.art.scale.set(UNIT);
    this.box.addChild(this.art);
  }

  get up(): boolean {
    return this.kind >= 0;
  }

  setFace(kind: number): void {
    this.kind = kind;
    this.art.texture = this.set.face(kind);
  }
}

interface SeatState {
  pool: PIXI.Container;
  hand: PIXI.Container;
  /** The tiles in the rack, left to right; the last stands apart while `drawn`. */
  rack: Tile[];
  drawn: boolean;
  /** The sets laid out, with which tile of each lies on its side. */
  melds: Tile[][];
  sides: number[];
  /** What it has thrown, oldest first: the last is the one the next player may claim. */
  thrown: Tile[];
}

/** A tile washing about the table: it goes round an ellipse about the middle. */
interface Orbiter {
  t: Tile;
  a: number;
  w: number;
  rx: number;
  ry: number;
}

interface Bit {
  sprite: PIXI.Sprite;
  sx: number;
  sy: number;
  vx: number;
  vy: number;
  vr: number;
  phase: number;
  age: number;
}

const CONFETTI_LIFE = 3800;

export class MahjongStage {
  readonly root = new PIXI.Container();
  /** The layer the pets go in: behind the table, so they seem to sit at it. */
  readonly actors = new PIXI.Container();
  private readonly tweens = new Tweens();
  private readonly pools = new PIXI.Container();
  private readonly hands = new PIXI.Container();
  private readonly centre = new PIXI.Container();
  private readonly fly = new PIXI.Container();
  private readonly fx = new PIXI.Container();
  private readonly seats: SeatState[] = SEAT_X.map(() => ({
    pool: new PIXI.Container(), hand: new PIXI.Container(), rack: [], drawn: false, melds: [], sides: [], thrown: [],
  }));
  private readonly cloudKey = {};
  private cloud: Orbiter[] = [];
  private cloudK = 1;
  private dice: PIXI.Sprite[] = [];
  private bits: Bit[] = [];

  constructor(
    private readonly tiles: TileSet,
    private readonly decor: Decor,
    private readonly sounds: Sounds,
    private readonly random: () => number = Math.random,
  ) {
    const bg = new PIXI.Sprite(decor.bg);
    const table = new PIXI.Sprite(decor.table);
    table.scale.set(1 / DECOR_SCALE);
    table.position.set(TABLE.x - TABLE_PAD, TABLE.y - TABLE_PAD);
    for (const s of this.seats) {
      this.pools.addChild(s.pool);
      this.hands.addChild(s.hand);
    }
    this.centre.sortableChildren = true;
    this.actors.sortableChildren = true;
    this.root.addChild(bg, this.actors, table, this.pools, this.hands, this.centre, this.fly, this.fx);
  }

  /** Moves everything on by `dtMs`. */
  tick(dtMs: number): void {
    this.tweens.tick(dtMs);
    for (const o of this.cloud) {
      o.a += o.w * dtMs;
      o.t.box.position.set(CENTER.x + Math.cos(o.a) * o.rx * this.cloudK, CENTER.y + Math.sin(o.a) * o.ry * this.cloudK);
      o.t.box.rotation = o.a * 1.7;
      o.t.box.zIndex = o.t.box.y;
    }
    this.stepBits(dtMs);
  }

  /** Clears the table for a new round: every tile, the dice and the confetti are gone and the hands are back to size. */
  reset(): void {
    this.tweens.clear();
    this.clearCloud();
    for (const s of this.seats) {
      for (const t of [...s.rack, ...s.thrown, ...s.melds.flat()]) t.box.destroy({ children: true });
      s.rack = [];
      s.thrown = [];
      s.melds = [];
      s.sides = [];
      s.drawn = false;
      s.hand.pivot.set(0, 0);
      s.hand.position.set(0, 0);
      s.hand.scale.set(1);
      s.hand.alpha = 1;
      s.pool.alpha = 1;
      this.hands.addChild(s.hand);
    }
    for (const c of [...this.fly.children, ...this.centre.children, ...this.fx.children]) c.destroy({ children: true });
    this.dice = [];
    this.bits = [];
  }

  destroy(): void {
    this.reset();
    this.root.destroy({ children: true });
  }

  /** The tiles are washed about the middle of the table. */
  shuffle(ms: number): void {
    this.clearCloud();
    this.sounds.shuffle(ms);
    for (let i = 0; i < CLOUD; i++) {
      const t = this.spawn(this.centre);
      t.box.scale.set(0.95);
      this.cloud.push({
        t,
        a: this.random() * TAU,
        w: (this.random() < 0.5 ? -1 : 1) * (0.0012 + this.random() * 0.0022),
        rx: 24 + this.random() * 130,
        ry: 10 + this.random() * 46,
      });
    }
  }

  /** The shuffled tiles come together and the two dice are thrown, over `ms`. */
  roll(ms: number, values: readonly [number, number]): void {
    this.gatherCloud(ms);
    this.sounds.roll();
    for (const d of this.dice) d.destroy();
    this.dice = values.map((value, i) => this.throwDie(ms, value, i === 0 ? -1 : 1));
  }

  private throwDie(ms: number, value: number, side: number): PIXI.Sprite {
    const die = new PIXI.Sprite(this.decor.dice[0]);
    die.anchor.set(0.5);
    die.scale.set(1 / DECOR_SCALE);
    die.zIndex = 1000;
    die.visible = false;
    this.centre.addChild(die);
    const endX = CENTER.x + side * 26;
    const endY = CENTER.y - side * 6;
    const startX = endX + side * 170;
    const tilt = side * 0.16;
    let shown = -1;
    let clacks = 0;
    this.tweens.add({
      key: die,
      dur: ms,
      ease: linear,
      step: (k) => {
        const m = tumbleAt(k);
        die.visible = true;
        die.x = startX + (endX - startX) * m.p;
        die.y = endY - m.lift;
        die.rotation = tilt + side * m.spin * TAU * 3;
        const turn = Math.floor((k * ms) / 70);
        if (k >= 0.78) die.texture = this.decor.dice[value - 1] ?? this.decor.dice[0] ?? die.texture;
        else if (turn !== shown) {
          shown = turn;
          die.texture = this.decor.dice[Math.floor(this.random() * 6)] ?? die.texture;
        }
        if ((k >= 0.4 && clacks === 0) || (k >= 0.65 && clacks === 1)) {
          clacks++;
          this.sounds.clack(clacks === 1 ? 0.7 : 0.45);
        }
      },
    });
    return die;
  }

  /** The tiles are dealt from the middle to the four racks, four at a time, from the dealer round, over `ms`. */
  deal(ms: number, dealer: number): void {
    this.clearCloud();
    const flight = 380;
    const gap = Math.max(8, (ms - flight) / (SEATS * HAND_SIZE - 1));
    const order: { seat: number; index: number }[] = [];
    for (let round = 0; round < 3; round++) {
      for (let k = 0; k < SEATS; k++) {
        for (let j = 0; j < 4; j++) order.push({ seat: (dealer + k) % SEATS, index: round * 4 + j });
      }
    }
    for (let k = 0; k < SEATS; k++) order.push({ seat: (dealer + k) % SEATS, index: HAND_SIZE - 1 });
    order.forEach(({ seat, index }, n) => {
      const s = this.seats[seat];
      if (!s) return;
      const t = this.spawn(s.hand);
      t.box.visible = false;
      s.rack.push(t);
      const slot = rackSlot(seat, index, HAND_SIZE, false);
      this.glide(t, { x: slot.x, y: slot.y, s: RACK.scale, r: 0 }, flight, {
        delay: n * gap,
        ease: easeOut,
        arc: 40,
        done: () => {
          if (n % 2 === 0) this.sounds.tick();
        },
      });
    });
  }

  /** `seat` takes a tile from the wall and holds it a little apart from its rack. */
  draw(seat: number): void {
    const s = this.seats[seat];
    if (!s) return;
    s.drawn = false;
    const t = this.spawn(s.hand);
    s.rack.push(t);
    s.drawn = true;
    this.layoutRack(seat, 170);
    const slot = rackSlot(seat, s.rack.length - 1, s.rack.length, true);
    this.glide(t, { x: slot.x, y: slot.y, s: RACK.scale, r: 0 }, 300, { ease: easeOut, arc: 26 });
    this.sounds.tick();
  }

  /** `seat` throws `kind` into its pool: the tile it has just drawn when `fromDrawn`, else one of the rack. */
  discard(seat: number, kind: number, fromDrawn: boolean): void {
    const s = this.seats[seat];
    if (!s) return;
    const t = this.takeFromRack(s, fromDrawn) ?? this.spawn(this.fly);
    s.drawn = false;
    this.fly.addChild(t.box);
    const slot = poolSlot(seat, s.thrown.length);
    s.thrown.push(t);
    this.flip(t, kind, 130);
    this.layoutRack(seat, 170);
    this.glide(t, { x: slot.x, y: slot.y, s: 1, r: 0 }, 300, {
      ease: easeOut,
      arc: 36,
      pop: 0.3,
      done: () => {
        s.pool.addChild(t.box);
        this.sounds.clack();
      },
    });
  }

  /** `seat` claims the tile just thrown, takes two from its rack and lays the three out beside it. */
  call(seat: number, meld: Meld): void {
    const s = this.seats[seat];
    if (!s) return;
    const claimed = this.seats[meld.from]?.thrown.pop() ?? this.spawn(s.hand);
    claimed.setFace(meld.claimed);
    const own = [this.takeFromRack(s, false) ?? this.spawn(s.hand), this.takeFromRack(s, false) ?? this.spawn(s.hand)];
    s.drawn = false;
    const side = claimSide(seat, meld.from, meld.tiles, meld.claimed, meld.kind === 'chow');
    let next = 0;
    const set = [0, 1, 2].map((i) => {
      if (i === side) return claimed;
      const t = own[next++] as Tile;
      this.flip(t, meld.tiles[i] ?? meld.claimed, 140);
      return t;
    });
    for (const t of set) s.hand.addChild(t.box);
    s.melds.push(set);
    s.sides.push(side);
    this.layoutMelds(seat, 380, s.melds.length - 1);
    this.layoutRack(seat, 200);
    this.sounds.call();
  }

  /**
   * `seat` wins with `tile` on top of `hand`, the tile coming from the wall (`from` is null) or from what seat `from`
   * threw: the tiles of its rack turn over one by one, the hand grows so it can be read, and the others dim.
   */
  win(seat: number, from: number | null, tile: number, hand: readonly number[]): void {
    const s = this.seats[seat];
    if (!s) return;
    s.drawn = false;
    if (from !== null) {
      const t = this.seats[from]?.thrown.pop() ?? this.spawn(s.hand);
      s.hand.addChild(t.box);
      s.rack.push(t);
    }
    this.fit(seat, hand.length + 1);
    s.drawn = s.rack.length > 1;
    const faces = [...hand, tile];
    s.rack.forEach((t, i) => this.flip(t, faces[i] ?? tile, 170, 500 + i * 45));
    this.layoutRack(seat, 300);

    const cx = SEAT_X[seat] ?? CENTER.x;
    const top = RACK.y - 22;
    s.hand.pivot.set(cx, top);
    s.hand.position.set(cx, top);
    const half = (Math.max(rackWidth(s.rack.length, true), meldWidth(s.sides)) / 2) * WIN_ZOOM + 14;
    const shift = Math.min(TABLE.x + TABLE.w - half, Math.max(TABLE.x + half, cx)) - cx;
    this.hands.addChild(s.hand);
    this.tweens.add({
      key: s.hand,
      dur: 600,
      delay: 400,
      ease: easeOutBack,
      step: (k) => {
        s.hand.scale.set(1 + (WIN_ZOOM - 1) * k);
        s.hand.x = cx + shift * k;
      },
    });
    for (const o of this.seats) {
      if (o === s) continue;
      for (const layer of [o.hand, o.pool]) {
        this.tweens.add({ key: layer, dur: 400, step: (k) => (layer.alpha = 1 - (1 - WIN_DIM) * k) });
      }
    }
    this.burst(cx);
    this.sounds.win();
  }

  private spawn(parent: PIXI.Container, at: Point = CENTER): Tile {
    const t = new Tile(this.tiles);
    t.box.position.set(at.x, at.y);
    t.box.scale.set(0.9);
    parent.addChild(t.box);
    return t;
  }

  private put(t: Tile, p: Pose): void {
    t.box.position.set(p.x, p.y);
    t.box.scale.set(p.s);
    t.box.rotation = p.r;
  }

  /** Takes a tile out of `s`'s rack: the drawn one if asked and there is one, else any of the rest. */
  private takeFromRack(s: SeatState, drawn: boolean): Tile | undefined {
    if (s.rack.length === 0) return undefined;
    const loose = s.rack.length - (s.drawn ? 1 : 0);
    if ((drawn && s.drawn) || loose <= 0) return s.rack.pop();
    return s.rack.splice(Math.min(loose - 1, Math.floor(this.random() * loose)), 1)[0];
  }

  /** Makes the rack hold `count` tiles, whatever it held, so a plan the stage did not follow does not leave a gap. */
  private fit(seat: number, count: number): void {
    const s = this.seats[seat];
    if (!s) return;
    while (s.rack.length < count) {
      const t = this.spawn(s.hand);
      s.rack.push(t);
      const p = rackSlot(seat, s.rack.length - 1, count, true);
      this.put(t, { x: p.x, y: p.y, s: RACK.scale, r: 0 });
    }
    while (s.rack.length > count) {
      const t = s.rack.pop() as Tile;
      this.tweens.stop(t);
      this.tweens.stop(t.art);
      t.box.destroy({ children: true });
    }
  }

  /** Slides `t` to `to`, from where it is when it starts. */
  private glide(t: Tile, to: Pose, dur: number, o: Glide = {}): void {
    let from: Pose | null = null;
    this.tweens.add({
      key: t,
      dur,
      delay: o.delay,
      ease: o.ease ?? easeInOut,
      step: (k) => {
        from ??= { x: t.box.x, y: t.box.y, s: t.box.scale.x, r: t.box.rotation };
        t.box.visible = true;
        t.box.x = from.x + (to.x - from.x) * k;
        t.box.y = from.y + (to.y - from.y) * k - (o.arc ?? 0) * 4 * k * (1 - k);
        t.box.scale.set(from.s + (to.s - from.s) * k + (o.pop ?? 0) * Math.sin(Math.PI * k));
        t.box.rotation = from.r + (to.r - from.r) * k;
      },
      done: o.done,
    });
  }

  /** Turns `t` over to show `kind`: it narrows to an edge, changes its picture and widens again. */
  private flip(t: Tile, kind: number, dur: number, delay = 0): void {
    if (t.kind === kind) return;
    let swapped = false;
    this.tweens.add({
      key: t.art,
      dur,
      delay,
      ease: linear,
      step: (k) => {
        if (k >= 0.5 && !swapped) {
          swapped = true;
          t.setFace(kind);
        }
        t.art.scale.x = UNIT * Math.abs(Math.cos(k * Math.PI));
      },
      done: () => t.art.scale.set(UNIT),
    });
  }

  private layoutRack(seat: number, dur: number): void {
    const s = this.seats[seat];
    if (!s) return;
    s.rack.forEach((t, i) => {
      const p = rackSlot(seat, i, s.rack.length, s.drawn);
      this.glide(t, { x: p.x, y: p.y, s: RACK.scale, r: 0 }, dur, { ease: easeOut });
    });
  }

  /** Lays the sets of `seat` out in a row; the set `fresh` arrives in an arc, the others only shift to make room. */
  private layoutMelds(seat: number, dur: number, fresh: number): void {
    const s = this.seats[seat];
    if (!s) return;
    const slots = meldSlots(seat, s.sides);
    s.melds.forEach((set, m) => {
      set.forEach((t, i) => {
        const p = slots[m]?.[i];
        if (!p) return;
        this.glide(t, { x: p.x, y: p.y, s: MELD.scale, r: p.turned ? Math.PI / 2 : 0 }, dur, { arc: m === fresh ? 22 : 0 });
      });
    });
  }

  private clearCloud(): void {
    this.tweens.stop(this.cloudKey);
    for (const o of this.cloud) o.t.box.destroy({ children: true });
    this.cloud = [];
    this.cloudK = 1;
  }

  /** The tiles that were washing about come together over `ms` and fade, as the dice are thrown. */
  private gatherCloud(ms: number): void {
    this.tweens.add({
      key: this.cloudKey,
      dur: ms,
      ease: easeInOut,
      step: (k) => {
        this.cloudK = 1 - 0.92 * k;
        const fade = Math.max(0, (k - 0.55) / 0.45);
        for (const o of this.cloud) o.t.box.alpha = 1 - fade;
      },
      done: () => this.clearCloud(),
    });
  }

  private burst(x: number): void {
    for (let i = 0; i < CONFETTI; i++) {
      const w = 5 + this.random() * 4;
      const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
      sprite.anchor.set(0.5);
      sprite.tint = CONFETTI_COLORS[Math.floor(this.random() * CONFETTI_COLORS.length)] ?? 0xffffff;
      sprite.position.set(x + (this.random() - 0.5) * 300, 30 + this.random() * 60);
      sprite.visible = false;
      this.fx.addChild(sprite);
      this.bits.push({
        sprite,
        sx: w / WHITE,
        sy: (w * 1.6) / WHITE,
        vx: (this.random() - 0.5) * 0.08,
        vy: 0.03 + this.random() * 0.1,
        vr: (this.random() - 0.5) * 0.012,
        phase: this.random() * TAU,
        age: -this.random() * 400,
      });
    }
  }

  private stepBits(dtMs: number): void {
    if (this.bits.length === 0) return;
    for (const b of this.bits) {
      b.age += dtMs;
      if (b.age < 0) continue;
      b.vy += 0.00012 * dtMs;
      b.sprite.visible = true;
      b.sprite.x += (b.vx + Math.sin(b.age * 0.004 + b.phase) * 0.03) * dtMs;
      b.sprite.y += b.vy * dtMs;
      b.sprite.rotation += b.vr * dtMs;
      b.sprite.scale.set(b.sx * Math.cos(b.age * 0.008 + b.phase), b.sy);
      b.sprite.alpha = Math.min(1, (CONFETTI_LIFE - b.age) / 600);
    }
    if (this.bits.some((b) => b.age >= CONFETTI_LIFE)) {
      for (const b of this.bits) if (b.age >= CONFETTI_LIFE) b.sprite.destroy();
      this.bits = this.bits.filter((b) => b.age < CONFETTI_LIFE);
    }
  }
}
