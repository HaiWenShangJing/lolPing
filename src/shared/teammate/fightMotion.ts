/**
 * What a bout looks like on the pets themselves: the cues a fighter plays, the Live2D performance and gesture behind
 * each, the animations a pack of frames borrows for it, and how the pet's window is nudged (a lunge, a knockback, a hop).
 * Like the rest of a bout it is only numbers, so it is tested without a window. It imports nothing but types from
 * `live2d.ts`, which in turn imports this.
 */

import type { Face, MotionRef, Param, Performance, Sway } from './live2d';
import type { Move, Result } from './fight';

/** Which way a pet faces on the screen: 1 to the right, -1 to the left. */
export type Dir = 1 | -1;

export type FightCue =
  | 'guard' | 'wind' | 'charge' | 'punch' | 'smash' | 'hit' | 'crit' | 'block' | 'dodge' | 'ko' | 'win' | 'lose' | 'draw';

export type FightGesture =
  | 'guard' | 'wind' | 'charge' | 'lunge' | 'smash' | 'recoil' | 'stagger' | 'brace' | 'dodge' | 'slump' | 'cheer' | 'shrug';

const GESTURES: Record<FightCue, FightGesture> = {
  guard: 'guard', wind: 'wind', charge: 'charge', punch: 'lunge', smash: 'smash', hit: 'recoil', crit: 'stagger',
  block: 'brace', dodge: 'dodge', ko: 'slump', win: 'cheer', lose: 'slump', draw: 'shrug',
};

export const FIGHT_CUES = Object.keys(GESTURES) as FightCue[];

const FIGHT_GESTURES: ReadonlySet<string> = new Set(Object.values(GESTURES));
export const isFightGesture = (g: string): g is FightGesture => FIGHT_GESTURES.has(g);

/** The cue the attacker plays as its blow lands. */
export const strikeCue = (move: Move): FightCue => (move === 'special' ? 'smash' : 'punch');
/** The cue the attacker plays while it draws back. */
export const windCue = (move: Move): FightCue => (move === 'special' ? 'charge' : 'wind');
/** The cue the one under the blow plays. */
export function takeCue(move: Move, result: Result): FightCue {
  if (result === 'dodge') return 'dodge';
  if (result === 'block') return 'block';
  return result === 'crit' || move === 'special' ? 'crit' : 'hit';
}

const TAU = Math.PI * 2;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const easeOut = (x: number): number => 1 - (1 - clamp01(x)) ** 3;
const smooth = (x: number): number => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};

/** 0 up to 1 over `rise`, held for `hold`, and back down to 0 over `fall` (all ms): the shape of a reach or a flinch. */
export function pulse(tMs: number, rise: number, hold: number, fall: number): number {
  if (tMs <= 0) return 0;
  if (tMs < rise) return easeOut(tMs / rise);
  if (tMs < rise + hold) return 1;
  return 1 - smooth((tMs - rise - hold) / fall);
}

/** The head and body toward `d` by `k` of a firm lean (a negative `k` leans away from it). */
const lean = (d: Dir, k: number, extra: Face = {}): Face => ({
  ParamAngleX: d * 14 * k, ParamAngleZ: d * 12 * k, ParamBodyAngleZ: d * 8 * k, ParamBodyAngleX: d * 6 * k, ...extra,
});

