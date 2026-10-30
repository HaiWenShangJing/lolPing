import { describe, expect, it, vi } from 'vitest';
import type { GameBrain } from '../../../src/main/teammate/gameBrain';
import { SanguoshaRoom, askView, fits, pace } from '../../../src/main/teammate/sanguoshaRoom';
import type { SgsAsk, SgsOut, SgsSeat } from '../../../src/shared/gameIpc';
import { strings } from '../../../src/shared/i18n';
import { PET_IDS, type PetId } from '../../../src/shared/teammate/pet';
import { Engine } from '../../../src/shared/teammate/sanguosha';
import { CARD_NAMES, type Card } from '../../../src/shared/teammate/sanguoshaCards';
import { HERO_IDS, HEROES, type HeroId } from '../../../src/shared/teammate/sanguoshaHeroes';
import { SGS_BUDGET } from '../../../src/shared/teammate/sanguoshaMind';
import { ROLE_SETS, SIZES, sideOf } from '../../../src/shared/teammate/sanguoshaTypes';
import type { Ask, Entry, Reply, Role, Size } from '../../../src/shared/teammate/sanguoshaTypes';
import { fakeBrain, fakeServices, tick } from './gameFakes';

const en = strings('en', 'win').teammate;
const zh = strings('zh-CN', 'win').teammate;
const w = en.games.sanguosha;

type Over = NonNullable<Parameters<typeof fakeServices>[0]>;
type Post<K extends SgsOut['kind']> = Extract<SgsOut, { kind: K }>;
/** How the user answers a question; null leaves it unanswered. */
type Policy = (ask: SgsAsk, n: number) => Reply | null;

const only = <K extends SgsOut['kind']>(posts: readonly SgsOut[], kind: K): Post<K>[] =>
  posts.filter((m) => m.kind === kind) as unknown as Post<K>[];

/** A seeded generator whose first values differ from one seed to the next (mulberry32). */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Some of the pets, a different few for each seed, picked by the user. */
const picksFor = (seed: number): PetId[] => PET_IDS.slice(seed % 4, (seed % 4) + (seed % 6));

/** A user who answers everything the table asks: plays a card or two a turn, then ends it. */
const answerTo: Policy = (ask, n) => {
  switch (ask.k) {
    case 'hero': return { k: 'hero', hero: ask.heroes[n % ask.heroes.length]!.id };
    case 'play': {
      const use = ask.uses.length > 0 && n % 3 !== 2 ? ask.uses[n % ask.uses.length] : undefined;
      if (use) {
        const targets = use.targets.options.slice(0, use.targets.min);
        return use.skill ? { k: 'use', card: use.card, as: use.as, skill: use.skill, targets } : { k: 'use', card: use.card, as: use.as, targets };
      }
      const skill = n % 3 !== 2 ? ask.skills[0] : undefined;
      if (!skill) return { k: 'end' };
      return {
        k: 'skill', skill: skill.skill, cards: skill.cards ? skill.cards.ids.slice(0, skill.cards.min) : [],
        targets: skill.targets ? skill.targets.options.slice(0, skill.targets.min) : [],
      };
    }
    case 'cards': return { k: 'cards', ids: ask.cards.slice(0, ask.min).map((c) => c.id) };
    case 'area': return { k: 'area', zone: 'hand', card: null };
    case 'seat': return { k: 'seat', seats: ask.options.slice(0, ask.min) };
    case 'confirm': return { k: 'confirm', yes: n % 2 === 0 };
  }
};

/** A user who only ever ends his turn, passes, and says no. */
const idle: Policy = (ask) => {
  switch (ask.k) {
    case 'hero': return { k: 'hero', hero: ask.heroes[0]!.id };
    case 'play': return { k: 'end' };
    case 'cards': return { k: 'cards', ids: ask.cards.slice(0, ask.min).map((c) => c.id) };
    case 'area': return { k: 'area', zone: 'hand', card: null };
    case 'seat': return { k: 'seat', seats: ask.options.slice(0, ask.min) };
    case 'confirm': return { k: 'confirm', yes: false };
  }
};

/** The room, what it posted, and a user who answers the questions put to him. */
function table(over: Over = {}) {
  const { seed = 1, ...rest } = over;
  const posts: SgsOut[] = [];
  const { services, clock } = fakeServices({ random: seeded(seed), ...rest });
  const room = new SanguoshaRoom(services, (m) => posts.push(m));
  let answered = 0;
  let n = 0;

  const last = <K extends SgsOut['kind']>(kind: K): Post<K> | undefined => {
    for (let i = posts.length - 1; i >= 0; i--) {
      const m = posts[i];
      if (m?.kind === kind) return m as Post<K>;
    }
    return undefined;
  };
  const lastAsk = (): SgsAsk | null => last('ask')?.ask ?? null;

  /** Turns the clock, answering each new question with `policy`, until `done`; false if it never does. */
  const play = async (done: () => boolean, policy: Policy | null = answerTo): Promise<boolean> => {
    for (let i = 0; i < 100_000; i++) {
      if (done()) return true;
      const ask = lastAsk();
      if (policy && ask && posts.length > answered) {
        answered = posts.length;
        const reply = policy(ask, n++);
        if (reply) room.on({ t: 'reply', reply });
        answered = posts.length;
      }
      if (!clock.fire()) await tick();
    }
    return false;
  };

  return {
    room, posts, clock, services, play, last, lastAsk,
    start: (pets: PetId[] = [], size: Size = 5): void => room.on({ t: 'start', pets, size }),
    finish: (policy: Policy | null = answerTo) => play(() => last('over') !== undefined, policy),
    states: () => only(posts, 'state'),
    lines: () => only(posts, 'line'),
    asks: () => only(posts, 'ask').flatMap((m) => (m.ask ? [m.ask] : [])),
  };
}

