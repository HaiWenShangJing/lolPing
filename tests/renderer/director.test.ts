import { describe, expect, it } from 'vitest';
import {
  DRAW_PAUSE_MS, Director, LOOK_MS, SHOUT_MS, WALL_TILES, WIN_SHOUT_MS, bubbleMs, talkMs,
  type HudApi, type PlayerApi, type TableApi,
} from '../../src/renderer/scene/director';
import { SEAT_X } from '../../src/renderer/scene/layout';
import type { Meld } from '../../src/shared/teammate/mahjong';
import { planRound, type ChatKind, type PlanEvent, type RoundPlan } from '../../src/shared/teammate/mahjongPlan';
import { gazeAt, type Cue } from '../../src/shared/teammate/sceneMotion';

const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const WORDS = { shuffle: 'Shuffling', pong: 'Pong!', chow: 'Chow!', tsumo: 'Tsumo!', ron: 'Ron!', drawGame: 'Draw' };
const LINES = {
  draw: ['draw a', 'draw b'], think: ['think'], throw: ['throw'], tease: ['tease'], pong: ['pong'], chow: ['chow'],
  win: ['win'], lose: ['lose'], cheer: ['cheer a', 'cheer b', 'cheer c'],
};
const PONG: Meld = { kind: 'pong', tiles: [4, 4, 4], from: 1, claimed: 4 };
const CHOW: Meld = { kind: 'chow', tiles: [3, 4, 5], from: 3, claimed: 4 };

class Pet implements PlayerApi {
  busy = false;
  cues: [Cue, number | undefined][] = [];
  talks: number[] = [];
  gazes: [number, number][] = [];

  cue(cue: Cue, ms?: number): void {
    this.cues.push([cue, ms]);
    this.busy = cue !== 'sit';
  }

  talk(ms: number): void {
    this.talks.push(ms);
  }

  gaze(x: number, y: number): void {
    this.gazes.push([x, y]);
  }

  get last(): Cue | undefined {
    return this.cues.at(-1)?.[0];
  }
}

type Calls = unknown[][];

function recorder<T extends object>(methods: string[]): T & { calls: Calls } {
  const calls: Calls = [];
  const out: Record<string, unknown> = { calls };
  for (const name of methods) out[name] = (...args: unknown[]) => void calls.push([name, ...args]);
  return out as unknown as T & { calls: Calls };
}

const names = (calls: Calls): string[] => calls.map((c) => c[0] as string);

function setup(plan: RoundPlan | ((dealer: number) => RoundPlan), seats = [0, 1, 2, 3], words: Record<string, string> = WORDS) {
  const table = recorder<TableApi>(['reset', 'shuffle', 'roll', 'deal', 'draw', 'discard', 'call', 'win']);
  const hud = recorder<HudApi>(['bubble', 'shout', 'toast', 'round', 'wall', 'dealer']);
  const pets = new Map<number, Pet>(seats.map((s) => [s, new Pet()]));
  const dir = new Director({
    table, hud, words, lines: LINES, random: () => 0.5,
    player: (s) => pets.get(s) ?? null,
    plan: (_random, dealer) => (typeof plan === 'function' ? plan(dealer) : plan),
  });
  const run = (ms: number, step = 20): void => {
    for (let left = ms; left > 0; left -= step) dir.update(Math.min(step, left));
  };
  const pet = (seat: number): Pet => pets.get(seat) as Pet;
  return { dir, table, hud, pets, pet, run };
}

const planOf = (events: PlanEvent[], winner: number | null = null, next = 0): RoundPlan => ({
  events, winner, next, end: Math.max(0, ...events.map((e) => e.at)),
});
const END: PlanEvent = { at: 20000, type: 'end' };

describe('bubbleMs / talkMs', () => {
  it('give a short line the shortest bubble and a long one more time, but never past the longest', () => {
    expect(bubbleMs('Hi')).toBe(1800);
    expect(bubbleMs('x'.repeat(10))).toBe(2300);
    expect(bubbleMs('x'.repeat(200))).toBe(4200);
  });

  it('count a character of Chinese as one, not two', () => {
    expect(bubbleMs('我要胡牌了哦')).toBe(1200 + 110 * 6);
    expect(bubbleMs('😀😀')).toBe(1800);
  });

  it('move the mouth for as long as it takes to say the line, within the bubble', () => {
    expect(talkMs('hello', 3000)).toBe(300 + 160 * 5);
    expect(talkMs('x'.repeat(40), 4200)).toBe(4200);
  });
});

