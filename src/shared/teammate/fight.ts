/**
 * A boxing match between two desktop pets, worked out ahead of time like a mahjong round: the bout is a list of timed
 * events that the two pets' windows then act out. Everything here is a function of the injected random, so a bout is
 * the same every time for the same seed and the rules can be tested without a window.
 */

import { keepInside } from './pet';

/** The two corners of a bout: side 0 stands on the left and faces right, side 1 the other way round. */
export type Side = 0 | 1;
export const otherSide = (s: Side): Side => (s === 0 ? 1 : 0);

export type Move = 'jab' | 'hook' | 'upper' | 'special';
/** How a blow lands: it hurts, hurts more, is blocked (a little damage) or dodged (none). */
export type Result = 'hit' | 'crit' | 'block' | 'dodge';
/** What a pet says, and when: the words for each kind are in the user's language (see `FightLines`). */
export type ShoutKind = 'ready' | 'special' | 'crit' | 'dodge' | 'hurt' | 'lose' | 'win' | 'draw';

export type FightEvent =
  /** The pets stand facing each other. */
  | { at: number; type: 'ready' }
  /** The bell: the first blow comes soon. */
  | { at: number; type: 'bell' }
  /** `by` draws back for `ms`, and then the blow lands. */
  | { at: number; type: 'wind'; by: Side; move: Move; ms: number }
  /** The blow lands (or is dodged); `hp` and `fury` are each fighter's after it. */
  | {
    at: number; type: 'land'; by: Side; move: Move; result: Result; dmg: number; combo: number;
    hp: [number, number]; fury: [number, number];
  }
  | { at: number; type: 'shout'; by: Side; kind: ShoutKind; variant: number }
  | { at: number; type: 'ko'; seat: Side }
  | { at: number; type: 'win'; seat: Side; how: 'ko' | 'points' }
  | { at: number; type: 'draw' }
  | { at: number; type: 'end' };

export interface FightPlan {
  /** In time order; `at` is ms from the moment both pets stand ready. */
  events: FightEvent[];
  /** When the bout is over and the pets walk home. */
  end: number;
  /** Null for a draw. */
  winner: Side | null;
  /** Blows thrown, dodged ones too. */
  strikes: number;
}

export const MAX_HP = 100;
/** A fighter whose fury has filled throws a special blow with its next attack. */
export const FURY_FULL = 100;
/** A bout that has not ended in a knockout by this many blows is decided on points. */
export const MAX_STRIKES = 26;
const MAX_COMBO = 3;

interface MoveSpec {
  /** How long the fighter draws back before the blow lands. */
  wind: number;
  /** The least and most damage a clean hit does. */
  dmg: readonly [number, number];
  /** The chance the other side blocks it, and the chance it dodges it. */
  block: number;
  dodge: number;
  /** How likely it is to be chosen when no special is ready. */
  weight: number;
}

export const MOVES: Record<Move, MoveSpec> = {
  jab: { wind: 380, dmg: [9, 13], block: 0.3, dodge: 0.16, weight: 0.5 },
  hook: { wind: 560, dmg: [14, 19], block: 0.24, dodge: 0.24, weight: 0.3 },
  upper: { wind: 720, dmg: [18, 25], block: 0.14, dodge: 0.3, weight: 0.2 },
  special: { wind: 1400, dmg: [34, 44], block: 0.06, dodge: 0.1, weight: 0 },
};

const CRIT_CHANCE = 0.12;
const CRIT_FACTOR = 1.5;
/** A blocked blow still does this much of its damage. */
const BLOCK_FACTOR = 0.25;
/** A fighter gains fury from each clean hit it takes, and a little for landing one. */
const FURY_TAKEN = 1.5;
const FURY_BLOCKED = 0.6;
const FURY_LANDED = 3;
/** After a clean hit, the chance the same fighter follows up at once. */
const CHAIN_CHANCE = 0.38;
/** After a dodge, the chance the dodger answers at once. */
const COUNTER_CHANCE = 0.6;
/** The chance the next blow is the other fighter's. */
const SWITCH_CHANCE = 0.62;

/** The stare-down: the pets stand ready, a word each, then the bell. */
export const BELL_AT = 1700;
const FIRST_WIND_AT = 2100;
/** After a blow lands the next wind-up comes no sooner than this, plus a short random wait. */
export const RECOVER_MS = 520;
const WAIT_MS = [200, 620] as const;
const COMBO_RECOVER_MS = 200;
/** After a knockout: the fall, the loser's word, the winner's pose. */
export const KO_AT = 300;
export const WIN_AT = 1500;
/** How long the winner enjoys it before the bout is over. */
export const WIN_SHOW_MS = 3400;
/** The same fighter does not make a remark of its own again this soon (the scripted shouts at the start and end aside). */
export const SHOUT_GAP_MS = 3600;

const between = (random: () => number, lo: number, hi: number): number => lo + random() * (hi - lo);

