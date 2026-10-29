import { describe, expect, it } from 'vitest';
import { PET_IDS, type PetId } from '../../../src/shared/teammate/pet';
import {
  CHIME, HEARD_MAX, QUIET_MS, ROOM_MAX, SOCIAL_DEPTH, SOCIAL_HOURLY, WAKES_PER_PET_LINE, contextRoom, depthAfter, heardBy, heardLine,
  isForMe, planWakes, pushLine, readingMs, wakeBudget, type RoomLine,
} from '../../../src/shared/teammate/petSociety';

const names: Record<PetId, string> = {
  whale: 'Whale', naiwa: 'Naiwa', shenshen: 'Shenshen', airi: 'Airi', hiyori: 'Hiyori', haru: 'Haru', mao: 'Mao', rice: 'Rice',
  senko: 'Senko', mark: 'Mark',
};
const line = (seq: number, over: Partial<RoomLine> = {}): RoomLine => ({
  seq, room: 'main', from: 'airi', to: null, text: `line ${seq}`, at: 0, kind: 'say', ...over,
});
const MAIN = ['main'];

describe('who a line is for', () => {
  it('is for the pet it names, and for everyone', () => {
    expect(isForMe(line(1, { to: 'naiwa' }), 'naiwa')).toBe(true);
    expect(isForMe(line(1, { to: 'all' }), 'naiwa')).toBe(true);
    expect(isForMe(line(1, { to: 'hiyori' }), 'naiwa')).toBe(false);
    expect(isForMe(line(1, { to: null }), 'naiwa')).toBe(false);
  });
});

describe('what a pet hears', () => {
  it('hears what others said since it last listened, never its own words or notes', () => {
    const lines = [
      line(1, { from: 'airi' }), line(2, { from: 'naiwa' }), line(3, { from: 'hiyori', kind: 'note', to: null }),
      line(4, { from: 'user', to: 'naiwa' }), line(5, { from: 'hiyori' }),
    ];
    expect(heardBy(lines, 'naiwa', 0, MAIN).map((l) => l.seq)).toEqual([1, 4, 5]);
    expect(heardBy(lines, 'naiwa', 4, MAIN).map((l) => l.seq)).toEqual([5]);
    expect(heardBy(lines, 'naiwa', 5, MAIN)).toEqual([]);
  });

  it('is told only the newest few of a long stretch', () => {
    const lines = Array.from({ length: HEARD_MAX + 5 }, (_, i) => line(i + 1));
    const heard = heardBy(lines, 'naiwa', 0, MAIN);
    expect(heard).toHaveLength(HEARD_MAX);
    expect(heard.at(-1)?.seq).toBe(HEARD_MAX + 5);
  });

  it('hears a group only when it is in it', () => {
    const lines = [line(1), line(2, { room: 'g1' }), line(3, { room: 'g2' })];
    expect(heardBy(lines, 'naiwa', 0, MAIN).map((l) => l.seq)).toEqual([1]);
    expect(heardBy(lines, 'naiwa', 0, ['main', 'g1']).map((l) => l.seq)).toEqual([1, 2]);
    expect(heardBy(lines, 'naiwa', 0, ['g2']).map((l) => l.seq)).toEqual([3]);
  });

  it('keeps the room to its limit, dropping the oldest', () => {
    let lines: RoomLine[] = [];
    for (let i = 1; i <= ROOM_MAX + 3; i++) lines = pushLine(lines, line(i));
    expect(lines).toHaveLength(ROOM_MAX);
    expect(lines[0].seq).toBe(4);
    expect(lines.at(-1)?.seq).toBe(ROOM_MAX + 3);
  });

  it('keeps the limit for each room, so a busy one does not push out another', () => {
    let lines: RoomLine[] = [line(1, { room: 'g1' })];
    for (let i = 2; i <= ROOM_MAX + 3; i++) lines = pushLine(lines, line(i));
    expect(lines.filter((l) => l.room === 'main')).toHaveLength(ROOM_MAX);
    expect(lines.filter((l) => l.room === 'g1').map((l) => l.seq)).toEqual([1]);
  });
});

describe('where a reply goes', () => {
  it('is the room of the last line said to the pet', () => {
    const lines = [line(1, { room: 'g1', to: 'naiwa' }), line(2, { room: 'main', to: 'hiyori' })];
    expect(contextRoom(lines, 'naiwa')).toBe('g1');
  });

  it('is the room of the last line it heard when none was for it', () => {
    const lines = [line(1, { room: 'main' }), line(2, { room: 'g2' })];
    expect(contextRoom(lines, 'naiwa')).toBe('g2');
  });

  it('is the big room when it heard nothing', () => {
    expect(contextRoom([], 'naiwa')).toBe('main');
  });
});

describe('heardLine', () => {
  it('names the speaker, who it was meant for, and quotes the words', () => {
    expect(heardLine(line(1, { from: 'airi', to: 'naiwa', text: 'hi "you"' }), 'naiwa', names)).toBe('Airi (to you): "hi \\"you\\""');
    expect(heardLine(line(1, { from: 'user', to: 'all', text: 'hello' }), 'naiwa', names)).toBe('The user (to everyone): "hello"');
    expect(heardLine(line(1, { from: 'airi', to: 'hiyori', text: 'psst' }), 'naiwa', names)).toBe('Airi (to Hiyori): "psst"');
    expect(heardLine(line(1, { from: 'airi', to: null, text: 'yawn' }), 'naiwa', names)).toBe('Airi: "yawn"');
  });

  it('says which group a line was said in', () => {
    expect(heardLine(line(1, { from: 'user', to: 'all', text: 'ideas?' }), 'naiwa', names, 'Code club'))
      .toBe('The user [in the group "Code club"] (to everyone): "ideas?"');
  });
});

