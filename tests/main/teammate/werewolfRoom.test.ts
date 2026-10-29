import { beforeAll, describe, expect, it } from 'vitest';
import { WOLF_AI_SEATS, WerewolfRoom } from '../../../src/main/teammate/werewolfRoom';
import type { WolfAsk, WolfIn, WolfOut, WolfSeat } from '../../../src/shared/gameIpc';
import { strings } from '../../../src/shared/i18n';
import { PET_IDS, type PetId } from '../../../src/shared/teammate/pet';
import { SAY_MAX, SEATS, type Role, type Side, type WinReason } from '../../../src/shared/teammate/werewolf';
import { MIND_BUDGET } from '../../../src/shared/teammate/werewolfMind';
import { MIND_PAUSE_MS, SAY_PAUSE_MS } from '../../../src/shared/teammate/werewolfRun';
import { fakeBrain, fakeServices, tick } from './gameFakes';

const en = strings('en', 'win').teammate;
const zh = strings('zh-CN', 'win').teammate;
const w = en.games.werewolf;

type Over = NonNullable<Parameters<typeof fakeServices>[0]>;
type Post<K extends WolfOut['kind']> = Extract<WolfOut, { kind: K }>;
/** How the user answers a question; null leaves it unanswered. */
type Policy = (ask: WolfAsk, turn: number) => WolfIn | null;

const only = <K extends WolfOut['kind']>(posts: readonly WolfOut[], kind: K): Post<K>[] =>
  posts.filter((m) => m.kind === kind) as unknown as Post<K>[];

/** A seeded generator whose first values differ from one seed to the next (mulberry32). */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Some of the pets, a different few for each seed, picked by the user. */
const picksFor = (seed: number): PetId[] => PET_IDS.slice(seed % 4, (seed % 4) + (seed % 9));

const mineIn = (seats: readonly WolfSeat[] | undefined): WolfSeat | undefined => seats?.find((s) => s.me);

const seatOf = (ask: WolfAsk, turn: number): number | null =>
  ask.options.length === 0 ? null : (ask.options[turn % ask.options.length] ?? null);

/** A user who answers every question, now with a seat, now abstaining, passing or tearing the badge. */
const answerTo: Policy = (ask, turn) => {
  const seat = seatOf(ask, turn);
  switch (ask.kind) {
    case 'kill':
    case 'check': return { t: 'target', seat: seat ?? 1 };
    case 'vote': return { t: 'vote', seat: turn % 6 === 0 ? null : seat };
    case 'speak': return { t: 'say', text: turn % 4 === 0 ? '' : 'I am only a villager.' };
    case 'witch': return { t: 'witch', save: ask.save, poison: !ask.save && turn % 3 === 0 ? seat : null };
    case 'run': return { t: 'run', run: turn % 2 === 0 };
    case 'shoot':
    case 'badge': return { t: 'pick', seat: turn % 7 === 0 ? null : seat };
  }
};

/** The room, what it posted, and a user who answers the questions put to him. */
function table(over: Over = {}) {
  const { seed = 1, ...rest } = over;
  const posts: WolfOut[] = [];
  const { services, clock } = fakeServices({ random: seeded(seed), ...rest });
  const room = new WerewolfRoom(services, (m) => posts.push(m));
  let answered = 0;
  let turn = 0;

  const last = <K extends WolfOut['kind']>(kind: K): Post<K> | undefined => {
    for (let i = posts.length - 1; i >= 0; i--) {
      const m = posts[i];
      if (m?.kind === kind) return m as Post<K>;
    }
    return undefined;
  };
  const lastAsk = (): WolfAsk | null => last('ask')?.ask ?? null;
  const answer = (msg: WolfIn): void => {
    answered = posts.length;
    room.on(msg);
  };

  /** Turns the clock, answering each new question with `policy`, until `done`; false if it never does. */
  const play = async (done: () => boolean, policy: Policy | null = answerTo, noise?: () => void): Promise<boolean> => {
    for (let i = 0; i < 20_000; i++) {
      if (done()) return true;
      noise?.();
      const ask = lastAsk();
      if (policy && ask && posts.length > answered) {
        answered = posts.length;
        const reply = policy(ask, turn++);
        if (reply) room.on(reply);
      }
      if (!clock.fire()) await tick();
    }
    return false;
  };

  return {
    room, posts, clock, services, answer, play, last, lastAsk,
    start: (pets: PetId[] = [], playing = true): void => room.on({ t: 'start', pets, play: playing }),
    finish: (policy: Policy | null = answerTo, noise?: () => void) =>
      play(() => last('over') !== undefined, policy, noise),
    states: () => only(posts, 'state'),
    lines: () => only(posts, 'line'),
  };
}

type Table = ReturnType<typeof table>;

/** The first `count` seeds at which the user is dealt `role`. */
async function dealt(role: Role, count = 1): Promise<number[]> {
  const seeds: number[] = [];
  for (let seed = 1; seed < 1000 && seeds.length < count; seed++) {
    const t = table({ seed });
    t.start([], true);
    await tick();
    const mine = mineIn(t.states()[0]?.seats);
    t.room.stop();
    if (mine?.role === role) seeds.push(seed);
  }
  if (seeds.length < count) throw new Error(`not enough seeds deal ${role}`);
  return seeds;
}

interface Game {
  seed: number;
  playing: boolean;
  picks: PetId[];
  done: boolean;
  posts: WolfOut[];
}

async function playOut(seed: number, playing: boolean, policy: Policy = answerTo): Promise<Game> {
  const picks = picksFor(seed);
  const t = table({ seed });
  t.start(picks, playing);
  const done = await t.finish(policy);
  return { seed, playing, picks, done, posts: t.posts };
}

type Posted = { posts: readonly WolfOut[] };
const statesOf = (g: Posted) => only(g.posts, 'state');
const linesOf = (g: Posted) => only(g.posts, 'line');
const asksOf = (g: Posted): WolfAsk[] =>
  only(g.posts, 'ask').map((m) => m.ask).filter((a): a is WolfAsk => a !== null);

const WHYS: Record<WinReason, string> = { wolves: w.winVillage, gods: w.winGods, villagers: w.winVillagers };

/** Who has won when the table looks like `seats` (all roles shown), by 屠边. */
function verdictOf(seats: readonly WolfSeat[]): { winner: Side; why: WinReason } | null {
  const alive = (...roles: Role[]): number =>
    seats.filter((s) => s.alive && s.role !== null && roles.includes(s.role)).length;
  if (alive('wolf') === 0) return { winner: 'village', why: 'wolves' };
  if (alive('seer', 'witch', 'hunter', 'idiot') === 0) return { winner: 'wolves', why: 'gods' };
  if (alive('villager') === 0) return { winner: 'wolves', why: 'villagers' };
  return null;
}

const rosterOf = (seats: readonly WolfSeat[]): string =>
  w.reveal(seats.map((s) => `${s.seat}. ${s.name} ${s.roleName}`).join(' / '));

const countRoles = (seats: readonly WolfSeat[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const s of seats) counts[s.role ?? 'hidden'] = (counts[s.role ?? 'hidden'] ?? 0) + 1;
  return counts;
};
const BOARD = { wolf: 4, villager: 4, seer: 1, witch: 1, hunter: 1, idiot: 1 };

