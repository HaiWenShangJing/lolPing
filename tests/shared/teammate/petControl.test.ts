import { describe, expect, it } from 'vitest';
import { MOODS } from '../../../src/shared/teammate/mood';
import { PET_IDS } from '../../../src/shared/teammate/pet';
import {
  PET_PLACES, PET_SAY_MAX, PET_TOOLS, SPEECH_SIZE, describePets, isPetTool, parsePetCall, petToolDefs, speechAt,
  speechMs, walkSpot, type PetTarget,
} from '../../../src/shared/teammate/petControl';

describe('petToolDefs', () => {
  const defs = petToolDefs();

  it('offers the four pet tools, each with a description and an object schema', () => {
    expect(defs.map((d) => d.name)).toEqual([...PET_TOOLS]);
    for (const d of defs) {
      expect(d.description.length).toBeGreaterThan(20);
      expect(d.parameters.type).toBe('object');
    }
  });

  it('lists the pets, moods and places an agent may name', () => {
    const props = (name: string) => defs.find((d) => d.name === name)?.parameters.properties as Record<string, { enum?: unknown }>;
    expect(props('pet_say').pet.enum).toEqual(PET_IDS);
    expect(props('pet_say').mood.enum).toEqual(MOODS);
    expect(props('pet_walk').to.enum).toEqual(PET_PLACES);
    expect(props('pet_play').mood.enum).toEqual(MOODS);
  });

  it('asks only for the text of a line', () => {
    const required = (name: string) => defs.find((d) => d.name === name)?.parameters.required;
    expect(required('pet_say')).toEqual(['text']);
    expect(required('pet_walk')).toBeUndefined();
  });

  it('recognises its own tools by name', () => {
    expect(PET_TOOLS.every(isPetTool)).toBe(true);
    expect(isPetTool('say')).toBe(false);
    expect(isPetTool('pet_fly')).toBe(false);
  });
});

