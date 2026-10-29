import { beforeAll, describe, expect, it } from 'vitest';
import { strings } from '../../../src/shared/i18n';
import { phrasesOf } from '../../../src/shared/teammate/gameText';
import { PET_IDS } from '../../../src/shared/teammate/pet';
import {
  isGod, ROLES, SAY_MAX, SEATS, SHERIFF_WEIGHT, WerewolfGame,
  type Answer, type Entry, type Question, type Role, type Side, type Talk, type Who,
} from '../../../src/shared/teammate/werewolf';
import { makeAi, MIND_BUDGET, type Mind } from '../../../src/shared/teammate/werewolfMind';
import { fallbackAnswer } from '../../../src/shared/teammate/werewolfPlay';
import {
  BoomButton, Boomed, MIND_PAUSE_MS, SAY_PAUSE_MS, STEP_MS, Stopped, runGame, type Phase, type RunEvent,
} from '../../../src/shared/teammate/werewolfRun';

const words = strings('en').teammate.games.werewolf;
const nameOf = (seat: number): string => `P${seat}`;

/** A seeded generator whose first values differ from one seed to the next (mulberry32). */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const PETS: Who[] = PET_IDS.slice(0, SEATS);

/** Wolves 1-4, villagers 5-8, then the seer 9, the witch 10, the hunter 11 and the idiot 12; `user` takes a seat. */
const board = (user: number | null = null): WerewolfGame =>
  WerewolfGame.seat(ROLES.map((role, i) => ({ who: i + 1 === user ? 'user' : PETS[i], role })));

/** Takes players out of the game without a word, as if they had died long ago. */
const bury = (game: WerewolfGame, ...seats: number[]): void => {
  for (const s of seats) game.die(s, 'wolves');
  game.deaths.length = 0;
};

type Of<K extends Entry['kind']> = Extract<Entry, { kind: K }>;
type StateEvent = Extract<RunEvent, { kind: 'state' }>;

const only = <K extends Entry['kind']>(list: readonly Entry[], kind: K): Of<K>[] =>
  list.filter((e) => e.kind === kind) as unknown as Of<K>[];

const kindOf = (e: Entry): string => (e.kind === 'say' ? `say:${e.seat}:${e.talk}` : e.kind);

/** An event that is the entry `kind` (satisfying `test`): the game is ended when it shows up. */
const upon = <K extends Entry['kind']>(kind: K, test: (e: Of<K>) => boolean = () => true) =>
  (e: RunEvent): boolean => e.kind === 'entry' && e.entry.kind === kind && test(e.entry as unknown as Of<K>);

const aim = (seat: number): Answer => ({ kind: 'target', seat });
const ballot = (seat: number | null): Answer => ({ kind: 'vote', seat });
const choose = (seat: number | null): Answer => ({ kind: 'pick', seat });
const potion = (save: boolean, poison: number | null = null): Answer => ({ kind: 'witch', save, poison });
const runs = (run: boolean): Answer => ({ kind: 'run', run });
const line = (text: string): Answer => ({ kind: 'text', text });

interface Played {
  game: WerewolfGame;
  events: RunEvent[];
  waits: number[];
  /** The side that won; null when the game was ended before its end. */
  winner: Side | null;
}

interface Setup {
  ai?: Mind;
  human?: (seat: number, q: Question) => Promise<Answer | null>;
  random?: () => number;
  minds?: boolean;
  boom?: BoomButton;
  /** Ends the game, as if its window were closed, as soon as an event satisfies this. */
  until?: (e: RunEvent) => boolean;
  /** Sees every event as it is emitted. */
  on?: (e: RunEvent) => void;
}

/** Plays `game` through `runGame` with pauses that take no time, and writes down what was emitted and waited for. */
async function play(game: WerewolfGame, s: Setup = {}): Promise<Played> {
  const events: RunEvent[] = [];
  const waits: number[] = [];
  const random = s.random ?? seeded(7);
  let closed = false;
  const done = (winner: Side | null): Played => ({ game, events, waits, winner });
  try {
    return done(await runGame({
      game,
      ai: s.ai ?? (async () => null),
      human: s.human ?? (async () => null),
      emit: (e) => {
        events.push(e);
        s.on?.(e);
        if (s.until?.(e)) closed = true;
      },
      wait: async (ms) => {
        waits.push(ms);
      },
      random,
      phrases: phrasesOf(words, random),
      nameOf,
      stopped: () => closed,
      minds: s.minds ?? false,
      boom: s.boom ?? new BoomButton(),
    }));
  } catch (err) {
    if (err instanceof Stopped) return done(null);
    throw err;
  }
}

/** What a scripted computer player answers, by question; a question with no script gets the rules' own answer. */
type Script = Partial<Record<Question['kind'], (seat: number, q: Question) => Answer | null>>;

/** A quiet table: the wolves take the lowest villager, nobody runs, nobody votes, nobody shoots. */
const calm = (game: WerewolfGame, over: Script = {}): Mind => {
  const script: Script = {
    kill: () => aim(game.alive().find((p) => p.role !== 'wolf')?.seat ?? 1),
    check: (seat, q) => aim(game.options(seat, q)[0] ?? 1),
    witch: () => potion(false),
    run: () => runs(false),
    vote: () => ballot(null),
    shoot: () => choose(null),
    badge: () => choose(null),
    ...over,
  };
  return async (seat, q) => script[q.kind]?.(seat, q) ?? null;
};

interface Asked {
  seat: number;
  day: number;
  q: Question;
}

/** A quiet table that also writes down every question it is asked. */
const recorded = (game: WerewolfGame, script: Script = {}): { ai: Mind; asked: Asked[] } => {
  const asked: Asked[] = [];
  const base = calm(game, script);
  return {
    asked,
    ai: async (seat, q) => {
      asked.push({ seat, day: game.day, q });
      return base(seat, q);
    },
  };
};

/** A scripted game with constant luck, so that nobody blows himself up unless the test makes him. */
const scene = (game: WerewolfGame, script: Script = {}, s: Setup = {}): Promise<Played> =>
  play(game, { random: () => 0.5, ai: calm(game, script), ...s });

const entriesOf = (p: Played): Entry[] => p.events.flatMap((e) => (e.kind === 'entry' ? [e.entry] : []));
const statesOf = (p: Played): StateEvent[] => p.events.filter((e): e is StateEvent => e.kind === 'state');
const speakers = (list: readonly Entry[], day: number, talk: string): number[] =>
  only(list, 'say').filter((e) => e.day === day && e.talk === talk).map((e) => e.seat);

/** The rules' own answers, for a user whom the test does not script. */
const byRules = (game: WerewolfGame, random: () => number) => {
  const phrases = phrasesOf(words, random);
  return async (seat: number, q: Question): Promise<Answer | null> =>
    fallbackAnswer(game, seat, q, random, phrases, nameOf);
};

