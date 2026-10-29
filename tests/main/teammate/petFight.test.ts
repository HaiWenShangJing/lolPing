import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_AT_ONCE, PetFight, type FightHost, type FightText, type RingHandle } from '../../../src/main/teammate/petFight';
import type { RingMsg } from '../../../src/shared/ringMsg';
import {
  BELL_AT, arenaStands, fightLine, otherSide, pairUp, planFight, ringOf, type FightEvent, type FightLines, type Side,
} from '../../../src/shared/teammate/fight';
import { strikeCue, takeCue, windCue, type Dir, type FightCue } from '../../../src/shared/teammate/fightMotion';
import { PET_COLORS, PET_IDS, type PetId } from '../../../src/shared/teammate/pet';

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Area = Point & Size;
type Land = Extract<FightEvent, { type: 'land' }>;

const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const SIZE: Size = { width: 200, height: 260 };
const LINES: FightLines = {
  ready: ['ready one', 'ready two'], special: ['special'], crit: ['crit'], dodge: ['dodge'], hurt: ['hurt one', 'hurt two'],
  lose: ['lose'], win: ['win'], draw: ['draw'],
};
const NAMES = Object.fromEntries(PET_IDS.map((id) => [id, `Pet ${id}`])) as Record<PetId, string>;
const TEXT: FightText = {
  names: NAMES, fight: 'FIGHT!', ko: 'K.O.', win: (name) => `${name} wins`, draw: 'DRAW', miss: 'MISS', block: 'BLOCK',
  crit: 'CRIT', combo: (n) => `${n} HITS`, lines: LINES,
};

interface FakeRing {
  rect: Area;
  spots: Map<PetId, Point>;
  openedAt: number;
  closedAt: number | null;
  closes: number;
  sent: { t: number; msgs: RingMsg[] }[];
}

function must<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`nothing for ${String(key)}`);
  return value;
}

const closedAt = (ring: FakeRing): number => {
  if (ring.closedAt === null) throw new Error('the ring is still open');
  return ring.closedAt;
};

/** A screen and some pets on it that remembers everything it was told, and when. */
class FakeHost implements FightHost {
  display: Area = { x: 0, y: 0, width: 1920, height: 1040 };
  readonly sizes = new Map<PetId, Size>();
  readonly spots = new Map<PetId, Point>();
  readonly gone = new Set<PetId>();
  readonly refused = new Set<PetId>();
  readonly taken: { t: number; id: PetId }[] = [];
  readonly released: { t: number; id: PetId }[] = [];
  readonly runs: { id: PetId; dir: Dir }[] = [];
  readonly places: { t: number; id: PetId; to: Point }[] = [];
  readonly cues: { t: number; id: PetId; cue: FightCue; dir: Dir }[] = [];
  readonly says: { t: number; id: PetId; text: string; ms: number }[] = [];
  readonly rings: FakeRing[] = [];
  /** Messages that reached a ring after it was closed. */
  readonly late: RingMsg[] = [];

  constructor(ids: readonly PetId[], size: Size = SIZE) {
    ids.forEach((id, i) => {
      this.sizes.set(id, size);
      this.spots.set(id, { x: 40 + i * 110, y: 300 });
    });
  }

  size(id: PetId): Size | null {
    return this.gone.has(id) ? null : (this.sizes.get(id) ?? null);
  }

  at(id: PetId): Point | null {
    return this.gone.has(id) ? null : (this.spots.get(id) ?? null);
  }

  take(id: PetId): boolean {
    if (this.gone.has(id) || this.refused.has(id)) return false;
    this.taken.push({ t: Date.now(), id });
    return true;
  }

  place(id: PetId, to: Point): void {
    this.spots.set(id, to);
    this.places.push({ t: Date.now(), id, to });
  }

  run(id: PetId, dir: Dir): void {
    this.runs.push({ id, dir });
  }

  cue(id: PetId, cue: FightCue, dir: Dir): void {
    this.cues.push({ t: Date.now(), id, cue, dir });
  }

  say(id: PetId, text: string, ms: number): void {
    this.says.push({ t: Date.now(), id, text, ms });
  }

  release(id: PetId): void {
    this.released.push({ t: Date.now(), id });
  }

  area(): Area {
    return this.display;
  }