/** The head and body movement of a fight gesture `tMs` after it began, for a pet facing `d`; forward is the way it faces. */
export function fightGestureAt(gesture: FightGesture, tMs: number, d: Dir): Sway {
  const t = Math.max(0, tMs);
  switch (gesture) {
    case 'guard': {
      const r = easeOut(t / 220);
      const bob = 0.5 - 0.5 * Math.cos((TAU * t) / 640);
      return { face: lean(d, 0.3 * r, { ParamAngleY: -2 * r }), lift: 3 * bob * r };
    }
    case 'wind': {
      const p = easeOut(t / 300);
      return { face: lean(d, -0.8 * p, { ParamAngleY: -4 * p }), lift: 0 };
    }
    case 'charge': {
      const p = easeOut(t / 420);
      const face = lean(d, -0.9 * p, { ParamAngleY: -5 * p });
      face.ParamAngleX = (face.ParamAngleX ?? 0) + Math.sin((TAU * t) / 70) * (1 + Math.min(t, 1400) / 700) * 1.6;
      return { face, lift: 0 };
    }
    case 'lunge': {
      const p = pulse(t, 90, 120, 260);
      return { face: lean(d, p, { ParamAngleY: -6 * p }), lift: 5 * Math.sin(Math.PI * clamp01(t / 470)) };
    }
    case 'smash': {
      const p = pulse(t, 140, 260, 360);
      return { face: lean(d, 1.2 * p, { ParamAngleY: -8 * p }), lift: 12 * Math.sin(Math.PI * clamp01(t / 760)) };
    }
    case 'recoil': {
      const p = pulse(t, 70, 90, 330);
      const wobble = 0.25 * Math.sin((TAU * t) / 180) * (1 - clamp01(t / 520));
      return { face: lean(d, -(1 + wobble) * p, { ParamAngleY: 8 * p }), lift: 0 };
    }
    case 'stagger': {
      const p = pulse(t, 90, 170, 420);
      const wobble = 0.25 * Math.sin((TAU * t) / 220) * (1 - clamp01(t / 680));
      return { face: lean(d, -(1 + wobble) * p, { ParamAngleY: 12 * p }), lift: 4 * Math.sin(Math.PI * clamp01(t / 520)) };
    }
    case 'brace': {
      const p = pulse(t, 60, 120, 140);
      const face = lean(d, 0.25 * p, { ParamAngleY: -5 * p });
      face.ParamBodyAngleX = (face.ParamBodyAngleX ?? 0) + Math.sin((TAU * t) / 60) * p * 1.2;
      return { face, lift: -2 * p };
    }
    case 'dodge': {
      const p = pulse(t, 110, 140, 260);
      return { face: lean(d, -0.9 * p, { ParamAngleY: 4 * p }), lift: 16 * Math.sin(Math.PI * clamp01(t / 520)) };
    }
    case 'slump': {
      const p = smooth(t / 700);
      const face = lean(d, -1.2 * p, { ParamAngleY: -24 * p, ParamBodyAngleY: -8 * p });
      face.ParamAngleZ = (face.ParamAngleZ ?? 0) + 1.5 * Math.sin((TAU * t) / 900) * p;
      return { face, lift: -14 * p };
    }
    case 'cheer': {
      const r = easeOut(t / 200);
      return {
        face: { ParamAngleZ: 6 * Math.sin((TAU * t) / 1040) * r, ParamAngleY: 3 * r, ParamBodyAngleZ: 3 * Math.sin((TAU * t) / 1040 + 0.6) * r },
        lift: 12 * Math.abs(Math.sin((Math.PI * t) / 520)) * r,
      };
    }
    case 'shrug': {
      const r = easeOut(t / 300);
      return {
        face: { ParamAngleZ: 6 * Math.sin((TAU * t) / 1800) * r, ParamAngleX: 8 * Math.sin((TAU * t) / 2400) * r, ParamAngleY: 2 * r },
        lift: 0,
      };
    }
  }
}

// The faces below: the same parameters the other performances hold, spelled out here so this file needs nothing at
// runtime from `live2d.ts`.
const both = (name: 'Brow' | 'Eye', k: 'Y' | 'Angle' | 'Form' | 'Smile', v: number): Face => {
  const l = `Param${name}L${k}` as Param;
  const r = `Param${name}R${k}` as Param;
  return { [l]: v, [r]: v };
};
const brows = (y: number, angle: number, form: number): Face => ({
  ...both('Brow', 'Y', y), ...both('Brow', 'Angle', angle), ...both('Brow', 'Form', form),
});

const FISTS_UP: MotionRef = { group: 'Tap', index: 1 };

/** The anim name a Live2D pet is told for a cue. */
export const fightAnim = (cue: FightCue): string => `fight-${cue}`;

const fierce = brows(-0.3, -1, -1);
const pained = brows(0.4, 0.8, -0.8);