const mineIn = (seats: readonly SgsSeat[] | undefined): SgsSeat | undefined => seats?.find((s) => s.me);

type Table = ReturnType<typeof table>;
/** Turns the clock until the user is asked something. */
const asked = (t: Table): Promise<boolean> => t.play(() => t.lastAsk() !== null, null);

interface Game {
  seed: number;
  size: Size;
  picks: PetId[];
  done: boolean;
  posts: SgsOut[];
}

async function playOut(seed: number, size: Size, policy: Policy = answerTo): Promise<Game> {
  const picks = picksFor(seed);
  const t = table({ seed });
  t.start(picks, size);
  const done = await t.finish(policy);
  return { seed, size, picks, done, posts: t.posts };
}

/** One test over a batch of games, which names the games that fail it. */
function eachGame(games: () => Game[], title: string, check: (g: Game, bad: (why: string) => void) => void): void {
  it(title, () => {
    const bad: string[] = [];
    const batch = games();
    for (const g of batch) check(g, (why) => bad.push(`seed ${g.seed} (${g.size} players): ${why}`));
    expect(batch.length).toBeGreaterThan(0);
    expect(bad.slice(0, 6)).toEqual([]);
  });
}

const SEEDS = Array.from({ length: 8 }, (_, i) => i + 1);

