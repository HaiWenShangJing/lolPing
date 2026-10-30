import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PetId } from '../../shared/teammate/pet';

/*
 * Keeps the pet packs in the user's folder current.
 *
 * A pack is copied from the bundle (`<resources>/pets/<id>`) to `<settings folder>/pets/<id>`, and the copy is what the
 * pets use, so the user can edit it. An update that changes a pack's art or motions has to reach that copy, but never at
 * the cost of what the user changed. So a copy carries a stamp (`STAMP`: the app version and a fingerprint of the files as
 * they were copied), and it is replaced only while it still matches its stamp. The copies that lolPing 0.6.0 to 0.9.2
 * made have no stamp: one of those is replaced only when it is, file for file, a pack one of those versions shipped
 * (`LEGACY_DIGESTS`).
 */

/** The file in a pack folder that says which version copied it and what the folder held then. */
export const STAMP = '.lolping-pack.json';

/** Files that a folder collects without anyone editing the pack: they do not count as a change. */
const NOISE = new Set([STAMP, 'thumbs.db', 'desktop.ini', '.ds_store']);

/**
 * The fingerprint (`packDigest`) of every pack folder that lolPing 0.6.0 to 0.9.2 shipped, worked out from each
 * release's files. Those versions copied a pack once and left no stamp. A folder that matches one of these was never
 * edited, so a newer pack may replace it.
 */
export const LEGACY_DIGESTS: Readonly<Record<PetId, readonly string[]>> = {
  whale: [
    '65834e7a054477da5652701d4e0bef35404b5cbc07646f9e331b6a1b0b4781e3', // 0.6.0-0.9.2
  ],
  naiwa: [
    '241729ce7cb41af8449fb5c63d5c4b96b3b923db29574c1e890c2585865c79ed', // 0.6.0-0.9.2
  ],
  shenshen: [
    '56011809b006026d8ef357516f90d1118698833df2aad56f72017a8bb0a5e0fc', // 0.7.0-0.9.2
  ],
  airi: [
    '4a8e11881d66f571257394d2213b3ca84d167e7d08a9249eddbb0f294bdb8e3e', // 0.7.0-0.9.2
  ],
  hiyori: [
    'ba30bf59e66b7585c603b1718787bf546fc4b8c0afdb86ed0e5e58b3783a8198', // 0.7.0-0.9.2
  ],
  haru: [
    '7b5e8c4801109c94809a099658153cc09213745b202de61ec5300c9e11f2f354', // 0.8.1-0.9.1
    'b85e4e9285598b96023b35c42de3c36f4d6dc130a7e89178878f7b8ef192b2aa', // 0.9.2
  ],
  mao: [
    'c4d4e2027ade99bf60ed22845a9ff009d0e6524d197c4ae6a8c339f0266ae752', // 0.8.1-0.9.1
    'a0053483c89f191345078cec69396da8cf57846a65b70f92c9a7dd8c4d998d42', // 0.9.2
  ],
  rice: [
    '2eeffe68ce5accc9d7b72dd3a38eae4612849ad3298e118840df49588cb7a69e', // 0.8.1-0.9.1
    '5fe8d7f9544dfa8bd6c791a8a24e8febd5aac397f7fa10ad5da98f4f41d7b524', // 0.9.2
  ],
  senko: [
    '1503ba275c8ece9573452b19316a9262d80899a35089574fe12f1b6184fa7227', // 0.9.1
    '803d347b8e31f857b5659c251cd64238ae47f710f6d8f38e654146f12d23cee1', // 0.9.2
  ],
  mark: [
    'f4f82e9eb77f4b99a268a03b7111c925311a6b1bbaf0c506fa1f3045d83a3ab2', // 0.8.1-0.9.2
  ],
  laffey: [
    'fc76a0ccf4ff47b1161c258c0c64a4685743ce9c7755b92ea82cf4c86ede575c', // 0.9.1
    '4ee7bc608d1eb60f4b1bb2b6cd5a3960ae7a839f0a8b23fa5d7872ffebd5ff47', // 0.9.2
  ],
  unicorn: [
    'a4804808790970ee307e413f12874b2c9b3023bfc4f09098a0c37d6da9041730', // 0.9.1
    'dd1db4151bc6db6ff7553528c560b9f0212a869d7c01747fa41698666afa5ee5', // 0.9.2
  ],
  javelin: [
    '011afea6ce8f32e280273c5b6f94242f3865d5ce610dd2ee64b4f54914808887', // 0.9.1
    'b0cec07b02da844b7449d6ae7f36f59ef691a2a9e9ff0fe0150305f8e9837caa', // 0.9.2
  ],
  shoukaku: [
    'c4c98eea2d7d39db1fdb66d4112b66c37ab0d839d67c4a20d8b34130b767538a', // 0.9.1
    'e319b4b3419968748556c1715dee572353a9bc7d0c5d5bc9b488d84fc6e97f48', // 0.9.2
  ],
  doubao: [
    '942b3e13e4b7559c7f42e836e267994441a9a3a411d5cda39651405b96d51ffa', // 0.9.1
    '95645a4659dc62b50051440f2566c5ce520cb2ebae52ce7f2524c1b8272ec33b', // 0.9.2
  ],
};

