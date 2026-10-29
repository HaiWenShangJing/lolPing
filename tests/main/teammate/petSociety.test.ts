import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PetGroups } from '../../../src/main/teammate/petGroups';
import { PetMinds } from '../../../src/main/teammate/petMinds';
import { PetSociety, type Brain, type RoomEvent } from '../../../src/main/teammate/petSociety';
import { PET_IDS, type PetId } from '../../../src/shared/teammate/pet';
import type { PetStatus } from '../../../src/shared/teammate/petControl';
import type { PetGroup } from '../../../src/shared/teammate/petGroups';
import { HOST_IDLE_SECONDS, type WakeKind } from '../../../src/shared/teammate/petHost';
import { SOCIAL_DEPTH, readingMs } from '../../../src/shared/teammate/petSociety';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/settings';
import { DEFAULT_PETS } from '../../../src/shared/teammate/pet';
import { DEFAULT_TEAMMATE } from '../../../src/shared/teammate/settings';
import type { PetRoom } from '../../../src/main/teammate/petHost';

class Mind implements Brain {
  active = false;
  syncs = 0;
  stops = 0;
  rebriefs = 0;
  nudges: Array<[WakeKind, boolean]> = [];
  token = '';
  constructor(readonly id: PetId, readonly room: PetRoom, readonly stagger: () => number, readonly tell: (text: string) => void) {
    this.token = `host-${id}-1.x`;
  }
  sync(): void { this.syncs += 1; }
  stop(): void { this.stops += 1; this.active = false; }
  tools(ask: string) { return ask === this.token ? [{ name: `tool-of-${this.id}`, description: '', parameters: {} }] : null; }
  call(ask: string, name: string): ReturnType<Brain['call']> {
    return Promise.resolve({ content: [{ text: `${this.id}:${ask}:${name}` }], isError: false });
  }
  nudge(kind: WakeKind, fromUser: boolean): boolean {
    this.nudges.push([kind, fromUser]);
    return this.active;
  }
  rebrief(): void { this.rebriefs += 1; }
  /** Says something into the room, as the real mind does once the bubble showed. */
  say(text: string, to: PetId | 'all' | null = null): void { this.room.said(this.id, text, to); }
}

interface Timer {
  ms: number;
  fn: () => void;
  live: boolean;
}

function harness(on: PetId[] = ['naiwa', 'airi', 'hiyori']) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    teammate: {
      ...DEFAULT_TEAMMATE, petRoam: true, petRoamKind: 'host', petHostActivity: 'normal', petSocial: true,
      pets: Object.fromEntries(PET_IDS.map((id) => [id, { ...DEFAULT_PETS[id], on: on.includes(id) }])) as Settings['teammate']['pets'],
    },
  };
  const state = { at: 1_000_000, idle: 5, shown: on.map((id): PetStatus => ({ id, xPct: 50, yPct: 50, away: false, anims: [] })) };
  const dir = mkdtempSync(join(tmpdir(), 'lolping-soc-'));
  const minds = new PetMinds(join(dir, 'pet-notes.json'));
  const groups = new PetGroups(join(dir, 'pet-groups.json'));
  const said: string[] = [];
  const timers: Timer[] = [];
  const brains = new Map<PetId, Mind>();
  const society = new PetSociety({
    settings: () => settings,
    now: () => state.at,
    idleSeconds: () => state.idle,
    shown: () => state.shown,
    minds,
    groups,
    say: (text) => said.push(text),
    make: (id, room, stagger, tell) => {
      const m = new Mind(id, room, stagger, tell);
      m.active = on.includes(id);
      brains.set(id, m);
      return m;
    },
    after: (ms, fn) => {
      const t: Timer = { ms, fn, live: true };
      timers.push(t);
      return () => { t.live = false; };
    },
    random: () => 0.99,
  });
  const live = () => timers.filter((t) => t.live);
  /** Lets every pending timer go, shortest first, as time passes. */
  const elapse = (): void => {
    for (const t of live().sort((a, b) => a.ms - b.ms)) {
      t.live = false;
      t.fn();
    }
  };
  const mind = (id: PetId): Mind => brains.get(id) as Mind;
  const events: RoomEvent[] = [];
  society.onEvent((e) => events.push(e));
  return { society, settings, state, minds, groups, said, timers, live, elapse, mind, events };
}

