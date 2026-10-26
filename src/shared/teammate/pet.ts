/** The desktop pet: which characters show, how a character's animation pack reads, and how one walks to a ping. */

export const PET_IDS = ['whale', 'naiwa'] as const;
export type PetId = (typeof PET_IDS)[number];

/** Which way each pack's art looks when unflipped, so running can face the way it goes. */
export const PET_FACES: Record<PetId, 'left' | 'right'> = { whale: 'right', naiwa: 'left' };

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
};

export const DEFAULT_PETS: PetsSetting = {
  whale: { on: false, rest: PET_RESTS.whale[0] },
  naiwa: { on: false, rest: PET_RESTS.naiwa[0] },
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
  return { whale: one('whale'), naiwa: one('naiwa') };
}

export const petIds = (pets: PetsSetting): PetId[] => PET_IDS.filter((id) => pets[id].on);
/** What a pet is doing; each pack maps these to its own animations. */
export type PetPose = 'idle' | 'walk' | 'think' | 'happy' | 'held';
export const PET_POSES: readonly PetPose[] = ['idle', 'walk', 'think', 'happy', 'held'];

export interface PetAnim {
  /** File names inside the pack's folder. */
  frames: string[];
  fps: number;
}

export interface PetManifest {
  id: string;
  /** Size one frame is drawn at, in DIPs. */
  width: number;
  height: number;
  /** The five poses, and any other animation the pack has (a pet can rest in one). */
  anims: Record<string, PetAnim>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const FRAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const NAME_RE = /^[a-z0-9_]{1,32}$/;
const MAX_FRAMES = 64;
const MAX_SIZE = 512;

function anim(raw: unknown): PetAnim | null {
  if (!isObj(raw) || !Array.isArray(raw.frames)) return null;
  const frames = raw.frames.filter((f): f is string => typeof f === 'string' && FRAME_RE.test(f) && !f.startsWith('.'));
  if (frames.length === 0 || frames.length > MAX_FRAMES || frames.length !== raw.frames.length) return null;
  const fps = typeof raw.fps === 'number' && raw.fps >= 1 && raw.fps <= 30 ? raw.fps : 8;
  return { frames, fps };
}

/** Reads an animation pack's manifest.json; null unless every pose has frames, so a half-written pack shows nothing. */
export function parsePetManifest(raw: unknown): PetManifest | null {
  if (!isObj(raw) || !isObj(raw.anims)) return null;
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
  const size = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_SIZE, Math.max(32, Math.round(v))) : fallback;
  return {
    id: typeof raw.id === 'string' ? raw.id.slice(0, 32) : '',
    width: size(raw.width, 128), height: size(raw.height, 128),
    anims,
  };
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

/**
 * Where pet `index` of `count` stands (its top-left, DIPs) beside the ping at `ping`: the first on its left, the
 * second on its right, so two pets don't overlap and the ping stays visible between them.
 */
export function standBeside(ping: Point, index: number, count: number, size: { width: number; height: number }): Point {
  const right = count > 1 && index % 2 === 1;
  const x = right ? ping.x + STAND_GAP : ping.x - STAND_GAP - size.width;
  return { x: Math.round(x), y: Math.round(ping.y - size.height * 0.7) };
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