describe('the self-destruct button', () => {
  it('is live only when armed, and a press is read once', () => {
    const b = new BoomButton();
    expect(b.armed).toBe(false);
    expect(b.press()).toBe(false);
    expect(b.take()).toBe(false);
    b.arm(true);
    expect(b.armed).toBe(true);
    expect(b.press()).toBe(true);
    expect(b.press()).toBe(false);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  it('forgets a press when it is switched off', () => {
    const b = new BoomButton();
    b.arm(true);
    b.press();
    b.arm(false);
    expect(b.armed).toBe(false);
    b.arm(true);
    expect(b.take()).toBe(false);
  });

  it('cuts short what is awaited when it is pressed', async () => {
    const b = new BoomButton();
    b.arm(true);
    const waiting = b.during(new Promise<string>(() => undefined));
    expect(b.press()).toBe(true);
    await expect(waiting).rejects.toBeInstanceOf(Boomed);
  });

  it('cuts short work begun after a press that nobody read yet', async () => {
    const b = new BoomButton();
    b.arm(true);
    b.press();
    await expect(b.during(new Promise<number>(() => undefined))).rejects.toBeInstanceOf(Boomed);
  });

  it('lets work finish when it is not pressed, or not live, and leaves nothing waiting behind', async () => {
    const b = new BoomButton();
    await expect(b.during(Promise.resolve(1))).resolves.toBe(1);
    b.arm(true);
    await expect(b.during(Promise.resolve(2))).resolves.toBe(2);
    expect(b.press()).toBe(true);
    expect(b.take()).toBe(true);
  });

  it('is told apart from a computer wolf by the seat a Boomed carries', () => {
    expect(new Boomed(3).seat).toBe(3);
    expect(new Boomed().seat).toBeNull();
    expect(new Boomed()).toBeInstanceOf(Error);
    expect(new Stopped()).toBeInstanceOf(Error);
  });
});

describe('the night', () => {
  it('has every living wolf propose, names the victim the most named, and tells only the pack', async () => {
    const game = board();
    const picks: Record<number, number> = { 1: 5, 2: 5, 3: 6, 4: 5 };
    await scene(game, { kill: (seat) => aim(picks[seat] ?? 5) }, { until: upon('wolfKill') });
    const proposals = game.log.filter((l) => l.entry.kind === 'wolfPick');
    expect(proposals.map((l) => l.entry)).toEqual([
      { kind: 'wolfPick', seat: 1, target: 5 },
      { kind: 'wolfPick', seat: 2, target: 5 },
      { kind: 'wolfPick', seat: 3, target: 6 },
      { kind: 'wolfPick', seat: 4, target: 5 },
    ]);
    expect(proposals.map((l) => l.to)).toEqual([[2, 3, 4], [1, 3, 4], [1, 2, 4], [1, 2, 3]]);
    expect(game.log.find((l) => l.entry.kind === 'wolfKill')).toEqual({
      to: [1, 2, 3, 4], entry: { kind: 'wolfKill', target: 5 },
    });
  });

  const lots: [number, number][] = [[0, 5], [0.99, 6]];
  it.each(lots)('leaves a tie between two victims to chance (luck %s picks seat %s)', async (luck, seat) => {
    const game = board();
    const picks: Record<number, number> = { 1: 5, 2: 6, 3: 5, 4: 6 };
    await scene(game, { kill: (s) => aim(picks[s] ?? 5) }, { random: () => luck, until: upon('wolfKill') });
    expect(only(game.log.map((l) => l.entry), 'wolfKill')).toEqual([{ kind: 'wolfKill', target: seat }]);
  });

  it('lets the wolves aim at anybody alive: a partner, or themselves', async () => {
    const game = board();
    const p = await scene(game, { kill: () => aim(1) }, { until: upon('dawn') });
    expect(only(entriesOf(p), 'dawn')).toEqual([{ kind: 'dawn', day: 1, died: [1] }]);
    expect(game.player(1).alive).toBe(false);
  });

  it('tells the seer, and only her, whether the player she checked is a wolf', async () => {
    for (const [target, wolf] of [[1, true], [5, false], [12, false]] as const) {
      const game = board();
      await scene(game, { check: () => aim(target) }, { until: upon('dawn') });
      expect(game.log.filter((l) => l.entry.kind === 'check')).toEqual([
        { to: [9], entry: { kind: 'check', seat: 9, target, wolf } },
      ]);
    }
  });

  it('has the seer check somebody new each night', async () => {
    const game = board();
    const p = await scene(game, {}, { until: upon('dawn', (e) => e.day === 2) });
    expect(only(entriesOf(p), 'check').map((c) => c.target)).toEqual([1, 2]);
  });

  it('goes wolves, seer, witch, dawn', async () => {
    const game = board();
    const p = await scene(game, {}, { until: upon('dawn') });
    const kinds = entriesOf(p).map(kindOf);
    expect(kinds.slice(kinds.indexOf('night'), kinds.indexOf('dawn') + 1)).toEqual([
      'night', 'wolfPick', 'wolfPick', 'wolfPick', 'wolfPick', 'wolfKill', 'check', 'witchInfo', 'witchDid', 'dawn',
    ]);
  });

  it('does not ask a seer or a witch who is dead', async () => {
    const game = board();
    bury(game, 9, 10);
    const { ai, asked } = recorded(game);
    await scene(game, {}, { ai, until: upon('dawn') });
    expect(asked.map((a) => a.q.kind)).toEqual(['kill', 'kill', 'kill', 'kill']);
    expect(game.log.some((l) => l.entry.kind === 'check' || l.entry.kind === 'witchInfo')).toBe(false);
  });
});

describe('the win condition (屠边)', () => {
  it.each([
    ['gods', [9, 10, 11, 12]],
    ['villagers', [5, 6, 7, 8]],
  ] as const)('the wolves win by killing every one of the %s', async (why, victims) => {
    const game = board();
    const p = await scene(game, { kill: () => aim(victims.find((s) => game.player(s).alive) ?? 1) });
    expect(p.winner).toBe('wolves');
    const list = entriesOf(p);
    expect(only(list, 'over')).toEqual([{ kind: 'over', winner: 'wolves', why }]);
    expect(only(list, 'dawn').map((d) => d.died)).toEqual(victims.map((s) => [s]));
    expect(game.players.filter((x) => !x.alive).map((x) => x.seat)).toEqual([...victims]);
    expect(game.wolves()).toHaveLength(4);
    // The last death ends the game at once: no talk, no vote.
    expect(list.slice(-2).map(kindOf)).toEqual(['dawn', 'over']);
    expect(p.events.at(-1)).toEqual({ kind: 'over', winner: 'wolves', why });
    expect(statesOf(p).at(-1)?.phase).toBe('over');
  });

  it('the village wins when the last wolf is exiled, and he has no last words', async () => {
    const game = board();
    bury(game, 2, 3, 4);
    const p = await scene(game, { vote: (seat) => ballot(seat === 1 ? null : 1) });
    expect(p.winner).toBe('village');
    const list = entriesOf(p);
    expect(only(list, 'over')).toEqual([{ kind: 'over', winner: 'village', why: 'wolves' }]);
    expect(only(list, 'votes')[0]).toMatchObject({ why: 'exile', out: 1 });
    expect(list.slice(list.findIndex((e) => e.kind === 'votes')).map(kindOf)).toEqual(['votes', 'over']);
  });

  it('the village wins when the hunter\'s shot kills the last wolf', async () => {
    const game = board();
    bury(game, 2, 3, 4);
    const p = await scene(game, { kill: () => aim(11), shoot: () => choose(1) });
    expect(p.winner).toBe('village');
    const list = entriesOf(p);
    expect(list.slice(-3).map(kindOf)).toEqual(['say:11:last', 'shot', 'over']);
  });

  it('gives the village the win when the last wolf and the last god fall together', async () => {
    const game = board();
    bury(game, 2, 3, 4, 9, 11, 12);
    const p = await scene(game, { kill: () => aim(10), witch: () => potion(false, 1) });
    const list = entriesOf(p);
    expect(only(list, 'dawn')).toEqual([{ kind: 'dawn', day: 1, died: [1, 10] }]);
    expect(only(list, 'over')).toEqual([{ kind: 'over', winner: 'village', why: 'wolves' }]);
    expect(p.winner).toBe('village');
  });

  it('gives the wolves the win when the hunter is the last god and the wolves kill him', async () => {
    const game = board();
    bury(game, 9, 10, 12);
    const { ai, asked } = recorded(game, { kill: () => aim(11), shoot: () => choose(1) });
    const p = await scene(game, {}, { ai });
    expect(only(entriesOf(p), 'over')).toEqual([{ kind: 'over', winner: 'wolves', why: 'gods' }]);
    expect(asked.some((a) => a.q.kind === 'shoot')).toBe(false);
  });

  it('knows nothing is over while a flipped idiot lives: he is still a god', async () => {
    const game = board();
    bury(game, 9, 10, 11);
    const p = await scene(game, {
      kill: () => aim(game.day === 1 ? 5 : 12),
      vote: (seat) => ballot(game.day === 1 ? (seat === 12 ? 1 : 12) : null),
    });
    expect(p.winner).toBe('wolves');
    const list = entriesOf(p);
    expect(only(list, 'flip')).toEqual([{ kind: 'flip', seat: 12 }]);
    expect(only(list, 'over')).toEqual([{ kind: 'over', winner: 'wolves', why: 'gods' }]);
    expect(only(list, 'dawn').map((d) => d.died)).toEqual([[5], [12]]);
  });

  it('stops asking questions the moment a death decides the game', async () => {
    const game = board();
    bury(game, 2, 3, 4);
    const { ai, asked } = recorded(game, { kill: () => aim(11), shoot: () => choose(1) });
    await scene(game, {}, { ai });
    expect(asked.at(-1)).toMatchObject({ seat: 11, q: { kind: 'shoot' } });
  });
});

describe('the hunter', () => {
  it('has his last words and then shoots when the wolves killed him', async () => {
    const game = board();
    const { ai, asked } = recorded(game, { kill: () => aim(11), shoot: () => choose(1) });
    const p = await scene(game, {}, { ai, until: upon('sheriff') });
    const list = entriesOf(p);
    const kinds = list.map(kindOf);
    const dawn = kinds.indexOf('dawn');
    expect(kinds.slice(dawn, dawn + 3)).toEqual(['dawn', 'say:11:last', 'shot']);
    expect(only(list, 'shot')).toEqual([{ kind: 'shot', hunter: 11, target: 1 }]);
    expect(game.player(1).alive).toBe(false);
    expect(kinds).not.toContain('say:1:last');
    expect(asked.filter((a) => a.q.kind === 'shoot').map((a) => a.seat)).toEqual([11]);
  });

  it('may decline to shoot', async () => {
    const game = board();
    const p = await scene(game, { kill: () => aim(11), shoot: () => choose(null) }, { until: upon('sheriff') });
    expect(only(entriesOf(p), 'shot')).toEqual([]);
    expect(game.alive()).toHaveLength(11);
  });

  it('has no shot when the witch poisoned him, but still his last words', async () => {
    const game = board();
    const { ai, asked } = recorded(game, { kill: () => aim(5), witch: () => potion(false, 11) });
    const p = await scene(game, {}, { ai, until: upon('sheriff') });
    const list = entriesOf(p);
    expect(only(list, 'dawn')[0]?.died).toEqual([5, 11]);
    expect(asked.some((a) => a.q.kind === 'shoot')).toBe(false);
    expect(only(list, 'shot')).toEqual([]);
    expect(speakers(list, 1, 'last')).toEqual([5, 11]);
    expect(game.poison).toBe(false);
  });

  it('kills the idiot outright with a shot: his card is not turned', async () => {
    const game = board();
    const p = await scene(game, { kill: () => aim(11), shoot: () => choose(12) }, { until: upon('sheriff') });
    expect(game.player(12)).toMatchObject({ alive: false, flipped: false });
    expect(only(entriesOf(p), 'flip')).toEqual([]);
  });

  it('shoots when exiled; his victim has no last words; a hunter-sheriff then hands over the badge', async () => {
    const game = board();
    const { ai, asked } = recorded(game, {
      run: (seat) => runs(seat === 11),
      vote: (seat) => ballot(seat === 11 ? 1 : 11),
      shoot: () => choose(2),
      badge: () => choose(9),
    });
    const p = await scene(game, {}, { ai, until: upon('night', (e) => e.day === 2) });
    const list = entriesOf(p);
    const kinds = list.map(kindOf);
    const at = kinds.indexOf('votes');
    expect(kinds.slice(at, at + 4)).toEqual(['votes', 'say:11:last', 'shot', 'badge']);
    expect(only(list, 'shot')).toEqual([{ kind: 'shot', hunter: 11, target: 2 }]);
    expect(only(list, 'badge')).toEqual([{ kind: 'badge', from: 11, to: 9 }]);
    expect(game.sheriff).toBe(9);
    expect(game.player(2).alive).toBe(false);
    expect(kinds).not.toContain('say:2:last');
    expect(asked.filter((a) => a.q.kind === 'shoot' || a.q.kind === 'badge').map((a) => [a.seat, a.q.kind]))
      .toEqual([[11, 'shoot'], [11, 'badge']]);
    expect(statesOf(p).at(-1)?.players.find((v) => v.sheriff)?.seat).toBe(9);
  });

  it('checks the win after the shot, before the badge: a shot that ends the game ends it', async () => {
    const game = board();
    bury(game, 2, 3, 4);
    const p = await scene(game, {
      run: (seat) => runs(seat === 11),
      vote: (seat) => ballot(seat === 11 ? 1 : 11),
      shoot: () => choose(1),
      badge: () => choose(9),
    });
    expect(p.winner).toBe('village');
    expect(only(entriesOf(p), 'badge')).toEqual([]);
  });
});

describe('the idiot', () => {
  it('turns his card when exiled, lives on without a vote, and still speaks', async () => {
    const game = board();
    const { ai, asked } = recorded(game, {
      vote: (seat) => ballot(game.day > 1 ? null : seat === 12 ? 1 : 12),
    });
    const p = await scene(game, {}, { ai, until: upon('votes', (e) => e.day === 2) });
    const list = entriesOf(p);
    expect(only(list, 'flip')).toEqual([{ kind: 'flip', seat: 12 }]);
    expect(game.player(12)).toMatchObject({ alive: true, flipped: true });
    expect(list.map(kindOf)).not.toContain('say:12:last');
    const dayTwo = asked.filter((a) => a.day === 2 && a.seat === 12).map((a) => a.q.kind);
    expect(dayTwo).toContain('speak');
    expect(dayTwo).not.toContain('vote');
    const second = only(list, 'votes').find((v) => v.day === 2);
    expect(second?.ballots.flatMap((b) => b.voters)).not.toContain(12);
    expect(second?.abstained).not.toContain(12);
    expect(statesOf(p).at(-1)?.players.find((v) => v.seat === 12)).toMatchObject({
      alive: true, flipped: true, role: 'idiot',
    });
    expect(speakers(list, 2, 'day')).toContain(12);
  });

  it('is turned only the first time: any other death is a death', async () => {
    const game = board();
    const p = await scene(game, { kill: () => aim(12) }, { until: upon('dawn') });
    expect(game.player(12)).toMatchObject({ alive: false, flipped: false });
    expect(only(entriesOf(p), 'flip')).toEqual([]);
  });

  it('is not a candidate for the votes once flipped', async () => {
    const game = board();
    const { ai, asked } = recorded(game, { vote: (seat) => ballot(game.day > 1 ? null : seat === 12 ? 1 : 12) });
    await scene(game, {}, { ai, until: upon('votes', (e) => e.day === 2) });
    const questions = asked.filter((a) => a.day === 2 && a.q.kind === 'vote');
    expect(questions).toHaveLength(9);
    expect(questions.map((a) => a.seat)).not.toContain(12);
  });
});

describe('the sheriff\'s election', () => {
  it('asks every living player whether he runs, in seat order', async () => {
    const game = board();
    const { ai, asked } = recorded(game);
    const p = await scene(game, {}, { ai, until: upon('sheriff') });
    expect(asked.filter((a) => a.q.kind === 'run').map((a) => a.seat)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]);
    expect(only(entriesOf(p), 'runners')).toEqual([{ kind: 'runners', seats: [] }]);
    expect(only(entriesOf(p), 'sheriff')).toEqual([{ kind: 'sheriff', seat: null, cancelled: false }]);
  });

  it('makes a lone runner sheriff without a speech or a vote', async () => {
    const game = board();
    const { ai, asked } = recorded(game, { run: (seat) => runs(seat === 9) });
    const p = await scene(game, {}, { ai, until: upon('sheriff') });
    const list = entriesOf(p);
    expect(only(list, 'runners')).toEqual([{ kind: 'runners', seats: [9] }]);
    expect(only(list, 'sheriff')).toEqual([{ kind: 'sheriff', seat: 9, cancelled: false }]);
    expect(speakers(list, 1, 'campaign')).toEqual([]);
    expect(only(list, 'votes')).toEqual([]);
    expect(asked.some((a) => a.q.kind === 'vote')).toBe(false);
    expect(statesOf(p).at(-1)?.players.find((v) => v.sheriff)?.seat).toBe(9);
  });

  it('has no sheriff when everybody runs: there is nobody left to vote', async () => {
    const game = board();
    const p = await scene(game, { run: () => runs(true) }, { until: upon('sheriff') });
    const list = entriesOf(p);
    expect(only(list, 'runners')[0]?.seats).toHaveLength(11);
    expect(only(list, 'sheriff')).toEqual([{ kind: 'sheriff', seat: null, cancelled: false }]);
    expect(only(list, 'votes')).toEqual([]);
  });

  it('lets the candidates speak, and only the others vote; the most votes wins', async () => {
    const game = board();
    const { ai, asked } = recorded(game, {
      run: (seat) => runs(seat === 9 || seat === 10),
      vote: (seat) => ballot(seat === 12 ? 10 : seat <= 4 ? 9 : seat === 11 ? 10 : null),
    });
    const p = await scene(game, {}, { ai, until: upon('sheriff') });
    const list = entriesOf(p);
    expect(speakers(list, 1, 'campaign')).toEqual([9, 10]);
    const [v] = only(list, 'votes');
    expect(v).toMatchObject({ why: 'sheriff', round: 1, out: 9, tied: [] });
    expect(v?.ballots).toEqual([
      { target: 9, voters: [1, 2, 3, 4], total: 4 },
      { target: 10, voters: [11, 12], total: 2 },
    ]);
    expect(v?.abstained).toEqual([6, 7, 8]);
    const voting = asked.filter((a) => a.q.kind === 'vote');
    expect(voting.map((a) => a.seat)).toEqual([1, 2, 3, 4, 6, 7, 8, 11, 12]);
    expect(voting.map((a) => (a.q.kind === 'vote' ? `${a.q.why} ${a.q.among?.join()}` : ''))).toEqual(
      voting.map(() => 'sheriff 9,10'),
    );
    expect(only(list, 'sheriff')).toEqual([{ kind: 'sheriff', seat: 9, cancelled: false }]);
    // The speeches come before the vote, the vote before the result.
    const kinds = list.map(kindOf);
    expect(kinds.slice(kinds.indexOf('runners'))).toEqual([
      'runners', 'say:9:campaign', 'say:10:campaign', 'votes', 'sheriff',
    ]);
  });

  const split = (game: WerewolfGame, second: number | null) => (seat: number): Answer => {
    const first = only(game.log.map((l) => l.entry), 'votes').length === 0;
    if (seat <= 4) return ballot(9);
    if (seat === 12) return ballot(first ? null : second);
    return ballot(10);
  };

  it('sends a tie to a second round: the tied speak again and are voted on again', async () => {
    const game = board();
    const { ai, asked } = recorded(game, {
      run: (seat) => runs(seat === 9 || seat === 10),
      vote: split(game, 9),
    });
    const p = await scene(game, {}, { ai, until: upon('sheriff') });
    const list = entriesOf(p);
    const votes = only(list, 'votes');
    expect(votes.map((v) => [v.round, v.out, v.tied])).toEqual([[1, null, [9, 10]], [2, 9, []]]);
    expect(only(list, 'sheriff')).toEqual([{ kind: 'sheriff', seat: 9, cancelled: false }]);
    const kinds = list.map(kindOf);
    expect(kinds.slice(kinds.indexOf('runners'))).toEqual([
      'runners', 'say:9:campaign', 'say:10:campaign', 'votes', 'say:9:pk', 'say:10:pk', 'votes', 'sheriff',
    ]);
    expect(asked.filter((a) => a.q.kind === 'vote' && a.q.among?.join() === '9,10')).toHaveLength(18);
  });

  it('has no sheriff when the second round ties again', async () => {
    const game = board();
    const p = await scene(game, { run: (seat) => runs(seat === 9 || seat === 10), vote: split(game, null) }, {
      until: upon('sheriff'),
    });
    const list = entriesOf(p);
    expect(only(list, 'votes').map((v) => [v.round, v.out, v.tied])).toEqual([[1, null, [9, 10]], [2, null, [9, 10]]]);
    expect(only(list, 'sheriff')).toEqual([{ kind: 'sheriff', seat: null, cancelled: false }]);
    expect(game.sheriff).toBeNull();
  });

  const heirs: [number | null, number[]][] = [
    [9, [10, 11, 12, 1, 2, 3, 4, 7, 8, 9]],
    [null, [1, 2, 3, 4, 7, 8, 9, 10, 11, 12]],
  ];
  it.each(heirs)('leaves the badge to %s when the sheriff dies; the talk starts after it', async (heir, order) => {
    const game = board();
    const { ai, asked } = recorded(game, {
      run: (seat) => runs(seat === 6),
      kill: () => aim(game.day === 1 ? 5 : 6),
      badge: () => choose(heir),
    });
    const p = await scene(game, {}, { ai, until: upon('votes', (e) => e.day === 2) });
    const list = entriesOf(p);
    expect(speakers(list, 1, 'day')).toEqual([7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 6]);
    expect(speakers(list, 2, 'day')).toEqual(order);
    expect(only(list, 'badge')).toEqual([{ kind: 'badge', from: 6, to: heir }]);
    expect(game.sheriff).toBe(heir);
    expect(asked.filter((a) => a.q.kind === 'badge').map((a) => a.seat)).toEqual([6]);
  });

  it('keeps the badge for itself when a mind names a dead player: it is torn', async () => {
    const game = board();
    const p = await scene(game, {
      run: (seat) => runs(seat === 6),
      kill: () => aim(game.day === 1 ? 5 : 6),
      badge: () => choose(5),
    }, { until: upon('badge') });
    expect(only(entriesOf(p), 'badge')).toHaveLength(1);
    expect(game.sheriff).not.toBe(5);
    const [badge] = only(entriesOf(p), 'badge');
    expect(badge?.to === null || game.player(badge?.to ?? 1).alive).toBe(true);
  });
});

describe('the exile vote', () => {
  it('counts the sheriff\'s vote one and a half, which breaks a 2-2 tie', async () => {
    const game = board();
    const ballots: Record<number, number> = { 6: 9, 7: 9, 1: 10, 8: 10 };
    const p = await scene(game, {
      run: (seat) => runs(seat === 6),
      vote: (seat) => ballot(ballots[seat] ?? null),
    }, { until: upon('votes') });
    const [v] = only(entriesOf(p), 'votes');
    expect(v).toMatchObject({ why: 'exile', round: 1, out: 9, tied: [] });
    expect(v?.ballots).toEqual([
      { target: 9, voters: [6, 7], total: 2.5 },
      { target: 10, voters: [1, 8], total: 2 },
    ]);
    expect(v?.abstained).toEqual([2, 3, 4, 9, 10, 11, 12]);
  });

  it('counts the same ballots as a tie when there is no sheriff', async () => {
    const game = board();
    const ballots: Record<number, number> = { 6: 9, 7: 9, 1: 10, 8: 10 };
    const p = await scene(game, { vote: (seat) => ballot(ballots[seat] ?? null) }, { until: upon('votes') });
    const [v] = only(entriesOf(p), 'votes');
    expect(v).toMatchObject({ out: null, tied: [9, 10] });
    expect(v?.ballots.map((b) => b.total)).toEqual([2, 2]);
  });

  const rounds: [string, Record<number, number>, number | null][] = [
    ['a second tie exiles nobody', { 1: 9, 8: 10 }, null],
    ['the second round exiles whoever wins it', { 1: 9, 6: 9, 8: 10 }, 9],
  ];
  it.each(rounds)('sends a tie to a second round among the tied: %s', async (_, second, exiled) => {
    const game = board();
    const first: Record<number, number> = { 6: 9, 7: 9, 1: 10, 8: 10 };
    const { ai, asked } = recorded(game, {
      vote: (seat) => {
        const round = only(game.log.map((l) => l.entry), 'votes').length;
        return ballot((round === 0 ? first : second)[seat] ?? null);
      },
    });
    const p = await scene(game, {}, { ai, until: upon('night', (e) => e.day === 2) });
    const list = entriesOf(p);
    expect(only(list, 'votes').map((v) => [v.round, v.out, v.tied])).toEqual([
      [1, null, [9, 10]], exiled === null ? [2, null, [9, 10]] : [2, exiled, []],
    ]);
    const kinds = list.map(kindOf);
    const at = kinds.indexOf('votes');
    expect(kinds.slice(at, at + 4)).toEqual(['votes', 'say:9:pk', 'say:10:pk', 'votes']);
    // Those the tie left do not vote again; the others vote among them only.
    const again = asked.filter((a) => a.q.kind === 'vote' && a.q.among !== null);
    expect(again.map((a) => a.seat)).toEqual([1, 2, 3, 4, 6, 7, 8, 11, 12]);
    expect(again.every((a) => a.q.kind === 'vote' && a.q.among?.join() === '9,10')).toBe(true);
    expect(game.player(9).alive).toBe(exiled === null);
    expect(game.player(10).alive).toBe(true);
    expect(speakers(list, 1, 'last')).toEqual(exiled === null ? [5] : [5, 9]);
  });

  it('asks every living player who may vote, in seat order, and lets them abstain', async () => {
    const game = board();
    const { ai, asked } = recorded(game, { vote: (seat) => ballot(seat === 2 ? 3 : null) });
    const p = await scene(game, {}, { ai, until: upon('votes') });
    expect(asked.filter((a) => a.q.kind === 'vote').map((a) => a.seat)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]);
    const [v] = only(entriesOf(p), 'votes');
    expect(v?.ballots).toEqual([{ target: 3, voters: [2], total: 1 }]);
    expect(v?.abstained).toEqual([1, 3, 4, 6, 7, 8, 9, 10, 11, 12]);
    expect(v).toMatchObject({ out: 3, tied: [] });
  });

  it('exiles nobody when everybody abstains', async () => {
    const game = board();
    const p = await scene(game, {}, { until: upon('night', (e) => e.day === 2) });
    expect(only(entriesOf(p), 'votes')[0]).toMatchObject({ out: null, tied: [], ballots: [] });
    expect(game.alive()).toHaveLength(11);
  });

  it('gives the exiled their last words', async () => {
    const game = board();
    const p = await scene(game, { vote: (seat) => ballot(seat === 7 ? 8 : 7) }, {
      until: upon('night', (e) => e.day === 2),
    });
    expect(speakers(entriesOf(p), 1, 'last')).toEqual([5, 7]);
    expect(game.player(7).alive).toBe(false);
  });

  it('gives last words to day-one deaths of the night only', async () => {
    const game = board();
    const p = await scene(game, {}, { until: upon('dawn', (e) => e.day === 3) });
    const list = entriesOf(p);
    expect(speakers(list, 1, 'last')).toEqual([5]);
    expect(speakers(list, 2, 'last')).toEqual([]);
  });
});