/** A group of these pets, made through the society as the lounge does. */
function group(h: ReturnType<typeof harness>, members: PetId[], name = 'Code club'): PetGroup {
  const saved = h.society.saveGroup({ id: null, name, members });
  if (!saved) throw new Error('group refused');
  return saved;
}

describe('PetSociety roster', () => {
  it('makes a mind for every pet, and is active while one of them is on', () => {
    const h = harness();
    expect([...PET_IDS].every((id) => h.mind(id) !== undefined)).toBe(true);
    expect(h.society.active).toBe(true);
    expect(harness([]).society.active).toBe(false);
  });

  it('lists the pets that are showing and have a mind that is on', () => {
    const h = harness();
    expect(h.society.roster()).toEqual(['naiwa', 'airi', 'hiyori']);
    h.state.shown = h.state.shown.filter((p) => p.id !== 'airi');
    h.mind('naiwa').active = false;
    expect(h.society.roster()).toEqual(['hiyori']);
  });

  it('tells every mind to follow the settings, and the lounge that the roster may have changed', () => {
    const h = harness();
    h.society.sync();
    expect(PET_IDS.every((id) => h.mind(id).syncs === 1)).toBe(true);
    expect(h.events).toEqual([{ kind: 'roster' }]);
  });

  it('spaces the first wake-ups of the minds that are on by seven seconds each', () => {
    const h = harness(['hiyori', 'naiwa', 'airi']);
    expect([h.mind('naiwa').stagger(), h.mind('airi').stagger(), h.mind('hiyori').stagger()]).toEqual([0, 7_000, 14_000]);
    h.settings.teammate.pets.naiwa.on = false;
    expect(h.mind('airi').stagger()).toBe(0);
  });

  it('stops every mind and every timer waiting to wake one', () => {
    const h = harness();
    h.mind('naiwa').say('hi', 'airi');
    expect(h.live()).toHaveLength(1);
    h.society.stop();
    expect(PET_IDS.every((id) => h.mind(id).stops === 1)).toBe(true);
    expect(h.live()).toEqual([]);
  });
});

describe('PetSociety tools', () => {
  it('gives the tools of a session to the mind that owns its token, and nobody else', async () => {
    const h = harness();
    expect(h.society.tools('host-airi-1.x')?.[0].name).toBe('tool-of-airi');
    expect(h.society.tools('host-naiwa-1.x')?.[0].name).toBe('tool-of-naiwa');
    expect(h.society.tools('host-whale-9.zz')).toBeNull();
    const r = await h.society.call('host-hiyori-1.x', 'pet_say', {});
    expect(r).toEqual({ content: [{ text: 'hiyori:host-hiyori-1.x:pet_say' }], isError: false });
    expect(await h.society.call('nope', 'pet_say', {})).toEqual({ content: [{ text: 'Not available.' }], isError: true });
  });
});

describe('PetSociety user speech', () => {
  it('wakes the pet the user spoke to at once, with its words logged and cleaned', () => {
    const h = harness();
    expect(h.society.userSays('naiwa', '  hello  ')).toBe(true);
    expect(h.society.transcript().map((l) => [l.from, l.to, l.text, l.kind])).toEqual([['user', 'naiwa', 'hello', 'say']]);
    expect(h.mind('naiwa').nudges).toEqual([['direct', true]]);
    expect(h.mind('airi').nudges).toEqual([]);
    expect(h.live()).toEqual([]);
  });

  it('wakes everyone for a line to all, one after another', () => {
    const h = harness();
    expect(h.society.userSays('all', 'good morning')).toBe(true);
    expect(h.mind('naiwa').nudges).toEqual([['direct', true]]);
    expect(h.live().map((t) => t.ms)).toEqual([2_500, 5_000]);
    h.elapse();
    expect(h.mind('airi').nudges).toEqual([['direct', true]]);
    expect(h.mind('hiyori').nudges).toEqual([['direct', true]]);
  });

  it('refuses words that are empty, or meant for a pet that is not there', () => {
    const h = harness();
    expect(h.society.userSays('naiwa', '   ')).toBe(false);
    expect(h.society.userSays('whale', 'hi')).toBe(false);
    h.mind('naiwa').active = false;
    expect(h.society.userSays('naiwa', 'hi')).toBe(false);
    expect(h.society.transcript()).toEqual([]);
    expect(harness([]).society.userSays('all', 'hi')).toBe(false);
  });

  it('is answered even when the pets may not talk and the user has been away', () => {
    const h = harness();
    h.settings.teammate.petSocial = false;
    h.state.idle = HOST_IDLE_SECONDS * 3;
    h.society.userSays('airi', 'hey');
    expect(h.mind('airi').nudges).toEqual([['direct', true]]);
  });

  it('cuts a long line to what the chat allows', () => {
    const h = harness();
    h.society.userSays('naiwa', 'x'.repeat(5000));
    expect(h.society.transcript()[0].text.length).toBeLessThan(500);
  });
});

