import { describe, expect, it, vi } from 'vitest';
import { DROP, Tweens, easeInOut, easeOut, easeOutBack, linear, tumbleAt } from '../../src/renderer/scene/tween';

describe('tumbleAt', () => {
  it('starts high up and far away, and ends lying still where it lands', () => {
    const a = tumbleAt(0);
    expect(a.lift).toBeCloseTo(DROP.height, 9);
    expect(a.p).toBeCloseTo(0, 9);
    expect(a.spin).toBeCloseTo(1, 9);
    const z = tumbleAt(1);
    expect(z.lift).toBe(0);
    expect(z.p).toBeCloseTo(1, 9);
    expect(z.spin).toBeCloseTo(0, 9);
  });

  it('falls until it first lands at 0.4, then bounces to the heights of DROP and lands again', () => {
    let last = Infinity;
    for (let k = 0; k <= 0.4; k += 0.02) {
      const { lift } = tumbleAt(k);
      expect(lift).toBeLessThanOrEqual(last);
      last = lift;
    }
    expect(tumbleAt(0.4).lift).toBeCloseTo(0, 9);
    expect(tumbleAt(0.525).lift).toBeCloseTo(DROP.bounces[0] ?? 0, 9);
    expect(tumbleAt(0.65).lift).toBeCloseTo(0, 9);
    expect(tumbleAt(0.725).lift).toBeCloseTo(DROP.bounces[1] ?? 0, 9);
    expect(tumbleAt(0.8).lift).toBeCloseTo(0, 9);
  });

  it('never goes under the table, and keeps still once settled', () => {
    for (let k = -0.2; k <= 1.2; k += 0.01) expect(tumbleAt(k).lift).toBeGreaterThanOrEqual(0);
    for (const k of [0.8, 0.9, 1, 1.5]) {
      expect(tumbleAt(k).lift).toBe(0);
      expect(tumbleAt(k).spin).toBeCloseTo(0, 9);
    }
  });

  it('keeps moving towards where it lands and tumbles less and less', () => {
    let p = -1;
    let spin = 2;
    for (let k = 0; k <= 1; k += 0.02) {
      const t = tumbleAt(k);
      expect(t.p).toBeGreaterThanOrEqual(p);
      expect(t.spin).toBeLessThanOrEqual(spin);
      p = t.p;
      spin = t.spin;
    }
  });
});

describe('eases', () => {
  it('start at 0 and end at 1', () => {
    for (const e of [linear, easeOut, easeInOut, easeOutBack]) {
      expect(e(0)).toBeCloseTo(0, 9);
      expect(e(1)).toBeCloseTo(1, 9);
    }
  });

  it('only go forward (apart from the overshoot of the back ease)', () => {
    for (const e of [linear, easeOut, easeInOut]) {
      let last = -1;
      for (let k = 0; k <= 1; k += 0.05) {
        expect(e(k)).toBeGreaterThanOrEqual(last);
        last = e(k);
      }
    }
    expect(Math.max(...Array.from({ length: 21 }, (_, i) => easeOutBack(i / 20)))).toBeGreaterThan(1);
  });
});

describe('Tweens', () => {
  it('steps a job from nothing to done over its time, and ends on exactly 1', () => {
    const t = new Tweens();
    const seen: number[] = [];
    t.add({ dur: 100, step: (k) => seen.push(k) });
    t.tick(25);
    t.tick(25);
    expect(seen).toEqual([0.25, 0.5]);
    t.tick(500);
    expect(seen.at(-1)).toBe(1);
    expect(t.size).toBe(0);
    t.tick(50);
    expect(seen).toHaveLength(3);
  });

  it('waits out a delay without calling anything', () => {
    const t = new Tweens();
    const step = vi.fn();
    t.add({ dur: 100, delay: 200, step });
    t.tick(150);
    expect(step).not.toHaveBeenCalled();
    t.tick(100);
    expect(step).toHaveBeenCalledTimes(1);
    expect(step.mock.calls[0]?.[0]).toBeCloseTo(0.5, 9);
  });

  it('runs a job of no length once, at 1', () => {
    const t = new Tweens();
    const step = vi.fn();
    const done = vi.fn();
    t.add({ dur: 0, step, done });
    t.tick(16);
    expect(step).toHaveBeenCalledWith(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('calls done once after the last step, and lets done start more', () => {
    const t = new Tweens();
    const order: string[] = [];
    t.add({
      dur: 50,
      step: (k) => order.push(`a${k}`),
      done: () => {
        order.push('done');
        t.add({ dur: 50, step: (k) => order.push(`b${k}`) });
      },
    });
    t.tick(60);
    expect(order).toEqual(['a1', 'done']);
    t.tick(60);
    expect(order).toEqual(['a1', 'done', 'b1']);
  });

  it('applies the ease', () => {
    const t = new Tweens();
    const seen: number[] = [];
    t.add({ dur: 100, ease: (k) => k * k, step: (k) => seen.push(k) });
    t.tick(50);
    expect(seen).toEqual([0.25]);
  });

  it('lets a new job for a key replace the one running for it', () => {
    const t = new Tweens();
    const key = {};
    const first = vi.fn();
    const firstDone = vi.fn();
    const second = vi.fn();
    t.add({ dur: 100, key, step: first, done: firstDone });
    t.tick(10);
    t.add({ dur: 100, key, step: second });
    t.tick(10);
    expect(first).toHaveBeenCalledTimes(1);
    expect(firstDone).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(t.size).toBe(1);
  });

  it('keeps jobs for other keys, and stops one by key', () => {
    const t = new Tweens();
    const a = {};
    const b = {};
    const sa = vi.fn();
    const sb = vi.fn();
    t.add({ dur: 100, key: a, step: sa });
    t.add({ dur: 100, key: b, step: sb });
    t.stop(a);
    t.tick(10);
    expect(sa).not.toHaveBeenCalled();
    expect(sb).toHaveBeenCalledTimes(1);
  });

  it('forgets everything on clear, done included', () => {
    const t = new Tweens();
    const step = vi.fn();
    const done = vi.fn();
    t.add({ dur: 10, step, done });
    t.clear();
    t.tick(100);
    expect(step).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    expect(t.size).toBe(0);
  });

  it('survives a job that clears the others while it steps', () => {
    const t = new Tweens();
    const late = vi.fn();
    t.add({ dur: 10, step: () => t.clear() });
    t.add({ dur: 10, step: late });
    expect(() => t.tick(20)).not.toThrow();
    expect(late).not.toHaveBeenCalled();
    expect(t.size).toBe(0);
  });

  it('never runs time backwards', () => {
    const t = new Tweens();
    const seen: number[] = [];
    t.add({ dur: 100, step: (k) => seen.push(k) });
    t.tick(-50);
    t.tick(10);
    expect(seen).toEqual([0, 0.1]);
  });
});
