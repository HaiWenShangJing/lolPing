import { describe, expect, it } from 'vitest';
import { PET_IDS } from '../../../src/shared/teammate/pet';
import {
  ROLES, SEATS, WerewolfGame, isGod, noMeaning, plurality, shuffled, type Entry, type Role, type Who,
} from '../../../src/shared/teammate/werewolf';

const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const PETS: Who[] = PET_IDS.slice(0, SEATS);
/** The standard board in the order of ROLES: wolves 1-4, villagers 5-8, then seer 9, witch 10, hunter 11, idiot 12. */
const board = (roles: readonly Role[] = ROLES): WerewolfGame =>
  WerewolfGame.seat(roles.map((role, i) => ({ who: PETS[i % PETS.length] as Who, role })));
const kill = (g: WerewolfGame, ...seats: number[]): void => {
  for (const s of seats) g.die(s, 'wolves');
  g.deaths.length = 0;
};
const entries = (g: WerewolfGame, kind: Entry['kind']): Entry[] =>
  g.log.map((l) => l.entry).filter((e) => e.kind === kind);

describe('the board', () => {
  it('has four wolves, four villagers and a seer, a witch, a hunter and an idiot', () => {
    const count = (r: Role): number => ROLES.filter((x) => x === r).length;
    expect(ROLES).toHaveLength(12);
    expect([count('wolf'), count('villager'), count('seer'), count('witch'), count('hunter'), count('idiot')])
      .toEqual([4, 4, 1, 1, 1, 1]);
    expect(ROLES.filter(isGod)).toHaveLength(4);
    expect(isGod('wolf') || isGod('villager')).toBe(false);
  });

  it('deals twelve seats, each with one role of the board and one player', () => {
    const g = WerewolfGame.deal(PETS, lcg(7));
    expect(g.players.map((p) => p.seat)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect([...g.players.map((p) => p.role)].sort()).toEqual([...ROLES].sort());
    expect([...g.players.map((p) => p.who)].sort()).toEqual([...PETS].sort());
    expect(g.players.every((p) => p.alive && !p.flipped && !p.boomed)).toBe(true);
    expect(g.seatOfUser()).toBeNull();
  });

  it('refuses a game of any other size', () => {
    expect(() => WerewolfGame.deal(['user', 'mao'], Math.random)).toThrow();
    expect(() => WerewolfGame.deal([...PETS, 'mao'], Math.random)).toThrow();
  });

  it('gives the user every role about as often as any other, in every seat', () => {
    const roles = new Map<Role, number>();
    const seats = new Map<number, number>();
    const random = lcg(99);
    const n = 6000;
    for (let i = 0; i < n; i++) {
      const g = WerewolfGame.deal(['user', ...PETS.slice(1)], random);
      const seat = g.seatOfUser() ?? 0;
      seats.set(seat, (seats.get(seat) ?? 0) + 1);
      const role = g.player(seat).role;
      roles.set(role, (roles.get(role) ?? 0) + 1);
    }
    expect(roles.size).toBe(6);
    const share = (r: Role): number => (roles.get(r) ?? 0) / n;
    expect(share('wolf')).toBeGreaterThan(1 / 3 - 0.04);
    expect(share('wolf')).toBeLessThan(1 / 3 + 0.04);
    expect(share('villager')).toBeGreaterThan(1 / 3 - 0.04);
    expect(share('villager')).toBeLessThan(1 / 3 + 0.04);
    for (const r of ['seer', 'witch', 'hunter', 'idiot'] as const) {
      expect(share(r)).toBeGreaterThan(1 / 12 - 0.03);
      expect(share(r)).toBeLessThan(1 / 12 + 0.03);
    }
    expect(seats.size).toBe(12);
  });

  it('shuffles by the random it is given', () => {
    const a = WerewolfGame.deal(PETS, () => 0).players.map((p) => `${p.who}${p.role}`);
    const b = WerewolfGame.deal(PETS, () => 0.99).players.map((p) => `${p.who}${p.role}`);
    expect(a).not.toEqual(b);
    expect(shuffled([1, 2, 3, 4], lcg(1)).sort()).toEqual([1, 2, 3, 4]);
  });

  it('tells each player its own role, and each wolf the other wolves', () => {
    const g = board();
    expect(g.viewFrom(9, 0).entries).toEqual([{ kind: 'start', seat: 9, role: 'seer' }]);
    expect(g.viewFrom(5, 0).entries).toEqual([{ kind: 'start', seat: 5, role: 'villager' }]);
    expect(g.viewFrom(2, 0).entries).toEqual([
      { kind: 'start', seat: 2, role: 'wolf' }, { kind: 'wolves', seats: [1, 2, 3, 4] },
    ]);
  });
});

describe('who has won', () => {
  it('is the village once every wolf is out', () => {
    const g = board();
    kill(g, 1, 2, 3);
    expect(g.winner()).toBeNull();
    kill(g, 4);
    expect(g.winner()).toBe('village');
    expect(g.reason()).toBe('wolves');
  });

  it('is the wolves once every god is out, however many villagers are left', () => {
    const g = board();
    kill(g, 9, 10, 11);
    expect(g.winner()).toBeNull();
    kill(g, 12);
    expect(g.winner()).toBe('wolves');
    expect(g.reason()).toBe('gods');
    expect(g.players.filter((p) => p.alive && p.role === 'villager')).toHaveLength(4);
  });

  it('is the wolves once every villager is out, however many gods are left', () => {
    const g = board();
    kill(g, 5, 6, 7);
    expect(g.winner()).toBeNull();
    kill(g, 8);
    expect(g.winner()).toBe('wolves');
    expect(g.reason()).toBe('villagers');
    expect(g.players.filter((p) => p.alive && isGod(p.role))).toHaveLength(4);
  });

  it('is not decided by the numbers: three wolves against a villager and a god still play on', () => {
    const g = board();
    kill(g, 1, 5, 6, 7, 9, 10, 11);
    expect(g.winner()).toBeNull();
    expect(g.alive().map((p) => p.role).sort()).toEqual(['idiot', 'villager', 'wolf', 'wolf', 'wolf']);
  });

  it('counts a flipped idiot as a god that is still alive', () => {
    const g = board();
    kill(g, 9, 10, 11);
    expect(g.exile(12)).toBe('flipped');
    expect(g.player(12).alive).toBe(true);
    expect(g.winner()).toBeNull();
    g.die(12, 'wolves');
    expect(g.winner()).toBe('wolves');
  });

  it('goes to the village when the last wolf and the last god fall together', () => {
    const g = board();
    kill(g, 1, 2, 3, 9, 10, 11);
    g.die(4, 'poison');
    g.die(12, 'wolves');
    expect(g.decided()).toEqual({ winner: 'village', why: 'wolves' });
  });

  it('stands once it is said, and is told to the log once', () => {
    const g = board();
    kill(g, 1, 2, 3, 4);
    expect(g.winner()).toBe('village');
    g.player(1).alive = true;
    g.player(1).alive = true;
    expect(g.winner()).toBe('village');
    expect(entries(g, 'over')).toEqual([{ kind: 'over', winner: 'village', why: 'wolves' }]);
  });

  it('is open at the start, and `decided` does not tell the log', () => {
    const g = board();
    expect(g.decided()).toBeNull();
    expect(g.winner()).toBeNull();
    kill(g, 1, 2, 3, 4);
    expect(g.decided()?.winner).toBe('village');
    expect(entries(g, 'over')).toEqual([]);
  });
});

describe('the night', () => {
  it('kills the wolves victim at dawn and names who died, without their roles', () => {
    const g = board();
    g.startNight();
    expect(g.endNight({ kill: 5, saved: false, poisoned: null })).toEqual([5]);
    expect(g.player(5).alive).toBe(false);
    expect(g.deaths).toEqual([{ seat: 5, cause: 'wolves', day: 1 }]);
    expect(entries(g, 'dawn')).toEqual([{ kind: 'dawn', day: 1, died: [5] }]);
  });

  it('lets the antidote undo the knife', () => {
    const g = board();
    g.startNight();
    expect(g.endNight({ kill: 5, saved: true, poisoned: null })).toEqual([]);
    expect(g.alive()).toHaveLength(12);
    expect(g.deaths).toEqual([]);
  });

  it('kills whoever was poisoned, the knife victim too, in seat order', () => {
    const g = board();
    g.startNight();
    expect(g.endNight({ kill: 9, saved: false, poisoned: 2 })).toEqual([2, 9]);
    expect(g.deaths.map((d) => [d.seat, d.cause])).toEqual([[2, 'poison'], [9, 'wolves']]);
  });

  it('takes the poison as the cause when the knife and the poison hit the same player', () => {
    const g = board();
    g.startNight();
    g.endNight({ kill: 11, saved: false, poisoned: 11 });
    expect(g.deaths).toEqual([{ seat: 11, cause: 'poison', day: 1 }]);
    expect(g.mayShoot(g.deaths[0] as never)).toBe(false);
  });

  it('allows one potion a night: a save wins over a poison', () => {
    const g = board();
    g.startNight();
    expect(g.endNight({ kill: 5, saved: true, poisoned: 6 })).toEqual([]);
    expect(g.alive()).toHaveLength(12);
  });

  it('counts the nights, one at a time', () => {
    const g = board();
    g.startNight();
    g.startNight();
    expect(g.day).toBe(2);
    expect(entries(g, 'night')).toEqual([{ kind: 'night', day: 1 }, { kind: 'night', day: 2 }]);
  });
});

describe('the witch', () => {
  it('may save the victim while the antidote lasts', () => {
    const g = board();
    g.startNight();
    expect(g.canSave(5)).toBe(true);
    g.antidote = false;
    expect(g.canSave(5)).toBe(false);
  });

  it('may save herself on the first night only', () => {
    const g = board();
    g.startNight();
    expect(g.canSave(10)).toBe(true);
    g.startNight();
    expect(g.canSave(10)).toBe(false);
    expect(g.canSave(5)).toBe(true);
  });

  it('is told the victim only while she still has the antidote, and what potions are left', () => {
    const g = board();
    g.startNight();
    expect(g.witchQuestion(5)).toEqual({ kind: 'witch', victim: 5, save: true, poison: true });
    g.antidote = false;
    expect(g.witchQuestion(5)).toEqual({ kind: 'witch', victim: null, save: false, poison: true });
    g.poison = false;
    expect(g.witchQuestion(5)).toEqual({ kind: 'witch', victim: null, save: false, poison: false });
  });

  it('may poison any other living player, and nobody once the poison is used', () => {
    const g = board();
    g.startNight();
    kill(g, 6);
    const q = g.witchQuestion(5);
    expect(g.options(10, q)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 11, 12]);
    g.poison = false;
    expect(g.options(10, g.witchQuestion(5))).toEqual([]);
  });
});