function pickMove(random: () => number): Move {
  const normal: Move[] = ['jab', 'hook', 'upper'];
  let r = random();
  for (const m of normal) {
    r -= MOVES[m].weight;
    if (r < 0) return m;
  }
  return 'jab';
}

/** The whole bout, from the moment both pets stand ready to the moment they leave; `maxStrikes` is for tests. */
export function planFight(random: () => number, maxStrikes = MAX_STRIKES): FightPlan {
  const events: FightEvent[] = [];
  const hp: [number, number] = [MAX_HP, MAX_HP];
  const fury: [number, number] = [0, 0];
  const lastShout: [number, number] = [-SHOUT_GAP_MS, -SHOUT_GAP_MS];

  events.push({ at: 0, type: 'ready' });
  events.push({ at: 300, type: 'shout', by: 0, kind: 'ready', variant: random() });
  events.push({ at: 1000, type: 'shout', by: 1, kind: 'ready', variant: random() });
  events.push({ at: BELL_AT, type: 'bell' });

  /** A word now and then: not for every blow, and a fighter does not talk over itself. */
  const shout = (by: Side, kind: ShoutKind, at: number, chance: number): void => {
    if (at - lastShout[by] < SHOUT_GAP_MS || random() >= chance) return;
    lastShout[by] = at;
    events.push({ at, type: 'shout', by, kind, variant: random() });
  };

  let at = FIRST_WIND_AT;
  let attacker: Side = random() < 0.5 ? 0 : 1;
  let run = 0;
  let strikes = 0;
  let knockedOut: Side | null = null;
  let lastLand = at;

  while (strikes < maxStrikes && knockedOut === null) {
    const to = otherSide(attacker);
    let combo = 0;
    let dodged = false;
    for (;;) {
      const move: Move = fury[attacker] >= FURY_FULL ? 'special' : pickMove(random);
      const spec = MOVES[move];
      const wind = combo === 0 ? spec.wind : Math.max(220, Math.round(spec.wind * 0.55));
      if (move === 'special') {
        fury[attacker] = 0;
        shout(attacker, 'special', at, 0.85);
      }
      events.push({ at, type: 'wind', by: attacker, move, ms: wind });
      const landAt = at + wind;
      const r = random();
      let result: Result = r < spec.dodge ? 'dodge' : r < spec.dodge + spec.block ? 'block' : 'hit';
      if (result === 'hit' && random() < CRIT_CHANCE) result = 'crit';
      let dmg = Math.round(between(random, spec.dmg[0], spec.dmg[1]));
      if (result === 'crit') dmg = Math.round(dmg * CRIT_FACTOR);
      else if (result === 'block') dmg = Math.max(1, Math.round(dmg * BLOCK_FACTOR));
      else if (result === 'dodge') dmg = 0;
      hp[to] = Math.max(0, hp[to] - dmg);
      if (result === 'hit' || result === 'crit') {
        fury[to] = Math.min(FURY_FULL, fury[to] + dmg * FURY_TAKEN);
        fury[attacker] = Math.min(FURY_FULL, fury[attacker] + FURY_LANDED);
      } else if (result === 'block') {
        fury[to] = Math.min(FURY_FULL, fury[to] + dmg * FURY_BLOCKED);
      }
      combo += 1;
      strikes += 1;
      lastLand = landAt;
      events.push({ at: landAt, type: 'land', by: attacker, move, result, dmg, combo, hp: [...hp], fury: [...fury] });
      if (hp[to] <= 0) {
        knockedOut = to;
        break;
      }
      if (result === 'crit') shout(attacker, 'crit', landAt + 250, 0.7);
      else if (result === 'hit' && dmg >= 20) shout(to, 'hurt', landAt + 300, 0.45);
      else if (result === 'dodge') shout(to, 'dodge', landAt + 300, 0.5);
      dodged = result === 'dodge';
      const landed = result === 'hit' || result === 'crit';
      if (move !== 'special' && landed && combo < MAX_COMBO && strikes < maxStrikes && random() < CHAIN_CHANCE) {
        at = landAt + COMBO_RECOVER_MS;
        continue;
      }
      at = landAt + RECOVER_MS;
      break;
    }
    if (knockedOut !== null) break;
    let next: Side = dodged && random() < COUNTER_CHANCE ? to : random() < SWITCH_CHANCE ? to : attacker;
    if (next === attacker && run >= 2) next = to;
    run = next === attacker ? run + 1 : 0;
    attacker = next;
    at += between(random, WAIT_MS[0], WAIT_MS[1]);
  }

  let winner: Side | null = null;
  let end: number;
  if (knockedOut !== null) {
    winner = otherSide(knockedOut);
    const koAt = lastLand + KO_AT;
    events.push({ at: koAt, type: 'ko', seat: knockedOut });
    events.push({ at: koAt + 700, type: 'shout', by: knockedOut, kind: 'lose', variant: random() });
    const winAt = koAt + WIN_AT;
    events.push({ at: winAt, type: 'win', seat: winner, how: 'ko' });
    events.push({ at: winAt + 250, type: 'shout', by: winner, kind: 'win', variant: random() });
    end = winAt + WIN_SHOW_MS;
  } else if (hp[0] !== hp[1]) {
    winner = hp[0] > hp[1] ? 0 : 1;
    const winAt = lastLand + 1100;
    events.push({ at: winAt, type: 'win', seat: winner, how: 'points' });
    events.push({ at: winAt + 250, type: 'shout', by: winner, kind: 'win', variant: random() });
    events.push({ at: winAt + 900, type: 'shout', by: otherSide(winner), kind: 'lose', variant: random() });
    end = winAt + WIN_SHOW_MS;
  } else {
    const drawAt = lastLand + 1100;
    events.push({ at: drawAt, type: 'draw' });
    events.push({ at: drawAt + 250, type: 'shout', by: 0, kind: 'draw', variant: random() });
    events.push({ at: drawAt + 900, type: 'shout', by: 1, kind: 'draw', variant: random() });
    end = drawAt + WIN_SHOW_MS;
  }
  events.push({ at: end, type: 'end' });
  // A stable sort: events at the same moment stay in the order they were made.
  events.sort((a, b) => a.at - b.at);
  return { events, end, winner, strikes };
}