  openRing(rect: Area): RingHandle {
    const ring: FakeRing = { rect, spots: new Map(this.spots), openedAt: Date.now(), closedAt: null, closes: 0, sent: [] };
    this.rings.push(ring);
    return {
      send: (msgs) => {
        if (ring.closedAt !== null) this.late.push(...msgs);
        ring.sent.push({ t: Date.now(), msgs: [...msgs] });
      },
      close: () => {
        ring.closes += 1;
        ring.closedAt ??= Date.now();
      },
    };
  }

  /** How much has happened, to tell that nothing more does. */
  tally(): number[] {
    const sent = this.rings.reduce((n, r) => n + r.sent.length, 0);
    return [this.taken.length, this.released.length, this.places.length, this.cues.length, this.says.length, sent, this.rings.length];
  }
}

function begin(ids: readonly PetId[], seed: number, size: Size = SIZE) {
  const host = new FakeHost(ids, size);
  const onEnd = vi.fn();
  const fight = new PetFight(host, TEXT, lcg(seed), onEnd);
  return { host, onEnd, fight };
}

/** What a lone bout between `ids` will be, worked out with the same random numbers the director draws. */
function expected(host: FakeHost, ids: readonly [PetId, PetId], seed: number) {
  const random = lcg(seed);
  const [a, b] = pairUp(ids, random).pairs[0];
  const sizes: [Size, Size] = [must(host.sizes, a), must(host.sizes, b)];
  const stands = arenaStands(host.display, 0, 1, sizes);
  return { ids: [a, b] as [PetId, PetId], plan: planFight(random), stands, ring: ringOf(stands, sizes, host.display) };
}

/** Lets the clock run, a little at a time, until `done`. */
function until(done: () => boolean, limitMs = 900_000): void {
  for (let t = 0; t < limitMs && !done(); t += 50) vi.advanceTimersByTime(50);
  if (!done()) throw new Error('it did not happen in time');
}

