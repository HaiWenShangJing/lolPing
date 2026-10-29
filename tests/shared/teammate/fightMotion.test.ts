import { describe, expect, it } from 'vitest';
import type { Move, Result } from '../../../src/shared/teammate/fight';
import {
  BLEND_MS, FIGHT_ANIM_PREFS, FIGHT_CUES, FIGHT_PERFORMANCES, Nudger, animForCue, fightAnim, fightGestureAt, isFightGesture,
  nudgeAt, nudgeSettles, pulse, strikeCue, takeCue, windCue, type Dir, type FightCue, type FightGesture,
} from '../../../src/shared/teammate/fightMotion';
import {
  L2D_ANIMS, L2D_RANGE, PERFORMANCES, faceOf, gestureAt, performanceFor, type Param,
} from '../../../src/shared/teammate/live2d';

const DIRS: readonly Dir[] = [1, -1];
const MOVES: readonly Move[] = ['jab', 'hook', 'upper', 'special'];
const RESULTS: readonly Result[] = ['hit', 'crit', 'block', 'dodge'];
const GESTURES = [...new Set(Object.values(FIGHT_PERFORMANCES).map((p) => p.gesture))] as FightGesture[];
const inRange = (p: Param, v: number): boolean => v >= L2D_RANGE[p][0] && v <= L2D_RANGE[p][1];
const sizeOf = (face: Partial<Record<Param, number>>): number => Math.max(0, ...Object.values(face).map((v) => Math.abs(v)));

