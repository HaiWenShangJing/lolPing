import { describe, expect, it } from 'vitest';
import { PET_IDS } from '../../../src/shared/teammate/pet';
import {
  ROLES, SAY_MAX, SEATS, WerewolfGame, type Answer, type Meaning, type Question, type Role, type Talk, type Who,
} from '../../../src/shared/teammate/werewolf';
import {
  checksOf, claimsIn, fallbackAnswer, wantsBoom, type Phrases,
} from '../../../src/shared/teammate/werewolfPlay';

/** A seeded generator whose first values differ from one seed to the next (mulberry32). */
const lcg = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const say: Phrases = {
  accuse: (n) => `accuse ${n}`,
  trust: (n) => `trust ${n}`,
  innocent: () => 'innocent',
  quiet: () => 'quiet',
  defend: () => 'defend',
  campaign: () => 'campaign',
  claimSeer: (checks) => `seer ${checks.map((c) => `${c.name}${c.wolf ? 'W' : 'G'}`).join(',')}`,
  claimWitch: (saved) => `witch ${saved ?? '-'}`,
  claimHunter: () => 'hunter',
  claimIdiot: () => 'idiot',
  last: (s) => `last ${s ?? '-'}`,
  join: (parts) => parts.join(' | '),
};
const nameOf = (s: number): string => `P${s}`;

const PETS: Who[] = PET_IDS.slice(0, SEATS);
/** Wolves 1-4, villagers 5-8, then the seer 9, the witch 10, the hunter 11 and the idiot 12. */
const board = (roles: readonly Role[] = ROLES): WerewolfGame =>
  WerewolfGame.seat(roles.map((role, i) => ({ who: PETS[i] as Who, role })));
const ask = (g: WerewolfGame, seat: number, q: Question, seed = 1): Answer =>
  fallbackAnswer(g, seat, q, lcg(seed), say, nameOf);
const out = (g: WerewolfGame, ...seats: number[]): void => {
  for (const s of seats) g.die(s, 'wolves');
  g.deaths.length = 0;
};
/** The seer's word at the table: she says she is the seer and whom she found. */
const seerSays = (g: WerewolfGame, seat: number, ...checks: { seat: number; wolf: boolean }[]): void => {
  g.say(seat, 'day', 'I am the seer.', { claim: 'seer', checks });
};

/** Whether `a` answers `q` legally for `seat`, as the game's driver requires. */
function legal(g: WerewolfGame, seat: number, q: Question, a: Answer): boolean {
  const options = g.options(seat, q);
  switch (q.kind) {
    case 'kill':
    case 'check': return a.kind === 'target' && options.includes(a.seat);
    case 'witch': {
      const poisonOk = a.kind === 'witch' && (a.poison === null || (q.poison && options.includes(a.poison)));
      return a.kind === 'witch' && (!a.save || q.save) && poisonOk;
    }
    case 'run': return a.kind === 'run';
    case 'speak': return a.kind === 'text' && a.text.trim() !== '' && a.text.length <= SAY_MAX;
    case 'vote': return a.kind === 'vote' && (a.seat === null || options.includes(a.seat));
    case 'shoot':
    case 'badge': return a.kind === 'pick' && (a.seat === null || options.includes(a.seat));
  }
}

/** Day 2: a night and a day behind it, two players dead, the idiot flipped, a sheriff, claims and accusations made. */
function secondDay(): WerewolfGame {
  const g = board();
  g.startNight();
  out(g, 6);
  g.endNight({ kill: null, saved: false, poisoned: null });
  g.deaths.length = 0;
  g.say(9, 'day', 'I am the seer.', { claim: 'seer', checks: [{ seat: 2, wolf: true }] });
  g.say(3, 'day', 'Seat 5 is a wolf.', { suspect: 5 });
  g.say(4, 'day', 'I am the seer, and 9 is lying.', { claim: 'seer', checks: [{ seat: 9, wolf: true }] });
  g.exile(12);
  g.elect(10);
  g.startNight();
  out(g, 8);
  return g;
}