describe('deaths', () => {
  it('lets a hunter shoot when the wolves kill him or the table exiles him, but not when he is poisoned', () => {
    const g = board();
    expect(g.mayShoot({ seat: 11, cause: 'wolves', day: 2 })).toBe(true);
    expect(g.mayShoot({ seat: 11, cause: 'exile', day: 2 })).toBe(true);
    expect(g.mayShoot({ seat: 11, cause: 'poison', day: 1 })).toBe(false);
    expect(g.mayShoot({ seat: 11, cause: 'shot', day: 2 })).toBe(false);
    expect(g.mayShoot({ seat: 5, cause: 'wolves', day: 2 })).toBe(false);
    expect(g.mayShoot({ seat: 9, cause: 'exile', day: 2 })).toBe(false);
  });

  it('kills the one a hunter shoots, and puts it in the queue for the rest to settle', () => {
    const g = board();
    g.startNight();
    g.shoot(11, 3);
    expect(g.player(3).alive).toBe(false);
    expect(g.deaths).toEqual([{ seat: 3, cause: 'shot', day: 1 }]);
    expect(entries(g, 'shot')).toEqual([{ kind: 'shot', hunter: 11, target: 3 }]);
  });

  it('gives last words to the dead of the first night and to the exiled, nobody else', () => {
    const g = board();
    expect(g.hasLastWords({ seat: 5, cause: 'wolves', day: 1 })).toBe(true);
    expect(g.hasLastWords({ seat: 5, cause: 'poison', day: 1 })).toBe(true);
    expect(g.hasLastWords({ seat: 5, cause: 'wolves', day: 2 })).toBe(false);
    expect(g.hasLastWords({ seat: 5, cause: 'poison', day: 3 })).toBe(false);
    expect(g.hasLastWords({ seat: 5, cause: 'exile', day: 1 })).toBe(true);
    expect(g.hasLastWords({ seat: 5, cause: 'exile', day: 4 })).toBe(true);
    expect(g.hasLastWords({ seat: 5, cause: 'shot', day: 1 })).toBe(false);
    expect(g.hasLastWords({ seat: 1, cause: 'boom', day: 1 })).toBe(false);
  });

  it('hands out the deaths in the order they came, and a player dies once', () => {
    const g = board();
    g.die(5, 'wolves');
    g.die(5, 'poison');
    g.die(6, 'exile');
    expect(g.nextDeath()).toMatchObject({ seat: 5, cause: 'wolves' });
    expect(g.nextDeath()).toMatchObject({ seat: 6, cause: 'exile' });
    expect(g.nextDeath()).toBeNull();
  });
});

