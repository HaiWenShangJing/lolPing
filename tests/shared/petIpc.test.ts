import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePetDrag, parsePetHit, PET_CH } from '../../src/shared/petIpc';

describe('parsePetDrag', () => {
  it('reads a phase and a position', () => {
    expect(parsePetDrag({ phase: 'move', x: 10, y: -4.5 })).toEqual({ phase: 'move', x: 10, y: -4.5 });
  });

  it('refuses anything else', () => {
    expect(parsePetDrag(null)).toBeNull();
    expect(parsePetDrag('start')).toBeNull();
    expect(parsePetDrag({ phase: 'drop', x: 1, y: 1 })).toBeNull();
    expect(parsePetDrag({ phase: 'start', x: Number.NaN, y: 1 })).toBeNull();
    expect(parsePetDrag({ phase: 'start', x: 1 })).toBeNull();
  });
});

describe('parsePetHit', () => {
  it('reads whether the pointer is over the character', () => {
    expect(parsePetHit({ over: true })).toEqual({ over: true });
    expect(parsePetHit({ over: false })).toEqual({ over: false });
  });

  it('refuses a value that is not a boolean, so a page cannot make a pet swallow clicks by sending junk', () => {
    expect(parsePetHit(null)).toBeNull();
    expect(parsePetHit({})).toBeNull();
    expect(parsePetHit({ over: 1 })).toBeNull();
    expect(parsePetHit({ over: 'true' })).toBeNull();
    expect(parsePetHit(true)).toBeNull();
  });
});

describe('the pet preload', () => {
  // The preload is bundled on its own and cannot import this file, so it repeats the channel names.
  const source = readFileSync(join(__dirname, '..', '..', 'src', 'preload', 'pet.ts'), 'utf8');

  it.each(Object.values(PET_CH))('uses the channel %s', (channel) => {
    expect(source).toContain(`'${channel}'`);
  });

  it('has a channel each', () => {
    expect(new Set(Object.values(PET_CH)).size).toBe(Object.keys(PET_CH).length);
  });
});
