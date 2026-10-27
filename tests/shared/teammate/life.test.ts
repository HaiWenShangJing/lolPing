import { describe, expect, it } from 'vitest';
import {
  GLANCE_DEAD_ZONE, glanceFlip, LIFE_ANIMS, LIFE_GAP_MS, LIFE_PLAY_MS, lifeStep, startLife, type Life,
} from '../../../src/shared/teammate/life';
import { PET_IDS, PET_RESTS } from '../../../src/shared/teammate/pet';

const low = (): number => 0;
const high = (): number => 0.999999;

describe('LIFE_ANIMS', () => {
  it.each(PET_IDS)('only names animations %s can rest in, so its pack has them', (id) => {
    for (const anim of LIFE_ANIMS[id]) expect(PET_RESTS[id], anim).toContain(anim);
    expect(LIFE_ANIMS[id].length).toBeGreaterThan(1);
  });
});

describe('startLife', () => {
  it('waits a rest before the first show', () => {
    expect(startLife(1000, low)).toEqual({ doing: null, until: 1000 + LIFE_GAP_MS.min, last: null });
    expect(startLife(1000, high).until).toBe(1000 + LIFE_GAP_MS.max);
  });
});

describe('lifeStep', () => {
  const resting: Life = { doing: null, until: 5000, last: null };

  it('does nothing before its time', () => {
    const r = lifeStep(resting, 4999, 'shenshen', 'idle', low);
    expect(r.action).toBeNull();
    expect(r.life).toBe(resting);
  });

  it('starts a show when the rest is over, for a few seconds', () => {
    const r = lifeStep(resting, 5000, 'shenshen', 'idle', low);
    expect(r.action).toEqual({ kind: 'play', anim: LIFE_ANIMS.shenshen[0] });
    expect(r.life).toEqual({ doing: LIFE_ANIMS.shenshen[0], until: 5000 + LIFE_PLAY_MS.min, last: null });
  });

  it('goes back to resting when the show is over, and rests before the next', () => {
    const playing: Life = { doing: 'wave', until: 8000, last: null };
    const r = lifeStep(playing, 8000, 'shenshen', 'idle', low);
    expect(r.action).toEqual({ kind: 'rest' });
    expect(r.life).toEqual({ doing: null, until: 8000 + LIFE_GAP_MS.min, last: 'wave' });
  });

  it('never repeats the show it just played or plays the animation it rests in', () => {
    const again: Life = { doing: null, until: 0, last: LIFE_ANIMS.naiwa[0] };
    for (const rand of [low, high]) {
      const r = lifeStep(again, 1, 'naiwa', LIFE_ANIMS.naiwa[1], rand);
      const anim = r.action?.kind === 'play' ? r.action.anim : null;
      expect(anim).not.toBeNull();
      expect(anim).not.toBe(LIFE_ANIMS.naiwa[0]);
      expect(anim).not.toBe(LIFE_ANIMS.naiwa[1]);
    }
  });

  it('keeps resting when the pet has nothing else to play', () => {
    const r = lifeStep({ doing: null, until: 0, last: 'flying' }, 10, 'whale', 'dance', low);
    expect(r.action).toBeNull();
    expect(r.life.until).toBe(10 + LIFE_GAP_MS.min);
  });
});

describe('glanceFlip', () => {
  it('turns a right-facing pack to the pointer', () => {
    expect(glanceFlip('whale', 500, 900, false)).toBe(false);
    expect(glanceFlip('whale', 500, 100, false)).toBe(true);
  });

  it('turns a left-facing pack the other way', () => {
    expect(glanceFlip('naiwa', 500, 900, false)).toBe(true);
    expect(glanceFlip('naiwa', 500, 100, true)).toBe(false);
  });

  it('stays as it was while the pointer is nearly above it', () => {
    expect(glanceFlip('airi', 500, 500 + GLANCE_DEAD_ZONE - 1, true)).toBe(true);
    expect(glanceFlip('airi', 500, 500 - GLANCE_DEAD_ZONE + 1, false)).toBe(false);
  });
});
