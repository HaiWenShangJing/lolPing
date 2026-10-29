import { describe, expect, it, vi } from 'vitest';
import { KINDS, countKinds, isWinning, type Meld } from '../../../src/shared/teammate/mahjong';
import {
  DEAL_MS, DICE_MS, SHUFFLE_MS, THROWS, WIN_SHOW_MS, planRound, type PlanEvent, type RoundPlan,
} from '../../../src/shared/teammate/mahjongPlan';

// Whole rounds are played out for hundreds of seeds, which takes a while on a slow or busy machine.
vi.setConfig({ testTimeout: 30_000 });

const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

type Win = Extract<PlanEvent, { type: 'win' }>;

/** Plays a plan on a bare table the way the page does and checks every step could really have happened. */
function replay(plan: RoundPlan, dealer: number): { throws: number; calls: Meld[]; win: Win | null } {
  const pools: number[][] = [[], [], [], []];
  const melds: Meld[][] = [[], [], [], []];
  const rack = [13, 13, 13, 13];
  let turn = dealer;
  let calling = false;
  let drawn = false;
  let throws = 0;
  let last = -1;
  let win: Win | null = null;
  const calls: Meld[] = [];
  let at = -1;
  const visible = (): number[] => countKinds([...pools.flat(), ...melds.flat().flatMap((m) => m.tiles)]);

  for (const e of plan.events) {
    expect(e.at).toBeGreaterThanOrEqual(at);
    at = e.at;
    switch (e.type) {
      case 'shuffle':
      case 'dice':
      case 'deal':
      case 'think':
      case 'react':
      case 'chat':
        break;
      case 'draw':
        expect(e.seat).toBe(turn);
        expect(calling).toBe(false);
        expect(drawn).toBe(false);
        drawn = true;
        rack[e.seat] = (rack[e.seat] ?? 0) + 1;
        expect(e.left).toBeGreaterThanOrEqual(0);
        break;
      case 'throw':
        expect(e.seat).toBe(turn);
        expect(drawn || calling).toBe(true);
        pools[e.seat]?.push(e.tile);
        rack[e.seat] = (rack[e.seat] ?? 0) - 1;
        drawn = false;
        calling = false;
        turn = (turn + 1) % 4;
        throws += 1;
        last = e.seat;
        break;
      case 'call': {
        expect(e.meld.from).toBe(last);
        expect(e.seat).not.toBe(last);
        expect(e.meld.kind).toBe(e.kind);
        if (e.kind === 'chow') expect(e.seat).toBe((last + 1) % 4);
        const pool = pools[last] ?? [];
        expect(pool[pool.length - 1]).toBe(e.meld.claimed);
        pool.pop();
        if (e.kind === 'pong') {
          expect(e.meld.tiles).toEqual([e.meld.claimed, e.meld.claimed, e.meld.claimed]);
        } else {
          const [a, b, c] = e.meld.tiles as [number, number, number];
          expect([b - a, c - b]).toEqual([1, 1]);
          expect(Math.floor(a / 9)).toBe(Math.floor(c / 9));
          expect(c).toBeLessThan(27);
        }
        melds[e.seat]?.push(e.meld);
        rack[e.seat] = (rack[e.seat] ?? 0) - 2;
        calls.push(e.meld);
        calling = true;
        turn = e.seat;
        last = -1;
        break;
      }
      case 'win': {
        win = e;
        const seen = visible();
        const all = [...e.hand, e.tile];
        expect(e.melds).toEqual(melds[e.seat]);
        expect(all).toHaveLength(14 - 3 * e.melds.length);
        expect(isWinning(all)).toBe(true);
        expect(e.hand).toEqual([...e.hand].sort((a, b) => a - b));
        const inHand = countKinds(all);
        if (e.from === null) {
          expect(e.seat).toBe(turn);
          expect(drawn).toBe(true);
        } else {
          expect(e.from).toBe(last);
          const pool = pools[e.from] ?? [];
          expect(pool[pool.length - 1]).toBe(e.tile);
          expect(e.seat).not.toBe(e.from);
          // The thrown tile is in the pool and in the hand: it counts once.
          inHand[e.tile] = (inHand[e.tile] ?? 0) - 1;
        }
        for (let k = 0; k < KINDS; k++) expect((inHand[k] ?? 0) + (seen[k] ?? 0)).toBeLessThanOrEqual(4);
        break;
      }
      case 'end':
        break;
    }
    expect(visible().every((c) => c <= 4)).toBe(true);
    for (const n of rack) expect(n).toBeGreaterThanOrEqual(0);
  }
  return { throws, calls, win };
}

