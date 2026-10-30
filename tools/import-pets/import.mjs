// Downloads the art for the desktop pets into <settings folder>/pets/<id>/ and writes each manifest.json.
// The art belongs to its authors and is not lolPing's own: run this once on your own computer, or to refresh assets/pets.
//   node tools/import-pets/import.mjs [--out <pets folder>] [whale] [naiwa] [shenshen] [airi] [hiyori] [haru] [mao] [rice] [senko]
//     [mark] [laffey] [unicorn] [javelin] [shoukaku] [doubao] [core]
// `shenshen` turns transparent WebM clips into frames, so it needs ffmpeg (with libvpx-vp9 and libwebp) on the PATH or in
// the FFMPEG variable; `airi` and `doubao` draw their frames with @napi-rs/canvas (`npm install --no-save @napi-rs/canvas`
// if it is missing). `doubao` downloads nothing: it is an original mascot drawn by tools/import-pets/doubao.mjs in the
// colours of Doubao's logo.
// `hiyori`, `haru`, `mao`, `rice`, `mark`, `senko`, `laffey`, `unicorn`, `javelin` and `shoukaku` are Live2D
// models, so each brings the model and Live2D's Cubism Core (each under its own terms). `--out assets/pets` puts them
// where a build picks them up. Git ignores the sample models and the Core; `senko`, `laffey`, `unicorn`, `javelin`,
// `shoukaku` (fan and game models, in lolPing with their authors' permission) and `doubao` are committed, without the Core.
// `core` downloads only the Core, into every Live2D pack already in the folder: what a checkout needs to draw them.
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { ANIMS as DOUBAO_ANIMS, drawAnim } from './doubao.mjs';

const RAW = 'https://raw.githubusercontent.com';
const HEIGHT = 160;
const run = promisify(execFile);

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

async function importPngPet(id, root) {
  const pet = PETS[id];
  const out = join(root, id);
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

// 深深 from MerZlin/dsh-pet-indesktop: 640×360 transparent VP9 WebM clips at 24 fps, about ten seconds each. Every clip is
// cropped to the area she and her props move in and sampled at `fps`; `clips` maps an animation to its file under `base`.
const SHENSHEN = {
  base: `${RAW}/MerZlin/dsh-pet-indesktop/main/assets/characters/shenshen/videos`,
  crop: { x: 170, y: 15, w: 300, h: 325 },
  height: 170,
  fps: 10,
  clips: {
    idle: 'idle/待机呼吸休闲', walk: 'move/漂浮踏步', held: 'drag/被鼠标拖拽悬空反馈', think: 'random/工作状态-思考冒泡',
    happy: 'click/点击回应-开心跃动', wave: 'click/点击回应-元气挥手', giggle: 'click/点击回应-挠痒咯咯笑',
    shy: 'click/点击回应-害羞惊讶', sulk: 'click/点击回应-傲娇生气', dance: 'random/可爱宅舞', sway: 'random/轻快摇摆舞',
    hum: 'random/悠闲哼歌', nap: 'random/原地小憩沉眠', yawn: 'random/哈欠连天', stretch: 'random/超大伸懒腰',
    bubbles: 'random/鲸鱼吐泡泡特效', look: 'turn/东张西望', tail: 'random/用鲸鱼尾巴拍打地面', cat: 'random/撸猫',
  },
};

async function importShenshen(root) {
  const { base, crop, height, fps, clips } = SHENSHEN;
  const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
  const width = Math.round((crop.w / crop.h) * height);
  const out = join(root, 'shenshen');
  await mkdir(out, { recursive: true });
  // The decoder leaves the clear background at alpha 1, which shows as a faint box on a light desktop: zero it.
  const filter = `fps=${fps},crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${width}:${height}:flags=lanczos,format=yuva420p,lutyuv=a='if(lt(val,12),0,val)'`;
  const anims = {};
  const queue = Object.entries(clips);
  // ffmpeg is single-threaded for this work: a few clips at a time.
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [name, clip] = next;
      const webm = join(out, `${name}.webm`);
      const url = `${base}/${clip.split('/').map(encodeURIComponent).join('/')}.webm`;
      await writeFile(webm, await download(url));
      // The native VP9 decoder drops the alpha plane; libvpx-vp9 keeps it.
      await run(ffmpeg, [
        '-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', webm, '-vf', filter,
        '-c:v', 'libwebp', '-quality', '80', '-compression_level', '3', join(out, `${name}_%03d.webp`),
      ]);
      await rm(webm);
      console.log(`shenshen: ${name}`);
    }
  }));
  const files = await readdir(out);
  for (const name of Object.keys(clips)) {
    const frames = files.filter((f) => f.startsWith(`${name}_`) && f.endsWith('.webp')).sort();
    if (frames.length === 0) throw new Error(`shenshen: no frames for ${name}`);
    anims[name] = { frames, fps };
  }
  await writeFile(join(out, 'manifest.json'), JSON.stringify({ id: 'shenshen', width, height, anims }, null, 2));
  console.log(`shenshen: ${out}`);
}