/**
 * What became of one pack: copied new, replaced by a newer one, already the bundled one (or was copied by this
 * version), left alone because the user changed it, or not touched because something went wrong.
 */
export type PackResult = 'installed' | 'refreshed' | 'current' | 'kept' | 'failed';

export interface SyncOptions {
  /** The fingerprints of the packs that shipped without a stamp, by pack id. */
  legacy?: Readonly<Record<string, readonly string[]>>;
  /** Called for a pack that could not be synced; the others are still done. */
  warn?: (id: string, err: unknown) => void;
}

interface Stamp {
  app: string;
  files: string;
  /** The user changed the pack: no update touches it again (delete its folder to get the original back). */
  custom: boolean;
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** A fingerprint of a pack folder: the path and the content hash of every file in it, in a fixed order. */
export function packDigest(dir: string): string {
  const lines: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(rel ? join(dir, rel) : dir, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && !NOISE.has(entry.name.toLowerCase())) lines.push(`${path}\t${sha256(readFileSync(join(dir, path)))}`);
    }
  };
  walk('');
  return sha256(lines.sort().join('\n'));
}

function readStamp(dir: string): Stamp | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, STAMP), 'utf8')) as Partial<Stamp> | null;
    if (typeof raw?.app !== 'string' || typeof raw.files !== 'string') return null;
    return { app: raw.app, files: raw.files, custom: raw.custom === true };
  } catch {
    return null;
  }
}

const writeStamp = (dir: string, stamp: Stamp): void => writeFileSync(join(dir, STAMP), `${JSON.stringify(stamp)}\n`);

/**
 * Copies a pack over, the manifest last: a copy that stops half way has none, so the next start does it again. With
 * `clean` the old files go first (only for a copy that is known to be the bundle's own); without it they stay.
 */
function install(from: string, to: string, version: string, clean: boolean): void {
  const manifest = join(from, 'manifest.json');
  rmSync(join(to, 'manifest.json'), { force: true });
  if (clean) rmSync(to, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  cpSync(from, to, { recursive: true, filter: (src) => resolve(src) !== resolve(manifest) });
  copyFileSync(manifest, join(to, 'manifest.json'));
  writeStamp(to, { app: version, files: packDigest(to), custom: false });
}

function syncPack(from: string, to: string, version: string, legacy: readonly string[]): PackResult {
  if (!existsSync(join(to, 'manifest.json'))) {
    install(from, to, version, false);
    return 'installed';
  }
  const stamp = readStamp(to);
  if (stamp?.custom) return 'kept';
  if (stamp?.app === version) return 'current'; // the common start: nothing to read but the stamp
  const have = packDigest(to);
  const bundled = packDigest(from);
  if (have === bundled) {
    writeStamp(to, { app: version, files: have, custom: false });
    return 'current';
  }
  const untouched = stamp ? have === stamp.files : legacy.includes(have);
  if (!untouched) {
    writeStamp(to, { app: version, files: have, custom: true });
    return 'kept';
  }
  install(from, to, version, true);
  return 'refreshed';
}

/**
 * Brings the packs in `dest` up to date with the ones in `bundled`: a pack that is missing is copied, and one that the
 * user has not touched is replaced when the bundle's has changed. One that has been changed is left as it is.
 */
export function syncPets(bundled: string, dest: string, version: string, opts: SyncOptions = {}): Record<string, PackResult> {
  const legacy: Readonly<Record<string, readonly string[]>> = opts.legacy ?? LEGACY_DIGESTS;
  const results: Record<string, PackResult> = {};
  let ids: string[];
  try {
    ids = readdirSync(bundled, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(bundled, entry.name, 'manifest.json')))
      .map((entry) => entry.name);
  } catch {
    return results; // no bundled pets; the user folder may still have them
  }
  for (const id of ids) {
    try {
      results[id] = syncPack(join(bundled, id), join(dest, id), version, legacy[id] ?? []);
    } catch (err) {
      results[id] = 'failed';
      opts.warn?.(id, err);
    }
  }
  return results;
}
