/** Small text rules the pet settings and the pet minds share (no imports, so any of them can use it). */

/** The longest personality a user can write for a pet. */
export const PERSONA_MAX = 300;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** A model id as Copilot CLI names it; null (its own choice) for anything else. */
export function modelId(raw: unknown): string | null {
  return typeof raw === 'string' && MODEL_ID.test(raw) ? raw : null;
}

/** One line of text: whitespace runs become a space, then trimmed and cut to `max` characters. */
export function cleanLine(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