describe('Director: starting', () => {
  it('shows the round, the dealer and a full wall at once, and looks at the middle', () => {
    const { dir, hud, pet } = setup(planOf([{ at: 0, type: 'shuffle', ms: 3200 }, END]));
    dir.start(2, 5);
    expect(hud.calls).toEqual([['round', 5], ['dealer', 2], ['wall', WALL_TILES]]);
    expect(dir.round).toBe(5);
    expect(dir.running).toBe(true);
    expect(pet(0).gazes).toEqual([[gazeAt(SEAT_X[0] as number, 640).x, -0.25]]);
    expect(pet(3).gazes[0]?.[0]).toBeLessThan(0);
  });

  it('plays nothing until it has been started, and nothing after it is stopped', () => {
    const { dir, table, run } = setup(planOf([{ at: 0, type: 'shuffle', ms: 3200 }, END]));
    run(500);
    expect(table.calls).toEqual([]);
    dir.start();
    dir.stop();
    expect(dir.running).toBe(false);
    run(500);
    expect(table.calls).toEqual([]);
  });

  it('has a wall of 70 tiles', () => {
    expect(WALL_TILES).toBe(70);
  });
});

describe('Director: playing a plan', () => {
  it('plays each event when its time comes, and not before', () => {
    const { dir, table, run } = setup(planOf([
      { at: 0, type: 'shuffle', ms: 3200 },
      { at: 3350, type: 'dice', ms: 1300, dice: [3, 5] },
      { at: 4800, type: 'deal', ms: 2300 },
      END,
    ]));
    dir.start(1);
    run(20);
    expect(table.calls).toEqual([['reset'], ['shuffle', 3200]]);
    run(3300);
    expect(names(table.calls)).toEqual(['reset', 'shuffle']);
    run(100);
    expect(table.calls.at(-1)).toEqual(['roll', 1300, [3, 5]]);
    run(1500);
    expect(table.calls.at(-1)).toEqual(['deal', 2300, 1]);
  });

  it('shuffles with every pet and says so, with the table cleared first', () => {
    const { dir, table, hud, pet, run } = setup(planOf([{ at: 0, type: 'shuffle', ms: 3200 }, END]));
    dir.start();
    run(20);
    expect(table.calls[0]).toEqual(['reset']);
    for (const s of [0, 1, 2, 3]) expect(pet(s).cues).toEqual([['shuffle', 3200]]);
    expect(hud.calls).toContainEqual(['toast', 'Shuffling', 3200]);
  });

  it('draws for the pet whose turn it is and counts the wall down', () => {
    const { dir, table, hud, pet, run } = setup(planOf([{ at: 100, type: 'draw', seat: 2, left: 61 }, END]));
    dir.start();
    run(200);
    expect(table.calls).toEqual([['draw', 2]]);
    expect(pet(2).cues).toEqual([['draw', undefined]]);
    expect(pet(1).cues).toEqual([]);
    expect(hud.calls.at(-1)).toEqual(['wall', 61]);
  });

  it('has a thinking pet think for as long as the plan says', () => {
    const { dir, pet, run } = setup(planOf([{ at: 0, type: 'think', seat: 1, ms: 1234 }, END]));
    dir.start();
    run(20);
    expect(pet(1).cues).toEqual([['think', 1234]]);
  });

  it('throws a tile, then has the others watch the thrower and look back at the middle', () => {
    const { dir, table, pet, run } = setup(planOf([{ at: 0, type: 'throw', seat: 1, tile: 7, fromDrawn: true }, END]));
    dir.start();
    pet(0).gazes.length = 0;
    pet(1).gazes.length = 0;
    run(20);
    expect(table.calls).toEqual([['discard', 1, 7, true]]);
    expect(pet(1).cues).toEqual([['throw', undefined]]);
    expect(pet(1).gazes).toEqual([]);
    expect(pet(0).gazes).toEqual([[gazeAt(SEAT_X[0] as number, SEAT_X[1] as number).x, -0.25]]);
    expect(pet(0).gazes[0]?.[0]).toBeGreaterThan(0);
    expect(pet(3).gazes[0]?.[0]).toBeLessThan(0);
    run(LOOK_MS - 100);
    expect(pet(0).gazes).toHaveLength(1);
    run(200);
    expect(pet(0).gazes).toHaveLength(2);
    expect(pet(0).gazes[1]).toEqual([gazeAt(SEAT_X[0] as number, 640).x, -0.25]);
    expect(pet(1).gazes).toHaveLength(1);
  });

  it('keeps one look back, so a second throw is not cut short by the first', () => {
    const { dir, pet, run } = setup(planOf([
      { at: 0, type: 'throw', seat: 1, tile: 7, fromDrawn: false },
      { at: 1000, type: 'throw', seat: 2, tile: 8, fromDrawn: false },
      END,
    ]));
    dir.start();
    pet(0).gazes.length = 0;
    run(1000 + LOOK_MS - 200);
    expect(pet(0).gazes).toHaveLength(2);
    run(300);
    expect(pet(0).gazes).toHaveLength(3);
  });

  it('claims a tile with a shout of what was claimed', () => {
    const { dir, table, hud, pet, run } = setup(planOf([
      { at: 0, type: 'call', seat: 2, kind: 'pong', meld: PONG },
      { at: 100, type: 'call', seat: 3, kind: 'chow', meld: CHOW },
      END,
    ]));
    dir.start();
    run(200);
    expect(table.calls).toEqual([['call', 2, PONG], ['call', 3, CHOW]]);
    expect(hud.calls.filter((c) => c[0] === 'shout')).toEqual([['shout', 2, 'Pong!', SHOUT_MS], ['shout', 3, 'Chow!', SHOUT_MS]]);
    expect(pet(2).last).toBe('call');
    expect(pet(3).last).toBe('call');
  });

  it('shows a win with the hand, and shouts tsumo for a drawn tile and ron for a thrown one', () => {
    const { dir, table, hud, pet, run } = setup(planOf([
      { at: 0, type: 'win', seat: 0, from: null, tile: 5, hand: [1, 2, 3], melds: [] },
      { at: 100, type: 'win', seat: 3, from: 1, tile: 9, hand: [4, 5, 6], melds: [PONG] },
      END,
    ]));
    dir.start();
    run(200);
    expect(table.calls).toEqual([['win', 0, null, 5, [1, 2, 3]], ['win', 3, 1, 9, [4, 5, 6]]]);
    expect(hud.calls.filter((c) => c[0] === 'shout')).toEqual([
      ['shout', 0, 'Tsumo!', WIN_SHOUT_MS], ['shout', 3, 'Ron!', WIN_SHOUT_MS],
    ]);
    expect(pet(0).last).toBe('win');
    expect(pet(3).last).toBe('win');
  });

  it('has a pet react the way the plan says', () => {
    const { dir, pet, run } = setup(planOf([
      { at: 0, type: 'react', seat: 0, reaction: 'shock' },
      { at: 0, type: 'react', seat: 1, reaction: 'lose' },
      { at: 0, type: 'react', seat: 2, reaction: 'cheer' },
      { at: 0, type: 'react', seat: 3, reaction: 'laugh' },
      END,
    ]));
    dir.start();
    run(20);
    expect([0, 1, 2, 3].map((s) => pet(s).last)).toEqual(['shock', 'lose', 'cheer', 'laugh']);
  });
});

