/**
 * What the 34 tile faces look like, apart from drawing them: which suit a tile is, and where the dots and sticks of a
 * number tile go on a unit square. Drawing a face from these (instead of a font's mahjong glyphs) looks the same on
 * every machine, whatever fonts it has.
 */

/** The size of a tile's art in pixels: three to every pixel of the stage, so a tile stays sharp when the stage is zoomed. */
export const TILE_SCALE = 3;
export const TILE_W = 22 * TILE_SCALE;
export const TILE_H = 30 * TILE_SCALE;
/** How much of the bottom of a face up tile is the green edge. */
export const TILE_DEPTH = 12;
/** Where a face's drawing goes inside the tile. */
export const FACE_BOX = { x: 7, y: 6, w: TILE_W - 14, h: TILE_H - TILE_DEPTH - 12 } as const;

export type Suit = 'man' | 'sou' | 'pin' | 'wind' | 'dragon';

/** `n` is 1 to 9 for a number tile, 1 to 4 for a wind (east, south, west, north) and 1 to 3 for a dragon (red, green, white). */
export interface TileFace {
  suit: Suit;
  n: number;
}

/** What tile `kind` (0 to 33, as the mahjong table numbers them) is. */
export function describeTile(kind: number): TileFace {
  if (kind < 9) return { suit: 'man', n: kind + 1 };
  if (kind < 18) return { suit: 'sou', n: kind - 8 };
  if (kind < 27) return { suit: 'pin', n: kind - 17 };
  if (kind < 31) return { suit: 'wind', n: kind - 26 };
  return { suit: 'dragon', n: kind - 30 };
}

export const MAN_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;
export const WIND_CHARS = ['東', '南', '西', '北'] as const;
export const DRAGON_CHARS = ['中', '發', '白'] as const;

export type Ink = 'green' | 'red' | 'blue';

/** A dot or a stick, by the middle of it on the unit square. */
export interface Pip {
  x: number;
  y: number;
  ink: Ink;
}

const pips = (...list: [number, number, Ink][]): Pip[] => list.map(([x, y, ink]) => ({ x, y, ink }));
const G: Ink = 'green';
const R: Ink = 'red';
const B: Ink = 'blue';

/** The dots of each circle tile (index n - 1), and the radius of one as a fraction of the box's width. */
export const CIRCLES: readonly { r: number; pips: Pip[] }[] = [
  { r: 0.34, pips: pips([0.5, 0.5, R]) },
  { r: 0.2, pips: pips([0.5, 0.27, G], [0.5, 0.73, B]) },
  { r: 0.17, pips: pips([0.28, 0.2, B], [0.5, 0.5, R], [0.72, 0.8, G]) },
  { r: 0.18, pips: pips([0.3, 0.27, G], [0.7, 0.27, B], [0.3, 0.73, B], [0.7, 0.73, G]) },
  { r: 0.16, pips: pips([0.3, 0.27, G], [0.7, 0.27, B], [0.3, 0.73, B], [0.7, 0.73, G], [0.5, 0.5, R]) },
  { r: 0.15, pips: pips([0.3, 0.2, G], [0.7, 0.2, G], [0.3, 0.5, R], [0.7, 0.5, R], [0.3, 0.8, R], [0.7, 0.8, R]) },
  {
    r: 0.12,
    pips: pips(
      [0.22, 0.14, G], [0.5, 0.26, G], [0.78, 0.38, G],
      [0.3, 0.66, R], [0.7, 0.66, R], [0.3, 0.86, R], [0.7, 0.86, R],
    ),
  },
  {
    r: 0.13,
    pips: pips(
      [0.3, 0.14, B], [0.7, 0.14, B], [0.3, 0.38, B], [0.7, 0.38, B],
      [0.3, 0.62, B], [0.7, 0.62, B], [0.3, 0.86, B], [0.7, 0.86, B],
    ),
  },
  {
    r: 0.13,
    pips: pips(
      [0.2, 0.2, G], [0.5, 0.2, G], [0.8, 0.2, G],
      [0.2, 0.5, R], [0.5, 0.5, R], [0.8, 0.5, R],
      [0.2, 0.8, B], [0.5, 0.8, B], [0.8, 0.8, B],
    ),
  },
];

/**
 * The sticks of each bamboo tile (index n - 1) and their size as fractions of the box; the one stick of the first is a
 * bird, drawn as a figure that fills `w` by `h`.
 */
export const STICKS: readonly { w: number; h: number; pips: Pip[] }[] = [
  { w: 0.62, h: 0.76, pips: pips([0.5, 0.5, G]) },
  { w: 0.15, h: 0.4, pips: pips([0.5, 0.27, G], [0.5, 0.73, B]) },
  { w: 0.15, h: 0.4, pips: pips([0.5, 0.27, G], [0.3, 0.73, B], [0.7, 0.73, B]) },
  { w: 0.15, h: 0.4, pips: pips([0.3, 0.27, G], [0.7, 0.27, B], [0.3, 0.73, B], [0.7, 0.73, G]) },
  { w: 0.15, h: 0.4, pips: pips([0.3, 0.27, G], [0.7, 0.27, B], [0.3, 0.73, B], [0.7, 0.73, G], [0.5, 0.5, R]) },
  {
    w: 0.15,
    h: 0.4,
    pips: pips([0.25, 0.27, G], [0.5, 0.27, G], [0.75, 0.27, G], [0.25, 0.73, B], [0.5, 0.73, B], [0.75, 0.73, B]),
  },
  {
    w: 0.15,
    h: 0.3,
    pips: pips(
      [0.5, 0.17, R],
      [0.25, 0.5, G], [0.5, 0.5, G], [0.75, 0.5, G],
      [0.25, 0.83, B], [0.5, 0.83, B], [0.75, 0.83, B],
    ),
  },
  {
    w: 0.12,
    h: 0.4,
    pips: pips(
      [0.2, 0.27, G], [0.4, 0.27, B], [0.6, 0.27, B], [0.8, 0.27, G],
      [0.2, 0.73, G], [0.4, 0.73, B], [0.6, 0.73, B], [0.8, 0.73, G],
    ),
  },
  {
    w: 0.15,
    h: 0.3,
    pips: pips(
      [0.25, 0.17, G], [0.5, 0.17, G], [0.75, 0.17, G],
      [0.25, 0.5, R], [0.5, 0.5, R], [0.75, 0.5, R],
      [0.25, 0.83, B], [0.5, 0.83, B], [0.75, 0.83, B],
    ),
  },
];
