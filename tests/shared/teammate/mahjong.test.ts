import { describe, expect, it } from 'vitest';
import {
  DEAD_WALL, KINDS, MahjongTable, buildWall, countKinds, isWinning, tileChar, winningHand,
} from '../../../src/shared/teammate/mahjong';

const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('tileChar', () => {
  it('names the faces from the Unicode mahjong block', () => {
    expect(tileChar(0)).toBe('\u{1F007}');
    expect(tileChar(8)).toBe('\u{1F00F}');
    expect(tileChar(9)).toBe('\u{1F010}');
    expect(tileChar(18)).toBe('\u{1F019}');
    expect(tileChar(26)).toBe('\u{1F021}');
    expect(tileChar(27)).toBe('\u{1F000}');
    expect(tileChar(30)).toBe('\u{1F003}');
    expect(tileChar(31)).toBe('\u{1F004}');
    expect(tileChar(33)).toBe('\u{1F006}');
  });

  it('has nothing for a number that is no tile', () => {
    expect(tileChar(-1)).toBe('');
    expect(tileChar(KINDS)).toBe('');
  });
});

describe('buildWall', () => {
  it('has four of each of the 34 tiles', () => {
    const wall = buildWall(lcg(1));
    expect(wall).toHaveLength(136);
    for (let k = 0; k < KINDS; k++) expect(wall.filter((t) => t === k)).toHaveLength(4);
  });

  it('is shuffled by the random it is given', () => {
    expect(buildWall(lcg(1))).not.toEqual(buildWall(lcg(2)));
    expect(buildWall(lcg(1))).toEqual(buildWall(lcg(1)));
  });
});