// The AIRI chat stickers from moeru-ai/airi (MIT): twelve chibi busts with transparent backgrounds. They are still, so each
// animation is one sticker moved a little: `anims` maps an animation to its sticker and how it moves.
const AIRI = {
  base: `${RAW}/moeru-ai/airi/main/packages/stage-ui/src/assets/stickers`,
  size: 168,
  draw: 140,
  fps: 12,
  anims: {
    idle: ['happy', 'bob'], run: ['happy', 'run'], celebrate: ['celebrate', 'hop'], love: ['affectionate', 'float'],
    thanks: ['thanks', 'float'], agree: ['agree', 'nod'], confused: ['confused', 'sway'], surprised: ['surprised', 'hop'],
    awkward: ['awkward', 'sway'], disagree: ['disagree', 'shake'], angry: ['angry', 'shake'], sad: ['sad', 'sway'],
    tired: ['tired', 'sway'], held: ['surprised', 'shake'],
  },
  poses: { walk: 'run', think: 'confused', happy: 'celebrate' },
};

const TAU = Math.PI * 2;
const hop = (p) => Math.max(0, Math.sin(TAU * p));
// How a sticker is moved at `p` (0 to 1 around the loop): offsets and tilt in pixels and radians, scales about its feet.
const MOTIONS = {
  bob: { frames: 24, at: (p) => ({ sy: 1 + 0.02 * Math.sin(TAU * p), sx: 1 - 0.01 * Math.sin(TAU * p) }) },
  float: { frames: 24, at: (p) => ({ dy: -5 * (0.5 - 0.5 * Math.cos(TAU * p)), rot: 0.02 * Math.sin(TAU * p) }) },
  nod: { frames: 24, at: (p) => ({ dy: 5 * hop(2 * p), sy: 1 - 0.03 * hop(2 * p) }) },
  sway: { frames: 24, at: (p) => ({ rot: 0.05 * Math.sin(TAU * p), sy: 1 + 0.015 * Math.sin(TAU * p) }) },
  hop: { frames: 18, at: (p) => ({ dy: -14 * hop(p), sy: 0.96 + 0.1 * hop(p), sx: 1.02 - 0.05 * hop(p) }) },
  shake: { frames: 12, at: (p) => ({ dx: 4 * Math.sin(TAU * 3 * p), rot: 0.03 * Math.sin(TAU * 3 * p) }) },
  run: {
    frames: 12,
    at: (p) => ({ dy: -10 * Math.abs(Math.sin(TAU * p)), rot: 0.07 * Math.sin(TAU * p), sy: 0.97 + 0.06 * Math.abs(Math.sin(TAU * p)) }),
  },
};