describe('planRound', () => {
  it('starts with the shuffle, the dice and the deal, one after the other', () => {
    const plan = planRound(lcg(1), 0);
    const [shuffle, dice, deal, first] = plan.events;
    expect(shuffle).toMatchObject({ at: 0, type: 'shuffle', ms: SHUFFLE_MS });
    expect(dice?.type).toBe('dice');
    expect(dice?.at).toBeGreaterThanOrEqual(SHUFFLE_MS);
    expect(deal?.type).toBe('deal');
    expect(deal?.at).toBeGreaterThanOrEqual((dice?.at ?? 0) + DICE_MS);
    expect(first?.type).toBe('draw');
    expect(first?.at).toBeGreaterThanOrEqual((deal?.at ?? 0) + DEAL_MS);
    if (dice?.type === 'dice') for (const d of dice.dice) expect([1, 2, 3, 4, 5, 6]).toContain(d);
  });

  it('is the same round for the same random, and another for another', () => {
    expect(planRound(lcg(7), 2)).toEqual(planRound(lcg(7), 2));
    expect(planRound(lcg(7), 2)).not.toEqual(planRound(lcg(8), 2));
  });

  it('is in time order and ends at the end it says', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const plan = planRound(lcg(seed), seed % 4);
      const times = plan.events.map((e) => e.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(plan.events.at(-1)).toEqual({ at: plan.end, type: 'end' });
      expect(plan.events.filter((e) => e.type === 'end')).toHaveLength(1);
    }
  });

  it('plays out as a real round on a table: turns go round, claims take the thrown tile, never five of a kind', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const dealer = seed % 4;
      replay(planRound(lcg(seed), dealer), dealer);
    }
  });

  it('always ends in a win by a hand that wins', () => {
    let tsumo = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const dealer = seed % 4;
      const plan = planRound(lcg(seed), dealer);
      const { win } = replay(plan, dealer);
      expect(win).not.toBeNull();
      expect(plan.winner).toBe(win?.seat);
      if (win?.from === null) tsumo += 1;
    }
    expect(tsumo).toBeGreaterThan(60);
    expect(tsumo).toBeLessThan(180);
  });

  it('throws between the least and about the most it plans, and has the win at the end', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const plan = planRound(lcg(seed), 0);
      const { throws } = replay(plan, 0);
      expect(throws).toBeGreaterThanOrEqual(THROWS.min);
      expect(throws).toBeLessThanOrEqual(THROWS.max + 6);
      const win = plan.events.find((e) => e.type === 'win');
      expect(plan.end).toBe((win?.at ?? 0) + WIN_SHOW_MS);
    }
  });

  it('has the pets claim tiles now and then, both triplets and runs', () => {
    let rounds = 0;
    let pongs = 0;
    let chows = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { calls } = replay(planRound(lcg(seed), seed % 4), seed % 4);
      if (calls.length > 0) rounds += 1;
      pongs += calls.filter((m) => m.kind === 'pong').length;
      chows += calls.filter((m) => m.kind === 'chow').length;
    }
    expect(rounds).toBeGreaterThan(60);
    expect(pongs).toBeGreaterThan(20);
    expect(chows).toBeGreaterThan(20);
  });

  it('passes the deal on: the dealer stays if it won, else the next seat deals', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const dealer = seed % 4;
      const plan = planRound(lcg(seed), dealer);
      expect(plan.next).toBe(plan.winner === dealer ? dealer : (dealer + 1) % 4);
    }
  });

  it('has the pet that threw the winning tile take it badly and every other pet react to the win', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const plan = planRound(lcg(seed), 0);
      const win = plan.events.find((e): e is Win => e.type === 'win');
      expect(win).toBeDefined();
      if (!win) continue;
      const after = plan.events.filter((e) => e.at > win.at);
      const reacting = new Set(after.flatMap((e) => (e.type === 'react' ? [e.seat] : [])));
      expect(reacting.has(win.seat)).toBe(false);
      const losers = [0, 1, 2, 3].filter((s) => s !== win.seat);
      expect([...reacting].sort()).toEqual(losers);
      if (win.from !== null) {
        expect(after.find((e) => e.type === 'react' && e.seat === win.from)).toMatchObject({ reaction: 'lose' });
      }
      expect(after.some((e) => e.type === 'chat' && e.seat === win.seat && e.kind === 'win')).toBe(true);
    }
  });

  it('gives every line a variant from 0 up to 1 and a kind of line the pets have', () => {
    const kinds = new Set(['draw', 'think', 'throw', 'tease', 'pong', 'chow', 'win', 'lose', 'cheer']);
    let chats = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const e of planRound(lcg(seed), 1).events) {
        if (e.type !== 'chat') continue;
        chats += 1;
        expect(kinds.has(e.kind)).toBe(true);
        expect(e.variant).toBeGreaterThanOrEqual(0);
        expect(e.variant).toBeLessThan(1);
        expect(e.seat).toBeGreaterThanOrEqual(0);
        expect(e.seat).toBeLessThan(4);
      }
    }
    expect(chats).toBeGreaterThan(300);
  });
});