describe('Director: talking', () => {
  const chat = (kind: ChatKind, variant: number, seat = 1): PlanEvent => ({ at: 0, type: 'chat', seat, kind, variant });

  it('puts the line the variant picks in a bubble over the pet and moves its mouth', () => {
    const { dir, hud, pet, run } = setup(planOf([chat('draw', 0.7), END]));
    dir.start();
    run(20);
    expect(hud.calls.filter((c) => c[0] === 'bubble')).toEqual([['bubble', 1, 'draw b', bubbleMs('draw b')]]);
    expect(pet(1).talks).toEqual([talkMs('draw b', bubbleMs('draw b'))]);
  });

  it('picks the first line for 0 and the last for a variant right under 1', () => {
    for (const [variant, line] of [[0, 'cheer a'], [0.34, 'cheer b'], [0.999, 'cheer c']] as const) {
      const { dir, hud, run } = setup(planOf([chat('cheer', variant), END]));
      dir.start();
      run(20);
      expect(hud.calls.find((c) => c[0] === 'bubble')?.[2]).toBe(line);
    }
  });

  it('nods along when idle, but does not cut off a pet that is acting', () => {
    const idle = setup(planOf([chat('think', 0), END]));
    idle.dir.start();
    idle.run(20);
    expect(idle.pet(1).last).toBe('chat');

    const busy = setup(planOf([{ at: 0, type: 'draw', seat: 1, left: 60 }, chat('think', 0), END]));
    busy.dir.start();
    busy.run(20);
    expect(busy.pet(1).cues).toEqual([['draw', undefined]]);
    expect(busy.pet(1).talks).toHaveLength(1);
  });

  it('laughs at a tease when idle, and always cheers when it cheers', () => {
    const tease = setup(planOf([chat('tease', 0), END]));
    tease.dir.start();
    tease.run(20);
    expect(tease.pet(1).last).toBe('laugh');

    const cheer = setup(planOf([{ at: 0, type: 'react', seat: 1, reaction: 'shock' }, chat('cheer', 0), END]));
    cheer.dir.start();
    cheer.run(20);
    expect(cheer.pet(1).last).toBe('cheer');
  });

  it('says nothing for a seat nobody sits at, or a kind with no lines', () => {
    const empty = setup(planOf([chat('draw', 0, 1), chat('draw', 0, 2), END]), [0, 2, 3]);
    empty.dir.start();
    empty.run(20);
    expect(empty.hud.calls.filter((c) => c[0] === 'bubble').map((c) => c[1])).toEqual([2]);

    const table = recorder<TableApi>([]);
    const hud = recorder<HudApi>(['bubble', 'shout', 'toast', 'round', 'wall', 'dealer']);
    const dir = new Director({
      table, hud, words: WORDS, lines: {}, random: () => 0.5, player: () => new Pet(),
      plan: () => planOf([chat('draw', 0.3), END]),
    });
    dir.start();
    dir.update(20);
    expect(hud.calls.filter((c) => c[0] === 'bubble')).toEqual([]);
  });
});