describe('self-destruct (自爆)', () => {
  it('lets the user, a wolf, blow himself up in the election: the election is off', async () => {
    const game = board(1);
    const boom = new BoomButton();
    const p = await scene(game, {}, {
      boom,
      human: async (_, q) => (q.kind === 'kill' ? aim(5) : new Promise<Answer | null>(() => undefined)),
      on: (e) => {
        if (e.kind === 'ask' && e.question.kind === 'run') boom.press();
      },
      until: upon('night', (e) => e.day === 2),
    });
    const list = entriesOf(p);
    const kinds = list.map(kindOf);
    expect(kinds.slice(kinds.indexOf('sheriff'))).toEqual(['sheriff', 'boom', 'night']);
    expect(only(list, 'sheriff')).toEqual([{ kind: 'sheriff', seat: null, cancelled: true }]);
    expect(only(list, 'runners')).toEqual([]);
    expect(only(list, 'boom')).toEqual([{ kind: 'boom', seat: 1 }]);
    expect(game.player(1)).toMatchObject({ alive: false, boomed: true });
    expect(kinds).not.toContain('say:1:last');
    expect(game.sheriff).toBeNull();
    expect(speakers(list, 1, 'day')).toEqual([]);
    expect(boom.armed).toBe(false);
    // The question that was open is closed.
    const flow = p.events.filter((e) => e.kind === 'ask' || e.kind === 'unask').map((e) => e.kind);
    expect(flow).toEqual(['ask', 'unask', 'ask', 'unask']);
  });

  it('lets him blow himself up when asked for his vote: nobody is exiled and the night follows', async () => {
    const game = board(1);
    const boom = new BoomButton();
    const p = await scene(game, {}, {
      boom,
      human: async (_, q) => {
        if (q.kind === 'kill') return aim(5);
        if (q.kind === 'run') return runs(false);
        if (q.kind === 'speak') return line('Nothing to report.');
        return new Promise<Answer | null>(() => undefined);
      },
      on: (e) => {
        if (e.kind === 'ask' && e.question.kind === 'vote') boom.press();
      },
      until: upon('night', (e) => e.day === 2),
    });
    const list = entriesOf(p);
    const kinds = list.map(kindOf);
    expect(only(list, 'votes')).toEqual([]);
    expect(kinds.slice(kinds.indexOf('boom'))).toEqual(['boom', 'night']);
    expect(speakers(list, 1, 'day')).toHaveLength(11);
    expect(game.player(1)).toMatchObject({ alive: false, boomed: true });
  });

  it('takes a press made while the user thinks of an answer, whatever he then answers', async () => {
    const game = board(1);
    const boom = new BoomButton();
    const p = await scene(game, {}, {
      boom,
      human: async (_, q) => {
        if (q.kind === 'kill') return aim(5);
        if (q.kind === 'run') {
          boom.press();
          return runs(false);
        }
        return null;
      },
      until: upon('night', (e) => e.day === 2),
    });
    expect(only(entriesOf(p), 'boom')).toEqual([{ kind: 'boom', seat: 1 }]);
    expect(p.winner).toBeNull();
  });

  it.each([['talk', 0], ['vote', 11]] as const)(
    'lets a computer wolf blow itself up as the %s begins: the day is over, no vote is held',
    async (phase, spoke) => {
      const game = board();
      let hot = false;
      const p = await scene(game, {}, {
        random: () => (hot ? 0 : 0.5),
        on: (e) => {
          if (e.kind === 'state' && e.phase === phase) hot = true;
          if (e.kind === 'entry' && e.entry.kind === 'boom') hot = false;
        },
        until: upon('night', (e) => e.day === 2),
      });
      const list = entriesOf(p);
      expect(only(list, 'boom')).toEqual([{ kind: 'boom', seat: 1 }]);
      expect(game.player(1)).toMatchObject({ alive: false, boomed: true });
      expect(speakers(list, 1, 'day')).toHaveLength(spoke);
      expect(only(list, 'votes')).toEqual([]);
      expect(list.map(kindOf)).not.toContain('say:1:last');
      const kinds = list.map(kindOf);
      expect(kinds.slice(kinds.indexOf('boom'))).toEqual(['boom', 'night']);
    },
  );

  it('cancels the election when a computer wolf blows itself up in it', async () => {
    const game = board();
    let hot = false;
    const p = await scene(game, { run: (seat) => runs(seat === 9 || seat === 10) }, {
      random: () => (hot ? 0 : 0.5),
      on: (e) => {
        if (e.kind === 'entry' && e.entry.kind === 'runners') hot = true;
        if (e.kind === 'entry' && e.entry.kind === 'boom') hot = false;
      },
      until: upon('night', (e) => e.day === 2),
    });
    const list = entriesOf(p);
    const kinds = list.map(kindOf);
    expect(kinds.slice(kinds.indexOf('runners'))).toEqual(['runners', 'sheriff', 'boom', 'night']);
    expect(only(list, 'sheriff')).toEqual([{ kind: 'sheriff', seat: null, cancelled: true }]);
    expect(game.sheriff).toBeNull();
  });

  it('hands the badge on even when the sheriff is the wolf who blew himself up', async () => {
    const game = board();
    let hot = false;
    const { ai, asked } = recorded(game, { run: (seat) => runs(seat === 1), badge: () => choose(9) });
    const p = await scene(game, {}, {
      ai,
      random: () => (hot ? 0 : 0.5),
      on: (e) => {
        if (e.kind === 'state' && e.phase === 'talk' && e.day === 2) hot = true;
        if (e.kind === 'entry' && e.entry.kind === 'boom') hot = false;
      },
      until: upon('night', (e) => e.day === 3),
    });
    const list = entriesOf(p);
    const kinds = list.map(kindOf);
    expect(kinds.slice(kinds.indexOf('boom'))).toEqual(['boom', 'badge', 'night']);
    expect(only(list, 'badge')).toEqual([{ kind: 'badge', from: 1, to: 9 }]);
    expect(game.sheriff).toBe(9);
    expect(asked.filter((a) => a.q.kind === 'badge').map((a) => a.seat)).toEqual([1]);
  });

  it('never makes the last wolf blow himself up', async () => {
    const game = board();
    bury(game, 2, 3, 4);
    const p = await scene(game, {}, { random: () => 0, until: upon('night', (e) => e.day === 2) });
    expect(only(entriesOf(p), 'boom')).toEqual([]);
    expect(speakers(entriesOf(p), 1, 'day')).toHaveLength(8);
  });

  it('does not let the user blow himself up in the night, or if he is not a wolf', async () => {
    const wolf = board(1);
    const boom = new BoomButton();
    let atNight: boolean | null = null;
    await scene(wolf, {}, {
      boom,
      human: async (_, q) => {
        if (q.kind === 'kill') atNight = boom.press();
        return q.kind === 'kill' ? aim(5) : null;
      },
      until: upon('dawn'),
    });
    expect(atNight).toBe(false);
    const villager = board(6);
    const p = await scene(villager, {}, { human: async () => line('hm'), until: upon('night', (e) => e.day === 2) });
    expect(statesOf(p).some((s) => s.boom)).toBe(false);
  });
});