const dirOf = (seat: Side): Dir => (seat === 0 ? 1 : -1);
const sorted = (ids: readonly PetId[]): PetId[] => [...ids].sort();
/** A plan's times are fractions of a millisecond; a timer waits a whole number of them, and at least one. */
const ms = (t: number): number => Math.max(1, Math.trunc(t));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PetFight start', () => {
  it('needs two pets: with fewer there is no match and nobody is taken', () => {
    for (const ids of [[], ['whale']] as PetId[][]) {
      const { host, onEnd, fight } = begin(ids, 1);
      expect(fight.start(ids)).toBe(false);
      expect(host.taken).toEqual([]);
      expect(host.rings).toEqual([]);
      expect(onEnd).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('sends the pair running to places that face each other, and opens the ring over them once both are there', () => {
    const ids: [PetId, PetId] = ['whale', 'mao'];
    const { host, fight } = begin(ids, 3);
    const from = new Map(host.spots);
    const want = expected(host, ids, 3);
    expect(fight.start(ids)).toBe(true);
    expect(sorted(host.taken.map((t) => t.id))).toEqual(sorted(ids));
    expect(host.rings).toHaveLength(0);
    for (const seat of [0, 1] as const) {
      const id = want.ids[seat];
      const goal = want.stands[seat];
      expect(host.runs[seat]).toEqual({ id, dir: goal.x >= must(from, id).x ? 1 : -1 });
    }
    until(() => host.rings.length > 0);
    const ring = host.rings[0];
    expect(ring.rect).toEqual(want.ring.rect);
    expect(must(ring.spots, want.ids[0])).toEqual(want.stands[0]);
    expect(must(ring.spots, want.ids[1])).toEqual(want.stands[1]);
    expect(want.stands[0].x).toBeLessThan(want.stands[1].x);
  });

  it('skips a pair when one of its pets cannot be taken, and lets go of the other', () => {
    const ids: [PetId, PetId] = ['whale', 'mao'];
    const { host, onEnd, fight } = begin(ids, 1);
    host.refused.add('mao');
    expect(fight.start(ids)).toBe(false);
    expect(sorted(host.released.map((r) => r.id))).toEqual(sorted(host.taken.map((t) => t.id)));
    expect(host.runs).toEqual([]);
    expect(host.rings).toEqual([]);
    expect(onEnd).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips a pet that is no longer showing', () => {
    const ids: [PetId, PetId] = ['whale', 'mao'];
    const { host, fight } = begin(ids, 1);
    host.gone.add('whale');
    expect(fight.start(ids)).toBe(false);
    expect(host.taken).toEqual([]);
  });

  it('still fights the other pairs when one cannot', () => {
    const ids: PetId[] = ['whale', 'naiwa', 'mao', 'rice'];
    const { host, onEnd, fight } = begin(ids, 2);
    host.refused.add('rice');
    expect(fight.start(ids)).toBe(true);
    until(() => onEnd.mock.calls.length > 0);
    expect(host.rings).toHaveLength(1);
    const fought = new Set(host.runs.map((r) => r.id));
    expect(fought.size).toBe(2);
    expect(fought.has('rice')).toBe(false);
    expect(sorted(host.released.map((r) => r.id))).toEqual(sorted(host.taken.map((t) => t.id)));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('PetFight bout', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`plays the bout that was planned, as it was planned (seed ${seed})`, () => {
      const ids: [PetId, PetId] = ['whale', 'mao'];
      const { host, onEnd, fight } = begin(ids, seed);
      const want = expected(host, ids, seed);
      fight.start(ids);
      until(() => onEnd.mock.calls.length > 0);
      vi.advanceTimersByTime(200);

      const ring = host.rings[0];
      const t0 = ring.openedAt;
      const { plan } = want;
      const idOf = (seat: Side): PetId => want.ids[seat];
      const cuesOf = (id: PetId) => host.cues.filter((c) => c.id === id).map((c) => ({ at: c.t - t0, cue: c.cue, dir: c.dir }));

      // One ring, closed when the bout ends, with the pets let go at the same moment.
      expect(host.rings).toHaveLength(1);
      expect(ring.closes).toBe(1);
      expect(closedAt(ring) - t0).toBe(ms(plan.end));
      expect(host.released).toHaveLength(2);
      for (const r of host.released) expect(r.t).toBe(closedAt(ring));
      expect(sorted(host.released.map((r) => r.id))).toEqual(sorted(ids));
      expect(host.late).toEqual([]);
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);

      // The plates and full bars come first.
      const first = ring.sent[0].msgs;
      expect(first[0].op).toBe('init');
      if (first[0].op !== 'init') throw new Error('unreachable');
      const [p0, p1] = first[0].plates;
      expect([p0.name, p1.name]).toEqual([NAMES[idOf(0)], NAMES[idOf(1)]]);
      expect([p0.color, p1.color]).toEqual([PET_COLORS[idOf(0)], PET_COLORS[idOf(1)]]);
      expect(p0.x).toBe(Math.round(want.ring.boxes[0].x + want.ring.boxes[0].width / 2));
      expect(p1.x).toBe(Math.round(want.ring.boxes[1].x + want.ring.boxes[1].width / 2));
      expect(p1.x - p0.x).toBeGreaterThanOrEqual(p0.width);
      expect(p0.y).toBeGreaterThanOrEqual(0);
      expect(first.slice(1)).toEqual([
        { op: 'bar', side: 0, hp: 100, fury: 0 }, { op: 'bar', side: 1, hp: 100, fury: 0 },
      ]);

      // Every blow lands in the overlay at its time, with the numbers it had in the plan.
      const sends = ring.sent.map(({ t, msgs }) => ({ at: t - t0, msgs }));
      const lands = plan.events.filter((e): e is Land => e.type === 'land');
      const landed = sends.filter((s) => s.msgs.some((m) => m.op === 'pop'));
      expect(landed.map((s) => s.at)).toEqual(lands.map((e) => ms(e.at)));
      for (const [i, ev] of lands.entries()) {
        const to = otherSide(ev.by);
        const box = want.ring.boxes[to];
        const msgs = landed[i].msgs;
        const pop = msgs.find((m) => m.op === 'pop');
        const text = ev.result === 'dodge' ? 'MISS'
          : ev.result === 'block' ? `BLOCK -${ev.dmg}`
            : ev.result === 'crit' ? `CRIT -${ev.dmg}` : `-${ev.dmg}`;
        expect(pop).toMatchObject({ kind: ev.result, text });
        if (pop?.op !== 'pop') throw new Error('unreachable');
        expect(pop.x).toBeGreaterThanOrEqual(box.x);
        expect(pop.x).toBeLessThanOrEqual(box.x + box.width);
        expect(pop.y).toBeGreaterThanOrEqual(box.y);
        expect(pop.y).toBeLessThanOrEqual(box.y + box.height);
        expect(msgs.filter((m) => m.op === 'bar')).toEqual([
          { op: 'bar', side: 0, hp: ev.hp[0], fury: Math.round(ev.fury[0]) },
          { op: 'bar', side: 1, hp: ev.hp[1], fury: Math.round(ev.fury[1]) },
        ]);
        const combo = msgs.filter((m) => m.op === 'combo');
        const clean = ev.result === 'hit' || ev.result === 'crit';
        expect(combo).toEqual(ev.combo >= 2 && clean ? [{ op: 'combo', side: ev.by, text: `${ev.combo} HITS` }] : []);
        // The flash is there for every blow that touches, and not for one that misses.
        expect(msgs.some((m) => m.op === 'spark')).toBe(ev.result !== 'dodge');
      }

      // The big words: the bell, a knockout, and the end.
      const banners = sends.flatMap(({ at, msgs }) =>
        msgs.flatMap((m) => (m.op === 'banner' ? [{ at, kind: m.kind, text: m.text }] : [])));
      const wanted = plan.events.flatMap((e) => {
        switch (e.type) {
          case 'bell': return [{ at: ms(e.at), kind: 'fight', text: 'FIGHT!' }];
          case 'ko': return [{ at: ms(e.at), kind: 'ko', text: 'K.O.' }];
          case 'win': return [{ at: ms(e.at), kind: 'win', text: `${NAMES[idOf(e.seat)]} wins` }];
          case 'draw': return [{ at: ms(e.at), kind: 'draw', text: 'DRAW' }];
          default: return [];
        }
      });
      expect(banners).toEqual(wanted);
      expect(banners[0].at).toBe(BELL_AT);

      // What each pet does: facing the other, on guard to start, winding up and striking ahead of the blow.
      for (const seat of [0, 1] as const) {
        const cues = cuesOf(idOf(seat));
        for (const c of cues) expect(c.dir).toBe(dirOf(seat));
        expect(cues[0]).toEqual({ at: ms(0), cue: 'guard', dir: dirOf(seat) });
        const last = cues[cues.length - 1].cue;
        expect(['ko', 'win', 'lose', 'draw']).toContain(last);
      }
      for (const ev of plan.events) {
        if (ev.type === 'wind') {
          expect(cuesOf(idOf(ev.by))).toContainEqual({ at: ms(ev.at), cue: windCue(ev.move), dir: dirOf(ev.by) });
        }
        if (ev.type !== 'land') continue;
        const strike = strikeCue(ev.move);
        const react = takeCue(ev.move, ev.result);
        const reactLead = react === 'dodge' ? 90 : react === 'block' ? 30 : 0;
        expect(cuesOf(idOf(ev.by))).toContainEqual({
          at: ms(ev.at - (strike === 'smash' ? 170 : 110)), cue: strike, dir: dirOf(ev.by),
        });
        expect(cuesOf(idOf(otherSide(ev.by)))).toContainEqual({
          at: ms(ev.at - reactLead), cue: react, dir: dirOf(otherSide(ev.by)),
        });
      }
      for (const ev of plan.events) {
        if (ev.type === 'ko') expect(cuesOf(idOf(ev.seat)).some((c) => c.cue === 'ko' && c.at === ms(ev.at))).toBe(true);
        if (ev.type === 'win') {
          expect(cuesOf(idOf(ev.seat)).some((c) => c.cue === 'win' && c.at === ms(ev.at))).toBe(true);
          const other = cuesOf(idOf(otherSide(ev.seat)));
          expect(other[other.length - 1].cue).toBe(ev.how === 'ko' ? 'ko' : 'lose');
        }
        if (ev.type === 'draw') {
          for (const id of ids) expect(cuesOf(id).some((c) => c.cue === 'draw' && c.at === ms(ev.at))).toBe(true);
        }
      }

      // The shouts are said by the one who shouts, in the words of its kind, and never for long.
      const shouts = plan.events.filter((e) => e.type === 'shout');
      expect(host.says.map((s) => ({ at: s.t - t0, id: s.id, text: s.text }))).toEqual(
        shouts.map((e) => ({ at: ms(e.at), id: idOf(e.by), text: fightLine(LINES, e.kind, e.variant) })),
      );
      for (const s of host.says) {
        expect(s.ms).toBeGreaterThan(0);
        expect(s.ms).toBeLessThanOrEqual(2600);
      }

      // Nothing was ever put off the display.
      for (const p of host.places) {
        const size = must(host.sizes, p.id);
        expect(p.to.x).toBeGreaterThanOrEqual(host.display.x);
        expect(p.to.y).toBeGreaterThanOrEqual(host.display.y);
        expect(p.to.x + size.width).toBeLessThanOrEqual(host.display.x + host.display.width);
        expect(p.to.y + size.height).toBeLessThanOrEqual(host.display.y + host.display.height);
      }
    });
  }

  it('never calls a pet back onto guard in the middle of a move, only when the move is over', () => {
    const ids: [PetId, PetId] = ['whale', 'mao'];
    const { host, onEnd, fight } = begin(ids, 4);
    fight.start(ids);
    until(() => onEnd.mock.calls.length > 0);
    const settle: Partial<Record<FightCue, number>> = { punch: 460, smash: 770, hit: 460, crit: 680, block: 280, dodge: 550 };
    for (const id of ids) {
      const cues = host.cues.filter((c) => c.id === id);
      cues.forEach((c, i) => {
        const wait = settle[c.cue];
        const next = cues[i + 1];
        if (wait === undefined || !next) return;
        // The next cue comes before the move is over, or it is the guard that follows it.
        expect(next.t).toBeLessThanOrEqual(c.t + wait + 120);
        if (next.t === c.t + wait + 120) expect(next.cue).toBe('guard');
      });
    }
  });
});

describe('PetFight with several pets', () => {
  it('puts two bouts on at once when there is room: two rings side by side, and one end for the match', () => {
    const ids: PetId[] = ['whale', 'naiwa', 'mao', 'rice'];
    const { host, onEnd, fight } = begin(ids, 6);
    expect(fight.start(ids)).toBe(true);
    expect(host.taken).toHaveLength(4);
    until(() => onEnd.mock.calls.length > 0);
    expect(host.rings).toHaveLength(2);
    const [one, two] = host.rings;
    expect(Math.max(one.openedAt, two.openedAt)).toBeLessThan(Math.min(closedAt(one), closedAt(two)));
    const [left, right] = [one, two].sort((a, b) => a.rect.x - b.rect.x);
    expect(left.rect.x + left.rect.width).toBeLessThanOrEqual(right.rect.x);
    expect(sorted(host.released.map((r) => r.id))).toEqual(sorted(ids));
    expect(onEnd).toHaveBeenCalledTimes(1);
    for (const ring of host.rings) expect(Math.max(...host.released.map((r) => r.t))).toBeGreaterThanOrEqual(closedAt(ring));
    expect(host.late).toEqual([]);
  });

  it('lets the next pair begin only once the pairs before it are done', () => {
    const ids: PetId[] = ['whale', 'naiwa', 'shenshen', 'airi', 'mao', 'rice'];
    const { host, onEnd, fight } = begin(ids, 2);
    const { pairs } = pairUp(ids, lcg(2));
    expect(fight.start(ids)).toBe(true);
    expect(sorted(host.taken.map((t) => t.id))).toEqual(sorted(pairs.slice(0, 2).flat()));
    for (const id of ids) expect(fight.has(id)).toBe(true);
    until(() => host.taken.length > 4);
    expect(host.rings).toHaveLength(2);
    const firstWaveEnd = Math.max(closedAt(host.rings[0]), closedAt(host.rings[1]));
    expect(host.taken[4].t).toBe(firstWaveEnd);
    expect(sorted([host.taken[4].id, host.taken[5].id])).toEqual(sorted(pairs[2]));
    // Those that have fought are out of the match; the last pair is in it.
    for (const id of pairs.slice(0, 2).flat()) expect(fight.has(id)).toBe(false);
    for (const id of pairs[2]) expect(fight.has(id)).toBe(true);
    until(() => onEnd.mock.calls.length > 0);
    expect(host.rings).toHaveLength(3);
    expect(sorted(host.released.map((r) => r.id))).toEqual(sorted(ids));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(fight.has(pairs[2][0])).toBe(false);
  });

  it('runs the bouts one after another on a display with room for one', () => {
    const ids: PetId[] = ['whale', 'naiwa', 'mao', 'rice'];
    const { host, onEnd, fight } = begin(ids, 5);
    host.display = { x: 0, y: 0, width: 700, height: 600 };
    expect(fight.start(ids)).toBe(true);
    expect(host.taken).toHaveLength(2);
    until(() => onEnd.mock.calls.length > 0);
    expect(host.rings).toHaveLength(2);
    expect(host.rings[1].openedAt).toBeGreaterThanOrEqual(closedAt(host.rings[0]));
    expect(host.late).toEqual([]);
  });

  it('leaves the odd pet out', () => {
    const ids: PetId[] = ['whale', 'naiwa', 'mao'];
    const { host, onEnd, fight } = begin(ids, 7);
    const { spare } = pairUp(ids, lcg(7));
    expect(spare).not.toBeNull();
    expect(fight.start(ids)).toBe(true);
    if (spare) expect(fight.has(spare)).toBe(false);
    until(() => onEnd.mock.calls.length > 0);
    expect(host.rings).toHaveLength(1);
    expect(host.taken.map((t) => t.id)).not.toContain(spare);
  });

  it('has every pet fight once, two bouts at a time, and ends clean', () => {
    const ids = [...PET_IDS];
    const { host, onEnd, fight } = begin(ids, 9);
    expect(fight.start(ids)).toBe(true);
    until(() => onEnd.mock.calls.length > 0);
    vi.advanceTimersByTime(200);
    const bouts = Math.floor(ids.length / 2);
    expect(host.rings).toHaveLength(bouts);
    const taken = host.taken.map((t) => t.id);
    expect(new Set(taken).size).toBe(taken.length);
    expect(taken).toHaveLength(bouts * 2);
    expect(sorted(host.released.map((r) => r.id))).toEqual(sorted(taken));
    let most = 0;
    for (const ring of host.rings) {
      const open = host.rings.filter((r) => r.openedAt <= ring.openedAt && closedAt(r) > ring.openedAt).length;
      most = Math.max(most, open);
    }
    expect(most).toBe(MAX_AT_ONCE);
    for (const ring of host.rings) expect(ring.closes).toBe(1);
    expect(host.late).toEqual([]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('PetFight stop', () => {
  it('stops in the middle of a bout: the pets are let go, the ring closes, nothing more happens, the owner is not told', () => {
    const ids: [PetId, PetId] = ['whale', 'mao'];
    const { host, onEnd, fight } = begin(ids, 4);
    fight.start(ids);
    until(() => host.rings.length > 0);
    vi.advanceTimersByTime(BELL_AT + 3000);
    const ring = host.rings[0];
    expect(ring.closedAt).toBeNull();
    expect(host.cues.length).toBeGreaterThan(2);
    fight.stop();
    expect(ring.closes).toBe(1);
    expect(sorted(host.released.map((r) => r.id))).toEqual(sorted(ids));
    expect(fight.has('whale')).toBe(false);
    expect(fight.has('mao')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const seen = host.tally();
    vi.advanceTimersByTime(120_000);
    expect(host.tally()).toEqual(seen);
    expect(onEnd).not.toHaveBeenCalled();
    fight.stop();
    expect(host.released).toHaveLength(2);
    expect(host.late).toEqual([]);
  });

  it('stops in the middle of the run to the places, before any ring', () => {
    const ids: PetId[] = ['whale', 'naiwa', 'mao', 'rice', 'airi', 'haru'];
    const { host, onEnd, fight } = begin(ids, 4);
    fight.start(ids);
    vi.advanceTimersByTime(100);
    fight.stop();
    expect(host.rings).toHaveLength(0);
    expect(sorted(host.released.map((r) => r.id))).toEqual(sorted(host.taken.map((t) => t.id)));
    expect(host.taken).toHaveLength(4);
    for (const id of ids) expect(fight.has(id)).toBe(false);
    const seen = host.tally();
    vi.advanceTimersByTime(60_000);
    expect(host.tally()).toEqual(seen);
    expect(onEnd).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends the match, and tells its owner once, when a pet goes on its way to its place', () => {
    const ids: [PetId, PetId] = ['whale', 'mao'];
    const { host, onEnd, fight } = begin(ids, 3);
    fight.start(ids);
    vi.advanceTimersByTime(100);
    host.gone.add('mao');
    vi.advanceTimersByTime(100);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(host.rings).toHaveLength(0);
    expect(sorted(host.released.map((r) => r.id))).toEqual(sorted(ids));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not tell its owner a match that was stopped has ended, even much later', () => {
    const ids: [PetId, PetId] = ['whale', 'mao'];
    const { onEnd, fight } = begin(ids, 3);
    fight.start(ids);
    fight.stop();
    vi.advanceTimersByTime(600_000);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
