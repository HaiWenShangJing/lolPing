import { describe, expect, it } from 'vitest';
import {
  keepInside, normalizePets, parsePetManifest, petIds, PET_POSES, standBeside, stepToward,
} from '../../../src/shared/teammate/pet';

const pack = (over: Record<string, unknown> = {}) => ({
  id: 'whale', width: 100, height: 120,
  anims: Object.fromEntries(PET_POSES.map((p) => [p, { frames: [`${p}_00.png`, `${p}_01.png`], fps: 8 }])),
  ...over,
});

describe('petIds', () => {
  it('lists the characters that are on', () => {
    const on = (whale: boolean, naiwa: boolean) => ({ whale: { on: whale, rest: 'idle' }, naiwa: { on: naiwa, rest: 'sit' } });
    expect(petIds(on(false, false))).toEqual([]);
    expect(petIds(on(true, false))).toEqual(['whale']);
    expect(petIds(on(false, true))).toEqual(['naiwa']);
    expect(petIds(on(true, true))).toEqual(['whale', 'naiwa']);
  });
});

describe('normalizePets', () => {
  it('defaults to both off, resting in the first animation', () => {
    expect(normalizePets(undefined)).toEqual({ whale: { on: false, rest: 'idle' }, naiwa: { on: false, rest: 'sit' } });
  });

  it('keeps a known animation and drops an unknown one', () => {
    const p = normalizePets({ whale: { on: true, rest: 'dance' }, naiwa: { on: true, rest: 'dance' } });
    expect(p.whale).toEqual({ on: true, rest: 'dance' });
    expect(p.naiwa).toEqual({ on: true, rest: 'sit' });
  });

  it('only turns a character on for true', () => {
    expect(normalizePets({ whale: { on: 'yes' } }).whale.on).toBe(false);
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
});

describe('keepInside', () => {
  it('pulls a pet that would leave the display back in', () => {
    const area = { x: 0, y: 0, width: 1000, height: 800 };
    expect(keepInside({ x: -50, y: 900 }, { width: 100, height: 100 }, area)).toEqual({ x: 0, y: 700 });
    expect(keepInside({ x: 990, y: 10 }, { width: 100, height: 100 }, area)).toEqual({ x: 900, y: 10 });
  });
});