const TALKS: Talk[] = ['day', 'campaign', 'pk', 'last'];
/** Every question `seat` can be asked in `g`, given its role. */
function questions(g: WerewolfGame, seat: number): Question[] {
  const role = g.player(seat).role;
  const qs: Question[] = [
    { kind: 'run' }, ...TALKS.map((talk): Question => ({ kind: 'speak', talk })),
    { kind: 'vote', why: 'exile', among: null }, { kind: 'vote', why: 'sheriff', among: [2, 5, 9, 11] },
    { kind: 'vote', why: 'exile', among: [3, 9] }, { kind: 'badge' },
  ];
  if (role === 'wolf') qs.push({ kind: 'kill' });
  if (role === 'seer') qs.push({ kind: 'check' });
  if (role === 'hunter') qs.push({ kind: 'shoot' });
  if (role === 'witch') {
    for (const victim of [null, 3, seat]) {
      for (const save of [true, false]) {
        for (const poison of [true, false]) qs.push({ kind: 'witch', victim, save, poison });
      }
    }
  }
  return qs;
}

describe('claims and checks', () => {
  it('reads one claim per player, the latest, and keeps what an earlier word of it said', () => {
    const g = board();
    g.startNight();
    g.say(9, 'day', 'Seer here.', { claim: 'seer', checks: [{ seat: 2, wolf: true }] });
    g.say(10, 'day', 'Witch here.', { claim: 'witch', saved: 3 });
    g.say(9, 'day', 'Still the seer.', { claim: 'seer', checks: [{ seat: 2, wolf: true }, { seat: 3, wolf: false }] });
    g.say(10, 'day', 'Yes, the witch.', { claim: 'witch' });
    g.say(5, 'day', 'Nothing special.', { suspect: 2 });
    const claims = claimsIn(g.log.map((l) => l.entry));
    expect(claims).toEqual([
      { seat: 9, role: 'seer', checks: [{ seat: 2, wolf: true }, { seat: 3, wolf: false }], saved: null },
      { seat: 10, role: 'witch', checks: [], saved: 3 },
    ]);
  });

  it('lists only the seer\'s own results, in order', () => {
    const g = board();
    g.record([9], { kind: 'check', seat: 9, target: 2, wolf: true });
    g.record([9], { kind: 'check', seat: 9, target: 6, wolf: false });
    g.record([4], { kind: 'check', seat: 4, target: 1, wolf: true });
    expect(checksOf(g.log.map((l) => l.entry), 9)).toEqual([{ seat: 2, wolf: true }, { seat: 6, wolf: false }]);
    expect(checksOf(g.log.map((l) => l.entry), 3)).toEqual([]);
  });
});

describe('a computer player without a mind', () => {
  it('answers every question it can be asked with a legal answer, whoever it is and whatever the table', () => {
    for (const g of [board(), secondDay()]) {
      for (const p of g.alive()) {
        for (const q of questions(g, p.seat)) {
          for (let seed = 1; seed <= 12; seed++) {
            const a = ask(g, p.seat, q, seed);
            expect(legal(g, p.seat, q, a), `${p.role} ${p.seat} ${JSON.stringify(q)} ${JSON.stringify(a)}`).toBe(true);
          }
        }
      }
    }
  });

  it('never answers with a seat it may not name: not a dead player, not itself, not a flipped idiot', () => {
    const g = secondDay();
    for (const p of g.alive()) {
      for (let seed = 1; seed <= 30; seed++) {
        const a = ask(g, p.seat, { kind: 'vote', why: 'exile', among: null }, seed);
        if (a.kind === 'vote' && a.seat !== null) {
          expect(g.player(a.seat).alive && !g.player(a.seat).flipped && a.seat !== p.seat).toBe(true);
        }
      }
    }
  });

  it('runs for sheriff by its role: the seer nearly always, the idiot hardly ever', () => {
    const share = (seat: number): number => {
      const g = board();
      const random = lcg(5);
      let runs = 0;
      for (let i = 0; i < 400; i++) {
        const a = fallbackAnswer(g, seat, { kind: 'run' }, random, say, nameOf);
        if (a.kind === 'run' && a.run) runs++;
      }
      return runs / 400;
    };
    expect(share(9)).toBeGreaterThan(0.75);
    expect(share(12)).toBeLessThan(0.2);
    expect(share(5)).toBeGreaterThan(0.12);
    expect(share(5)).toBeLessThan(0.4);
  });
});

