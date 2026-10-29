import { describe, expect, it } from 'vitest';
import { KINDS } from '../../src/shared/teammate/mahjong';
import {
  CIRCLES, DRAGON_CHARS, FACE_BOX, MAN_NUMERALS, STICKS, TILE_DEPTH, TILE_H, TILE_W, WIND_CHARS, describeTile,
} from '../../src/renderer/scene/tileArt';

describe('describeTile', () => {
  it('names each of the 34 kinds once, nine of each number suit, four winds and three dragons', () => {
    const faces = Array.from({ length: KINDS }, (_, k) => describeTile(k));
    expect(new Set(faces.map((f) => `${f.suit}${f.n}`)).size).toBe(KINDS);
    const count = (suit: string): number => faces.filter((f) => f.suit === suit).length;
    expect([count('man'), count('sou'), count('pin'), count('wind'), count('dragon')]).toEqual([9, 9, 9, 4, 3]);
  });

  it('numbers a suit from 1 and keeps the order of the table\'s kinds', () => {
    expect(describeTile(0)).toEqual({ suit: 'man', n: 1 });
    expect(describeTile(8)).toEqual({ suit: 'man', n: 9 });
    expect(describeTile(9)).toEqual({ suit: 'sou', n: 1 });
    expect(describeTile(26)).toEqual({ suit: 'pin', n: 9 });
    expect(describeTile(27)).toEqual({ suit: 'wind', n: 1 });
    expect(describeTile(30)).toEqual({ suit: 'wind', n: 4 });
    expect(describeTile(31)).toEqual({ suit: 'dragon', n: 1 });
    expect(describeTile(33)).toEqual({ suit: 'dragon', n: 3 });
  });

  it('has a character for every number, wind and dragon', () => {
    expect(MAN_NUMERALS).toHaveLength(9);
    expect(WIND_CHARS).toHaveLength(4);
    expect(DRAGON_CHARS).toHaveLength(3);
  });
});

describe('the tile and its face box', () => {
  it('leave room for the green edge under the face and a margin on every side', () => {
    expect(FACE_BOX.x).toBeGreaterThan(0);
    expect(FACE_BOX.y).toBeGreaterThan(0);
    expect(FACE_BOX.x + FACE_BOX.w).toBeLessThan(TILE_W);
    expect(FACE_BOX.y + FACE_BOX.h).toBeLessThan(TILE_H - TILE_DEPTH);
  });
});

const px = (v: number, size: number): number => v * size;

describe('circle tiles', () => {
  it('have as many dots as their number', () => {
    expect(CIRCLES).toHaveLength(9);
    CIRCLES.forEach((c, i) => expect(c.pips).toHaveLength(i + 1));
  });

  it('keep every dot inside the box', () => {
    for (const c of CIRCLES) {
      const r = px(c.r, FACE_BOX.w);
      for (const p of c.pips) {
        expect(px(p.x, FACE_BOX.w) - r).toBeGreaterThanOrEqual(0);
        expect(px(p.x, FACE_BOX.w) + r).toBeLessThanOrEqual(FACE_BOX.w);
        expect(px(p.y, FACE_BOX.h) - r).toBeGreaterThanOrEqual(0);
        expect(px(p.y, FACE_BOX.h) + r).toBeLessThanOrEqual(FACE_BOX.h);
      }
    }
  });

  it('do not let two dots overlap', () => {
    for (const c of CIRCLES) {
      const r = px(c.r, FACE_BOX.w);
      for (const [i, a] of c.pips.entries()) {
        for (const b of c.pips.slice(i + 1)) {
          const d = Math.hypot(px(a.x - b.x, FACE_BOX.w), px(a.y - b.y, FACE_BOX.h));
          expect(d).toBeGreaterThanOrEqual(2 * r - 1e-9);
        }
      }
    }
  });
});

describe('bamboo tiles', () => {
  it('have as many sticks as their number', () => {
    expect(STICKS).toHaveLength(9);
    STICKS.forEach((s, i) => expect(s.pips).toHaveLength(i + 1));
  });

  it('keep every stick inside the box', () => {
    for (const s of STICKS) {
      for (const p of s.pips) {
        expect(p.x - s.w / 2).toBeGreaterThanOrEqual(0);
        expect(p.x + s.w / 2).toBeLessThanOrEqual(1);
        expect(p.y - s.h / 2).toBeGreaterThanOrEqual(0);
        expect(p.y + s.h / 2).toBeLessThanOrEqual(1);
      }
    }
  });

  it('do not let two sticks overlap', () => {
    for (const s of STICKS) {
      for (const [i, a] of s.pips.entries()) {
        for (const b of s.pips.slice(i + 1)) {
          const apartX = Math.abs(a.x - b.x) >= s.w - 1e-9;
          const apartY = Math.abs(a.y - b.y) >= s.h - 1e-9;
          expect(apartX || apartY).toBe(true);
        }
      }
    }
  });

  it('use red for the middle stick of the five, and for no stick of the two', () => {
    expect(STICKS[4]?.pips.filter((p) => p.ink === 'red')).toHaveLength(1);
    expect(STICKS[1]?.pips.some((p) => p.ink === 'red')).toBe(false);
  });
});