const performance = (cue: FightCue, p: Omit<Performance, 'gesture'>): [string, Performance] => [
  fightAnim(cue), { ...p, gesture: GESTURES[cue] },
];

/**
 * What each cue makes a Live2D character do: a face, the gesture above, and, for a pack that maps them, one of the
 * model's own motions. They are not in `PERFORMANCES`, which is what the host agent is told a pet can play.
 */
export const FIGHT_PERFORMANCES: Record<string, Performance> = Object.fromEntries([
  performance('guard', { motion: FISTS_UP, face: { ...fierce, ParamMouthForm: -0.8, ParamCheek: 0.2 }, weight: 0.85, eyes: 0.95 }),
  performance('wind', { motion: null, face: { ...brows(-0.4, -1, -1), ParamMouthForm: -1.4 }, weight: 0.9, eyes: 0.8 }),
  performance('charge', { motion: null, face: { ...brows(-0.6, -1, -1), ParamMouthForm: -1.5, ParamCheek: 0.6 }, weight: 0.95, eyes: 0.7 }),
  performance('punch', { motion: null, face: { ...fierce, ParamMouthOpenY: 0.7, ParamMouthForm: -0.4 }, weight: 0.9, eyes: 0.8 }),
  performance('smash', { motion: null, face: { ...fierce, ParamMouthOpenY: 0.95, ParamMouthForm: -0.3, ParamCheek: 0.5 }, weight: 0.95, eyes: 0.75 }),
  performance('hit', { motion: null, face: { ...pained, ParamMouthOpenY: 0.5, ParamMouthForm: -1.2 }, weight: 0.95, eyes: 0.15 }),
  performance('crit', { motion: null, face: { ...pained, ParamMouthOpenY: 0.9, ParamMouthForm: -1 }, weight: 1, eyes: 0.05 }),
  performance('block', { motion: null, face: { ...fierce, ParamMouthForm: -1 }, weight: 0.9, eyes: 0.55 }),
  performance('dodge', { motion: null, face: { ...brows(0.9, 0, 0), ParamMouthOpenY: 0.35, ParamMouthForm: 0 }, weight: 0.9, eyes: 1.2 }),
  performance('ko', { motion: null, face: { ...brows(-0.6, -0.8, -0.8), ParamMouthOpenY: 0.35, ParamMouthForm: -1.2 }, weight: 1, eyes: 0 }),
  performance('win', {
    motion: FISTS_UP, face: { ...both('Eye', 'Smile', 1), ParamCheek: 0.8, ParamMouthForm: 1, ParamMouthOpenY: 0.6 }, weight: 0.9,
  }),
  performance('lose', { motion: null, face: { ...brows(-0.4, -0.8, -0.8), ParamMouthForm: -1.4, ParamCheek: 0.2 }, weight: 0.9, eyes: 0.45 }),
  performance('draw', { motion: null, face: { ...brows(0.5, 0.5, 0.3), ParamMouthForm: -0.6 }, weight: 0.8 }),
]);

/** The animations a pack of frames plays for a cue, best first: the first one the pack has is used. */
export const FIGHT_ANIM_PREFS: Record<FightCue, readonly string[]> = {
  guard: ['angry', 'idle'],
  wind: ['angry', 'idle'],
  charge: ['angry', 'idle'],
  punch: ['angry', 'happy', 'idle'],
  smash: ['angry', 'celebrate', 'idle'],
  hit: ['surprised', 'held', 'sad', 'idle'],
  crit: ['surprised', 'held', 'sad', 'idle'],
  block: ['angry', 'idle'],
  dodge: ['surprised', 'happy', 'idle'],
  ko: ['fake_faint', 'sad', 'tired', 'held', 'idle'],
  win: ['celebrate', 'victory', 'happy', 'dance', 'idle'],
  lose: ['sad', 'sulk', 'tired', 'idle'],
  draw: ['confused', 'awkward', 'idle'],
};