describe('what a computer player may not know', () => {
  it('reads the table only through its own seat: the roles of the others change nothing', () => {
    // The same table, to the villager at seat 5 and to the wolf at seat 1, but for who is what among the others.
    const gods: Role[] = ROLES.slice(8);
    const wolvesAndVillagers: Role[] = ROLES.slice(0, 8);
    const forVillager: [Role[], Role[]] = [
      [...wolvesAndVillagers, ...gods],
      [...gods, 'villager', 'villager', 'villager', 'villager', 'wolf', 'wolf', 'wolf', 'wolf'],
    ];
    const forWolf: [Role[], Role[]] = [
      [...wolvesAndVillagers, ...gods],
      ['wolf', 'wolf', 'wolf', 'wolf', ...gods, 'villager', 'villager', 'villager', 'villager'],
    ];
    const history = (g: WerewolfGame): WerewolfGame => {
      g.startNight();
      out(g, 6);
      g.endNight({ kill: null, saved: false, poisoned: null });
      g.deaths.length = 0;
      g.say(9, 'day', 'I am the seer.', { claim: 'seer', checks: [{ seat: 3, wolf: true }] });
      g.say(7, 'day', 'I think 3 is a wolf.', { suspect: 3 });
      g.say(2, 'day', 'I think 9 lies.', { suspect: 9 });
      g.elect(7);
      g.startNight();
      return g;
    };
    const cases: [number, [Role[], Role[]]][] = [[5, forVillager], [1, forWolf]];
    for (const [seat, [a, b]] of cases) {
      const ga = history(board(a));
      const gb = history(board(b));
      expect(ga.player(seat).role).toBe(gb.player(seat).role);
      expect(ga.viewFrom(seat, 0).entries).toEqual(gb.viewFrom(seat, 0).entries);
      const wolf = ga.player(seat).role === 'wolf';
      for (let seed = 1; seed <= 15; seed++) {
        for (const q of questions(ga, seat)) {
          if (q.kind === 'witch' || q.kind === 'check' || q.kind === 'shoot') continue;
          expect(ask(ga, seat, q, seed), `${seat} ${JSON.stringify(q)}`).toEqual(ask(gb, seat, q, seed));
        }
        for (const when of ['campaign', 'talk', 'vote'] as const) {
          if (wolf) expect(wantsBoom(ga, seat, when, lcg(seed))).toBe(wantsBoom(gb, seat, when, lcg(seed)));
        }
      }
    }
  });
});

describe('the wolves', () => {
  it('knife a player who is not a wolf, and only on the first night a partner, to look like a victim', () => {
    const g = board();
    g.startNight();
    for (let seed = 1; seed <= 100; seed++) {
      const a = ask(g, 1, { kind: 'kill' }, seed);
      expect(a.kind === 'target' && g.options(1, { kind: 'kill' }).includes(a.seat)).toBe(true);
    }
    const never = (): number => 0.99;
    const a = fallbackAnswer(g, 1, { kind: 'kill' }, never, say, nameOf);
    expect(a.kind === 'target' && g.player(a.seat).role !== 'wolf').toBe(true);

    const knife = fallbackAnswer(g, 1, { kind: 'kill' }, () => 0, say, nameOf);
    expect(knife).toEqual({ kind: 'target', seat: 2 });
    g.startNight();
    const later = fallbackAnswer(g, 1, { kind: 'kill' }, () => 0, say, nameOf);
    expect(later.kind === 'target' && g.player(later.seat).role !== 'wolf').toBe(true);
  });

  it('go after the seer the table believes, more than any other player', () => {
    const g = board();
    g.startNight();
    g.endNight({ kill: null, saved: false, poisoned: null });
    seerSays(g, 9, { seat: 1, wolf: true });
    g.startNight();
    let seer = 0;
    const n = 300;
    for (let seed = 1; seed <= n; seed++) {
      const a = ask(g, 2, { kind: 'kill' }, seed);
      if (a.kind === 'target' && a.seat === 9) seer++;
      expect(a.kind === 'target' && g.player(a.seat).role !== 'wolf').toBe(true);
    }
    expect(seer / n).toBeGreaterThan(0.3);
  });

  it('never vote for a partner while there is anyone else', () => {
    const g = secondDay();
    for (const seat of [1, 2, 3, 4]) {
      for (let seed = 1; seed <= 60; seed++) {
        const a = ask(g, seat, { kind: 'vote', why: 'exile', among: null }, seed);
        if (a.kind === 'vote' && a.seat !== null) expect(g.player(a.seat).role).not.toBe('wolf');
      }
    }
  });

  it('stand up as a false seer against the real one, but only one wolf at a time', () => {
    const g = board();
    g.startNight();
    g.endNight({ kill: null, saved: false, poisoned: null });
    g.startNight();
    seerSays(g, 9, { seat: 3, wolf: false });
    const claimsOf = (seat: number): Partial<Meaning>[] => {
      const meanings: Partial<Meaning>[] = [];
      for (let seed = 1; seed <= 200; seed++) {
        const a = ask(g, seat, { kind: 'speak', talk: 'day' }, seed);
        if (a.kind === 'text' && a.meaning?.claim) meanings.push(a.meaning);
      }
      return meanings;
    };
    const first = claimsOf(1);
    expect(first.length).toBeGreaterThan(5);
    expect(first.every((m) => m.claim === 'seer' && (m.checks?.length ?? 0) > 0)).toBe(true);
    // Each false result names a living player other than the wolf itself.
    expect(first.every((m) => m.checks?.every((c) => c.seat !== 1 && g.player(c.seat).alive))).toBe(true);

    seerSays(g, 1, { seat: 4, wolf: false });
    expect(claimsOf(2)).toEqual([]);
    expect(claimsOf(3)).toEqual([]);
  });

  it('give a partner up as a wolf only when the seer\'s word is about to hang it', () => {
    const g = board();
    g.startNight();
    g.endNight({ kill: null, saved: false, poisoned: null });
    seerSays(g, 9, { seat: 2, wolf: true });
    g.say(5, 'day', 'Seat 2 is a wolf.', { suspect: 2 });
    g.say(6, 'day', 'Seat 2 is a wolf.', { suspect: 2 });
    let named = 0;
    let quiet = 0;
    for (let seed = 1; seed <= 200; seed++) {
      if (wantsBoom(g, 2, 'vote', lcg(seed))) named++;
      if (wantsBoom(g, 3, 'vote', lcg(seed))) quiet++;
    }
    expect(named).toBeGreaterThan(quiet);
    expect(named / 200).toBeLessThan(0.4);
  });
});

