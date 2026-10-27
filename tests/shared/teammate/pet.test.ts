import { describe, expect, it } from 'vitest';
import {
  keepInside, normalizePets, parsePetManifest, petIds, PET_IDS, PET_POSES, PET_RESTS, standBeside, standLeftOf, stepToward,
} from '../../../src/shared/teammate/pet';

const pack = (over: Record<string, unknown> = {}) => ({
  id: 'whale', width: 100, height: 120,
  anims: Object.fromEntries(PET_POSES.map((p) => [p, { frames: [`${p}_00.png`, `${p}_01.png`], fps: 8 }])),
  ...over,
});

describe('petIds', () => {
  it('lists the characters that are on', () => {
    const on = (...ids: string[]) => ({
      whale: { on: ids.includes('whale'), rest: 'idle' }, naiwa: { on: ids.includes('naiwa'), rest: 'sit' },
      shenshen: { on: ids.includes('shenshen'), rest: 'idle' }, airi: { on: ids.includes('airi'), rest: 'idle' },
    });
    expect(petIds(on())).toEqual([]);
    expect(petIds(on('whale'))).toEqual(['whale']);
    expect(petIds(on('naiwa'))).toEqual(['naiwa']);
    expect(petIds(on('airi', 'whale'))).toEqual(['whale', 'airi']);
    expect(petIds(on('whale', 'naiwa', 'shenshen', 'airi'))).toEqual(['whale', 'naiwa', 'shenshen', 'airi']);
  });
});

describe('normalizePets', () => {
  it('defaults to all off, resting in the first animation', () => {
    expect(normalizePets(undefined)).toEqual({
      whale: { on: false, rest: 'idle' }, naiwa: { on: false, rest: 'sit' },
      shenshen: { on: false, rest: 'idle' }, airi: { on: false, rest: 'idle' },
    });
  });

  it('keeps a known animation and drops an unknown one', () => {
    const p = normalizePets({
      whale: { on: true, rest: 'dance' }, naiwa: { on: true, rest: 'dance' },
      shenshen: { on: true, rest: 'dance' }, airi: { on: true, rest: 'dance' },
    });
    expect(p.whale).toEqual({ on: true, rest: 'dance' });
    expect(p.naiwa).toEqual({ on: true, rest: 'sit' });
    expect(p.shenshen).toEqual({ on: true, rest: 'dance' });
    expect(p.airi).toEqual({ on: true, rest: 'idle' });
  });

  it('only turns a character on for true', () => {
    expect(normalizePets({ whale: { on: 'yes' } }).whale.on).toBe(false);
  });

  it('only offers resting animations a pack can have as a name', () => {
    for (const id of PET_IDS) for (const rest of PET_RESTS[id]) expect(rest).toMatch(/^[a-z0-9_]{1,32}$/);
  });
});
describe('parsePetManifest', () => {
  it('reads a complete pack', () => {
    const m = parsePetManifest(pack());
    expect(m?.width).toBe(100);
    expect(m?.anims.walk.frames).toHaveLength(2);
  });

  it('refuses a pack that lacks a pose', () => {
    const p = pack();
    delete (p.anims as Record<string, unknown>).think;
    expect(parsePetManifest(p)).toBeNull();
  });

  it('refuses frame names that could leave the pack folder', () => {
    const p = pack();
    (p.anims as Record<string, { frames: string[] }>).idle.frames = ['../secret.png'];
    expect(parsePetManifest(p)).toBeNull();
  });

  it('keeps the window size within limits and defaults a missing fps', () => {
    const p = pack({ width: 9000, height: 1 });
    (p.anims as Record<string, { fps?: number }>).idle.fps = undefined;
    const m = parsePetManifest(p);
    expect(m?.width).toBe(512);
    expect(m?.height).toBe(32);
    expect(m?.anims.idle.fps).toBe(8);
  });
});

describe('stepToward', () => {
  it('moves by speed times time', () => {
    const s = stepToward({ x: 0, y: 0 }, { x: 100, y: 0 }, 500, 100);
    expect(s.at).toEqual({ x: 50, y: 0 });
    expect(s.arrived).toBe(false);
  });

  it('arrives exactly instead of overshooting', () => {
    expect(stepToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 900, 100)).toEqual({ at: { x: 10, y: 0 }, arrived: true });
  });
});

describe('standLeftOf', () => {
  const size = { width: 100, height: 100 };
  const four = [size, size, size, size];

  it('keeps every pet left of the ping, side by side', () => {
    const xs = [0, 1, 2, 3].map((i) => standLeftOf({ x: 800, y: 400 }, i, four, 0).x);
    for (const x of xs) expect(x + size.width).toBeLessThanOrEqual(800);
    const sorted = [...xs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(size.width);
  });

  it('stands a lone pet where standBeside puts the first', () => {
    expect(standLeftOf({ x: 500, y: 400 }, 0, [size], 0)).toEqual(standBeside({ x: 500, y: 400 }, 0, 1, size));
  });

  it('puts the pets that do not fit before the display edge in a row above', () => {
    const at = (i: number) => standLeftOf({ x: 260, y: 400 }, i, four, 0);
    expect(at(0).y).toBe(at(1).y);
    expect(at(2).y).toBeLessThan(at(0).y);
    expect(at(2).x).toBe(at(0).x);
  });

  it('adds up the width of each pet, so pets of different sizes still do not overlap', () => {
    const sizes = [{ width: 100, height: 100 }, { width: 160, height: 160 }];
    const a = standLeftOf({ x: 600, y: 400 }, 0, sizes, 0);
    const b = standLeftOf({ x: 600, y: 400 }, 1, sizes, 0);
    expect(b.x + 160).toBeLessThanOrEqual(a.x);
  });
});

describe('standBeside', () => {
  const size = { width: 100, height: 100 };

  it('puts the first pet left of the ping and the second right of it', () => {
    const a = standBeside({ x: 500, y: 400 }, 0, 2, size);
    const b = standBeside({ x: 500, y: 400 }, 1, 2, size);
    expect(a.x + size.width).toBeLessThan(500);
    expect(b.x).toBeGreaterThan(500);
  });

  it('puts a single pet left of the ping', () => {
    expect(standBeside({ x: 500, y: 400 }, 0, 1, size).x).toBeLessThan(500);
  });

  it('keeps four pets from overlapping, two on each side', () => {
    const xs = [0, 1, 2, 3].map((i) => standBeside({ x: 500, y: 400 }, i, 4, size).x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(size.width);
  });
});

describe('keepInside', () => {
  it('pulls a pet that would leave the display back in', () => {
    const area = { x: 0, y: 0, width: 1000, height: 800 };
    expect(keepInside({ x: -50, y: 900 }, { width: 100, height: 100 }, area)).toEqual({ x: 0, y: 700 });
    expect(keepInside({ x: 990, y: 10 }, { width: 100, height: 100 }, area)).toEqual({ x: 900, y: 10 });
  });
});
