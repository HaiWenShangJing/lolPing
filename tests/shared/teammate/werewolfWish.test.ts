import { describe, expect, it } from 'vitest';
import { parseWolfIn } from '../../../src/shared/gameIpc';
import { CRESCENT_ROLES, CRESCENT_SEATS, ROLES, SEATS, WerewolfGame, type Mode, type Role, type Who } from '../../../src/shared/teammate/werewolf';
import { PET_IDS } from '../../../src/shared/teammate/pet';

const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const table = (mode: Mode): Who[] => {
  const n = mode === 'crescent' ? CRESCENT_SEATS : SEATS;
  return ['user', ...Array.from({ length: n - 1 }, (_, i) => PET_IDS[i % PET_IDS.length] as Who)];
};
const sorted = (xs: readonly Role[]): Role[] => [...xs].sort();

describe('asking for a role', () => {
  it('gives the user that role and deals the rest of the cards at random', () => {
    for (const [mode, cards] of [['classic', ROLES], ['crescent', CRESCENT_ROLES]] as const) {
      for (const role of new Set(cards)) {
        for (let seed = 1; seed <= 5; seed++) {
          const g = WerewolfGame.deal(table(mode), lcg(seed), mode, role);
          expect(g.player(g.seatOfUser() as number).role).toBe(role);
          const left = [...cards];
          left.splice(left.indexOf(role), 1);
          expect(sorted(g.players.filter((p) => p.who !== 'user').map((p) => p.role))).toEqual(sorted(left));
        }
      }
    }
  });

  it('still shuffles the seat of the user', () => {
    const seats = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) seats.add(WerewolfGame.deal(table('classic'), lcg(seed), 'classic', 'seer').seatOfUser() as number);
    expect(seats.size).toBeGreaterThan(3);
  });

  it('is ignored when the user only watches or the role is not on the board', () => {
    const watching = table('classic').slice(1).concat('haru');
    const g = WerewolfGame.deal(watching, lcg(1), 'classic', 'seer');
    expect(sorted(g.players.map((p) => p.role))).toEqual(sorted(ROLES));
    const h = WerewolfGame.deal(table('classic'), lcg(1), 'classic', 'guard');
    expect(sorted(h.players.map((p) => p.role))).toEqual(sorted(ROLES));
  });

  it('is accepted from the page only for a role of the board', () => {
    expect(parseWolfIn({ t: 'start', pets: [], play: true, role: 'seer' })).toEqual({ t: 'start', pets: [], play: true, role: 'seer' });
    expect(parseWolfIn({ t: 'start', pets: [], play: true, mode: 'crescent', role: 'guard' })).toEqual({
      t: 'start', pets: [], play: true, mode: 'crescent', role: 'guard',
    });
    expect(parseWolfIn({ t: 'start', pets: [], play: true, role: 'guard' })).toBeNull();
    expect(parseWolfIn({ t: 'start', pets: [], play: true, role: 7 })).toBeNull();
    expect(parseWolfIn({ t: 'start', pets: [], play: true })).toEqual({ t: 'start', pets: [], play: true });
  });
});

describe('the seer cheat message', () => {
  it('names a seat', () => {
    expect(parseWolfIn({ t: 'peek', seat: 3 })).toEqual({ t: 'peek', seat: 3 });
    expect(parseWolfIn({ t: 'peek', seat: 0 })).toBeNull();
    expect(parseWolfIn({ t: 'peek' })).toBeNull();
  });
});

describe('the chat among the dead message', () => {
  it('carries trimmed text', () => {
    expect(parseWolfIn({ t: 'grave', text: '  hi ' })).toEqual({ t: 'grave', text: 'hi' });
    expect(parseWolfIn({ t: 'grave', text: '  ' })).toBeNull();
  });
});
