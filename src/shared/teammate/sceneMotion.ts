/**
 * How the pets act in a scene. A scene names what a pet is doing (a cue); a cue is a mood, which each pet plays in its
 * own animation, and a gesture, a movement of head and body laid over it. A Live2D pet takes the gesture as parameters;
 * a pet drawn in frames takes the same gesture as a nudge of its picture, so one table of cues serves both.
 */

import { clamp, gestureAt, type Gesture, type Param, type Sway } from './live2d';
import { moodAnim, type Mood } from './mood';
import { PET_RESTS, type PetId } from './pet';

export type SceneGesture = Gesture | 'lean' | 'slam' | 'shuffle' | 'cheer' | 'slump';

export const CUES = [
  'sit', 'shuffle', 'draw', 'think', 'throw', 'call', 'win', 'lose', 'cheer', 'shock', 'laugh', 'chat',
] as const;
export type Cue = (typeof CUES)[number];

export interface CueSpec {
  /** An animation every pack has; it comes before the mood. */
  anim?: string;
  /** The mood the pet shows, in its own animation; none keeps it at rest. */
  mood: Mood | null;
  gesture: SceneGesture;
  /** How long the cue lasts before the pet sits back; 0 for the resting cue. */
  ms: number;
}

export const CUE_SPECS: Record<Cue, CueSpec> = {
  sit: { mood: null, gesture: 'sway', ms: 0 },
  shuffle: { mood: 'playful', gesture: 'shuffle', ms: 3200 },
  draw: { mood: null, gesture: 'lean', ms: 650 },
  think: { anim: 'think', mood: 'confused', gesture: 'look', ms: 1600 },
  throw: { mood: null, gesture: 'slam', ms: 650 },
  call: { mood: 'surprised', gesture: 'bounce', ms: 1500 },
  win: { mood: 'happy', gesture: 'cheer', ms: 5200 },
  lose: { mood: 'sad', gesture: 'slump', ms: 3400 },
  cheer: { mood: 'agree', gesture: 'bounce', ms: 2200 },
  shock: { mood: 'surprised', gesture: 'tremble', ms: 1800 },
  laugh: { mood: 'happy', gesture: 'bounce', ms: 2200 },
  chat: { mood: null, gesture: 'nod', ms: 1600 },
};

/** The animation `pet` plays for `cue`; `has` says which names its pack has. */
export function cueAnim(pet: PetId, cue: Cue, has: (anim: string) => boolean): string {
  const spec = CUE_SPECS[cue];
  if (spec.anim !== undefined && has(spec.anim)) return spec.anim;
  if (spec.mood !== null) return moodAnim(pet, spec.mood, has);
  return PET_RESTS[pet][0] ?? 'idle';
}

const TAU = Math.PI * 2;
const ease = (t: number, ms: number): number => clamp(t / ms, 0, 1);
/** 0 at the start and the end of `ms`, 1 in the middle. */
const bump = (t: number, ms: number): number => Math.sin(Math.PI * ease(t, ms));
/** Lifts are in the desktop pet's pixels; the scene's pets are about twice that size. */
const LIFT = 1.8;

/** The head and body movement of a gesture `tMs` after it began; the lift is in pixels of the scene, up positive. */
export function sceneGestureAt(gesture: SceneGesture, tMs: number): Sway {
  const r = ease(tMs, 250);
  switch (gesture) {
    case 'lean': {
      const k = bump(tMs, 650);
      return { face: { ParamBodyAngleY: -5 * k, ParamAngleY: -7 * k }, lift: -5 * k };
    }
    case 'slam': {
      const k = tMs < 140 ? 1 - (1 - tMs / 140) ** 2 : tMs < 220 ? 1 : Math.max(0, 1 - (tMs - 220) / 300);
      return { face: { ParamBodyAngleY: -8 * k, ParamAngleY: -10 * k, ParamBodyAngleX: 2 * k }, lift: -9 * k };
    }
    case 'shuffle': {
      const s = Math.sin(tMs / 65);
      return {
        face: { ParamBodyAngleX: 5 * s * r, ParamAngleX: 4 * Math.sin(tMs / 65 + 1) * r, ParamBodyAngleY: -3 * r },
        lift: -2 * r + 1.2 * Math.abs(s) * r,
      };
    }
    case 'cheer':
      return {
        face: { ParamAngleZ: 5 * Math.sin((TAU * tMs) / 840) * r, ParamBodyAngleZ: 3 * Math.sin((TAU * tMs) / 840 + 1) * r },
        lift: 16 * Math.abs(Math.sin((Math.PI * tMs) / 420)) * r,
      };
    case 'slump': {
      const k = ease(tMs, 600);
      return { face: { ParamAngleY: -14 * k, ParamBodyAngleY: -7 * k, ParamAngleZ: 3 * k }, lift: -8 * k };
    }
    default: {
      const g = gestureAt(gesture, tMs);
      return { face: g.face, lift: g.lift * LIFT };
    }
  }
}

/** A nudge of a picture drawn in frames, in pixels and radians, about its bottom middle. */
export interface SpriteMove {
  dx: number;
  /** Down positive, as on a screen. */
  dy: number;
  rot: number;
  sx: number;
  sy: number;
}

/** What a gesture does to a flat picture: the sideways lean moves it, the head's tilt turns it, a nod squashes it. */
export function spriteMove(sway: Sway): SpriteMove {
  const v = (p: Param): number => sway.face[p] ?? 0;
  const bow = v('ParamAngleY') + v('ParamBodyAngleY');
  return {
    dx: (v('ParamBodyAngleX') + v('ParamAngleX') * 0.5) * 1.4,
    dy: -sway.lift,
    rot: ((v('ParamAngleZ') + v('ParamBodyAngleZ')) * Math.PI * 0.35) / 180,
    sx: 1 - Math.min(0, bow) * 0.002,
    sy: 1 + bow * 0.004,
  };
}

/** The frame rates the scene may run at, fastest first. */
export const FPS_STEPS: readonly number[] = [60, 30, 20];

/**
 * The frame rate to run at, given the one now and the average time a frame took lately: a slow machine that misses its
 * rate by a third steps down to the next, so the picture stays smooth and the machine is not run flat out. It never
 * steps back up, since a frame that waits for the cap says nothing about what the machine could do.
 */
export function pickFps(current: number, avgFrameMs: number): number {
  const at = FPS_STEPS.indexOf(current);
  if (at < 0 || at >= FPS_STEPS.length - 1) return current;
  return avgFrameMs > (1000 / current) * 1.35 ? (FPS_STEPS[at + 1] as number) : current;
}

/** Where a pet sitting at `seatX` looks to see something at `targetX`: -1 left to 1 right, and a little down at the table. */
export function gazeAt(seatX: number, targetX: number): { x: number; y: number } {
  const d = targetX - seatX;
  return { x: Math.round(clamp(d / 450, -1, 1) * 100) / 100, y: -0.25 };
}