/** Whether `seats` show the board: four wolves, four villagers, and one each of the gods. */
const hasBoard = (seats: readonly WolfSeat[]): boolean =>
  seats.length === SEATS
  && Object.entries(BOARD).every(([role, n]) => seats.filter((s) => s.role === role).length === n);

const NEEDS: Partial<Record<WolfAsk['kind'], Role>> = { kill: 'wolf', check: 'seer', witch: 'witch', shoot: 'hunter' };

/** The secret lines a user who holds `role` may be shown, with the seats as they stand at the end. */
function secretsFor(role: Role, seats: readonly WolfSeat[]): Set<string> {
  const names = seats.map((s) => s.name);
  const allowed = new Set<string>([`${w.youAre(w.role[role])} ${w.roleHint[role]}`]);
  if (role === 'wolf') {
    const pack = seats.filter((s) => s.role === 'wolf');
    allowed.add(w.wolves(w.join(pack.filter((s) => !s.me).map((s) => s.name))));
    for (const a of pack) for (const b of names) allowed.add(w.wolfPick(a.name, b));
    for (const b of names) allowed.add(w.wolfKill(b));
  }
  if (role === 'seer') {
    for (const n of names) allowed.add(w.check(n, true)).add(w.check(n, false));
  }
  if (role === 'witch') {
    const who: (string | null)[] = [null, ...names];
    for (const n of who) allowed.add(w.witchInfo(n));
    for (const a of who) for (const b of who) allowed.add(w.witchDid(a, b));
  }
  return allowed;
}

/** One test over a batch of games, which names the games that fail it. */
function eachGame<G extends Game>(
  games: G[] | (() => G[]),
  title: string,
  check: (g: G, bad: (why: string) => void) => void,
): void {
  it(title, () => {
    const bad: string[] = [];
    const batch = typeof games === 'function' ? games() : games;
    for (const g of batch) check(g, (why) => bad.push(`seed ${g.seed}${g.playing ? '' : ' (watched)'}: ${why}`));
    expect(batch.length).toBeGreaterThan(0);
    expect(bad.slice(0, 6)).toEqual([]);
  });
}

type Reply = (seat: number, prompt: string) => string | null;
const MARK = 'ZXQ';

