/**
 * A Live2D character as a desktop pet. A pack of frames names its animations; a Live2D pack names *performances*: which
 * of the model's own motions to start, which face parameters to hold, and a little head-and-body movement on top.
 * The pet page only applies these numbers every frame, so the maths lives here where it can be tested.
 */

import { FIGHT_PERFORMANCES, fightGestureAt, isFightGesture, type Dir, type FightGesture } from './fightMotion';

/** The model's parameters a performance sets, with the range Cubism allows for each (the Hiyori sample's). */
export const L2D_RANGE = {
  ParamAngleX: [-30, 30], ParamAngleY: [-30, 30], ParamAngleZ: [-30, 30],
  ParamBodyAngleX: [-10, 10], ParamBodyAngleY: [-10, 10], ParamBodyAngleZ: [-10, 10],
  ParamCheek: [-1, 1],
  ParamEyeLOpen: [0, 1.2], ParamEyeROpen: [0, 1.2], ParamEyeLSmile: [0, 1], ParamEyeRSmile: [0, 1],
  ParamEyeBallX: [-1, 1], ParamEyeBallY: [-1, 1],
  ParamBrowLY: [-1, 1], ParamBrowRY: [-1, 1], ParamBrowLAngle: [-1, 1], ParamBrowRAngle: [-1, 1],
  ParamBrowLForm: [-1, 1], ParamBrowRForm: [-1, 1],
  ParamMouthForm: [-2, 1], ParamMouthOpenY: [0, 1],
} as const satisfies Record<string, readonly [number, number]>;
export type Param = keyof typeof L2D_RANGE;
export type Face = Partial<Record<Param, number>>;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const clampParam = (p: Param, v: number): number => clamp(v, L2D_RANGE[p][0], L2D_RANGE[p][1]);

/** One of the motions a model lists in its model3.json: the group and the index inside it. */
export interface MotionRef {
  group: string;
  index: number;
}

export type Gesture =
  | 'none' | 'nod' | 'shake' | 'bow' | 'sway' | 'bounce' | 'tremble' | 'dangle' | 'look' | FightGesture;

export interface Performance {
  /** The model's own motion to start; null leaves its idle loop going. */
  motion: MotionRef | null;
  /** Parameters held while it plays. */
  face: Face;
  /** How much of the face replaces what the motion itself drives, 0 to 1. */
  weight: number;
  /** Eye openness for both eyes, blinks laid over it; leave out to keep the motion's own eyes. */
  eyes?: number;
  gesture: Gesture;
  /** Thinking dots float beside the head. */
  dots?: true;
}

const both = (name: 'Brow' | 'Eye', k: 'Y' | 'Angle' | 'Form' | 'Smile', v: number): Face => {
  const l = `Param${name}L${k}` as Param;
  const r = `Param${name}R${k}` as Param;
  return { [l]: v, [r]: v };
};
const brows = (y: number, angle: number, form: number): Face => ({
  ...both('Brow', 'Y', y), ...both('Brow', 'Angle', angle), ...both('Brow', 'Form', form),
});
const smile = (v: number): Face => both('Eye', 'Smile', v);

const FISTS_UP: MotionRef = { group: 'Tap', index: 1 };
const HANDS_CHEEK: MotionRef = { group: 'FlickUp', index: 0 };
const OH: MotionRef = { group: 'Tap', index: 0 };
const LEG_LIFT: MotionRef = { group: 'Flick', index: 0 };
const HMPH: MotionRef = { group: 'Tap@Body', index: 0 };

/**
 * What each animation name makes the character do. The names are the ones the other pets use (`idle`, `think`, `love`,
 * ...) so mood and idle life address a Live2D pet the same way; `walk` and `held` are the poses.
 */
