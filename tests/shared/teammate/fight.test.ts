import { describe, expect, it } from 'vitest';
import { strings } from '../../../src/shared/i18n';
import {
  BELL_AT, FURY_FULL, MAX_HP, MAX_STRIKES, MOVES, RING_ABOVE, RING_SIDE, SHOUT_GAP_MS, arenaStands, boutsFit, fightLine,
  otherSide, pairUp, planFight, ringOf, type FightEvent, type FightLines, type FightPlan, type ShoutKind, type Side,
} from '../../../src/shared/teammate/fight';

const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

type Land = Extract<FightEvent, { type: 'land' }>;
type Wind = Extract<FightEvent, { type: 'wind' }>;

/** Plays a plan on a bare ring the way the pets will, and checks every step could really have happened. */
function replay(plan: FightPlan): { lands: Land[]; hp: [number, number] } {
  const hp: [number, number] = [MAX_HP, MAX_HP];
  const fury: [number, number] = [0, 0];
  const lands: Land[] = [];
  let wind: Wind | null = null;
  let at = -1;
  let bell = false;
  let over = false;
  for (const e of plan.events) {
    expect(e.at).toBeGreaterThanOrEqual(at);
    expect(over).toBe(false);
    at = e.at;
    switch (e.type) {
      case 'bell':
        bell = true;
        expect(e.at).toBe(BELL_AT);
        break;
      case 'wind':
        expect(bell).toBe(true);
        expect(wind).toBeNull();
        expect(hp[0]).toBeGreaterThan(0);
        expect(hp[1]).toBeGreaterThan(0);
        // A fighter whose fury is full throws its special, and only then.
        expect(e.move === 'special').toBe(fury[e.by] >= FURY_FULL);
        wind = e;
        break;
      case 'land': {
        expect(wind).not.toBeNull();
        const w = wind as Wind;
        expect(e.by).toBe(w.by);
        expect(e.move).toBe(w.move);
        expect(e.at).toBe(w.at + w.ms);
        wind = null;
        const to = otherSide(e.by);
        const spec = MOVES[e.move];
        const clean = e.result === 'hit' || e.result === 'crit';
        if (e.result === 'dodge') expect(e.dmg).toBe(0);
        else if (e.result === 'block') expect(e.dmg).toBeGreaterThanOrEqual(1);
        else if (e.result === 'hit') {
          expect(e.dmg).toBeGreaterThanOrEqual(spec.dmg[0]);
          expect(e.dmg).toBeLessThanOrEqual(spec.dmg[1]);
        } else {
          expect(e.dmg).toBeGreaterThanOrEqual(Math.round(spec.dmg[0] * 1.5));
          expect(e.dmg).toBeLessThanOrEqual(Math.round(spec.dmg[1] * 1.5));
        }
        if (e.move === 'special') expect(e.result === 'dodge' || e.result === 'block' || clean).toBe(true);
        hp[to] = Math.max(0, hp[to] - e.dmg);
        expect(e.hp).toEqual(hp);
        expect(e.combo).toBeGreaterThanOrEqual(1);
        for (const f of e.fury) {
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThanOrEqual(FURY_FULL);
        }
        fury[0] = e.fury[0];
        fury[1] = e.fury[1];
        lands.push(e);
        break;
      }
      case 'end':
        over = true;
        expect(e.at).toBe(plan.end);
        break;
      default:
        break;
    }
  }
  expect(wind).toBeNull();
  expect(over).toBe(true);
  return { lands, hp };
}

