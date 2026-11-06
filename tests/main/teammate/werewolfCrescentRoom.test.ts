import { describe, expect, it } from 'vitest';
import { WerewolfRoom } from '../../../src/main/teammate/werewolfRoom';
import type { WolfAsk, WolfIn, WolfOut } from '../../../src/shared/gameIpc';
import { strings } from '../../../src/shared/i18n';
import { PET_IDS } from '../../../src/shared/teammate/pet';
import { CRESCENT_SEATS } from '../../../src/shared/teammate/werewolf';
import { fakeBrain, fakeServices, tick } from './gameFakes';

const w = strings('en', 'win').teammate.games.werewolf;

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A user who answers every question with the first legal choice. */
const reply = (ask: WolfAsk): WolfIn | null => {
  const first = ask.options[0] ?? 1;
  switch (ask.kind) {
    case 'kill': case 'check': case 'model': case 'guard': case 'charm': return { t: 'target', seat: first };
    case 'thief': return { t: 'card', index: 0 };
    case 'couple': return { t: 'pair', seats: [ask.options[0] ?? 1, ask.options[1] ?? 2] };
    case 'vote': return { t: 'vote', seat: first };
    case 'speak': return { t: 'say', text: 'hm' };
    case 'witch': return { t: 'witch', save: false, poison: null };
    case 'run': return { t: 'run', run: false };
    case 'shoot': case 'badge': return { t: 'pick', seat: null };
  }
};

function room(seed: number, brainReply?: (seat: number, prompt: string) => string | null) {
  const posts: WolfOut[] = [];
  const mind = brainReply ? fakeBrain(brainReply) : null;
  const { services, clock } = fakeServices({
    random: seeded(seed), canThink: () => mind !== null, brain: () => mind?.brain ?? null,
  });
  const r = new WerewolfRoom(services, (m) => posts.push(m));
  const over = (): Extract<WolfOut, { kind: 'over' }>[] =>
    posts.filter((m): m is Extract<WolfOut, { kind: 'over' }> => m.kind === 'over');
  let answered = 0;
  const finish = async (games = 1, playing = false): Promise<boolean> => {
    for (let i = 0; i < 30_000; i++) {
      if (over().length >= games) return true;
      const ask = [...posts].reverse().find((m) => m.kind === 'ask');
      if (playing && ask?.kind === 'ask' && ask.ask && posts.length > answered) {
        answered = posts.length;
        const msg = reply(ask.ask);
        if (msg) r.on(msg);
      }
      if (!clock.fire()) await tick();
    }
    return false;
  };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 50; i++) {
      clock.fire();
      await tick();
    }
  };
  return { r, posts, mind, finish, settle, over };
}

describe('WerewolfRoom, crescent', () => {
  it('offers both games in the lobby, the crescent one with eighteen seats', () => {
    const t = room(1);
    t.r.lobby();
    const lobby = t.posts[0];
    if (lobby?.kind !== 'lobby') throw new Error('no lobby');
    expect(lobby.variants?.map((v) => v.id)).toEqual(['classic', 'crescent']);
    const crescent = lobby.variants?.[1];
    expect(crescent?.watchSeats).toBe(CRESCENT_SEATS);
    expect(crescent?.seats).toBe(CRESCENT_SEATS - 1);
    expect(crescent?.rules).toBe(w.rulesCrescent);
  });

  it('seats eighteen players, tells a pet that sits twice apart by a number, and plays to the end', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const t = room(seed);
      t.r.on({ t: 'start', pets: [], play: false, mode: 'crescent' });
      expect(await t.finish(), `seed ${seed}`).toBe(true);
      const state = [...t.posts].reverse().find((m) => m.kind === 'state');
      if (state?.kind !== 'state') throw new Error('no state');
      expect(state.seats).toHaveLength(CRESCENT_SEATS);
      const names = state.seats.map((s) => s.name);
      expect(new Set(names).size, `seed ${seed}`).toBe(CRESCENT_SEATS);
      expect(names.filter((n) => / 2$/.test(n)).length).toBe(CRESCENT_SEATS - PET_IDS.length);
      expect(t.over()).toHaveLength(1);
      expect(['wolves', 'village', 'lovers']).toContain(t.over()[0]?.winner);
    }
  }, 60_000);

  it('plays a user through the new questions of the night', async () => {
    const asked = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const t = room(seed);
      t.r.on({ t: 'start', pets: [], play: true, mode: 'crescent' });
      expect(await t.finish(1, true), `seed ${seed}`).toBe(true);
      for (const m of t.posts) if (m.kind === 'ask' && m.ask) asked.add(m.ask.kind);
    }
    for (const kind of ['thief', 'couple', 'model', 'guard', 'charm']) expect(asked.has(kind), kind).toBe(true);
  }, 120_000);
});

