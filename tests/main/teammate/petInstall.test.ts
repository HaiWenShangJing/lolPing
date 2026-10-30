import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_DIGESTS, STAMP, packDigest, syncPets } from '../../../src/main/teammate/petInstall';
import { PET_IDS } from '../../../src/shared/teammate/pet';

const V1 = { 'manifest.json': '{"id":"x","v":1}', 'idle1.png': 'a1', 'idle2.png': 'a2', 'sub/note.txt': 'n1' };
const V2 = { 'manifest.json': '{"id":"x","v":2}', 'idle1.png': 'b1', 'sub/note.txt': 'n1' };

let root: string;
let bundled: string;
let dest: string;

/** Writes a pack folder, replacing whatever the folder held. */
const put = (base: string, id: string, files: Record<string, string>): string => {
  const dir = join(base, id);
  rmSync(dir, { recursive: true, force: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
};
const read = (id: string, name: string): string => readFileSync(join(dest, id, name), 'utf8');
const stamp = (id: string): { app: string; files: string; custom: boolean } =>
  JSON.parse(readFileSync(join(dest, id, STAMP), 'utf8')) as { app: string; files: string; custom: boolean };
const sync = (version: string, legacy: Record<string, string[]> = {}) => syncPets(bundled, dest, version, { legacy });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lolping-install-'));
  bundled = join(root, 'bundled');
  dest = join(root, 'user');
  mkdirSync(bundled);
  mkdirSync(dest);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('packDigest', () => {
  it('is the same for the same files, whatever order they were written in', () => {
    const a = put(root, 'a', V1);
    const b = put(root, 'b', Object.fromEntries(Object.entries(V1).reverse()));
    expect(packDigest(a)).toBe(packDigest(b));
    expect(packDigest(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when a file changes, is renamed, is added or is removed', () => {
    const base = packDigest(put(root, 'a', V1));
    const { 'idle2.png': second, ...rest } = V1;
    expect(packDigest(put(root, 'b', { ...V1, 'idle1.png': 'changed' }))).not.toBe(base);
    expect(packDigest(put(root, 'c', { ...V1, 'sub/note.txt': 'n2' }))).not.toBe(base);
    expect(packDigest(put(root, 'd', { ...rest, 'idle3.png': second }))).not.toBe(base);
    expect(packDigest(put(root, 'e', { ...V1, 'extra.png': 'x' }))).not.toBe(base);
    expect(packDigest(put(root, 'f', rest))).not.toBe(base);
  });

  it('does not count the stamp or the files a folder collects by itself', () => {
    const dir = put(root, 'a', V1);
    const base = packDigest(dir);
    writeFileSync(join(dir, STAMP), '{}');
    writeFileSync(join(dir, 'Thumbs.db'), 'x');
    writeFileSync(join(dir, 'DESKTOP.INI'), 'x');
    writeFileSync(join(dir, '.DS_Store'), 'x');
    expect(packDigest(dir)).toBe(base);
  });
});

describe('syncPets', () => {
  it('copies a pack that is not there yet, with its folders, and stamps it', () => {
    put(bundled, 'x', V1);
    expect(sync('1.0.0')).toEqual({ x: 'installed' });
    for (const [name, text] of Object.entries(V1)) expect(read('x', name)).toBe(text);
    expect(stamp('x')).toEqual({ app: '1.0.0', files: packDigest(join(bundled, 'x')), custom: false });
  });

  it('copies into a settings folder that has no pets folder yet', () => {
    put(bundled, 'x', V1);
    const fresh = join(root, 'fresh', 'pets');
    expect(syncPets(bundled, fresh, '1.0.0', { legacy: {} })).toEqual({ x: 'installed' });
    expect(readFileSync(join(fresh, 'x', 'idle1.png'), 'utf8')).toBe('a1');
  });

  it('does not look at a pack that this version already stamped', () => {
    put(bundled, 'x', V1);
    sync('1.0.0');
    put(bundled, 'x', V2);
    expect(sync('1.0.0')).toEqual({ x: 'current' });
    expect(read('x', 'idle1.png')).toBe('a1');
  });

  it('only moves the stamp up when an update brings the same pack', () => {
    put(bundled, 'x', V1);
    sync('1.0.0');
    expect(sync('1.1.0')).toEqual({ x: 'current' });
    expect(stamp('x')).toMatchObject({ app: '1.1.0', custom: false });
    expect(read('x', 'idle2.png')).toBe('a2');
  });

  it('replaces a copy nobody touched when an update has a new pack, and drops the files the new one lacks', () => {
    put(bundled, 'x', V1);
    sync('1.0.0');
    put(bundled, 'x', V2);
    expect(sync('1.1.0')).toEqual({ x: 'refreshed' });
    expect(packDigest(join(dest, 'x'))).toBe(packDigest(join(bundled, 'x')));
    expect(read('x', 'manifest.json')).toBe(V2['manifest.json']);
    expect(existsSync(join(dest, 'x', 'idle2.png'))).toBe(false);
    expect(stamp('x')).toEqual({ app: '1.1.0', files: packDigest(join(bundled, 'x')), custom: false });
  });

  it('still counts a copy as untouched when Windows has dropped a Thumbs.db in it', () => {
    put(bundled, 'x', V1);
    sync('1.0.0');
    writeFileSync(join(dest, 'x', 'Thumbs.db'), 'x');
    put(bundled, 'x', V2);
    expect(sync('1.1.0')).toEqual({ x: 'refreshed' });
  });

  it.each([
    ['a file is added', (dir: string) => writeFileSync(join(dir, 'mine.png'), 'x')],
    ['a file is removed', (dir: string) => rmSync(join(dir, 'idle2.png'))],
    ['a picture is replaced', (dir: string) => writeFileSync(join(dir, 'idle1.png'), 'mine')],
    ['a picture is replaced by one of the same size', (dir: string) => writeFileSync(join(dir, 'idle1.png'), 'zz')],
    ['the manifest is edited', (dir: string) => writeFileSync(join(dir, 'manifest.json'), '{"id":"mine"}')],
    ['a file in a folder is edited', (dir: string) => writeFileSync(join(dir, 'sub', 'note.txt'), 'n2')],
  ])('leaves a copy alone when %s, and every later update too', (_what, edit) => {
    put(bundled, 'x', V1);
    sync('1.0.0');
    edit(join(dest, 'x'));
    const edited = packDigest(join(dest, 'x'));
    put(bundled, 'x', V2);
    expect(sync('1.1.0')).toEqual({ x: 'kept' });
    expect(packDigest(join(dest, 'x'))).toBe(edited);
    expect(stamp('x')).toMatchObject({ app: '1.1.0', custom: true });
    put(bundled, 'x', { ...V2, 'idle1.png': 'c1' });
    expect(sync('2.0.0')).toEqual({ x: 'kept' });
    expect(packDigest(join(dest, 'x'))).toBe(edited);
  });

  it('takes a copy that the user made into exactly the new pack for stock', () => {
    put(bundled, 'x', V1);
    sync('1.0.0');
    for (const [name, text] of Object.entries(V2)) writeFileSync(join(dest, 'x', name), text);
    rmSync(join(dest, 'x', 'idle2.png'));
    put(bundled, 'x', V2);
    expect(sync('1.1.0')).toEqual({ x: 'current' });
    expect(stamp('x')).toMatchObject({ app: '1.1.0', custom: false });
  });

  describe('a copy from before stamps', () => {
    const shipped = (): string => packDigest(put(root, 'old', V1));

    it('is replaced when it is exactly a pack that an older version shipped', () => {
      const old = shipped();
      put(dest, 'x', V1);
      put(bundled, 'x', V2);
      expect(sync('1.0.0', { x: [old] })).toEqual({ x: 'refreshed' });
      expect(packDigest(join(dest, 'x'))).toBe(packDigest(join(bundled, 'x')));
      expect(stamp('x')).toMatchObject({ app: '1.0.0', custom: false });
    });

    it('is kept, and marked, when it matches nothing that was shipped', () => {
      put(dest, 'x', { ...V1, 'idle1.png': 'mine' });
      put(bundled, 'x', V2);
      expect(sync('1.0.0', { x: [shipped()] })).toEqual({ x: 'kept' });
      expect(read('x', 'idle1.png')).toBe('mine');
      expect(stamp('x')).toMatchObject({ app: '1.0.0', custom: true });
    });

    it('is kept when its pack has no list of what was shipped at all', () => {
      put(dest, 'x', V1);
      put(bundled, 'x', V2);
      expect(sync('1.0.0')).toEqual({ x: 'kept' });
      expect(read('x', 'idle1.png')).toBe('a1');
    });

    it('is only stamped when it already is the bundled pack', () => {
      put(dest, 'x', V2);
      put(bundled, 'x', V2);
      expect(sync('1.0.0')).toEqual({ x: 'current' });
      expect(stamp('x')).toEqual({ app: '1.0.0', files: packDigest(join(bundled, 'x')), custom: false });
    });

    it.each(['{ not json', '', 'null', '[]', JSON.stringify({ app: 5, files: null }), JSON.stringify({ app: '1.0.0' })])(
      'is treated the same when its stamp is unreadable (%j)',
      (junk) => {
        const old = shipped();
        put(dest, 'x', { ...V1, [STAMP]: junk });
        put(bundled, 'x', V2);
        expect(sync('1.0.0', { x: [old] })).toEqual({ x: 'refreshed' });
        expect(stamp('x')).toMatchObject({ app: '1.0.0', custom: false });
      },
    );
  });

  it('finishes a copy that stopped half way, keeping what else the folder holds', () => {
    put(bundled, 'x', V1);
    put(dest, 'x', { 'idle1.png': 'a1', 'keep.txt': 'mine' });
    expect(sync('1.0.0')).toEqual({ x: 'installed' });
    for (const [name, text] of Object.entries(V1)) expect(read('x', name)).toBe(text);
    expect(read('x', 'keep.txt')).toBe('mine');
    expect(stamp('x').files).toBe(packDigest(join(dest, 'x')));
  });

  it('leaves no manifest when a copy fails half way, so the next start does it again', () => {
    put(bundled, 'x', V1);
    put(dest, 'x', { sub: 'a file where the pack has a folder' });
    const warn = vi.fn();
    expect(syncPets(bundled, dest, '1.0.0', { legacy: {}, warn })).toEqual({ x: 'failed' });
    expect(warn).toHaveBeenCalledWith('x', expect.any(Error));
    expect(existsSync(join(dest, 'x', 'manifest.json'))).toBe(false);
    rmSync(join(dest, 'x', 'sub'));
    expect(sync('1.0.0')).toEqual({ x: 'installed' });
    expect(read('x', 'sub/note.txt')).toBe('n1');
  });

  it('copies a pack again when an update was cut short after the old manifest was removed', () => {
    put(bundled, 'x', V1);
    sync('1.0.0');
    put(bundled, 'x', V2);
    rmSync(join(dest, 'x', 'manifest.json'));
    rmSync(join(dest, 'x', 'idle1.png'));
    expect(sync('1.1.0')).toEqual({ x: 'installed' });
    expect(read('x', 'manifest.json')).toBe(V2['manifest.json']);
    expect(read('x', 'idle1.png')).toBe('b1');
    expect(read('x', 'sub/note.txt')).toBe('n1');
    expect(stamp('x')).toMatchObject({ app: '1.1.0', files: packDigest(join(dest, 'x')), custom: false });
  });

  it('does the other packs when one cannot be done, and says which', () => {
    put(bundled, 'bad', V1);
    put(bundled, 'x', V1);
    const warn = vi.fn();
    const legacy = Object.defineProperty({} as Record<string, readonly string[]>, 'bad', {
      enumerable: true,
      get: () => {
        throw new Error('boom');
      },
    });
    expect(syncPets(bundled, dest, '1.0.0', { legacy, warn })).toEqual({ bad: 'failed', x: 'installed' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('bad', expect.objectContaining({ message: 'boom' }));
  });

  it('skips what is in the bundle but is not a pack', () => {
    put(bundled, 'x', V1);
    mkdirSync(join(bundled, 'empty'));
    put(bundled, 'nomanifest', { 'idle1.png': 'a' });
    writeFileSync(join(bundled, 'README.txt'), 'x');
    expect(sync('1.0.0')).toEqual({ x: 'installed' });
    expect(existsSync(join(dest, 'nomanifest'))).toBe(false);
  });

  it("leaves the user's own packs alone", () => {
    put(bundled, 'x', V1);
    put(dest, 'mine', { 'manifest.json': '{}', 'a.png': 'a' });
    expect(sync('1.0.0')).toEqual({ x: 'installed' });
    expect(readFileSync(join(dest, 'mine', 'a.png'), 'utf8')).toBe('a');
    expect(existsSync(join(dest, 'mine', STAMP))).toBe(false);
  });

  it('does nothing when there is no bundle', () => {
    put(dest, 'x', V1);
    expect(syncPets(join(root, 'nowhere'), dest, '1.0.0', { legacy: {} })).toEqual({});
    expect(read('x', 'idle1.png')).toBe('a1');
  });
});

describe('LEGACY_DIGESTS', () => {
  it('lists what was shipped for every pet, as distinct SHA-256 digests', () => {
    expect(Object.keys(LEGACY_DIGESTS).sort()).toEqual([...PET_IDS].sort());
    for (const id of PET_IDS) {
      const digests = LEGACY_DIGESTS[id];
      expect(digests.length).toBeGreaterThan(0);
      for (const d of digests) expect(d).toMatch(/^[0-9a-f]{64}$/);
      expect(new Set(digests).size).toBe(digests.length);
    }
  });
});
