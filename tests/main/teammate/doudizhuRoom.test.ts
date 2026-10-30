import { describe, expect, it, vi } from 'vitest';
import { DoudizhuRoom, askView, fits, pace } from '../../../src/main/teammate/doudizhuRoom';
import type { GameBrain } from '../../../src/main/teammate/gameBrain';
import type { DdzAsk, DdzIn, DdzOut, DdzSeat } from '../../../src/shared/gameIpc';
import { strings } from '../../../src/shared/i18n';
import { RANKS, checkPlay } from '../../../src/shared/teammate/doudizhuCards';
import type { Card, Play } from '../../../src/shared/teammate/doudizhuCards';
import { DDZ_BUDGET } from '../../../src/shared/teammate/doudizhuMind';
import { CONFIG, MAX_BID, MAX_DOUBLINGS, SIZES } from '../../../src/shared/teammate/doudizhuTypes';
import type { Ask, Entry, Reply, Result, Size } from '../../../src/shared/teammate/doudizhuTypes';
import type { TableView } from '../../../src/shared/teammate/doudizhuView';
import { PET_IDS, type PetId } from '../../../src/shared/teammate/pet';
import { cards } from '../../shared/teammate/doudizhuRig';
import { fakeBrain, fakeServices, tick } from './gameFakes';

const en = strings('en', 'win').teammate;
const zh = strings('zh-CN', 'win').teammate;
const w = en.games.doudizhu;

type Over = NonNullable<Parameters<typeof fakeServices>[0]>;
type Post<K extends DdzOut['kind']> = Extract<DdzOut, { kind: K }>;
/** How the user answers a question, with `hint` for the table's next hint; null leaves the question unanswered. */
type Policy = (ask: DdzAsk, n: number, hint: () => number[]) => DdzIn | null;

const only = <K extends DdzOut['kind']>(posts: readonly DdzOut[], kind: K): Post<K>[] =>
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

/** A user who answers everything the table asks: bids in turn, plays the hint of the moment or one a few on, and passes now and then. */
const answerTo: Policy = (ask, n, hint) => {
  if (ask.k === 'bid') return { t: 'bid', bid: n % 3 === 0 ? 0 : n % 3 === 1 ? ask.min : ask.max };
  if (!ask.lead && n % 4 === 3) return { t: 'play', ids: [] };
  for (let i = 0; i < n % 3; i++) hint();
  const ids = hint();
  return ids.length > 0 || !ask.lead ? { t: 'play', ids } : null;
};

/** A user who never bids, passes whenever he may, and plays the best hint when he has to lead. */
const idle: Policy = (ask, _n, hint) => {
  if (ask.k === 'bid') return { t: 'bid', bid: 0 };
  const ids = ask.lead ? hint() : [];
  return ask.lead && ids.length === 0 ? null : { t: 'play', ids };
};

/** The room, what it posted, and a user who answers the questions put to him. */
function table(over: Over = {}) {
  const { seed = 1, ...rest } = over;
  const posts: DdzOut[] = [];
  const { services, clock } = fakeServices({ random: seeded(seed), ...rest });
  const room = new DoudizhuRoom(services, (m) => posts.push(m));
  let answered = 0;
  let n = 0;

  const last = <K extends DdzOut['kind']>(kind: K): Post<K> | undefined => {
    for (let i = posts.length - 1; i >= 0; i--) {
      const m = posts[i];
      if (m?.kind === kind) return m as Post<K>;
    }
    return undefined;
  };
  const lastAsk = (): DdzAsk | null => last('ask')?.ask ?? null;
  /** The next hint the table offers for the question that is waiting. */
  const hint = (): number[] => {
    room.on({ t: 'hint' });
    return last('hint')?.ids ?? [];
  };

  /** Turns the clock, answering each new question with `policy`, until `done`; false if it never does. */
  const play = async (done: () => boolean, policy: Policy | null = answerTo): Promise<boolean> => {
    for (let i = 0; i < 100_000; i++) {
      if (done()) return true;
      const ask = lastAsk();
      if (policy && ask && posts.length > answered) {
        answered = posts.length;
        const reply = policy(ask, n++, hint);
        if (reply) room.on(reply);
        answered = posts.length;
      }
      if (!clock.fire()) await tick();
    }
    return false;
  };

  return {
    room, posts, clock, services, play, last, lastAsk, hint,
    start: (pets: PetId[] = [], size: Size = 3): void => room.on({ t: 'start', pets, size }),
    finish: (policy: Policy | null = answerTo) => play(() => last('over') !== undefined, policy),
    states: () => only(posts, 'state'),
    lines: () => only(posts, 'line'),
    asks: () => only(posts, 'ask').flatMap((m) => (m.ask ? [m.ask] : [])),
  };
}

const mineIn = (seats: readonly DdzSeat[] | undefined): DdzSeat | undefined => seats?.find((s) => s.me);

type Table = ReturnType<typeof table>;
/** Turns the clock until the user is asked something. */
const asked = (t: Table): Promise<boolean> => t.play(() => t.lastAsk() !== null, null);

/** Turns the clock, answering what is asked of the user, until he is asked a question of kind `k` (a follow, if `follow`); false if the game ends first. */
async function askedFor(t: Table, k: DdzAsk['k'], follow = false): Promise<boolean> {
  const wanted = (): boolean => {
    const ask = t.lastAsk();
    return ask?.k === k && (!follow || (ask.k === 'play' && !ask.lead));
  };
  await t.play(() => wanted() || t.last('over') !== undefined, answerTo);
  return wanted();
}

interface Game {
  seed: number;
  size: Size;
  picks: PetId[];
  done: boolean;
  posts: DdzOut[];
}

async function playOut(seed: number, size: Size, policy: Policy = answerTo): Promise<Game> {
  const picks = picksFor(seed);
  const t = table({ seed });
  t.start(picks, size);
  const done = await t.finish(policy);
  return { seed, size, picks, done, posts: t.posts };
}

/** One test over a batch of games, which names the games that fail it. */
function eachGame<G extends Game>(
  games: () => G[], title: string, check: (g: G, bad: (why: string) => void) => void,
): void {
  it(title, () => {
    const bad: string[] = [];
    const batch = games();
    for (const g of batch) check(g, (why) => bad.push(`seed ${g.seed} (${g.size} players): ${why}`));
    expect(batch.length).toBeGreaterThan(0);
    expect(bad.slice(0, 6)).toEqual([]);
  });
}

const SEEDS = Array.from({ length: 6 }, (_, i) => i + 1);

