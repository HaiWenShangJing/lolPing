import { describe, expect, it } from 'vitest';
import { PET_IDS, type PetId } from '../../../src/shared/teammate/pet';
import { fillSeats } from '../../../src/shared/teammate/gameText';
import {
  CRESCENT_EXTRAS, CRESCENT_ROLES, CRESCENT_SEATS, WerewolfGame, type Role, type Who,
} from '../../../src/shared/teammate/werewolf';

const pets = (): Who[] => Array.from({ length: CRESCENT_SEATS }, (_, i) => PET_IDS[i % PET_IDS.length] as PetId);
const seeded = (): (() => number) => {
  let t = 7;
  return () => {
    t = (t * 1664525 + 1013904223) >>> 0;
    return t / 4294967296;
  };
};

/** A crescent table whose seats hold `CRESCENT_ROLES` in order, so a role's seat is easy to name. */
const board = (): WerewolfGame =>
  WerewolfGame.seat(CRESCENT_ROLES.map((role, i) => ({ who: pets()[i] as Who, role })), 'crescent');
const seatOf = (g: WerewolfGame, role: Role, nth = 0): number =>
  g.players.filter((p) => p.role === role)[nth]?.seat ?? 0;

describe('the crescent deal', () => {
  it('seats eighteen players with the twenty cards less the two under the table', () => {
    const g = WerewolfGame.deal(pets(), seeded(), 'crescent');
    expect(g.players).toHaveLength(CRESCENT_SEATS);
    expect(g.players.map((p) => p.role).sort()).toEqual([...CRESCENT_ROLES].sort());
    expect(g.extras).toEqual([...CRESCENT_EXTRAS]);
    expect(CRESCENT_ROLES.length + CRESCENT_EXTRAS.length).toBe(20);
  });

  it('tells the wolves one another but not the hidden wolf, who knows them', () => {
    const g = board();
    const wolves = [seatOf(g, 'wolf'), seatOf(g, 'wolf', 1), seatOf(g, 'beauty')].sort((a, b) => a - b);
    const known = (seat: number): number[] =>
      g.viewFrom(seat, 0).entries.flatMap((e) => (e.kind === 'wolves' ? e.seats : [])).sort((a, b) => a - b);
    expect(known(seatOf(g, 'wolf'))).toEqual(wolves);
    expect(known(seatOf(g, 'hidden'))).toEqual(wolves);
    expect(known(seatOf(g, 'seer'))).toEqual([]);
  });

  it('shows the seer a hidden wolf as good, and lets him kill only when he is the last wolf', () => {
    const g = board();
    expect(g.looksWolf(seatOf(g, 'hidden'))).toBe(false);
    expect(g.looksWolf(seatOf(g, 'beauty'))).toBe(true);
    expect(g.killers().map((p) => p.role)).not.toContain('hidden');
    for (const p of g.players) if (p.role === 'wolf' || p.role === 'beauty') p.alive = false;
    expect(g.killers().map((p) => p.role)).toEqual(['hidden']);
  });
});

describe('the crescent night', () => {
  it('lets a guard and a witch on one victim kill him, and either one alone saves him', () => {
    const victim = (night: { saved: boolean; guarded: number | null }): boolean => {
      const g = board();
      g.startNight();
      g.endNight({ kill: 7, poisoned: null, ...night });
      return g.player(7).alive;
    };
    expect(victim({ saved: false, guarded: null })).toBe(false);
    expect(victim({ saved: false, guarded: 7 })).toBe(true);
    expect(victim({ saved: true, guarded: null })).toBe(true);
    expect(victim({ saved: true, guarded: 7 })).toBe(false);
    expect(victim({ saved: false, guarded: 8 })).toBe(false);
  });

  it('gives a guard no player twice in a row', () => {
    const g = board();
    const guard = seatOf(g, 'guard');
    expect(g.options(guard, { kind: 'guard' })).toContain(7);
    g.guardNight(guard, 7);
    expect(g.options(guard, { kind: 'guard' })).not.toContain(7);
    expect(g.options(guard, { kind: 'guard' })).toContain(guard);
  });

  it('has the thief take one of the two cards, and become that role', () => {
    const g = board();
    const thief = seatOf(g, 'thief');
    expect(g.steal(thief, 0)).toBe('wolf');
    expect(g.player(thief).role).toBe('wolf');
    expect(g.viewFrom(thief, 0).entries.some((e) => e.kind === 'thief' && e.role === 'wolf')).toBe(true);
    const other = board();
    expect(other.steal(seatOf(other, 'thief'), 1)).toBe('villager');
  });

  it('has a wolf beauty take her charmed with her, and tell it at dawn', () => {
    const g = board();
    const beauty = seatOf(g, 'beauty');
    g.charm(beauty, 7);
    g.startNight();
    const died = g.endNight({ kill: beauty, saved: false, poisoned: null });
    expect(died).toEqual([beauty, 7].sort((a, b) => a - b));
    expect(g.deaths.map((d) => d.cause).sort()).toEqual(['charm', 'wolves']);
  });
});

describe('lovers and the wild child', () => {
  it('has one lover die of grief for the other', () => {
    const g = board();
    g.couple(seatOf(g, 'cupid'), 5, 6);
    expect(g.partnerOf(5)).toBe(6);
    g.startNight();
    expect(g.endNight({ kill: 5, saved: false, poisoned: null })).toEqual([5, 6]);
    expect(g.deaths.find((d) => d.seat === 6)?.cause).toBe('grief');
  });

  it('gives the lovers the game when a wolf and a villager are the last two alive', () => {
    const g = board();
    const wolf = seatOf(g, 'wolf');
    const villager = seatOf(g, 'villager');
    g.couple(seatOf(g, 'cupid'), wolf, villager);
    for (const p of g.players) if (p.seat !== wolf && p.seat !== villager) p.alive = false;
    expect(g.winner()).toBe('lovers');
    expect(g.reason()).toBe('lovers');
  });

  it('leaves two lovers of one side to the usual rule: no wolf left, the village wins', () => {
    const g = board();
    const [a, b] = [seatOf(g, 'villager'), seatOf(g, 'villager', 1)];
    g.couple(seatOf(g, 'cupid'), a, b);
    for (const p of g.players) if (p.seat !== a && p.seat !== b) p.alive = false;
    expect(g.winner()).toBe('village');
  });

  it('turns the wild child into a wolf when his model dies, and tells him and the wolves', () => {
    const g = board();
    const child = seatOf(g, 'wildchild');
    g.adopt(child, 9);
    g.die(9, 'exile');
    expect(g.player(child).role).toBe('wolf');
    expect(g.looksWolf(child)).toBe(true);
    const told = (seat: number): boolean => g.viewFrom(seat, 0).entries.some((e) => e.kind === 'turned');
    expect(told(child)).toBe(true);
    expect(told(seatOf(g, 'wolf'))).toBe(true);
    expect(told(seatOf(g, 'seer'))).toBe(false);
  });
});

describe('the pets at an eighteen seat table', () => {
  it('sit twice when there are fewer pets than seats, the picked ones first, and never short', () => {
    const picked = PET_IDS.slice(0, 3);
    const seats = fillSeats(picked, CRESCENT_SEATS - 1, seeded());
    expect(seats).toHaveLength(CRESCENT_SEATS - 1);
    expect(seats.slice(0, 3)).toEqual(picked);
    expect(new Set(seats.slice(0, PET_IDS.length)).size).toBe(PET_IDS.length);
    expect(new Set(seats.slice(PET_IDS.length)).size).toBe(seats.length - PET_IDS.length);
  });
});