/** The animation to tell a pet for `cue`: a Live2D pet's own performance, or the best of what a pack of frames has. */
export function animForCue(cue: FightCue, live2d: boolean, has: (anim: string) => boolean): string {
  if (live2d) return fightAnim(cue);
  return FIGHT_ANIM_PREFS[cue].find(has) ?? 'idle';
}

export interface Offset {
  dx: number;
  dy: number;
}
const REST: Offset = { dx: 0, dy: 0 };

/** The default time a wind-up lasts when nothing says. */
const WIND_MS = 400;

/**
 * Where a pet's window is, relative to where it stands, `tMs` after a cue began; `d` is the way the pet faces and
 * `windMs` how long a wind-up lasts. Forward is `d`.
 */
export function nudgeAt(cue: FightCue, tMs: number, d: Dir, windMs = WIND_MS): Offset {
  const t = Math.max(0, tMs);
  switch (cue) {
    case 'guard':
    case 'lose':
    case 'draw':
      return REST;
    case 'wind':
      return { dx: -d * 10 * easeOut(t / Math.min(windMs, 320)), dy: 0 };
    case 'charge':
      return { dx: -d * 16 * easeOut(t / 500), dy: 1.5 * Math.sin(t / 11) * clamp01(t / Math.max(windMs, 1)) };
    case 'punch': {
      const p = pulse(t, 110, 90, 260);
      return { dx: d * 38 * p, dy: -8 * p };
    }
    case 'smash': {
      const p = pulse(t, 170, 180, 420);
      return { dx: d * 112 * p, dy: -14 * p };
    }
    case 'hit': {
      const p = pulse(t, 90, 70, 300);
      return { dx: -d * 24 * p, dy: -4 * p };
    }
    case 'crit':
      return { dx: -d * 56 * pulse(t, 110, 150, 420), dy: -16 * Math.sin(Math.PI * clamp01(t / 520)) };
    case 'block':
      return { dx: -d * 7 * pulse(t, 60, 60, 160), dy: 0 };
    case 'dodge':
      return { dx: -d * 54 * pulse(t, 130, 140, 280), dy: -28 * Math.sin(Math.PI * clamp01(t / 550)) };
    case 'ko':
      return { dx: -d * 80 * easeOut(t / 380), dy: 0 };
    case 'win':
      return { dx: 0, dy: -14 * Math.abs(Math.sin((Math.PI * t) / 560)) };
  }
}

/** How long after a cue begins its nudge keeps changing; infinite for one that goes on (a hop, a shaking charge). */
export function nudgeSettles(cue: FightCue, windMs = WIND_MS): number {
  switch (cue) {
    case 'guard':
    case 'lose':
    case 'draw':
      return 0;
    case 'wind':
      return Math.min(windMs, 320);
    case 'charge':
    case 'win':
      return Infinity;
    case 'punch':
      return 460;
    case 'smash':
      return 770;
    case 'hit':
      return 460;
    case 'crit':
      return 680;
    case 'block':
      return 280;
    case 'dodge':
      return 550;
    case 'ko':
      return 380;
  }
}

/** The previous cue's offset carries on and fades over this long, so a new cue never makes the window jump. */
export const BLEND_MS = 160;

/** One pet's nudges, one after another: each starts from where the last left the window. */
export class Nudger {
  private cur: { cue: FightCue; at: number; dir: Dir; windMs: number; from: Offset } | null = null;

  start(cue: FightCue, now: number, dir: Dir, windMs = WIND_MS): void {
    this.cur = { cue, at: now, dir, windMs, from: this.offset(now) };
  }

  offset(now: number): Offset {
    const c = this.cur;
    if (!c) return REST;
    const t = now - c.at;
    const own = nudgeAt(c.cue, t, c.dir, c.windMs);
    const carry = (1 - smooth(t / BLEND_MS));
    return { dx: own.dx + c.from.dx * carry, dy: own.dy + c.from.dy * carry };
  }

  /** Whether the window still has to be moved at `now`: false once the last cue has settled. */
  moving(now: number): boolean {
    const c = this.cur;
    if (!c) return false;
    return now - c.at < Math.max(BLEND_MS, nudgeSettles(c.cue, c.windMs));
  }
}