describe('the witch', () => {
  it('may save herself on the first night', async () => {
    const game = board();
    const p = await scene(game, { kill: () => aim(10), witch: () => potion(true) }, { until: upon('dawn') });
    const list = entriesOf(p);
    expect(only(list, 'witchInfo')).toEqual([{ kind: 'witchInfo', seat: 10, victim: 10, save: true, poison: true }]);
    expect(only(list, 'witchDid')).toEqual([{ kind: 'witchDid', seat: 10, saved: 10, poisoned: null }]);
    expect(only(list, 'dawn')).toEqual([{ kind: 'dawn', day: 1, died: [] }]);
    expect(game.antidote).toBe(false);
    expect(game.poison).toBe(true);
  });

  it('may not save herself on a later night: her answer is refused, and she dies', async () => {
    const game = board();
    const p = await scene(game, { kill: () => aim(game.day === 1 ? 5 : 10), witch: () => potion(game.day > 1) }, {
      until: upon('dawn', (e) => e.day === 2),
    });
    const list = entriesOf(p);
    expect(only(list, 'witchInfo')[1]).toEqual({ kind: 'witchInfo', seat: 10, victim: 10, save: false, poison: true });
    expect(only(list, 'dawn')[1]?.died).toContain(10);
    expect(only(list, 'witchDid')[1]).toMatchObject({ saved: null });
    expect(game.antidote).toBe(true);
    expect(game.player(10).alive).toBe(false);
  });

  it('saves the wolves\' victim and keeps the poison: one potion a night, the save wins', async () => {
    const game = board();
    const p = await scene(game, { witch: () => potion(true, 6) }, { until: upon('dawn') });
    const list = entriesOf(p);
    expect(only(list, 'witchDid')).toEqual([{ kind: 'witchDid', seat: 10, saved: 5, poisoned: null }]);
    expect(only(list, 'dawn')[0]?.died).toEqual([]);
    expect(game.antidote).toBe(false);
    expect(game.poison).toBe(true);
  });

  it('is told of the attack only while she has the antidote, and is left alone once both are used', async () => {
    const game = board();
    const { ai, asked } = recorded(game, {
      kill: () => aim(game.day + 4),
      witch: () => (game.day === 1 ? potion(true) : potion(false, 1)),
    });
    const p = await scene(game, {}, { ai, until: upon('dawn', (e) => e.day === 3) });
    const list = entriesOf(p);
    expect(only(list, 'witchInfo')).toEqual([
      { kind: 'witchInfo', seat: 10, victim: 5, save: true, poison: true },
      { kind: 'witchInfo', seat: 10, victim: null, save: false, poison: true },
    ]);
    expect(only(list, 'witchDid')).toEqual([
      { kind: 'witchDid', seat: 10, saved: 5, poisoned: null },
      { kind: 'witchDid', seat: 10, saved: null, poisoned: 1 },
    ]);
    expect(asked.filter((a) => a.q.kind === 'witch').map((a) => a.day)).toEqual([1, 2]);
    expect(only(list, 'dawn').map((d) => d.died)).toEqual([[], [1, 6], [7]]);
    expect(game.antidote || game.poison).toBe(false);
  });

  it('refuses a poison that cannot be given: a dead player, a stranger to the table, or herself', async () => {
    for (const bad of [5, 10, 99]) {
      const game = board();
      bury(game, 5);
      const p = await scene(game, { kill: () => aim(6), witch: () => potion(false, bad) }, { until: upon('dawn') });
      expect(only(entriesOf(p), 'witchDid')[0]?.poisoned).not.toBe(bad);
    }
  });

  it('is asked only while she has a potion she may use', async () => {
    const game = board();
    game.antidote = false;
    game.poison = false;
    const { ai, asked } = recorded(game);
    const p = await scene(game, {}, { ai, until: upon('dawn') });
    expect(asked.some((a) => a.q.kind === 'witch')).toBe(false);
    expect(only(entriesOf(p), 'witchInfo')).toEqual([]);
  });
});

