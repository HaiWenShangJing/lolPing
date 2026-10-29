/**
 * Where everything sits on the mahjong scene's stage: a fixed 1280x720 space the page scales to fit its window. The four
 * pets sit in a row behind one long table, each with a rack of tiles, a row of laid-out sets and a pool of thrown tiles
 * in front of it, so every number here is about keeping those from running into each other.
 */

export const STAGE = { w: 1280, h: 720 } as const;

/** The scale and offset that fit the stage in a window of `w` by `h` pixels, centred. */
export function fitStage(w: number, h: number): { scale: number; x: number; y: number } {
  const scale = Math.max(0.2, Math.min(w / STAGE.w, h / STAGE.h));
  return { scale, x: Math.round((w - STAGE.w * scale) / 2), y: Math.round((h - STAGE.h * scale) / 2) };
}

/** The middle of each seat, left to right; a wider gap in the middle leaves room for the dice. */
export const SEAT_X: readonly number[] = [235, 500, 780, 1045];

/** The table's outer edge. */
export const TABLE = { x: 95, y: 452, w: 1090, h: 258 } as const;

/** A tile face-up is `FACE`; tiles standing in a rack are smaller, laid-out sets a little smaller than the pool. */
export const FACE = { w: 22, h: 30 } as const;
export const RACK = { y: 489, scale: 0.727, gap: 12 } as const;
export const MELD = { y: 524, scale: 0.8, gap: 8 } as const;
export const POOL = { y: 566, cols: 6, rows: 4, dy: 31 } as const;

/** Where the dice and the shuffled tiles are. */
export const CENTER = { x: 640, y: 592 } as const;

/** Where the name plates are, at the front edge of the table. */
export const PLATE_Y = 692;

/**
 * How tall a pet sits and where its feet are, by seat. A figure drawn in frames is a whole body in a frame with some air
 * round it, so it is drawn smaller than a Live2D model; the two in the middle sit a little further back, so all four fit.
 * The table hides everything below its edge, so the feet are never seen.
 */
export const FIGURES = {
  live2d: [{ h: 490, feet: 640 }, { h: 450, feet: 610 }, { h: 450, feet: 610 }, { h: 490, feet: 640 }],
  frames: [{ h: 350, feet: 575 }, { h: 330, feet: 560 }, { h: 330, feet: 560 }, { h: 350, feet: 575 }],
} as const;

export interface Figure {
  h: number;
  feet: number;
}

export function figureAt(kind: keyof typeof FIGURES, seat: number): Figure {
  const all: readonly Figure[] = FIGURES[kind];
  return all[Math.max(0, Math.min(all.length - 1, seat))] as Figure;
}

export interface Point {
  x: number;
  y: number;
}

/** A tile's centre, and whether it lies on its side. */
export interface Slot extends Point {
  turned: boolean;
}

const rackW = (): number => FACE.w * RACK.scale;

/** The width of a rack of `count` tiles, one of which stands apart when `drawn`. */
export const rackWidth = (count: number, drawn: boolean): number => count * rackW() + (drawn && count > 1 ? RACK.gap : 0);

/** The centre of tile `index` of `seat`'s rack of `count`; the last stands apart from the rest when `drawn`. */
export function rackSlot(seat: number, index: number, count: number, drawn: boolean): Point {
  const w = rackW();
  const left = (SEAT_X[seat] ?? 0) - rackWidth(count, drawn) / 2;
  const apart = drawn && index === count - 1 && count > 1 ? RACK.gap : 0;
  return { x: left + index * w + w / 2 + apart, y: RACK.y };
}

/** The centre of the `k`th tile `seat` has thrown; a pool of more than the rows hold piles on the last row. */
export function poolSlot(seat: number, k: number): Point {
  const col = k % POOL.cols;
  const row = Math.min(POOL.rows - 1, Math.floor(k / POOL.cols));
  return { x: (SEAT_X[seat] ?? 0) - (POOL.cols * FACE.w) / 2 + FACE.w / 2 + col * FACE.w, y: POOL.y + row * POOL.dy };
}

/** How wide a set is: a little wider than three standing tiles when one of them lies on its side. */
const meldW = (turned: number): number => {
  const w = FACE.w * MELD.scale;
  return turned >= 0 && turned < 3 ? w * 2 + FACE.h * MELD.scale : w * 3;
};

/** The width of a row of sets, `sides[i]` being which tile of set `i` lies on its side. */
export const meldWidth = (sides: readonly number[]): number =>
  sides.reduce((sum, s) => sum + meldW(s), 0) + Math.max(0, sides.length - 1) * MELD.gap;

/**
 * The slots of `seat`'s sets, laid in a row under its rack: for each set, `sides[i]` is which of its three tiles lies on
 * its side (the one that was claimed), so a set is a little wider than three standing tiles.
 */
export function meldSlots(seat: number, sides: readonly number[]): Slot[][] {
  const w = FACE.w * MELD.scale;
  const side = FACE.h * MELD.scale;
  const widths = sides.map(meldW);
  let left = (SEAT_X[seat] ?? 0) - meldWidth(sides) / 2;
  return sides.map((turned, m) => {
    const slots: Slot[] = [];
    let x = left;
    for (let t = 0; t < 3; t++) {
      const wide = t === turned;
      const tw = wide ? side : w;
      // A tile on its side is shorter, so it rests on the same line as the standing ones.
      slots.push({ x: x + tw / 2, y: MELD.y + (wide ? ((FACE.h - FACE.w) * MELD.scale) / 2 : 0), turned: wide });
      x += tw;
    }
    left += (widths[m] ?? 0) + MELD.gap;
    return slots;
  });
}

/** Where a pet's speech bubble points to: above the middle of the seat, over the head of a figure `top` high. */
export const bubbleAnchor = (seat: number, top: number): Point => ({ x: SEAT_X[seat] ?? 0, y: Math.max(96, top + 34) });

/** Which of a set's three tiles lies on its side: the claimed one in a run, else by where the tile came from. */
export function claimSide(seat: number, from: number, tiles: readonly number[], claimed: number, run: boolean): number {
  if (run) return Math.max(0, tiles.indexOf(claimed));
  const away = (from - seat + 4) % 4;
  return away === 3 ? 0 : away === 2 ? 1 : 2;
}
