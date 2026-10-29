import { describe, expect, it } from 'vitest';
import { L2D_RANGE, type Param, type Sway } from '../../../src/shared/teammate/live2d';
import { MOOD_ANIMS } from '../../../src/shared/teammate/mood';
import { PET_IDS, PET_RESTS } from '../../../src/shared/teammate/pet';
import {
  CUES, CUE_SPECS, FPS_STEPS, cueAnim, gazeAt, pickFps, sceneGestureAt, spriteMove, type SceneGesture,
} from '../../../src/shared/teammate/sceneMotion';

const GESTURES: SceneGesture[] = [
  'none', 'nod', 'shake', 'bow', 'sway', 'bounce', 'tremble', 'dangle', 'look', 'lean', 'slam', 'shuffle', 'cheer', 'slump',
];

const inRange = (sway: Sway): void => {
  for (const [p, v] of Object.entries(sway.face) as [Param, number][]) {
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(L2D_RANGE[p][0]);
    expect(v).toBeLessThanOrEqual(L2D_RANGE[p][1]);
  }
  expect(Number.isFinite(sway.lift)).toBe(true);
};

describe('sceneGestureAt', () => {
  it('stays inside what the model allows, and finite, at any moment of any gesture', () => {
    for (const g of GESTURES) {
      for (let t = 0; t <= 6000; t += 37) inRange(sceneGestureAt(g, t));
    }
  });

  it('starts every gesture from rest, so a new cue does not jerk the pet', () => {
    for (const g of GESTURES) {
      const at0 = sceneGestureAt(g, 0);
      expect(Math.abs(at0.lift)).toBeLessThan(0.01);
      for (const v of Object.values(at0.face)) expect(Math.abs(v ?? 0)).toBeLessThan(0.01);
    }
  });

  it('leans forward to draw and comes back up', () => {
    const mid = sceneGestureAt('lean', 325);
    expect(mid.face.ParamBodyAngleY).toBeLessThan(-4);
    expect(mid.face.ParamAngleY).toBeLessThan(-6);
    expect(mid.lift).toBeLessThan(0);
    const end = sceneGestureAt('lean', 650);
    expect(Math.abs(end.face.ParamBodyAngleY ?? 0)).toBeLessThan(0.01);
  });

  it('slams a tile down fast, holds, and lets go', () => {
    const hit = sceneGestureAt('slam', 150);
    expect(hit.face.ParamAngleY).toBeLessThan(-9);
    expect(sceneGestureAt('slam', 200).face.ParamAngleY).toBe(hit.face.ParamAngleY);
    expect(Math.abs(sceneGestureAt('slam', 600).face.ParamAngleY ?? 0)).toBeLessThan(0.01);
    expect(sceneGestureAt('slam', 60).face.ParamAngleY ?? 0).toBeGreaterThan(hit.face.ParamAngleY ?? 0);
  });

  it('shuffles from side to side, and a cheer jumps off the seat higher than a bounce', () => {
    const xs = [];
    for (let t = 300; t < 1500; t += 20) xs.push(sceneGestureAt('shuffle', t).face.ParamBodyAngleX ?? 0);
    expect(Math.max(...xs)).toBeGreaterThan(3);
    expect(Math.min(...xs)).toBeLessThan(-3);
    let cheer = 0;
    let bounce = 0;
    for (let t = 0; t < 1700; t += 10) {
      cheer = Math.max(cheer, sceneGestureAt('cheer', t).lift);
      bounce = Math.max(bounce, sceneGestureAt('bounce', t).lift);
    }
    expect(cheer).toBeGreaterThan(14);
    expect(cheer).toBeGreaterThan(bounce);
  });

  it('slumps down and stays down', () => {
    const a = sceneGestureAt('slump', 700);
    const b = sceneGestureAt('slump', 5000);
    expect(a.face.ParamAngleY).toBeLessThan(-12);
    expect(b.face.ParamAngleY).toBe(a.face.ParamAngleY);
    expect(b.lift).toBeLessThan(0);
  });

  it('lifts the desktop gestures to the size of the scene, and leaves their face alone', () => {
    const base = sceneGestureAt('bounce', 210);
    expect(base.lift).toBeGreaterThan(5);
    expect(base.face.ParamAngleZ).toBeDefined();
  });
});