/** A mind that answers each question in the format it asks for, naming a seat at random but not a wolf's partner. */
function rambler(seed: number): Reply {
  const luck = seeded(seed + 900);
  const partners = new Map<number, number[]>();
  return (seat, prompt) => {
    const pack = /Your fellow wolves: ([^\n]*)/.exec(prompt)?.[1];
    if (pack) partners.set(seat, [...pack.matchAll(/#(\d+)/g)].map((m) => Number(m[1])));
    const avoid = [seat, ...(partners.get(seat) ?? [])];
    const others = Array.from({ length: SEATS }, (_, i) => i + 1).filter((s) => !avoid.includes(s));
    const other = (): number => others[Math.floor(luck() * others.length)] ?? 1;
    if (prompt.includes('{"say"')) {
      return JSON.stringify({ say: `${MARK} Seat ${other()} worries me.`, suspect: other() });
    }
    if (prompt.includes('At most one potion tonight')) {
      return JSON.stringify({ save: luck() < 0.7, poison: luck() < 0.15 ? other() : null });
    }
    return JSON.stringify({ target: other() });
  };
}

/** A table whose pets think with a fake Copilot CLI that answers with `reply`; the prompts it was sent are kept. */
function thinking(seed: number, reply: Reply = rambler(seed), over: Over = {}) {
  const prompts: { seat: number; text: string }[] = [];
  const mind = fakeBrain((seat, text) => {
    prompts.push({ seat, text });
    return reply(seat, text);
  });
  const t = table({ seed, canThink: () => true, brain: () => mind.brain, ...over });
  return { t, mind, prompts };
}

describe('WerewolfRoom', () => {
  describe('the lobby', () => {
    it('lists the pets, those that are out marked, and says how many may sit at the table', () => {
      const t = table({ petsOn: () => ['mao', 'haru'], canThink: () => true });
      t.room.lobby();
      const lobby = t.posts[0];
      if (lobby?.kind !== 'lobby') throw new Error('no lobby');
      expect(WOLF_AI_SEATS).toBe(SEATS - 1);
      expect(lobby.seats).toBe(Math.min(WOLF_AI_SEATS, PET_IDS.length));
      expect(lobby.watchSeats).toBe(Math.min(SEATS, PET_IDS.length));
      expect(lobby.minds).toBe(true);
      expect(lobby.choices.map((c) => c.id)).toEqual([...PET_IDS]);
      expect(lobby.choices.filter((c) => c.on).map((c) => c.id)).toEqual(['haru', 'mao']);
      expect(lobby.text.title).toBe(en.games.werewolfTitle);
      expect(lobby.text.modePlay).toBe(w.modePlay);
      expect(lobby.text.modeWatch).toBe(w.modeWatch);
      expect(lobby.text.pickPlay).toContain(String(lobby.seats));
      expect(lobby.text.pickWatch).toContain(String(lobby.watchSeats));
      expect(lobby.text.mindsOn).toBe(en.games.mindsOn);
    });

    it('says when the computer players have no mind to think with', () => {
      const t = table({ canThink: () => false });
      t.room.lobby();
      const lobby = t.posts[0];
      expect(lobby?.kind === 'lobby' && lobby.minds).toBe(false);
    });

    it('speaks the language of the user', () => {
      const words = () => ({ g: zh.games, names: zh.ask.petName, language: 'Simplified Chinese' });
      const t = table({ words });
      t.room.lobby();
      const lobby = t.posts[0];
      if (lobby?.kind !== 'lobby') throw new Error('no lobby');
      expect(lobby.text.title).toBe(zh.games.werewolfTitle);
      expect(lobby.text.modeWatch).toBe(zh.games.werewolf.modeWatch);
      expect(lobby.text.modeWatch).not.toBe(w.modeWatch);
    });

    it('closes a game that is under way when it is shown again', async () => {
      const mind = fakeBrain();
      const t = table({ canThink: () => true, brain: () => mind.brain });
      t.start();
      await tick();
      t.room.lobby();
      expect(t.posts.at(-1)?.kind).toBe('lobby');
      expect(mind.close).toHaveBeenCalled();
      expect(t.clock.live()).toBe(0);
    });
  });

  describe('the table', () => {
    it('seats the pets the user picked first, and fills the other seats with other pets', async () => {
      const picks = PET_IDS.slice(5, 9);
      for (const playing of [true, false]) {
        const t = table({ seed: 2 });
        t.start(picks, playing);
        await tick();
        const ids = t.states()[0]?.seats.map((s) => s.id) ?? [];
        const pets = ids.filter((id): id is PetId => id !== 'user');
        expect(ids).toHaveLength(SEATS);
        expect(new Set(pets).size).toBe(playing ? SEATS - 1 : SEATS);
        expect(pets).toEqual(expect.arrayContaining(picks));
        expect(ids.includes('user')).toBe(playing);
        t.room.stop();
      }
    });

    it('seats twelve picks when the user only watches, and only eleven when he plays', async () => {
      const picks = PET_IDS.slice(0, SEATS);
      const watched = table({ seed: 3 });
      watched.start(picks, false);
      await tick();
      const all = watched.states()[0]?.seats.map((s) => s.id) ?? [];
      expect([...all].sort()).toEqual([...picks].sort());

      const played = table({ seed: 3 });
      played.start(picks, true);
      await tick();
      const some = (played.states()[0]?.seats.map((s) => s.id) ?? []).filter((id) => id !== 'user');
      expect([...some].sort()).toEqual(picks.slice(0, SEATS - 1).sort());
      watched.room.stop();
      played.room.stop();
    });

    it('shuffles the roles of the spectator\'s table: four wolves, four villagers and the four gods', async () => {
      const boards = new Set<string>();
      for (let seed = 1; seed <= 12; seed++) {
        const t = table({ seed });
        t.start([], false);
        await tick();
        const seats = t.states()[0]?.seats ?? [];
        expect(countRoles(seats)).toEqual(BOARD);
        boards.add(seats.map((s) => s.role).join());
        t.room.stop();
      }
      expect(boards.size).toBeGreaterThan(8);
    });

    it('deals the user a role and a seat at random', async () => {
      const roles: Record<string, number> = {};
      const places = new Array<number>(SEATS).fill(0);
      const rounds = 240;
      for (let seed = 1; seed <= rounds; seed++) {
        const t = table({ seed });
        t.start([], true);
        await tick();
        const mine = mineIn(t.states()[0]?.seats);
        roles[mine?.role ?? 'none'] = (roles[mine?.role ?? 'none'] ?? 0) + 1;
        places[(mine?.seat ?? 1) - 1] = (places[(mine?.seat ?? 1) - 1] ?? 0) + 1;
        t.room.stop();
      }
      // 4 in 12 for a wolf and for a villager (80 of 240), 1 in 12 for each god and for each seat (20).
      expect(roles.none).toBeUndefined();
      expect(roles.wolf).toBeGreaterThan(50);
      expect(roles.wolf).toBeLessThan(110);
      expect(roles.villager).toBeGreaterThan(50);
      expect(roles.villager).toBeLessThan(110);
      for (const god of ['seer', 'witch', 'hunter', 'idiot']) {
        expect(roles[god], god).toBeGreaterThan(4);
        expect(roles[god], god).toBeLessThan(40);
      }
      for (const n of places) {
        expect(n).toBeGreaterThan(4);
        expect(n).toBeLessThan(40);
      }
    }, 60_000);
  });

  describe('whole games, by the rules alone', () => {
    const players: Game[] = [];
    const watchers: Game[] = [];
    const everyone: Game[] = [];

    beforeAll(async () => {
      for (let seed = 1; seed <= 60; seed++) players.push(await playOut(seed, true));
      for (let seed = 1; seed <= 30; seed++) watchers.push(await playOut(seed, false));
      everyone.push(...players, ...watchers);
    }, 300_000);

    eachGame(everyone, 'ends with the verdict, said once and last', (g, bad) => {
      if (!g.done) bad('the game did not end');
      if (only(g.posts, 'over').length !== 1) bad(`${only(g.posts, 'over').length} verdicts`);
      if (g.posts.at(-1)?.kind !== 'over') bad(`${g.posts.at(-1)?.kind} came after the verdict`);
    });

    eachGame(everyone, 'names the side that has won by 屠边 in the last state, and says why', (g, bad) => {
      const last = statesOf(g).at(-1);
      const over = only(g.posts, 'over')[0];
      const v = verdictOf(last?.seats ?? []);
      if (last?.phase !== 'over') bad(`the last state is "${last?.phase}"`);
      if (v === null) return bad('no side has won at the end');
      if (over?.winner !== v.winner) bad(`${over?.winner} won, but the table says ${v.winner}`);
      if (!g.playing && over?.title !== WHYS[v.why]) bad(`the title is "${over?.title}"`);
    });

    eachGame(everyone, 'shows every role at the end: four wolves, four villagers and the four gods', (g, bad) => {
      const last = statesOf(g).at(-1);
      if (!hasBoard(last?.seats ?? [])) bad('the roles are not 4/4/1/1/1/1');
      for (const s of last?.seats ?? []) {
        if (s.role === null || s.roleName !== w.role[s.role]) bad(`seat ${s.seat} shows "${s.roleName}"`);
      }
    });

    eachGame(everyone, 'puts the roles in the verdict, and nowhere else but a spectator\'s first line', (g, bad) => {
      const roster = only(g.posts, 'over')[0]?.text;
      const end = rosterOf(statesOf(g).at(-1)?.seats ?? []);
      if (roster !== end) bad('the roles of the verdict are not those of the end');
      const told = linesOf(g).filter((l) => l.text === roster);
      if (told.length !== (g.playing ? 0 : 1)) bad(`the roles were told ${told.length} times in the log`);
    });

    eachGame(everyone, 'keeps the dead dead, has one sheriff at most, and shows the idiot once flipped', (g, bad) => {
      const dead = new Set<number>();
      const flipped = new Set<number>();
      for (const state of statesOf(g)) {
        if (state.seats.filter((s) => s.sheriff).length > 1) bad('two sheriffs');
        if (state.label.trim() === '') bad('a state without a label');
        for (const s of state.seats) {
          if (!s.alive) dead.add(s.seat);
          else if (dead.has(s.seat)) bad(`seat ${s.seat} came back to life`);
          if (s.flipped) {
            flipped.add(s.seat);
            if (s.role !== 'idiot') bad(`seat ${s.seat} is flipped but shows "${s.role}"`);
          } else if (flipped.has(s.seat)) bad(`seat ${s.seat} turned its card back`);
        }
      }
    });

    eachGame(everyone, 'sends a speech with the seat that spoke, and every other line without one', (g, bad) => {
      for (const l of linesOf(g)) {
        if (l.text.trim() === '') bad(`an empty ${l.tone} line`);
        if (l.tone === 'say') {
          if (l.seat === null || l.seat < 1 || l.seat > SEATS) bad(`a speech of seat ${l.seat}`);
          if (l.text.length > SAY_MAX + 40) bad(`a speech of ${l.text.length} characters`);
        } else if (l.seat !== null) bad(`a ${l.tone} line of seat ${l.seat}`);
      }
    });

    eachGame(everyone, 'runs through the night, the election, the talk and the vote', (g, bad) => {
      const phases = new Set(statesOf(g).map((s) => s.phase));
      for (const phase of ['night', 'talk', 'vote', 'over']) if (!phases.has(phase as 'night')) bad(`no ${phase}`);
    });

    describe('with the user at the table', () => {
      eachGame(players, 'seats the user once, with eleven different pets and the pets he picked', (g, bad) => {
        const seats = statesOf(g)[0]?.seats ?? [];
        if (seats.length !== SEATS) bad(`${seats.length} seats`);
        if (seats.some((s, i) => s.seat !== i + 1)) bad('the seats are not numbered 1 to 12');
        if (seats.filter((s) => s.me).length !== 1 || seats.filter((s) => s.id === 'user').length !== 1) {
          bad('the user does not sit once');
        }
        if (mineIn(seats)?.id !== 'user' || mineIn(seats)?.name !== en.games.you) bad('the user is not "You"');
        const pets = seats.filter((s) => s.id !== 'user').map((s) => s.id);
        if (new Set(pets).size !== SEATS - 1) bad('a pet sits twice');
        if (new Set(seats.map((s) => s.name)).size !== SEATS) bad('two seats have one name');
        const out = g.picks.filter((p) => !pets.includes(p));
        if (out.length > 0) bad(`picked pets that do not sit: ${out.join()}`);
      });

      eachGame(players, 'shows a role only where the user may know it, and the true one', (g, bad) => {
        const states = statesOf(g);
        const mine = mineIn(states[0]?.seats)?.role ?? null;
        const truth = states.at(-1)?.seats ?? [];
        const lines = new Set(linesOf(g).map((l) => l.text));
        const out = new Set(truth.map((s) => s.name).filter((n) => lines.has(w.boomed(n))));
        if (mine === null) bad('the user does not know his own role');
        for (const m of g.posts) {
          if (m.kind !== 'state') continue;
          for (const s of m.seats) {
            const role = truth[s.seat - 1]?.role ?? null;
            const known = m.phase === 'over' || s.me || s.flipped || (mine === 'wolf' && role === 'wolf')
              || (role === 'wolf' && !s.alive && out.has(s.name));
            if ((s.role !== null) !== known) bad(`seat ${s.seat} ${known ? 'is hidden' : 'is shown'} in ${m.phase}`);
            else if (s.role !== null && s.role !== role) bad(`seat ${s.seat} shows ${s.role}, not ${role}`);
            if (s.roleName !== (s.role === null ? null : w.role[s.role])) bad(`seat ${s.seat} has a wrong role name`);
          }
        }
      });

      eachGame(players, 'tells him in secret only what his own role knows', (g, bad) => {
        const truth = statesOf(g).at(-1)?.seats ?? [];
        const role = mineIn(truth)?.role;
        if (!role) return bad('no role');
        const allowed = secretsFor(role, truth);
        const secrets = linesOf(g).filter((l) => l.tone === 'secret');
        for (const l of secrets) if (!allowed.has(l.text)) bad(`a ${role} was told "${l.text}"`);
        if (secrets[0]?.text !== `${w.youAre(w.role[role])} ${w.roleHint[role]}`) bad('he is not told his role first');
        if (['villager', 'hunter', 'idiot'].includes(role) && secrets.length !== 1) bad(`${secrets.length} secrets`);
        if (role === 'wolf' && secrets.length < 5) bad('a wolf sees no proposals');
        if (role === 'seer' && secrets.length < 2) bad('the seer is told no result');
        if (role === 'witch' && secrets.length < 3) bad('the witch is told nothing');
      });

      eachGame(players, 'tells whether his side won, and tells the truth', (g, bad) => {
        const last = statesOf(g).at(-1);
        const over = only(g.posts, 'over')[0];
        const v = verdictOf(last?.seats ?? []);
        const wolf = mineIn(last?.seats)?.role === 'wolf';
        const won = v !== null && (v.winner === 'wolves') === wolf;
        if (over?.win !== won) bad(`win is ${over?.win}, but he ${won ? 'won' : 'lost'}`);
        if (over?.title !== (won ? w.youWin : w.youLose)) bad(`the title is "${over?.title}"`);
      });

      eachGame(players, 'asks only what the role allows, one question at a time, with sound options', (g, bad) => {
        const role = mineIn(statesOf(g)[0]?.seats)?.role;
        const asks = asksOf(g);
        const me = mineIn(statesOf(g)[0]?.seats)?.seat ?? 0;
        for (const a of asks) {
          if (NEEDS[a.kind] && NEEDS[a.kind] !== role) bad(`a ${role} was asked to ${a.kind}`);
          if (a.title.trim() === '') bad(`a ${a.kind} question without a title`);
          if (new Set(a.options).size !== a.options.length) bad(`${a.kind} offers a seat twice`);
          if (a.options.some((s) => !Number.isInteger(s) || s < 1 || s > SEATS)) bad(`${a.kind} offers a bad seat`);
          if (a.kind !== 'kill' && a.options.includes(me)) bad(`${a.kind} offers his own seat`);
          if ((a.kind === 'run' || a.kind === 'speak') && a.options.length > 0) bad(`${a.kind} offers seats`);
          if (a.kind !== 'witch' && (a.save || a.poison || a.victim !== null)) bad(`${a.kind} carries potions`);
          if (a.kind === 'witch' && !a.poison && a.options.length > 0) bad('the witch may poison without poison');
        }
        if (role === 'wolf' && !asks.some((a) => a.kind === 'kill')) bad('a wolf was not asked whom to kill');
        if (role === 'seer' && !asks.some((a) => a.kind === 'check')) bad('the seer was not asked whom to check');
        if (role === 'witch' && !asks.some((a) => a.kind === 'witch')) bad('the witch was not asked');
        const posted = only(g.posts, 'ask').map((m) => m.ask);
        const alternating = posted.every((a, i) => (a === null) === (i % 2 === 1));
        if (!alternating || posted.length % 2 === 1) bad('questions are not closed one at a time');
      });

      eachGame(players, 'gives the boom button only to a wolf who is alive', (g, bad) => {
        const states = statesOf(g);
        const wolf = mineIn(states[0]?.seats)?.role === 'wolf';
        for (const s of states) {
          if (s.boom && !(wolf && mineIn(s.seats)?.alive)) bad('a button for a user who may not blow himself up');
          if (s.boom && s.phase === 'night') bad('a button at night');
        }
      });

      eachGame(players, 'says what he typed as his own, and never more than the limit', (g, bad) => {
        const me = mineIn(statesOf(g)[0]?.seats)?.seat;
        for (const l of linesOf(g)) {
          if (l.tone !== 'say' || l.seat !== me) continue;
          if (!l.text.endsWith('I am only a villager.')) bad(`he said "${l.text}"`);
        }
      });

      it('puts every kind of question to the user somewhere in the games', () => {
        const kinds = new Set(players.flatMap((g) => asksOf(g).map((a) => a.kind)));
        const every: WolfAsk['kind'][] = ['kill', 'check', 'witch', 'run', 'speak', 'vote', 'shoot', 'badge'];
        expect(every.filter((k) => !kinds.has(k))).toEqual([]);
      });

      it('plays every role of the board for the user, and he is out before the end in some games', () => {
        const roles = new Set(players.map((g) => mineIn(statesOf(g)[0]?.seats)?.role));
        expect([...roles].sort()).toEqual(['hunter', 'idiot', 'seer', 'villager', 'witch', 'wolf']);
        const outEarly = players.filter((g) => {
          const states = statesOf(g);
          return states.some((s) => s.phase !== 'over' && mineIn(s.seats)?.alive === false);
        });
        expect(outEarly.length).toBeGreaterThan(5);
      });
    });

    describe('with the user only watching', () => {
      eachGame(watchers, 'seats twelve different pets, the picked ones among them, none of them his', (g, bad) => {
        const seats = statesOf(g)[0]?.seats ?? [];
        const ids = seats.map((s) => s.id);
        if (seats.length !== SEATS || new Set(ids).size !== SEATS) bad('there are not twelve different seats');
        if (ids.includes('user') || seats.some((s) => s.me)) bad('a seat is the user\'s');
        const out = g.picks.filter((p) => !ids.includes(p));
        if (out.length > 0) bad(`picked pets that do not sit: ${out.join()}`);
      });

      eachGame(watchers, 'shows every seat\'s role in every state: a god-view', (g, bad) => {
        const states = statesOf(g);
        const truth = states.at(-1)?.seats ?? [];
        for (const state of states) {
          if (!hasBoard(state.seats)) bad('a state does not show every role');
          state.seats.forEach((s, i) => {
            if (s.role !== truth[i]?.role || s.roleName !== (s.role === null ? null : w.role[s.role])) {
              bad(`seat ${s.seat} changes its role`);
            }
          });
        }
      });

      eachGame(watchers, 'asks him nothing and gives him no button', (g, bad) => {
        if (only(g.posts, 'ask').length > 0) bad('a question was posted');
        if (statesOf(g).some((s) => s.boom)) bad('a boom button was offered');
        if (only(g.posts, 'over')[0]?.win !== null) bad('a spectator has not won or lost');
      });

      eachGame(watchers, 'tells him the roles first, and then every secret move as it is made', (g, bad) => {
        const lines = linesOf(g);
        const secrets = lines.filter((l) => l.tone === 'secret');
        if (secrets[0]?.text !== only(g.posts, 'over')[0]?.text) bad('the roles are not his first secret');
        const firstSpeech = lines.findIndex((l) => l.tone === 'say');
        const night = lines.slice(0, firstSpeech).filter((l) => l.tone === 'secret').length;
        // The roles, four proposals and the kill, the seer's check, and the witch's move.
        if (night < 8) bad(`${night} secrets in the first night and election`);
      });
    });
  });

  describe('a user with a role of his own', () => {
    it('tells a seer, and only him, what each player he checks is, and never offers one twice', async () => {
      let checked = 0;
      for (const seed of await dealt('seer', 4)) {
        const t = table({ seed });
        t.start([], true);
        const picked: number[] = [];
        const policy: Policy = (ask, turn) => {
          const reply = answerTo(ask, turn);
          if (ask.kind === 'check' && reply?.t === 'target') picked.push(reply.seat);
          return reply;
        };
        expect(await t.finish(policy), `seed ${seed}`).toBe(true);
        const truth = statesOf(t).at(-1)?.seats ?? [];
        const me = mineIn(truth)?.seat ?? 0;
        const checks = asksOf(t).filter((a) => a.kind === 'check');
        expect(checks, `seed ${seed}`).toHaveLength(picked.length);
        checks.forEach((ask, i) => {
          expect(ask.options).not.toContain(me);
          for (const earlier of picked.slice(0, i)) expect(ask.options).not.toContain(earlier);
        });
        const secrets = linesOf(t).filter((l) => l.tone === 'secret').map((l) => l.text);
        for (const seat of picked) {
          const who = truth[seat - 1];
          expect(secrets, `seed ${seed}`).toContain(w.check(who?.name ?? '', who?.role === 'wolf'));
          expect(secrets, `seed ${seed}`).not.toContain(w.check(who?.name ?? '', who?.role !== 'wolf'));
        }
        checked += picked.length;
      }
      expect(checked).toBeGreaterThan(4);
    }, 60_000);

    describe('the witch', () => {
      const nothing: WolfIn = { t: 'witch', save: false, poison: null };

      /** A game of a witch who first does what `plan` says with the first question, and later nothing. */
      async function witchGame(seed: number, plan: (ask: WolfAsk) => WolfIn) {
        const t = table({ seed });
        t.start([], true);
        expect(await t.play(() => t.lastAsk()?.kind === 'witch', null), `seed ${seed}`).toBe(true);
        const first = t.lastAsk();
        if (!first) throw new Error('no question');
        t.answer(plan(first));
        const idle: Policy = (ask, turn) => (ask.kind === 'witch' ? nothing : answerTo(ask, turn));
        expect(await t.finish(idle), `seed ${seed}`).toBe(true);
        const seats = statesOf(t).at(-1)?.seats ?? [];
        const later = asksOf(t).filter((a) => a.kind === 'witch').slice(1);
        return { t, first, seats, later, me: mineIn(seats)?.seat ?? 0 };
      }

      it('is told whom the wolves attacked, offered both potions, and may poison any player but herself', async () => {
        for (const seed of await dealt('witch', 3)) {
          const { t, first, seats, me } = await witchGame(seed, () => nothing);
          const victim = seats[(first.victim ?? 0) - 1];
          expect(victim, `seed ${seed}`).toBeDefined();
          expect(first, `seed ${seed}`).toMatchObject({ kind: 'witch', save: true, poison: true });
          expect(first.title).toBe(w.askWitch(victim?.name ?? null));
          expect([...first.options].sort((a, b) => a - b)).toEqual(seats.map((s) => s.seat).filter((s) => s !== me));
          expect(linesOf(t).some((l) => l.text === w.witchInfo(victim?.name ?? null))).toBe(true);
        }
      }, 60_000);

      it('saves the victim with the antidote: nobody dies at dawn, and no antidote is left', async () => {
        let asked = 0;
        for (const seed of await dealt('witch', 3)) {
          const { t, first, seats, later } = await witchGame(seed, () => ({ t: 'witch', save: true, poison: null }));
          const lines = linesOf(t);
          const at = lines.findIndex((l) => l.text === w.witchDid(seats[(first.victim ?? 0) - 1]?.name ?? '', null));
          expect(at, `seed ${seed}`).toBeGreaterThan(-1);
          expect(lines[at]?.tone).toBe('secret');
          expect(lines.slice(at + 1).find((l) => l.tone === 'sys')?.text, `seed ${seed}`).toBe(w.dawnNone);
          for (const ask of later) expect(ask.save, `seed ${seed}`).toBe(false);
          asked += later.length;
        }
        expect(asked).toBeGreaterThan(0);
      }, 60_000);

      it('poisons the player she names: he dies at dawn, and no poison is left to offer', async () => {
        let asked = 0;
        for (const seed of await dealt('witch', 3)) {
          let target = 0;
          const plan = (ask: WolfAsk): WolfIn => {
            target = ask.options.find((s) => s !== ask.victim) ?? 0;
            return { t: 'witch', save: false, poison: target };
          };
          const { t, seats, later } = await witchGame(seed, plan);
          const name = seats[target - 1]?.name ?? '';
          const lines = linesOf(t);
          const at = lines.findIndex((l) => l.text === w.witchDid(null, name));
          expect(at, `seed ${seed}`).toBeGreaterThan(-1);
          expect(lines.slice(at + 1).find((l) => l.tone === 'sys')?.text, `seed ${seed}`).toContain(name);
          for (const ask of later) {
            expect(ask.poison, `seed ${seed}`).toBe(false);
            expect(ask.options, `seed ${seed}`).toEqual([]);
          }
          asked += later.length;
        }
        expect(asked).toBeGreaterThan(0);
      }, 60_000);

      it('keeps both potions when she uses none, and may never save herself after the first night', async () => {
        let asked = 0;
        for (const seed of await dealt('witch', 3)) {
          const { t, seats, later, me } = await witchGame(seed, () => nothing);
          expect(linesOf(t).some((l) => l.text === w.witchDid(null, null)), `seed ${seed}`).toBe(true);
          expect(seats.length).toBe(SEATS);
          for (const ask of later) {
            expect(ask.poison, `seed ${seed}`).toBe(true);
            expect(ask.options.length, `seed ${seed}`).toBeGreaterThan(0);
            if (ask.victim === me) expect(ask.save, `seed ${seed}`).toBe(false);
          }
          asked += later.length;
        }
        expect(asked).toBeGreaterThan(0);
      }, 60_000);
    });

    describe('a wolf', () => {
      it('sees his pack and what each partner proposes, and has the last word on the kill', async () => {
        const [seed] = await dealt('wolf');
        const t = table({ seed });
        t.start([], true);
        expect(await t.play(() => t.lastAsk()?.kind === 'kill', null)).toBe(true);
        const ask = t.lastAsk();
        const seats = t.states().at(-1)?.seats ?? [];
        const pack = seats.filter((s) => s.role === 'wolf');
        expect(pack).toHaveLength(4);
        expect(seats.filter((s) => s.role !== null && s.role !== 'wolf')).toEqual([]);
        expect(ask?.title).toBe(w.askKill);
        expect(ask?.options).toEqual(seats.map((s) => s.seat));

        const partners = pack.filter((s) => !s.me).map((s) => s.name);
        const secrets = linesOf(t).filter((l) => l.tone === 'secret').map((l) => l.text);
        expect(secrets[0]).toBe(`${w.youAre(w.role.wolf)} ${w.roleHint.wolf}`);
        expect(secrets[1]).toBe(w.wolves(w.join(partners)));
        expect(secrets).toHaveLength(2 + partners.length);
        for (const partner of partners) {
          const picks = secrets.filter((text) => seats.some((s) => w.wolfPick(partner, s.name) === text));
          expect(picks, partner).toHaveLength(1);
        }

        const prey = seats.find((s) => s.role !== 'wolf');
        t.answer({ t: 'target', seat: prey?.seat ?? 1 });
        const told = w.wolfKill(prey?.name ?? '');
        expect(await t.play(() => linesOf(t).some((l) => l.text === told), null)).toBe(true);
        t.room.stop();
      });

      it('may blow himself up by day: he is out at once, no vote is held, and the night follows', async () => {
        const [seed] = await dealt('wolf');
        const t = table({ seed });
        t.start([], true);
        let pressed = false;
        const policy: Policy = (ask, turn) => {
          if (ask.kind === 'speak') return null;
          if (ask.kind === 'run') return { t: 'run', run: false };
          if (ask.kind === 'kill') {
            return { t: 'target', seat: t.states().at(-1)?.seats.find((s) => s.role !== 'wolf')?.seat ?? 1 };
          }
          return answerTo(ask, turn);
        };
        const press = (): void => {
          if (pressed || t.lastAsk()?.kind !== 'speak' || t.states().at(-1)?.boom !== true) return;
          pressed = true;
          t.room.on({ t: 'boom' });
        };
        expect(await t.play(() => pressed, policy, press)).toBe(true);
        const night = w.night(2);
        expect(await t.play(() => linesOf(t).some((l) => l.text === night), policy)).toBe(true);

        const lines = linesOf(t);
        const boomAt = lines.findIndex((l) => l.text === w.boomed(en.games.you));
        const nightAt = lines.findIndex((l) => l.text === night);
        expect(boomAt).toBeGreaterThan(-1);
        expect(nightAt).toBeGreaterThan(boomAt);
        expect(lines.slice(boomAt, nightAt).filter((l) => l.tone === 'vote')).toEqual([]);
        expect(mineIn(t.states().at(-1)?.seats)).toMatchObject({ alive: false, role: 'wolf' });
        expect(t.states().at(-1)?.boom).toBe(false);
        expect(t.lastAsk()).toBeNull();
        t.room.stop();
      });
    });

    describe('speeches', () => {
      const long = 'a'.repeat(SAY_MAX * 3);
      /** A user who says `text` whenever he may speak, and otherwise answers as `answerTo` does. */
      const saying = (text: string): Policy => (ask, turn) =>
        ask.kind === 'speak' ? { t: 'say', text } : answerTo(ask, turn);

      it('says what the user types as his own, cut at the limit', async () => {
        let spoken = 0;
        for (const seed of [2, 5, 8]) {
          const g = await playOut(seed, true, saying(long));
          const me = mineIn(statesOf(g)[0]?.seats)?.seat;
          for (const l of linesOf(g).filter((x) => x.tone === 'say' && x.seat === me)) {
            expect(l.text.endsWith('a'.repeat(SAY_MAX)), `seed ${seed}`).toBe(true);
            expect(l.text.includes('a'.repeat(SAY_MAX + 1)), `seed ${seed}`).toBe(false);
            spoken++;
          }
        }
        expect(spoken).toBeGreaterThan(3);
      }, 60_000);

      it('says nothing for a user who passes, and goes on to the next', async () => {
        for (const seed of [2, 5, 8]) {
          const g = await playOut(seed, true, saying(' \n '));
          const me = mineIn(statesOf(g)[0]?.seats)?.seat;
          expect(g.done, `seed ${seed}`).toBe(true);
          expect(asksOf(g).some((a) => a.kind === 'speak'), `seed ${seed}`).toBe(true);
          expect(linesOf(g).filter((l) => l.tone === 'say' && l.seat === me), `seed ${seed}`).toEqual([]);
          expect(linesOf(g).filter((l) => l.tone === 'say').length, `seed ${seed}`).toBeGreaterThan(10);
        }
      }, 60_000);
    });

    it('replaces an answer that is not allowed by the move of a computer player, and plays on', async () => {
      const bogus: Policy = (ask, turn) => {
        const seat = [99, 0, -1, 13][turn % 4] ?? 99;
        switch (ask.kind) {
          case 'kill':
          case 'check': return { t: 'target', seat };
          case 'vote': return { t: 'vote', seat };
          case 'witch': return { t: 'witch', save: true, poison: seat };
          case 'shoot':
          case 'badge': return { t: 'pick', seat };
          case 'speak': return { t: 'say', text: 'Hm.' };
          case 'run': return { t: 'run', run: true };
        }
      };
      for (let seed = 1; seed <= 12; seed++) {
        const g = await playOut(seed, true, bogus);
        expect(g.done, `seed ${seed}`).toBe(true);
        expect(only(g.posts, 'over'), `seed ${seed}`).toHaveLength(1);
      }
    }, 60_000);
  });

  describe('messages that answer nothing', () => {
    const answers: Record<WolfAsk['kind'], WolfIn['t']> = {
      kill: 'target', check: 'target', witch: 'witch', run: 'run', speak: 'say', vote: 'vote', shoot: 'pick',
      badge: 'pick',
    };
    const stray: WolfIn[] = [
      { t: 'target', seat: 1 }, { t: 'vote', seat: 2 }, { t: 'vote', seat: null }, { t: 'say', text: 'noise' },
      { t: 'witch', save: true, poison: null }, { t: 'run', run: true }, { t: 'pick', seat: 3 },
      { t: 'pick', seat: null }, { t: 'start', pets: [], play: false }, { t: 'start', pets: ['mao'], play: true },
    ];

    /** A game as `playOut` plays it, with every message that answers nothing sent at each step (and answers twice). */
    async function noisy(seed: number, playing: boolean, twice: boolean): Promise<Game> {
      const picks = picksFor(seed);
      const t = table({ seed });
      t.start(picks, playing);
      const wolf = mineIn(t.states()[0]?.seats)?.role === 'wolf';
      const policy: Policy = (ask, turn) => {
        const reply = answerTo(ask, turn);
        if (twice && reply) t.room.on(reply);
        return reply;
      };
      const noise = (): void => {
        const pending = t.lastAsk()?.kind ?? null;
        for (const m of stray) if (pending === null || m.t !== answers[pending]) t.room.on(m);
        if (!wolf) t.room.on({ t: 'boom' });
      };
      const done = await t.finish(policy, noise);
      return { seed, playing, picks, done, posts: t.posts };
    }

    const differ = (a: readonly WolfOut[], b: readonly WolfOut[]): string => {
      const at = a.findIndex((m, i) => JSON.stringify(m) !== JSON.stringify(b[i]));
      return a.length === b.length && at === -1 ? 'none' : `post ${at} of ${a.length} and ${b.length}`;
    };

    it.each([[true, false], [true, true], [false, false]] as [boolean, boolean][])(
      'change nothing in a game (playing %s, answering twice %s)',
      async (playing, twice) => {
        for (let seed = 1; seed <= 5; seed++) {
          const control = await playOut(seed, playing);
          const noise = await noisy(seed, playing, twice);
          expect(noise.done, `seed ${seed}`).toBe(true);
          expect(differ(noise.posts, control.posts), `seed ${seed}`).toBe('none');
        }
      },
      60_000,
    );

    it('are ignored when there is no game', async () => {
      const t = table();
      for (const m of [...stray.slice(0, 8), { t: 'boom' } as const]) t.room.on(m);
      await tick();
      expect(t.posts).toEqual([]);
      expect(t.clock.live()).toBe(0);
    });
  });

  describe('the pace of a game by the rules', () => {
    it.each([[true], [false]])('pauses 600 to 1500 ms between its steps, no longer (playing %s)', async (playing) => {
      const t = table({ seed: 11 });
      const delays: number[] = [];
      const real = t.services.after;
      t.services.after = (ms, fn) => {
        delays.push(ms);
        return real(ms, fn);
      };
      t.start([], playing);
      expect(await t.finish()).toBe(true);
      expect(delays.length).toBeGreaterThan(40);
      expect(Math.min(...delays)).toBeGreaterThanOrEqual(SAY_PAUSE_MS[0]);
      expect(Math.max(...delays)).toBeLessThanOrEqual(1500);
    });
  });

  describe('with pets that think, through a fake Copilot CLI', () => {
    interface Thought extends Game {
      t: Table;
      mind: ReturnType<typeof thinking>['mind'];
      prompts: { seat: number; text: string }[];
      me: number | null;
      // Taken as the game ends: vitest clears the calls of a mock before each test.
      warmed: number;
      closed: number;
    }

    async function thoughtOut(seed: number, playing: boolean, reply?: Reply, over?: Over): Promise<Thought> {
      const { t, mind, prompts } = thinking(seed, reply, over);
      const picks = picksFor(seed);
      t.start(picks, playing);
      const done = await t.finish();
      await tick();
      const me = mineIn(statesOf(t)[0]?.seats)?.seat ?? null;
      const warmed = mind.warm.mock.calls.length;
      const closed = mind.close.mock.calls.length;
      return { seed, playing, picks, done, posts: t.posts, t, mind, prompts, me, warmed, closed };
    }

    const games: Thought[] = [];

    beforeAll(async () => {
      for (let seed = 1; seed <= 12; seed++) games.push(await thoughtOut(seed, true), await thoughtOut(seed, false));
    }, 300_000);

    eachGame(games, 'ends with one verdict within the budget, and never asks for the user\'s seat', (g, bad) => {
      const asked = g.mind.asked.length;
      if (!g.done) bad('the game did not end');
      if (only(g.posts, 'over').length !== 1) bad(`${only(g.posts, 'over').length} verdicts`);
      if (asked > MIND_BUDGET) bad(`${asked} requests`);
      if (asked < 10) bad(`${asked} requests: the pets hardly thought`);
      if (g.me !== null && g.mind.asked.includes(g.me)) bad('the user\'s seat was asked');
    });

    it('is frugal: how many requests a whole game costs', () => {
      const totals = games.map((g) => g.mind.asked.length);
      const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
      expect(mean).toBeGreaterThan(20);
      expect(mean).toBeLessThanOrEqual(80);
      expect(Math.max(...totals)).toBeLessThanOrEqual(MIND_BUDGET);
    });

    eachGame(games, 'starts one mind for a game and lets it go at the end, with no timer left', (g, bad) => {
      if (g.warmed !== 1) bad(`${g.warmed} minds were started`);
      if (g.closed < 1) bad('the mind was not closed');
      if (g.t.clock.live() !== 0) bad('a timer is left');
    });

    eachGame(games, 'speaks for the pets with what their minds said', (g, bad) => {
      const pets = linesOf(g).filter((l) => l.tone === 'say' && l.seat !== g.me);
      const theirs = pets.filter((l) => l.text.includes(MARK));
      if (pets.length === 0) bad('the pets said nothing');
      if (theirs.length < pets.length * 0.9) bad(`only ${theirs.length} of ${pets.length} speeches are the minds'`);
    });

    it('tells each pet its own persona and language, and only what its role may know', () => {
      const problems: string[] = [];
      for (const g of games) {
        const seats = statesOf(g).at(-1)?.seats ?? [];
        const seen = new Set<number>();
        expect(g.prompts.length).toBeGreaterThan(10);
        for (const p of g.prompts) {
          const role = seats[p.seat - 1]?.role;
          const bad = (why: string): void => {
            problems.push(`seed ${g.seed}, seat ${p.seat} (${role}): ${why}`);
          };
          if (!seen.has(p.seat)) {
            seen.add(p.seat);
            if (!p.text.includes(`Your character: the persona of ${seats[p.seat - 1]?.id}`)) bad('no persona');
            if (!p.text.includes('Speak in English')) bad('no language');
            if (p.text.includes('Your fellow wolves') !== (role === 'wolf')) bad('the pack is wrongly told');
            if (g.me !== null && !p.text.includes(`#${g.me} the user`)) bad('the user is not "the user"');
          }
          if (g.me !== null && p.text.includes(`#${g.me} ${en.games.you}`)) bad('the user is called "You"');
          if (p.text.includes('Your check:') && role !== 'seer') bad('told a check');
          if (/You used the antidote|You poisoned|You used no potion/.test(p.text) && role !== 'witch') {
            bad('told a potion');
          }
          if (/Your partner|Your pack kills/.test(p.text) && role !== 'wolf') bad('told what the pack does');
        }
      }
      expect(problems.slice(0, 6)).toEqual([]);
    });

    eachGame(() => games.filter((g) => g.playing), 'does not show a user who plays who thinks at night', (g, bad) => {
      const nights = Array.from({ length: 2 * SEATS }, (_, i) => w.night(i + 1));
      const dawn = w.dawn('@@').split('@@')[0] ?? '';
      let night = false;
      for (const m of g.posts) {
        if (m.kind === 'line' && m.tone === 'sys') {
          if (nights.includes(m.text)) night = true;
          else if (m.text === w.dawnNone || m.text.startsWith(dawn)) night = false;
        }
        if (m.kind !== 'thinking') continue;
        if (night && m.seats.length > 0) bad(`${m.seats} thinking at night`);
        if (g.me !== null && m.seats.includes(g.me)) bad('the user is shown thinking');
      }
    });

    it('falls back to the rules when the minds say nothing or nonsense, and still plays a whole game', async () => {
      const replies: (string | null)[] = [
        null, '', '{', 'null', 'I think therefore I am', '{"target": "banana"}', '{"target": 99}', '{"target": -3}',
        '{"say": 5}', '{"save": "yes"}',
      ];
      for (const [i, text] of replies.entries()) {
        const g = await thoughtOut(i + 1, i % 2 === 0, () => text);
        expect(g.done, JSON.stringify(text)).toBe(true);
        expect(only(g.posts, 'over'), JSON.stringify(text)).toHaveLength(1);
        expect(g.mind.asked.length, JSON.stringify(text)).toBeGreaterThan(0);
        expect(g.mind.asked.length, JSON.stringify(text)).toBeLessThanOrEqual(MIND_BUDGET);
      }
    }, 60_000);

    it('cuts a speech that is too long', async () => {
      const base = rambler(4);
      const long: Reply = (seat, text) =>
        text.includes('{"say"') ? JSON.stringify({ say: 'word '.repeat(300), suspect: null }) : base(seat, text);
      const g = await thoughtOut(4, false, long);
      const said = linesOf(g).filter((l) => l.tone === 'say');
      expect(said.length).toBeGreaterThan(10);
      expect(Math.max(...said.map((l) => l.text.length))).toBeGreaterThanOrEqual(SAY_MAX - 1);
      expect(said.every((l) => l.text.length <= SAY_MAX + 40)).toBe(true);
    });

    it('plays by the rules when a mind cannot be started', async () => {
      const t = table({ seed: 3, canThink: () => true });
      t.room.lobby();
      expect(t.last('lobby')?.minds).toBe(true);
      t.start([], false);
      expect(await t.finish()).toBe(true);
    });

    it('pauses 250 to 1500 ms between the steps, as the minds are what takes the time', async () => {
      const { t } = thinking(6);
      const delays: number[] = [];
      const real = t.services.after;
      t.services.after = (ms, fn) => {
        delays.push(ms);
        return real(ms, fn);
      };
      t.start([], false);
      expect(await t.finish()).toBe(true);
      expect(delays.length).toBeGreaterThan(40);
      expect(Math.min(...delays)).toBeGreaterThanOrEqual(MIND_PAUSE_MS[0]);
      expect(Math.max(...delays)).toBeLessThanOrEqual(1500);
    });
  });

  describe('stopping, and starting again', () => {
    /** Turns the clock a good many times, as a game that was not stopped would move. */
    const idle = async (t: Table): Promise<void> => {
      for (let i = 0; i < 30; i++) {
        t.clock.fire();
        await tick();
      }
    };

    it('goes back to the lobby when the user asks, and the game that was on plays no further', async () => {
      const { t, mind } = thinking(3);
      t.start([], true);
      expect(await t.play(() => t.states().some((s) => s.phase === 'talk'))).toBe(true);
      t.room.on({ t: 'again' });
      expect(t.posts.at(-1)?.kind).toBe('lobby');
      const count = t.posts.length;
      await idle(t);
      expect(t.posts).toHaveLength(count);
      expect(t.clock.live()).toBe(0);
      expect(mind.close).toHaveBeenCalled();
    });

    it('stops cleanly, however often, with a question pending', async () => {
      const { t, mind } = thinking(6);
      t.start([], true);
      expect(await t.play(() => t.lastAsk() !== null, null)).toBe(true);
      t.room.stop();
      t.room.stop();
      const count = t.posts.length;
      await idle(t);
      expect(t.posts).toHaveLength(count);
      expect(t.clock.live()).toBe(0);
      expect(mind.close).toHaveBeenCalled();
    });

    it('lets a second start through only after the first game was left', async () => {
      const t = table({ seed: 4 });
      t.start([], false);
      expect(await t.finish()).toBe(true);
      const count = t.posts.length;
      t.start([], true);
      await idle(t);
      expect(t.posts).toHaveLength(count);

      t.room.on({ t: 'again' });
      t.start([], true);
      expect(await t.play(() => only(t.posts, 'over').length === 2)).toBe(true);
      const second = t.posts.slice(t.posts.findIndex((m) => m.kind === 'lobby'));
      expect(mineIn(only(second, 'state')[0]?.seats)).toBeDefined();
      expect(only(second, 'over')).toHaveLength(1);
    }, 30_000);

    it('ignores a start while a game is on', async () => {
      const one = thinking(5);
      one.t.start([], false);
      await tick();
      const two = thinking(5);
      two.t.start([], false);
      two.t.start([], true);
      two.t.start(['mao'], false);
      await tick();
      expect(two.t.posts).toEqual(one.t.posts);
      expect(two.mind.warm).toHaveBeenCalledTimes(1);
      one.t.room.stop();
      two.t.room.stop();
    });

    it('says in the log, once, what went wrong when the clock fails, and lets the mind go', async () => {
      const mind = fakeBrain();
      const after = (): (() => void) => {
        throw new Error('the clock broke');
      };
      const t = table({ canThink: () => true, brain: () => mind.brain, after });
      t.start([], false);
      await tick();
      expect(t.lines().filter((l) => l.tone === 'sys' && l.text === 'the clock broke')).toHaveLength(1);
      expect(only(t.posts, 'over')).toHaveLength(0);
      expect(mind.close).toHaveBeenCalled();
    });
  });

  describe('in the language of the user', () => {
    const CJK = /[\u4e00-\u9fff]/;
    const zhWords = () => ({ g: zh.games, names: zh.ask.petName, language: 'Simplified Chinese' });
    const cases: [string, Over, boolean][] = [
      ['English', {}, false],
      ['Chinese', { words: zhWords }, true],
    ];

    it.each(cases)('plays a whole game in %s, for a player and for a spectator', async (_language, over, cjk) => {
      for (const playing of [true, false]) {
        const t = table({ seed: 6, ...over });
        t.start([], playing);
        expect(await t.finish(), `playing ${playing}`).toBe(true);
        const me = mineIn(statesOf(t)[0]?.seats)?.seat;
        // What the user types is his own.
        const texts = [
          ...linesOf(t).filter((l) => l.seat !== me).map((l) => l.text),
          ...statesOf(t).map((s) => s.label),
          ...only(t.posts, 'over').flatMap((o) => [o.title, o.text]),
          ...asksOf(t).map((a) => a.title),
        ];
        expect(texts.length).toBeGreaterThan(50);
        const broken = texts.filter((text) => /undefined|NaN|\[object/.test(text));
        expect(broken.slice(0, 3), `playing ${playing}`).toEqual([]);
        expect(texts.filter((text) => CJK.test(text) !== cjk).slice(0, 3), `playing ${playing}`).toEqual([]);
      }
    }, 60_000);

    it('has the minds speak the language of the user', async () => {
      const { t, prompts } = thinking(3, undefined, { words: zhWords });
      t.start([], false);
      expect(await t.finish()).toBe(true);
      const intros = prompts.filter((p) => p.text.includes('Your character:'));
      expect(intros.length).toBeGreaterThan(6);
      for (const p of intros) expect(p.text).toContain('Speak in Simplified Chinese');
    });
  });
});