describe('parsePetCall', () => {
  it('reads a status call whatever it is given', () => {
    expect(parsePetCall('pet_status', undefined)).toEqual({ kind: 'status' });
    expect(parsePetCall('pet_status', { pet: 'dog' })).toEqual({ kind: 'status' });
  });

  it('reads a line, trimmed and cut, with an optional mood and pet', () => {
    expect(parsePetCall('pet_say', { text: '  hello  ' })).toEqual({ kind: 'say', pet: null, text: 'hello', mood: null });
    expect(parsePetCall('pet_say', { text: 'hi', mood: 'shy', pet: 'airi' }))
      .toEqual({ kind: 'say', pet: 'airi', text: 'hi', mood: 'shy' });
    const long = parsePetCall('pet_say', { text: 'a'.repeat(PET_SAY_MAX + 50) });
    expect(long).toMatchObject({ kind: 'say' });
    expect(long && 'text' in long ? long.text : '').toHaveLength(PET_SAY_MAX);
  });

  it('drops a mood it doesn\'t know instead of refusing the line', () => {
    expect(parsePetCall('pet_say', { text: 'hi', mood: 'ecstatic' })).toEqual({ kind: 'say', pet: null, text: 'hi', mood: null });
  });

  it('refuses a line with no text, a text that is not a string, or a pet that does not exist', () => {
    expect(parsePetCall('pet_say', {})).toBeNull();
    expect(parsePetCall('pet_say', { text: '   ' })).toBeNull();
    expect(parsePetCall('pet_say', { text: 5 })).toBeNull();
    expect(parsePetCall('pet_say', { text: 'hi', pet: 'dog' })).toBeNull();
    expect(parsePetCall('pet_say', 'hi')).toBeNull();
    expect(parsePetCall('pet_say', null)).toBeNull();
  });

  it('reads a walk to a place, or to percentages that win over the place', () => {
    expect(parsePetCall('pet_walk', { to: 'center' })).toEqual({ kind: 'walk', pet: null, to: { place: 'center' } });
    expect(parsePetCall('pet_walk', { to: 'left', x: 25, y: 75, pet: 'whale' }))
      .toEqual({ kind: 'walk', pet: 'whale', to: { xPct: 25, yPct: 75 } });
  });

  it('keeps percentages on the display, and wants both or a place', () => {
    expect(parsePetCall('pet_walk', { x: -20, y: 400 })).toEqual({ kind: 'walk', pet: null, to: { xPct: 0, yPct: 100 } });
    expect(parsePetCall('pet_walk', { x: 50 })).toBeNull();
    expect(parsePetCall('pet_walk', { x: 50, to: 'top' })).toEqual({ kind: 'walk', pet: null, to: { place: 'top' } });
    expect(parsePetCall('pet_walk', { x: Number.NaN, y: 3 })).toBeNull();
    expect(parsePetCall('pet_walk', { to: 'the moon' })).toBeNull();
    expect(parsePetCall('pet_walk', {})).toBeNull();
  });

  it('reads an animation by name or a mood, and wants one of them', () => {
    expect(parsePetCall('pet_play', { animation: 'dance' })).toEqual({ kind: 'play', pet: null, anim: 'dance', mood: null });
    expect(parsePetCall('pet_play', { mood: 'love', pet: 'hiyori' })).toEqual({ kind: 'play', pet: 'hiyori', anim: null, mood: 'love' });
    expect(parsePetCall('pet_play', {})).toBeNull();
    expect(parsePetCall('pet_play', { animation: '../../etc' })).toBeNull();
    expect(parsePetCall('pet_play', { animation: 'Dance' })).toBeNull();
    expect(parsePetCall('pet_play', { animation: 'x'.repeat(33) })).toBeNull();
  });

  it('reads who a line is for, a pet or everyone, and leaves it out otherwise', () => {
    expect(parsePetCall('pet_say', { text: 'hey', to: 'airi' })).toEqual({ kind: 'say', pet: null, text: 'hey', mood: null, to: 'airi' });
    expect(parsePetCall('pet_say', { text: 'hey', to: 'all' })).toMatchObject({ to: 'all' });
    expect(parsePetCall('pet_say', { text: 'hey', to: 'dog' })).toEqual({ kind: 'say', pet: null, text: 'hey', mood: null });
    expect(parsePetCall('pet_say', { text: 'hey', to: 5 })).not.toHaveProperty('to');
  });

  it('reads a walk to stand beside another pet, but not beside itself', () => {
    expect(parsePetCall('pet_walk', { beside: 'airi', pet: 'naiwa' })).toEqual({ kind: 'walk', pet: 'naiwa', to: { beside: 'airi' } });
    expect(parsePetCall('pet_walk', { beside: 'naiwa', pet: 'naiwa' })).toBeNull();
    expect(parsePetCall('pet_walk', { beside: 'dog' })).toBeNull();
    expect(parsePetCall('pet_walk', { beside: 'airi', x: 10, y: 20 })).toEqual({ kind: 'walk', pet: null, to: { xPct: 10, yPct: 20 } });
    expect(parsePetCall('pet_walk', { beside: 'airi', to: 'left' })).toEqual({ kind: 'walk', pet: null, to: { beside: 'airi' } });
  });

  it('refuses a name that is not a pet tool', () => {
    expect(parsePetCall('say', { text: 'hi' })).toBeNull();
  });
});

describe('speechMs', () => {
  it('gives a short line a few seconds and a long one more, never over fifteen', () => {
    expect(speechMs('hi')).toBe(3_500);
    expect(speechMs('a'.repeat(40))).toBe(5_100);
    expect(speechMs('a'.repeat(PET_SAY_MAX))).toBe(15_000);
    expect(speechMs('a'.repeat(5_000))).toBe(15_000);
  });
});