export const PERFORMANCES: Record<string, Performance> = {
  idle: { motion: null, face: {}, weight: 0, gesture: 'none' },
  walk: { motion: null, face: {}, weight: 0, gesture: 'none' },
  held: {
    motion: null, face: { ...brows(0.6, 0, 0), ParamMouthOpenY: 0.35, ParamMouthForm: -0.2 }, weight: 0.9, eyes: 1.1,
    gesture: 'dangle',
  },
  think: {
    motion: HANDS_CHEEK, face: { ...brows(0.3, 0.2, 0), ParamEyeBallY: 0.6, ParamAngleY: 7, ParamAngleZ: 6, ParamMouthForm: 0.2 },
    weight: 0.6, gesture: 'none', dots: true,
  },
  happy: {
    motion: FISTS_UP, face: { ParamCheek: 0.7, ParamMouthForm: 1, ParamMouthOpenY: 0.25 }, weight: 0.5, gesture: 'bounce',
  },
  celebrate: {
    motion: FISTS_UP, face: { ...smile(1), ParamCheek: 0.8, ParamMouthForm: 1, ParamMouthOpenY: 0.5 }, weight: 0.85,
    gesture: 'bounce',
  },
  love: {
    motion: FISTS_UP, face: { ...smile(1), ParamCheek: 1, ParamMouthForm: 1, ParamMouthOpenY: 0.15, ...brows(0.2, 0, 0) },
    weight: 0.9, gesture: 'sway',
  },
  thanks: {
    motion: HANDS_CHEEK, face: { ...smile(0.7), ParamCheek: 0.5, ParamMouthForm: 1 }, weight: 0.7, gesture: 'bow',
  },
  agree: {
    motion: OH, face: { ParamMouthForm: 1, ParamMouthOpenY: 0.1, ParamCheek: 0.3 }, weight: 0.6, gesture: 'nod',
  },
  wink: {
    motion: LEG_LIFT, face: { ParamEyeLOpen: 0, ParamEyeLSmile: 1, ParamMouthForm: 1, ParamMouthOpenY: 0.3, ParamAngleZ: 8 },
    weight: 0.85, gesture: 'sway',
  },
  giggle: {
    motion: FISTS_UP, face: { ...smile(1), ParamCheek: 0.6, ParamMouthForm: 1, ParamMouthOpenY: 0.45 }, weight: 0.9,
    gesture: 'bounce',
  },
  confused: {
    motion: null, face: { ...brows(0.5, 0.5, 0.3), ParamBrowRY: -0.2, ParamMouthForm: -0.6, ParamEyeBallX: 0.5, ParamAngleZ: 12 },
    weight: 0.8, gesture: 'shake',
  },
  surprised: {
    motion: OH, face: { ...brows(1, 0, 0), ParamMouthOpenY: 0.8, ParamMouthForm: 0, ParamAngleY: 5 }, weight: 0.9, eyes: 1.2,
    gesture: 'none',
  },
  sad: {
    motion: null, face: { ...brows(-0.4, -0.8, -0.8), ParamMouthForm: -1.4, ParamEyeBallY: -0.6, ParamAngleY: -12, ParamAngleZ: 4 },
    weight: 0.85, eyes: 0.75, gesture: 'none',
  },
  angry: {
    motion: HMPH, face: { ...brows(-0.2, -1, -1), ParamMouthForm: -1.4, ParamCheek: 0.3, ParamAngleY: -4 }, weight: 0.85,
    eyes: 0.9, gesture: 'tremble',
  },
  shy: {
    motion: HANDS_CHEEK, face: { ParamCheek: 1, ParamEyeBallX: -0.7, ParamEyeBallY: -0.4, ParamAngleX: -8, ParamMouthForm: 0.2 },
    weight: 0.8, eyes: 0.9, gesture: 'sway',
  },
  tired: {
    motion: null, face: { ...brows(-0.3, 0, 0), ParamMouthForm: -0.2, ParamAngleY: -8, ParamAngleZ: 6 }, weight: 0.8, eyes: 0.35,
    gesture: 'sway',
  },
  yawn: {
    motion: null, face: { ...brows(0.2, 0, 0), ParamMouthOpenY: 0.9, ParamMouthForm: 0, ParamAngleY: 6 }, weight: 0.9, eyes: 0.1,
    gesture: 'none',
  },
  hum: {
    motion: null, face: { ...smile(0.8), ParamMouthForm: 1, ParamMouthOpenY: 0.2, ParamCheek: 0.3 }, weight: 0.7, gesture: 'sway',
  },
  sway: { motion: null, face: {}, weight: 0, gesture: 'sway' },
  look: { motion: null, face: {}, weight: 0, gesture: 'look' },
};

export const L2D_ANIMS: readonly string[] = Object.keys(PERFORMANCES);

/** The animations a Live2D pet can rest in, the first being the default: every performance but the two poses. */
export const L2D_RESTS: readonly string[] = [
  'idle', 'sway', 'look', 'hum', 'giggle', 'shy', 'wink', 'celebrate', 'love', 'thanks', 'agree', 'confused',
  'surprised', 'sad', 'angry', 'think', 'yawn', 'tired',
];