describe('self-destruct', () => {
  it('is never done by the last wolf, whatever the random says', () => {
    const g = board();
    g.startNight();
    out(g, 2, 3, 4);
    for (const when of ['campaign', 'talk', 'vote'] as const) expect(wantsBoom(g, 1, when, () => 0)).toBe(false);
  });

  it('is rare: next to never in the campaign, and with a wolf named by the seer, still not usual', () => {
    const g = board();
    g.startNight();
    g.endNight({ kill: null, saved: false, poisoned: null });
    expect(wantsBoom(g, 1, 'campaign', () => 0.5)).toBe(false);
    expect(wantsBoom(g, 1, 'talk', () => 0.5)).toBe(false);
    expect(wantsBoom(g, 1, 'vote', () => 0.5)).toBe(false);
    expect(wantsBoom(g, 1, 'campaign', () => 0)).toBe(true);
    seerSays(g, 9, { seat: 1, wolf: true });
    expect(wantsBoom(g, 1, 'vote', () => 0.03)).toBe(true);
    expect(wantsBoom(g, 3, 'vote', () => 0.03)).toBe(false);
    expect(wantsBoom(g, 1, 'vote', () => 0.5)).toBe(false);
  });
});

describe('the seer', () => {
  it('checks a player it has not checked, never itself', () => {
    const g = board();
    g.startNight();
    const seen = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const a = ask(g, 9, { kind: 'check' }, seed);
      if (a.kind === 'target') seen.add(a.seat);
    }
    expect(seen.has(9)).toBe(false);
    expect(seen.size).toBeGreaterThan(4);

    g.record([9], { kind: 'check', seat: 9, target: 4, wolf: true });
    g.record([9], { kind: 'check', seat: 9, target: 7, wolf: false });
    for (let seed = 1; seed <= 60; seed++) {
      const a = ask(g, 9, { kind: 'check' }, seed);
      expect(a.kind === 'target' && ![4, 7, 9].includes(a.seat)).toBe(true);
    }
  });

  it('says what it found, truly, and goes after the wolf it found', () => {
    const g = board();
    g.startNight();
    g.record([9], { kind: 'check', seat: 9, target: 2, wolf: true });
    g.endNight({ kill: null, saved: false, poisoned: null });
    const a = fallbackAnswer(g, 9, { kind: 'speak', talk: 'day' }, () => 0, say, nameOf);
    expect(a).toMatchObject({
      kind: 'text',
      text: 'seer P2W | accuse P2',
      meaning: { claim: 'seer', checks: [{ seat: 2, wolf: true }], suspect: 2 },
    });
    const last = fallbackAnswer(g, 9, { kind: 'speak', talk: 'last' }, () => 0, say, nameOf);
    expect(last).toMatchObject({ kind: 'text', text: 'seer P2W | last P2', meaning: { claim: 'seer' } });
  });

  it('votes for the wolf it found, and not for the player it found to be good', () => {
    const g = board();
    g.startNight();
    g.record([9], { kind: 'check', seat: 9, target: 2, wolf: true });
    g.record([9], { kind: 'check', seat: 9, target: 6, wolf: false });
    g.endNight({ kill: null, saved: false, poisoned: null });
    for (let seed = 1; seed <= 40; seed++) {
      const a = fallbackAnswer(g, 9, { kind: 'vote', why: 'exile', among: null }, lcg(seed), say, nameOf);
      expect(a.kind === 'vote' && a.seat !== 6).toBe(true);
    }
    const a = fallbackAnswer(g, 9, { kind: 'vote', why: 'exile', among: null }, () => 0.5, say, nameOf);
    expect(a).toEqual({ kind: 'vote', seat: 2 });
  });

  it('takes a second claimant for a liar, and votes for him', () => {
    const g = board();
    g.startNight();
    g.record([9], { kind: 'check', seat: 9, target: 2, wolf: true });
    g.endNight({ kill: null, saved: false, poisoned: null });
    seerSays(g, 4, { seat: 9, wolf: true });
    const a = fallbackAnswer(g, 9, { kind: 'vote', why: 'exile', among: [4, 6] }, () => 0.5, say, nameOf);
    expect(a).toEqual({ kind: 'vote', seat: 4 });
  });
});