describe('spriteMove', () => {
  it('leaves a resting picture where it is', () => {
    const m = spriteMove({ face: {}, lift: 0 });
    expect(m.dx).toBeCloseTo(0);
    expect(m.dy).toBeCloseTo(0);
    expect(m.rot).toBeCloseTo(0);
    expect(m.sx).toBe(1);
    expect(m.sy).toBe(1);
  });

  it('lifts a picture up and puts it down, on a screen where down is positive', () => {
    expect(spriteMove({ face: {}, lift: 10 }).dy).toBe(-10);
    expect(spriteMove({ face: {}, lift: -4 }).dy).toBe(4);
  });

  it('moves it with the lean, turns it with the tilt, and squashes it with a bow', () => {
    expect(spriteMove({ face: { ParamBodyAngleX: 5 }, lift: 0 }).dx).toBeGreaterThan(5);
    expect(spriteMove({ face: { ParamBodyAngleX: -5 }, lift: 0 }).dx).toBeLessThan(-5);
    expect(spriteMove({ face: { ParamAngleZ: 8 }, lift: 0 }).rot).toBeGreaterThan(0);
    expect(spriteMove({ face: { ParamAngleZ: -8 }, lift: 0 }).rot).toBeLessThan(0);
    const bow = spriteMove({ face: { ParamAngleY: -10, ParamBodyAngleY: -8 }, lift: 0 });
    expect(bow.sy).toBeLessThan(1);
    expect(bow.sx).toBeGreaterThan(1);
    const back = spriteMove({ face: { ParamAngleY: 10 }, lift: 0 });
    expect(back.sy).toBeGreaterThan(1);
    expect(back.sx).toBe(1);
  });

  it('keeps every gesture to a small, finite nudge', () => {
    for (const g of GESTURES) {
      for (let t = 0; t <= 6000; t += 53) {
        const m = spriteMove(sceneGestureAt(g, t));
        for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(m.dx)).toBeLessThan(30);
        expect(Math.abs(m.dy)).toBeLessThan(40);
        expect(Math.abs(m.rot)).toBeLessThan(0.2);
        expect(m.sy).toBeGreaterThan(0.85);
        expect(m.sy).toBeLessThan(1.15);
        expect(m.sx).toBeGreaterThan(0.9);
        expect(m.sx).toBeLessThan(1.15);
      }
    }
  });
});

describe('cues', () => {
  it('give every cue a spec, with a time that is zero only for sitting', () => {
    for (const c of CUES) {
      const s = CUE_SPECS[c];
      expect(GESTURES).toContain(s.gesture);
      if (c === 'sit') expect(s.ms).toBe(0);
      else expect(s.ms).toBeGreaterThanOrEqual(600);
    }
  });

  it('sit at rest in each pet\'s own rest animation', () => {
    const only = (names: string[]) => (a: string) => names.includes(a);
    for (const pet of PET_IDS) {
      expect(cueAnim(pet, 'sit', only([]))).toBe(PET_RESTS[pet][0]);
    }
  });

  it('play a pet\'s own animation for a mood when its pack has it', () => {
    const has = (a: string): boolean => a === MOOD_ANIMS.naiwa.sad || a === 'think';
    expect(cueAnim('naiwa', 'lose', has)).toBe(MOOD_ANIMS.naiwa.sad);
    expect(cueAnim('airi', 'win', (a) => a === MOOD_ANIMS.airi.happy)).toBe(MOOD_ANIMS.airi.happy);
  });

  it('use the animation a cue names before any mood, and fall back to the pose every pack has', () => {
    expect(cueAnim('airi', 'think', (a) => a === 'think')).toBe('think');
    expect(cueAnim('mao', 'win', (a) => a === 'happy')).toBe('happy');
    expect(cueAnim('whale', 'lose', (a) => a === 'think')).toBe('think');
    expect(cueAnim('whale', 'win', (a) => a === 'happy')).toBe('happy');
  });

  it('never name an animation that is not there for a pack that has the five poses', () => {
    for (const pet of PET_IDS) {
      const names = new Set<string>([...PET_RESTS[pet], 'idle', 'walk', 'think', 'happy', 'held']);
      for (const c of CUES) expect(names.has(cueAnim(pet, c, (a) => names.has(a)))).toBe(true);
    }
  });
});

describe('pickFps', () => {
  it('keeps the rate while frames keep up with it', () => {
    expect(pickFps(60, 12)).toBe(60);
    expect(pickFps(60, 16.7)).toBe(60);
    expect(pickFps(30, 30)).toBe(30);
  });

  it('steps down when frames take a third longer than the rate allows', () => {
    expect(pickFps(60, 40)).toBe(30);
    expect(pickFps(30, 60)).toBe(20);
  });

  it('never goes under the last step, off the steps, or back up', () => {
    expect(pickFps(20, 500)).toBe(20);
    expect(pickFps(45, 500)).toBe(45);
    expect(pickFps(30, 1)).toBe(30);
    expect(FPS_STEPS).toEqual([...FPS_STEPS].sort((a, b) => b - a));
  });
});

describe('gazeAt', () => {
  it('looks toward the target, as far as the edge', () => {
    expect(gazeAt(500, 500).x).toBe(0);
    expect(gazeAt(500, 725).x).toBe(0.5);
    expect(gazeAt(500, -2000).x).toBe(-1);
    expect(gazeAt(500, 4000).x).toBe(1);
  });

  it('looks a little down at the table', () => {
    expect(gazeAt(100, 900).y).toBeLessThan(0);
  });
});