describe('walkSpot', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: 200, height: 300 };
  const where = (over: Partial<Parameters<typeof walkSpot>[4]> = {}) => ({
    area, cursor: { at: { x: 1000, y: 600 }, area }, home: { x: 1700, y: 700 }, random: () => 0.5, ...over,
  });
  const spot = (to: PetTarget, index = 0, count = 1, over = {}) => walkSpot(to, size, index, count, where(over));

  it('goes to the pet\'s own home for home', () => {
    expect(spot({ place: 'home' })).toEqual({ x: 1700, y: 700 });
  });

  it('stands beside the cursor, on its left, and the second pet on its right', () => {
    const first = spot({ place: 'cursor' }, 0, 2);
    const second = spot({ place: 'cursor' }, 1, 2);
    expect(first.x + size.width).toBeLessThan(1000);
    expect(second.x).toBeGreaterThan(1000);
  });

  it('keeps a pet beside a cursor at the edge of its display', () => {
    const at = spot({ place: 'cursor' }, 0, 1, { cursor: { at: { x: 5, y: 5 }, area } });
    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.y).toBeGreaterThanOrEqual(0);
  });

  it('puts left and right in the bottom corners and top and center in the middle of the edge and screen', () => {
    expect(spot({ place: 'left' })).toEqual({ x: 12, y: 1040 - 300 - 12 });
    expect(spot({ place: 'right' })).toEqual({ x: 1920 - 200 - 12, y: 1040 - 300 - 12 });
    expect(spot({ place: 'top' })).toEqual({ x: 960 - 100, y: 12 });
    expect(spot({ place: 'center' })).toEqual({ x: 960 - 100, y: 520 - 150 });
  });

  it('puts a percentage at the middle of the pet, kept on the display', () => {
    expect(spot({ xPct: 50, yPct: 50 })).toEqual({ x: 860, y: 370 });
    expect(spot({ xPct: 0, yPct: 0 })).toEqual({ x: 0, y: 0 });
    expect(spot({ xPct: 100, yPct: 100 })).toEqual({ x: 1720, y: 740 });
  });

  it('puts random anywhere on the display, and each pet at its own place', () => {
    const rolls = [0, 0, 1, 1];
    const next = () => rolls.shift() ?? 0;
    expect(spot({ place: 'random' }, 0, 2, { random: next })).toEqual({ x: 0, y: 0 });
    expect(spot({ place: 'random' }, 1, 2, { random: next })).toEqual({ x: 1720, y: 740 });
  });

  it('stands pets sent to one place side by side', () => {
    const a = spot({ place: 'center' }, 0, 3);
    const b = spot({ place: 'center' }, 1, 3);
    const c = spot({ place: 'center' }, 2, 3);
    expect(b.x - a.x).toBe(size.width + 8);
    expect(c.x - b.x).toBe(size.width + 8);
    expect(a.y).toBe(b.y);
  });

  describe('beside another pet', () => {
    const other = { x: 800, y: 500, width: 160, height: 240 };
    const beside = (r: typeof other | null) => ({ beside: () => r });

    it('stands to the right of it, on the same ground', () => {
      const at = spot({ beside: 'airi' }, 0, 1, beside(other));
      expect(at.x).toBeGreaterThanOrEqual(other.x + other.width);
      expect(at.x).toBeLessThan(other.x + other.width + 40);
      expect(at.y + size.height).toBe(other.y + other.height);
    });

    it('stands to its left when there is no room on the right', () => {
      const edge = { ...other, x: 1920 - 160 };
      const at = spot({ beside: 'airi' }, 0, 1, beside(edge));
      expect(at.x + size.width).toBeLessThanOrEqual(edge.x);
      expect(at.x).toBeGreaterThan(edge.x - size.width - 40);
    });

    it('goes home when the other pet is not there', () => {
      expect(spot({ beside: 'airi' }, 0, 1, beside(null))).toEqual({ x: 1700, y: 700 });
      expect(spot({ beside: 'airi' })).toEqual({ x: 1700, y: 700 });
    });

    it('stays on the display', () => {
      const low = { x: 800, y: 1000, width: 160, height: 100 };
      const at = spot({ beside: 'airi' }, 0, 1, beside(low));
      expect(at.y + size.height).toBeLessThanOrEqual(area.height);
      expect(at.y).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('speechAt', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };

  it('centres the bubble over the pet with its tail near the top of the character', () => {
    const at = speechAt({ x: 800, y: 600, width: 200, height: 300 }, area);
    expect(at.x + SPEECH_SIZE.width / 2).toBe(900);
    expect(at.y + SPEECH_SIZE.height).toBe(Math.round(600 + 300 * 0.14));
  });

  it('keeps the bubble on the display', () => {
    const corner = speechAt({ x: 0, y: 0, width: 128, height: 128 }, area);
    expect(corner).toEqual({ x: 0, y: 0 });
    const far = speechAt({ x: 1900, y: 1000, width: 128, height: 128 }, area);
    expect(far.x + SPEECH_SIZE.width).toBeLessThanOrEqual(1920);
  });
});

describe('describePets', () => {
  it('says there is none when none shows', () => {
    expect(describePets([])).toContain('No desktop pet is showing');
  });

  it('lists each pet\'s place and animations, and the moods', () => {
    const text = describePets([
      { id: 'whale', xPct: 92, yPct: 80, away: false, anims: ['idle', 'walk', 'dance'] },
      { id: 'airi', xPct: 10, yPct: 50, away: true, anims: ['idle', 'love'] },
    ]);
    expect(text).toContain('- whale: at x 92%, y 80% (at home); animations: idle, walk, dance');
    expect(text).toContain('- airi: at x 10%, y 50% (away from home); animations: idle, love');
    expect(text).toContain(`Moods: ${MOODS.join(', ')}.`);
  });
});