describe('the witch', () => {
  const night = (n: number): WerewolfGame => {
    const g = board();
    for (let i = 0; i < n; i++) {
      g.startNight();
      if (i < n - 1) g.endNight({ kill: null, saved: false, poisoned: null });
    }
    return g;
  };

  it('saves the first night\'s victim almost always, and never when the game does not let her', () => {
    const g = night(1);
    const q = g.witchQuestion(7);
    expect(q.save).toBe(true);
    expect(fallbackAnswer(g, 10, q, () => 0.1, say, nameOf)).toEqual({ kind: 'witch', save: true, poison: null });
    let saved = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const a = fallbackAnswer(g, 10, q, lcg(seed), say, nameOf);
      if (a.kind === 'witch' && a.save) saved++;
    }
    expect(saved / 200).toBeGreaterThan(0.7);

    // Herself, on the second night, she may not: whatever the random says.
    const h = night(2);
    const self = h.witchQuestion(10);
    expect(self).toMatchObject({ victim: 10, save: false });
    for (let seed = 1; seed <= 40; seed++) {
      const a = fallbackAnswer(h, 10, self, lcg(seed), say, nameOf);
      expect(a).toMatchObject({ kind: 'witch', save: false });
    }
    // But on the first night she may save herself.
    expect(night(1).witchQuestion(10).save).toBe(true);
  });

  it('does not use the poison without a reason, and not when it is gone', () => {
    const h = night(2);
    for (let seed = 1; seed <= 100; seed++) {
      const a = fallbackAnswer(h, 10, h.witchQuestion(6), lcg(seed), say, nameOf);
      expect(a).toMatchObject({ kind: 'witch', poison: null });
    }
    seerSays(h, 9, { seat: 3, wolf: true });
    const q = h.witchQuestion(6);
    const a = fallbackAnswer(h, 10, q, () => 0.99, say, nameOf);
    expect(a).toEqual({ kind: 'witch', save: false, poison: 3 });
    const none = fallbackAnswer(h, 10, { ...q, poison: false }, () => 0.99, say, nameOf);
    expect(none).toEqual({ kind: 'witch', save: false, poison: null });
  });

  it('tells the truth about whom she saved, when she says she is the witch', () => {
    const g = night(2);
    g.record([10], { kind: 'witchDid', seat: 10, saved: 7, poisoned: null });
    const a = fallbackAnswer(g, 10, { kind: 'speak', talk: 'last' }, () => 0, say, nameOf);
    expect(a).toMatchObject({ kind: 'text', meaning: { claim: 'witch', saved: 7 } });
    if (a.kind === 'text') expect(a.text).toContain('witch P7');
  });
});

