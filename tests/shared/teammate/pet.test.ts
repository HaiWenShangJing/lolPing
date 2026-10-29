import { describe, expect, it } from 'vitest';
import { L2D_ANIMS } from '../../../src/shared/teammate/live2d';
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
    const one = (rest: string) => ({ on: false, rest, model: null, persona: '' });
    const on = (...ids: string[]) => {
      const pets = {
        whale: one('idle'), naiwa: one('sit'), shenshen: one('idle'), airi: one('idle'), hiyori: one('idle'),
        haru: one('idle'), mao: one('idle'), rice: one('idle'), senko: one('idle'), mark: one('idle'),
      };
      for (const id of ids) pets[id as keyof typeof pets].on = true;
      return pets;
    };
    expect(petIds(on())).toEqual([]);
    expect(petIds(on('whale'))).toEqual(['whale']);
    expect(petIds(on('naiwa'))).toEqual(['naiwa']);
    expect(petIds(on('airi', 'whale'))).toEqual(['whale', 'airi']);
    expect(petIds(on('mark', 'haru', 'whale'))).toEqual(['whale', 'haru', 'mark']);
    expect(petIds(on(...PET_IDS))).toEqual([...PET_IDS]);
  });
});

describe('normalizePets', () => {
  it('defaults to all off, resting in the first animation', () => {
    const off = (rest: string) => ({ on: false, rest, model: null, persona: '' });
    expect(normalizePets(undefined)).toEqual({
      whale: off('idle'), naiwa: off('sit'), shenshen: off('idle'), airi: off('idle'), hiyori: off('idle'),
      haru: off('idle'), mao: off('idle'), rice: off('idle'), senko: off('idle'), mark: off('idle'),
    });
  });

  it('keeps a pet\'s own model and character, and drops what does not fit', () => {
    const p = normalizePets({
      whale: { on: true, model: 'claude-haiku-4.5', persona: '  a   grumpy\nwhale ' },
      naiwa: { model: 'not a model!', persona: 7 },
      airi: { persona: 'x'.repeat(500) },
    });
    expect(p.whale.model).toBe('claude-haiku-4.5');
    expect(p.whale.persona).toBe('a grumpy whale');
    expect(p.naiwa.model).toBeNull();
    expect(p.naiwa.persona).toBe('');
    expect(p.airi.persona).toHaveLength(300);
  });

  it('keeps a known animation and drops an unknown one', () => {
    const p = normalizePets({
      whale: { on: true, rest: 'dance' }, naiwa: { on: true, rest: 'dance' },
      shenshen: { on: true, rest: 'dance' }, airi: { on: true, rest: 'dance' }, hiyori: { on: true, rest: 'hum' },
      haru: { on: true, rest: 'wink' }, mao: { on: true, rest: 'dance' },
    });
    expect(p.whale).toMatchObject({ on: true, rest: 'dance' });
    expect(p.naiwa).toMatchObject({ on: true, rest: 'sit' });
    expect(p.shenshen).toMatchObject({ on: true, rest: 'dance' });
    expect(p.airi).toMatchObject({ on: true, rest: 'idle' });
    expect(p.hiyori).toMatchObject({ on: true, rest: 'hum' });
    expect(p.haru).toMatchObject({ on: true, rest: 'wink' });
    expect(p.mao).toMatchObject({ on: true, rest: 'idle' });
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

describe('parsePetManifest for a Live2D pack', () => {
  const live = (over: Record<string, unknown> = {}) => ({
    id: 'hiyori', width: 190, height: 320,
    live2d: { model: 'model/hiyori_pro_t11.model3.json', core: 'live2dcubismcore.min.js' },
    ...over,
  });

  it('reads a model and a core, and has every performance as an animation without frames', () => {
    const m = parsePetManifest(live());
    expect(m?.live2d).toEqual({ model: 'model/hiyori_pro_t11.model3.json', core: 'live2dcubismcore.min.js' });
    expect(Object.keys(m?.anims ?? {})).toEqual([...L2D_ANIMS]);
    for (const pose of PET_POSES) expect(m?.anims[pose]).toBeDefined();
    expect(m?.anims.think.frames).toEqual([]);
  });

  it('defaults to a tall window and keeps a given one within limits', () => {
    const m = parsePetManifest(live({ width: undefined, height: undefined }));
    expect([m?.width, m?.height]).toEqual([200, 320]);
    expect(parsePetManifest(live({ width: 9000 }))?.width).toBe(512);
  });

  it('refuses paths that could leave the pack folder, or that are not what they claim to be', () => {
    const at = (live2d: Record<string, unknown>) => parsePetManifest(live({ live2d }));
    const ok = { model: 'a.model3.json', core: 'core.js' };
    expect(at(ok)).not.toBeNull();
    expect(at({ ...ok, model: '../a.model3.json' })).toBeNull();
    expect(at({ ...ok, model: 'a/../b.model3.json' })).toBeNull();
    expect(at({ ...ok, model: '/etc/a.model3.json' })).toBeNull();
    expect(at({ ...ok, model: 'a.json' })).toBeNull();
    expect(at({ ...ok, core: 'https://x.test/core.js' })).toBeNull();
    expect(at({ ...ok, core: 'core.exe' })).toBeNull();
    expect(at({ ...ok, core: '..\\core.js' })).toBeNull();
    expect(at({ model: ok.model })).toBeNull();
  });

  it('refuses a live2d value that is not an object', () => {
    expect(parsePetManifest(live({ live2d: 'model.model3.json' }))).toBeNull();
    expect(parsePetManifest(live({ live2d: null }))).toBeNull();
  });

  it('has no motions of its own unless the pack names them, and then only valid ones for known animations', () => {
    const at = (motions: unknown) => parsePetManifest(live({ live2d: { model: 'a.model3.json', core: 'core.js', motions } }));
    expect(at(undefined)?.live2d?.motions).toBeUndefined();
    expect(at('TapBody')?.live2d?.motions).toBeUndefined();
    expect(at({})?.live2d?.motions).toEqual({});
    expect(at({
      happy: { group: 'TapBody', index: 0 }, celebrate: { group: 'Tap@Body', index: 63 }, dance: { group: 'TapBody', index: 0 },
      love: { group: '../x', index: 0 }, thanks: { group: 'TapBody', index: -1 }, wink: { group: 'TapBody', index: 0.5 },
      agree: { group: 'TapBody', index: 64 }, giggle: 'TapBody/0', shy: { group: 3, index: 0 },
    })?.live2d?.motions).toEqual({ happy: { group: 'TapBody', index: 0 }, celebrate: { group: 'Tap@Body', index: 63 } });
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
