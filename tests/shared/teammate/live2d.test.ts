import { describe, expect, it } from 'vitest';
import {
  BLEND_TAU_MS, blinkFactor, clampParam, faceOf, gazeToward, gestureAt, GAZE_REACH, L2D_ANIMS, L2D_RANGE, mouthAt, nextBlink, performanceFor,
  PERFORMANCES, pickPoke, POKES, POKE_MS, stepBlend, talkMs, walkAt, type Gesture, type Param,
} from '../../../src/shared/teammate/live2d';
import { LIFE_ANIMS } from '../../../src/shared/teammate/life';
import { MOOD_ANIMS } from '../../../src/shared/teammate/mood';
import { PET_FACES, PET_POSES, PET_RESTS } from '../../../src/shared/teammate/pet';

const inRange = (p: Param, v: number): boolean => v >= L2D_RANGE[p][0] && v <= L2D_RANGE[p][1];
const GESTURES: readonly Gesture[] = ['none', 'nod', 'shake', 'bow', 'sway', 'bounce', 'tremble', 'dangle', 'look'];

describe('PERFORMANCES', () => {
  it.each(Object.entries(PERFORMANCES))('%s only sets parameters inside the model\'s range', (_name, perf) => {
    for (const [p, v] of Object.entries(faceOf(perf)) as [Param, number][]) expect(inRange(p, v), `${p} = ${v}`).toBe(true);
    expect(perf.weight).toBeGreaterThanOrEqual(0);
    expect(perf.weight).toBeLessThanOrEqual(1);
    if (perf.eyes !== undefined) expect(inRange('ParamEyeLOpen', perf.eyes)).toBe(true);
  });

  it('holds nothing when the weight is nothing, so the model\'s own idle shows', () => {
    for (const perf of Object.values(PERFORMANCES)) if (perf.weight === 0) expect(perf.face).toEqual({});
  });

  it('names motions the Hiyori model has', () => {
    const groups: Record<string, number> = { Idle: 3, Flick: 1, FlickDown: 1, FlickUp: 1, Tap: 2, 'Tap@Body': 1, 'Flick@Body': 1 };
    for (const perf of Object.values(PERFORMANCES)) {
      if (!perf.motion) continue;
      expect(groups[perf.motion.group], perf.motion.group).toBeGreaterThan(perf.motion.index);
    }
  });

  it('has an animation for every pose, rest, life show, mood and poke the pet can be asked for', () => {
    const wanted = [
      ...PET_POSES, ...PET_RESTS.hiyori, ...LIFE_ANIMS.hiyori, ...Object.values(MOOD_ANIMS.hiyori), ...POKES,
    ];
    for (const name of wanted) expect(L2D_ANIMS, name).toContain(name);
  });

  it('only uses gestures gestureAt knows', () => {
    for (const perf of Object.values(PERFORMANCES)) expect(GESTURES).toContain(perf.gesture);
  });

  it('shows thinking dots only while thinking', () => {
    expect(Object.entries(PERFORMANCES).filter(([, p]) => p.dots).map(([n]) => n)).toEqual(['think']);
  });

  it('plays an unknown animation as the idle', () => {
    expect(performanceFor('dance')).toBe(PERFORMANCES.idle);
    expect(performanceFor('think')).toBe(PERFORMANCES.think);
  });
});

describe('faceOf', () => {
  it('puts the eyes on both eyes, unless the face sets one itself', () => {
    expect(faceOf({ motion: null, face: { ParamCheek: 1 }, weight: 1, eyes: 0.5, gesture: 'none' })).toEqual({
      ParamCheek: 1, ParamEyeLOpen: 0.5, ParamEyeROpen: 0.5,
    });
    expect(faceOf({ motion: null, face: { ParamEyeLOpen: 0 }, weight: 1, eyes: 0.5, gesture: 'none' })).toEqual({
      ParamEyeLOpen: 0, ParamEyeROpen: 0.5,
    });
    expect(faceOf(PERFORMANCES.idle)).toEqual({});
  });
});

describe('clampParam', () => {
  it('keeps a value inside its parameter\'s range', () => {
    expect(clampParam('ParamMouthOpenY', 3)).toBe(1);
    expect(clampParam('ParamMouthOpenY', -3)).toBe(0);
    expect(clampParam('ParamMouthForm', -5)).toBe(-2);
    expect(clampParam('ParamAngleX', 12)).toBe(12);
  });
});

describe('pickPoke', () => {
  it('picks one of the pokes, never the last one', () => {
    for (const last of POKES) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
        const p = pickPoke(last, () => r);
        expect(POKES).toContain(p);
        expect(p).not.toBe(last);
      }
    }
    expect(pickPoke(null, () => 0)).toBe(POKES[0]);
    expect(pickPoke(null, () => 0.999999)).toBe(POKES[POKES.length - 1]);
  });

  it('lasts long enough to see', () => {
    expect(POKE_MS).toBeGreaterThanOrEqual(1500);
  });
});