async function importAiri(root) {
  let canvasApi;
  try {
    canvasApi = await import('@napi-rs/canvas');
  } catch {
    throw new Error('airi needs @napi-rs/canvas: run `npm install --no-save @napi-rs/canvas` first');
  }
  const { createCanvas, loadImage } = canvasApi;
  const { base, size, draw, fps, anims: defs, poses } = AIRI;
  const out = join(root, 'airi');
  await mkdir(out, { recursive: true });
  const stickers = new Map();
  const anims = {};
  for (const [name, [sticker, motion]] of Object.entries(defs)) {
    if (!stickers.has(sticker)) stickers.set(sticker, await loadImage(await download(`${base}/airi-${sticker}.png`)));
    const { frames: count, at } = MOTIONS[motion];
    const frames = [];
    for (let i = 0; i < count; i++) {
      const { dx = 0, dy = 0, rot = 0, sx = 1, sy = 1 } = at(i / count);
      const canvas = createCanvas(size, size);
      const g = canvas.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.translate(size / 2 + dx, size - 4 + dy);
      g.rotate(rot);
      g.scale(sx, sy);
      g.drawImage(stickers.get(sticker), -draw / 2, -draw, draw, draw);
      const file = `${name}_${String(i).padStart(2, '0')}.webp`;
      await writeFile(join(out, file), canvas.toBuffer('image/webp', 92));
      frames.push(file);
    }
    anims[name] = { frames, fps };
  }
  for (const [pose, from] of Object.entries(poses)) anims[pose] = anims[from];
  await writeFile(join(out, 'manifest.json'), JSON.stringify({ id: 'airi', width: size, height: size, anims }, null, 2));
  console.log(`airi: ${out}`);
}

// Doubao: nothing is downloaded. ./doubao.mjs draws an original bean-bun mascot, so no third party's art is in the pack; it
// does wear the colours of ByteDance's Doubao, which its NOTICE says.
const DOUBAO_NOTICE = `# Doubao (豆包)

Generated by tools/import-pets/import.mjs and committed to lolPing's repository with the rest of assets/pets.

- The frames are drawn by tools/import-pets/doubao.mjs: an original bean-bun mascot, not ByteDance's artwork.
- Only its palette (the purple, blue and teal of Doubao's logo) is borrowed. "Doubao" and its logo belong to ByteDance;
  this is an unofficial fan pet.

\`node tools/import-pets/import.mjs doubao\` regenerates these frames.
`;

async function importDoubao(root) {
  let canvasApi;
  try {
    canvasApi = await import('@napi-rs/canvas');
  } catch {
    throw new Error('doubao needs @napi-rs/canvas: run `npm install --no-save @napi-rs/canvas` first');
  }
  const out = join(root, 'doubao');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const anims = {};
  for (const [name, { fps }] of Object.entries(DOUBAO_ANIMS)) {
    const write = (file, canvas) => writeFile(join(out, file), canvas.toBuffer('image/png'));
    anims[name] = { frames: await drawAnim(canvasApi.createCanvas, name, write), fps };
  }
  await writeFile(join(out, 'manifest.json'), JSON.stringify({ id: 'doubao', width: HEIGHT, height: HEIGHT, anims }, null, 2));
  await writeFile(join(out, 'NOTICE.md'), DOUBAO_NOTICE);
  console.log(`doubao: ${out}`);
}

// Hiyori, the Live2D Inc. sample model that moeru-ai/airi's web app shows (the zip is the one that app loads), and the
// Cubism Core that draws any Live2D model. They are only downloaded here: the repository never carries them.
const LIVE2D_CORE = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
const LIVE2D_CREDIT = `This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc. This content itself is created at the author's sole discretion.`;

const live2dNotice = (title, what) => `# ${title} (Live2D)

Not part of lolPing's source: downloaded by tools/import-pets/import.mjs, which is why this folder is ignored by git.

- model/ is ${what} by Live2D Inc., a Live2D Original Character under the Free Material License Agreement
  (https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) and the Terms of Use for Live2D Cubism
  Sample Data (https://www.live2d.com/eula/live2d-sample-model-terms_en.html). Free for individuals and small-scale
  enterprises (under 10 million yen in annual sales); larger companies may use it internally only. Its voice clips are
  left out. Do not take the model files out to share them on their own.
- live2dcubismcore.min.js is the Live2D Cubism Core, under the Live2D Proprietary Software License
  (https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html), which lets an application carry it.

${LIVE2D_CREDIT}
`;

const HIYORI = {
  model: 'https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip',
  folder: 'hiyori_pro_zh/runtime/',
  entry: 'hiyori_pro_t11.model3.json',
  width: 190,
  height: 320,
};

