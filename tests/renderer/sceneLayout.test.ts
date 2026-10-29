import { describe, expect, it } from 'vitest';
import {
  FACE, FIGURES, MELD, POOL, SEAT_X, STAGE, TABLE, bubbleAnchor, claimSide, figureAt, fitStage, meldSlots, meldWidth, poolSlot,
  rackSlot, rackWidth,
} from '../../src/renderer/scene/layout';

describe('figureAt', () => {
  it('has a size for each seat of each kind of pet, and the table hides the feet', () => {
    for (const kind of ['live2d', 'frames'] as const) {
      expect(FIGURES[kind]).toHaveLength(SEAT_X.length);
      for (let seat = 0; seat < SEAT_X.length; seat++) {
        const f = figureAt(kind, seat);
        expect(f.h).toBeGreaterThan(0);
        expect(f.feet).toBeGreaterThan(TABLE.y);
        expect(f.feet).toBeLessThanOrEqual(STAGE.h);
        expect(f.feet - f.h).toBeGreaterThanOrEqual(90);
      }
    }
  });

  it('seats the two in the middle like each other, and the two at the ends like each other', () => {
    for (const kind of ['live2d', 'frames'] as const) {
      expect(figureAt(kind, 1)).toEqual(figureAt(kind, 2));
      expect(figureAt(kind, 0)).toEqual(figureAt(kind, 3));
    }
  });

  it('answers a seat out of range with the nearest one', () => {
    expect(figureAt('live2d', -3)).toEqual(figureAt('live2d', 0));
    expect(figureAt('frames', 9)).toEqual(figureAt('frames', 3));
  });
});

