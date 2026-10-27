import { PET_FACES, type PetId } from './pet';

/** What a resting pet does now and then, so it doesn't sit frozen: a few of its own animations, played for a moment. */
export const LIFE_ANIMS: Record<PetId, readonly string[]> = {
  whale: ['dance', 'flying'],
  naiwa: ['stretch', 'laugh', 'play_bow', 'brain_loading', 'pretzel_twist', 'noodle_dance'],
  shenshen: ['wave', 'giggle', 'hum', 'yawn', 'stretch', 'bubbles', 'look', 'tail', 'cat', 'sway'],
  airi: ['tired', 'confused', 'awkward', 'love', 'thanks'],
};

/** Milliseconds a pet rests between two of its little shows, and how long one lasts. */
export const LIFE_GAP_MS = { min: 25_000, max: 70_000 } as const;
export const LIFE_PLAY_MS = { min: 4_000, max: 9_000 } as const;
/** A pet looks at the pointer only when it is at least this far (DIPs) to one side, so it doesn't flicker underneath. */
export const GLANCE_DEAD_ZONE = 80;

export interface Life {
  /** The animation it is playing for fun, or null while it rests. */
  doing: string | null;
  /** Epoch ms when that show ends, or, while it rests, when the next one starts. */
  until: number;
  last: string | null;
}

export type LifeAction = { kind: 'play'; anim: string } | { kind: 'rest' };

const between = (range: { min: number; max: number }, rand: () => number): number =>
  Math.round(range.min + rand() * (range.max - range.min));

/** A pet that has just settled: its first show comes after a rest. */
export function startLife(now: number, rand: () => number): Life {
  return { doing: null, until: now + between(LIFE_GAP_MS, rand), last: null };
}

/**
 * One look at a resting pet: nothing while its time hasn't come; back to rest when a show is over; a new show (not the
 * animation it rests in, not the one it just played) when the rest is over.
 */
export function lifeStep(
  life: Life, now: number, id: PetId, rest: string, rand: () => number,
): { life: Life; action: LifeAction | null } {
  if (now < life.until) return { life, action: null };
  if (life.doing !== null) {
    return { life: { doing: null, until: now + between(LIFE_GAP_MS, rand), last: life.doing }, action: { kind: 'rest' } };
  }
  const choices = LIFE_ANIMS[id].filter((a) => a !== rest && a !== life.last);
  if (choices.length === 0) return { life: { ...life, until: now + between(LIFE_GAP_MS, rand) }, action: null };
  const anim = choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))];
  return { life: { doing: anim, until: now + between(LIFE_PLAY_MS, rand), last: life.last }, action: { kind: 'play', anim } };
}

/** Whether a pet's picture is mirrored to face the pointer; `current` stays while the pointer is close to straight above. */
export function glanceFlip(id: PetId, petCenterX: number, pointerX: number, current: boolean): boolean {
  const dx = pointerX - petCenterX;
  if (Math.abs(dx) < GLANCE_DEAD_ZONE) return current;
  const artLeft = PET_FACES[id] === 'left';
  return dx > 0 ? artLeft : !artLeft;
}