describe('planFight', () => {
  it('is the same bout for the same seed', () => {
    expect(planFight(lcg(5))).toEqual(planFight(lcg(5)));
    expect(planFight(lcg(5))).not.toEqual(planFight(lcg(6)));
  });

  it('opens with the pets ready, a word each and the bell', () => {
    const { events } = planFight(lcg(3));
    expect(events[0]).toEqual({ at: 0, type: 'ready' });
    const early = events.filter((e) => e.at <= BELL_AT);
    expect(early.filter((e) => e.type === 'shout').map((e) => e.type === 'shout' && e.by)).toEqual([0, 1]);
    expect(events.find((e) => e.type === 'bell')?.at).toBe(BELL_AT);
    expect(events.find((e) => e.type === 'wind')?.at).toBeGreaterThan(BELL_AT);
    expect(events[events.length - 1].type).toBe('end');
  });

  it('plays out every bout as something that could really happen', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const plan = planFight(lcg(seed * 7919));
      const { lands, hp } = replay(plan);
      expect(lands.length).toBe(plan.strikes);
      expect(plan.strikes).toBeGreaterThan(0);
      expect(plan.strikes).toBeLessThanOrEqual(MAX_STRIKES);
      const ko = plan.events.filter((e) => e.type === 'ko');
      const win = plan.events.filter((e) => e.type === 'win');
      const draw = plan.events.filter((e) => e.type === 'draw');
      expect(ko.length).toBeLessThanOrEqual(1);
      expect(win.length + draw.length).toBe(1);
      if (hp[0] <= 0 || hp[1] <= 0) {
        // Only one fighter can go down, and the other wins by the knockout.
        expect(hp[0] <= 0 && hp[1] <= 0).toBe(false);
        const down: Side = hp[0] <= 0 ? 0 : 1;
        expect(ko).toHaveLength(1);
        expect(ko[0]).toMatchObject({ seat: down });
        expect(win[0]).toMatchObject({ seat: otherSide(down), how: 'ko' });
        expect(plan.winner).toBe(otherSide(down));
        expect(ko[0].at).toBeLessThan(win[0].at);
      } else {
        expect(ko).toHaveLength(0);
        if (hp[0] === hp[1]) {
          expect(draw).toHaveLength(1);
          expect(plan.winner).toBeNull();
        } else {
          const ahead: Side = hp[0] > hp[1] ? 0 : 1;
          expect(win[0]).toMatchObject({ seat: ahead, how: 'points' });
          expect(plan.winner).toBe(ahead);
        }
      }
    }
  }, 30_000);

  it('ends most bouts in a knockout within a watchable time', () => {
    let knockouts = 0;
    const wins = [0, 0];
    let specials = 0;
    const runs = 300;
    for (let seed = 1; seed <= runs; seed++) {
      const plan = planFight(lcg(seed * 104729));
      if (plan.events.some((e) => e.type === 'ko')) knockouts++;
      if (plan.winner !== null) wins[plan.winner]++;
      specials += plan.events.filter((e) => e.type === 'land' && e.move === 'special').length;
      expect(plan.end).toBeGreaterThan(8_000);
      expect(plan.end).toBeLessThan(60_000);
    }
    expect(knockouts / runs).toBeGreaterThan(0.9);
    // Neither corner has the edge, and a special is something that happens, not something every blow is.
    expect(wins[0]).toBeGreaterThan(runs * 0.4);
    expect(wins[1]).toBeGreaterThan(runs * 0.4);
    expect(specials / runs).toBeGreaterThan(0.5);
    expect(specials / runs).toBeLessThan(3);
  });

  it('decides a bout cut short on points, or calls it a draw', () => {
    // A random that always dodges: nothing lands, so one blow leaves the fighters level.
    const draw = planFight(() => 0, 1);
    expect(draw.winner).toBeNull();
    expect(draw.events.some((e) => e.type === 'draw')).toBe(true);
    expect(draw.events.filter((e) => e.type === 'shout' && e.kind === 'draw')).toHaveLength(2);
    expect(draw.strikes).toBe(1);
    expect(replay(draw).hp).toEqual([MAX_HP, MAX_HP]);

    let points: FightPlan | null = null;
    for (let seed = 1; seed <= 500 && !points; seed++) {
      const plan = planFight(lcg(seed), 3);
      if (plan.winner !== null) points = plan;
    }
    expect(points).not.toBeNull();
    const plan = points as FightPlan;
    const { hp } = replay(plan);
    expect(plan.events.some((e) => e.type === 'ko')).toBe(false);
    expect(plan.events.find((e) => e.type === 'win')).toMatchObject({ how: 'points' });
    expect(hp[plan.winner as Side]).toBeGreaterThan(hp[otherSide(plan.winner as Side)]);
  });

  it('keeps a fighter from remarking on every blow', () => {
    const remarks = new Set(['special', 'crit', 'dodge', 'hurt']);
    for (let seed = 1; seed <= 100; seed++) {
      const shouts = planFight(lcg(seed)).events.filter((e) => e.type === 'shout');
      for (const by of [0, 1] as Side[]) {
        const mine = shouts.filter((e) => e.type === 'shout' && e.by === by && remarks.has(e.kind)).map((e) => e.at);
        for (let i = 1; i < mine.length; i++) expect(mine[i] - mine[i - 1]).toBeGreaterThanOrEqual(SHOUT_GAP_MS);
      }
    }
  });

  it('gives each shout a variant the lines are picked by', () => {
    for (const e of planFight(lcg(9)).events) {
      if (e.type !== 'shout') continue;
      expect(e.variant).toBeGreaterThanOrEqual(0);
      expect(e.variant).toBeLessThan(1);
    }
  });
});

