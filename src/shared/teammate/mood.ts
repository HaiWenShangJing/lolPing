import type { PetId } from './pet';
import type { ToolCall } from './tools';

/** How the teammate feels about what it says; each desktop pet acts it out in its own animation. */
export const MOODS = [
  'happy', 'love', 'thanks', 'agree', 'playful', 'confused', 'surprised', 'sad', 'angry', 'shy', 'tired',
] as const;
export type Mood = (typeof MOODS)[number];

/** The moods that read as good news; the rest fall back to the thinking pose where a pack has no animation for them. */
const UPBEAT: ReadonlySet<Mood> = new Set<Mood>(['happy', 'love', 'thanks', 'agree', 'playful']);

/** The animation (a name in the pack) each pet plays for a mood; a mood a pack has no art for is simply missing. */
export const MOOD_ANIMS: Record<PetId, Partial<Record<Mood, string>>> = {
  whale: { love: 'dance', playful: 'flying' },
  naiwa: {
    happy: 'laugh', love: 'noodle_dance', thanks: 'play_bow', agree: 'victory', playful: 'noodle_dance',
    confused: 'brain_loading', surprised: 'freeze', sad: 'fake_faint', shy: 'pretzel_twist', tired: 'stretch',
  },
  shenshen: {
    happy: 'giggle', love: 'hum', thanks: 'wave', agree: 'wave', playful: 'dance', confused: 'look', surprised: 'bubbles',
    sad: 'sulk', angry: 'sulk', shy: 'shy', tired: 'yawn',
  },
  airi: {
    happy: 'celebrate', love: 'love', thanks: 'thanks', agree: 'agree', playful: 'celebrate', confused: 'confused',
    surprised: 'surprised', sad: 'sad', angry: 'angry', shy: 'awkward', tired: 'tired',
  },
};

export function parseMood(v: unknown): Mood | null {
  return MOODS.find((m) => m === v) ?? null;
}

/**
 * The animation a pet plays when the answer is in: the one for `mood` if the pack has it, else the plain `happy` pose
 * for good news and `think` otherwise. No mood at all is the cheer a pet always gave.
 */
export function moodAnim(pet: PetId, mood: Mood | null, has: (anim: string) => boolean): string {
  if (mood === null) return 'happy';
  const own = MOOD_ANIMS[pet][mood];
  if (own !== undefined && has(own)) return own;
  return UPBEAT.has(mood) ? 'happy' : 'think';
}

/** The mood of the last call that carried one, so the pet reacts to how the answer ended. */
export function lastMood(calls: readonly ToolCall[]): Mood | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (c.tool === 'say' && c.mood !== undefined) return c.mood;
  }
  return null;
}
