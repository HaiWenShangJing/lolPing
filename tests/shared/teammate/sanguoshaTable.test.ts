import { describe, expect, it } from 'vitest';
import { Bots } from '../../../src/shared/teammate/sanguoshaAi';
import { DECK_SIZE, shuffle } from '../../../src/shared/teammate/sanguoshaCards';
import type { Engine } from '../../../src/shared/teammate/sanguosha';
import { MAX_TURNS, runSanguosha } from '../../../src/shared/teammate/sanguoshaRun';
import {
  ROLE_SETS, equipOf, type Entry, type Outcome, type Size, type Winner,
} from '../../../src/shared/teammate/sanguoshaTypes';

/** A seeded generator whose first values differ from one seed to the next (mulberry32). */
export const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Every card is somewhere exactly once, and nobody holds more hit points than the hero has. */
function audit(e: Engine, entry: Entry): void {
  if (entry.k !== 'shuffle') {
    const cards = [...e.pile, ...e.trash, ...e.limbo];
    for (const p of e.players) cards.push(...p.hand, ...equipOf(p), ...p.judges.map((j) => j.card));
    if (cards.length !== DECK_SIZE || new Set(cards.map((c) => c.id)).size !== DECK_SIZE) {
      throw new Error(`deck broken after ${JSON.stringify(entry)}: ${cards.length} cards, ${new Set(cards.map((c) => c.id)).size} different`);
    }
  }
  for (const p of e.players) {
    if (p.hp > p.maxHp) throw new Error(`seat ${p.seat} has ${p.hp}/${p.maxHp} after ${JSON.stringify(entry)}`);
    const settled = entry.k === 'turn' || entry.k === 'phase' || entry.k === 'end';
    if (settled && p.alive && p.hero && p.hp < 1) throw new Error(`seat ${p.seat} is alive on ${p.hp} hit points`);
  }
}

export interface Played {
  outcome: Outcome | null;
  entries: Entry[];
  engine: Engine;
}

/** One game with a bot in every seat. */
export async function playBots(size: Size, seed: number, audited = true): Promise<Played> {
  const random = seeded(seed);
  const roles = shuffle([...ROLE_SETS[size]], random);
  const bots = new Bots(roles, random);
  const entries: Entry[] = [];
  let engine: Engine | undefined;
  const outcome = await runSanguosha(
    {
      random,
      ask: async (seat, ask, e) => {
        engine = e;
        return bots.answer(seat, ask, e);
      },
      emit: (entry, e) => {
        engine = e;
        entries.push(entry);
        bots.observe(entry, e);
        if (audited) audit(e, entry);
      },
      stopped: () => false,
    },
    roles,
  );
  if (!engine) throw new Error('the game never started');
  return { outcome, entries, engine };
}

/** Whether the table agrees that `winner` has won. */
function decided(e: Engine, winner: Winner): boolean {
  const alive = e.alive();
  if (winner === 'lord') return e.lord.alive && alive.every((p) => p.role === 'lord' || p.role === 'loyalist');
  if (e.lord.alive) return false;
  const sole = alive.length === 1 && alive[0]?.role === 'traitor';
  return winner === 'traitor' ? sole : !sole;
}

const SEEDS = Number(process.env.SGS_SEEDS ?? 40);

describe.each([5, 8] as const)('%i players, every seat a bot', (size) => {
  it('plays whole games, keeping the deck whole and ending with a winner the table agrees on', async () => {
    let finished = 0;
    const turns: number[] = [];
    const wins: Record<string, number> = {};
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { outcome, entries, engine } = await playBots(size, seed);
      expect(outcome, `seed ${seed}`).not.toBeNull();
      expect(entries[0]).toEqual({ k: 'start', size });
      expect(entries.at(-1)).toEqual({ k: 'end', winner: outcome?.winner ?? null });
      if (outcome?.winner) {
        finished += 1;
        expect(decided(engine, outcome.winner), `seed ${seed}: ${outcome.winner}`).toBe(true);
      }
      turns.push(outcome?.turns ?? 0);
      wins[String(outcome?.winner)] = (wins[String(outcome?.winner)] ?? 0) + 1;
    }
    if (process.env.SGS_STATS) console.log(size, JSON.stringify(wins), 'turns', Math.max(...turns), turns.reduce((a, b) => a + b, 0) / turns.length);
    expect(finished).toBeGreaterThanOrEqual(Math.floor(SEEDS * 0.9));
    expect(Math.max(...turns)).toBeLessThanOrEqual(MAX_TURNS);
  }, 120_000);
});