/** The lines a pet says, by kind; each is a list to pick from. */
export type FightLines = Record<ShoutKind, readonly string[]>;

/** The line for a shout, picked by `variant` (0 up to 1); null when the language has none. */
export function fightLine(lines: FightLines, kind: ShoutKind, variant: number): string | null {
  const list = lines[kind];
  if (!list || list.length === 0) return null;
  return list[Math.min(list.length - 1, Math.max(0, Math.floor(variant * list.length)))];
}

/** Shuffles `ids` with the random and takes them two by two; with an odd number one is left over. */
export function pairUp<T>(ids: readonly T[], random: () => number): { pairs: [T, T][]; spare: T | null } {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const pairs: [T, T][] = [];
  for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
  return { pairs, spare: order.length % 2 === 1 ? order[order.length - 1] : null };
}

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Area = Point & Size;

/** How close the two pets of a bout stand, as a fraction of their windows' widths side by side: a little overlap, as art is narrower than its window. */
export const STAND_RATIO = 0.9;
/** Space under the pets and to the display's edge. */
const ARENA_MARGIN = 12;

/** How many bouts fit side by side on a display. */
export function boutsFit(area: Area, sizes: readonly Size[]): number {
  const widest = sizes.reduce((m, s) => Math.max(m, s.width), 0);
  return Math.max(1, Math.floor(area.width / (widest * 2 * STAND_RATIO + 40)));
}

/**
 * Where the two pets of bout `index` of `count` stand, as top-left corners of their windows: the bouts are spread
 * along the bottom of the display, each pair meeting in the middle of its share.
 */
export function arenaStands(area: Area, index: number, count: number, sizes: readonly [Size, Size]): [Point, Point] {
  const cx = area.x + (area.width * (index + 0.5)) / Math.max(1, count);
  const centres = ((sizes[0].width + sizes[1].width) / 2) * STAND_RATIO;
  const at = (size: Size, centre: number): Point => keepInside(
    { x: Math.round(centre - size.width / 2), y: area.y + area.height - size.height - ARENA_MARGIN }, size, area,
  );
  return [at(sizes[0], cx - centres / 2), at(sizes[1], cx + centres / 2)];
}

/** Room the overlay of a bout leaves at either side of the two pets, and above them for the bars. */
export const RING_SIDE = 70;
export const RING_ABOVE = 100;

export interface Ring {
  /** The overlay's window, in screen DIPs. */
  rect: Area;
  /** The two pets' windows, in the overlay's own DIPs. */
  boxes: [Area, Area];
}

/** The overlay that covers the two pets standing at `stands`, kept inside `area`. */
export function ringOf(stands: readonly [Point, Point], sizes: readonly [Size, Size], area: Area): Ring {
  const left = Math.max(area.x, Math.min(stands[0].x, stands[1].x) - RING_SIDE);
  const top = Math.max(area.y, Math.min(stands[0].y, stands[1].y) - RING_ABOVE);
  const right = Math.min(area.x + area.width, Math.max(stands[0].x + sizes[0].width, stands[1].x + sizes[1].width) + RING_SIDE);
  const bottom = Math.min(area.y + area.height, Math.max(stands[0].y + sizes[0].height, stands[1].y + sizes[1].height));
  const box = (i: 0 | 1): Area => ({ x: stands[i].x - left, y: stands[i].y - top, ...sizes[i] });
  return { rect: { x: left, y: top, width: right - left, height: bottom - top }, boxes: [box(0), box(1)] };
}