describe('DoudizhuRoom', () => {
  describe('the lobby', () => {
    it('lists the pets, those that are out marked, and offers the four table sizes', () => {
      const t = table({ petsOn: () => ['mao', 'haru'] });
      t.room.lobby();
      const lobby = t.posts[0];
      if (lobby?.kind !== 'lobby') throw new Error('no lobby');
      expect(lobby.sizes).toEqual([3, 4, 5, 6]);
      expect(lobby.seats).toBe(5);
      expect(lobby.watchSeats).toBe(5);
      expect(lobby.minds).toBe(false);
      expect(lobby.choices.map((c) => c.id)).toEqual([...PET_IDS]);
      expect(lobby.choices.filter((c) => c.on).map((c) => c.id)).toEqual(['haru', 'mao']);
      expect(lobby.text.title).toBe(w.title);
      expect(lobby.text.size_3).toBe(w.size3);
      expect(lobby.text.size_4).toBe(w.size4);
      expect(lobby.text.size_5).toBe(w.size5);
      expect(lobby.text.size_6).toBe(w.size6);
      expect(lobby.text.start).toBe(en.games.start);
      expect(lobby.text.rules).toBe(w.rules);
      expect(lobby.text.mindsOn).toBe(w.minds);
      expect(lobby.text.mindsOff).toBe(en.games.mindsOff);
      expect(lobby.text.thinking).toBe(w.thinking);
      expect(lobby.text.pick).toContain('{n}');
      expect(t.posts).toHaveLength(1);
    });

    it('speaks the language of the user', () => {
      const t = table({ words: () => ({ g: zh.games, names: zh.ask.petName, language: 'Chinese' }) });
      t.room.lobby();
      const lobby = t.posts[0];
      if (lobby?.kind !== 'lobby') throw new Error('no lobby');
      expect(lobby.text.title).toBe(zh.games.doudizhu.title);
      expect(lobby.text.title).not.toBe(w.title);
      expect(lobby.text.rules).toBe(zh.games.doudizhu.rules);
      expect(lobby.text.size_6).toBe(zh.games.doudizhu.size6);
      expect(lobby.choices[0]?.name).toBe(zh.ask.petName[PET_IDS[0]]);
    });

    it('offers tables of three to six, which the pets can fill', () => {
      expect([...SIZES]).toEqual([3, 4, 5, 6]);
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

    it('seats no more of the pets he picked than the table has seats for', async () => {
      const t = table({ seed: 3 });
      t.start(['mao', 'haru', 'rice', 'senko', 'mark'], 3);
      await tick();
      expect(t.states()[0]?.seats.slice(1).map((s) => s.id)).toEqual(['mao', 'haru']);
      t.room.stop();
    });

    it('begins with an empty table, and then deals every seat the hand its table has', async () => {
      for (const size of SIZES) {
        const cfg = CONFIG[size];
        const t = table({ seed: 3 });
        t.start([], size);
        await tick();
        const first = t.states()[0];
        expect(first).toMatchObject({ size, hand: [], turn: null, top: null, base: 1, bombs: 0, call: null, holes: [] });
        // A table that calls a card has no bidding to show.
        expect(first?.phase).toBe(cfg.mode === 'bid' ? 'bid' : 'play');
        expect(first?.seats.every((s) => s.cards === 0 && s.shown === null && s.role === null && !s.hidden)).toBe(true);
        expect(await t.play(() => t.states().some((s) => s.hand.length > 0), null)).toBe(true);
        const dealt = t.states().find((s) => s.hand.length > 0);
        expect(dealt?.hand).toHaveLength(cfg.hand);
        expect(dealt?.seats.map((s) => s.cards)).toEqual(new Array<number>(size).fill(cfg.hand));
        t.room.stop();
      }
    });

    it('finds the landlord of a table that bids by the bidding: one landlord, with the bottom cards, and every side shown', async () => {
      for (const size of [3, 4] as const) {
        const cfg = CONFIG[size];
        for (const seed of SEEDS) {
          const t = table({ seed });
          t.start([], size);
          expect(await t.play(() => t.lines().some((l) => l.tone === 'secret'), answerTo), `seed ${seed}`).toBe(true);
          const s = t.states().at(-1);
          if (!s) throw new Error('no state');
          const lords = s.seats.filter((x) => x.role === 'landlord');
          expect(lords, `seed ${seed}`).toHaveLength(1);
          expect(s.seats.every((x) => x.role !== null)).toBe(true);
          expect(s.phase).toBe('play');
          expect(s.call).toBeNull();
          expect(s.holes).toHaveLength(cfg.holes);
          expect(s.base).toBeGreaterThanOrEqual(1);
          expect(s.base).toBeLessThanOrEqual(MAX_BID);
          expect(lords[0]?.cards).toBe(cfg.hand + cfg.holes);
          expect(s.seats.filter((x) => x.role === 'farmer').every((x) => x.cards === cfg.hand)).toBe(true);
          expect(s.seats.some((x) => x.hidden)).toBe(false);
          t.room.stop();
        }
      }
    });

    it('finds the landlords of a table that calls a card by the card: the first copy in the open, the others hidden', async () => {
      let hidden = 0;
      for (const size of [5, 6] as const) {
        const cfg = CONFIG[size];
        for (const seed of [...SEEDS, 7, 8, 9, 10, 11, 12]) {
          const t = table({ seed });
          t.start([], size);
          expect(await t.play(() => t.lines().some((l) => l.tone === 'secret'), answerTo), `seed ${seed}`).toBe(true);
          const s = t.states().at(-1);
          if (!s) throw new Error('no state');
          expect(s.call, `seed ${seed}`).not.toBeNull();
          // A joker is never the card that is called.
          expect(s.call?.suit).not.toBeNull();
          expect(s.phase).toBe('play');
          expect(s.holes).toHaveLength(cfg.holes);
          expect(s.base).toBe(1);
          const me = mineIn(s.seats) as DdzSeat;
          // Of the others he is told of the landlords in the open, and a farmer is not one of them.
          expect(s.seats.filter((x) => !x.me && x.role !== null).every((x) => x.role === 'landlord')).toBe(true);
          expect(s.seats.filter((x) => x.role === 'landlord').length).toBeLessThanOrEqual(cfg.landlords);
          if (me.hidden) {
            hidden += 1;
            expect(me.role).toBe('landlord');
          }
          t.room.stop();
        }
      }
      expect(hidden).toBeGreaterThan(0);
    }, 60_000);

    it('tells the user his own side, and only his, as soon as the landlords are found', async () => {
      for (const size of SIZES) {
        for (const seed of SEEDS) {
          const t = table({ seed });
          t.start([], size);
          expect(await t.play(() => t.lines().some((l) => l.tone === 'secret'), answerTo), `seed ${seed}`).toBe(true);
          await tick();
          const secrets = t.lines().filter((l) => l.tone === 'secret');
          expect(secrets, `seed ${seed}`).toHaveLength(2);
          const me = mineIn(t.states().at(-1)?.seats) as DdzSeat;
          expect(me.role).not.toBeNull();
          const kind = me.hidden ? 'hidden' : me.role === 'landlord' ? 'landlord' : 'farmer';
          expect(secrets.map((l) => l.text), `seed ${seed}`).toEqual([w.youAre[kind], w.roleHint[kind]]);
          t.room.stop();
        }
      }
    }, 60_000);

    it('lingers on each step as long as the pace of the step says', async () => {
      const t = table({ seed: 2 });
      t.start([], 3);
      await tick();
      expect(t.clock.delays()).toEqual([pace({ k: 'start', size: 3 })]);
      t.clock.fire();
      await tick();
      expect(t.clock.delays()).toEqual([pace({ k: 'deal' })]);
      t.room.stop();
    });

    it('does not start a second game over the first', async () => {
      const t = table({ seed: 2 });
      t.start([], 3);
      await tick();
      const before = t.states().length;
      t.start([], 4);
      await tick();
      expect(t.states().length).toBe(before);
      expect(t.states().every((s) => s.seats.length === 3)).toBe(true);
      t.room.stop();
    });

    it('waits for the user for as long as he takes', async () => {
      const t = table({ seed: 4 });
      t.start([], 3);
      expect(await asked(t)).toBe(true);
      const posted = t.posts.length;
      for (let i = 0; i < 200; i++) {
        t.clock.fire();
        await tick();
      }
      expect(t.posts).toHaveLength(posted);
      expect(t.clock.live()).toBe(0);
      expect(t.last('over')).toBeUndefined();
      expect(t.lastAsk()).not.toBeNull();
      t.room.stop();
    });

    it('goes on after the user is out of it, until a side has won', async () => {
      const g = await playOut(6, 5, idle);
      expect(g.done).toBe(true);
      expect(only(g.posts, 'over')).toHaveLength(1);
    });
  });

  describe('what the user answers', () => {
    it('puts a bid again to a page that answers it with something else or with a bid he may not make, and takes the right bid once', async () => {
      let checked = 0;
      for (const size of [3, 4] as const) {
        for (const seed of SEEDS) {
          const t = table({ seed });
          t.start([], size);
          if (!(await askedFor(t, 'bid'))) continue;
          const ask = t.lastAsk();
          if (ask?.k !== 'bid') throw new Error('no bid ask');
          const wrong: DdzIn[] = [
            { t: 'play', ids: [] }, { t: 'bid', bid: ask.max + 1 }, { t: 'bid', bid: -1 }, { t: 'bid', bid: 1.5 },
          ];
          if (ask.min > 1) wrong.push({ t: 'bid', bid: ask.min - 1 });
          for (const msg of wrong) {
            const before = t.posts.length;
            t.room.on(msg);
            expect(t.posts, JSON.stringify(msg)).toHaveLength(before + 1);
            expect(t.posts.at(-1)).toEqual({ kind: 'ask', ask });
          }
          // The question was not taken as answered, so the table is still where it was.
          await tick();
          expect(t.lastAsk()).toEqual(ask);
          const bid = checked % 2 === 0 ? 0 : ask.min;
          t.room.on({ t: 'bid', bid });
          expect(t.posts.at(-1)).toEqual({ kind: 'ask', ask: null });
          const after = t.posts.length;
          t.room.on({ t: 'bid', bid });
          expect(t.posts).toHaveLength(after);
          checked += 1;
          t.room.stop();
        }
      }
      expect(checked).toBeGreaterThan(1);
    }, 60_000);

    it('puts a play again to a page that answers it with something else, or with cards he does not hold or that make no play, and takes the right play once', async () => {
      let leads = 0;
      let follows = 0;
      for (const size of SIZES) {
        for (const seed of SEEDS) {
          const t = table({ seed });
          t.start([], size);
          if (!(await askedFor(t, 'play'))) continue;
          const ask = t.lastAsk();
          const hand = t.states().at(-1)?.hand ?? [];
          const a = hand[0];
          if (ask?.k !== 'play' || !a) throw new Error('no play ask');
          const wrong: DdzIn[] = [
            { t: 'bid', bid: 1 }, { t: 'play', ids: [999_999] }, { t: 'play', ids: [a.id, a.id] },
            { t: 'play', ids: [a.id, 999_999] },
          ];
          // Two cards of different ranks make no play, unless they are the two jokers.
          const other = hand.find((c) => c.rank !== a.rank && (c.suit !== null || a.suit !== null));
          if (other) wrong.push({ t: 'play', ids: [a.id, other.id] });
          if (ask.lead) wrong.push({ t: 'play', ids: [] });
          for (const msg of wrong) {
            const before = t.posts.length;
            t.room.on(msg);
            expect(t.posts, JSON.stringify(msg)).toHaveLength(before + 1);
            expect(t.posts.at(-1)).toEqual({ kind: 'ask', ask });
          }
          await tick();
          expect(t.lastAsk()).toEqual(ask);
          const ids = ask.lead ? t.hint() : [];
          t.room.on({ t: 'play', ids });
          expect(t.posts.at(-1)).toEqual({ kind: 'ask', ask: null });
          const after = t.posts.length;
          t.room.on({ t: 'play', ids });
          expect(t.posts).toHaveLength(after);
          if (ask.lead) leads += 1;
          else follows += 1;
          t.room.stop();
        }
      }
      expect(leads).toBeGreaterThan(0);
      expect(follows).toBeGreaterThan(0);
    }, 60_000);

    it('lets the user pass when he follows, with no cards at all', async () => {
      let passed = 0;
      for (const size of SIZES) {
        for (const seed of SEEDS) {
          const t = table({ seed });
          t.start([], size);
          if (!(await askedFor(t, 'play', true))) continue;
          t.room.on({ t: 'play', ids: [] });
          expect(t.posts.at(-1)).toEqual({ kind: 'ask', ask: null });
          await tick();
          expect(t.lines().some((l) => l.tone === 'pass' && l.seat === 0 && l.text === w.log.pass('You'))).toBe(true);
          passed += 1;
          t.room.stop();
        }
      }
      expect(passed).toBeGreaterThan(0);
    }, 60_000);

    it('ignores an answer when no question is waiting, and one that is not a play for a question that is not', async () => {
      const t = table({ seed: 2 });
      const none: DdzIn[] = [{ t: 'bid', bid: 1 }, { t: 'play', ids: [1] }, { t: 'check', ids: [1] }, { t: 'hint' }];
      for (const msg of none) t.room.on(msg);
      t.room.lobby();
      for (const msg of none) t.room.on(msg);
      expect(t.posts.map((m) => m.kind)).toEqual(['lobby']);

      let tried = 0;
      for (const seed of SEEDS) {
        const bids = table({ seed });
        bids.start([], 3);
        if (!(await askedFor(bids, 'bid'))) continue;
        const before = bids.posts.length;
        bids.room.on({ t: 'check', ids: [1] });
        bids.room.on({ t: 'hint' });
        expect(bids.posts).toHaveLength(before);
        tried += 1;
        bids.room.stop();
      }
      expect(tried).toBeGreaterThan(0);
    }, 60_000);

    it('ignores a check or a hint once the question has been answered, or the game stopped', async () => {
      const t = table({ seed: 3 });
      t.start([], 3);
      expect(await askedFor(t, 'play')).toBe(true);
      const ids = t.hint();
      t.room.on({ t: 'play', ids });
      const before = t.posts.length;
      t.room.on({ t: 'check', ids });
      t.room.on({ t: 'hint' });
      expect(t.posts).toHaveLength(before);

      const s = table({ seed: 3 });
      s.start([], 3);
      expect(await askedFor(s, 'play')).toBe(true);
      s.room.stop();
      const after = s.posts.length;
      s.room.on({ t: 'check', ids });
      s.room.on({ t: 'hint' });
      expect(s.posts).toHaveLength(after);
    }, 60_000);
  });

  describe('check', () => {
    it('tells the user whether the cards he has picked make a play now, and what it is called', async () => {
      const seen = { lead: 0, follow: 0, low: 0, ok: 0 };
      for (const size of SIZES) {
        for (const seed of SEEDS) {
          const t = table({ seed });
          t.start([], size);
          if (!(await askedFor(t, 'play'))) continue;
          const state = t.states().at(-1);
          const ask = t.lastAsk();
          if (ask?.k !== 'play' || !state) throw new Error('no play ask');
          const verdict = (ids: number[]): Post<'verdict'> => {
            t.room.on({ t: 'check', ids });
            const v = t.posts.at(-1);
            if (v?.kind !== 'verdict') throw new Error('no verdict');
            return v;
          };
          const { hand } = state;
          const shown = state.top === null ? null : (state.seats[state.top]?.shown ?? null);
          if (shown !== null && shown.k !== 'play') throw new Error('the top is no play');
          if (shown === null) seen.lead += 1;
          else seen.follow += 1;

          expect(verdict([])).toEqual({ kind: 'verdict', ids: [], ok: false, label: '' });

          // A single card makes a play, which beats the table when it is a single of a lower rank, or there is no table.
          const card = hand[hand.length - 1] as Card;
          const single = verdict([card.id]);
          expect(single.ids).toEqual([card.id]);
          const aim = shown !== null && shown.label === w.shape.single ? (shown.cards[0] as Card) : null;
          const beats = shown === null || (aim !== null && card.rank > aim.rank);
          expect(single.ok, `seed ${seed}`).toBe(beats);
          expect(single.label, `seed ${seed}`).toBe(beats ? w.shape.single : w.verdict.low);
          if (!beats) seen.low += 1;

          // Cards that make no play are told apart from a play that does not beat the table.
          const other = hand.find((c) => c.rank !== card.rank && (c.suit !== null || card.suit !== null));
          if (other) expect(verdict([card.id, other.id])).toMatchObject({ ok: false, label: w.verdict.bad });
          expect(verdict([999_999])).toMatchObject({ ok: false, label: w.verdict.bad });
          expect(verdict([card.id, card.id])).toMatchObject({ ok: false, label: w.verdict.bad });

          // The hint is a play that beats the table, and is named as the check names it.
          const ids = t.hint();
          if (ids.length > 0) {
            const hinted = verdict(ids);
            expect(hinted.ok).toBe(true);
            expect(hinted.label).not.toBe('');
            expect(hinted.label).toBe(t.last('hint')?.label);
            expect(hinted.ids).toEqual(ids);
            seen.ok += 1;
          }
          t.room.stop();
        }
      }
      expect(seen.lead).toBeGreaterThan(0);
      expect(seen.follow).toBeGreaterThan(0);
      expect(seen.low).toBeGreaterThan(0);
      expect(seen.ok).toBeGreaterThan(0);
    }, 60_000);

    it('names a pair at a lead, as the pair it is', async () => {
      let pairs = 0;
      for (const size of SIZES) {
        for (const seed of SEEDS) {
          const t = table({ seed });
          t.start([], size);
          if (!(await askedFor(t, 'play'))) continue;
          const ask = t.lastAsk();
          const hand = t.states().at(-1)?.hand ?? [];
          if (ask?.k !== 'play' || !ask.lead) {
            t.room.stop();
            continue;
          }
          const twin = hand.find((c, i) => c.suit !== null && hand.some((d, j) => j !== i && d.rank === c.rank));
          const mate = hand.find((c) => twin !== undefined && c.id !== twin.id && c.rank === twin.rank);
          if (twin && mate) {
            t.room.on({ t: 'check', ids: [twin.id, mate.id] });
            expect(t.last('verdict')).toEqual({ kind: 'verdict', ids: [twin.id, mate.id], ok: true, label: w.shape.pair });
            pairs += 1;
          }
          t.room.stop();
        }
      }
      expect(pairs).toBeGreaterThan(0);
    }, 60_000);
  });

  describe('hint', () => {
    it('offers plays one after another, all of them plays he can make, and comes round to the first again after the last', async () => {
      let rounds = 0;
      for (const size of SIZES) {
        for (const seed of [1, 2, 3]) {
          const t = table({ seed });
          t.start([], size);
          if (!(await askedFor(t, 'play'))) continue;
          const hand = new Set((t.states().at(-1)?.hand ?? []).map((c) => c.id));
          const next = (): string => {
            t.room.on({ t: 'hint' });
            const h = t.last('hint');
            if (!h || t.posts.at(-1) !== h) throw new Error('no hint');
            expect(h.ids.every((id) => hand.has(id))).toBe(true);
            expect(h.label === '').toBe(h.ids.length === 0);
            return h.ids.join(',');
          };
          const seq = [next()];
          for (let i = 1; i < 2000; i++) {
            seq.push(next());
            if (seq[i] === seq[0]) break;
          }
          const period = seq.length - 1;
          expect(period, `seed ${seed} (${size} players)`).toBeLessThan(1999);
          // The plays come round in the same order, each once.
          expect(new Set(seq.slice(0, period)).size).toBe(period);
          for (let i = period + 1; i <= 2 * period; i++) expect(next(), `hint ${i}`).toBe(seq[i % period]);
          rounds += 1;
          t.room.stop();
        }
      }
      expect(rounds).toBeGreaterThan(0);
    }, 60_000);

    it('offers one play after another from the best, and each of the first few is one the check takes', async () => {
      for (const seed of [1, 2, 3]) {
        const t = table({ seed });
        t.start([], 4);
        if (!(await askedFor(t, 'play'))) continue;
        const hinted: number[][] = [];
        for (let i = 0; i < 6; i++) hinted.push(t.hint());
        for (const ids of hinted) {
          if (ids.length === 0) continue;
          t.room.on({ t: 'check', ids });
          expect(t.last('verdict'), `seed ${seed}`).toMatchObject({ ok: true });
        }
        t.room.stop();
      }
    }, 60_000);
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

        eachGame(() => all, 'posts one verdict, last, and it says how the game came out for the user', (g, bad) => {
          const over = only(g.posts, 'over');
          if (over.length !== 1) return bad(`${over.length} verdicts`);
          const verdict = over[0] as Post<'over'>;
          const final = only(g.posts, 'state').at(-1);
          if (final?.phase !== 'over') bad(`the last state is in the ${final?.phase} phase`);
          if (final?.turn !== null) bad('somebody is to move after the end');
          if (verdict.win !== (mineIn(final?.seats)?.role === verdict.winner)) bad('win is not his side');
          if (g.posts.at(-1)?.kind !== 'over') bad(`ends with a ${g.posts.at(-1)?.kind}`);
          if (verdict.title !== (verdict.win ? w.win : w.lose)) bad('the title does not say how it came out');
          if (!verdict.text.includes(verdict.winner === 'landlord' ? w.winLandlord : w.winFarmers)) bad('the text names the other side');
          const points = /^Points: (.*)$/m.exec(verdict.text)?.[1]?.split(' / ').map((p) => Number(/([+-]?\d+)$/.exec(p)?.[1]));
          if (!points || points.length !== g.size || points.some((p) => Number.isNaN(p))) return bad('no points for every seat');
          if (points.reduce((a, b) => a + b, 0) !== 0) bad('the points do not add up to nothing');
          if (((points[0] as number) > 0) !== verdict.win) bad('his points do not say how it came out');
        });

        eachGame(() => all, 'shows a table of the size asked for, all through', (g, bad) => {
          for (const s of only(g.posts, 'state')) {
            if (s.seats.length !== g.size || s.size !== g.size) bad(`${s.seats.length} seats, size ${s.size}`);
            if (s.seats.some((x, i) => x.seat !== i)) bad('seats out of order');
            if (s.turn !== null && (s.turn < 0 || s.turn >= g.size)) bad(`turn ${s.turn}`);
            if (s.top !== null && s.seats[s.top]?.shown?.k !== 'play') bad(`seat ${s.top} is on top without a play`);
          }
        });

        eachGame(() => all, 'goes from the bidding to the play to the end, and bids only at a table that bids', (g, bad) => {
          const order = { bid: 0, play: 1, over: 2 } as const;
          const states = only(g.posts, 'state');
          let at = 0;
          for (const s of states) {
            if (order[s.phase] < at) bad(`${s.phase} after a later phase`);
            at = Math.max(at, order[s.phase]);
          }
          const phases = new Set(states.map((s) => s.phase));
          if (phases.has('bid') !== (CONFIG[g.size].mode === 'bid')) bad(`the bidding phase is ${phases.has('bid') ? 'shown' : 'missing'}`);
          if (!phases.has('play') || !phases.has('over')) bad('a phase is missing');
        });

        eachGame(() => all, 'lets the pets speak, never the user, and only in the words they have', (g, bad) => {
          const pool = new Set(Object.values(w.chat).flat());
          for (const l of only(g.posts, 'line')) {
            if (l.seat !== null && (l.seat < 0 || l.seat >= g.size)) bad(`a line for seat ${l.seat}`);
            if (l.tone !== 'say') continue;
            if (l.seat === null || l.seat === 0) bad(`${l.seat} speaks`);
            if (!pool.has(l.text)) bad(`unknown speech ${l.text}`);
          }
        });

        eachGame(() => all, 'names in the log the seat that acted', (g, bad) => {
          const seats = only(g.posts, 'state')[0]?.seats ?? [];
          for (const l of only(g.posts, 'line')) {
            if (l.tone !== 'act' && l.tone !== 'pass' && l.tone !== 'bomb') continue;
            const who = seats[l.seat ?? -1]?.name;
            if (who === undefined || !l.text.startsWith(`${who} `)) bad(`"${l.text}" is not by seat ${l.seat}`);
          }
        });

        eachGame(() => all, 'asks the user only what the table needs: a bid of 1 to 3 at a table that bids, a play at his turn', (g, bad) => {
          let state: Post<'state'> | undefined;
          for (const m of g.posts) {
            if (m.kind === 'state') state = m;
            if (m.kind !== 'ask' || !m.ask) continue;
            const a = m.ask;
            if (!state) return bad('asked before the table was shown');
            if (state.turn !== 0) bad(`asked when it was ${state.turn}'s turn`);
            if (a.title.trim() === '') bad(`no title for a ${a.k}`);
            if (a.k === 'bid') {
              if (CONFIG[g.size].mode !== 'bid') bad('a bid at a table that calls');
              if (state.phase !== 'bid') bad(`a bid in the ${state.phase} phase`);
              if (a.min < 1 || a.max !== MAX_BID || a.min > a.max) bad(`a bid of ${a.min} to ${a.max}`);
              if (a.title !== w.ask.bid(a.min, a.max)) bad(`the title "${a.title}" for a bid`);
            } else {
              if (state.phase !== 'play') bad(`a play in the ${state.phase} phase`);
              if (a.lead !== (state.top === null)) bad(`a ${a.lead ? 'lead' : 'follow'} with ${state.top} on top`);
              const top = state.top === null ? null : state.seats[state.top];
              const on = top?.shown?.k === 'play' ? top.shown : null;
              const title = top && on ? w.ask.follow(top.name, on.label) : w.ask.lead;
              if (a.title !== title) bad(`the title "${a.title}", not "${title}"`);
            }
          }
        });

        eachGame(() => all, 'shows the user his own cards, highest first, and of the others only how many are left and what they played', (g, bad) => {
          for (const s of only(g.posts, 'state')) {
            const me = mineIn(s.seats);
            if (!me) return bad('no seat of his own');
            if (me.cards !== s.hand.length) bad(`${s.hand.length} cards in his hand, ${me.cards} on his seat`);
            if (s.hand.some((c, i) => c.rank < ((s.hand[i + 1] as Card | undefined)?.rank ?? c.rank))) bad('his hand is not highest first');
            if (new Set(s.hand.map((c) => c.id)).size !== s.hand.length) bad('a card twice in his hand');
            const out = new Set(s.seats.flatMap((x) => (x.shown?.k === 'play' ? x.shown.cards.map((c) => c.id) : [])));
            if (s.hand.some((c) => out.has(c.id))) bad('a card both in his hand and on the table');
            if (s.seats.some((x) => !Number.isInteger(x.cards) || x.cards < 0)) bad('a bad count of cards');
          }
        });

        eachGame(() => all, 'tells the user the side of nobody but himself and the landlords in the open, once they are found', (g, bad) => {
          const states = only(g.posts, 'state');
          const found = states.findIndex((s) => s.seats.some((x) => x.role !== null));
          if (found < 0) return bad('no side is ever told');
          const mode = CONFIG[g.size].mode;
          states.forEach((s, i) => {
            if (s.phase === 'over') {
              if (s.seats.some((x) => x.role === null)) bad('a side is still unknown at the end');
              if (s.seats.filter((x) => x.role === 'landlord').length !== CONFIG[g.size].landlords) bad('the wrong number of landlords at the end');
              return;
            }
            if (i < found) return;
            if (mineIn(s.seats)?.role === null) bad('he is not told his own side');
            if (s.seats.some((x) => x.hidden && !(x.me && x.role === 'landlord'))) bad('hidden is more than his own seat as a landlord');
            // At a table that calls a card a seat may be a landlord still, until all of them have played it: only then are the others known for farmers.
            const lords = s.seats.filter((x) => x.role === 'landlord').length;
            const named = s.seats.some((x) => !x.me && x.role === 'farmer');
            if (mode === 'call' && named && (lords !== CONFIG[g.size].landlords || s.seats.some((x) => x.role === null))) {
              bad('a farmer is named while a landlord is still hidden');
            }
            if (mode === 'bid' && s.seats.some((x) => x.role === null)) bad('a side is unknown at a table that bids');
          });
          // The sides are told when the landlords are found: the head line, and the user's own side in secret.
          const at = g.posts.indexOf(states[found] as Post<'state'>);
          const tones = g.posts.slice(at + 1, at + 4).map((m) => (m.kind === 'line' ? m.tone : m.kind));
          if (tones.join() !== 'head,secret,secret') bad(`${tones.join()} after the landlords are found`);
          const before = only(g.posts.slice(0, at), 'line').filter((l) => l.tone === 'head' || l.tone === 'secret');
          if (before.length > 0) bad('a head or a secret line before the landlords are found');
          const secrets = only(g.posts, 'line').filter((l) => l.tone === 'secret').map((l) => l.text);
          const mine = mineIn(states.at(-1)?.seats);
          const kinds = ['landlord', 'hidden', 'farmer'] as const;
          const kind = kinds.find((k) => secrets.join() === [w.youAre[k], w.roleHint[k]].join());
          if (!kind) return bad(`the secrets "${secrets.join(' | ')}"`);
          if ((kind === 'farmer') !== (mine?.role === 'farmer')) bad('told a side that he does not end on');
          if (kind === 'hidden' && mode !== 'call') bad('a hidden landlord at a table that bids');
        });

        eachGame(() => all, 'keeps the cards: in the play they only leave a hand, one hand at a time, by the play that is shown', (g, bad) => {
          const states = only(g.posts, 'state');
          const found = states.findIndex((s) => s.seats.some((x) => x.role !== null));
          const first = states[found];
          if (!first) return bad('no game');
          const sum = (s: Post<'state'>): number => s.seats.reduce((n, x) => n + x.cards, 0);
          if (sum(first) !== CONFIG[g.size].decks * 54) bad(`${sum(first)} cards when the landlords are found`);
          for (let i = found + 1; i < states.length; i++) {
            const a = states[i - 1] as Post<'state'>;
            const b = states[i] as Post<'state'>;
            const changed = b.seats.filter((x, seat) => x.cards !== (a.seats[seat] as DdzSeat).cards);
            if (changed.length > 1) {
              bad(`${changed.length} hands changed at once`);
              continue;
            }
            const x = changed[0];
            if (!x) continue;
            const was = (a.seats[x.seat] as DdzSeat).cards;
            if (x.shown?.k !== 'play' || was - x.cards !== x.shown.cards.length) bad(`seat ${x.seat} went from ${was} to ${x.cards} cards`);
          }
          if (!states.at(-1)?.seats.some((x) => x.cards === 0)) bad('nobody is out at the end');
        });

        eachGame(() => all, 'counts the bombs it shows, and tells the points of the game at its end', (g, bad) => {
          let bombs = 0;
          for (const s of only(g.posts, 'state')) {
            if (s.bombs < bombs || s.bombs > bombs + 1) bad(`bombs go from ${bombs} to ${s.bombs}`);
            bombs = s.bombs;
            if (s.base < 1 || s.base > MAX_BID) bad(`base ${s.base}`);
            if (CONFIG[g.size].mode === 'call' && s.base !== 1) bad(`base ${s.base} at a table that calls`);
          }
          const shown = only(g.posts, 'line').filter((l) => l.tone === 'bomb').length;
          if (bombs !== shown) bad(`${bombs} bombs counted, ${shown} shown`);
          const final = only(g.posts, 'state').at(-1);
          const stake = new RegExp(`Base ${final?.base}, ${bombs === 0 ? 'no bombs' : `${bombs} bombs?`}: points ×(\\d+)\\.`);
          const times = Number(stake.exec(only(g.posts, 'over')[0]?.text ?? '')?.[1]);
          if (Number.isNaN(times)) return bad('the stake is not told');
          if (times < 2 ** Math.min(bombs, MAX_DOUBLINGS) || times > 2 ** MAX_DOUBLINGS || !Number.isInteger(Math.log2(times))) bad(`points ×${times} for ${bombs} bombs`);
        });

        eachGame(() => all, 'has a pet of the winning side cheer and one of the losing side groan at the end, when there is one', (g, bad) => {
          const final = only(g.posts, 'state').at(-1);
          const over = only(g.posts, 'over')[0];
          if (!final || !over) return bad('no end');
          const words = g.posts.slice(g.posts.lastIndexOf(final) + 1, g.posts.indexOf(over)).filter((m): m is Post<'line'> => m.kind === 'line');
          const winners = final.seats.filter((s) => !s.me && s.role === over.winner);
          const losers = final.seats.filter((s) => !s.me && s.role !== over.winner);
          const cheers = words.filter((l) => w.chat.win.includes(l.text));
          const groans = words.filter((l) => w.chat.lose.includes(l.text));
          if (cheers.length !== (winners.length > 0 ? 1 : 0)) bad(`${cheers.length} cheers for ${winners.length} winners`);
          if (groans.length !== (losers.length > 0 ? 1 : 0)) bad(`${groans.length} groans for ${losers.length} losers`);
          if (cheers.some((l) => !winners.some((s) => s.seat === l.seat))) bad('a cheer from the losing side');
          if (groans.some((l) => !losers.some((s) => s.seat === l.seat))) bad('a groan from the winning side');
          if (words.length !== cheers.length + groans.length) bad('other words at the end');
        });

        eachGame(() => all, 'offers hints that are cards in his hand, with the name of the play', (g, bad) => {
          let hand = new Set<number>();
          for (const m of g.posts) {
            if (m.kind === 'state') hand = new Set(m.hand.map((c) => c.id));
            if (m.kind !== 'hint') continue;
            if (m.ids.some((id) => !hand.has(id))) bad('a hint of cards he does not hold');
            if ((m.ids.length === 0) !== (m.label === '')) bad(`a hint of ${m.ids.length} cards named "${m.label}"`);
          }
        });

        it('shows a hidden landlord to the user once he has played the called card, and not before', () => {
          let reveals = 0;
          const bad: string[] = [];
          for (const g of all) {
            if (CONFIG[g.size].mode !== 'call') continue;
            const names = only(g.posts, 'state')[0]?.seats.map((s) => s.name) ?? [];
            let state: Post<'state'> | undefined;
            let before: Post<'state'> | undefined;
            for (const m of g.posts) {
              if (m.kind === 'state') {
                before = state;
                state = m;
                continue;
              }
              if (m.kind !== 'line' || m.tone !== 'sys' || m.seat === null || m.text !== w.log.reveal(names[m.seat] ?? '')) continue;
              reveals += 1;
              const was = before?.seats[m.seat];
              const now = state?.seats[m.seat];
              const name = `seed ${g.seed} (${g.size} players), seat ${m.seat}`;
              if (now?.role !== 'landlord') bad.push(`${name} is not shown as a landlord after the reveal`);
              if (was && !was.me && was.role !== null) bad.push(`${name} was shown as ${was.role} before the reveal`);
              if (was?.me && !(was.hidden && !now?.hidden)) bad.push(`${name} (him) does not stop being hidden`);
            }
          }
          expect(reveals).toBeGreaterThan(0);
          expect(bad.slice(0, 6)).toEqual([]);
        });
      });
    }
  });

  describe('stopping', () => {
    it('stops a game at once: nothing more is posted and no timer is left', async () => {
      const t = table({ seed: 7 });
      t.start([], 6);
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
      t.start([], 3);
      expect(await asked(t)).toBe(true);
      t.room.stop();
      const posted = t.posts.length;
      t.room.on({ t: 'bid', bid: 1 });
      t.room.on({ t: 'play', ids: [] });
      t.room.on({ t: 'check', ids: [1] });
      t.room.on({ t: 'hint' });
      await tick();
      expect(t.posts).toHaveLength(posted);
      expect(t.lines().filter((l) => l.tone === 'sys' && l.text.includes('stopped'))).toEqual([]);
    });

    it('goes back to the lobby when asked to play again, and then plays another game', async () => {
      const t = table({ seed: 8 });
      t.start([], 3);
      expect(await t.finish(answerTo)).toBe(true);
      t.room.on({ t: 'start', pets: [], size: 4 });
      await tick();
      expect(t.states().every((s) => s.seats.length === 3)).toBe(true);
      t.room.on({ t: 'again' });
      expect(t.posts.at(-1)?.kind).toBe('lobby');
      const before = t.states().length;
      t.start([], 4);
      await tick();
      expect(t.states().length).toBeGreaterThan(before);
      expect(t.states().at(-1)?.seats).toHaveLength(4);
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
      const a = await playOut(11, 4);
      const b = await playOut(11, 4);
      expect(a.done && b.done).toBe(true);
      expect(JSON.stringify(b.posts)).toBe(JSON.stringify(a.posts));
      const c = await playOut(12, 4);
      expect(JSON.stringify(c.posts)).not.toBe(JSON.stringify(a.posts));
    });
  });

  describe('in Chinese', () => {
    it('shows the log, the questions and the verdict in Chinese', async () => {
      const t = table({ seed: 5, words: () => ({ g: zh.games, names: zh.ask.petName, language: 'Chinese' }) });
      t.start([], 4);
      expect(await t.finish(answerTo)).toBe(true);
      const text = t.lines().map((l) => l.text).join('\n');
      expect(text).toMatch(/[\u4e00-\u9fff]/);
      expect(text).not.toMatch(/\b(played|passed|bid|landlord|farmer)\b/i);
      expect(mineIn(t.states()[0]?.seats)?.name).toBe(zh.games.you);
      expect(t.last('over')?.title).toMatch(/[\u4e00-\u9fff]/);
      expect(t.asks().map((a) => a.title).join('')).toMatch(/[\u4e00-\u9fff]/);
    });
  });
});