describe('pulse', () => {
  it('is nothing before it begins and after it is over', () => {
    expect(pulse(-50, 100, 100, 100)).toBe(0);
    expect(pulse(0, 100, 100, 100)).toBe(0);
    expect(pulse(300, 100, 100, 100)).toBeCloseTo(0, 6);
    expect(pulse(9000, 100, 100, 100)).toBeCloseTo(0, 6);
  });

  it('rises, holds its peak and falls, never leaving 0 to 1', () => {
    expect(pulse(100, 100, 100, 100)).toBe(1);
    expect(pulse(150, 100, 100, 100)).toBe(1);
    let last = 0;
    for (let t = 0; t <= 100; t += 5) {
      const v = pulse(t, 100, 100, 100);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    for (let t = -10; t < 400; t += 7) {
      expect(pulse(t, 100, 100, 100)).toBeGreaterThanOrEqual(0);
      expect(pulse(t, 100, 100, 100)).toBeLessThanOrEqual(1);
    }
    expect(pulse(250, 100, 100, 100)).toBeLessThan(1);
    expect(pulse(250, 100, 100, 100)).toBeGreaterThan(0);
  });
});

describe('cues', () => {
  it('have a Live2D performance each, named for the cue', () => {
    expect(Object.keys(FIGHT_PERFORMANCES).sort()).toEqual(FIGHT_CUES.map(fightAnim).sort());
    for (const cue of FIGHT_CUES) expect(fightAnim(cue)).toBe(`fight-${cue}`);
  });

  it('are not something the host agent is told a pet can play', () => {
    for (const name of Object.keys(FIGHT_PERFORMANCES)) {
      expect(L2D_ANIMS).not.toContain(name);
      expect(PERFORMANCES[name]).toBeUndefined();
    }
  });

  it.each(Object.entries(FIGHT_PERFORMANCES))('%s only sets parameters inside the model\'s range', (_name, perf) => {
    for (const [p, v] of Object.entries(faceOf(perf)) as [Param, number][]) expect(inRange(p, v), `${p} = ${v}`).toBe(true);
    expect(perf.weight).toBeGreaterThan(0);
    expect(perf.weight).toBeLessThanOrEqual(1);
    if (perf.eyes !== undefined) expect(inRange('ParamEyeLOpen', perf.eyes)).toBe(true);
    expect(isFightGesture(perf.gesture)).toBe(true);
  });

  it('only name motions the Hiyori model has', () => {
    for (const perf of Object.values(FIGHT_PERFORMANCES)) {
      if (!perf.motion) continue;
      expect(perf.motion.group).toBe('Tap');
      expect(perf.motion.index).toBeLessThan(2);
    }
  });

  it('are played by performanceFor, and the others still are', () => {
    for (const cue of FIGHT_CUES) expect(performanceFor(fightAnim(cue))).toBe(FIGHT_PERFORMANCES[fightAnim(cue)]);
    expect(performanceFor('think')).toBe(PERFORMANCES.think);
    expect(performanceFor('dance')).toBe(PERFORMANCES.idle);
  });

  it('are told apart from the old gestures', () => {
    for (const g of GESTURES) expect(isFightGesture(g)).toBe(true);
    for (const g of ['none', 'nod', 'shake', 'bow', 'sway', 'bounce', 'tremble', 'dangle', 'look']) expect(isFightGesture(g)).toBe(false);
  });
});

describe('which cue a blow calls for', () => {
  it('has the attacker draw back and strike, harder for a special', () => {
    expect(windCue('special')).toBe('charge');
    expect(strikeCue('special')).toBe('smash');
    for (const m of ['jab', 'hook', 'upper'] as const) {
      expect(windCue(m)).toBe('wind');
      expect(strikeCue(m)).toBe('punch');
    }
  });

  it('has the one under the blow take it as it lands', () => {
    for (const m of ['jab', 'hook', 'upper'] as const) {
      expect(takeCue(m, 'hit')).toBe('hit');
      expect(takeCue(m, 'crit')).toBe('crit');
    }
    expect(takeCue('special', 'hit')).toBe('crit');
    for (const m of MOVES) {
      expect(takeCue(m, 'block')).toBe('block');
      expect(takeCue(m, 'dodge')).toBe('dodge');
    }
  });

  it('is always a cue there is', () => {
    for (const m of MOVES) {
      expect(FIGHT_CUES).toContain(windCue(m));
      expect(FIGHT_CUES).toContain(strikeCue(m));
      for (const r of RESULTS) expect(FIGHT_CUES).toContain(takeCue(m, r));
    }
  });
});

describe('fightGestureAt', () => {
  it.each(GESTURES)('%s stays inside the model\'s range and finite, either way round', (g) => {
    for (const d of DIRS) {
      for (let t = 0; t < 12_000; t += 31) {
        const s = fightGestureAt(g, t, d);
        for (const [p, v] of Object.entries(s.face) as [Param, number][]) {
          expect(Number.isFinite(v), `${p} at ${t}`).toBe(true);
          expect(inRange(p, v), `${p} = ${v} at ${t}`).toBe(true);
        }
        expect(Number.isFinite(s.lift)).toBe(true);
        expect(Math.abs(s.lift)).toBeLessThanOrEqual(20);
      }
    }
  });

  it.each(GESTURES)('%s eases in, so a new cue does not jerk the character', (g) => {
    for (const d of DIRS) {
      expect(sizeOf(fightGestureAt(g, 0, d).face)).toBeCloseTo(0, 5);
      expect(fightGestureAt(g, 0, d).lift).toBeCloseTo(0, 5);
    }
  });

  it('mirrors with the way the pet faces', () => {
    for (const g of ['guard', 'wind', 'lunge', 'smash', 'recoil', 'stagger', 'dodge'] as const) {
      for (const t of [90, 250, 600, 1500]) {
        const right = fightGestureAt(g, t, 1).face;
        const left = fightGestureAt(g, t, -1).face;
        for (const p of ['ParamAngleX', 'ParamAngleZ', 'ParamBodyAngleZ', 'ParamBodyAngleX'] as const) {
          expect(left[p] ?? 0, `${g} ${p} at ${t}`).toBeCloseTo(-(right[p] ?? 0), 5);
        }
        expect(fightGestureAt(g, t, -1).lift).toBeCloseTo(fightGestureAt(g, t, 1).lift, 5);
      }
    }
  });

  it('cheers and shrugs the same whichever way the pet faces', () => {
    for (const g of ['cheer', 'shrug'] as const) {
      for (const t of [90, 250, 600, 1500]) expect(fightGestureAt(g, t, -1)).toEqual(fightGestureAt(g, t, 1));
    }
  });

  it('leans into a punch and away from a blow', () => {
    expect(fightGestureAt('lunge', 150, 1).face.ParamAngleX).toBeGreaterThan(5);
    expect(fightGestureAt('lunge', 150, -1).face.ParamAngleX).toBeLessThan(-5);
    expect(fightGestureAt('recoil', 150, 1).face.ParamAngleX).toBeLessThan(-5);
    expect(fightGestureAt('recoil', 150, -1).face.ParamAngleX).toBeGreaterThan(5);
    expect(fightGestureAt('stagger', 200, 1).face.ParamAngleX).toBeLessThan(-5);
    expect(fightGestureAt('wind', 400, 1).face.ParamAngleX).toBeLessThan(-5);
  });

  it('hits harder for a smash than for a punch', () => {
    expect(Math.abs(fightGestureAt('smash', 300, 1).face.ParamAngleX ?? 0))
      .toBeGreaterThan(Math.abs(fightGestureAt('lunge', 150, 1).face.ParamAngleX ?? 0));
    expect(fightGestureAt('smash', 380, 1).lift).toBeGreaterThan(fightGestureAt('lunge', 235, 1).lift);
  });

  it('goes back to rest after a blow, a flinch and a dodge', () => {
    for (const g of ['lunge', 'smash', 'recoil', 'stagger', 'brace', 'dodge'] as const) {
      const s = fightGestureAt(g, 3000, 1);
      expect(sizeOf(s.face), g).toBeCloseTo(0, 3);
      expect(s.lift, g).toBeCloseTo(0, 3);
    }
  });

  it('slumps and stays down once knocked out', () => {
    const s = fightGestureAt('slump', 3000, 1);
    expect(s.face.ParamAngleY).toBeLessThan(-15);
    expect(s.lift).toBeLessThan(-8);
    expect(fightGestureAt('slump', 6000, 1).face.ParamAngleY).toBeLessThan(-15);
  });

  it('hops and shakes without end while cheering and charging', () => {
    const lifts = Array.from({ length: 60 }, (_, i) => fightGestureAt('cheer', 400 + i * 40, 1).lift);
    expect(Math.max(...lifts)).toBeGreaterThan(8);
    expect(Math.min(...lifts)).toBeLessThan(2);
    const xs = Array.from({ length: 60 }, (_, i) => fightGestureAt('charge', 900 + i * 7, 1).face.ParamAngleX ?? 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.5);
  });

  it('bobs on guard in a steady loop', () => {
    for (const t of [300, 450, 700]) {
      expect(fightGestureAt('guard', t, 1).lift).toBeCloseTo(fightGestureAt('guard', t + 640 * 3, 1).lift, 5);
    }
    expect(fightGestureAt('guard', 320, 1).lift).toBeGreaterThan(1);
  });
});

describe('gestureAt', () => {
  it('plays the fight gestures, facing the way it is told', () => {
    expect(gestureAt('lunge', 150, 1)).toEqual(fightGestureAt('lunge', 150, 1));
    expect(gestureAt('lunge', 150, -1)).toEqual(fightGestureAt('lunge', 150, -1));
    expect(gestureAt('slump', 900)).toEqual(fightGestureAt('slump', 900, 1));
  });

  it('leaves the old gestures as they were, whichever way', () => {
    for (const g of ['nod', 'shake', 'bow', 'sway', 'bounce', 'tremble', 'dangle', 'look'] as const) {
      expect(gestureAt(g, 700, -1)).toEqual(gestureAt(g, 700));
    }
  });
});

describe('animForCue', () => {
  it('has a Live2D pet play its own performance whatever the pack has', () => {
    for (const cue of FIGHT_CUES) expect(animForCue(cue, true, () => false)).toBe(fightAnim(cue));
  });

  it('has a pack of frames play the best of what it has', () => {
    expect(animForCue('hit', false, (a) => a === 'surprised' || a === 'sad')).toBe('surprised');
    expect(animForCue('hit', false, (a) => a === 'sad')).toBe('sad');
    expect(animForCue('ko', false, (a) => a === 'fake_faint' || a === 'sad')).toBe('fake_faint');
    expect(animForCue('win', false, (a) => a === 'dance' || a === 'happy')).toBe('happy');
    expect(animForCue('guard', false, (a) => a === 'angry')).toBe('angry');
  });

  it('falls back to the idle', () => {
    for (const cue of FIGHT_CUES) expect(animForCue(cue, false, () => false)).toBe('idle');
  });

  it('has a list for every cue, ending in the idle', () => {
    for (const cue of FIGHT_CUES) {
      const prefs = FIGHT_ANIM_PREFS[cue];
      expect(prefs.length, cue).toBeGreaterThan(0);
      expect(prefs[prefs.length - 1], cue).toBe('idle');
    }
  });
});

describe('nudgeAt', () => {
  it.each(FIGHT_CUES)('%s starts where the pet stands, so the window never jumps', (cue) => {
    for (const d of DIRS) {
      const o = nudgeAt(cue, 0, d);
      expect(o.dx).toBeCloseTo(0, 6);
      expect(o.dy).toBeCloseTo(0, 6);
    }
  });

  it.each(FIGHT_CUES)('%s stays finite and inside the ring\'s room', (cue) => {
    for (const d of DIRS) {
      for (let t = 0; t < 8000; t += 17) {
        const o = nudgeAt(cue, t, d, 700);
        expect(Number.isFinite(o.dx) && Number.isFinite(o.dy)).toBe(true);
        expect(Math.abs(o.dx), `${cue} dx at ${t}`).toBeLessThanOrEqual(120);
        expect(Math.abs(o.dy), `${cue} dy at ${t}`).toBeLessThanOrEqual(30);
      }
    }
  });

  it('lunges forward for a blow and is thrown back by one', () => {
    expect(nudgeAt('punch', 110, 1).dx).toBeGreaterThan(20);
    expect(nudgeAt('punch', 110, -1).dx).toBeLessThan(-20);
    expect(nudgeAt('smash', 170, 1).dx).toBeGreaterThan(nudgeAt('punch', 110, 1).dx);
    expect(nudgeAt('hit', 90, 1).dx).toBeLessThan(-10);
    expect(nudgeAt('crit', 110, 1).dx).toBeLessThan(nudgeAt('hit', 90, 1).dx);
    expect(nudgeAt('dodge', 130, 1).dx).toBeLessThan(-30);
    expect(nudgeAt('wind', 300, -1).dx).toBeGreaterThan(5);
  });

  it('is the same either way round, mirrored', () => {
    for (const cue of FIGHT_CUES) {
      for (const t of [60, 200, 500, 1400]) {
        const right = nudgeAt(cue, t, 1);
        const left = nudgeAt(cue, t, -1);
        expect(left.dx, `${cue} at ${t}`).toBeCloseTo(-right.dx, 6);
        expect(left.dy, `${cue} at ${t}`).toBeCloseTo(right.dy, 6);
      }
    }
  });

  it('stops changing once it has settled, and a blow lands the pet back where it stood', () => {
    for (const cue of FIGHT_CUES) {
      const settles = nudgeSettles(cue);
      if (!Number.isFinite(settles)) continue;
      const a = nudgeAt(cue, settles + 1, 1);
      const b = nudgeAt(cue, settles + 4000, 1);
      expect(a.dx, cue).toBeCloseTo(b.dx, 1);
      expect(a.dy, cue).toBeCloseTo(b.dy, 1);
    }
    for (const cue of ['punch', 'smash', 'hit', 'crit', 'block', 'dodge'] as const) {
      const o = nudgeAt(cue, nudgeSettles(cue) + 1, 1);
      expect(Math.abs(o.dx), cue).toBeLessThan(1);
      expect(Math.abs(o.dy), cue).toBeLessThan(1);
    }
  });

  it('takes the wind-up\'s length into account, up to a point', () => {
    expect(nudgeSettles('wind', 200)).toBe(200);
    expect(nudgeSettles('wind', 900)).toBe(320);
    expect(nudgeAt('wind', 200, 1, 200).dx).toBeCloseTo(-10, 5);
  });

  it('never settles for the cues that go on', () => {
    expect(nudgeSettles('charge')).toBe(Infinity);
    expect(nudgeSettles('win')).toBe(Infinity);
    expect(nudgeSettles('guard')).toBe(0);
  });
});

describe('Nudger', () => {
  it('rests before any cue', () => {
    const n = new Nudger();
    expect(n.offset(5000)).toEqual({ dx: 0, dy: 0 });
    expect(n.moving(5000)).toBe(false);
  });

  it('moves a window for as long as its cue does, and then no more', () => {
    const n = new Nudger();
    n.start('punch', 1000, 1);
    expect(n.moving(1000)).toBe(true);
    expect(n.moving(1300)).toBe(true);
    expect(n.moving(1000 + nudgeSettles('punch'))).toBe(false);
    expect(n.offset(1000 + 110).dx).toBeGreaterThan(20);
  });

  it('carries on from where the last cue left the window, and fades that out', () => {
    const n = new Nudger();
    n.start('smash', 0, 1);
    const before = n.offset(300);
    expect(before.dx).toBeGreaterThan(30);
    n.start('guard', 300, 1);
    const after = n.offset(300);
    expect(after.dx).toBeCloseTo(before.dx, 6);
    expect(after.dy).toBeCloseTo(before.dy, 6);
    const half = n.offset(300 + BLEND_MS / 2);
    expect(half.dx).toBeLessThan(before.dx);
    expect(half.dx).toBeGreaterThan(0);
    expect(n.offset(300 + BLEND_MS).dx).toBeCloseTo(0, 6);
  });

  it('keeps moving the window while it charges or cheers', () => {
    const n = new Nudger();
    n.start('charge', 0, 1, 1400);
    expect(n.moving(60_000)).toBe(true);
    n.start('win', 70_000, -1);
    expect(n.moving(900_000)).toBe(true);
    n.start('guard', 1_000_000, 1);
    expect(n.moving(1_000_000 + BLEND_MS - 1)).toBe(true);
    expect(n.moving(1_000_000 + BLEND_MS)).toBe(false);
  });

  it('does not jump from one cue to the next', () => {
    const n = new Nudger();
    const cues: FightCue[] = ['guard', 'wind', 'punch', 'hit', 'crit', 'dodge', 'guard', 'charge', 'smash', 'ko', 'win'];
    let now = 0;
    let last = n.offset(now);
    for (const cue of cues) {
      n.start(cue, now, 1);
      const o = n.offset(now);
      expect(Math.abs(o.dx - last.dx), `${cue} at ${now}`).toBeLessThan(1e-6);
      expect(Math.abs(o.dy - last.dy), `${cue} at ${now}`).toBeLessThan(1e-6);
      now += 137;
      last = n.offset(now);
    }
  });
});
