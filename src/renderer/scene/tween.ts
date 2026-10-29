/** A small tween engine for the scene: each job eases a value from 0 to 1 over a time and tells its step. */

export type Ease = (k: number) => number;

export const linear: Ease = (k) => k;
export const easeOut: Ease = (k) => 1 - (1 - k) ** 3;
export const easeInOut: Ease = (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
export const easeOutBack: Ease = (k) => {
  const c = 1.70158;
  return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
};

/** How high a die starts above the table, and how high its two bounces go, in px. */
export const DROP = { height: 330, bounces: [70, 24] as readonly number[] } as const;

const bounce = (q: number, height: number): number => height * 4 * q * (1 - q);

/**
 * A die's roll for `k` from 0 to 1: it drops from high up, bounces twice and lies still. `p` is how far it has come
 * towards where it lands (0 to 1), `lift` how high above the table it is, and `spin` how much of its tumble is left.
 */
export function tumbleAt(k: number): { p: number; lift: number; spin: number } {
  const t = Math.min(1, Math.max(0, k));
  const settle = Math.min(1, t / 0.8);
  let lift = 0;
  if (t < 0.4) lift = DROP.height * (1 - (t / 0.4) ** 2);
  else if (t < 0.65) lift = bounce((t - 0.4) / 0.25, DROP.bounces[0] ?? 0);
  else if (t < 0.8) lift = bounce((t - 0.65) / 0.15, DROP.bounces[1] ?? 0);
  return { p: easeOut(settle), lift, spin: (1 - settle) ** 2 };
}

export interface TweenOptions {
  /** How long it takes, in ms. */
  dur: number;
  /** Called every frame with the eased progress; it is called with 1 last. */
  step: (k: number) => void;
  ease?: Ease;
  /** How long to wait before it starts; nothing is called while it waits. */
  delay?: number;
  /** Adding a job for a key replaces the one running for the same key, so two never move one thing at once. */
  key?: object;
  done?: () => void;
}

interface Job extends TweenOptions {
  age: number;
  dead: boolean;
}

export class Tweens {
  private jobs: Job[] = [];

  add(opts: TweenOptions): void {
    if (opts.key) this.stop(opts.key);
    this.jobs.push({ ...opts, age: 0, dead: false });
  }

  /** Drops the job running for `key` without finishing it. */
  stop(key: object): void {
    for (const j of this.jobs) if (j.key === key) j.dead = true;
    this.jobs = this.jobs.filter((j) => !j.dead);
  }

  clear(): void {
    for (const j of this.jobs) j.dead = true;
    this.jobs = [];
  }

  get size(): number {
    return this.jobs.length;
  }

  /** Moves every job on by `dtMs`; a job that ends calls its `done` after the others have stepped. */
  tick(dtMs: number): void {
    const finished: Job[] = [];
    for (const j of [...this.jobs]) {
      if (j.dead) continue;
      j.age += Math.max(0, dtMs);
      const t = j.age - (j.delay ?? 0);
      if (t < 0) continue;
      const k = j.dur <= 0 ? 1 : Math.min(1, t / j.dur);
      j.step((j.ease ?? linear)(k));
      if (k >= 1) {
        j.dead = true;
        finished.push(j);
      }
    }
    if (finished.length > 0) this.jobs = this.jobs.filter((j) => !j.dead);
    for (const j of finished) j.done?.();
  }
}