async function importHiyori(root) {
  let unzipSync;
  try {
    ({ unzipSync } = await import('fflate'));
  } catch {
    throw new Error('hiyori needs fflate: run `npm install` first');
  }
  const out = join(root, 'hiyori');
  const files = unzipSync(new Uint8Array(await download(HIYORI.model)));
  let entry = false;
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith(HIYORI.folder) || name.endsWith('/')) continue;
    const parts = name.slice(HIYORI.folder.length).split('/');
    if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new Error(`hiyori: unsafe path ${name}`);
    const file = join(out, 'model', ...parts);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
    if (parts.join('/') === HIYORI.entry) entry = true;
  }
  if (!entry) throw new Error(`hiyori: ${HIYORI.entry} is not in the download`);
  await writeFile(join(out, 'live2dcubismcore.min.js'), await download(LIVE2D_CORE));
  await writeFile(join(out, 'NOTICE.md'), live2dNotice('Hiyori', 'the "Hiyori Momose" sample model'));
  const live2d = { model: `model/${HIYORI.entry}`, core: 'live2dcubismcore.min.js' };
  await writeFile(join(out, 'manifest.json'), JSON.stringify({ id: 'hiyori', width: HIYORI.width, height: HIYORI.height, live2d }, null, 2));
  console.log(`hiyori: ${out}`);
}

// Live2D Inc.'s other free sample characters, from Live2D/CubismWebSamples (pinned to a commit): vector models with 2048 px
// textures. Natori is left out: he is a collaboration character, which may not be altered or distributed. Each model3.json
// lists every file the model needs, so that is all that is downloaded. `width` and `height` are the window the pet is drawn
// in; `motions` says which of the model's own motions play for an animation (without one an animation is only face and
// gesture, and the model's idle loop runs underneath).
const SAMPLES = `${RAW}/Live2D/CubismWebSamples/b1de66b0b1f1cb881d95fb6158622aeb6a2827bd/Samples/Resources`;

// The fan models below are not Live2D samples but characters from games and shows, taken from the Eikanya/Live2d-model
// collection, pinned to a commit. The collection has no license; lolPing's maintainer holds their authors' written
// permission to include them, so unlike the samples they are committed (without the Cubism Core) and part of the installer.
const FAN_MODELS = `${RAW}/Eikanya/Live2d-model/965d80ee1573652ee4ff226bfc704457bbae85e7`;
const AZUR_LANE = `${FAN_MODELS}/${encodeURIComponent('碧蓝航线 Azue Lane')}/${encodeURIComponent('Azue Lane(JP)')}`;
const fanNotice = (title, source) => `# ${title} (Live2D)

Downloaded by tools/import-pets/import.mjs from a pinned commit, and committed to lolPing's repository with the rest of
assets/pets.

- model/ is a fan-made or game-extracted Live2D model of ${source}, taken from the
  Eikanya/Live2d-model collection (https://github.com/Eikanya/Live2d-model), which has no license of its own. It is in
  lolPing, in the repository and in the installer, with the written permission of its authors, which lolPing's
  maintainer holds. That permission is lolPing's: it is not a license for anyone else. The art stays with its authors,
  so ask them before you use it anywhere else.
- live2dcubismcore.min.js is the Live2D Cubism Core, under the Live2D Proprietary Software License
  (https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html), which lets an application carry it.
  It is not committed: the installer carries it, and \`node tools/import-pets/import.mjs core --out assets/pets\`
  downloads it next to the model in a checkout.
`;
const azurLane = (folder, title, who, extra = {}) => ({
  base: `${AZUR_LANE}/${folder}`, entry: `${folder}.model3.json`, notice: fanNotice(title, `${who} from "Azur Lane"`),
  width: 240, height: 320, motions: {}, ...extra,
});

const L2D_SAMPLES = {
  haru: { dir: 'Haru', title: 'Haru', width: 180, height: 320, motions: {} },
  mao: { dir: 'Mao', title: 'Mao', width: 230, height: 320, motions: {} },
  rice: { dir: 'Rice', title: 'Rice', width: 300, height: 220, motions: {} },
  senko: {
    base: `${FAN_MODELS}/Live2D/Senko_Normals`, entry: 'senko.model3.json',
    notice: fanNotice('Senko', 'Senko from "The Helpful Fox Senko-san"'), width: 240, height: 320, motions: {},
  },
  mark: { dir: 'Mark', title: 'Mark', width: 220, height: 270, motions: {} },
  laffey: azurLane('lafei_4', 'Laffey', 'Laffey'),
  unicorn: azurLane('dujiaoshou_4', 'Unicorn', 'Unicorn'),
  javelin: azurLane('biaoqiang_3', 'Javelin', 'Javelin'),
  // Its model3.json names a physics file the collection does not have (the file is xianghe_2.physics3.json).
  shoukaku: azurLane('xianghe_2', 'Shoukaku', 'Shoukaku', { physics: 'xianghe_2.physics3.json' }),
};