describe('PetSociety pets talking', () => {
  it('logs what a pet says, tells the lounge, and wakes the pet it spoke to after a moment to read', () => {
    const h = harness();
    h.mind('airi').say('Naiwa, want tea?', 'naiwa');
    expect(h.society.transcript().map((l) => [l.from, l.to, l.kind])).toEqual([['airi', 'naiwa', 'say']]);
    expect(h.events.filter((e) => e.kind === 'line')).toHaveLength(1);
    expect(h.mind('naiwa').nudges).toEqual([]);
    expect(h.live().map((t) => t.ms)).toEqual([readingMs('Naiwa, want tea?'.length)]);
    h.elapse();
    expect(h.mind('naiwa').nudges).toEqual([['direct', false]]);
    expect(h.mind('hiyori').nudges).toEqual([]);
    expect(h.mind('airi').nudges).toEqual([]);
  });

  it('wakes nobody for a pet that only spoke up, when chance does not have the others join in', () => {
    const h = harness();
    h.mind('airi').say('la la la');
    expect(h.live()).toEqual([]);
  });

  it('does not let pets talk while they may not, or while the user is away', () => {
    const h = harness();
    h.settings.teammate.petSocial = false;
    h.mind('airi').say('hey', 'naiwa');
    expect(h.live()).toEqual([]);
    h.settings.teammate.petSocial = true;
    h.state.idle = HOST_IDLE_SECONDS;
    h.mind('airi').say('hey again', 'naiwa');
    expect(h.live()).toEqual([]);
    expect(h.society.transcript()).toHaveLength(2);
  });

  it('lets a chain of replies go only so deep, and starts over when the user speaks', () => {
    const h = harness(['naiwa', 'airi']);
    // The opening line starts the chain; the replies after it are what is counted.
    const turns = SOCIAL_DEPTH.normal + 1;
    for (let i = 0; i < turns; i++) {
      h.state.at += 5_000;
      (i % 2 === 0 ? h.mind('airi') : h.mind('naiwa')).say(`line ${i}`, i % 2 === 0 ? 'naiwa' : 'airi');
    }
    h.elapse();
    expect(h.mind('naiwa').nudges.length + h.mind('airi').nudges.length).toBe(turns);
    h.state.at += 5_000;
    h.mind('airi').say('one more', 'naiwa');
    expect(h.live()).toEqual([]);
    h.society.userSays('airi', 'let them be');
    h.state.at += 5_000;
    h.mind('airi').say('thanks', 'naiwa');
    expect(h.live()).toHaveLength(1);
  });

  it('starts a new chain after a quiet while', () => {
    const h = harness(['naiwa', 'airi']);
    for (let i = 0; i < SOCIAL_DEPTH.normal + 1; i++) {
      h.state.at += 5_000;
      h.mind('airi').say(`line ${i}`, 'naiwa');
    }
    h.elapse();
    const before = h.mind('naiwa').nudges.length;
    h.state.at += 120_000;
    h.mind('airi').say('anyone there?', 'naiwa');
    expect(h.live()).toHaveLength(1);
    h.elapse();
    expect(h.mind('naiwa').nudges).toHaveLength(before + 1);
  });

  it('stops waking pets for each other once the hour\'s budget is spent, but still answers the user', () => {
    const h = harness(['naiwa', 'airi']);
    const hourly = 30;
    h.settings.teammate.petHostActivity = 'calm';
    let woke = 0;
    for (let i = 0; i < hourly + 10; i++) {
      h.state.at += QUIET + 1;
      h.mind('airi').say(`line ${i}`, 'naiwa');
      woke += h.live().length;
      h.elapse();
    }
    expect(woke).toBe(hourly);
    h.society.userSays('naiwa', 'still there?');
    expect(h.mind('naiwa').nudges.at(-1)).toEqual(['direct', true]);
  });

  it('wakes nobody for a pet\'s line when it is the only one showing', () => {
    const h = harness(['naiwa']);
    h.mind('naiwa').say('hello?', 'all');
    expect(h.live()).toEqual([]);
  });
});

