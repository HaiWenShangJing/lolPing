/** The desktop pet: which characters show, how a character's animation pack reads, and how one walks to a ping. */

import { L2D_ANIMS } from './live2d';

export const PET_IDS = ['whale', 'naiwa', 'shenshen', 'airi', 'hiyori'] as const;
export type PetId = (typeof PET_IDS)[number];

/** Which way each pack's art looks when unflipped, so running can face the way it goes. */
export const PET_FACES: Record<PetId, 'left' | 'right'> = {
  whale: 'right', naiwa: 'left', shenshen: 'right', airi: 'right', hiyori: 'right',
};

/** One character's setting: whether it shows, and the animation it plays while it rests on the desktop. */
export interface PetSetting {
  on: boolean;
  rest: string;
}
export type PetsSetting = Record<PetId, PetSetting>;

/** The animations a character can rest in (names in its pack), the first being the default. */
export const PET_RESTS: Record<PetId, readonly string[]> = {
  whale: ['idle', 'walk', 'dance', 'flying', 'held'],
  naiwa: [
    'sit', 'laugh', 'stretch', 'victory', 'belly_drum', 'brain_loading', 'fake_faint', 'freeze', 'noodle_dance',
    'play_bow', 'pretzel_twist', 'think',
  ],
  shenshen: [
    'idle', 'wave', 'giggle', 'shy', 'sulk', 'dance', 'sway', 'hum', 'nap', 'yawn', 'stretch', 'bubbles', 'look', 'tail',
    'cat', 'think',
  ],
  airi: [
    'idle', 'celebrate', 'love', 'thanks', 'agree', 'confused', 'surprised', 'awkward', 'disagree', 'angry', 'sad', 'tired',
  ],
  hiyori: [
    'idle', 'sway', 'look', 'hum', 'giggle', 'shy', 'wink', 'celebrate', 'love', 'thanks', 'agree', 'confused',
    'surprised', 'sad', 'angry', 'think', 'yawn', 'tired',
  ],
};

export const DEFAULT_PETS: PetsSetting = {
  whale: { on: false, rest: PET_RESTS.whale[0] },
  naiwa: { on: false, rest: PET_RESTS.naiwa[0] },
  shenshen: { on: false, rest: PET_RESTS.shenshen[0] },
  airi: { on: false, rest: PET_RESTS.airi[0] },
  hiyori: { on: false, rest: PET_RESTS.hiyori[0] },
};

/** Reads the saved setting; anything unknown falls back to off and the character's default animation. */
export function normalizePets(raw: unknown): PetsSetting {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const one = (id: PetId): PetSetting => {
    const v = r[id];
    const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
    return {
      on: o.on === true,
      rest: typeof o.rest === 'string' && PET_RESTS[id].includes(o.rest) ? o.rest : DEFAULT_PETS[id].rest,
    };
  };
  const pets = { ...DEFAULT_PETS };
  for (const id of PET_IDS) pets[id] = one(id);
  return pets;
}

export const petIds = (pets: PetsSetting): PetId[] => PET_IDS.filter((id) => pets[id].on);
/** What a pet is doing; each pack maps these to its own animations. */
export type PetPose = 'idle' | 'walk' | 'think' | 'happy' | 'held';
export const PET_POSES: readonly PetPose[] = ['idle', 'walk', 'think', 'happy', 'held'];

export interface PetAnim {
  /** File names inside the pack's folder; empty for a Live2D pack, whose animations are performances the page plays. */
  frames: string[];
  fps: number;
}

/** A Live2D pack's two files, paths inside its folder: the model's model3.json and Live2D's own Cubism Core script. */
export interface Live2dPack {
  model: string;
  core: string;
}