async function importSample(id, root) {
  const sample = L2D_SAMPLES[id];
  const base = sample.base ?? `${SAMPLES}/${sample.dir}`;
  const entry = sample.entry ?? `${sample.dir}.model3.json`;
  const model = JSON.parse((await download(`${base}/${entry}`)).toString('utf8'));
  const refs = model.FileReferences;
  // The voice clips some motions carry are Live2D's recordings, which are not licensed for use: leave them out.
  for (const list of Object.values(refs.Motions ?? {})) for (const m of list) delete m.Sound;
  if (sample.physics) refs.Physics = sample.physics;
  const wanted = [
    refs.Moc, ...refs.Textures, refs.Physics, refs.Pose, refs.DisplayInfo, refs.UserData,
    ...(refs.Expressions ?? []).map((e) => e.File),
    ...Object.values(refs.Motions ?? {}).flat().map((m) => m.File),
  ].filter(Boolean);
  const out = join(root, id);
  const put = async (rel, data) => {
    const parts = rel.split('/');
    if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new Error(`${id}: unsafe path ${rel}`);
    const file = join(out, 'model', ...parts);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  };
  await put(entry, JSON.stringify(model, null, 2));
  for (const rel of new Set(wanted)) await put(rel, await download(`${base}/${rel.split('/').map(encodeURIComponent).join('/')}`));
  await writeFile(join(out, 'live2dcubismcore.min.js'), await download(LIVE2D_CORE));
  await writeFile(join(out, 'NOTICE.md'), sample.notice ?? live2dNotice(sample.title, `the "${sample.title}" sample model`));
  const live2d = { model: `model/${entry}`, core: 'live2dcubismcore.min.js', motions: sample.motions };
  await writeFile(join(out, 'manifest.json'), JSON.stringify({ id, width: sample.width, height: sample.height, live2d }, null, 2));
  console.log(`${id}: ${out}`);
}

// The Cubism Core is not committed (.gitignore): a checkout has the models and gets the Core from here, a copy beside each
// Live2D model already in the folder.
async function importCore(root) {
  const file = 'live2dcubismcore.min.js';
  const packs = [];
  for (const id of await readdir(root).catch(() => [])) {
    try {
      if (JSON.parse(await readFile(join(root, id, 'manifest.json'), 'utf8')).live2d?.core === file) packs.push(id);
    } catch { /* not a pet folder */ }
  }
  if (packs.length === 0) return console.log(`core: no Live2D pack in ${root}`);
  const core = await download(LIVE2D_CORE);
  for (const id of packs) {
    await writeFile(join(root, id, file), core);
    console.log(`${id}: core`);
  }
}

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const root = outAt >= 0 ? args[outAt + 1] : join(settingsDir(), 'pets');
if (!root) throw new Error('--out needs a folder');
const known = [...Object.keys(PETS), 'shenshen', 'airi', 'hiyori', ...Object.keys(L2D_SAMPLES), 'doubao'];
const wanted = args.filter((a, i) => known.includes(a) && i !== outAt + 1);
const wantCore = args.includes('core');
// `core` alone fetches only the Core; with no argument at all, every pack is imported (each brings its own Core).
for (const id of wanted.length > 0 ? wanted : wantCore ? [] : known) {
  if (id === 'shenshen') await importShenshen(root);
  else if (id === 'airi') await importAiri(root);
  else if (id === 'doubao') await importDoubao(root);
  else if (id === 'hiyori') await importHiyori(root);
  else if (id in L2D_SAMPLES) await importSample(id, root);
  else await importPngPet(id, root);
}
if (wantCore) await importCore(root);