describe('SanguoshaRoom', () => {
  describe('the lobby', () => {
    it('lists the pets, those that are out marked, and offers the two table sizes', () => {
      const t = table({ petsOn: () => ['mao', 'haru'] });
      t.room.lobby();
      const lobby = t.posts[0];
      if (lobby?.kind !== 'lobby') throw new Error('no lobby');
      expect(lobby.sizes).toEqual([5, 8]);
      expect(lobby.seats).toBe(7);
      expect(lobby.watchSeats).toBe(7);
      expect(lobby.minds).toBe(false);
      expect(lobby.choices.map((c) => c.id)).toEqual([...PET_IDS]);
      expect(lobby.choices.filter((c) => c.on).map((c) => c.id)).toEqual(['haru', 'mao']);
      expect(lobby.text.title).toBe(w.title);
      expect(lobby.text.size_5).toBe(w.size5);
      expect(lobby.text.size_8).toBe(w.size8);
      expect(lobby.text.start).toBe(en.games.start);
      expect(lobby.text.rules).toBe(w.rules);
      expect(lobby.text.pick).toContain('{n}');
      expect(t.posts).toHaveLength(1);
    });

    it('speaks the language of the user', () => {
      const t = table({ words: () => ({ g: zh.games, names: zh.ask.petName, language: 'Chinese' }) });
      t.room.lobby();
      const lobby = t.posts[0];
      if (lobby?.kind !== 'lobby') throw new Error('no lobby');
      expect(lobby.text.title).toBe(zh.games.sanguosha.title);
      expect(lobby.text.title).not.toBe(w.title);
      expect(lobby.text.rules).toBe(zh.games.sanguosha.rules);
      expect(lobby.choices[0]?.name).toBe(zh.ask.petName[PET_IDS[0]]);
    });

    it('offers a table of five and a table of eight, which every pet can fill', () => {
      expect([...SIZES]).toEqual([5, 8]);
      expect(PET_IDS.length).toBeGreaterThanOrEqual(Math.max(...SIZES) - 1);
    });
  });

  describe('a game', () => {
    it('seats the user at 0 and the pets he picked beside him, then fills the table with others', async () => {
      for (const size of SIZES) {
        const t = table({ seed: 3 });
        const picks: PetId[] = ['mao', 'haru'];
        t.start(picks, size);
        await tick();
        const seats = t.states()[0]?.seats ?? [];
        expect(seats).toHaveLength(size);
        expect(seats.map((s) => s.seat)).toEqual(Array.from({ length: size }, (_, i) => i));
        expect(seats[0]).toMatchObject({ me: true, id: 'user', name: 'You', color: '#4a90e2' });
        expect(seats.filter((s) => s.me)).toHaveLength(1);
        expect(seats.slice(1, 3).map((s) => s.id)).toEqual(picks);
        const pets = seats.slice(1).map((s) => s.id);
        expect(new Set(pets).size).toBe(size - 1);
        expect(pets.every((id) => (PET_IDS as readonly string[]).includes(id))).toBe(true);
        expect(seats[1]?.name).toBe(en.ask.petName.mao);
        t.room.stop();
      }
    });

    it('deals the roles of the table: the same set every time, shuffled between the seats', async () => {
      for (const size of SIZES) {
        const orders = new Set<string>();
        for (const seed of SEEDS) {
          const t = table({ seed });
          t.start([], size);
          const done = await t.finish(answerTo);
          expect(done, `seed ${seed}`).toBe(true);
          const over = t.last('over');
          const text = over?.text ?? '';
          const names = [...text.matchAll(/\d+\. [^/\n]*? (Lord|Loyalist|Rebel|Traitor)\b/g)].map((m) => m[1]);
          expect([...names].sort()).toEqual(ROLE_SETS[size].map((r) => w.role[r]).sort());
          orders.add(names.join(','));
        }
        expect(orders.size).toBeGreaterThan(1);
      }
    });

    it('tells the user his own role, and only his', async () => {
      for (const seed of SEEDS) {
        const t = table({ seed });
        t.start([], 5);
        await tick();
        const secrets = t.lines().filter((l) => l.tone === 'secret');
        expect(secrets).toHaveLength(2);
        const mine = mineIn(t.states()[0]?.seats)?.role;
        expect(mine, `seed ${seed}`).toBeTruthy();
        const role = mine as Role;
        expect(secrets.map((l) => l.text)).toEqual([w.youAre(w.role[role]), w.roleHint[role]]);
        t.room.stop();
      }
    });

    it('asks the user for a hero first: three to choose from, five if he is the lord, and none that is taken', async () => {
      for (const seed of SEEDS) {
        const t = table({ seed });
        t.start([], 8);
        expect(await asked(t), `seed ${seed}`).toBe(true);
        const ask = t.lastAsk();
        if (ask?.k !== 'hero') throw new Error(`seed ${seed}: no hero ask`);
        const lord = mineIn(t.states().at(-1)?.seats)?.role === 'lord';
        expect(ask.heroes).toHaveLength(lord ? 5 : 3);
        expect(ask.title).toBe(lord ? w.ask.heroLord : w.ask.hero);
        expect(new Set(ask.heroes.map((h) => h.id)).size).toBe(ask.heroes.length);
        for (const h of ask.heroes) {
          expect(h.hp).toBe(HEROES[h.id].hp + (lord ? 1 : 0));
          expect(h.skills).toEqual(HEROES[h.id].skills);
          expect(h.kingdom).toBe(HEROES[h.id].kingdom);
        }
        const taken = (t.states().at(-1)?.seats ?? []).flatMap((s) => (s.hero ? [s.hero] : []));
        expect(ask.heroes.some((h) => taken.includes(h.id))).toBe(false);
        t.room.stop();
      }
    });

    it('lets the lord choose first, so a user who is not the lord sees the lord with a hero when he chooses', async () => {
      let waited = 0;
      for (const seed of SEEDS) {
        const t = table({ seed });
        t.start([], 5);
        expect(await asked(t), `seed ${seed}`).toBe(true);
        const seats = t.states().at(-1)?.seats ?? [];
        if (mineIn(seats)?.role !== 'lord') {
          waited += 1;
          expect(seats.find((s) => s.role === 'lord')?.hero, `seed ${seed}`).not.toBeNull();
        }
        t.room.stop();
      }
      expect(waited).toBeGreaterThan(0);
    });

    it('shows no role the user may not know, and every role of those who have fallen', async () => {
      const games = await Promise.all(SEEDS.map((seed) => playOut(seed, 5)));
      for (const g of games) {
        expect(g.done, `seed ${g.seed}`).toBe(true);
        for (const s of only(g.posts, 'state')) {
          for (const seat of s.seats) {
            const open = seat.me || seat.role === 'lord' || !seat.alive;
            expect(seat.role !== null, `seed ${g.seed} seat ${seat.seat}`).toBe(open);
          }
        }
      }
    });

    it('does not start a second game over the first', async () => {
      const t = table({ seed: 2 });
      t.start([], 5);
      await tick();
      const before = t.states().length;
      t.start([], 8);
      await tick();
      expect(t.states().length).toBe(before);
      expect(t.states().every((s) => s.seats.length === 5)).toBe(true);
      t.room.stop();
    });

    it('waits for the user for as long as he takes', async () => {
      const t = table({ seed: 4 });
      t.start([], 5);
      expect(await asked(t)).toBe(true);
      const posted = t.posts.length;
      for (let i = 0; i < 200; i++) {
        t.clock.fire();
        await tick();
      }
      expect(t.posts).toHaveLength(posted);
      expect(t.clock.live()).toBe(0);
      expect(t.last('over')).toBeUndefined();
      expect(t.lastAsk()?.k).toBe('hero');
      t.room.stop();
    });

    it('puts a question again to a page that answers it with the wrong kind of answer', async () => {
      const t = table({ seed: 4 });
      t.start([], 5);
      expect(await asked(t)).toBe(true);
      const ask = t.lastAsk();
      expect(ask?.k).toBe('hero');
      const before = t.posts.length;
      t.room.on({ t: 'reply', reply: { k: 'end' } });
      expect(t.posts).toHaveLength(before + 1);
      expect(t.posts.at(-1)).toEqual({ kind: 'ask', ask });
      t.room.on({ t: 'reply', reply: { k: 'confirm', yes: true } });
      expect(t.posts.at(-1)).toEqual({ kind: 'ask', ask });
      // The question was not taken as answered, so the table is still where it was.
      await tick();
      expect(t.lastAsk()).toEqual(ask);
      t.room.stop();
    });

    it('takes the right answer once and puts the question away', async () => {
      const t = table({ seed: 4 });
      t.start([], 5);
      expect(await asked(t)).toBe(true);
      const ask = t.lastAsk();
      if (ask?.k !== 'hero') throw new Error('no hero ask');
      const hero = ask.heroes[1]!.id;
      t.room.on({ t: 'reply', reply: { k: 'hero', hero } });
      expect(t.posts.at(-1)).toEqual({ kind: 'ask', ask: null });
      const after = t.posts.length;
      t.room.on({ t: 'reply', reply: { k: 'hero', hero: ask.heroes[0]!.id } });
      expect(t.posts).toHaveLength(after);
      await tick();
      const mine = mineIn(t.states().at(-1)?.seats);
      expect(mine?.hero).toBe(hero);
      t.room.stop();
    });

    it('ignores an answer when no question is waiting', () => {
      const t = table();
      t.room.on({ t: 'reply', reply: { k: 'end' } });
      t.room.lobby();
      t.room.on({ t: 'reply', reply: { k: 'end' } });
      expect(t.posts.map((m) => m.kind)).toEqual(['lobby']);
    });

    it('shows the user his own hand and nothing of the others but how many cards they hold', async () => {
      const g = await playOut(5, 5);
      expect(g.done).toBe(true);
      const states = only(g.posts, 'state');
      expect(states.some((s) => s.hand.length > 0)).toBe(true);
      for (const s of states) {
        for (const seat of s.seats) {
          expect(typeof seat.hand).toBe('number');
          expect(seat.hp).toBeGreaterThanOrEqual(0);
          expect(seat.hp).toBeLessThanOrEqual(seat.maxHp);
        }
        expect(s.hand.length).toBe(mineIn(s.seats)?.hand);
      }
    });

    it('goes on after the user is out of it, until a side has won', async () => {
      const g = await playOut(6, 8, idle);
      expect(g.done).toBe(true);
      const over = only(g.posts, 'over');
      expect(over).toHaveLength(1);
    });
  });

  describe('whole games', () => {
    for (const [name, policy] of [['an active user', answerTo], ['an idle user', idle]] as const) {
      describe(`with ${name}`, () => {
        let all: Game[] = [];
        it('plays every game to its end', async () => {
          all = [];
          for (const size of SIZES) for (const seed of SEEDS) all.push(await playOut(seed, size, policy));
          expect(all.length).toBe(SIZES.length * SEEDS.length);
          expect(all.filter((g) => !g.done).map((g) => `${g.seed}/${g.size}`)).toEqual([]);
        }, 120_000);

        eachGame(() => all, 'posts one verdict, last, and it names the side that has won', (g, bad) => {
          const over = only(g.posts, 'over');
          if (over.length !== 1) return bad(`${over.length} verdicts`);
          const verdict = over[0]!;
          const mine = (mineIn(only(g.posts, 'state').at(-1)?.seats)?.role ?? 'rebel') as Role;
          if (verdict.winner !== null && verdict.win !== (sideOf(mine) === verdict.winner)) bad('win is not his side');
          if (verdict.winner === null && verdict.win) bad('called off, yet a win');
          const lastMsg = g.posts.at(-1);
          if (lastMsg?.kind !== 'over') bad(`ends with a ${lastMsg?.kind}`);
          if (verdict.title.trim() === '' || verdict.text.trim() === '') bad('empty verdict');
        });

        eachGame(() => all, 'shows a table of the size asked for, all through', (g, bad) => {
          for (const s of only(g.posts, 'state')) if (s.seats.length !== g.size) bad(`${s.seats.length} seats`);
        });

        eachGame(() => all, 'lets pets speak, never the user and never in the voice of the log', (g, bad) => {
          const pool = new Set(Object.values(w.chat).flat());
          for (const l of only(g.posts, 'line')) {
            if (l.tone !== 'say') continue;
            if (l.seat === null || l.seat === 0) bad(`${l.seat} speaks`);
            if (!pool.has(l.text)) bad(`unknown speech ${l.text}`);
          }
        });

        eachGame(() => all, 'only ever asks for what the table has: cards of his own, seats at the table', (g, bad) => {
          let hand = new Set<number>();
          for (const m of g.posts) {
            if (m.kind === 'state') hand = new Set(m.hand.map((c) => c.id));
            if (m.kind !== 'ask' || !m.ask) continue;
            const a = m.ask;
            if (a.title.trim() === '') bad(`no title for a ${a.k} ask`);
            if (a.k === 'play') {
              for (const u of a.uses) {
                if (!hand.has(u.card)) bad(`plays card ${u.card} that is not in his hand`);
                if (!(CARD_NAMES as readonly string[]).includes(u.as)) bad(`plays as ${u.as}`);
                if (u.targets.options.some((s) => s < 0 || s >= g.size)) bad('a target off the table');
              }
            } else if (a.k === 'cards') {
              if (a.min > a.max || a.min > a.cards.length) bad(`cards ${a.min}-${a.max} of ${a.cards.length}`);
              for (const c of a.cards) if (!(CARD_NAMES as readonly string[]).includes(c.name)) bad(`card ${c.name}`);
            } else if (a.k === 'seat') {
              if (a.options.some((s) => s < 0 || s >= g.size)) bad('a seat off the table');
            } else if (a.k === 'hero') {
              if (a.heroes.length < 3) bad('too few heroes');
            }
          }
        });
      });
    }
  });

  describe('stopping', () => {
    it('stops a game at once: nothing more is posted and no timer is left', async () => {
      const t = table({ seed: 7 });
      t.start([], 8);
      await t.play(() => t.states().length > 20);
      t.room.stop();
      const posted = t.posts.length;
      for (let i = 0; i < 40; i++) {
        t.clock.fire();
        await tick();
      }
      expect(t.posts).toHaveLength(posted);
      expect(t.clock.live()).toBe(0);
      expect(t.last('over')).toBeUndefined();
    });

    it('lets go of a question the user has not answered', async () => {
      const t = table({ seed: 7 });
      t.start([], 5);
      expect(await asked(t)).toBe(true);
      t.room.stop();
      const posted = t.posts.length;
      t.room.on({ t: 'reply', reply: { k: 'hero', hero: 'liubei' } });
      await tick();
      expect(t.posts).toHaveLength(posted);
      expect(t.lines().filter((l) => l.text.includes('stopped'))).toEqual([]);
    });

    it('goes back to the lobby when asked to play again, and then plays another game', async () => {
      const t = table({ seed: 8 });
      t.start([], 5);
      expect(await t.finish(answerTo)).toBe(true);
      t.room.on({ t: 'start', pets: [], size: 8 });
      await tick();
      expect(t.states().every((s) => s.seats.length === 5)).toBe(true);
      t.room.on({ t: 'again' });
      expect(t.posts.at(-1)?.kind).toBe('lobby');
      const before = t.states().length;
      t.start([], 8);
      await tick();
      expect(t.states().length).toBeGreaterThan(before);
      expect(t.states().at(-1)?.seats).toHaveLength(8);
      t.room.stop();
    });

    it('stops the game when the lobby is shown again, whatever it was up to', async () => {
      const t = table({ seed: 9 });
      t.start([], 5);
      await tick();
      t.room.lobby();
      const posted = t.posts.length;
      for (let i = 0; i < 20; i++) {
        t.clock.fire();
        await tick();
      }
      expect(t.posts).toHaveLength(posted);
      expect(t.posts.at(-1)?.kind).toBe('lobby');
    });
  });

  describe('a game is the same game for the same seed', () => {
    it('posts the same things in the same order', async () => {
      const a = await playOut(11, 5);
      const b = await playOut(11, 5);
      expect(a.done && b.done).toBe(true);
      expect(JSON.stringify(b.posts)).toBe(JSON.stringify(a.posts));
      const c = await playOut(12, 5);
      expect(JSON.stringify(c.posts)).not.toBe(JSON.stringify(a.posts));
    });
  });

  describe('in Chinese', () => {
    it('shows the log and the verdict in Chinese', async () => {
      const t = table({ seed: 5, words: () => ({ g: zh.games, names: zh.ask.petName, language: 'Chinese' }) });
      t.start([], 5);
      expect(await t.finish(answerTo)).toBe(true);
      const text = t.lines().map((l) => l.text).join('\n');
      expect(text).toMatch(/[\u4e00-\u9fff]/);
      expect(text).not.toMatch(/\bturn\b/i);
      expect(mineIn(t.states()[0]?.seats)?.name).toBe(zh.games.you);
      expect(t.last('over')?.title).toMatch(/[\u4e00-\u9fff]/);
    });
  });
});

