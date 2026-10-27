import { describe, expect, it } from 'vitest';
import { lastMood, MOOD_ANIMS, MOODS, moodAnim, parseMood } from '../../../src/shared/teammate/mood';
import { PET_IDS, PET_POSES, PET_RESTS } from '../../../src/shared/teammate/pet';
import type { ToolCall } from '../../../src/shared/teammate/tools';

describe('parseMood', () => {
  it('knows each mood and nothing else', () => {
    for (const m of MOODS) expect(parseMood(m)).toBe(m);
    expect(parseMood('ecstatic')).toBeNull();
    expect(parseMood(undefined)).toBeNull();
    expect(parseMood(3)).toBeNull();
  });
});

describe('MOOD_ANIMS', () => {
  it.each(PET_IDS)('only names animations that %s has', (id) => {
    const has = new Set<string>([...PET_RESTS[id], ...PET_POSES]);
    for (const anim of Object.values(MOOD_ANIMS[id])) expect(has.has(anim), anim).toBe(true);
  });
});

describe('moodAnim', () => {
  const all = (): boolean => true;
  const none = (): boolean => false;

  it('plays the plain happy pose when there is no mood', () => {
    for (const id of PET_IDS) expect(moodAnim(id, null, all)).toBe('happy');
  });

  it("plays the pack's own animation for a mood", () => {
    expect(moodAnim('airi', 'sad', all)).toBe('sad');
    expect(moodAnim('shenshen', 'shy', all)).toBe('shy');
    expect(moodAnim('naiwa', 'confused', all)).toBe('brain_loading');
    expect(moodAnim('whale', 'love', all)).toBe('dance');
  });

  it('falls back to happy for good moods and to think for the others', () => {
    expect(moodAnim('whale', 'thanks', all)).toBe('happy');
    expect(moodAnim('whale', 'sad', all)).toBe('think');
    expect(moodAnim('airi', 'love', none)).toBe('happy');
    expect(moodAnim('airi', 'angry', none)).toBe('think');
  });
});

describe('lastMood', () => {
  const say = (text: string, mood?: (typeof MOODS)[number]): ToolCall => ({ tool: 'say', text, ...(mood ? { mood } : {}) });

  it('takes the mood of the last say that has one', () => {
    expect(lastMood([say('a', 'sad'), say('b', 'happy'), say('c')])).toBe('happy');
  });

  it('is null when no call has one', () => {
    expect(lastMood([say('a'), { tool: 'answer', markdown: 'x' }])).toBeNull();
    expect(lastMood([])).toBeNull();
  });
});