describe('the chat after a game', () => {
  const quips = (): string[] => w.chatQuips;

  it('is ignored while the game is on', async () => {
    const t = room(1);
    t.r.on({ t: 'start', pets: [], play: false });
    await tick();
    const before = t.posts.length;
    t.r.on({ t: 'chat', text: 'hello' });
    await t.settle();
    expect(t.posts.filter((m) => m.kind === 'line' && m.text === 'hello')).toEqual([]);
    expect(t.posts.length).toBeGreaterThanOrEqual(before);
  });

  it('has pets answer with stock banter when they have no mind, and not twice at once', async () => {
    const t = room(2);
    t.r.on({ t: 'start', pets: [], play: false });
    expect(await t.finish()).toBe(true);
    const from = t.posts.length;
    t.r.on({ t: 'chat', text: 'you all suck' });
    t.r.on({ t: 'chat', text: 'second' });
    await t.settle();
    const lines = t.posts.slice(from).filter((m) => m.kind === 'line');
    expect(lines.some((m) => m.text.endsWith('you all suck'))).toBe(true);
    expect(lines.some((m) => m.text.endsWith('second'))).toBe(false);
    const said = lines.filter((m) => m.tone === 'say' && quips().includes(m.text));
    expect(said.length).toBeGreaterThanOrEqual(1);
    expect(said.length).toBeLessThanOrEqual(3);
  });

  it('asks the minds of the pets, with the roles revealed and the user\'s words, and shows what they say', async () => {
    const prompts: string[] = [];
    const t = room(3, (_seat, prompt) => {
      prompts.push(prompt);
      return prompt.includes('chats freely') || prompt.includes('chat') ? '{"say": "you wish"}' : null;
    });
    t.r.on({ t: 'start', pets: [], play: false });
    expect(await t.finish()).toBe(true);
    prompts.length = 0;
    t.r.on({ t: 'chat', text: 'that was rigged' });
    await t.settle();
    const asked = prompts.filter((p) => p.includes('that was rigged'));
    expect(asked.length).toBeGreaterThanOrEqual(1);
    expect(asked[0]).toContain('was wolf');
    expect(asked[0]).toContain('trash talk');
    expect(t.posts.filter((m) => m.kind === 'line' && m.text === 'you wish').length).toBe(asked.length);
  });

  it('plays the same players again, with the same seats and a mind that remembers', async () => {
    const prompts: string[] = [];
    const t = room(4, (_seat, prompt) => {
      prompts.push(prompt);
      return null;
    });
    t.r.on({ t: 'start', pets: [], play: false, mode: 'crescent' });
    expect(await t.finish()).toBe(true);
    const names = (): string[] => {
      const s = [...t.posts].reverse().find((m) => m.kind === 'state');
      return s?.kind === 'state' ? s.seats.map((x) => x.name) : [];
    };
    const first = names();
    t.r.on({ t: 'again' });
    expect(await t.finish(2)).toBe(true);
    expect([...names()].sort()).toEqual([...first].sort());
    expect(prompts.some((p) => p.includes('game 2 with the same players'))).toBe(true);
    expect(t.mind?.close).not.toHaveBeenCalled();
  }, 60_000);
});

describe('what the page may send', () => {
  it('only reaches the room as a WolfIn', () => {
    const msg: WolfIn = { t: 'start', pets: [], play: false, mode: 'crescent' };
    expect(msg.mode).toBe('crescent');
  });
});