/** What a click on the character makes it do; the page picks one that isn't the last. */
export const POKES: readonly string[] = ['giggle', 'shy', 'surprised', 'celebrate', 'wink'];
/** How long a poke's reaction lasts before the character goes back to what it was doing. */
export const POKE_MS = 2600;
/** A pack with motions of its own lets a poke's motion play through, but not for longer than this. */
export const POKE_MAX_MS = 9000;

export function pickPoke(last: string | null, rand: () => number): string {
  const choices = POKES.filter((p) => p !== last);
  return choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))];
}

/**
 * The performance for an animation name; an unknown one is the idle. The names of a fight's cues (`fight-punch`, ...)
 * are not among `PERFORMANCES`, which is what a pet is told it can play, but a pet that is sent one plays it.
 */
export const performanceFor = (anim: string): Performance =>
  PERFORMANCES[anim] ?? FIGHT_PERFORMANCES[anim] ?? PERFORMANCES.idle;

type MotionPack = { motions?: Record<string, MotionRef> };

/**
 * The model's own motion that plays for an animation: the one a pack names in its `motions` (an animation it leaves out
 * plays none, only the face and gesture), or the Hiyori set's when the pack names none.
 */
export const motionFor = (pack: MotionPack, anim: string): MotionRef | null =>
  pack.motions ? (pack.motions[anim] ?? null) : performanceFor(anim).motion;

/**
 * How long a reaction motion plays before the model is taken back to its idle loop, though the face stays. The Hiyori
 * set's motions are cut short; the ones a pack names are there to be seen, so they play through.
 */
export const reactCapMs = (pack: MotionPack): number => (pack.motions ? Infinity : 4800);

/** The face a performance holds: its own parameters, and its `eyes` on both eyes unless it sets one itself. */
export function faceOf(perf: Performance): Face {
  return perf.eyes === undefined ? perf.face : { ParamEyeLOpen: perf.eyes, ParamEyeROpen: perf.eyes, ...perf.face };
}

type Point = { x: number; y: number };

export interface Sway {
  /** Added to the model's parameters. */
  face: Face;
  /** DIPs the character is lifted off the floor. */
  lift: number;
}

const TAU = Math.PI * 2;
const ease = (t: number, ms: number): number => clamp(t / ms, 0, 1);

/**
 * The head and body movement of a gesture `tMs` after it began; it eases in over a quarter second so a new one doesn't
 * jerk the character. `dir` is the way the character faces (1 right, -1 left), which only a fight's gestures care about.
 */
export function gestureAt(gesture: Gesture, tMs: number, dir: Dir = 1): Sway {
  if (isFightGesture(gesture)) return fightGestureAt(gesture, tMs, dir);
  const r = ease(tMs, 250);
  switch (gesture) {
    case 'none':
      return { face: {}, lift: 0 };
    case 'nod': {
      const down = 0.5 - 0.5 * Math.cos((TAU * tMs) / 900);
      return { face: { ParamAngleY: -9 * down * r, ParamBodyAngleY: -3 * down * r }, lift: 0 };
    }
    case 'shake':
      return { face: { ParamAngleX: 9 * Math.sin((TAU * tMs) / 1100) * r }, lift: 0 };
    case 'bow': {
      const down = 0.5 - 0.5 * Math.cos((TAU * tMs) / 2600);
      return { face: { ParamAngleY: -16 * down * r, ParamBodyAngleY: -7 * down * r }, lift: 0 };
    }
    case 'sway':
      return {
        face: {
          ParamAngleZ: 4 * Math.sin((TAU * tMs) / 3200) * r,
          ParamBodyAngleZ: 3 * Math.sin((TAU * tMs) / 3200 + 0.8) * r,
          ParamBodyAngleX: 2 * Math.sin((TAU * tMs) / 4100) * r,
        },
        lift: 0,
      };
    case 'bounce':
      return {
        face: { ParamAngleZ: 3 * Math.sin((TAU * tMs) / 840) * r },
        lift: 5 * Math.abs(Math.sin((Math.PI * tMs) / 420)) * r,
      };
    case 'tremble':
      return { face: { ParamAngleX: 1.4 * Math.sin((TAU * tMs) / 90) * r, ParamBodyAngleX: 0.8 * Math.sin((TAU * tMs) / 110) * r }, lift: 0 };
    case 'dangle':
      return {
        face: { ParamAngleZ: 8 * Math.sin((TAU * tMs) / 900) * r, ParamBodyAngleZ: 5 * Math.sin((TAU * tMs) / 900 + 0.5) * r },
        lift: 0,
      };
    case 'look':
      return {
        face: { ParamAngleX: 16 * Math.sin((TAU * tMs) / 4200) * r, ParamEyeBallX: 0.8 * Math.sin((TAU * tMs) / 4200) * r },
        lift: 0,
      };
  }
}

