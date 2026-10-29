/**
 * What the overlay of a pet bout is told. It is a transparent click-through window that draws the bars, the numbers
 * and the flashes over the two pets; the page has no strings and no rules of its own, only what these say, in order.
 * Positions are in the overlay's own DIPs, from its top-left corner.
 */

export type RingSide = 0 | 1;

export type PopKind = 'hit' | 'crit' | 'block' | 'dodge';
export type SparkKind = 'hit' | 'crit' | 'block' | 'special';
export type BannerKind = 'fight' | 'ko' | 'win' | 'draw';

/** A fighter's plate: its name over its two bars, centred on `x` and with its top at `y`. */
export interface RingPlate {
  x: number;
  y: number;
  width: number;
  name: string;
  /** The pet's own colour (a CSS colour), for its name and the edge of its plate. */
  color: string;
}

export type RingMsg =
  | { op: 'init'; plates: [RingPlate, RingPlate] }
  /** A fighter's health and fury, 0 to 100 each. */
  | { op: 'bar'; side: RingSide; hp: number; fury: number }
  /** A number or a word that floats up from where a blow landed. */
  | { op: 'pop'; x: number; y: number; kind: PopKind; text: string }
  /** The flash of a blow. */
  | { op: 'spark'; x: number; y: number; kind: SparkKind }
  /** The count of blows in a row, by a fighter's plate. */
  | { op: 'combo'; side: RingSide; text: string }
  /** A big word over the ring, for `ms`; `sub` is a smaller line under it. */
  | { op: 'banner'; kind: BannerKind; text: string; sub?: string; ms: number }
  /** Stars circle over a fighter who is out. */
  | { op: 'stars'; x: number; y: number; on: boolean }
  | { op: 'confetti'; x: number; y: number };

/** The script the main process runs in the overlay's page to deliver `msgs`; they are data, never markup. */
export const ringScript = (msgs: readonly RingMsg[]): string => `window.ring(${JSON.stringify(msgs)})`;

export type HpTone = 'ok' | 'low' | 'critical';

/** The colour a health bar is drawn in: green, then amber at half, then red (and throbbing) at a quarter. */
export const hpTone = (hp: number): HpTone => (hp <= 25 ? 'critical' : hp <= 50 ? 'low' : 'ok');