describe('gestureAt', () => {
  const sizeOf = (face: Partial<Record<Param, number>>): number => Math.max(0, ...Object.values(face).map((v) => Math.abs(v)));

  it.each(GESTURES)('%s stays inside the model\'s range for the first minute', (g) => {
    for (let t = 0; t < 60_000; t += 37) {
      const s = gestureAt(g, t);
      for (const [p, v] of Object.entries(s.face) as [Param, number][]) expect(inRange(p, v), `${p} = ${v} at ${t}`).toBe(true);
      expect(s.lift).toBeGreaterThanOrEqual(0);
    }
  });

  it('does nothing for none', () => {
    expect(gestureAt('none', 1234)).toEqual({ face: {}, lift: 0 });
  });

  it('eases in, so a new gesture does not jerk the character', () => {
    for (const g of GESTURES) {
      if (g === 'none') continue;
      expect(sizeOf(gestureAt(g, 0).face), g).toBeCloseTo(0, 5);
      expect(gestureAt(g, 0).lift, g).toBeCloseTo(0, 5);
    }
  });

  it('nods down and comes back up', () => {
    expect(gestureAt('nod', 450).face.ParamAngleY).toBeLessThan(-5);
    expect(gestureAt('nod', 900).face.ParamAngleY ?? 0).toBeCloseTo(0, 1);
  });

  it('bounces off the floor and lands again', () => {
    expect(gestureAt('bounce', 210).lift).toBeGreaterThan(3);
    expect(gestureAt('bounce', 420).lift).toBeCloseTo(0, 1);
  });

  it('shakes to both sides', () => {
    const xs = Array.from({ length: 40 }, (_, i) => gestureAt('shake', 300 + i * 30).face.ParamAngleX ?? 0);
    expect(Math.min(...xs)).toBeLessThan(-5);
    expect(Math.max(...xs)).toBeGreaterThan(5);
  });
});

describe('walkAt', () => {
  it('leans the way it goes', () => {
    expect(walkAt(500, 1).face.ParamAngleZ).toBeGreaterThan(0);
    expect(walkAt(500, -1).face.ParamAngleZ).toBeLessThan(0);
  });

  it('hops with each step and is on the floor between them', () => {
    expect(walkAt(150, 1).lift).toBeGreaterThan(5);
    expect(walkAt(300, 1).lift).toBeCloseTo(0, 1);
  });

  it('starts from standing', () => {
    const s = walkAt(0, 1);
    expect(s.lift).toBeCloseTo(0, 5);
    expect(s.face.ParamAngleZ).toBeCloseTo(0, 5);
  });

  it('stays inside the model\'s range', () => {
    for (let t = 0; t < 20_000; t += 17) {
      for (const dir of [1, -1] as const) {
        for (const [p, v] of Object.entries(walkAt(t, dir).face) as [Param, number][]) expect(inRange(p, v), p).toBe(true);
      }
    }
  });

  it('runs the way the art faces for a pet that faces right', () => {
    expect(PET_FACES.hiyori).toBe('right');
  });
});

describe('gazeToward', () => {
  const from = { x: 500, y: 500 };

  it('looks at the pointer: right is positive x, up is positive y', () => {
    expect(gazeToward(from, { x: 700, y: 500 }).x).toBeGreaterThan(0);
    expect(gazeToward(from, { x: 300, y: 500 }).x).toBeLessThan(0);
    expect(gazeToward(from, { x: 500, y: 300 }).y).toBeGreaterThan(0);
    expect(gazeToward(from, { x: 500, y: 700 }).y).toBeLessThan(0);
  });

  it('is the edge at and beyond the reach', () => {
    expect(gazeToward(from, { x: 500 + GAZE_REACH.x, y: 500 })).toEqual({ x: 1, y: 0 });
    expect(gazeToward(from, { x: -9000, y: 9000 })).toEqual({ x: -1, y: -1 });
  });

  it('looks straight ahead at a pointer that is nearly on it', () => {
    expect(gazeToward(from, { x: 510, y: 490 })).toEqual({ x: 0, y: 0 });
  });

  it('rounds to a hundredth, so a still pointer sends nothing new', () => {
    const g = gazeToward(from, { x: 612, y: 531 });
    expect(Math.round(g.x * 100) / 100).toBe(g.x);
    expect(Math.round(g.y * 100) / 100).toBe(g.y);
  });
});