describe('the hunter and the sheriff', () => {
  it('shoots the player the table has the most against, never a player it knows is good', () => {
    const g = board();
    g.startNight();
    g.endNight({ kill: null, saved: false, poisoned: null });
    seerSays(g, 9, { seat: 3, wolf: true });
    let hit = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const a = ask(g, 11, { kind: 'shoot' }, seed);
      if (a.kind === 'pick' && a.seat === 3) hit++;
    }
    expect(hit / 100).toBeGreaterThan(0.6);

    const flipped = secondDay();
    for (let seed = 1; seed <= 60; seed++) {
      const a = ask(flipped, 11, { kind: 'shoot' }, seed);
      expect(a.kind === 'pick' && a.seat !== 12 && a.seat !== 11).toBe(true);
    }
  });

  it('hands the badge to who it trusts, a wolf to a partner or another, and never to the flipped idiot', () => {
    const g = board();
    g.startNight();
    g.endNight({ kill: null, saved: false, poisoned: null });
    seerSays(g, 9, { seat: 3, wolf: true });
    g.elect(5);
    let to9 = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const a = ask(g, 5, { kind: 'badge' }, seed);
      if (a.kind === 'pick' && a.seat === 9) to9++;
      expect(a.kind === 'pick' && a.seat !== 3).toBe(true);
    }
    expect(to9 / 100).toBeGreaterThan(0.5);

    const w = board();
    w.startNight();
    w.exile(12);
    w.elect(1);
    let partners = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const a = ask(w, 1, { kind: 'badge' }, seed);
      expect(a.kind === 'pick' && a.seat !== 12 && a.seat !== 1).toBe(true);
      if (a.kind === 'pick' && a.seat !== null && w.player(a.seat).role === 'wolf') partners++;
    }
    expect(partners).toBeGreaterThan(20);
    expect(partners).toBeLessThan(90);
  });

  it('tears the badge up when nobody is left to take it, or nobody is worth it', () => {
    const g = board();
    g.startNight();
    out(g, ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    g.elect(1);
    expect(ask(g, 1, { kind: 'badge' })).toEqual({ kind: 'pick', seat: null });
    expect(ask(g, 1, { kind: 'shoot' })).toEqual({ kind: 'pick', seat: null });
  });
});

describe('what a computer player says', () => {
  it('speaks every kind of talk in words of its own, short enough', () => {
    const g = secondDay();
    for (const p of g.alive()) {
      for (const talk of TALKS) {
        for (let seed = 1; seed <= 8; seed++) {
          const a = ask(g, p.seat, { kind: 'speak', talk }, seed);
          expect(a.kind).toBe('text');
          if (a.kind !== 'text') continue;
          expect(a.text.length).toBeGreaterThan(0);
          const m = a.meaning;
          if (m?.suspect !== null && m?.suspect !== undefined) {
            expect(m.suspect !== p.seat && g.player(m.suspect).alive).toBe(true);
          }
        }
      }
    }
  });

  it('campaigns in a campaign speech, defends itself when accused, and gives last words a suspect', () => {
    const g = board();
    g.startNight();
    g.endNight({ kill: null, saved: false, poisoned: null });
    const textOf = (talk: Talk): string => {
      const a = fallbackAnswer(g, 5, { kind: 'speak', talk }, () => 0.3, say, nameOf);
      if (a.kind !== 'text') throw new Error('Not a speech.');
      return a.text;
    };
    expect(textOf('campaign').startsWith('campaign')).toBe(true);
    expect(textOf('day')).not.toContain('defend');
    g.say(6, 'day', 'Seat 5 is a wolf.', { suspect: 5 });
    expect(textOf('day')).toContain('defend');
    expect(textOf('last')).toMatch(/last /);
    expect(textOf('last')).not.toContain('defend');
  });

  it('claims only the role it has, apart from the wolves, who only ever claim to be the seer', () => {
    const g = secondDay();
    const hits = new Map<Role, Set<string>>();
    for (const p of g.alive()) {
      for (let seed = 1; seed <= 60; seed++) {
        for (const talk of TALKS) {
          const a = ask(g, p.seat, { kind: 'speak', talk }, seed);
          const claim = a.kind === 'text' ? a.meaning?.claim : undefined;
          if (!claim) continue;
          const set = hits.get(p.role) ?? new Set<string>();
          set.add(claim);
          hits.set(p.role, set);
        }
      }
    }
    expect([...(hits.get('wolf') ?? [])]).toEqual(['seer']);
    expect(hits.has('villager')).toBe(false);
    for (const role of ['witch', 'hunter', 'idiot'] as const) {
      expect([...(hits.get(role) ?? [])].every((c) => c === role)).toBe(true);
    }
  });
});