describe('when things go wrong', () => {
  it('ends with no winner when the game is closed', async () => {
    const game = board();
    const p = await scene(game, {}, { until: () => true });
    expect(p.winner).toBeNull();
    expect(p.events.some((e) => e.kind === 'over')).toBe(false);
  });

  it('ends when the window is closed on a question put to the user, closing the question first', async () => {
    const p = await scene(board(1), {}, { human: async () => null });
    expect(p.winner).toBeNull();
    expect(p.events.filter((e) => e.kind === 'ask' || e.kind === 'unask').map((e) => e.kind)).toEqual([
      'ask', 'unask',
    ]);
  });

  it('ends when a mind stops the game, and plays on when it merely fails', async () => {
    const stopped = await play(board(), { ai: async () => { throw new Stopped(); } });
    expect(stopped.winner).toBeNull();
    const failing = await play(board(), {
      random: seeded(3),
      ai: async () => {
        throw new Error('The mind crashed.');
      },
    });
    expect(failing.winner).not.toBeNull();
    expect(only(entriesOf(failing), 'over')).toHaveLength(1);
  });

  it('replaces the answers of a mind that makes no sense with the rules\' own', async () => {
    const p = await play(board(), { random: seeded(11), ai: async () => ballot(99) });
    expect(p.winner).not.toBeNull();
    expect(only(entriesOf(p), 'over')).toHaveLength(1);
  });

  it('replaces an empty speech of a computer player with the rules\' own', async () => {
    const game = board();
    const p = await scene(game, { speak: () => line('  ') }, { until: upon('votes') });
    expect(speakers(entriesOf(p), 1, 'day')).toHaveLength(11);
  });

  it.each([[aim(99)], [aim(0)], [ballot(3)], [choose(3)]])(
    'replaces an illegal answer of the user with the rules\' own: %j',
    async (bad) => {
      const game = board(1);
      const p = await scene(game, {}, {
        human: async (_, q) => (q.kind === 'kill' ? bad : null),
        until: upon('wolfKill'),
      });
      const [kill] = only(entriesOf(p), 'wolfKill');
      expect(game.options(1, { kind: 'kill' })).toContain(kill?.target);
    },
  );

  it.each([[''], ['   \n ']])('takes an empty speech of the user (%j) as a pass: nothing is said', async (text) => {
    const game = board(1);
    const p = await scene(game, {}, {
      human: async (_, q) => {
        if (q.kind === 'kill') return aim(5);
        if (q.kind === 'speak') return line(text);
        return q.kind === 'run' ? runs(false) : ballot(null);
      },
      until: upon('votes'),
    });
    expect(speakers(entriesOf(p), 1, 'day')).toEqual([2, 3, 4, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('cuts a long speech of the user to the length of a line', async () => {
    const game = board(1);
    const p = await scene(game, {}, {
      human: async (_, q) => (q.kind === 'kill' ? aim(5) : q.kind === 'run' ? runs(false) : line('x'.repeat(1000))),
      until: upon('say', (e) => e.seat === 1),
    });
    const said = only(entriesOf(p), 'say').find((e) => e.seat === 1);
    expect(said?.text).toHaveLength(SAY_MAX);
  });

  it('keeps what the user\'s speech means: whom it accuses, what it claims, what it reports', async () => {
    const game = board(1);
    const p = await scene(game, {}, {
      human: async (_, q) => {
        if (q.kind === 'kill') return aim(5);
        if (q.kind === 'run') return runs(false);
        return {
          kind: 'text', text: 'I am the seer: seat 7 is a wolf.',
          meaning: { suspect: 7, claim: 'seer', checks: [{ seat: 7, wolf: true }] },
        };
      },
      until: upon('say', (e) => e.seat === 1),
    });
    const said = only(entriesOf(p), 'say').find((e) => e.seat === 1);
    expect(said?.meaning).toEqual({ suspect: 7, claim: 'seer', checks: [{ seat: 7, wolf: true }], saved: null });
  });

  it('is not fooled by a speech that accuses the dead or claims what it cannot', async () => {
    const game = board(1);
    const p = await scene(game, {}, {
      human: async (_, q) => {
        if (q.kind === 'kill') return aim(5);
        if (q.kind === 'run') return runs(false);
        return { kind: 'text', text: 'It is five.', meaning: { suspect: 5, claim: 'villager', saved: 3 } };
      },
      until: upon('say', (e) => e.seat === 1),
    });
    const said = only(entriesOf(p), 'say').find((e) => e.seat === 1);
    expect(said?.meaning).toEqual({ suspect: null, claim: null, checks: [], saved: null });
  });
});

describe('the pace of the game', () => {
  const waitsOf = async (luck: number, minds: boolean): Promise<number[]> => {
    const game = board();
    const p = await scene(game, {}, { random: () => luck, minds, until: upon('dawn', (e) => e.day === 2) });
    return p.waits;
  };

  it('lets the lines of a rules-only game be told apart, a pause of 600 to 1200 ms between them', async () => {
    const mid = await waitsOf(0.5, false);
    expect(mid[0]).toBe(1500);
    expect(mid.filter((w) => w === 1500)).toHaveLength(1);
    expect(new Set(mid)).toEqual(new Set([1500, STEP_MS, 900]));
    expect(new Set(await waitsOf(0.9999, false))).toEqual(new Set([1500, STEP_MS, SAY_PAUSE_MS[1]]));
  });

  it('takes shorter pauses where minds take their own time', async () => {
    expect(new Set(await waitsOf(0.5, true))).toEqual(new Set([1500, STEP_MS, 425]));
    expect(new Set(await waitsOf(0.9999, true))).toEqual(new Set([1500, STEP_MS, MIND_PAUSE_MS[1]]));
  });

  it('waits only when something new was shown', async () => {
    const game = board();
    const p = await scene(game, {}, { until: upon('dawn', (e) => e.day === 2) });
    const shown = p.events.filter((e) => e.kind === 'entry').length;
    expect(p.waits.length).toBeLessThanOrEqual(shown);
  });
});

describe('what a playing user is asked and shown', () => {
  type AskEvent = Extract<RunEvent, { kind: 'ask' }>;
  const asksOf = (p: Played): AskEvent[] => p.events.filter((e): e is AskEvent => e.kind === 'ask');

  it('asks a user who is a wolf last, after his partners, and shows him their proposals', async () => {
    const game = board(1);
    const p = await scene(game, { kill: () => aim(5) }, {
      human: async (_, q) => (q.kind === 'kill' ? aim(8) : null),
      until: upon('dawn'),
    });
    const flow = p.events.filter((e) => e.kind !== 'state' && e.kind !== 'thinking')
      .map((e) => (e.kind === 'entry' ? kindOf(e.entry) : e.kind));
    expect(flow.slice(flow.indexOf('night'))).toEqual([
      'night', 'wolfPick', 'wolfPick', 'wolfPick', 'ask', 'unask', 'wolfKill', 'dawn',
    ]);
    expect(only(entriesOf(p), 'wolfPick').map((e) => [e.seat, e.target])).toEqual([[2, 5], [3, 5], [4, 5]]);
    expect(asksOf(p)).toEqual([
      { kind: 'ask', seat: 1, question: { kind: 'kill' }, options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    ]);
    expect(only(entriesOf(p), 'dawn')[0]?.died).toEqual([8]);
  });

  it('tells a witch user whom the wolves attacked and what she may do, and nothing of the wolves', async () => {
    const game = board(10);
    const p = await scene(game, {}, {
      human: async (_, q) => (q.kind === 'witch' ? potion(true) : null),
      until: upon('dawn'),
    });
    expect(asksOf(p)).toEqual([{
      kind: 'ask', seat: 10, question: { kind: 'witch', victim: 5, save: true, poison: true },
      options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12],
    }]);
    const list = entriesOf(p);
    expect(only(list, 'witchInfo')).toEqual([{ kind: 'witchInfo', seat: 10, victim: 5, save: true, poison: true }]);
    expect(only(list, 'witchDid')).toEqual([{ kind: 'witchDid', seat: 10, saved: 5, poisoned: null }]);
    expect(only(list, 'dawn')[0]?.died).toEqual([]);
    const kinds = list.map(kindOf);
    expect(kinds).not.toContain('wolfPick');
    expect(kinds).not.toContain('wolfKill');
    expect(kinds).not.toContain('check');
  });

  it('lets a user who is the seer check anybody but himself, and tells him the result alone', async () => {
    const game = board(9);
    const p = await scene(game, {}, {
      human: async (_, q) => (q.kind === 'check' ? aim(1) : null),
      until: upon('dawn'),
    });
    expect(asksOf(p)).toEqual([{
      kind: 'ask', seat: 9, question: { kind: 'check' }, options: [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12],
    }]);
    expect(only(entriesOf(p), 'check')).toEqual([{ kind: 'check', seat: 9, target: 1, wolf: true }]);
  });

  it('asks a user who is the hunter for his last words and then his shot', async () => {
    const game = board(11);
    const p = await scene(game, { kill: () => aim(11) }, {
      human: async (_, q) => (q.kind === 'speak' ? line('Goodbye.') : q.kind === 'shoot' ? choose(3) : null),
      until: upon('shot'),
    });
    expect(asksOf(p).map((e) => e.question)).toEqual([{ kind: 'speak', talk: 'last' }, { kind: 'shoot' }]);
    expect(asksOf(p)[1]?.options).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
    expect(only(entriesOf(p), 'shot')).toEqual([{ kind: 'shot', hunter: 11, target: 3 }]);
  });

  it('offers a voter every living player but himself', async () => {
    const game = board(6);
    const p = await scene(game, {}, {
      human: async (_, q) => (q.kind === 'speak' ? line('Hm.') : q.kind === 'run' ? runs(false) : ballot(null)),
      until: upon('votes'),
    });
    expect(asksOf(p).find((e) => e.question.kind === 'vote')).toEqual({
      kind: 'ask', seat: 6, question: { kind: 'vote', why: 'exile', among: null },
      options: [1, 2, 3, 4, 7, 8, 9, 10, 11, 12],
    });
  });

  const roles: [Role, number, string[]][] = [
    ['wolf', 1, ['kill', 'run', 'speak', 'vote']],
    ['villager', 6, ['run', 'speak', 'vote']],
    ['seer', 9, ['check', 'run', 'speak', 'vote']],
    ['witch', 10, ['witch', 'run', 'speak', 'vote']],
    ['hunter', 11, ['run', 'speak', 'vote']],
    ['idiot', 12, ['run', 'speak', 'vote']],
  ];
  it.each(roles)('asks a user who is the %s only what his role asks, in order', async (_, seat, kinds) => {
    const game = board(seat);
    const rules = byRules(game, seeded(5));
    const p = await scene(game, {}, {
      human: async (s, q) => (q.kind === 'kill' ? aim(5) : q.kind === 'run' ? runs(false) : rules(s, q)),
      until: upon('votes'),
    });
    expect(asksOf(p).map((e) => e.question.kind)).toEqual(kinds);
    expect(asksOf(p).every((e) => e.seat === seat)).toBe(true);
    expect(p.events.filter((e) => e.kind === 'unask')).toHaveLength(kinds.length);
  });
});

describe('who is shown as thinking', () => {
  const nightThoughts = (p: Played): number[][] => {
    let night = false;
    const thoughts: number[][] = [];
    for (const e of p.events) {
      if (e.kind === 'entry' && e.entry.kind === 'night') night = true;
      else if (e.kind === 'entry' && e.entry.kind === 'dawn') night = false;
      else if (e.kind === 'thinking' && night) thoughts.push(e.seats);
    }
    return thoughts;
  };

  it('shows a spectator the minds at work at night too', async () => {
    const p = await scene(board(), {}, { minds: true, until: upon('dawn') });
    expect(nightThoughts(p).some((seats) => seats.length > 0)).toBe(true);
  });

  it('does not show a playing user who thinks at night: it would give away the night roles', async () => {
    const p = await scene(board(6), {}, { minds: true, human: async () => null, until: upon('dawn') });
    expect(nightThoughts(p)).toEqual([]);
  });

  it('shows without minds only the speakers as thinking', async () => {
    const p = await scene(board(), {}, { until: upon('votes') });
    expect(nightThoughts(p)).toEqual([]);
    let named = new Set<number>();
    let said = 0;
    for (const e of p.events) {
      if (e.kind === 'thinking') for (const s of e.seats) named.add(s);
      if (e.kind === 'entry' && e.entry.kind === 'say') {
        expect(named.has(e.entry.seat)).toBe(true);
        named = new Set();
        said++;
      }
    }
    expect(said).toBeGreaterThan(10);
    expect(p.events.filter((e) => e.kind === 'thinking').at(-1)).toEqual({ kind: 'thinking', seats: [] });
  });
});

/** An `it` that looks at every game of a batch, filled in before the tests run, and names what is wrong with which. */
const eachGame = <G extends { seed: number }>(
  games: readonly G[], name: string, look: (game: G, bad: (what: string) => void) => void,
): void => {
  it(name, () => {
    const found: string[] = [];
    for (const g of games) look(g, (what) => found.push(`seed ${g.seed}: ${what}`));
    expect(games.length).toBeGreaterThan(0);
    expect(found.slice(0, 8)).toEqual([]);
  });
};

/** The table at some point of a game, rebuilt from the entries alone. */
interface Ctx {
  alive: Set<number>;
  sheriff: number | null;
  flipped: Set<number>;
  runners: number[];
  day: number;
}

/** Walks `list` in order, showing `visit` each entry with the table as it stood just before it. */
const replay = (game: WerewolfGame, list: readonly Entry[], visit: (e: Entry, c: Ctx, at: number) => void): Ctx => {
  const c: Ctx = {
    alive: new Set(game.players.map((x) => x.seat)), sheriff: null, flipped: new Set(), runners: [], day: 0,
  };
  list.forEach((e, at) => {
    visit(e, c, at);
    switch (e.kind) {
      case 'night':
        c.day = e.day;
        break;
      case 'dawn':
        e.died.forEach((s) => c.alive.delete(s));
        break;
      case 'runners':
        c.runners = e.seats;
        break;
      case 'votes':
        // An idiot exiled for the first time stays; his card is turned in the entry that follows.
        if (e.why === 'exile' && e.out !== null && (game.player(e.out).role !== 'idiot' || c.flipped.has(e.out))) {
          c.alive.delete(e.out);
        }
        break;
      case 'flip':
        c.flipped.add(e.seat);
        break;
      case 'shot':
        c.alive.delete(e.target);
        break;
      case 'boom':
        c.alive.delete(e.seat);
        break;
      case 'sheriff':
        c.sheriff = e.seat;
        break;
      case 'badge':
        c.sheriff = e.to;
        break;
      default:
        break;
    }
  });
  return c;
};

/** The living in the order of a day's talk: from the seat after the sheriff's, round to the sheriff's own. */
const talkFrom = (c: Ctx): number[] => {
  const alive = [...c.alive].sort((a, b) => a - b);
  const first = alive.findIndex((s) => s > (c.sheriff ?? 0));
  return first <= 0 ? alive : [...alive.slice(first), ...alive.slice(0, first)];
};

const standing = (game: WerewolfGame): { wolves: number; villagers: number; gods: number } => {
  const left = (test: (r: Role) => boolean): number => game.alive().filter((x) => test(x.role)).length;
  return { wolves: left((r) => r === 'wolf'), villagers: left((r) => r === 'villager'), gods: left(isGod) };
};

// One letter for each thing that can happen, so that the order of a whole game can be matched in one go.
const LETTERS: Partial<Record<Entry['kind'], string>> = {
  night: 'N', wolfPick: 'p', wolfKill: 'k', check: 'c', witchInfo: 'i', witchDid: 'd', dawn: 'D', runners: 'R',
  votes: 'V', sheriff: 'S', badge: 'B', flip: 'F', boom: 'X', shot: 'H', over: 'O',
};
const TALKS: Record<Talk, string> = { day: 's', campaign: 'm', pk: 'P', last: 'L' };
const letterOf = (e: Entry): string => (e.kind === 'say' ? TALKS[e.talk] : (LETTERS[e.kind] ?? ''));

// A night: the pack's proposals and its kill, the seer, the witch, the dawn, and what the dawn leaves to settle.
const NIGHT = '(?:Np+kc?(?:id)?D[LHB]*)';
// A day's talk ends in the exile vote (a tie sends it to a second round, an idiot may turn his card) or in a boom.
const TALK = '(?:s*(?:V(?:P+V)?F?[LHB]*|(?:VP*)?XB?))';
// The first day opens with the election, which a boom cancels.
const OPENING = `(?:R(?:m+V(?:P+V)?)?S${TALK}|R?m*V?P*SX)`;
const SHAPE = new RegExp(`^${NIGHT}(?:${OPENING}(?:${NIGHT}${TALK})*${NIGHT}?)?O$`);

describe('two hundred games played by the rules alone', () => {
  interface Sim {
    seed: number;
    p: Played;
    list: Entry[];
  }
  const sims: Sim[] = [];

  beforeAll(async () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = seeded(seed);
      const p = await play(WerewolfGame.deal(PETS, random), { random });
      sims.push({ seed, p, list: entriesOf(p) });
    }
  }, 300_000);

  it('plays the same game twice from the same seed, and other games from other seeds', async () => {
    const again = async (seed: number): Promise<string> => {
      const random = seeded(seed);
      return JSON.stringify(entriesOf(await play(WerewolfGame.deal(PETS, random), { random })));
    };
    expect(await again(5)).toBe(JSON.stringify(sims[4]?.list));
    expect(await again(6)).not.toBe(JSON.stringify(sims[4]?.list));
  });

  eachGame(sims, 'ends every game with one winner, for the reason the survivors show', ({ p, list }, bad) => {
    const end = only(list, 'over');
    const last = p.events.at(-1);
    if (p.winner === null || end.length !== 1 || list.at(-1)?.kind !== 'over') return bad('no single end');
    const ended = end[0];
    const agree = last?.kind === 'over' && last.winner === p.winner && last.winner === ended?.winner;
    if (last?.kind !== 'over' || !agree || last.why !== ended?.why) {
      return bad('the run and the log do not agree on the end');
    }
    const { wolves, villagers, gods } = standing(p.game);
    const holds = {
      wolves: wolves === 0, gods: gods === 0 && wolves > 0, villagers: villagers === 0 && gods > 0 && wolves > 0,
    };
    if (!holds[last.why]) bad(`${last.why} won with ${wolves} wolves, ${villagers} villagers and ${gods} gods left`);
    if ((last.why === 'wolves') !== (p.winner === 'village')) bad('the reason belongs to the other side');
    return undefined;
  });

  eachGame(sims, 'deals the board of 4 wolves, 4 villagers, seer, witch, hunter and idiot', ({ p }, bad) => {
    const roles = p.game.players.map((x) => x.role);
    if ([...roles].sort().join() !== [...ROLES].sort().join()) bad(`the roles are ${roles}`);
    if (new Set(p.game.players.map((x) => x.who)).size !== SEATS) bad('two seats share a pet');
  });

  const NEXT: Record<Phase, Phase[]> = {
    night: ['night', 'sheriff', 'talk', 'over'],
    sheriff: ['sheriff', 'talk', 'night', 'over'],
    talk: ['talk', 'vote', 'night', 'over'],
    vote: ['vote', 'night', 'over'],
    over: [],
  };
  eachGame(sims, 'moves the table through its phases in order, and never brings back the dead', ({ p }, bad) => {
    const states = statesOf(p);
    let alive = new Set(p.game.players.map((x) => x.seat));
    for (const [at, s] of states.entries()) {
      const before = at > 0 ? states[at - 1] : undefined;
      if (before && !NEXT[before.phase].includes(s.phase)) bad(`${before.phase} is followed by ${s.phase}`);
      if (before && s.day < before.day) bad('the day went back');
      if (s.players.length !== SEATS || s.players.some((v, i) => v.seat !== i + 1)) bad('the seats are out of order');
      if (s.players.filter((v) => v.sheriff).length > 1) bad('two sheriffs');
      const odd = s.players.some((v) => v.flipped && p.game.player(v.seat).role !== 'idiot');
      if (odd) bad('a card turned by a non-idiot');
      const now = new Set(s.players.filter((v) => v.alive).map((v) => v.seat));
      for (const seat of now) if (!alive.has(seat)) bad(`${seat} came back to life`);
      alive = now;
    }
    const last = states.at(-1);
    if (last?.phase !== 'over') bad(`the last phase is ${last?.phase}`);
    if ([...alive].join() !== p.game.alive().map((x) => x.seat).join()) bad('the last table is not the game\'s');
  });

  eachGame(sims, 'has only the living talk, and only the dead say their last words', ({ p, list }, bad) => {
    replay(p.game, list, (e, c) => {
      if (e.kind !== 'say') return;
      const living = c.alive.has(e.seat);
      if (living === (e.talk === 'last')) bad(`seat ${e.seat} said a ${e.talk} line ${living ? 'alive' : 'dead'}`);
    });
  });

  eachGame(sims, 'gives last words to the first night\'s dead and the exiled, once each', ({ p, list }, bad) => {
    const rights = new Set(only(list, 'dawn').find((d) => d.day === 1)?.died);
    for (const v of only(list, 'votes')) {
      if (v.why === 'exile' && v.out !== null && p.game.player(v.out).role !== 'idiot') rights.add(v.out);
    }
    const spoke = new Set<number>();
    for (const e of only(list, 'say')) {
      if (e.talk !== 'last') continue;
      if (!rights.has(e.seat)) bad(`seat ${e.seat} had no right to last words`);
      if (spoke.has(e.seat)) bad(`seat ${e.seat} spoke last twice`);
      spoke.add(e.seat);
    }
    // Whoever did not speak died as the game was decided: that death opens the settling that ends in the `over`.
    let at = list.length - 2;
    while (at >= 0 && ['say', 'shot', 'badge'].includes(list[at]?.kind ?? '')) at--;
    const cut = list[at];
    for (const seat of rights) {
      if (spoke.has(seat)) continue;
      const decided = (cut?.kind === 'dawn' && cut.died.includes(seat)) || (cut?.kind === 'votes' && cut.out === seat);
      if (!decided) bad(`seat ${seat} did not speak though the game went on`);
    }
  });

  eachGame(sims, 'counts every vote by the book: who votes, for whom, how much, who wins, the second round',
    ({ p, list }, bad) => {
      let first: Of<'votes'> | null = null;
      replay(p.game, list, (e, c) => {
        if (e.kind !== 'votes') return;
        const cast = [...e.ballots.flatMap((b) => b.voters), ...e.abstained].sort((a, b) => a - b);
        const open = [...c.alive].filter((s) => !c.flipped.has(s) && (e.why === 'exile' || !c.runners.includes(s)));
        const tied = first?.tied ?? [];
        const voters = (e.round === 1 ? open : open.filter((s) => !tied.includes(s))).sort((a, b) => a - b);
        if (cast.join() !== voters.join()) bad(`${e.why} ${e.round}: voters ${cast} instead of ${voters}`);
        const among = e.round === 2 ? tied : e.why === 'sheriff' ? c.runners : [...c.alive];
        for (const b of e.ballots) {
          if (!among.includes(b.target) || c.flipped.has(b.target) || b.voters.includes(b.target)) {
            bad(`${e.why} ${e.round}: a vote for ${b.target}`);
          }
          const worth = (s: number): number => (e.why === 'exile' && s === c.sheriff ? SHERIFF_WEIGHT : 1);
          const weight = b.voters.reduce((sum, s) => sum + worth(s), 0);
          if (b.total !== weight) bad(`${e.why} ${e.round}: ${b.target} has ${b.total} votes, not ${weight}`);
        }
        const sorted = [...e.ballots].sort((a, b) => b.total - a.total || a.target - b.target);
        if (JSON.stringify(sorted) !== JSON.stringify(e.ballots)) bad('the ballots are out of order');
        const top = e.ballots.filter((b) => b.total === e.ballots[0]?.total).map((b) => b.target);
        if (e.out !== (top.length === 1 ? top[0] : null) || e.tied.join() !== (top.length > 1 ? top.join() : '')) {
          bad(`${e.why} ${e.round}: out ${e.out} and tied ${e.tied} do not follow from the ballots`);
        }
        if (e.round === 2 && !(first && first.day === e.day && first.why === e.why && first.tied.length > 1)) {
          bad('a second round without a tie before it');
        }
        if (e.round === 1) first = e;
      });
    });

  eachGame(sims, 'elects the sheriff from the runners, and he passes the badge on or tears it when he dies',
    ({ p, list }, bad) => {
      if (only(list, 'sheriff').length > 1) bad('more than one election');
      let poll: Of<'votes'> | null = null;
      replay(p.game, list, (e, c, at) => {
        if (e.kind === 'votes' && e.why === 'sheriff') poll = e;
        if (e.kind === 'sheriff') {
          const won = e.cancelled ? null : (poll?.out ?? (c.runners.length === 1 ? c.runners[0] : null) ?? null);
          if (e.seat !== won) bad(`the sheriff is ${e.seat} where the runners and the vote make ${won}`);
          if (e.cancelled && list[at + 1]?.kind !== 'boom') bad('an election was cancelled by nothing');
        }
        if (e.kind === 'badge') {
          if (e.from !== c.sheriff || c.alive.has(e.from)) {
            bad(`the badge passed from ${e.from}, who is not a dead sheriff`);
          }
          if (e.to !== null && !c.alive.has(e.to)) bad(`the badge went to the dead ${e.to}`);
        }
        const dead = c.sheriff !== null && !c.alive.has(c.sheriff);
        if (dead && (e.kind === 'night' || e.kind === 'votes' || (e.kind === 'say' && e.talk !== 'last'))) {
          bad(`a dead sheriff keeps the badge into the ${e.kind}`);
        }
      });
    });

  eachGame(sims, 'has the talk go round the living from the seat after the sheriff\'s', ({ p, list }, bad) => {
    let expected: number[] = [];
    let spoke: number[] = [];
    replay(p.game, list, (e, c) => {
      if (e.kind === 'night') {
        expected = [];
        spoke = [];
      } else if (e.kind === 'say' && e.talk === 'day') {
        if (spoke.length === 0) expected = talkFrom(c);
        spoke.push(e.seat);
      } else if (e.kind === 'votes' && e.why === 'exile' && e.round === 1 && spoke.join() !== expected.join()) {
        bad(`day ${c.day}: the talk was ${spoke}, not ${expected}`);
      } else if (e.kind === 'boom' && spoke.join() !== expected.slice(0, spoke.length).join()) {
        bad(`day ${c.day}: the talk cut short was ${spoke}, not the start of ${expected}`);
      }
    });
  });

  eachGame(sims, 'plays the night by the book: pack, seer, witch and what the dawn finds', ({ p, list }, bad) => {
    const roleOf = (seat: number): Role => p.game.player(seat).role;
    let proposals: number[] = [];
    let kill: number | null = null;
    let night: { saved: boolean; poisoned: number | null } = { saved: false, poisoned: null };
    let antidote = true;
    let poison = true;
    const checked = new Set<number>();
    replay(p.game, list, (e, c) => {
      switch (e.kind) {
        case 'night':
          proposals = [];
          kill = null;
          night = { saved: false, poisoned: null };
          break;
        case 'wolfPick':
          if (roleOf(e.seat) !== 'wolf' || !c.alive.has(e.seat) || !c.alive.has(e.target)) {
            bad(`a bad pick ${e.seat}:${e.target}`);
          }
          proposals.push(e.target);
          break;
        case 'wolfKill': {
          const wolves = [...c.alive].filter((s) => roleOf(s) === 'wolf').length;
          if (proposals.length !== wolves || !proposals.includes(e.target)) {
            bad(`the kill ${e.target} of ${proposals}`);
          }
          kill = e.target;
          break;
        }
        case 'check':
          if (roleOf(e.seat) !== 'seer' || !c.alive.has(e.seat) || !c.alive.has(e.target) || e.target === e.seat) {
            bad(`a bad check ${e.seat}:${e.target}`);
          }
          if (checked.has(e.target)) bad(`${e.target} was checked twice`);
          if (e.wolf !== (roleOf(e.target) === 'wolf')) bad(`the check of ${e.target} is a lie`);
          checked.add(e.target);
          break;
        case 'witchInfo':
          if (roleOf(e.seat) !== 'witch' || !c.alive.has(e.seat)) bad('a dead witch was asked');
          if (!antidote && !poison) bad('a witch with no potion was asked');
          if (e.victim !== (antidote ? kill : null)) bad(`the witch was told ${e.victim}, the antidote ${antidote}`);
          if (e.save !== (antidote && kill !== null && (kill !== e.seat || c.day === 1))) bad('she may not save now');
          if (e.poison !== poison) bad('the poison is not as it was');
          break;
        case 'witchDid':
          if (e.saved !== null && (e.saved !== kill || e.poisoned !== null || !antidote)) {
            bad(`a bad save of ${e.saved}`);
          }
          if (e.saved !== null && e.saved === e.seat && c.day !== 1) bad('the witch saved herself after night 1');
          if (e.poisoned !== null && (!poison || !c.alive.has(e.poisoned) || e.poisoned === e.seat)) {
            bad(`a bad poisoning of ${e.poisoned}`);
          }
          if (e.saved !== null) antidote = false;
          if (e.poisoned !== null) poison = false;
          night = { saved: e.saved !== null, poisoned: e.poisoned };
          break;
        case 'dawn': {
          const died = night.saved || kill === null ? [] : [kill];
          if (!night.saved && night.poisoned !== null && night.poisoned !== kill) died.push(night.poisoned);
          if (died.sort((a, b) => a - b).join() !== e.died.join()) bad(`the dawn found ${e.died}, not ${died}`);
          break;
        }
        default:
          break;
      }
    });
    if (only(list, 'night').length !== only(list, 'dawn').length) bad('a night without a dawn');
    if (only(list, 'night').length !== p.game.day || p.game.day > 10) bad(`${p.game.day} nights`);
  });

  eachGame(sims, 'lets only a hunter killed by the wolves or exiled shoot, and only an idiot turn his card',
    ({ p, list }, bad) => {
      const cause = new Map<number, 'wolves' | 'poison' | 'exile'>();
      let poisoned: number | null = null;
      let shots = 0;
      replay(p.game, list, (e, c) => {
        if (e.kind === 'night') poisoned = null;
        if (e.kind === 'witchDid') poisoned = e.poisoned;
        if (e.kind === 'dawn') e.died.forEach((s) => cause.set(s, s === poisoned ? 'poison' : 'wolves'));
        if (e.kind === 'votes' && e.why === 'exile' && e.out !== null) cause.set(e.out, 'exile');
        if (e.kind === 'shot') {
          if (p.game.player(e.hunter).role !== 'hunter' || c.alive.has(e.hunter)) {
            bad('a shot by a living or non-hunter');
          }
          const how = cause.get(e.hunter);
          if (how !== 'wolves' && how !== 'exile') bad(`the hunter shot as he died of ${how}`);
          if (!c.alive.has(e.target) || e.target === e.hunter) bad(`the shot hit ${e.target}`);
          if (++shots > 1) bad('two shots');
        }
        if (e.kind === 'flip') {
          if (p.game.player(e.seat).role !== 'idiot' || c.flipped.has(e.seat)) bad(`${e.seat} turned a card`);
        }
      });
    });

  eachGame(sims, 'ends the day at once when a wolf blows himself up, and never the last wolf', ({ p, list }, bad) => {
    let boomed = false;
    replay(p.game, list, (e, c) => {
      if (e.kind === 'night') boomed = false;
      if (boomed && (e.kind === 'say' || e.kind === 'votes' || e.kind === 'runners')) bad(`a ${e.kind} after a boom`);
      if (e.kind === 'boom') {
        boomed = true;
        if (p.game.player(e.seat).role !== 'wolf' || !c.alive.has(e.seat)) bad(`${e.seat} blew himself up`);
        const pack = [...c.alive].filter((s) => p.game.player(s).role === 'wolf');
        if (pack.length < 2) bad('the last wolf blew himself up');
      }
    });
  });

  eachGame(sims, 'goes through the game in the order of the rules, from night to the end', ({ list }, bad) => {
    const shape = list.map(letterOf).join('');
    if (!SHAPE.test(shape)) bad(shape);
  });

  eachGame(sims, 'keeps a pace a spectator can follow: a pause of 600 to 1500 ms at most', ({ p }, bad) => {
    for (const w of p.waits) if (w < 600 || w > 1500) bad(`a wait of ${w} ms`);
    if (p.waits[0] !== 1500) bad('no pause on the first night');
  });

  it('plays varied games: both sides win, wolves blow themselves up, every rule comes up', () => {
    const count = (test: (s: Sim) => boolean): number => sims.filter(test).length;
    const seen = (test: (e: Entry) => boolean): number => count((s) => s.list.some(test));
    const sum = (list: number[]): number => list.reduce((a, b) => a + b, 0);
    const stats = {
      village: count((s) => s.p.winner === 'village'),
      wolves: count((s) => s.p.winner === 'wolves'),
      byGods: seen((e) => e.kind === 'over' && e.why === 'gods'),
      byVillagers: seen((e) => e.kind === 'over' && e.why === 'villagers'),
      booms: seen((e) => e.kind === 'boom'),
      cancelled: seen((e) => e.kind === 'sheriff' && e.cancelled),
      sheriffs: seen((e) => e.kind === 'sheriff' && e.seat !== null),
      polls: seen((e) => e.kind === 'votes' && e.why === 'sheriff'),
      campaigns: seen((e) => e.kind === 'say' && e.talk === 'campaign'),
      secondPolls: seen((e) => e.kind === 'votes' && e.why === 'sheriff' && e.round === 2),
      secondExiles: seen((e) => e.kind === 'votes' && e.why === 'exile' && e.round === 2),
      exiles: seen((e) => e.kind === 'votes' && e.why === 'exile' && e.out !== null),
      shots: seen((e) => e.kind === 'shot'),
      flips: seen((e) => e.kind === 'flip'),
      handed: seen((e) => e.kind === 'badge' && e.to !== null),
      torn: seen((e) => e.kind === 'badge' && e.to === null),
      saves: seen((e) => e.kind === 'witchDid' && e.saved !== null),
      poisons: seen((e) => e.kind === 'witchDid' && e.poisoned !== null),
      seerClaims: seen((e) => e.kind === 'say' && e.meaning.claim === 'seer'),
      checksTold: seen((e) => e.kind === 'say' && e.meaning.checks.length > 0),
      nights: sum(sims.map((s) => s.p.game.day)) / sims.length,
      longest: Math.max(...sims.map((s) => s.p.game.day)),
      says: sum(sims.map((s) => only(s.list, 'say').length)) / sims.length,
      seconds: sum(sims.map((s) => sum(s.p.waits))) / sims.length / 1000,
      slowest: Math.max(...sims.map((s) => sum(s.p.waits))) / 1000,
    };
    // Measured over these seeds: 115 against 85, 58 and 27 wins by the gods and the villagers, 71 booms,
    // 4.3 nights and 40 speeches a game, 67 s of pauses. The bounds leave room to tune the players.
    expect(stats.village).toBeGreaterThanOrEqual(50);
    expect(stats.wolves).toBeGreaterThanOrEqual(50);
    expect(stats.byGods).toBeGreaterThanOrEqual(10);
    expect(stats.byVillagers).toBeGreaterThanOrEqual(5);
    expect(stats.booms).toBeGreaterThanOrEqual(20);
    expect(stats.cancelled).toBeGreaterThanOrEqual(1);
    expect(stats.sheriffs).toBeGreaterThanOrEqual(120);
    expect(stats.polls).toBeGreaterThanOrEqual(100);
    expect(stats.campaigns).toBeGreaterThanOrEqual(100);
    expect(stats.secondPolls).toBeGreaterThanOrEqual(1);
    expect(stats.secondExiles).toBeGreaterThanOrEqual(1);
    expect(stats.exiles).toBeGreaterThanOrEqual(150);
    expect(stats.shots).toBeGreaterThanOrEqual(40);
    expect(stats.flips).toBeGreaterThanOrEqual(10);
    expect(stats.handed).toBeGreaterThanOrEqual(60);
    expect(stats.saves).toBeGreaterThanOrEqual(100);
    expect(stats.poisons).toBeGreaterThanOrEqual(20);
    expect(stats.seerClaims).toBeGreaterThanOrEqual(100);
    expect(stats.checksTold).toBeGreaterThanOrEqual(100);
    expect(stats.nights).toBeGreaterThan(3);
    expect(stats.nights).toBeLessThan(6);
    expect(stats.longest).toBeLessThanOrEqual(10);
    expect(stats.says).toBeGreaterThan(20);
    expect(stats.says).toBeLessThan(80);
    expect(stats.seconds).toBeGreaterThan(30);
    expect(stats.seconds).toBeLessThan(150);
    expect(stats.slowest).toBeLessThan(300);
  });
});

describe('what a playing user may see, over many games', () => {
  interface Seated {
    seed: number;
    user: number;
    role: Role;
    p: Played;
  }
  const games: Seated[] = [];

  beforeAll(async () => {
    for (let seed = 1; seed <= 48; seed++) {
      const random = seeded(seed);
      const game = WerewolfGame.deal(['user', ...PETS.slice(0, SEATS - 1)], random);
      const user = game.seatOfUser();
      if (user === null) throw new Error('The user has no seat.');
      const p = await play(game, { random, human: byRules(game, seeded(seed + 500)), minds: seed % 2 === 0 });
      games.push({ seed, user, role: game.player(user).role, p });
    }
  }, 300_000);

  it('gives the user every role, and ends every game', () => {
    const every = new Set<Role>(['wolf', 'villager', 'seer', 'witch', 'hunter', 'idiot']);
    expect(new Set(games.map((g) => g.role))).toEqual(every);
    expect(games.every((g) => g.p.winner !== null)).toBe(true);
  });

  eachGame(games, 'shows him only the roles he may know: his own, his pack, a turned idiot, all at the end',
    ({ user, p }, bad) => {
      const pack = p.game.player(user).role === 'wolf';
      for (const s of statesOf(p)) {
        for (const v of s.players) {
          const real = p.game.player(v.seat).role;
          const known = s.phase === 'over' || v.seat === user || v.flipped || (pack && real === 'wolf');
          if (v.role !== null && v.role !== real) bad(`seat ${v.seat} is shown as ${v.role}, not ${real}`);
          const boomed = p.game.player(v.seat).boomed;
          if (v.role !== null && !known && !boomed) bad(`seat ${v.seat} (${real}) is shown too soon`);
          if (v.role === null && known) bad(`seat ${v.seat} is hidden from the one who knows it`);
        }
      }
    });

  eachGame(games, 'shows him every role once the game is over', ({ p }, bad) => {
    const last = statesOf(p).at(-1);
    const hidden = last?.players.some((v) => v.role !== p.game.player(v.seat).role);
    if (last?.phase !== 'over' || hidden) bad('not all shown');
  });

  eachGame(games, 'sends him exactly the entries he may read, in order', ({ user, p }, bad) => {
    const mine = p.game.log.filter((l) => l.to === 'all' || l.to.includes(user)).map((l) => l.entry);
    if (JSON.stringify(entriesOf(p)) !== JSON.stringify(mine)) bad('the entries sent are not the entries he may read');
  });

  eachGame(games, 'keeps the secrets of the other roles from him', ({ user, role, p }, bad) => {
    for (const e of entriesOf(p)) {
      const secret = e.kind === 'wolfPick' || e.kind === 'wolfKill' || e.kind === 'wolves';
      if (secret && role !== 'wolf') bad(`a ${e.kind} shown to a ${role}`);
      if (e.kind === 'check' && role !== 'seer') bad(`a check shown to a ${role}`);
      if ((e.kind === 'witchInfo' || e.kind === 'witchDid') && role !== 'witch') bad(`a potion shown to a ${role}`);
      if (e.kind === 'start' && e.seat !== user) bad('the role of another seat');
    }
  });

  eachGame(games, 'asks him only what his role asks, closing each question in turn', ({ user, role, p }, bad) => {
    const needs: Partial<Record<Question['kind'], Role>> = {
      kill: 'wolf', check: 'seer', witch: 'witch', shoot: 'hunter',
    };
    let open = false;
    let alive = new Set(p.game.players.map((x) => x.seat));
    for (const e of p.events) {
      if (e.kind === 'state') alive = new Set(e.players.filter((v) => v.alive).map((v) => v.seat));
      if (e.kind === 'ask') {
        if (open) bad('a question over another');
        open = true;
        const need = needs[e.question.kind];
        if (e.seat !== user) bad(`seat ${e.seat} was asked`);
        if (need !== undefined && need !== role) bad(`a ${e.question.kind} asked of a ${role}`);
        if (e.options.some((s) => !alive.has(s))) bad(`${e.question.kind} offers the dead`);
        if (e.question.kind !== 'kill' && e.options.includes(user)) bad(`${e.question.kind} offers himself`);
      }
      if (e.kind === 'unask') {
        if (!open) bad('a question closed that was not open');
        open = false;
      }
    }
    if (open) bad('a question left open');
  });

  eachGame(games, 'does not show him who thinks at night, nor himself thinking', ({ user, p }, bad) => {
    let night = false;
    for (const e of p.events) {
      if (e.kind === 'entry' && e.entry.kind === 'night') night = true;
      else if (e.kind === 'entry' && e.entry.kind === 'dawn') night = false;
      else if (e.kind === 'thinking') {
        if (night && e.seats.length > 0) bad(`${e.seats} thinking at night`);
        if (e.seats.includes(user)) bad('the user is shown thinking');
      }
    }
  });

  eachGame(games, 'offers him the self-destruct button only as a living wolf by day', ({ user, role, p }, bad) => {
    let offered = false;
    for (const s of statesOf(p)) {
      const me = s.players.find((v) => v.seat === user);
      if (s.boom && (role !== 'wolf' || !me?.alive || !['sheriff', 'talk', 'vote'].includes(s.phase))) {
        bad(`the button in the ${s.phase}`);
      }
      if (s.phase === 'talk' && me?.alive && !offered) {
        offered = true;
        if (role === 'wolf' && !s.boom) bad('no button when the talk began');
      }
    }
  });
});

describe('the request budget of the minds', () => {
  interface Cost {
    seed: number;
    user: boolean;
    winner: Side | null;
    total: number;
    kill: number;
    check: number;
    witch: number;
    speak: number;
    said: number;
    nights: number;
    asleep: number;
  }
  const costs: Cost[] = [];

  /** A game whose minds answer at random but legally, writing down every request made of them. */
  const minded = async (seed: number, user: boolean, budget?: number): Promise<Cost> => {
    const random = seeded(seed);
    const game = WerewolfGame.deal(user ? ['user', ...PETS.slice(0, SEATS - 1)] : PETS, random);
    const me = game.seatOfUser();
    const prompts: { seat: number; text: string }[] = [];
    const luck = seeded(seed + 900);
    const ai = makeAi({
      game,
      budget,
      character: (seat) => ({ name: nameOf(seat), persona: 'A plain player.' }),
      names: nameOf,
      language: 'English',
      ask: async (seat, text) => {
        prompts.push({ seat, text });
        const others = game.alive().map((x) => x.seat).filter((s) => s !== seat);
        const other = others[Math.floor(luck() * others.length)] ?? null;
        if (text.includes('{"say"')) return JSON.stringify({ say: `Seat ${other} worries me.`, suspect: other });
        if (text.includes('At most one potion tonight')) return '{"save": true, "poison": null}';
        return JSON.stringify({ target: other });
      },
    });
    const p = await play(game, {
      random, ai, minds: true, human: me === null ? undefined : byRules(game, seeded(seed + 500)),
    });
    const has = (marker: string): number => prompts.filter((x) => x.text.includes(marker)).length;
    return {
      seed,
      user: me !== null,
      winner: p.winner,
      total: prompts.length,
      kill: has('Night: the wolves choose whom to kill'),
      check: has('choose one player to check'),
      witch: has('At most one potion tonight'),
      speak: has('{"say"'),
      said: only(entriesOf(p), 'say').filter((e) => e.seat !== me).length,
      nights: game.day,
      asleep: prompts.filter((x) => x.seat === me).length,
    };
  };

  beforeAll(async () => {
    for (let seed = 1; seed <= 20; seed++) costs.push(await minded(seed, false), await minded(seed, true));
  }, 300_000);

  eachGame(costs, 'puts at most one night move a night to the minds, whatever the pack or the table', (c, bad) => {
    if (c.winner === null) bad('no winner');
    if (Math.max(c.kill, c.check, c.witch) > c.nights) bad(`${c.kill}/${c.check}/${c.witch} in ${c.nights} nights`);
    if (c.speak > c.said) bad(`${c.speak} speech requests for ${c.said} speeches`);
  });

  eachGame(costs, 'stays within the budget of a game, and never asks a mind for the user\'s seat', (c, bad) => {
    if (c.total > MIND_BUDGET) bad(`${c.total} requests`);
    if (c.asleep > 0) bad('the user\'s seat was asked');
  });

  it('is frugal: how many requests a whole game costs', () => {
    // Measured over these 40 games: 59 requests on average, 44 to 82 at the extremes.
    const totals = costs.map((c) => c.total);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    expect(mean).toBeGreaterThan(30);
    expect(mean).toBeLessThanOrEqual(80);
    expect(Math.max(...totals)).toBeLessThanOrEqual(MIND_BUDGET);
  });

  it('plays on by the rules once the budget is spent', async () => {
    const c = await minded(3, false, 5);
    expect(c.total).toBe(5);
    expect(c.winner).not.toBeNull();
  });
});