describe('MahjongTable', () => {
  it('deals 13 sorted tiles to each of four seats', () => {
    const t = MahjongTable.deal(lcg(3));
    expect(t.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    for (const h of t.hands) expect(h).toEqual([...h].sort((a, b) => a - b));
    expect(t.wall).toHaveLength(136 - 52);
    expect(t.turn).toBe(t.dealer);
  });

  it('lets a player draw, then throw, and passes the turn on', () => {
    const t = MahjongTable.deal(lcg(4));
    const first = t.turn;
    const tile = t.draw();
    expect(tile).not.toBeNull();
    expect(t.choices()).toHaveLength(14);
    const thrown = t.discard(13);
    expect(thrown).toBe(tile);
    expect(t.discards[first]).toEqual([tile]);
    expect(t.last).toEqual({ seat: first, tile });
    expect(t.hands[first]).toHaveLength(13);
    expect(t.turn).toBe((first + 1) % 4);
    expect(t.drawn).toBeNull();
  });

  it('keeps the hand sorted when a tile from it is thrown', () => {
    const t = MahjongTable.deal(lcg(5));
    t.draw();
    t.discard(0);
    const h = t.hands[t.dealer] ?? [];
    expect(h).toEqual([...h].sort((a, b) => a - b));
  });

  it('does not draw twice in a turn, and does not throw before drawing', () => {
    const t = MahjongTable.deal(lcg(6));
    expect(t.discard(0)).toBeNull();
    const a = t.draw();
    expect(t.draw()).toBe(a);
    expect(t.wall).toHaveLength(136 - 52 - 1);
    expect(t.discard(14)).toBeNull();
  });

  it('ends when only the dead wall is left', () => {
    const t = MahjongTable.deal(lcg(7));
    let draws = 0;
    while (t.draw() !== null) {
      draws += 1;
      t.discard(t.pick(lcg(draws)));
    }
    expect(t.over).toBe(true);
    expect(draws).toBe(136 - 52 - DEAD_WALL);
    expect(t.wall).toHaveLength(DEAD_WALL);
    expect(t.draw()).toBeNull();
  });

  it('has a pet throw the tile that fits its hand least', () => {
    const t = MahjongTable.deal(lcg(8));
    t.hands[0] = [0, 0, 1, 2, 9, 10, 11, 18, 18, 19, 20, 21, 22];
    t.turn = 0;
    t.drawn = 31;
    expect(t.choices()[t.pick(() => 0)]).toBe(31);
    t.drawn = 5;
    const thrown = t.choices()[t.pick(() => 0)];
    expect(thrown).toBe(5);
  });

  it('deals to the dealer it is given', () => {
    for (let d = 0; d < 4; d++) {
      const t = MahjongTable.deal(lcg(9), d);
      expect(t.dealer).toBe(d);
      expect(t.turn).toBe(d);
    }
  });
});

describe('isWinning', () => {
  it('knows four sets and a pair', () => {
    // 123m 456m 789m 111p 99s
    expect(isWinning([0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 18, 18, 17, 17])).toBe(true);
    // 111m 222m 333m 444m 55m: it wins whether the tiles are read as triplets or as runs
    expect(isWinning([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4])).toBe(true);
    expect(isWinning([27, 27, 27, 28, 28, 28, 31, 31, 31, 32, 32, 32, 33, 33])).toBe(true);
  });

  it('knows a hand with sets laid out: two sets and a pair is eight tiles', () => {
    expect(isWinning([0, 1, 2, 9, 9, 9, 5, 5])).toBe(true);
    expect(isWinning([0, 1, 2, 9, 9, 9, 5, 6])).toBe(false);
    expect(isWinning([5, 5])).toBe(true);
  });

  it('knows seven pairs', () => {
    expect(isWinning([0, 0, 3, 3, 9, 9, 12, 12, 20, 20, 27, 27, 33, 33])).toBe(true);
    // four of one kind are two pairs of the same kind, not seven different pairs
    expect(isWinning([0, 0, 0, 0, 3, 3, 9, 9, 12, 12, 20, 20, 27, 27])).toBe(false);
  });

  it('rejects hands that do not win', () => {
    expect(isWinning([0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 18, 19, 17, 17])).toBe(false);
    expect(isWinning([0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 18, 18, 17])).toBe(false);
    expect(isWinning([])).toBe(false);
  });

  it('does not run a sequence round the end of a suit or into the next one', () => {
    expect(isWinning([7, 8, 9, 0, 0, 0, 3, 4, 5, 18, 18, 18, 20, 20])).toBe(false);
    expect(isWinning([25, 26, 27, 0, 0, 0, 3, 4, 5, 18, 18, 18, 20, 20])).toBe(false);
    expect(isWinning([27, 28, 29, 0, 0, 0, 3, 4, 5, 18, 18, 18, 20, 20])).toBe(false);
  });
});

describe('countKinds', () => {
  it('counts each kind', () => {
    const c = countKinds([0, 0, 33, 5]);
    expect(c).toHaveLength(KINDS);
    expect([c[0], c[5], c[33], c[1]]).toEqual([2, 1, 1, 0]);
  });
});

describe('winningHand', () => {
  it('always makes a hand that wins, of the size asked for, with at most four of a kind', () => {
    const none = Array.from({ length: KINDS }, () => 0);
    for (let seed = 1; seed <= 300; seed++) {
      for (const sets of [1, 2, 3, 4]) {
        const hand = winningHand(lcg(seed), sets, none);
        expect(hand).not.toBeNull();
        expect(hand).toHaveLength(sets * 3 + 2);
        expect(hand).toEqual([...(hand ?? [])].sort((a, b) => a - b));
        expect(isWinning(hand ?? [])).toBe(true);
        expect(Math.max(...countKinds(hand ?? []))).toBeLessThanOrEqual(4);
      }
    }
  });

  it('only uses tiles that are not already face up on the table', () => {
    const seen = Array.from({ length: KINDS }, () => 4);
    // Left: three 1s, one 2 and one 3 of characters.
    seen[0] = 1;
    seen[1] = 3;
    seen[2] = 3;
    for (let seed = 1; seed <= 50; seed++) {
      expect(winningHand(lcg(seed), 0, seen)).toEqual([0, 0]);
      expect(winningHand(lcg(seed), 1, seen)).toEqual([0, 0, 0, 1, 2]);
    }
  });

  it('never goes over four of a kind with what is face up', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = lcg(seed);
      const seen = Array.from({ length: KINDS }, () => Math.floor(random() * 3));
      const hand = winningHand(random, 2, seen);
      if (hand === null) continue;
      const c = countKinds(hand);
      for (let k = 0; k < KINDS; k++) expect((c[k] ?? 0) + (seen[k] ?? 0)).toBeLessThanOrEqual(4);
      expect(isWinning(hand)).toBe(true);
    }
  });

  it('gives up with null when the tiles left cannot make it', () => {
    const seen = Array.from({ length: KINDS }, () => 4);
    expect(winningHand(lcg(1), 1, seen)).toBeNull();
  });
});