describe('the idiot', () => {
  it('turns his card when he is exiled, and lives on without a vote', () => {
    const g = board();
    expect(g.exile(12)).toBe('flipped');
    const idiot = g.player(12);
    expect(idiot.alive && idiot.flipped).toBe(true);
    expect(g.deaths).toEqual([]);
    expect(entries(g, 'flip')).toEqual([{ kind: 'flip', seat: 12 }]);
    expect(g.voters()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(g.options(1, { kind: 'vote', why: 'exile', among: null })).not.toContain(12);
  });

  it('still speaks: he is in the day talk', () => {
    const g = board();
    g.exile(12);
    expect(g.talkOrder(0)).toContain(12);
  });

  it('dies like anyone else when the wolves kill him, or the witch poisons him', () => {
    for (const cause of ['wolves', 'poison'] as const) {
      const g = board();
      g.exile(12);
      g.die(12, cause);
      expect(g.player(12).alive).toBe(false);
    }
    const g = board();
    g.startNight();
    g.endNight({ kill: 12, saved: false, poisoned: null });
    expect(g.player(12).alive).toBe(false);
    expect(g.player(12).flipped).toBe(false);
  });

  it('is exiled like anyone else when he has not been flipped yet, apart from the card', () => {
    const g = board();
    expect(g.exile(5)).toBe('dead');
    expect(g.deaths).toEqual([{ seat: 5, cause: 'exile', day: 0 }]);
    expect(g.player(5).flipped).toBe(false);
  });
});

describe('self-destruct', () => {
  it('kills the wolf at once, shows what it was, and queues its death', () => {
    const g = board();
    g.startNight();
    g.boom(2);
    expect(g.player(2)).toMatchObject({ alive: false, boomed: true });
    expect(entries(g, 'boom')).toEqual([{ kind: 'boom', seat: 2 }]);
    expect(g.deaths).toEqual([{ seat: 2, cause: 'boom', day: 1 }]);
  });

  it('is for a living wolf only', () => {
    const g = board();
    expect(() => g.boom(5)).toThrow();
    g.die(2, 'exile');
    expect(() => g.boom(2)).toThrow();
  });
});

describe('the vote', () => {
  const votes = (...pairs: [number, number | null][]) => pairs.map(([seat, target]) => ({ seat, target }));

  it('sends out whoever has the most votes, and lists who voted for whom', () => {
    const g = board();
    const t = g.tally('exile', 1, votes([1, 5], [2, 5], [3, 6], [4, null]));
    expect(t).toEqual({ out: 5, tied: [] });
    expect(entries(g, 'votes')).toEqual([{
      kind: 'votes', day: 0, why: 'exile', round: 1, out: 5, tied: [], abstained: [4],
      ballots: [{ target: 5, voters: [1, 2], total: 2 }, { target: 6, voters: [3], total: 1 }],
    }]);
  });

  it('names the players a tie leaves, and sends nobody out', () => {
    const g = board();
    expect(g.tally('exile', 1, votes([1, 5], [2, 6], [3, 5], [4, 6], [7, 8]))).toEqual({ out: null, tied: [5, 6] });
    expect(g.tally('exile', 1, votes([1, null]))).toEqual({ out: null, tied: [] });
    expect(g.tally('exile', 1, [])).toEqual({ out: null, tied: [] });
  });

  it('counts the sheriff as one and a half in the vote that exiles', () => {
    const g = board();
    g.elect(7);
    const t = g.tally('exile', 1, votes([1, 5], [2, 5], [3, 6], [7, 6]));
    expect(t.out).toBe(6);
    const ballots = (entries(g, 'votes')[0] as Extract<Entry, { kind: 'votes' }>).ballots;
    expect(ballots.map((b) => [b.target, b.total])).toEqual([[6, 2.5], [5, 2]]);
  });

  it('lets the sheriff break what would have been a tie, but not outweigh two votes alone', () => {
    const g = board();
    g.elect(7);
    expect(g.tally('exile', 1, votes([1, 5], [2, 6], [7, 6])).out).toBe(6);
    expect(g.tally('exile', 1, votes([1, 5], [2, 5], [7, 6])).out).toBe(5);
  });

  it('counts every vote as one in the election of the sheriff', () => {
    const g = board();
    g.elect(7);
    g.tally('sheriff', 1, votes([7, 5], [1, 6], [2, 6]));
    const e = entries(g, 'votes')[0] as Extract<Entry, { kind: 'votes' }>;
    expect(e.why).toBe('sheriff');
    expect(e.ballots.map((b) => [b.target, b.total])).toEqual([[6, 2], [5, 1]]);
  });

  it('has the players that may vote: the living, without a flipped idiot', () => {
    const g = board();
    kill(g, 1);
    g.exile(12);
    expect(g.voters()).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('the sheriff', () => {
  it('is elected, or not, and the log says so', () => {
    const g = board();
    g.elect(5);
    expect(g.sheriff).toBe(5);
    g.elect(null, true);
    expect(g.sheriff).toBeNull();
    expect(entries(g, 'sheriff')).toEqual([
      { kind: 'sheriff', seat: 5, cancelled: false }, { kind: 'sheriff', seat: null, cancelled: true },
    ]);
  });

  it('hands the badge to a living player, or tears it up', () => {
    const g = board();
    g.elect(5);
    kill(g, 5);
    g.passBadge(5, 6);
    expect(g.sheriff).toBe(6);
    kill(g, 6);
    g.passBadge(6, null);
    expect(g.sheriff).toBeNull();
    expect(entries(g, 'badge')).toEqual([{ kind: 'badge', from: 5, to: 6 }, { kind: 'badge', from: 6, to: null }]);
  });

  it('cannot give the badge to the dead, nor give a badge it does not hold', () => {
    const g = board();
    g.elect(5);
    kill(g, 5, 6);
    g.passBadge(7, 8);
    expect(g.sheriff).toBe(5);
    g.passBadge(5, 6);
    expect(g.sheriff).toBeNull();
    expect(entries(g, 'badge')).toEqual([{ kind: 'badge', from: 5, to: null }]);
  });
});

describe('what may be named', () => {
  it('lets the wolves kill anyone alive, themselves and each other included', () => {
    const g = board();
    kill(g, 5);
    expect(g.options(1, { kind: 'kill' })).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('lets the seer check the living she has not checked yet', () => {
    const g = board();
    kill(g, 5);
    expect(g.options(9, { kind: 'check' })).toEqual([1, 2, 3, 4, 6, 7, 8, 10, 11, 12]);
    g.record([9], { kind: 'check', seat: 9, target: 1, wolf: true });
    g.record([2], { kind: 'check', seat: 2, target: 3, wolf: false });
    expect(g.options(9, { kind: 'check' })).toEqual([2, 3, 4, 6, 7, 8, 10, 11, 12]);
    expect([...g.checked(9)]).toEqual([1]);
  });

  it('lets a voter name the living others, or those a tie left, never himself or a flipped idiot', () => {
    const g = board();
    kill(g, 5);
    g.exile(12);
    const all = { kind: 'vote', why: 'exile', among: null } as const;
    expect(g.options(1, all)).toEqual([2, 3, 4, 6, 7, 8, 9, 10, 11]);
    expect(g.options(1, { kind: 'vote', why: 'exile', among: [1, 5, 6, 7, 12] })).toEqual([6, 7]);
    expect(g.options(1, { kind: 'vote', why: 'sheriff', among: [2, 3] })).toEqual([2, 3]);
  });

  it('lets a hunter and a sheriff name any living player but themselves', () => {
    const g = board();
    kill(g, 11);
    expect(g.options(11, { kind: 'shoot' })).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
    expect(g.options(11, { kind: 'shoot' })).not.toContain(11);
    expect(g.options(5, { kind: 'badge' })).not.toContain(11);
    expect(g.options(5, { kind: 'run' })).toEqual([]);
    expect(g.options(5, { kind: 'speak', talk: 'day' })).toEqual([]);
  });
});

describe('the talk', () => {
  it('goes round from the seat after the one named, over the living only', () => {
    const g = board();
    kill(g, 3);
    expect(g.talkOrder(0)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(g.talkOrder(2)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2]);
    expect(g.talkOrder(12)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(g.talkOrder(3)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2]);
  });

  it('puts what is said in the log, cut to its longest and cleaned, and drops an empty line', () => {
    const g = board();
    g.startNight();
    expect(g.say(5, 'day', '  hello \n there  ')).toBe('hello there');
    expect(g.say(5, 'day', '   ')).toBe('');
    expect(g.say(6, 'day', 'x'.repeat(1000))).toHaveLength(240);
    const said = entries(g, 'say');
    expect(said).toHaveLength(2);
    expect(said[0]).toEqual({ kind: 'say', day: 1, seat: 5, talk: 'day', text: 'hello there', meaning: noMeaning() });
  });

  it('keeps only what a speech may mean: a living suspect, a god claimed, seer results, a witch save', () => {
    const g = board();
    kill(g, 6);
    g.say(5, 'day', 'a', { suspect: 6, claim: 'wolf' });
    const found = [{ seat: 1, wolf: true }, { seat: 5, wolf: false }, { seat: 99, wolf: true }];
    g.say(5, 'day', 'b', { suspect: 5, claim: 'seer', checks: found });
    g.say(5, 'day', 'c', { suspect: 7, claim: 'witch', saved: 8, checks: [{ seat: 1, wolf: true }] });
    g.say(5, 'day', 'd', { suspect: 7.5, saved: 8, checks: [{ seat: 1, wolf: true }] });
    const m = entries(g, 'say').map((e) => (e.kind === 'say' ? e.meaning : null));
    expect(m[0]).toEqual({ suspect: null, claim: null, checks: [], saved: null });
    expect(m[1]).toEqual({ suspect: null, claim: 'seer', checks: [{ seat: 1, wolf: true }], saved: null });
    expect(m[2]).toEqual({ suspect: 7, claim: 'witch', checks: [], saved: 8 });
    expect(m[3]).toEqual(noMeaning());
  });
});

describe('what each player may read', () => {
  it('hides the entries meant for others and shows the ones for all', () => {
    const g = board();
    g.startNight();
    g.record([1, 2, 3, 4], { kind: 'wolfPick', seat: 1, target: 5 });
    g.record([9], { kind: 'check', seat: 9, target: 1, wolf: true });
    g.record([10], { kind: 'witchInfo', seat: 10, victim: 5, save: true, poison: true });
    g.say(6, 'day', 'hi');
    const kinds = (seat: number): string[] => g.viewFrom(seat, 0).entries.map((e) => e.kind);
    expect(kinds(5)).toEqual(['start', 'night', 'say']);
    expect(kinds(2)).toEqual(['start', 'wolves', 'night', 'wolfPick', 'say']);
    expect(kinds(9)).toEqual(['start', 'night', 'check', 'say']);
    expect(kinds(10)).toEqual(['start', 'night', 'witchInfo', 'say']);
  });

  it('hands over only what is new since the last look', () => {
    const g = board();
    const first = g.viewFrom(5, 0);
    g.startNight();
    const next = g.viewFrom(5, first.next);
    expect(next.entries).toEqual([{ kind: 'night', day: 1 }]);
    expect(g.viewFrom(5, next.next).entries).toEqual([]);
  });
});

describe('plurality', () => {
  it('picks the seat named most often', () => {
    expect(plurality([3, 5, 5, 7], () => 0)).toBe(5);
    expect(plurality([4], () => 0.9)).toBe(4);
  });

  it('breaks a tie by chance, and says nothing when nobody is named', () => {
    const seen = new Set<number | null>();
    const random = lcg(5);
    for (let i = 0; i < 40; i++) seen.add(plurality([3, 5, 7, 3, 5], random));
    expect([...seen].sort()).toEqual([3, 5]);
    expect(plurality([], () => 0)).toBeNull();
  });
});