const QUIET = 90_000;

describe('PetSociety notes', () => {
  it('logs a note without waking anyone, dim in the lounge', () => {
    const h = harness();
    h.mind('naiwa').room.noted('naiwa', 'likes tea');
    expect(h.society.transcript().map((l) => [l.from, l.to, l.kind, l.text])).toEqual([['naiwa', null, 'note', 'likes tea']]);
    expect(h.live()).toEqual([]);
    expect(PET_IDS.every((id) => h.mind(id).nudges.length === 0)).toBe(true);
  });

  it('is not heard by the other pets', () => {
    const h = harness();
    h.mind('naiwa').room.noted('naiwa', 'likes tea');
    h.mind('airi').say('hi');
    const heard = h.mind('hiyori').room.heard('hiyori', 0);
    expect(heard.lines.map((l) => l.text)).toEqual(['hi']);
    expect(heard.seq).toBe(2);
  });

  it('briefs a pet again when the user changes its notes, but not when the pet does', () => {
    const h = harness();
    h.minds.set('naiwa', [{ text: 'a', about: null, at: 1 }]);
    expect(h.mind('naiwa').rebriefs).toBe(0);
    h.minds.set('naiwa', [], 'user');
    expect(h.mind('naiwa').rebriefs).toBe(1);
    expect(h.mind('airi').rebriefs).toBe(0);
  });
});

describe('PetSociety room', () => {
  it('numbers the lines and tells a pet only what it has not heard, from the others', () => {
    const h = harness();
    h.society.userSays('all', 'hello');
    h.mind('airi').say('hi!');
    h.mind('naiwa').say('yo');
    const first = h.mind('naiwa').room.heard('naiwa', 0);
    expect(first.lines.map((l) => l.text)).toEqual(['hello', 'hi!']);
    expect(first.seq).toBe(3);
    expect(h.mind('naiwa').room.heard('naiwa', first.seq).lines).toEqual([]);
  });

  it('keeps the transcript to its limit', () => {
    const h = harness(['naiwa', 'airi']);
    h.settings.teammate.petSocial = false;
    for (let i = 0; i < 230; i++) h.mind('airi').say(`line ${i}`);
    expect(h.society.transcript()).toHaveLength(200);
    expect(h.society.transcript().at(-1)?.text).toBe('line 229');
  });

  it('stops telling a listener once it is removed', () => {
    const h = harness();
    const seen: RoomEvent[] = [];
    const stop = h.society.onEvent((e) => seen.push(e));
    h.mind('airi').say('one');
    stop();
    h.mind('airi').say('two');
    expect(seen).toHaveLength(1);
  });
});

describe('PetSociety tell', () => {
  it('says a failure once however many minds report it, until a minute has passed', () => {
    const h = harness();
    h.mind('naiwa').tell('Hosting keeps failing');
    h.mind('airi').tell('Hosting keeps failing');
    h.mind('airi').tell('Something else');
    expect(h.said).toEqual(['Hosting keeps failing', 'Something else']);
    h.state.at += 61_000;
    h.mind('hiyori').tell('Hosting keeps failing');
    expect(h.said).toHaveLength(3);
  });
});