describe('fightLine', () => {
  const lines: FightLines = {
    ready: ['a', 'b', 'c'], special: ['s'], crit: [], dodge: ['d'], hurt: ['h'], lose: ['l'], win: ['w'], draw: ['x'],
  };

  it('picks by the variant, whatever it is', () => {
    expect(fightLine(lines, 'ready', 0)).toBe('a');
    expect(fightLine(lines, 'ready', 0.5)).toBe('b');
    expect(fightLine(lines, 'ready', 0.99)).toBe('c');
    expect(fightLine(lines, 'ready', 1)).toBe('c');
    expect(fightLine(lines, 'ready', -3)).toBe('a');
  });

  it('has nothing to say when there are no lines', () => {
    expect(fightLine(lines, 'crit', 0.3)).toBeNull();
  });
});

describe('the words of a match', () => {
  const KINDS: Record<ShoutKind, true> = {
    ready: true, special: true, crit: true, dodge: true, hurt: true, lose: true, win: true, draw: true,
  };

  for (const lang of ['en', 'zh-CN'] as const) {
    it(`${lang} has a line for every kind of shout and a word for each banner and number`, () => {
      const w = strings(lang, 'win').teammate.games.fight;
      for (const kind of Object.keys(KINDS) as ShoutKind[]) {
        expect(w.lines[kind].length).toBeGreaterThan(0);
        for (const variant of [0, 0.5, 0.99]) expect(fightLine(w.lines, kind, variant)?.trim()).toBeTruthy();
      }
      for (const word of [w.fight, w.ko, w.draw, w.miss, w.block, w.crit, w.few, w.busy]) expect(word.trim()).not.toBe('');
      expect(w.win('Haru')).toContain('Haru');
      expect(w.combo(4)).toContain('4');
    });
  }

  it('says the same things in both languages, each in its own words', () => {
    const en = strings('en', 'win').teammate.games.fight;
    const zh = strings('zh-CN', 'win').teammate.games.fight;
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    expect(zh.fight).not.toBe(en.fight);
    expect(zh.lines.ready).not.toEqual(en.lines.ready);
  });

  it('names every pet for the ring', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      const names = strings(lang, 'win').teammate.ask.petName;
      for (const name of Object.values(names)) expect(name.trim()).not.toBe('');
    }
  });
});

describe('pairUp', () => {
  it('takes every pet exactly once, two by two', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { pairs, spare } = pairUp(ids, lcg(2));
    expect(spare).toBeNull();
    expect(pairs).toHaveLength(3);
    expect(pairs.flat().sort()).toEqual(ids);
  });

  it('leaves one out when the number is odd', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const { pairs, spare } = pairUp(ids, lcg(8));
    expect(pairs).toHaveLength(2);
    expect(spare).not.toBeNull();
    expect([...pairs.flat(), spare as string].sort()).toEqual(ids);
  });

  it('has no bout with fewer than two', () => {
    expect(pairUp([], lcg(1))).toEqual({ pairs: [], spare: null });
    expect(pairUp(['a'], lcg(1))).toEqual({ pairs: [], spare: 'a' });
  });

  it('is the same for the same random, and does not touch the list', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(pairUp(ids, lcg(4))).toEqual(pairUp(ids, lcg(4)));
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) seen.add(pairUp(ids, lcg(seed)).pairs.map((p) => p.join('')).join('|'));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('copes with a random that never leaves 0 or 1', () => {
    for (const r of [0, 0.999999]) {
      const { pairs, spare } = pairUp(['a', 'b', 'c'], () => r);
      expect([...pairs.flat(), spare as string].sort()).toEqual(['a', 'b', 'c']);
    }
  });
});