const WALK_STEP_MS = 300;
const WALK_LEAN = 6;

/** The lean and hop of a run: `dir` is 1 going right and -1 going left, `tMs` the time since it began. */
export function walkAt(tMs: number, dir: 1 | -1): Sway {
  const r = ease(tMs, 120);
  const step = Math.abs(Math.sin((Math.PI * tMs) / WALK_STEP_MS));
  return {
    face: {
      ParamAngleZ: dir * WALK_LEAN * r,
      ParamBodyAngleZ: dir * (WALK_LEAN * 0.7) * r,
      ParamBodyAngleX: dir * 3 * Math.sin((TAU * tMs) / (WALK_STEP_MS * 2)) * r,
      ParamAngleY: -3 * step * r,
    },
    lift: 7 * step * r,
  };
}

/** Where the character looks: -1 to 1 either way, `y` positive up; the pointer's distance in DIPs, past `REACH` it is the edge. */
export const GAZE_REACH = { x: 520, y: 360 } as const;
const GAZE_DEAD = 24;

export function gazeToward(from: Point, pointer: Point): Point {
  const axis = (d: number, reach: number): number => {
    if (Math.abs(d) < GAZE_DEAD) return 0;
    return clamp(d / reach, -1, 1);
  };
  const x = axis(pointer.x - from.x, GAZE_REACH.x);
  const y = axis(from.y - pointer.y, GAZE_REACH.y);
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

const BLINK_MS = 170;

/** When the next blink comes, `now` being epoch ms. */
export const nextBlink = (now: number, rand: () => number): number => now + 2200 + Math.round(rand() * 3800);

/** How open the eyes are, as a fraction of what they were: 1 apart from a blink, which closes them and opens again. */
export function blinkFactor(sinceMs: number): number {
  if (sinceMs < 0 || sinceMs >= BLINK_MS) return 1;
  return 1 - Math.sin((Math.PI * sinceMs) / BLINK_MS);
}

/** How long the mouth moves for a line of `text`: about as long as saying it takes, never under a beat or over a breath. */
export function talkMs(text: string): number {
  return clamp(Math.round([...text.trim()].length * 70), 1200, 9000);
}

/** The mouth `tMs` into `durationMs` of speech: open fast and slow like syllables with a gap now and then; null outside it. */
export function mouthAt(tMs: number, durationMs: number): { open: number; form: number } | null {
  if (tMs < 0 || tMs >= durationMs) return null;
  const env = Math.min(1, tMs / 120, (durationMs - tMs) / 160);
  const syllable = Math.pow(Math.abs(Math.sin((Math.PI * tMs) / 170)), 0.8);
  const word = 0.55 + 0.45 * Math.sin(tMs / 410 + 1.3);
  return {
    open: clamp(env * syllable * word, 0, 1),
    form: clamp(0.35 + 0.35 * Math.sin(tMs / 300), 0, 0.8),
  };
}

/** One parameter the page holds a performance's value on: where it is now and how strongly it overrides the motion. */
export interface Slot {
  value: number;
  weight: number;
}
export type Blend = Partial<Record<Param, Slot>>;
export const BLEND_TAU_MS = 160;

/**
 * One frame of changing from one face to another: each parameter in `face` eases to its value and to `weight`; one that
 * has left it keeps its last value while its weight fades to nothing, then is dropped.
 */
export function stepBlend(blend: Blend, face: Face, weight: number, dtMs: number): Blend {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / BLEND_TAU_MS);
  const next: Blend = {};
  const params = new Set<Param>([...(Object.keys(blend) as Param[]), ...(Object.keys(face) as Param[])]);
  for (const p of params) {
    const goal = face[p];
    const slot = blend[p] ?? { value: goal === undefined ? 0 : clampParam(p, goal), weight: 0 };
    const value = goal === undefined ? slot.value : slot.value + (clampParam(p, goal) - slot.value) * k;
    const w = slot.weight + ((goal === undefined ? 0 : weight) - slot.weight) * k;
    if (goal === undefined && w < 0.003) continue;
    next[p] = { value, weight: w };
  }
  return next;
}
