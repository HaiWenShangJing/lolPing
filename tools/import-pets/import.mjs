// Downloads the art for the desktop pets into <settings folder>/pets/<id>/ and writes each manifest.json.
// The art belongs to its authors and is not part of lolPing: run this once on your own computer.
//   node tools/import-pets/import.mjs [whale] [naiwa]
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RAW = 'https://raw.githubusercontent.com';
const HEIGHT = 160;

// `anims`: every animation to download, name → [path under base, frames]. `poses`: the five poses a pack must have,
// when they are another animation of the pack.
const PETS = {
  // DeepSeaPet's idle (after its first frame), happy, hide, lying, peek and sleep sprites are broken crops, so the
  // pack leaves them out: it stands still on the first idle frame and borrows the others for the poses.
  whale: {
    base: `${RAW}/silicon-sbt/DeepSeaPet/master/module_5_assets/sprites`,
    anims: {
      idle: ['idle', 1], walk: ['walk', 8], held: ['held', 8], dance: ['dance', 8], flying: ['flying', 8],
    },
    poses: { think: 'held', happy: 'dance' },
  },  naiwa: {
    base: `${RAW}/HanYang544/naiwa/agent/unify-naiwa-proportions/assets`,
    anims: Object.fromEntries([
      ...['sit', 'walk', 'victory', 'laugh', 'stretch'].map((n) => [n, [`animation_detailed/${n}`, 12]]),
      ...['think', 'noodle_dance', 'belly_drum', 'brain_loading', 'fake_faint', 'freeze', 'play_bow', 'pretzel_twist']
        .map((n) => [n, [`funny_detailed/${n}`, 12]]),
    ]),
    poses: { idle: 'sit', happy: 'victory', held: 'noodle_dance' },
  },
};
function settingsDir() {
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'lolPing');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'lolPing');
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'lolPing');
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function importPet(id) {
  const pet = PETS[id];
  const out = join(settingsDir(), 'pets', id);
  await mkdir(out, { recursive: true });
  const anims = {};
  let size = null;
  for (const [pose, [path, count]] of Object.entries(pet.anims)) {
    const names = [];
    for (let i = 0; i < count; i++) {
      const num = String(i).padStart(2, '0');
      const data = await download(`${pet.base}/${path}_${num}.png`);
      // A PNG's width and height are the two numbers after its signature and the IHDR tag.
      if (!size) size = { w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
      const name = `${pose}_${num}.png`;
      await writeFile(join(out, name), data);
      names.push(name);
    }
    anims[pose] = { frames: names, fps: 8 };
  }
  for (const [pose, from] of Object.entries(pet.poses)) anims[pose] = anims[from];
  const width = Math.round((size.w / size.h) * HEIGHT);
  await writeFile(join(out, 'manifest.json'), JSON.stringify({ id, width, height: HEIGHT, anims }, null, 2));
  console.log(`${id}: ${out}`);
}

const wanted = process.argv.slice(2).filter((a) => a in PETS);
for (const id of wanted.length > 0 ? wanted : Object.keys(PETS)) await importPet(id);