describe('blinking', () => {
  it('comes again in two to six seconds', () => {
    expect(nextBlink(1000, () => 0)).toBe(3200);
    expect(nextBlink(1000, () => 1)).toBe(7000);
  });

  it('closes the eyes and opens them again, and is nothing outside it', () => {
    expect(blinkFactor(-5)).toBe(1);
    expect(blinkFactor(0)).toBeCloseTo(1, 5);
    expect(blinkFactor(85)).toBeCloseTo(0, 5);
    expect(blinkFactor(169)).toBeGreaterThan(0.97);
    expect(blinkFactor(170)).toBe(1);
    expect(blinkFactor(5000)).toBe(1);
  });
});

describe('speaking', () => {
  it('takes about as long as the line, within a beat and a breath', () => {
    expect(talkMs('')).toBe(1200);
    expect(talkMs('好')).toBe(1200);
    expect(talkMs('x'.repeat(40))).toBe(2800);
    expect(talkMs('x'.repeat(4000))).toBe(9000);
  });

  it('counts a character, not a UTF-16 unit', () => {
    expect(talkMs('😀'.repeat(40))).toBe(talkMs('x'.repeat(40)));
  });

  it('moves the mouth only while it speaks', () => {
    expect(mouthAt(-1, 2000)).toBeNull();
    expect(mouthAt(2000, 2000)).toBeNull();
    expect(mouthAt(2500, 2000)).toBeNull();
    expect(mouthAt(1000, 2000)).not.toBeNull();
  });

  it('opens and closes, inside the model\'s range, and closes at the end', () => {
    const opens: number[] = [];
    for (let t = 0; t < 3000; t += 10) {
      const m = mouthAt(t, 3000);
      expect(m).not.toBeNull();
      opens.push(m?.open ?? 0);
      expect(inRange('ParamMouthOpenY', m?.open ?? 0)).toBe(true);
      expect(inRange('ParamMouthForm', m?.form ?? 0)).toBe(true);
    }
    expect(Math.max(...opens)).toBeGreaterThan(0.4);
    expect(Math.min(...opens.slice(100, 200))).toBeLessThan(0.1);
    expect(mouthAt(2995, 3000)?.open).toBeLessThan(0.1);
    expect(mouthAt(0, 3000)?.open).toBe(0);
  });
});

describe('stepBlend', () => {
  it('eases a new face in from nothing, without a jump', () => {
    const first = stepBlend({}, { ParamCheek: 1 }, 0.8, 16);
    expect(first.ParamCheek?.weight).toBeGreaterThan(0);
    expect(first.ParamCheek?.weight).toBeLessThan(0.1);
    expect(first.ParamCheek?.value).toBe(1);
    let blend = first;
    for (let i = 0; i < 60; i++) blend = stepBlend(blend, { ParamCheek: 1 }, 0.8, 16);
    expect(blend.ParamCheek?.weight).toBeCloseTo(0.8, 1);
  });

  it('moves a held value toward a new one', () => {
    let blend = stepBlend({}, { ParamAngleY: 0 }, 1, 16);
    for (let i = 0; i < 100; i++) blend = stepBlend(blend, { ParamAngleY: 10 }, 1, 16);
    expect(blend.ParamAngleY?.value).toBeCloseTo(10, 1);
  });

  it('keeps the last value while a parameter that left fades out, then drops it', () => {
    let blend = stepBlend({}, { ParamCheek: 0.6 }, 1, 16);
    for (let i = 0; i < 60; i++) blend = stepBlend(blend, { ParamCheek: 0.6 }, 1, 16);
    blend = stepBlend(blend, {}, 0, 16);
    expect(blend.ParamCheek?.value).toBeCloseTo(0.6, 3);
    expect(blend.ParamCheek?.weight).toBeLessThan(1);
    for (let i = 0; i < 200; i++) blend = stepBlend(blend, {}, 0, 16);
    expect(blend.ParamCheek).toBeUndefined();
  });

  it('follows the time constant', () => {
    let blend = stepBlend({}, { ParamCheek: 1 }, 1, 0);
    blend = stepBlend(blend, { ParamCheek: 1 }, 1, BLEND_TAU_MS);
    expect(blend.ParamCheek?.weight).toBeCloseTo(1 - Math.exp(-1), 3);
    blend = stepBlend(blend, { ParamCheek: 1 }, 1, 16);
    expect(blend.ParamCheek?.weight ?? 0).toBeLessThan(0.9);
  });

  it('clamps a goal that is out of range', () => {
    const blend = stepBlend({}, { ParamMouthOpenY: 5 }, 1, 16);
    expect(blend.ParamMouthOpenY?.value).toBe(1);
  });

  it('treats a negative step as none', () => {
    const a = stepBlend({ ParamCheek: { value: 0.3, weight: 0.5 } }, { ParamCheek: 1 }, 1, -50);
    expect(a.ParamCheek).toEqual({ value: 0.3, weight: 0.5 });
  });
});
