/**
 * What the teammate remembers about the user between asks: short one-line notes the model saves with `remember`, and the
 * user reads, edits and clears in Settings. Kept encrypted next to Your instructions; off until the user turns it on.
 */

export const MEMORY_MAX_ITEMS = 40;
export const MEMORY_ITEM_MAX = 160;

/** Text a note must never hold: a key, token or card number would be sent to the provider with every ask. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|AKIA|AIza|ya29)[-_.A-Za-z0-9]{12,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./,
  /\b(?:\d[ -]?){13,19}\b/,
  /\b(?:password|passwd|passcode|pin|api[ _-]?key|secret|token|口令|密码|密钥|令牌)\s*(?:is|are|=|:|：|是|为)/i,
  /(?:密码|口令|密钥)\s*[是为:：=]/,
  /[A-Za-z0-9+/]{32,}/,
];

export const looksSecret = (text: string): boolean => SECRET_PATTERNS.some((p) => p.test(text));

/** One note: one line, single spaces, cut to the limit. */
export function cleanNote(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > MEMORY_ITEM_MAX ? `${line.slice(0, MEMORY_ITEM_MAX - 1).trimEnd()}…` : line;
}

const same = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Notes as stored or typed: cleaned, without blanks or repeats (the later copy stays), the newest MEMORY_MAX_ITEMS. */
export function normalizeMemory(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'string') continue;
    const note = cleanNote(item);
    if (note === '') continue;
    const at = out.findIndex((n) => same(n, note));
    if (at >= 0) out.splice(at, 1);
    out.push(note);
  }
  return out.slice(-MEMORY_MAX_ITEMS);
}

export type Remembered =
  | { outcome: 'saved'; items: string[] }
  | { outcome: 'known' | 'empty' | 'secret'; items: string[] };

/** The model saves one note: refused when blank or secret-looking, ignored when already there; the oldest makes room. */
export function addMemory(items: readonly string[], text: string): Remembered {
  const note = cleanNote(text);
  if (note === '') return { outcome: 'empty', items: [...items] };
  if (looksSecret(note)) return { outcome: 'secret', items: [...items] };
  if (items.some((n) => same(n, note))) return { outcome: 'known', items: [...items] };
  return { outcome: 'saved', items: [...items, note].slice(-MEMORY_MAX_ITEMS) };
}

/** The settings box shows one note per line. */
export const memoryText = (items: readonly string[]): string => items.join('\n');

export const parseMemoryText = (text: string): string[] => normalizeMemory(text.split(/\r?\n/));

/** The model's reply to `remember`, so it knows whether the note is kept. */
export function rememberReply(outcome: Remembered['outcome']): string {
  switch (outcome) {
    case 'saved': return 'Remembered.';
    case 'known': return 'Already remembered.';
    case 'empty': return 'Nothing to remember.';
    case 'secret': return 'Not remembered: never save passwords, keys or card numbers.';
  }
}