describe('the chain of replies', () => {
  it('starts over when the user speaks or things have been quiet', () => {
    expect(depthAfter(5, 'user', 0, true)).toBe(0);
    expect(depthAfter(5, 'airi', QUIET_MS, true)).toBe(0);
    expect(depthAfter(5, 'airi', QUIET_MS - 1, true)).toBe(6);
  });

  it('goes deeper only when the line woke somebody', () => {
    expect(depthAfter(2, 'airi', 1000, false)).toBe(2);
    expect(depthAfter(2, 'airi', 1000, true)).toBe(3);
  });

  it('is allowed deeper the livelier the pets are', () => {
    expect(SOCIAL_DEPTH.calm).toBeLessThan(SOCIAL_DEPTH.normal);
    expect(SOCIAL_DEPTH.normal).toBeLessThan(SOCIAL_DEPTH.lively);
    expect(SOCIAL_HOURLY.calm).toBeLessThan(SOCIAL_HOURLY.lively);
  });
});

describe('the hour\'s budget', () => {
  it('counts the wake-ups of the last hour only', () => {
    const now = 10_000_000;
    const r = wakeBudget([now - 3_700_000, now - 1000, now - 2000], now, 5);
    expect(r.stamps).toEqual([now - 1000, now - 2000]);
    expect(r.left).toBe(3);
  });

  it('is never below nothing', () => {
    expect(wakeBudget([1, 2, 3], 4, 2).left).toBe(0);
  });
});

describe('planWakes', () => {
  const base = {
    from: 'airi' as const, to: 'naiwa' as const, textLength: 40, shown: ['airi', 'naiwa', 'hiyori'] as PetId[], depth: 0,
    social: true, activity: 'normal' as const, userAway: false, budgetLeft: 50, random: () => 0.99,
  };

  it('wakes the pet a pet spoke to, after a pause to read, and not the speaker', () => {
    expect(planWakes(base)).toEqual([{ pet: 'naiwa', delayMs: readingMs(40), direct: true }]);
  });

  it('wakes everyone but the speaker for a line to all, one after another', () => {
    const plans = planWakes({ ...base, to: 'all' });
    expect(plans.map((p) => p.pet)).toEqual(['naiwa', 'hiyori']);
    expect(plans.every((p) => p.direct)).toBe(true);
    expect(plans[1].delayMs).toBeGreaterThan(plans[0].delayMs);
  });

  it('wakes the pet the user spoke to at once, and the others only by chance', () => {
    const user = { ...base, from: 'user' as const, to: 'naiwa' as const };
    expect(planWakes(user)).toEqual([{ pet: 'naiwa', delayMs: 0, direct: true }]);
    const chimed = planWakes({ ...user, random: () => 0 });
    expect(chimed.map((p) => [p.pet, p.direct])).toEqual([['naiwa', true], ['airi', false], ['hiyori', false]]);
    expect(chimed[1].delayMs).toBeGreaterThan(0);
  });

  it('lets a pet join in on a line meant for another by a chance that grows with liveliness', () => {
    const near = CHIME.normal.pet;
    expect(planWakes({ ...base, random: () => near - 0.01 }).map((p) => p.pet)).toEqual(['naiwa', 'hiyori']);
    expect(planWakes({ ...base, random: () => near + 0.01 }).map((p) => p.pet)).toEqual(['naiwa']);
    expect(CHIME.lively.pet).toBeGreaterThan(CHIME.calm.pet);
    expect(CHIME.lively.user).toBeGreaterThan(CHIME.calm.user);
  });

  it('wakes nobody for a pet\'s line while pets may not talk, the user is away, the chain is too deep or the budget is spent', () => {
    expect(planWakes({ ...base, social: false })).toEqual([]);
    expect(planWakes({ ...base, userAway: true })).toEqual([]);
    expect(planWakes({ ...base, depth: SOCIAL_DEPTH.normal })).toEqual([]);
    expect(planWakes({ ...base, depth: SOCIAL_DEPTH.normal - 1 })).toHaveLength(1);
    expect(planWakes({ ...base, budgetLeft: 0 })).toEqual([]);
  });

  it('still answers the user in all of those cases', () => {
    const user = { ...base, from: 'user' as const, social: false, userAway: true, depth: 99, budgetLeft: 0 };
    expect(planWakes(user)).toEqual([{ pet: 'naiwa', delayMs: 0, direct: true }]);
  });

  it('wakes nobody when there is nobody else to hear', () => {
    expect(planWakes({ ...base, shown: ['airi'] })).toEqual([]);
    expect(planWakes({ ...base, from: 'user', to: 'all', shown: [] })).toEqual([]);
  });

  it('wakes only a few pets for one line of a pet, and no more than the budget leaves', () => {
    const all: PetId[] = [...PET_IDS];
    const crowd = planWakes({ ...base, from: 'whale', to: 'all', shown: all });
    expect(crowd).toHaveLength(WAKES_PER_PET_LINE);
    expect(planWakes({ ...base, from: 'whale', to: 'all', shown: all, budgetLeft: 1 })).toHaveLength(1);
    const user = planWakes({ ...base, from: 'user', to: 'all', shown: all });
    expect(user).toHaveLength(all.length);
  });

  it('reads at about the pace of the line, within limits', () => {
    expect(readingMs(0)).toBe(1_500);
    expect(readingMs(60)).toBe(3_000);
    expect(readingMs(10_000)).toBe(5_000);
  });
});