describe('claims', () => {
  const table = (seed = 20): MahjongTable => {
    const t = MahjongTable.deal(lcg(seed), 0);
    t.hands[0] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    t.hands[1] = [4, 4, 5, 9, 9, 10, 11, 18, 19, 20, 27, 28, 29];
    t.hands[2] = [13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 30, 31, 32];
    t.hands[3] = [0, 0, 1, 1, 2, 18, 18, 19, 26, 27, 27, 33, 33];
    return t;
  };

  it('lets a seat that holds two of the thrown tile claim it as a triplet, and throw without drawing', () => {
    const t = table();
    t.turn = 0;
    t.drawn = 4;
    t.discard(t.choices().length - 1);
    expect(t.last).toEqual({ seat: 0, tile: 4 });
    expect(t.canPong(1)).toBe(true);
    expect(t.canPong(0)).toBe(false);
    expect(t.canPong(2)).toBe(false);
    const meld = t.pong(1);
    expect(meld).toEqual({ kind: 'pong', tiles: [4, 4, 4], from: 0, claimed: 4 });
    expect(t.melds[1]).toEqual([meld]);
    expect(t.discards[0]).toEqual([]);
    expect(t.hands[1]).toHaveLength(11);
    expect(t.turn).toBe(1);
    expect(t.calling).toBe(true);
    expect(t.last).toBeNull();
    expect(t.draw()).toBeNull();
    expect(t.over).toBe(false);
    expect(t.choices()).toHaveLength(11);
    const out = t.discard(0);
    expect(out).not.toBeNull();
    expect(t.calling).toBe(false);
    expect(t.hands[1]).toHaveLength(10);
    expect(t.turn).toBe(2);
    expect(t.last?.seat).toBe(1);
  });

  it('only offers a tile that has just been thrown, and only once', () => {
    const t = table();
    expect(t.canPong(1)).toBe(false);
    t.turn = 0;
    t.drawn = 4;
    t.discard(t.choices().length - 1);
    expect(t.pong(1)).not.toBeNull();
    expect(t.pong(3)).toBeNull();
    expect(t.pong(1)).toBeNull();
  });

  it('does not let a seat claim once the next player has drawn', () => {
    const t = table();
    t.turn = 0;
    t.drawn = 4;
    t.discard(t.choices().length - 1);
    t.draw();
    expect(t.canPong(1)).toBe(false);
    expect(t.pong(1)).toBeNull();
  });

  it('offers a run only to the next seat, and only runs it holds', () => {
    const t = table();
    t.turn = 0;
    t.drawn = 10;
    t.discard(t.choices().length - 1);
    // Tile 10 is the 2 of bamboo: seat 1 holds the 1 and 3 of bamboo (9 and 11) but not the 4 (12).
    expect(t.chowChoices(1)).toEqual([[9, 11]]);
    expect(t.chowChoices(2)).toEqual([]);
    expect(t.chowChoices(3)).toEqual([]);
    expect(t.chowChoices(0)).toEqual([]);
    const meld = t.chow(1, [9, 11]);
    expect(meld).toEqual({ kind: 'chow', tiles: [9, 10, 11], from: 0, claimed: 10 });
    expect(t.hands[1]).toEqual([4, 4, 5, 9, 10, 18, 19, 20, 27, 28, 29]);
    expect(t.calling).toBe(true);
  });

  it('refuses a run the hand cannot make', () => {
    const t = table();
    t.turn = 0;
    t.drawn = 10;
    t.discard(t.choices().length - 1);
    expect(t.chow(1, [11, 12])).toBeNull();
    expect(t.chow(1, [8, 9])).toBeNull();
    expect(t.calling).toBe(false);
    expect(t.discards[0]).toEqual([10]);
  });

  it('runs at the ends of a suit only the way that stays in the suit', () => {
    const t = table();
    t.hands[1] = [1, 2, 6, 7, 18, 19, 20, 27, 28, 29, 30, 31, 32];
    t.turn = 0;
    t.drawn = 0;
    t.discard(t.choices().length - 1);
    expect(t.chowChoices(1)).toEqual([[1, 2]]);
    const u = table();
    u.hands[1] = [6, 7, 8, 18, 19, 20, 27, 28, 29, 30, 31, 32, 33];
    u.turn = 0;
    u.drawn = 8;
    u.discard(u.choices().length - 1);
    expect(u.chowChoices(1)).toEqual([[6, 7]]);
    const v = table();
    v.hands[1] = [8, 9, 10, 0, 18, 19, 20, 27, 28, 29, 30, 31, 32];
    v.turn = 0;
    v.drawn = 7;
    v.discard(v.choices().length - 1);
    expect(v.chowChoices(1)).toEqual([]);
  });

  it('does not run honours', () => {
    const t = table();
    t.hands[1] = [27, 28, 29, 31, 32, 33, 0, 1, 2, 9, 10, 11, 18];
    t.turn = 0;
    t.drawn = 30;
    t.discard(t.choices().length - 1);
    expect(t.chowChoices(1)).toEqual([]);
  });

  it('keeps every tile and never more than four of a kind through a game of claims', () => {
    let calls = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const random = lcg(seed);
      const t = MahjongTable.deal(random);
      for (let n = 0; n < 60 && !t.over; n++) {
        if (!t.calling && t.draw() === null) break;
        t.discard(t.pick(random));
        const next = t.turn;
        const pong = [0, 1, 2].map((d) => (next + d) % 4).find((s) => t.canPong(s));
        const runs = t.chowChoices(next);
        if (pong !== undefined && random() < 0.7) {
          t.pong(pong);
          calls += 1;
        } else if (runs.length > 0 && random() < 0.5) {
          t.chow(next, runs[0] ?? [0, 0]);
          calls += 1;
        }
        const all = [
          ...t.wall, ...t.hands.flat(), ...t.discards.flat(), ...t.melds.flat().flatMap((m) => m.tiles),
          ...(t.drawn === null ? [] : [t.drawn]),
        ];
        expect(all).toHaveLength(136);
        expect(countKinds(all).every((c) => c === 4)).toBe(true);
        for (let s = 0; s < 4; s++) {
          const own = (t.hands[s] ?? []).length + (t.melds[s] ?? []).length * 3;
          expect(own).toBeGreaterThanOrEqual(13);
          expect(own).toBeLessThanOrEqual(14);
        }
      }
    }
    expect(calls).toBeGreaterThan(10);
  });
});