describe('Director: a table that is not full', () => {
  it('plays on without the pets that are not there', () => {
    const { dir, table, run } = setup(planOf([
      { at: 0, type: 'shuffle', ms: 3200 },
      { at: 50, type: 'draw', seat: 1, left: 60 },
      { at: 60, type: 'think', seat: 1, ms: 900 },
      { at: 70, type: 'throw', seat: 1, tile: 3, fromDrawn: false },
      { at: 80, type: 'react', seat: 3, reaction: 'shock' },
      END,
    ]), [0]);
    dir.start();
    expect(() => run(200)).not.toThrow();
    expect(names(table.calls)).toEqual(['reset', 'shuffle', 'draw', 'discard']);
  });

  it('plays on with nobody there at all', () => {
    const { dir, table, run } = setup(planOf([{ at: 0, type: 'shuffle', ms: 3200 }, END]), []);
    dir.start();
    expect(() => run(100)).not.toThrow();
    expect(table.calls).toEqual([['reset'], ['shuffle', 3200]]);
  });

  it('leaves out a shout or a toast it has no word for', () => {
    const { dir, hud, run } = setup(planOf([
      { at: 0, type: 'shuffle', ms: 3200 },
      { at: 10, type: 'call', seat: 0, kind: 'pong', meld: PONG },
      END,
    ]), [0, 1, 2, 3], {});
    dir.start();
    run(100);
    expect(names(hud.calls)).not.toContain('shout');
    expect(names(hud.calls)).not.toContain('toast');
  });
});

