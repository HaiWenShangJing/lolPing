/**
 * What every game's minds read alike: the JSON object a reply holds, and the numbers in it. A mind writes whatever it
 * likes, so nothing here trusts it; what it says is checked against the game's own options by the one that asked.
 */

/** How a seat is called in what its mind reads: a pet by its name, the user as "the user". */
export type Names = (seat: number) => string;

/** Seats are numbered from 1 in what a mind reads. */
export const no = (seat: number): string => `#${seat + 1}`;

/** `seat` named as `me` reads it: a number and a name, and "you" for oneself. */
export const tagger = (me: number, names: Names) => (seat: number): string =>
  `${no(seat)} ${seat === me ? 'you' : names(seat)}`;

export const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The first JSON object in `text`, which may sit in a code fence or among words. */
export function jsonOf(text: string): Record<string, unknown> | null {
  const s = text.slice(0, 4000);
  for (let at = s.indexOf('{'); at >= 0; at = s.indexOf('{', at + 1)) {
    let depth = 0;
    let quoted = false;
    for (let i = at; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '\\') i++;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          const v: unknown = JSON.parse(s.slice(at, i + 1));
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch {
          // Not JSON after all: look at the next brace.
        }
        break;
      }
    }
  }
  return null;
}

/** A whole number as a mind may write it: 7, "7", "#7" or "[7]". */
export function intIn(v: unknown): number | null {
  const n = typeof v === 'string' && /^\s*[#[]?\s*\d{1,4}\s*\]?\s*$/.test(v) ? Number(v.replace(/[#[\]\s]/g, '')) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

/** The whole numbers of a list a mind wrote (one number alone counts as a list); null when anything in it is not one. */
export function intsIn(v: unknown): number[] | null {
  const list: unknown[] = Array.isArray(v) ? v : [v];
  const out: number[] = [];
  for (const item of list) {
    const n = intIn(item);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}