/** The cards of `spec` as one play: the cards, and what they count as. */
function playOf(spec: string, decks = 1): { cards: Card[]; play: Play } {
  const hand = cards(spec);
  const play = checkPlay(hand, hand.map((c) => c.id), null, decks);
  if (!play) throw new Error(`${spec} is no play`);
  return { cards: hand, play };
}

describe('pace', () => {
  const single = playOf('5');
  const bomb = playOf('7 7 7 7');
  const rocket = playOf('S B');
  const result: Result = {
    winner: 'landlord', out: 0, base: 1, bombs: 0, spring: null, doublings: 0, scores: [2, -1, -1], landlords: [0],
  };
  const play = (seat: number, p: { cards: Card[]; play: Play }): Entry => ({ k: 'play', seat, play: p.play, cards: p.cards });
  const card = single.cards[0] as Card;
  const others = (seat: number): Entry[] => [
    { k: 'bid', seat, bid: 1 }, { k: 'landlord', seat, bid: 2, holes: [] }, { k: 'call', seat, card, holes: [] },
    play(seat, single), play(seat, bomb), { k: 'pass', seat }, { k: 'reveal', seat },
  ];

  it('lets the table linger on each step, longer on a bomb', () => {
    expect(pace({ k: 'start', size: 3 })).toBe(400);
    expect(pace({ k: 'deal' })).toBe(700);
    expect(pace({ k: 'redeal' })).toBe(500);
    expect(others(2).map(pace)).toEqual([550, 900, 1100, 700, 1000, 350, 900]);
    expect(pace(play(2, rocket))).toBe(1000);
  });

  it('does not linger on a turn, or on the end', () => {
    expect(pace({ k: 'turn', seat: 2, lead: true })).toBe(0);
    expect(pace({ k: 'turn', seat: 0, lead: false })).toBe(0);
    expect(pace({ k: 'end', result })).toBe(0);
  });

  it('hurries past the moves the user has just made himself', () => {
    expect(others(0).map(pace)).toEqual([220, 360, 440, 280, 400, 140, 360]);
    expect(pace(play(0, rocket))).toBe(400);
    expect(pace({ k: 'start', size: 3 })).toBe(400);
  });

  it('is a whole number of milliseconds, never more than a second and a bit', () => {
    const all: Entry[] = [
      { k: 'start', size: 5 }, { k: 'deal' }, { k: 'redeal' }, ...others(0), ...others(3), { k: 'turn', seat: 1, lead: false },
      { k: 'end', result },
    ];
    for (const e of all) {
      const ms = pace(e);
      expect(Number.isInteger(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(1100);
    }
  });
});

describe('fits', () => {
  const hand = cards('3 4 4 7 7 7 7 K S B');
  /** The ids of the cards of the hand at these places: 3, 4, 4, 7, 7, 7, 7, K, small joker, big joker. */
  const at = (...places: number[]): number[] => places.map((i) => (hand[i] as Card).id);
  const play = (...places: number[]): Reply => ({ k: 'play', ids: at(...places) });
  const bid = (bid: number): Reply => ({ k: 'bid', bid });

  /** The table as the seat of the hand sees it, with the play `top` on it, if there is one. */
  function viewOf(top: string | null = null): TableView {
    const on = top === null ? null : playOf(top);
    return {
      size: 3, decks: 1, me: 0, hand, counts: [hand.length, 17, 17], roles: ['landlord', 'farmer', 'farmer'], hidden: false,
      top: on && { seat: 1, combo: on.play.combo, cards: on.cards }, lead: on === null, lord: 0, call: null, holes: [],
      base: 1, seen: new Array<number>(RANKS).fill(0), plays: [0, 0, 0], turn: 0,
    };
  }

  describe('a bid', () => {
    const ask: Ask = { k: 'bid', min: 2, max: 3 };

    it('takes no bid, or a whole bid from the least to the most', () => {
      for (const n of [0, 2, 3]) expect(fits(ask, bid(n), viewOf()), `bid ${n}`).toBe(true);
    });

    it('takes no bid below the least or above the most, or one that is not a whole number', () => {
      for (const n of [1, 4, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(fits(ask, bid(n), viewOf()), `bid ${n}`).toBe(false);
    });

    it('takes no play for a bid', () => {
      expect(fits(ask, play(), viewOf())).toBe(false);
      expect(fits(ask, play(0), viewOf())).toBe(false);
    });
  });

  describe('a play at a lead', () => {
    const ask: Ask = { k: 'play', lead: true };

    it('takes every play the hand can make', () => {
      const plays = [[0], [1, 2], [3, 4, 5], [3, 4, 5, 0], [3, 4, 5, 6], [8, 9]];
      for (const places of plays) expect(fits(ask, play(...places), viewOf()), places.join()).toBe(true);
    });

    it('takes no pass, since whoever leads has to play', () => {
      expect(fits(ask, play(), viewOf())).toBe(false);
    });

    it('takes no cards that make no play, that he does not hold or that are named twice', () => {
      expect(fits(ask, play(0, 1), viewOf())).toBe(false);
      expect(fits(ask, play(0, 7), viewOf())).toBe(false);
      expect(fits(ask, { k: 'play', ids: [999_999] }, viewOf())).toBe(false);
      expect(fits(ask, { k: 'play', ids: [at(0)[0] as number, 999_999] }, viewOf())).toBe(false);
      expect(fits(ask, { k: 'play', ids: [at(0)[0] as number, at(0)[0] as number] }, viewOf())).toBe(false);
    });

    it('takes no bid for a play', () => {
      expect(fits(ask, bid(0), viewOf())).toBe(false);
      expect(fits(ask, bid(1), viewOf())).toBe(false);
    });
  });

  describe('a play that follows', () => {
    const ask: Ask = { k: 'play', lead: false };

    it('takes a pass', () => {
      expect(fits(ask, play(), viewOf('5'))).toBe(true);
      expect(fits(ask, play(), viewOf('S B'))).toBe(true);
    });

    it('takes a play of the same shape that beats the table, a bomb or the rocket', () => {
      expect(fits(ask, play(7), viewOf('5'))).toBe(true);
      expect(fits(ask, play(3, 4, 5, 6), viewOf('5'))).toBe(true);
      expect(fits(ask, play(8, 9), viewOf('5'))).toBe(true);
      expect(fits(ask, play(7), viewOf('Q'))).toBe(true);
      expect(fits(ask, play(3, 4, 5, 6), viewOf('K K'))).toBe(true);
    });

    it('takes no play that does not beat the table, or has another shape', () => {
      expect(fits(ask, play(0), viewOf('5'))).toBe(false);
      expect(fits(ask, play(1), viewOf('5'))).toBe(false);
      expect(fits(ask, play(1, 2), viewOf('5'))).toBe(false);
      expect(fits(ask, play(3, 4, 5), viewOf('5'))).toBe(false);
      expect(fits(ask, play(7), viewOf('K'))).toBe(false);
      expect(fits(ask, play(1, 2), viewOf('9 9'))).toBe(false);
    });

    it('takes nothing but a pass against the rocket', () => {
      for (const places of [[7], [3, 4, 5, 6], [8, 9]]) expect(fits(ask, play(...places), viewOf('S B')), places.join()).toBe(false);
    });

    it('takes no bid for a play', () => {
      expect(fits(ask, bid(0), viewOf('5'))).toBe(false);
    });
  });
});

describe('askView', () => {
  it('puts the words with a bid', () => {
    expect(askView({ k: 'bid', min: 2, max: 3 }, 'Bid 2 to 3')).toEqual({ k: 'bid', title: 'Bid 2 to 3', min: 2, max: 3 });
  });

  it('puts the words with a play, and whether it leads', () => {
    expect(askView({ k: 'play', lead: true }, 'Lead')).toEqual({ k: 'play', title: 'Lead', lead: true });
    expect(askView({ k: 'play', lead: false }, 'Follow')).toEqual({ k: 'play', title: 'Follow', lead: false });
  });
});

interface Row {
  cards: string[];
  label: string;
}

/** The plays a question puts on offer, in order; the pass is not one of them. */
function rowsOf(text: string): Row[] {
  return [...text.matchAll(/^(\d+)\. (.+?) — (.+?)(?: \(plays the called card[^)]*\))?$/gm)]
    .map((m) => ({ cards: (m[2] as string).split(', ').sort(), label: m[3] as string }));
}

/** A play as the log tells of it: the cards, sorted, and what it is called. */
function playIn(text: string): Row | null {
  const m = /^.+? played (.+) \((.+)\)\.$/.exec(text);
  return m ? { cards: (m[1] as string).split(', ').sort(), label: m[2] as string } : null;
}

/** A stand-in for a mind that reads its questions: it bids the least it may, and plays the last of the plays on offer. */
function model(text: string, say = 'Hm.'): string {
  const bid = /the number being (\d+)(?: to \d+)?, or 0 to pass\./.exec(text);
  if (bid) return JSON.stringify({ bid: Number(bid[1]), say });
  return JSON.stringify({ play: rowsOf(text).length, say });
}

/** A stand-in whose answers are well formed, and none of them is one the table can take. */
function junk(text: string): string {
  return text.includes('the number being') ? '{"bid": 99, "say": "Hm."}' : '{"play": 9999, "say": "Hm."}';
}

interface Prompt {
  seat: number;
  text: string;
  /** How many posts there were when it was asked. */
  at: number;
}

/** A table whose pets think with `reply`, and every prompt they are given. */
function minded(reply: (seat: number, text: string) => string | null = (_seat, text) => model(text), over: Over = {}) {
  const prompts: Prompt[] = [];
  const fb = fakeBrain((seat, text) => {
    prompts.push({ seat, text, at: t.posts.length });
    return reply(seat, text);
  });
  const t = table({ canThink: () => true, brain: () => fb.brain, ...over });
  return { t, fb, prompts };
}

interface Held {
  seat: number;
  text: string;
  release: (reply: string | null) => void;
}

/** A table whose brain holds the questions that `hold` picks until the test answers them, and answers the rest at once. */
function slow(hold: (text: string) => boolean = () => true) {
  const held: Held[] = [];
  const brain = {
    warm: vi.fn(),
    ask: vi.fn((seat: number, text: string) => (hold(text)
      ? new Promise<string | null>((release) => { held.push({ seat, text, release }); })
      : Promise.resolve<string | null>(model(text)))),
    close: vi.fn(),
  };
  const t = table({ canThink: () => true, brain: () => brain as unknown as GameBrain });
  return { t, held, brain };
}

interface Minded extends Game {
  prompts: Prompt[];
}

async function mindOut(seed: number, size: Size): Promise<Minded> {
  const picks = picksFor(seed);
  const { t, prompts } = minded(undefined, { seed });
  t.start(picks, size);
  const done = await t.finish(answerTo);
  return { seed, size, picks, done, posts: t.posts, prompts };
}

const thinkingOf = (posts: readonly DdzOut[]): number[][] => only(posts, 'thinking').map((m) => m.seats);
const withoutThinking = (posts: readonly DdzOut[]): DdzOut[] => posts.filter((m) => m.kind !== 'thinking');

/** The first thing the seat did, a bid, a pass or a play, once `from` posts had been made. */
function nextAct(posts: readonly DdzOut[], from: number, seat: number): Post<'line'> | undefined {
  for (let i = from; i < posts.length; i++) {
    const m = posts[i];
    if (m?.kind === 'line' && m.seat === seat && (m.tone === 'act' || m.tone === 'bomb' || m.tone === 'pass')) return m;
  }
  return undefined;
}

/** The table as it was shown last before post number `at`. */
function shownBefore(posts: readonly DdzOut[], at: number): Post<'state'> | undefined {
  for (let i = at - 1; i >= 0; i--) {
    const m = posts[i];
    if (m?.kind === 'state') return m;
  }
  return undefined;
}

/** What a question says of who holds how many cards, and of the sides it gives. */
function heldIn(text: string): { seat: number; cards: number; side: string | null }[] {
  const line = /^Cards held: (.*)\.$/m.exec(text)?.[1];
  if (line === undefined) return [];
  return line.split(', ').flatMap((part) => {
    const m = /^#(\d+) .+: (\d+)(?: \((landlord|farmer)\))?$/.exec(part);
    return m ? [{ seat: Number(m[1]) - 1, cards: Number(m[2]), side: m[3] ?? null }] : [];
  });
}

describe('DoudizhuRoom with the pets thinking', () => {
  const pool = new Set(Object.values(w.chat).flat());
  let all: Minded[] = [];
  let choosing = 0;

  it('tells the lobby whether they can', () => {
    for (const can of [true, false]) {
      const t = table({ canThink: () => can });
      t.room.lobby();
      expect(only(t.posts, 'lobby')[0]?.minds).toBe(can);
    }
  });

  it('plays a game at every table size, with the pets thinking, to its end', async () => {
    all = [];
    choosing = 0;
    for (const size of SIZES) for (const seed of SEEDS) all.push(await mindOut(seed, size));
    expect(all.length).toBe(SIZES.length * SEEDS.length);
    expect(all.filter((g) => !g.done).map((g) => `${g.seed}/${g.size}`)).toEqual([]);
  }, 120_000);

  eachGame(() => all, 'ends with the verdict, and no pet left thinking', (g, bad) => {
    if (only(g.posts, 'over').length !== 1) bad('not one verdict');
    if (g.posts.at(-1)?.kind !== 'over') bad(`ends with a ${g.posts.at(-1)?.kind}`);
    if (thinkingOf(g.posts).at(-1)?.length !== 0) bad('a pet is left thinking');
  });

  eachGame(() => all, 'puts the questions of the pets to the brain, none of the user\'s, and no more than the budget', (g, bad) => {
    if (g.prompts.length <= g.size) bad(`${g.prompts.length} questions`);
    if (g.prompts.length > DDZ_BUDGET) bad(`${g.prompts.length} questions`);
    if (g.prompts.some((p) => p.seat < 1 || p.seat >= g.size)) bad('a question for a seat that is no pet');
  });

  eachGame(() => all, 'says which pet is thinking while it does, and that none is once it has answered', (g, bad) => {
    const seen = thinkingOf(g.posts);
    if (seen.length !== 2 * g.prompts.length) bad(`${seen.length} posts for ${g.prompts.length} questions`);
    seen.forEach((seats, i) => {
      const want = i % 2 === 0 ? [g.prompts[i / 2]?.seat] : [];
      if (JSON.stringify(seats) !== JSON.stringify(want)) bad(`post ${i} says ${JSON.stringify(seats)}, not ${JSON.stringify(want)}`);
    });
  });

  eachGame(() => all, 'bids what its mind bid and plays the play its mind chose, the last of those on offer', (g, bad) => {
    const names = only(g.posts, 'state')[0]?.seats.map((s) => s.name) ?? [];
    for (const p of g.prompts) {
      const seat = `seat ${p.seat}`;
      const next = nextAct(g.posts, p.at, p.seat);
      if (!next) {
        bad(`${seat} does nothing after its question`);
        continue;
      }
      const bid = /the number being (\d+)/.exec(p.text);
      if (bid) {
        if (next.text !== w.log.bid(names[p.seat] ?? '', Number(bid[1]))) bad(`${seat}: "${next.text}" for a bid of ${bid[1]}`);
        continue;
      }
      const rows = rowsOf(p.text);
      const chosen = rows.at(-1);
      const done = playIn(next.text);
      if (!chosen || !done) {
        bad(`${seat}: "${next.text}" for ${rows.length} plays on offer`);
        continue;
      }
      if (rows.length > 1) choosing += 1;
      if (done.label !== chosen.label || done.cards.join() !== chosen.cards.join()) {
        bad(`${seat} played "${next.text}", not the last of ${rows.length} on offer`);
      }
    }
  });

  it('has the minds play other plays than the rules would', () => {
    expect(choosing).toBeGreaterThan(50);
  });

  eachGame(() => all, 'lets a pet say what its mind said with its choice, once for each question, and the pets say nothing else of their own', (g, bad) => {
    const lines = only(g.posts, 'line').filter((l) => l.tone === 'say');
    const said = lines.filter((l) => l.text === 'Hm.').map((l) => l.seat);
    if (JSON.stringify(said) !== JSON.stringify(g.prompts.map((p) => p.seat))) bad(`${said.length} remarks for ${g.prompts.length} questions`);
    for (const l of lines) {
      if (l.seat === null || l.seat === 0) bad(`seat ${l.seat} speaks`);
      if (l.text !== 'Hm.' && !pool.has(l.text)) bad(`unknown speech "${l.text}"`);
    }
  });

  it('adds no stock line for a pet that has just spoken for itself, over what it then did', () => {
    let chances = 0;
    const bad: string[] = [];
    for (const g of all) {
      g.posts.forEach((m, i) => {
        if (m.kind !== 'line' || m.tone !== 'say' || m.text !== 'Hm.' || m.seat === null) return;
        const from = g.posts.findIndex((x, j) => j > i && x.kind === 'state');
        if (from < 0) return;
        const to = g.posts.findIndex((x, j) => j > from && x.kind === 'state');
        const entry = g.posts.slice(from + 1, to < 0 ? undefined : to);
        const mine = (x: DdzOut): x is Post<'line'> => x.kind === 'line' && x.seat === m.seat;
        const left = (g.posts[from] as Post<'state'>).seats[m.seat]?.cards ?? 0;
        const bomb = entry.some((x) => mine(x) && x.tone === 'bomb');
        const near = left >= 1 && left <= 2 && entry.some((x) => mine(x) && x.tone === 'act' && playIn(x.text) !== null);
        if (bomb || near) chances += 1;
        const stock = entry.filter((x) => mine(x) && x.tone === 'say' && pool.has(x.text));
        if (stock.length > 0) bad.push(`seed ${g.seed} (${g.size} players), seat ${m.seat}: ${stock.map((x) => (x as Post<'line'>).text).join(' | ')}`);
      });
    }
    expect(chances).toBeGreaterThan(10);
    expect(bad.slice(0, 6)).toEqual([]);
  });

  eachGame(() => all, 'tells a pet only what its seat can know of the sides, and the right side of its own', (g, bad) => {
    const mode = CONFIG[g.size].mode;
    const final = only(g.posts, 'state').at(-1);
    if (!final) return bad('no table');
    for (const p of g.prompts) {
      const before = shownBefore(g.posts, p.at);
      if (!before) {
        bad('a question before the table is shown');
        continue;
      }
      const at = `seat ${p.seat}, after post ${p.at}`;
      const held = heldIn(p.text);
      if (held.length !== g.size) bad(`${at}: cards held are given for ${held.length} seats`);
      for (const h of held) {
        const shown = before.seats[h.seat];
        if (!shown) continue;
        if (h.cards !== shown.cards) bad(`${at}: seat ${h.seat} holds ${shown.cards}, told ${h.cards}`);
        if (h.seat === p.seat) {
          if (h.side !== null) bad(`${at}: it is told its own side among the others`);
        } else if (h.seat === 0) {
          if (h.side !== null && (shown.hidden || h.side !== final.seats[0]?.role)) bad(`${at}: the user is given as a ${h.side}`);
        } else if (h.side !== shown.role) {
          bad(`${at}: seat ${h.seat} is given as ${h.side}, the table shows ${shown.role}`);
        }
      }
      const hand = /Your hand \((\d+) cards?\)/.exec(p.text)?.[1];
      if (Number(hand) !== before.seats[p.seat]?.cards) bad(`${at}: a hand of ${hand}, not ${before.seats[p.seat]?.cards}`);
      if (before.phase === 'bid') {
        if (!p.text.includes('The landlord is not decided yet.')) bad(`${at}: told of a landlord before there is one`);
        continue;
      }
      const known = before.seats[p.seat]?.role;
      const own = final.seats[p.seat]?.role;
      const side = known === 'landlord' ? 'landlord' : own === 'landlord' ? 'hidden' : 'farmer';
      if (!p.text.includes(`${w.youAre[side]} ${w.roleHint[side]}`)) bad(`${at}: not told it is ${side}`);
      if (mode === 'call') {
        const marks = held.filter((h) => h.side === 'landlord').length;
        const rest = Number(/Landlords still hidden: (\d+)/.exec(p.text)?.[1] ?? 0);
        if (marks + (own === 'landlord' ? 1 : 0) + rest !== CONFIG[g.size].landlords) bad(`${at}: ${marks} landlords named, ${rest} hidden`);
        if (!p.text.includes('The called card is')) bad(`${at}: no called card`);
      }
    }
  });

  it('tells a pet what has happened since it last looked, among it the moves of the user, whom it calls what he is', async () => {
    // The user of the games above always passes his first bid, so a few more are played with one who bids.
    const bidder: Policy = (ask, n, hint) => (ask.k === 'bid' ? { t: 'bid', bid: ask.min } : answerTo(ask, n, hint));
    const more: string[] = [];
    for (const size of [3, 4] as const) {
      for (const seed of [1, 2, 3, 4]) {
        const { t, prompts } = minded(undefined, { seed });
        t.start(picksFor(seed), size);
        expect(await t.finish(bidder), `seed ${seed}`).toBe(true);
        more.push(...prompts.map((p) => p.text));
      }
    }
    const texts = [...all.flatMap((g) => g.prompts.map((p) => p.text)), ...more];
    expect(texts.some((x) => x.includes('What has happened since you last looked:'))).toBe(true);
    const seen = [/#1 the user bid \d\./, /#1 the user did not bid\./, /#1 the user played .+ \(.+\)\./, /#1 the user passed\./, /#[2-6] you played /];
    for (const re of seen) expect(texts.some((x) => re.test(x)), String(re)).toBe(true);
    expect(texts.some((x) => x.includes('#1 the user'))).toBe(true);
    expect(texts.every((x) => !x.includes('#1 You'))).toBe(true);
  }, 60_000);

  it('shows no pet a menu with more than the plays a hand can make: every play on offer is a play the table takes', () => {
    let rows = 0;
    for (const g of all) {
      for (const p of g.prompts) {
        const found = rowsOf(p.text);
        rows += found.length;
        expect(found.length, `seat ${p.seat}`).toBeLessThanOrEqual(34);
        expect(found.every((r) => r.label !== ''), `seat ${p.seat}`).toBe(true);
      }
    }
    expect(rows).toBeGreaterThan(100);
  });

  it('briefs each pet once, in the language of the user, as the character it is', async () => {
    for (const [strs, language] of [[en, 'English'], [zh, 'Simplified Chinese']] as const) {
      const { t, prompts } = minded(undefined, { seed: 6, words: () => ({ g: strs.games, names: strs.ask.petName, language }) });
      t.start(PET_IDS.slice(0, 4), 5);
      expect(await t.finish(answerTo), language).toBe(true);
      const pets = (t.states().at(-1)?.seats ?? []).filter((s) => !s.me);
      expect(pets).toHaveLength(4);
      for (const s of pets) {
        const mine = prompts.filter((p) => p.seat === s.seat);
        expect(mine.length, `${language} seat ${s.seat}`).toBeGreaterThan(0);
        const first = mine[0]?.text ?? '';
        expect(first, `${language} seat ${s.seat}`).toContain(`Speak in ${language}`);
        expect(first).toContain(`Your character: the persona of ${s.id}`);
        expect(first).toContain(`You are seat #${s.seat + 1}, ${strs.ask.petName[s.id as PetId]}`);
        expect(mine.filter((p) => p.text.includes('You play Dou Dizhu with 5 players'))).toHaveLength(1);
      }
      expect(prompts.every((p) => !p.text.includes('#1 You'))).toBe(true);
    }
  });

  it('lets the pets go on with their stock lines when their minds have nothing to say', async () => {
    let stock = 0;
    for (const size of SIZES) {
      for (const seed of [1, 2, 3]) {
        const { t } = minded((_seat, text) => model(text, ''), { seed });
        t.start(picksFor(seed), size);
        expect(await t.finish(answerTo), `seed ${seed}`).toBe(true);
        const said = t.lines().filter((l) => l.tone === 'say');
        expect(said.every((l) => l.seat !== null && l.seat > 0 && pool.has(l.text)), `seed ${seed}`).toBe(true);
        stock += said.length;
      }
    }
    expect(stock).toBeGreaterThan(0);
  }, 60_000);

  it('has no pet thinking when there is no brain to think with', async () => {
    const g = await playOut(3, 5);
    expect(g.done).toBe(true);
    expect(thinkingOf(g.posts)).toEqual([]);
  });

  it('plays the rules\' game when the brain has nothing it can use: the same posts, but for the thinking', async () => {
    for (const size of SIZES) {
      const rules = await playOut(5, size);
      expect(rules.done).toBe(true);
      const fails: [string, (seat: number, text: string) => string | null][] = [
        ['no answer', () => null],
        ['an answer that is no JSON', () => 'I would rather not say.'],
        ['an answer that cannot be taken', (_seat, text) => junk(text)],
        ['a brain that breaks', () => { throw new Error('boom'); }],
      ];
      for (const [name, reply] of fails) {
        const { t, prompts } = minded(reply, { seed: 5 });
        t.start(picksFor(5), size);
        expect(await t.finish(answerTo), `${name}, ${size} players`).toBe(true);
        expect(prompts.length, `${name}, ${size} players`).toBeGreaterThan(0);
        expect(withoutThinking(t.posts), `${name}, ${size} players`).toEqual(rules.posts);
      }
    }
  }, 60_000);

  it('warms the brain once a game and lets it go when the game is over, and at once when it is stopped', async () => {
    const over = minded();
    over.t.start([], 4);
    expect(over.fb.warm).toHaveBeenCalledTimes(1);
    expect(over.fb.close).not.toHaveBeenCalled();
    expect(await over.t.finish(answerTo)).toBe(true);
    await tick();
    expect(over.fb.warm).toHaveBeenCalledTimes(1);
    expect(over.fb.close).toHaveBeenCalled();

    const stopped = minded();
    stopped.t.start([], 4);
    await tick();
    expect(stopped.fb.close).not.toHaveBeenCalled();
    stopped.t.room.stop();
    expect(stopped.fb.close).toHaveBeenCalled();
  });

  it('waits for a pet that is still thinking, and goes on with the answer it gets', async () => {
    const { t, held } = slow();
    t.start([], 4);
    expect(await t.play(() => held.length > 0, answerTo)).toBe(true);
    expect(thinkingOf(t.posts).at(-1)).toHaveLength(1);
    const before = t.posts.length;
    for (let i = 0; i < 20; i++) {
      t.clock.fire();
      await tick();
    }
    expect(t.posts).toHaveLength(before);
    expect(held).toHaveLength(1);
    const first = held[0] as Held;
    expect(thinkingOf(t.posts).at(-1)).toEqual([first.seat]);
    first.release(model(first.text, 'Ahem.'));
    await tick();
    expect(t.posts.length).toBeGreaterThan(before);
    expect(thinkingOf(t.posts).at(-1)).toEqual([]);
    expect(t.lines().some((l) => l.tone === 'say' && l.seat === first.seat && l.text === 'Ahem.')).toBe(true);
    t.room.stop();
  });

  it('posts nothing more when the game is stopped while a pet is thinking, whatever it says later', async () => {
    const { t, held, brain } = slow((text) => text.includes('Plays on offer'));
    t.start([], 4);
    expect(await t.play(() => held.length > 0, answerTo)).toBe(true);
    expect(thinkingOf(t.posts).at(-1)).toHaveLength(1);
    t.room.stop();
    expect(brain.close).toHaveBeenCalled();
    const posted = t.posts.length;
    for (const h of held) h.release(model(h.text, 'Too late.'));
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