describe('Director: rounds', () => {
  it('starts the next round with the plan\'s dealer once a won round ends', () => {
    const rounds: number[] = [];
    const { dir, hud, run } = setup((dealer) => {
      rounds.push(dealer);
      return planOf([{ at: 0, type: 'shuffle', ms: 100 }, { at: 500, type: 'end' }], 2, 3);
    });
    dir.start(0);
    run(300);
    expect(dir.round).toBe(1);
    run(400);
    expect(dir.round).toBe(2);
    expect(rounds).toEqual([0, 3]);
    expect(hud.calls.filter((c) => c[0] === 'round')).toEqual([['round', 1], ['round', 2]]);
    expect(hud.calls.filter((c) => c[0] === 'dealer')).toEqual([['dealer', 0], ['dealer', 3]]);
    expect(hud.calls.some((c) => c[0] === 'toast' && c[1] === 'Draw')).toBe(false);
  });

  it('clears the table at the start of the next round', () => {
    const { dir, table, run } = setup(planOf([{ at: 0, type: 'shuffle', ms: 100 }, { at: 400, type: 'end' }], 1, 1));
    dir.start();
    run(1000);
    expect(table.calls.filter((c) => c[0] === 'reset').length).toBeGreaterThanOrEqual(2);
  });

  it('lets a round with no winner stay on the table, says so, then starts the next', () => {
    const { dir, hud, run } = setup(planOf([{ at: 0, type: 'shuffle', ms: 100 }, { at: 300, type: 'end' }], null, 2));
    dir.start(2);
    run(400);
    expect(hud.calls).toContainEqual(['toast', 'Draw', DRAW_PAUSE_MS]);
    run(DRAW_PAUSE_MS - 200);
    expect(dir.round).toBe(1);
    run(400);
    expect(dir.round).toBe(2);
    expect(dir.running).toBe(true);
  });

  it('starts over, round and all, when it is started again', () => {
    const { dir, hud, run } = setup(planOf([{ at: 0, type: 'shuffle', ms: 100 }, { at: 200, type: 'end' }], 0, 0));
    dir.start();
    run(1000);
    expect(dir.round).toBeGreaterThan(1);
    dir.start();
    expect(dir.round).toBe(1);
    expect(hud.calls.at(-3)).toEqual(['round', 1]);
  });

  it('does not run away when a round ends the moment it starts', () => {
    const { dir, run } = setup(planOf([{ at: 0, type: 'end' }], 0, 0));
    dir.start();
    expect(() => run(1000)).not.toThrow();
    expect(dir.round).toBeGreaterThan(1);
  });

  it('ignores a clock that runs backwards', () => {
    const { dir, table } = setup(planOf([{ at: 100, type: 'dice', ms: 1, dice: [1, 1] }, END]));
    dir.start();
    dir.update(-500);
    dir.update(50);
    expect(table.calls).toEqual([]);
    dir.update(60);
    expect(table.calls).toHaveLength(1);
  });
});

describe('Director: with real rounds', () => {
  it('plays many rounds of a seeded table without a mistake, each round cleared before it begins', () => {
    const table = recorder<TableApi>(['reset', 'shuffle', 'roll', 'deal', 'draw', 'discard', 'call', 'win']);
    const hud = recorder<HudApi>(['bubble', 'shout', 'toast', 'round', 'wall', 'dealer']);
    const pets = [0, 1, 2, 3].map(() => new Pet());
    const random = lcg(7);
    const dir = new Director({ table, hud, words: WORDS, lines: LINES, random, player: (s) => pets[s] ?? null });
    dir.start();
    for (let i = 0; i < 20 * 60 * 20; i++) dir.update(50);
    expect(dir.round).toBeGreaterThanOrEqual(10);
    const seen = new Set(names(table.calls));
    for (const n of ['reset', 'shuffle', 'roll', 'deal', 'draw', 'discard', 'win']) expect(seen.has(n), n).toBe(true);
    const rounds = names(table.calls).join(' ').split('reset').slice(1);
    expect(rounds.length).toBeGreaterThanOrEqual(dir.round - 1);
    expect(rounds.length).toBeLessThanOrEqual(dir.round);
    for (const r of rounds) expect(r.trim().startsWith('shuffle roll deal draw')).toBe(true);
    expect(hud.calls.filter((c) => c[0] === 'bubble').length).toBeGreaterThan(20);
    for (const p of pets) expect(p.cues.length).toBeGreaterThan(30);
  });

  it('plays the plan it is given, event for event, in order', () => {
    const plan = planRound(lcg(11), 0);
    const table = recorder<TableApi>(['reset', 'shuffle', 'roll', 'deal', 'draw', 'discard', 'call', 'win']);
    const hud = recorder<HudApi>(['bubble', 'shout', 'toast', 'round', 'wall', 'dealer']);
    const dir = new Director({
      table, hud, words: WORDS, lines: LINES, random: () => 0.5, player: () => new Pet(), plan: () => plan,
    });
    dir.start();
    for (let i = 0; i < Math.ceil(plan.end / 50) + 2; i++) dir.update(50);
    const wanted = plan.events.filter((e) => ['dice', 'deal', 'draw', 'throw', 'call', 'win'].includes(e.type)).length;
    const got = table.calls.filter((c) => ['roll', 'deal', 'draw', 'discard', 'call', 'win'].includes(c[0] as string)).length;
    expect(got).toBe(wanted);
  });
});