describe('PetSociety groups', () => {
  it('makes a group, tells the lounge, and lists who can be spoken to in each room', () => {
    const h = harness();
    const g = group(h, ['naiwa', 'airi']);
    expect(g).toMatchObject({ name: 'Code club', members: ['naiwa', 'airi'] });
    expect(h.events).toEqual([{ kind: 'roster' }]);
    expect(h.society.groups()).toEqual([g]);
    expect(h.society.rosters()).toEqual({ main: ['naiwa', 'airi', 'hiyori'], [g.id]: ['naiwa', 'airi'] });
  });

  it('refuses a group without a name or with fewer than two pets, and says nothing about it', () => {
    const h = harness();
    expect(h.society.saveGroup({ id: null, name: '  ', members: ['naiwa', 'airi'] })).toBeNull();
    expect(h.society.saveGroup({ id: null, name: 'Solo', members: ['naiwa'] })).toBeNull();
    expect(h.society.saveGroup({ id: 'gnone', name: 'Ghost', members: ['naiwa', 'airi'] })).toBeNull();
    expect(h.society.groups()).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('lets only the members that are showing and on be spoken to in a group', () => {
    const h = harness();
    const g = group(h, ['naiwa', 'hiyori']);
    h.mind('hiyori').active = false;
    expect(h.society.roster(g.id)).toEqual(['naiwa']);
    expect(h.society.userSays('hiyori', 'hi', g.id)).toBe(false);
    expect(h.society.userSays('airi', 'hi', g.id)).toBe(false);
    expect(h.society.userSays('naiwa', 'hi', g.id)).toBe(true);
  });

  it('wakes only the members for a line the user says to a group', () => {
    const h = harness();
    const g = group(h, ['naiwa', 'airi']);
    expect(h.society.userSays('all', 'why is my build slow?', g.id)).toBe(true);
    expect(h.society.transcript().map((l) => [l.room, l.from, l.to])).toEqual([[g.id, 'user', 'all']]);
    h.elapse();
    expect(h.mind('naiwa').nudges).toEqual([['direct', true]]);
    expect(h.mind('airi').nudges).toEqual([['direct', true]]);
    expect(h.mind('hiyori').nudges).toEqual([]);
  });

  it('lets a group\'s talk be heard by its members and nobody else, and says where it was said', () => {
    const h = harness();
    const g = group(h, ['naiwa', 'airi']);
    h.society.userSays('all', 'topic', g.id);
    h.society.userSays('all', 'hello everyone');
    const member = h.mind('airi').room.heard('airi', 0);
    expect(member.lines.map((l) => l.text)).toEqual(['topic', 'hello everyone']);
    expect(member.groups).toEqual({ [g.id]: 'Code club' });
    const outsider = h.mind('hiyori').room.heard('hiyori', 0);
    expect(outsider.lines.map((l) => l.text)).toEqual(['hello everyone']);
    expect(outsider.group).toBeNull();
  });

  it('answers in the group a pet last heard something in, to the whole group unless it singles out a member', () => {
    const h = harness();
    const g = group(h, ['naiwa', 'airi']);
    h.society.userSays('naiwa', 'what do you think?', g.id);
    expect(h.mind('naiwa').room.heard('naiwa', 0).group).toBe('Code club');
    h.mind('naiwa').say('I would profile it');
    h.mind('naiwa').say('psst', 'airi');
    h.mind('naiwa').say('hey you', 'hiyori');
    expect(h.society.transcript().slice(1).map((l) => [l.room, l.to])).toEqual([[g.id, 'all'], [g.id, 'airi'], [g.id, 'all']]);
  });

  it('keeps a reply in the big room as it was when nothing was heard in a group', () => {
    const h = harness();
    group(h, ['naiwa', 'airi']);
    h.mind('naiwa').say('hello', 'hiyori');
    expect(h.society.transcript().map((l) => [l.room, l.to])).toEqual([['main', 'hiyori']]);
  });

  it('goes back to the big room for what a pet says once it has heard nothing new', () => {
    const h = harness();
    const g = group(h, ['naiwa', 'airi']);
    h.society.userSays('naiwa', 'topic', g.id);
    const { seq } = h.mind('naiwa').room.heard('naiwa', 0);
    h.mind('naiwa').room.heard('naiwa', seq);
    h.mind('naiwa').say('la la la');
    expect(h.society.transcript().at(-1)?.room).toBe('main');
  });

  it('wakes only the other members for a pet\'s line in a group', () => {
    const h = harness();
    const g = group(h, ['naiwa', 'airi']);
    h.society.userSays('naiwa', 'topic', g.id);
    h.mind('naiwa').room.heard('naiwa', 0);
    h.mind('naiwa').say('my idea');
    expect(h.live().map((t) => t.ms)).toEqual([readingMs('my idea'.length)]);
    h.elapse();
    expect(h.mind('airi').nudges.at(-1)).toEqual(['direct', false]);
    expect(h.mind('hiyori').nudges).toEqual([]);
  });

  it('counts the chain of replies in each room apart', () => {
    const h = harness(['naiwa', 'airi']);
    const g = group(h, ['naiwa', 'airi'], 'Duo');
    h.society.userSays('all', 'talk it over', g.id);
    const reply = (id: PetId, other: PetId): void => {
      h.state.at += 5_000;
      h.mind(id).room.heard(id, 0);
      h.mind(id).say('my view', other);
    };
    for (let i = 0; i <= SOCIAL_DEPTH.normal; i++) reply(i % 2 === 0 ? 'naiwa' : 'airi', i % 2 === 0 ? 'airi' : 'naiwa');
    h.elapse();
    reply('naiwa', 'airi');
    expect(h.live()).toEqual([]);
    h.state.at += 5_000;
    h.mind('airi').room.heard('airi', 9_999);
    h.mind('airi').say('anything new?', 'naiwa');
    expect(h.live()).toHaveLength(1);
  });

  it('puts a pet\'s note in the room it was heard in', () => {
    const h = harness();
    const g = group(h, ['naiwa', 'airi']);
    h.society.userSays('naiwa', 'topic', g.id);
    h.mind('naiwa').room.heard('naiwa', 0);
    h.mind('naiwa').room.noted('naiwa', 'the user is debugging');
    expect(h.society.transcript().at(-1)).toMatchObject({ room: g.id, kind: 'note' });
  });

  it('tells a pet which groups it is in', () => {
    const h = harness();
    const g = group(h, ['naiwa', 'airi']);
    expect(h.mind('naiwa').room.groups('naiwa')).toEqual([{ name: 'Code club', members: g.members }]);
    expect(h.mind('hiyori').room.groups('hiyori')).toEqual([]);
  });

  it('changes a group\'s members, and a pet taken out of it speaks in the big room again', () => {
    const h = harness();
    const g = group(h, ['naiwa', 'airi']);
    h.society.userSays('naiwa', 'topic', g.id);
    h.mind('naiwa').room.heard('naiwa', 0);
    const changed = h.society.saveGroup({ id: g.id, name: 'Late club', members: ['airi', 'hiyori'] });
    expect(changed).toMatchObject({ id: g.id, name: 'Late club', members: ['airi', 'hiyori'] });
    expect(h.society.groups()).toHaveLength(1);
    h.mind('naiwa').say('still here?');
    expect(h.society.transcript().at(-1)?.room).toBe('main');
    expect(h.mind('naiwa').room.groups('naiwa')).toEqual([]);
  });

  it('deletes a group with what was said in it, and tells the lounge', () => {
    const h = harness();
    const g = group(h, ['naiwa', 'airi']);
    h.society.userSays('all', 'topic', g.id);
    h.society.userSays('all', 'hello everyone');
    h.mind('naiwa').room.heard('naiwa', 0);
    h.events.length = 0;
    expect(h.society.deleteGroup(g.id)).toBe(true);
    expect(h.events).toEqual([{ kind: 'roster' }]);
    expect(h.society.transcript().map((l) => l.text)).toEqual(['hello everyone']);
    expect(h.society.deleteGroup(g.id)).toBe(false);
    expect(h.society.userSays('all', 'anyone?', g.id)).toBe(false);
    h.mind('naiwa').say('hi');
    expect(h.society.transcript().at(-1)?.room).toBe('main');
  });
});