/** A stand-in for a model: it reads the question as it is written and answers with the first thing offered. */
function model(text: string): string {
  if (text.includes('{"pick": <number>}')) return '{"pick": 1}';
  if (text.includes('"plan"')) {
    const lines = text.matchAll(/^\[(\d+)\] [^\n]*?: (?:no target|aim at \d+(?: to \d+)? of #(\d+))/gm);
    const plan = [...lines].map((m) => (m[2] === undefined ? { card: Number(m[1]) } : { card: Number(m[1]), targets: [Number(m[2])] }));
    return JSON.stringify({ plan, say: 'On we go.' });
  }
  const card = /Cards you may play: \[(\d+)\]/.exec(text)?.[1];
  return JSON.stringify({ play: card === undefined ? [] : [Number(card)] });
}

/** A stand-in whose answers are well formed and none of them can be played. */
function junk(text: string): string {
  if (text.includes('{"pick": <number>}')) return '{"pick": 99}';
  if (text.includes('"plan"')) return '{"plan": [{"card": 9999}], "say": "Hm."}';
  return '{"play": [9999]}';
}

interface Prompt {
  seat: number;
  text: string;
}

/** A table whose pets think with `reply`, and every prompt they are given. */
function minded(reply: (seat: number, text: string) => string | null = (_seat, text) => model(text), over: Over = {}) {
  const prompts: Prompt[] = [];
  const fb = fakeBrain((seat, text) => {
    prompts.push({ seat, text });
    return reply(seat, text);
  });
  const t = table({ canThink: () => true, brain: () => fb.brain, ...over });
  return { t, fb, prompts };
}

/** A table whose brain holds the questions that `hold` picks until the test answers them, and answers the rest at once. */
function slow(hold: (text: string) => boolean = () => true) {
  const held: ((text: string | null) => void)[] = [];
  const brain = {
    warm: vi.fn(),
    ask: vi.fn((_seat: number, text: string) => (hold(text)
      ? new Promise<string | null>((resolve) => { held.push(resolve); })
      : Promise.resolve<string | null>(model(text)))),
    close: vi.fn(),
  };
  const t = table({ canThink: () => true, brain: () => brain as unknown as GameBrain });
  return { t, held, brain };
}

const thinkingOf = (posts: readonly SgsOut[]): number[][] => only(posts, 'thinking').map((m) => m.seats);
const withoutThinking = (posts: readonly SgsOut[]): SgsOut[] => posts.filter((m) => m.kind !== 'thinking');
/** Turns the clock until every seat has its hero. */
const heroesChosen = (t: Table): Promise<boolean> =>
  t.play(() => (t.states().at(-1)?.seats ?? []).length > 0 && (t.states().at(-1)?.seats ?? []).every((s) => s.hero !== null), answerTo);

describe('SanguoshaRoom with the pets thinking', () => {
  it('tells the lobby whether they can', () => {
    for (const can of [true, false]) {
      const t = table({ canThink: () => can });
      t.room.lobby();
      expect(only(t.posts, 'lobby')[0]?.minds).toBe(can);
    }
  });

  it('puts the questions of the pets to the brain, none of the user\'s, and warms it once a game', async () => {
    for (const size of SIZES) {
      const { t, fb, prompts } = minded(undefined, { seed: 2 });
      t.start([], size);
      expect(fb.warm).toHaveBeenCalledTimes(1);
      expect(await t.finish(answerTo)).toBe(true);
      expect(fb.warm).toHaveBeenCalledTimes(1);
      expect(prompts.length).toBeGreaterThan(size);
      expect(prompts.length).toBeLessThanOrEqual(SGS_BUDGET);
      expect(new Set(prompts.map((p) => p.seat))).toEqual(new Set(Array.from({ length: size - 1 }, (_, i) => i + 1)));
    }
  });

  it('asks no more than the budget of a game, whatever the table', async () => {
    for (const size of SIZES) {
      for (const seed of SEEDS) {
        const { t, prompts } = minded(undefined, { seed });
        t.start([], size);
        expect(await t.finish(answerTo), `seed ${seed}`).toBe(true);
        expect(prompts.length, `seed ${seed}`).toBeLessThanOrEqual(SGS_BUDGET);
      }
    }
  }, 120_000);

  it('has no pet thinking when there is no brain to think with', async () => {
    const g = await playOut(3, 5);
    expect(g.done).toBe(true);
    expect(thinkingOf(g.posts)).toEqual([]);
  });

  it('seats each pet with the hero its mind chose', async () => {
    const chose = new Map<number, HeroId>();
    const { t } = minded((seat, text) => {
      if (!text.includes('{"pick": <number>}')) return model(text);
      const name = /^3\. (.+?) \(/m.exec(text)?.[1];
      const hero = HERO_IDS.find((h) => w.hero[h] === name);
      if (hero) chose.set(seat, hero);
      return '{"pick": 3}';
    }, { seed: 4 });
    t.start([], 5);
    expect(await heroesChosen(t)).toBe(true);
    const seats = t.states().at(-1)?.seats ?? [];
    expect([...chose.keys()].sort()).toEqual([1, 2, 3, 4]);
    for (const [seat, hero] of chose) expect(seats[seat]?.hero, `seat ${seat}`).toBe(hero);
    t.room.stop();
  });

  it('plays the plans of the minds, and lets the pets say what their plans said', async () => {
    const rules = await playOut(5, 5);
    const { t } = minded(undefined, { seed: 5 });
    t.start(picksFor(5), 5);
    expect(await t.finish(answerTo)).toBe(true);
    expect(JSON.stringify(withoutThinking(t.posts))).not.toBe(JSON.stringify(rules.posts));
    const said = t.lines().filter((l) => l.tone === 'say' && l.text === 'On we go.');
    expect(said.length).toBeGreaterThan(0);
    expect(said.every((l) => l.seat !== null && l.seat > 0)).toBe(true);
  });

  it('plays the rules\' game when the brain has nothing it can use: the same posts, but for the thinking', async () => {
    const rules = await playOut(5, 5);
    expect(rules.done).toBe(true);
    const fails: [string, (seat: number, text: string) => string | null][] = [
      ['no answer', () => null],
      ['an answer that is no JSON', () => 'I would rather not say.'],
      ['an answer that cannot be played', (_seat, text) => junk(text)],
      ['a brain that breaks', () => { throw new Error('boom'); }],
    ];
    for (const [name, reply] of fails) {
      const { t, prompts } = minded(reply, { seed: 5 });
      t.start(picksFor(5), 5);
      expect(await t.finish(answerTo), name).toBe(true);
      expect(prompts.length, name).toBeGreaterThan(0);
      expect(withoutThinking(t.posts), name).toEqual(rules.posts);
    }
  });

  it('says which pet is thinking while it does, and that none is when it has answered', async () => {
    for (const size of SIZES) {
      const { t } = minded(undefined, { seed: 3 });
      t.start([], size);
      expect(await t.finish(answerTo)).toBe(true);
      const seen = thinkingOf(t.posts);
      expect(seen.length).toBeGreaterThan(size);
      seen.forEach((seats, i) => {
        if (i % 2 === 1) return expect(seats).toEqual([]);
        expect(seats).toHaveLength(1);
        expect(seats[0]).toBeGreaterThan(0);
        expect(seats[0]).toBeLessThan(size);
      });
      expect(seen.at(-1)).toEqual([]);
    }
  });

  it('plays every game to its end, the verdict last and no pet left thinking', async () => {
    const bad: string[] = [];
    for (const size of SIZES) {
      for (const seed of SEEDS) {
        const { t } = minded(undefined, { seed });
        t.start(picksFor(seed), size);
        const name = `seed ${seed} (${size} players)`;
        if (!(await t.finish(answerTo))) {
          bad.push(`${name}: it never ends`);
          continue;
        }
        if (only(t.posts, 'over').length !== 1) bad.push(`${name}: not one verdict`);
        if (t.posts.at(-1)?.kind !== 'over') bad.push(`${name}: ends with a ${t.posts.at(-1)?.kind}`);
        if (thinkingOf(t.posts).at(-1)?.length !== 0) bad.push(`${name}: a pet is left thinking`);
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('tells a pet only what its seat can know of the roles: its own, the lord\'s and the fallen\'s', async () => {
    const roles = Object.values(w.role).join('|');
    const seen = new RegExp(`^#(\\d+) [^,:\\n]+, (${roles})\\b`);
    let checked = 0;
    for (const size of SIZES) {
      for (const seed of SEEDS) {
        const { t, prompts } = minded(undefined, { seed });
        t.start([], size);
        expect(await t.finish(answerTo), `seed ${seed}`).toBe(true);
        for (const p of prompts) {
          for (const line of p.text.split('\n')) {
            const m = seen.exec(line);
            if (!m) continue;
            checked += 1;
            const open = Number(m[1]) - 1 === p.seat || m[2] === w.role.lord || line.endsWith('out of the game');
            expect(open, `seed ${seed}, seat ${p.seat}: ${line}`).toBe(true);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  }, 120_000);

  it('briefs each pet in the language of the user, as the character it is, and names the user for what he is', async () => {
    for (const [strs, language] of [[en, 'English'], [zh, 'Simplified Chinese']] as const) {
      const { t, prompts } = minded(undefined, { seed: 6, words: () => ({ g: strs.games, names: strs.ask.petName, language }) });
      t.start(PET_IDS.slice(0, 4), 5);
      expect(await t.finish(answerTo), language).toBe(true);
      const seats = t.states().at(-1)?.seats ?? [];
      const pets = seats.filter((s) => !s.me);
      expect(pets).toHaveLength(4);
      for (const s of pets) {
        const first = prompts.find((p) => p.seat === s.seat)?.text ?? '';
        expect(first, `${language} seat ${s.seat}`).toContain(`Speak in ${language}`);
        expect(first).toContain(`Your character: the persona of ${s.id}`);
        expect(first).toContain(`You are seat #${s.seat + 1}, ${strs.ask.petName[s.id as PetId]}`);
      }
      const plan = prompts.find((p) => p.text.includes('"plan"'));
      expect(plan?.text).toContain('#1 the user');
      expect(prompts.every((p) => !p.text.includes('#1 You'))).toBe(true);
    }
  });

  it('lets the brain go when the game is over, and at once when it is stopped', async () => {
    const over = minded();
    over.t.start([], 5);
    expect(over.fb.close).not.toHaveBeenCalled();
    expect(await over.t.finish(answerTo)).toBe(true);
    await tick();
    expect(over.fb.close).toHaveBeenCalled();

    const stopped = minded();
    stopped.t.start([], 5);
    await tick();
    expect(stopped.fb.close).not.toHaveBeenCalled();
    stopped.t.room.stop();
    expect(stopped.fb.close).toHaveBeenCalled();
  });

  it('waits for a pet that is still thinking, and goes on with the answer it gets', async () => {
    const { t, held } = slow();
    t.start([], 5);
    expect(await t.play(() => held.length > 0, answerTo)).toBe(true);
    expect(thinkingOf(t.posts).at(-1)).toHaveLength(1);
    const before = t.posts.length;
    for (let i = 0; i < 20; i++) {
      t.clock.fire();
      await tick();
    }
    expect(t.posts).toHaveLength(before);
    expect(held).toHaveLength(1);
    held[0]?.('{"pick": 1}');
    await tick();
    expect(t.posts.length).toBeGreaterThan(before);
    expect(thinkingOf(t.posts).at(-1)).toEqual([]);
    t.room.stop();
  });

  it('posts nothing more when the game is stopped while a pet is thinking, whatever it says later', async () => {
    const { t, held, brain } = slow((text) => text.includes('"plan"'));
    t.start([], 5);
    expect(await t.play(() => held.length > 0, answerTo)).toBe(true);
    expect(thinkingOf(t.posts).at(-1)).toHaveLength(1);
    t.room.stop();
    expect(brain.close).toHaveBeenCalled();
    const posted = t.posts.length;
    for (const release of held) release('{"plan": [], "say": "Too late."}');
    for (let i = 0; i < 10; i++) {
      t.clock.fire();
      await tick();
    }
    expect(t.posts).toHaveLength(posted);
    expect(t.lines().filter((l) => l.text === 'Too late.')).toEqual([]);
    expect(t.clock.live()).toBe(0);
    expect(t.last('over')).toBeUndefined();
  });
});

describe('fits', () => {
  const ask = (k: Ask['k']): Ask => {
    switch (k) {
      case 'hero': return { k, heroes: [], lord: false };
      case 'play': return { k, uses: [], skills: [] };
      case 'cards': return { k, why: 'shan', ctx: {}, cards: [], min: 0, max: 0 };
      case 'area': return { k, why: 'chai', ctx: {}, owner: 0, hand: 0, equip: [], judges: [] };
      case 'seat': return { k, why: 'tuxi', ctx: {}, options: [], min: 0, max: 0 };
      case 'confirm': return { k, why: 'bagua', ctx: {} };
    }
  };
  const replies: Reply[] = [
    { k: 'hero', hero: 'liubei' }, { k: 'use', card: 1, as: 'sha', targets: [] }, { k: 'skill', skill: 'rende', cards: [], targets: [] },
    { k: 'end' }, { k: 'cards', ids: [] }, { k: 'area', zone: 'hand', card: null }, { k: 'seat', seats: [] },
    { k: 'confirm', yes: true },
  ];

  it('takes a card, a skill or the end of the turn as the answer to a play, and no other', () => {
    const kinds = replies.filter((r) => fits(ask('play'), r)).map((r) => r.k);
    expect(kinds).toEqual(['use', 'skill', 'end']);
  });

  it('takes the answer of the same kind as any other question', () => {
    for (const k of ['hero', 'cards', 'area', 'seat', 'confirm'] as const) {
      expect(replies.filter((r) => fits(ask(k), r)).map((r) => r.k), k).toEqual([k]);
    }
  });
});

describe('pace', () => {
  const die: Entry = { k: 'die', seat: 3, role: 'rebel', killer: 1 };
  const phase: Entry = { k: 'phase', seat: 1, phase: 'draw' };
  const mine: Entry = { k: 'use', seat: 0, name: 'sha', cards: [], targets: [1] };
  const theirs: Entry = { k: 'use', seat: 2, name: 'sha', cards: [], targets: [1] };

  it('lets the table linger on what happens, and not at all on what is only a step', () => {
    expect(pace(die, true)).toBeGreaterThan(pace(theirs, true));
    expect(pace(theirs, true)).toBeGreaterThan(0);
    expect(pace(phase, true)).toBe(0);
    expect(pace({ k: 'draw', seat: 1, n: 2, cards: [] }, true)).toBe(0);
  });

  it('hurries past the moves the user has just made himself', () => {
    expect(pace(mine, true)).toBeLessThan(pace(theirs, true));
    expect(pace(mine, true)).toBeGreaterThan(0);
  });

  it('hurries once the user is out and only watching', () => {
    expect(pace(die, false)).toBeLessThan(pace(die, true));
    expect(pace(theirs, false)).toBeLessThan(pace(theirs, true));
  });

  it('is a whole number of milliseconds, never more than a second', () => {
    const entries: Entry[] = [die, phase, mine, theirs, { k: 'shuffle' }, { k: 'end', winner: 'lord' }];
    for (const e of entries) for (const alive of [true, false]) {
      const ms = pace(e, alive);
      expect(Number.isInteger(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(1000);
    }
  });
});

describe('askView', () => {
  const engine = (): Engine => new Engine({
    random: seeded(1), ask: () => Promise.resolve(null), emit: () => undefined, stopped: () => false,
  }, ROLE_SETS[5]);
  const cardOf = (e: Engine, id: number): Card => {
    const card = e.card(id);
    if (!card) throw new Error(`no card ${id}`);
    return card;
  };

  it('names the cards offered by what they are', () => {
    const e = engine();
    const a: Ask = { k: 'cards', why: 'discard', ctx: { amount: 2 }, cards: [3, 9, 40], min: 2, max: 2 };
    const view = askView(a, e, 'Discard two');
    expect(view).toMatchObject({ k: 'cards', title: 'Discard two', why: 'discard', min: 2, max: 2 });
    if (view.k !== 'cards') throw new Error('not cards');
    expect(view.cards.map((c) => c.id)).toEqual([3, 9, 40]);
    for (const c of view.cards) {
      const card = cardOf(e, c.id);
      expect(c).toEqual({ id: card.id, name: card.name, suit: card.suit, rank: card.rank });
    }
  });

  it('leaves out a card that is nowhere', () => {
    const view = askView({ k: 'cards', why: 'discard', ctx: {}, cards: [3, 99_999], min: 0, max: 2 }, engine(), 'x');
    if (view.k !== 'cards') throw new Error('not cards');
    expect(view.cards.map((c) => c.id)).toEqual([3]);
  });

  it('shows the heroes with the hit points they would start with', () => {
    const lord = askView({ k: 'hero', heroes: ['liubei', 'caocao'], lord: true }, engine(), 'Pick');
    const other = askView({ k: 'hero', heroes: ['liubei', 'caocao'], lord: false }, engine(), 'Pick');
    if (lord.k !== 'hero' || other.k !== 'hero') throw new Error('not heroes');
    expect(lord.heroes.map((h) => h.id)).toEqual(['liubei', 'caocao']);
    expect(lord.heroes[0]?.hp).toBe(other.heroes[0]!.hp + 1);
    expect(other.heroes[0]).toMatchObject({ id: 'liubei', kingdom: HEROES.liubei.kingdom, skills: HEROES.liubei.skills });
  });

  it('shows what is on a player to take: the hand as a count, the cards worn and the tricks waiting', () => {
    const e = engine();
    const horse = cardOf(e, 100);
    const trick = cardOf(e, 50);
    const other = cardOf(e, 60);
    const victim = e.p(2);
    victim.equip.plus = horse;
    victim.judges.push({ card: trick, as: 'lebu' }, { card: other, as: 'bing' });
    victim.hand.push(cardOf(e, 1), cardOf(e, 2));
    const view = askView(
      { k: 'area', why: 'chai', ctx: {}, owner: 2, hand: 2, equip: [horse.id], judges: [trick.id] }, e, 'Take',
    );
    if (view.k !== 'area') throw new Error('not area');
    expect(view).toMatchObject({ owner: 2, hand: 2, title: 'Take' });
    expect(view.equip.map((c) => c.id)).toEqual([horse.id]);
    expect(view.judges).toEqual([{ as: 'lebu', card: { id: trick.id, name: trick.name, suit: trick.suit, rank: trick.rank } }]);
  });

  it('passes on what the other questions say', () => {
    const e = engine();
    expect(askView({ k: 'confirm', why: 'bagua', ctx: {} }, e, 'Use it?')).toEqual({ k: 'confirm', title: 'Use it?' });
    expect(askView({ k: 'seat', why: 'tuxi', ctx: {}, options: [1, 2], min: 0, max: 2 }, e, 'Who?')).toEqual({
      k: 'seat', title: 'Who?', options: [1, 2], min: 0, max: 2,
    });
    expect(askView({ k: 'play', uses: [], skills: [] }, e, 'Your turn')).toEqual({
      k: 'play', title: 'Your turn', uses: [], skills: [],
    });
  });
});
