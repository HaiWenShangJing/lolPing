import { strings } from '../../../src/shared/i18n';
import type { GameBrain } from '../../../src/main/teammate/gameBrain';
import type { GameServices } from '../../../src/main/teammate/gameServices';
import { vi } from 'vitest';

export const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** A clock the test turns by hand: `after` queues, `fire` runs the oldest timer that is still live. */
export function timers() {
  const queue: { ms: number; fn: () => void; live: boolean }[] = [];
  return {
    after(ms: number, fn: () => void): () => void {
      const t = { ms, fn, live: true };
      queue.push(t);
      return () => { t.live = false; };
    },
    live: (): number => queue.filter((t) => t.live).length,
    fire(): boolean {
      const t = queue.find((x) => x.live);
      if (!t) return false;
      t.live = false;
      t.fn();
      return true;
    },
    delays: (): number[] => queue.filter((t) => t.live).map((t) => t.ms),
  };
}

export const tick = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

/** A mind that answers with `reply` and records who was asked. */
export function fakeBrain(reply: (seat: number, prompt: string) => string | null = () => null) {
  const asked: number[] = [];
  const brain = {
    warm: vi.fn(),
    ask: vi.fn((seat: number, prompt: string) => {
      asked.push(seat);
      return Promise.resolve(reply(seat, prompt));
    }),
    close: vi.fn(),
  };
  return { brain: brain as unknown as GameBrain, asked, warm: brain.warm, close: brain.close };
}

export function fakeServices(over: Partial<GameServices> & { seed?: number } = {}) {
  const { seed = 1, ...rest } = over;
  const t = strings('en', 'win').teammate;
  const clock = timers();
  const services: GameServices = {
    words: () => ({ g: t.games, names: t.ask.petName, language: 'English' }),
    petsOn: () => [],
    persona: (id) => `the persona of ${id}`,
    canThink: () => false,
    brain: () => null,
    after: (ms, fn) => clock.after(ms, fn),
    random: lcg(seed),
    petsDir: 'pets',
    ...rest,
  };
  return { services, clock };
}