describe('arenaStands', () => {
  const area = { x: 0, y: 0, width: 1280, height: 680 };
  const big = { width: 240, height: 320 };
  const small = { width: 160, height: 160 };

  it('stands the pair close, left then right, on the same ground', () => {
    const [left, right] = arenaStands(area, 0, 1, [big, small]);
    expect(left.x).toBeLessThan(right.x);
    expect(left.y + big.height).toBe(right.y + small.height);
    expect(left.y + big.height).toBeLessThanOrEqual(area.y + area.height);
    // Their windows touch or overlap a little, as the art is narrower than its window, but never stand on each other.
    const overlap = left.x + big.width - right.x;
    expect(overlap).toBeGreaterThanOrEqual(0);
    expect(overlap).toBeLessThan(small.width / 2);
  });

  it('puts the bouts side by side, each in its own share of the display', () => {
    const one = arenaStands(area, 0, 2, [big, big]);
    const two = arenaStands(area, 1, 2, [big, big]);
    expect(one[1].x + big.width).toBeLessThanOrEqual(two[0].x);
    expect(one[1].x + big.width / 2).toBeLessThan(area.width / 2);
    expect(two[0].x + big.width / 2).toBeGreaterThan(area.width / 2);
  });

  it('keeps the pets on the display even in a crowded or small one', () => {
    for (const count of [1, 2, 3, 6]) {
      for (let i = 0; i < count; i++) {
        const stands = arenaStands({ x: 100, y: 50, width: 700, height: 400 }, i, count, [big, big]);
        for (const s of stands) {
          expect(s.x).toBeGreaterThanOrEqual(100);
          expect(s.x + big.width).toBeLessThanOrEqual(800);
          expect(s.y).toBeGreaterThanOrEqual(50);
          expect(s.y + big.height).toBeLessThanOrEqual(450);
        }
      }
    }
  });
});

describe('boutsFit', () => {
  it('counts how many bouts fit side by side, at least one', () => {
    const area = { x: 0, y: 0, width: 1280, height: 680 };
    expect(boutsFit(area, [{ width: 240, height: 320 }, { width: 160, height: 160 }])).toBe(2);
    expect(boutsFit({ ...area, width: 300 }, [{ width: 240, height: 320 }])).toBe(1);
    expect(boutsFit({ ...area, width: 3840 }, [{ width: 160, height: 160 }])).toBeGreaterThan(4);
  });
});

describe('ringOf', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const sizes: [{ width: number; height: number }, { width: number; height: number }] = [
    { width: 240, height: 320 }, { width: 160, height: 160 },
  ];

  it('covers both pets, with room at either side and above for the bars', () => {
    const stands = arenaStands(area, 0, 1, sizes);
    const { rect } = ringOf(stands, sizes, area);
    expect(rect.x).toBe(stands[0].x - RING_SIDE);
    expect(rect.x + rect.width).toBe(stands[1].x + sizes[1].width + RING_SIDE);
    expect(rect.y).toBe(Math.min(stands[0].y, stands[1].y) - RING_ABOVE);
    // It ends at the pets' feet: nothing of it hangs below them.
    expect(rect.y + rect.height).toBe(stands[0].y + sizes[0].height);
  });

  it('gives each pet\'s window in the overlay\'s own coordinates', () => {
    const stands = arenaStands(area, 0, 1, sizes);
    const ring = ringOf(stands, sizes, area);
    for (const seat of [0, 1] as const) {
      const box = ring.boxes[seat];
      expect(ring.rect.x + box.x).toBe(stands[seat].x);
      expect(ring.rect.y + box.y).toBe(stands[seat].y);
      expect(box.width).toBe(sizes[seat].width);
      expect(box.height).toBe(sizes[seat].height);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(ring.rect.width);
      expect(box.y + box.height).toBeLessThanOrEqual(ring.rect.height);
    }
  });

  it('stays on the display, even for pets at its edge', () => {
    const small = { x: 100, y: 50, width: 700, height: 400 };
    for (const count of [1, 2, 3]) {
      for (let i = 0; i < count; i++) {
        const stands = arenaStands(small, i, count, [sizes[0], sizes[0]]);
        const { rect, boxes } = ringOf(stands, [sizes[0], sizes[0]], small);
        expect(rect.x).toBeGreaterThanOrEqual(small.x);
        expect(rect.y).toBeGreaterThanOrEqual(small.y);
        expect(rect.x + rect.width).toBeLessThanOrEqual(small.x + small.width);
        expect(rect.y + rect.height).toBeLessThanOrEqual(small.y + small.height);
        for (const b of boxes) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.y).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('keeps the rings of two bouts apart on a display that has room', () => {
    const one = ringOf(arenaStands(area, 0, 2, sizes), sizes, area).rect;
    const two = ringOf(arenaStands(area, 1, 2, sizes), sizes, area).rect;
    expect(one.x + one.width).toBeLessThanOrEqual(two.x);
  });
});