export interface PetManifest {
  id: string;
  /** Size one frame is drawn at, in DIPs. */
  width: number;
  height: number;
  /** The five poses, and any other animation the pack has (a pet can rest in one). */
  anims: Record<string, PetAnim>;
  /** Set when the pack is a Live2D model instead of frames. */
  live2d?: Live2dPack;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const FRAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const NAME_RE = /^[a-z0-9_]{1,32}$/;
const PATH_RE = /^(?:[A-Za-z0-9_.-]{1,64}\/){0,3}[A-Za-z0-9_.-]{1,64}$/;
const MAX_FRAMES = 128;
const MAX_SIZE = 512;

function anim(raw: unknown): PetAnim | null {
  if (!isObj(raw) || !Array.isArray(raw.frames)) return null;
  const frames = raw.frames.filter((f): f is string => typeof f === 'string' && FRAME_RE.test(f) && !f.startsWith('.'));
  if (frames.length === 0 || frames.length > MAX_FRAMES || frames.length !== raw.frames.length) return null;
  const fps = typeof raw.fps === 'number' && raw.fps >= 1 && raw.fps <= 30 ? raw.fps : 8;
  return { frames, fps };
}

/** A path inside the pack's folder ending in `ext`: no way out of it, no hidden segments. */
function packPath(v: unknown, ext: string): string | null {
  if (typeof v !== 'string' || !PATH_RE.test(v) || !v.endsWith(ext)) return null;
  return v.split('/').some((s) => s.startsWith('.')) ? null : v;
}

function live2dPack(raw: unknown): Live2dPack | null {
  if (!isObj(raw)) return null;
  const model = packPath(raw.model, '.model3.json');
  const core = packPath(raw.core, '.js');
  return model && core ? { model, core } : null;
}

/**
 * Reads an animation pack's manifest.json; null unless every pose has frames, so a half-written pack shows nothing.
 * A Live2D pack has no frames: it names its model and core, and every performance is an animation.
 */
export function parsePetManifest(raw: unknown): PetManifest | null {
  if (!isObj(raw)) return null;
  const size = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_SIZE, Math.max(32, Math.round(v))) : fallback;
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 32) : '';
  if (raw.live2d !== undefined) {
    const live2d = live2dPack(raw.live2d);
    if (!live2d) return null;
    const anims: Record<string, PetAnim> = {};
    for (const name of L2D_ANIMS) anims[name] = { frames: [], fps: 1 };
    return { id, width: size(raw.width, 200), height: size(raw.height, 320), anims, live2d };
  }
  if (!isObj(raw.anims)) return null;
  const anims: Record<string, PetAnim> = {};
  for (const pose of PET_POSES) {
    const a = anim(raw.anims[pose]);
    if (!a) return null;
    anims[pose] = a;
  }
  for (const [name, v] of Object.entries(raw.anims)) {
    const a = NAME_RE.test(name) && !(name in anims) ? anim(v) : null;
    if (a) anims[name] = a;
  }
  return { id, width: size(raw.width, 128), height: size(raw.height, 128), anims };
}

type Point = { x: number; y: number };

/** One step of a walk: `speed` in DIPs per second, `dtMs` since the last step; arrives exactly instead of overshooting. */
export function stepToward(from: Point, to: Point, speed: number, dtMs: number): { at: Point; arrived: boolean } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const reach = (speed * dtMs) / 1000;
  if (dist <= reach) return { at: { ...to }, arrived: true };
  return { at: { x: from.x + (dx / dist) * reach, y: from.y + (dy / dist) * reach }, arrived: false };
}

const STAND_GAP = 18;
const STAND_SPACE = 6;

type Size = { width: number; height: number };

/**
 * Where pet `index` of `count` stands (its top-left, DIPs) beside the ping at `ping`: the first on its left, the
 * second on its right, then the rest alternate outward, so no two pets overlap and the ping stays visible between them.
 */
export function standBeside(ping: Point, index: number, count: number, size: Size): Point {
  const right = count > 1 && index % 2 === 1;
  const out = Math.floor(index / 2) * (size.width + STAND_SPACE);
  const x = right ? ping.x + STAND_GAP + out : ping.x - STAND_GAP - size.width - out;
  return { x: Math.round(x), y: Math.round(ping.y - size.height * 0.7) };
}

/**
 * Where pet `index` stands while an answer comes: all of them on the ping's left, side by side, so the bubble that
 * opens on its right never covers one. `areaLeft` is the display's left edge; pets that don't fit before it stand in
 * a row above.
 */
export function standLeftOf(ping: Point, index: number, sizes: readonly Size[], areaLeft: number): Point {
  const room = ping.x - STAND_GAP - areaLeft;
  let used = 0;
  let row = 0;
  let x = ping.x - STAND_GAP;
  for (let i = 0; i <= index && i < sizes.length; i++) {
    const w = sizes[i].width;
    if (used > 0 && used + w > room) {
      row++;
      used = 0;
    }
    x = ping.x - STAND_GAP - used - w;
    used += w + STAND_SPACE;
  }
  const height = sizes[Math.min(index, sizes.length - 1)]?.height ?? 0;
  return { x: Math.round(x), y: Math.round(ping.y - height * 0.7 - row * height * 0.6) };
}

/** Keeps a window of `size` inside `area`, so a pet sent to the edge of a display still shows. */
export function keepInside(
  at: Point, size: { width: number; height: number }, area: { x: number; y: number; width: number; height: number },
): Point {
  return {
    x: Math.round(Math.min(Math.max(at.x, area.x), area.x + area.width - size.width)),
    y: Math.round(Math.min(Math.max(at.y, area.y), area.y + area.height - size.height)),
  };
}