describe('fitStage', () => {
  it('fills a window of the stage\'s own size', () => {
    expect(fitStage(1280, 720)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('keeps the shape and centres it in a wider or a taller window', () => {
    expect(fitStage(1920, 720)).toEqual({ scale: 1, x: 320, y: 0 });
    expect(fitStage(1280, 1080)).toEqual({ scale: 1, x: 0, y: 180 });
    const big = fitStage(2560, 1440);
    expect(big).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it('scales down for a small window, but never to nothing', () => {
    expect(fitStage(640, 360).scale).toBe(0.5);
    expect(fitStage(1, 1).scale).toBe(0.2);
  });

  it('puts the stage on whole pixels', () => {
    const f = fitStage(1001, 777);
    expect(Number.isInteger(f.x)).toBe(true);
    expect(Number.isInteger(f.y)).toBe(true);
    expect(f.x).toBeGreaterThanOrEqual(0);
    expect(f.y).toBeGreaterThanOrEqual(0);
  });
});

describe('seats', () => {
  it('are four, in order, inside the stage and the table', () => {
    expect(SEAT_X).toHaveLength(4);
    expect([...SEAT_X]).toEqual([...SEAT_X].sort((a, b) => a - b));
    for (const x of SEAT_X) {
      expect(x).toBeGreaterThan(TABLE.x);
      expect(x).toBeLessThan(TABLE.x + TABLE.w);
    }
    expect(TABLE.x + TABLE.w).toBeLessThanOrEqual(STAGE.w);
    expect(TABLE.y + TABLE.h).toBeLessThanOrEqual(STAGE.h);
  });

  it('leave the middle of the table free for the dice', () => {
    const inner = (SEAT_X[2] ?? 0) - (SEAT_X[1] ?? 0);
    expect(inner).toBeGreaterThan(POOL.cols * FACE.w + 100);
  });
});

describe('rackSlot', () => {
  it('lays a rack out in a row, centred on its seat', () => {
    for (let seat = 0; seat < 4; seat++) {
      const xs = Array.from({ length: 13 }, (_, i) => rackSlot(seat, i, 13, false).x);
      for (let i = 1; i < xs.length; i++) expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeCloseTo(FACE.w * 0.727, 5);
      expect(((xs[0] ?? 0) + (xs[12] ?? 0)) / 2).toBeCloseTo(SEAT_X[seat] ?? 0, 5);
    }
  });

  it('keeps a drawn tile apart from the rest, and the whole row centred', () => {
    const xs = Array.from({ length: 14 }, (_, i) => rackSlot(1, i, 14, true).x);
    const step = FACE.w * 0.727;
    expect((xs[13] ?? 0) - (xs[12] ?? 0)).toBeGreaterThan(step + 5);
    expect(((xs[0] ?? 0) + (xs[13] ?? 0)) / 2).toBeCloseTo(SEAT_X[1] ?? 0, 5);
    expect(rackWidth(14, true)).toBeGreaterThan(rackWidth(14, false));
  });

  it('does not put a lone tile apart from nothing', () => {
    expect(rackSlot(0, 0, 1, true).x).toBe(SEAT_X[0]);
    expect(rackWidth(0, true)).toBe(0);
  });

  it('never lets the racks of neighbouring seats touch, drawn tile or not', () => {
    for (let seat = 0; seat < 3; seat++) {
      const right = rackSlot(seat, 13, 14, true).x + (FACE.w * 0.727) / 2;
      const left = rackSlot(seat + 1, 0, 14, true).x - (FACE.w * 0.727) / 2;
      expect(right).toBeLessThan(left);
    }
  });

  it('stays on the table', () => {
    for (let seat = 0; seat < 4; seat++) {
      expect(rackSlot(seat, 0, 14, true).x).toBeGreaterThan(TABLE.x);
      expect(rackSlot(seat, 13, 14, true).x).toBeLessThan(TABLE.x + TABLE.w);
      expect(rackSlot(seat, 0, 14, true).y).toBeGreaterThan(TABLE.y);
    }
  });
});

describe('poolSlot', () => {
  it('fills a row left to right and then the next row down', () => {
    expect(poolSlot(0, 1).x - poolSlot(0, 0).x).toBe(FACE.w);
    expect(poolSlot(0, 6).x).toBe(poolSlot(0, 0).x);
    expect(poolSlot(0, 6).y - poolSlot(0, 0).y).toBe(POOL.dy);
  });

  it('keeps every pool tile apart from the others, inside its seat\'s width and on the table', () => {
    for (let seat = 0; seat < 4; seat++) {
      const slots = Array.from({ length: POOL.cols * POOL.rows }, (_, k) => poolSlot(seat, k));
      for (let a = 0; a < slots.length; a++) {
        const p = slots[a];
        expect(p?.x).toBeGreaterThan((SEAT_X[seat] ?? 0) - (POOL.cols * FACE.w) / 2);
        expect(p?.x).toBeLessThan((SEAT_X[seat] ?? 0) + (POOL.cols * FACE.w) / 2);
        expect(p?.y ?? 0).toBeLessThan(TABLE.y + TABLE.h);
        for (let b = a + 1; b < slots.length; b++) {
          const q = slots[b];
          expect(Math.abs((p?.x ?? 0) - (q?.x ?? 0)) >= FACE.w || Math.abs((p?.y ?? 0) - (q?.y ?? 0)) >= FACE.h).toBe(true);
        }
      }
    }
  });

  it('piles tiles beyond the last row on the last row', () => {
    expect(poolSlot(2, POOL.cols * POOL.rows + 3).y).toBe(poolSlot(2, POOL.cols * POOL.rows - 1).y);
  });

  it('sits under the rack and the sets', () => {
    expect(poolSlot(0, 0).y - (FACE.h * 0.5)).toBeGreaterThan(meldSlots(0, [0])[0]?.[0]?.y ?? 0);
  });
});

describe('meldSlots', () => {
  it('gives each set three slots, one of them on its side', () => {
    const sets = meldSlots(1, [0, 2]);
    expect(sets).toHaveLength(2);
    for (const [i, set] of sets.entries()) {
      expect(set).toHaveLength(3);
      expect(set.filter((s) => s.turned)).toHaveLength(1);
      expect(set.findIndex((s) => s.turned)).toBe(i === 0 ? 0 : 2);
    }
  });

  it('puts the tiles of the sets in one row from left to right with no overlap', () => {
    const slots = meldSlots(3, [1, 0, 2, 1]).flat();
    const w = FACE.w * MELD.scale;
    const side = FACE.h * MELD.scale;
    for (let i = 1; i < slots.length; i++) {
      const a = slots[i - 1];
      const b = slots[i];
      const half = ((a?.turned ? side : w) + (b?.turned ? side : w)) / 2;
      expect((b?.x ?? 0) - (a?.x ?? 0)).toBeGreaterThanOrEqual(half - 1e-9);
    }
  });

  it('centres the row on its seat and keeps even four sets off the next seat\'s sets', () => {
    for (let seat = 0; seat < 4; seat++) {
      const slots = meldSlots(seat, [0, 1, 2, 0]).flat();
      const first = slots[0];
      const last = slots[slots.length - 1];
      const left = (first?.x ?? 0) - (first?.turned ? FACE.h : FACE.w) * MELD.scale / 2;
      const right = (last?.x ?? 0) + (last?.turned ? FACE.h : FACE.w) * MELD.scale / 2;
      expect((left + right) / 2).toBeCloseTo(SEAT_X[seat] ?? 0, 5);
      expect(left).toBeGreaterThan(TABLE.x);
      expect(right).toBeLessThan(TABLE.x + TABLE.w);
      if (seat < 3) {
        const next = meldSlots(seat + 1, [0, 1, 2, 0]).flat()[0];
        expect(right).toBeLessThan((next?.x ?? 0) - (next?.turned ? FACE.h : FACE.w) * MELD.scale / 2);
      }
    }
  });

  it('is empty without sets, and a set with no tile on its side is three standing tiles', () => {
    expect(meldSlots(0, [])).toEqual([]);
    expect(meldSlots(0, [-1])[0]?.every((s) => !s.turned)).toBe(true);
  });
});

describe('meldWidth', () => {
  it('is nothing for no sets, and adds a gap between sets and a little more for each set with a turned tile', () => {
    expect(meldWidth([])).toBe(0);
    const w = FACE.w * MELD.scale;
    const side = FACE.h * MELD.scale;
    expect(meldWidth([0])).toBeCloseTo(w * 2 + side, 9);
    expect(meldWidth([-1])).toBeCloseTo(w * 3, 9);
    expect(meldWidth([0, 2])).toBeCloseTo((w * 2 + side) * 2 + MELD.gap, 9);
  });

  it('is the width the slots of the sets span', () => {
    for (const sides of [[0], [1, 2], [2, 0, 1], [0, 1, 2, 0]]) {
      const slots = meldSlots(2, sides).flat();
      const first = slots[0];
      const last = slots[slots.length - 1];
      const left = (first?.x ?? 0) - (first?.turned ? FACE.h : FACE.w) * MELD.scale / 2;
      const right = (last?.x ?? 0) + (last?.turned ? FACE.h : FACE.w) * MELD.scale / 2;
      expect(right - left).toBeCloseTo(meldWidth(sides), 9);
    }
  });
});

describe('claimSide', () => {
  it('lays the claimed tile of a run where it stands in the run', () => {
    expect(claimSide(1, 0, [4, 5, 6], 4, true)).toBe(0);
    expect(claimSide(1, 0, [4, 5, 6], 5, true)).toBe(1);
    expect(claimSide(1, 0, [4, 5, 6], 6, true)).toBe(2);
  });

  it('lays the claimed tile of a triplet by who threw it: the left hand player, across, or the right hand', () => {
    expect(claimSide(2, 1, [3, 3, 3], 3, false)).toBe(0);
    expect(claimSide(2, 0, [3, 3, 3], 3, false)).toBe(1);
    expect(claimSide(2, 3, [3, 3, 3], 3, false)).toBe(2);
    expect(claimSide(0, 3, [3, 3, 3], 3, false)).toBe(0);
    expect(claimSide(3, 0, [3, 3, 3], 3, false)).toBe(2);
  });
});

describe('bubbleAnchor', () => {
  it('is over the seat and never above the top of the stage', () => {
    expect(bubbleAnchor(2, 200)).toEqual({ x: SEAT_X[2], y: 234 });
    expect(bubbleAnchor(0, -50).y).toBe(96);
  });
});
