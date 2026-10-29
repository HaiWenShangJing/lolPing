import { describe, expect, it } from 'vitest';
import type { WolfIn } from '../../../src/shared/gameIpc';
import { strings } from '../../../src/shared/i18n';
import {
  entryLines, fillSeats, lobbyChoices, phrasesOf, roleName, rolesLine, winLine, wolfAnswer, wolfAsk, wolfText,
  type GameWords, type WolfLine, type WolfWords,
} from '../../../src/shared/teammate/gameText';
import { PET_COLORS, PET_IDS, type PetId } from '../../../src/shared/teammate/pet';
import {
  noMeaning, ROLES, SEATS, WerewolfGame,
  type Answer, type Entry, type Question, type Role, type Talk, type Who, type WinReason,
} from '../../../src/shared/teammate/werewolf';

/** A seeded generator whose first values differ from one seed to the next (mulberry32). */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const LANGS: [string, GameWords][] = [
  ['en', strings('en', 'win').teammate.games],
  ['zh-CN', strings('zh-CN', 'win').teammate.games],
];

const name = (seat: number): string => `P${seat}`;
const names = (w: WolfWords, ...seats: number[]): string => w.join(seats.map(name));
const PETS: Who[] = PET_IDS.slice(0, SEATS);

/** Wolves 1-4, villagers 5-8, then the seer 9, the witch 10, the hunter 11 and the idiot 12; `user` takes a seat. */
const board = (user: number | null = null): WerewolfGame =>
  WerewolfGame.seat(ROLES.map((role, i) => ({ who: i + 1 === user ? 'user' : PETS[i], role })));

const every = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('fillSeats', () => {
  it('has pets enough for a table', () => {
    expect(PET_IDS.length).toBeGreaterThanOrEqual(SEATS);
  });

  it.each([SEATS - 1, SEATS])('seats %s different pets, the picks first and in their order', (count) => {
    const picks = [PET_IDS[7], PET_IDS[2], PET_IDS[5]] as PetId[];
    for (let seed = 1; seed <= 30; seed++) {
      const seated = fillSeats(picks, count, seeded(seed));
      expect(seated).toHaveLength(count);
      expect(new Set(seated).size).toBe(count);
      expect(seated.slice(0, picks.length)).toEqual(picks);
    }
  });

  it('seats the first picks only when there are more picks than seats', () => {
    expect(fillSeats(PET_IDS.slice(0, 5), 3, seeded(1))).toEqual(PET_IDS.slice(0, 3));
  });

  it('seats nobody when there are no seats, and everybody it can when there are many', () => {
    expect(fillSeats([PET_IDS[0] as PetId], 0, seeded(1))).toEqual([]);
    expect(new Set(fillSeats([], PET_IDS.length + 5, seeded(1)))).toEqual(new Set(PET_IDS));
  });

  it('fills the empty seats in a random order, the same for the same numbers', () => {
    const fills = (seed: number): string => fillSeats([], SEATS - 1, seeded(seed)).join();
    expect(fills(4)).toBe(fills(4));
    expect(new Set(Array.from({ length: 20 }, (_, i) => fills(i + 1))).size).toBeGreaterThan(15);
  });

  it('gives every pet a chance of a seat when there are more pets than seats', () => {
    const seen = new Set<PetId>();
    for (let seed = 1; seed <= 80; seed++) fillSeats([], SEATS - 1, seeded(seed)).forEach((id) => seen.add(id));
    expect(seen).toEqual(new Set(PET_IDS));
  });

  it('draws with the random numbers it is given: 0 and nearly 1 are both fine', () => {
    for (const luck of [0, 0.999999]) {
      const seated = fillSeats([], SEATS, () => luck);
      expect(new Set(seated).size).toBe(SEATS);
    }
  });
});

describe('lobbyChoices', () => {
  const labels = Object.fromEntries(PET_IDS.map((id) => [id, id.toUpperCase()])) as Record<PetId, string>;

  it('lists every pet as a choice, in the order of the pets, with the ones that are out marked', () => {
    const on = [PET_IDS[4], PET_IDS[0]] as PetId[];
    const choices = lobbyChoices(on, labels);
    expect(choices.map((c) => c.id)).toEqual([...PET_IDS]);
    expect(choices.filter((c) => c.on).map((c) => c.id)).toEqual([PET_IDS[0], PET_IDS[4]]);
    expect(choices.map((c) => c.name)).toEqual(PET_IDS.map((id) => labels[id]));
    expect(choices.map((c) => c.color)).toEqual(PET_IDS.map((id) => PET_COLORS[id]));
    expect(choices.every((c) => /^#[0-9a-f]{6}$/i.test(c.color))).toBe(true);
  });

  it('marks nobody when no pet is out', () => {
    expect(lobbyChoices([], labels).some((c) => c.on)).toBe(false);
    expect(lobbyChoices([...PET_IDS], labels).every((c) => c.on)).toBe(true);
  });
});

describe.each(LANGS)('the words of the werewolf page in %s', (_, g) => {
  const KEYS = [
    'title', 'start', 'again', 'mindsOn', 'mindsOff', 'rules', 'modePlay', 'modeWatch', 'pickPlay', 'pickWatch',
    'watching', 'out', 'sheriff', 'flipped', 'thinking', 'waiting', 'abstain', 'saveHim', 'poisonHint', 'noPotion',
    'noSelfSave', 'sendHint', 'send', 'pass', 'runYes', 'runNo', 'noShot', 'tearBadge', 'boomButton', 'boomSure',
    'phase_night', 'phase_sheriff', 'phase_talk', 'phase_vote', 'phase_over',
  ];

  it('has exactly the words the page reads, none of them empty', () => {
    const text = wolfText(g, SEATS - 1, SEATS);
    expect(Object.keys(text).sort()).toEqual([...KEYS].sort());
    for (const [key, value] of Object.entries(text)) expect(value, key).not.toBe('');
  });

  it('takes the lobby words from the games and the rest from the werewolf words', () => {
    const text = wolfText(g, SEATS - 1, SEATS);
    expect(text.title).toBe(g.werewolfTitle);
    expect([text.start, text.again, text.mindsOn, text.mindsOff]).toEqual([g.start, g.again, g.mindsOn, g.mindsOff]);
    expect(text.rules).toBe(g.werewolf.rules);
    expect(text.phase_night).toBe(g.werewolf.phase.night);
    expect(text.phase_sheriff).toBe(g.werewolf.phase.sheriff);
    expect(text.phase_talk).toBe(g.werewolf.phase.talk);
    expect(text.phase_vote).toBe(g.werewolf.phase.vote);
    expect(text.phase_over).toBe(g.werewolf.phase.over);
  });

  it('leaves the name of the victim to the page, and counts the pets to pick for each mode', () => {
    const text = wolfText(g, SEATS - 1, SEATS);
    expect(text.saveHim).toContain('{name}');
    expect(text.pickPlay).toContain(String(SEATS - 1));
    expect(text.pickWatch).toContain(String(SEATS));
    expect(wolfText(g, 5, 6).pickPlay).toContain('5');
    expect(wolfText(g, 5, 6).pickWatch).toContain('6');
  });
});

type Case = [title: string, entry: Entry, me: number | null, expected: (w: WolfWords) => WolfLine[]];

const sys = (text: string): WolfLine => ({ tone: 'sys', seat: null, text });
const secret = (text: string): WolfLine => ({ tone: 'secret', seat: null, text });
const vote = (text: string): WolfLine => ({ tone: 'vote', seat: null, text });
const said = (seat: number, text: string): WolfLine => ({ tone: 'say', seat, text });
const speech = (talk: Talk): Entry => ({ kind: 'say', day: 1, seat: 3, talk, text: 'hi', meaning: noMeaning() });

const ballots = [{ target: 2, voters: [1, 3], total: 2 }, { target: 5, voters: [4], total: 1 }];
const tally = (why: 'sheriff' | 'exile', round: 1 | 2, out: number | null, tied: number[]): Entry =>
  ({ kind: 'votes', day: 1, why, round, ballots, abstained: [6], out, tied });
const counted = (w: WolfWords, why: 'sheriff' | 'exile', round: number): WolfLine[] => [
  vote(w.voteHead(why, round)), vote(w.ballot('P2', names(w, 1, 3), 2)), vote(w.ballot('P5', names(w, 4), 1)),
  vote(w.abstained(names(w, 6))),
];

const CASES: Case[] = [
  ['tells a player his role and what it can do', { kind: 'start', seat: 9, role: 'seer' }, 9,
    (w) => [secret(`${w.youAre(w.role.seer)} ${w.roleHint.seer}`)]],
  ['tells a spectator nothing of the deal', { kind: 'start', seat: 9, role: 'seer' }, null, () => []],
  ['tells a wolf who his partners are, himself left out', { kind: 'wolves', seats: [1, 2, 3, 4] }, 2,
    (w) => [secret(w.wolves(names(w, 1, 3, 4)))]],
  ['tells a lone wolf nothing', { kind: 'wolves', seats: [2] }, 2, () => []],
  ['tells a spectator nothing of the pack', { kind: 'wolves', seats: [1, 2] }, null, () => []],
  ['announces the night', { kind: 'night', day: 2 }, 5, (w) => [sys(w.night(2))]],
  ['announces the night to a spectator too', { kind: 'night', day: 2 }, null, (w) => [sys(w.night(2))]],
  ['shows what a wolf wants', { kind: 'wolfPick', seat: 2, target: 6 }, 1, (w) => [secret(w.wolfPick('P2', 'P6'))]],
  ['shows what the wolves decide', { kind: 'wolfKill', target: 6 }, 1, (w) => [secret(w.wolfKill('P6'))]],
  ['tells the seer her result', { kind: 'check', seat: 9, target: 1, wolf: true }, 9,
    (w) => [secret(w.check('P1', true))]],
  ['tells the seer when it is no wolf', { kind: 'check', seat: 9, target: 5, wolf: false }, 9,
    (w) => [secret(w.check('P5', false))]],
  ['tells a spectator the check in the third person', { kind: 'check', seat: 9, target: 1, wolf: false }, null,
    (w) => [secret(w.seerCheck('P9', 'P1', false))]],
  ['tells the witch who was attacked', { kind: 'witchInfo', seat: 10, victim: 6, save: true, poison: true }, 10,
    (w) => [secret(w.witchInfo('P6'))]],
  ['tells a witch without the antidote that she is told nothing', {
    kind: 'witchInfo', seat: 10, victim: null, save: false, poison: true,
  }, 10, (w) => [secret(w.witchInfo(null))]],
  ['leaves the witch\'s information out for a spectator, who has seen the wolves', {
    kind: 'witchInfo', seat: 10, victim: 6, save: true, poison: true,
  }, null, () => []],
  ['tells the witch what she did: a save', { kind: 'witchDid', seat: 10, saved: 6, poisoned: null }, 10,
    (w) => [secret(w.witchDid('P6', null))]],
  ['tells the witch what she did: a poison', { kind: 'witchDid', seat: 10, saved: null, poisoned: 1 }, 10,
    (w) => [secret(w.witchDid(null, 'P1'))]],
  ['tells the witch what she did: nothing', { kind: 'witchDid', seat: 10, saved: null, poisoned: null }, 10,
    (w) => [secret(w.witchDid(null, null))]],
  ['tells a spectator what the witch did', { kind: 'witchDid', seat: 10, saved: 6, poisoned: null }, null,
    (w) => [secret(w.witchActs('P10', 'P6', null))]],
  ['tells a spectator of a poison', { kind: 'witchDid', seat: 10, saved: null, poisoned: 1 }, null,
    (w) => [secret(w.witchActs('P10', null, 'P1'))]],
  ['tells a spectator of a night without a potion', { kind: 'witchDid', seat: 10, saved: null, poisoned: null }, null,
    (w) => [secret(w.witchActs('P10', null, null))]],
  ['announces a night without a death', { kind: 'dawn', day: 1, died: [] }, 1, (w) => [sys(w.dawnNone)]],
  ['announces the names of the dead, and nothing more', { kind: 'dawn', day: 2, died: [2, 4] }, 1,
    (w) => [sys(w.dawn(names(w, 2, 4)))]],
  ['prints a day speech as it was said', speech('day'), 1, () => [said(3, 'hi')]],
  ['marks a campaign speech', speech('campaign'), 1, (w) => [said(3, `(${w.talk.campaign}) hi`)]],
  ['marks the second speech of a tie', speech('pk'), 1, (w) => [said(3, `(${w.talk.pk}) hi`)]],
  ['marks last words', speech('last'), null, (w) => [said(3, `(${w.talk.last}) hi`)]],
  ['names the runners for sheriff', { kind: 'runners', seats: [3, 9] }, 1, (w) => [sys(w.runners(names(w, 3, 9)))]],
  ['says when nobody runs', { kind: 'runners', seats: [] }, 1, (w) => [sys(w.noRunners)]],
  ['lists the ballots, who did not vote, and who is voted out', tally('exile', 1, 2, []), 1,
    (w) => [...counted(w, 'exile', 1), sys(w.exiled('P2'))]],
  ['names the tie instead of an exile in the first round', tally('exile', 1, null, [2, 5]), 1,
    (w) => [...counted(w, 'exile', 1), sys(w.tie(names(w, 2, 5)))]],
  ['voids a second round that is tied again', tally('exile', 2, null, [2, 5]), 1,
    (w) => [...counted(w, 'exile', 2), sys(w.noExile)]],
  ['exiles the winner of a second round', tally('exile', 2, 5, []), 1,
    (w) => [...counted(w, 'exile', 2), sys(w.exiled('P5'))]],
  ['says nothing of an exile after the sheriff vote', tally('sheriff', 1, 2, []), 1,
    (w) => counted(w, 'sheriff', 1)],
  ['names the tie of a sheriff vote', tally('sheriff', 1, null, [2, 5]), 1,
    (w) => [...counted(w, 'sheriff', 1), sys(w.tie(names(w, 2, 5)))]],
  ['says nothing of a sheriff vote tied again', tally('sheriff', 2, null, [2, 5]), 1,
    (w) => counted(w, 'sheriff', 2)],
  ['leaves the abstentions out when everybody voted', {
    kind: 'votes', day: 1, why: 'exile', round: 1, ballots, abstained: [], out: 2, tied: [],
  }, 1, (w) => [
    vote(w.voteHead('exile', 1)), vote(w.ballot('P2', names(w, 1, 3), 2)), vote(w.ballot('P5', names(w, 4), 1)),
    sys(w.exiled('P2')),
  ]],
  ['shows a vote nobody cast: the abstentions and no exile', {
    kind: 'votes', day: 1, why: 'exile', round: 1, ballots: [], abstained: [1, 2, 3], out: null, tied: [],
  }, 1, (w) => [vote(w.voteHead('exile', 1)), vote(w.abstained(names(w, 1, 2, 3))), sys(w.noExile)]],
  ['announces the sheriff', { kind: 'sheriff', seat: 9, cancelled: false }, 1, (w) => [sys(w.sheriffIs('P9'))]],
  ['says when there is no sheriff', { kind: 'sheriff', seat: null, cancelled: false }, 1, (w) => [sys(w.noSheriff)]],
  ['says when the election is cancelled', { kind: 'sheriff', seat: null, cancelled: true }, 1,
    (w) => [sys(w.sheriffOff)]],
  ['shows the badge passed on', { kind: 'badge', from: 6, to: 9 }, 1, (w) => [sys(w.badgePass('P6', 'P9'))]],
  ['shows the badge torn up', { kind: 'badge', from: 6, to: null }, 1, (w) => [sys(w.badgeTear('P6'))]],
  ['shows the idiot\'s card turned', { kind: 'flip', seat: 12 }, 1, (w) => [sys(w.flip('P12'))]],
  ['shows a self-destruct', { kind: 'boom', seat: 3 }, 1, (w) => [sys(w.boomed('P3'))]],
  ['shows the hunter\'s shot', { kind: 'shot', hunter: 11, target: 2 }, 1, (w) => [sys(w.shot('P11', 'P2'))]],
  ['ends with the village winning', { kind: 'over', winner: 'village', why: 'wolves' }, 1,
    (w) => [sys(w.winVillage)]],
  ['ends with the wolves winning over the gods', { kind: 'over', winner: 'wolves', why: 'gods' }, 1,
    (w) => [sys(w.winGods)]],
  ['ends with the wolves winning over the villagers', { kind: 'over', winner: 'wolves', why: 'villagers' }, null,
    (w) => [sys(w.winVillagers)]],
];

describe.each(LANGS)('the lines of a game in %s', (_, g) => {
  const w = g.werewolf;

  it.each(CASES)('%s', (_title, entry, me, expected) => {
    expect(entryLines(entry, w, name, me)).toEqual(expected(w));
  });

  it('has a case for every kind of entry', () => {
    const kinds = [
      'start', 'wolves', 'night', 'wolfPick', 'wolfKill', 'check', 'witchInfo', 'witchDid', 'dawn', 'say', 'runners',
      'votes', 'sheriff', 'badge', 'flip', 'boom', 'shot', 'over',
    ];
    expect([...new Set(CASES.map(([, e]) => e.kind))].sort()).toEqual([...kinds].sort());
  });

  it('shows the sheriff\'s one and a half votes as such', () => {
    const lines = entryLines({
      kind: 'votes', day: 1, why: 'exile', round: 1, ballots: [{ target: 2, voters: [1], total: 1.5 }],
      abstained: [], out: 2, tied: [],
    }, w, name, 1);
    expect(lines[1]?.text).toContain('1.5');
  });

  it('keeps the secret lines in the secret tone, and the votes in their own', () => {
    const tones = (entry: Entry): string[] => entryLines(entry, w, name, null).map((l) => l.tone);
    expect(tones({ kind: 'wolfPick', seat: 1, target: 6 })).toEqual(['secret']);
    expect(tones({ kind: 'check', seat: 9, target: 1, wolf: true })).toEqual(['secret']);
    expect(tones({ kind: 'witchDid', seat: 10, saved: null, poisoned: null })).toEqual(['secret']);
    expect(tones(tally('exile', 1, 2, []))).toEqual(['vote', 'vote', 'vote', 'vote', 'sys']);
    expect(tones(speech('day'))).toEqual(['say']);
  });

  it('winLine says why the game ended', () => {
    expect(winLine('wolves', w)).toBe(w.winVillage);
    expect(winLine('gods', w)).toBe(w.winGods);
    expect(winLine('villagers', w)).toBe(w.winVillagers);
    const lines: WinReason[] = ['wolves', 'gods', 'villagers'];
    expect(new Set(lines.map((why) => winLine(why, w))).size).toBe(3);
  });

  it('reveals every role at the end, one seat after the other', () => {
    const list = ROLES.map((role, i) => `${i + 1}. ${name(i + 1)} ${w.role[role]}`).join(' / ');
    expect(rolesLine(board(), w, name)).toBe(w.reveal(list));
    expect(rolesLine(board(), w, name).split(' / ')).toHaveLength(SEATS);
  });

  it('names a role, or none while it is not known', () => {
    expect(roleName(null, w)).toBeNull();
    const roles: Role[] = ['wolf', 'villager', 'seer', 'witch', 'hunter', 'idiot'];
    for (const role of roles) expect(roleName(role, w)).toBe(w.role[role]);
    expect(new Set(roles.map((role) => roleName(role, w))).size).toBe(roles.length);
  });
});

describe('the roles in English', () => {
  it('are named as the rules name them', () => {
    const w = strings('en', 'win').teammate.games.werewolf;
    const line = rolesLine(board(), w, name);
    expect(line).toContain('1. P1 Wolf');
    expect(line).toContain('5. P5 Villager');
    expect(line).toContain('9. P9 Seer');
    expect(line).toContain('10. P10 Witch');
    expect(line).toContain('11. P11 Hunter');
    expect(line).toContain('12. P12 Idiot');
  });
});

describe.each(LANGS)('a question put to the user in %s', (_, g) => {
  const w = g.werewolf;
  const ask = (game: WerewolfGame, seat: number, q: Question) => wolfAsk(game, seat, q, w, name);

  it('asks the wolves to pick among everybody alive, themselves and their partners too', () => {
    const game = board(2);
    game.player(6).alive = false;
    expect(ask(game, 2, { kind: 'kill' })).toEqual({
      kind: 'kill', title: w.askKill, options: every(1, SEATS).filter((s) => s !== 6), save: false, poison: false,
      victim: null,
    });
  });

  it('asks the seer to check somebody alive she has not checked, and not herself', () => {
    const game = board(9);
    expect(ask(game, 9, { kind: 'check' })).toEqual({
      kind: 'check', title: w.askCheck, options: every(1, 8).concat(every(10, 12)), save: false, poison: false,
      victim: null,
    });
    game.record([9], { kind: 'check', seat: 9, target: 1, wolf: true });
    game.player(12).alive = false;
    expect(ask(game, 9, { kind: 'check' }).options).toEqual(every(2, 8).concat([10, 11]));
  });

  it('asks the witch about the victim, with the potions she still has', () => {
    const game = board(10);
    const others = every(1, SEATS).filter((s) => s !== 10);
    expect(ask(game, 10, { kind: 'witch', victim: 6, save: true, poison: true })).toEqual({
      kind: 'witch', title: w.askWitch('P6'), options: others, save: true, poison: true, victim: 6,
    });
    expect(ask(game, 10, { kind: 'witch', victim: null, save: false, poison: true })).toEqual({
      kind: 'witch', title: w.askWitch(null), options: others, save: false, poison: true, victim: null,
    });
    expect(ask(game, 10, { kind: 'witch', victim: 6, save: true, poison: false })).toEqual({
      kind: 'witch', title: w.askWitch('P6'), options: [], save: true, poison: false, victim: 6,
    });
  });

  it('tells a witch who is the victim herself that she may not save herself, if the rules say so', () => {
    const asked = ask(board(10), 10, { kind: 'witch', victim: 10, save: false, poison: true });
    expect(asked).toMatchObject({ save: false, poison: true, victim: 10, title: w.askWitch('P10') });
  });

  it('offers no antidote without a victim, whatever the question says', () => {
    expect(ask(board(10), 10, { kind: 'witch', victim: null, save: true, poison: true }).save).toBe(false);
  });

  it('asks for a speech with the words of the talk it is', () => {
    const talks: Talk[] = ['day', 'campaign', 'pk', 'last'];
    for (const talk of talks) {
      expect(ask(board(1), 1, { kind: 'speak', talk })).toEqual({
        kind: 'speak', title: w.askSpeak[talk], options: [], save: false, poison: false, victim: null,
      });
    }
    expect(new Set(talks.map((talk) => w.askSpeak[talk])).size).toBe(talks.length);
  });

  it('asks whether to run for sheriff, with no seat to pick', () => {
    expect(ask(board(1), 1, { kind: 'run' })).toMatchObject({ kind: 'run', title: w.askRun, options: [] });
  });

  it('asks for a vote among the living others, a turned idiot who cannot be voted for left out', () => {
    const game = board(1);
    game.player(4).alive = false;
    game.player(12).flipped = true;
    expect(ask(game, 1, { kind: 'vote', why: 'exile', among: null })).toEqual({
      kind: 'vote', title: w.askVote.exile, options: [2, 3, 5, 6, 7, 8, 9, 10, 11], save: false, poison: false,
      victim: null,
    });
  });

  it('asks for a sheriff vote among the candidates', () => {
    const asked = ask(board(1), 1, { kind: 'vote', why: 'sheriff', among: [9, 10] });
    expect(asked).toMatchObject({ kind: 'vote', title: w.askVote.sheriff, options: [9, 10] });
  });

  it('asks for a second vote among those the tie left, himself, the dead and the turned idiot left out', () => {
    const game = board(1);
    game.player(4).alive = false;
    game.player(12).flipped = true;
    const asked = ask(game, 1, { kind: 'vote', why: 'exile', among: [1, 4, 5, 12, 99] });
    expect(asked).toMatchObject({ kind: 'vote', title: w.askVote.again, options: [5] });
  });

  it('asks the hunter and the sheriff for one of the living others, or none', () => {
    const game = board(11);
    game.player(2).alive = false;
    const others = every(1, SEATS).filter((s) => s !== 11 && s !== 2);
    expect(ask(game, 11, { kind: 'shoot' })).toEqual({
      kind: 'shoot', title: w.askShoot, options: others, save: false, poison: false, victim: null,
    });
    expect(ask(game, 11, { kind: 'badge' })).toEqual({
      kind: 'badge', title: w.askBadge, options: others, save: false, poison: false, victim: null,
    });
  });

  it('words each question differently', () => {
    const titles = [
      w.askKill, w.askCheck, w.askRun, w.askShoot, w.askBadge, w.askVote.exile, w.askVote.sheriff, w.askVote.again,
      w.askWitch('P6'), ...Object.values(w.askSpeak),
    ];
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('what the user\'s message answers', () => {
  const QUESTIONS: Question[] = [
    { kind: 'kill' }, { kind: 'check' }, { kind: 'witch', victim: 2, save: true, poison: true }, { kind: 'run' },
    { kind: 'speak', talk: 'day' }, { kind: 'vote', why: 'exile', among: null }, { kind: 'shoot' }, { kind: 'badge' },
  ];
  const MESSAGES: WolfIn[] = [
    { t: 'start', pets: [], play: true }, { t: 'target', seat: 3 }, { t: 'vote', seat: 3 }, { t: 'say', text: 'hi' },
    { t: 'witch', save: true, poison: 4 }, { t: 'run', run: true }, { t: 'pick', seat: 5 }, { t: 'boom' },
    { t: 'again' },
  ];
  const FITS: Record<Question['kind'], WolfIn['t'][]> = {
    kill: ['target'], check: ['target'], witch: ['witch'], run: ['run'], speak: ['say'], vote: ['vote'],
    shoot: ['pick'], badge: ['pick'],
  };

  it('is an answer only to the question it fits, and nothing else is an answer at all', () => {
    for (const q of QUESTIONS) {
      for (const m of MESSAGES) {
        expect(wolfAnswer(q, m) !== null, `${q.kind} / ${m.t}`).toBe(FITS[q.kind].includes(m.t));
      }
    }
  });

  it('turns each message into the answer the rules read', () => {
    const answer = (q: Question, m: WolfIn): Answer | null => wolfAnswer(q, m);
    expect(answer({ kind: 'kill' }, { t: 'target', seat: 3 })).toEqual({ kind: 'target', seat: 3 });
    expect(answer({ kind: 'check' }, { t: 'target', seat: 2 })).toEqual({ kind: 'target', seat: 2 });
    expect(answer({ kind: 'vote', why: 'exile', among: null }, { t: 'vote', seat: null })).toEqual({
      kind: 'vote', seat: null,
    });
    expect(answer({ kind: 'vote', why: 'sheriff', among: [3] }, { t: 'vote', seat: 3 })).toEqual({
      kind: 'vote', seat: 3,
    });
    expect(answer({ kind: 'speak', talk: 'last' }, { t: 'say', text: 'bye' })).toEqual({ kind: 'text', text: 'bye' });
    expect(answer({ kind: 'speak', talk: 'day' }, { t: 'say', text: '' })).toEqual({ kind: 'text', text: '' });
    const witch: Question = { kind: 'witch', victim: 2, save: true, poison: true };
    expect(answer(witch, { t: 'witch', save: false, poison: 4 })).toEqual({ kind: 'witch', save: false, poison: 4 });
    expect(answer(witch, { t: 'witch', save: true, poison: null })).toEqual({
      kind: 'witch', save: true, poison: null,
    });
    expect(answer({ kind: 'run' }, { t: 'run', run: false })).toEqual({ kind: 'run', run: false });
    expect(answer({ kind: 'shoot' }, { t: 'pick', seat: 5 })).toEqual({ kind: 'pick', seat: 5 });
    expect(answer({ kind: 'shoot' }, { t: 'pick', seat: null })).toEqual({ kind: 'pick', seat: null });
    expect(answer({ kind: 'badge' }, { t: 'pick', seat: null })).toEqual({ kind: 'pick', seat: null });
  });

  it('never takes a self-destruct or a restart for an answer', () => {
    for (const q of QUESTIONS) {
      expect(wolfAnswer(q, { t: 'boom' })).toBeNull();
      expect(wolfAnswer(q, { t: 'again' })).toBeNull();
    }
  });
});

describe.each(LANGS)('the stock words of a computer player in %s', (_, g) => {
  const w = g.werewolf;
  const lines = [0, 0.25, 0.5, 0.75, 0.999999];

  it('speaks with the lines of the language, whatever the numbers', () => {
    for (const luck of lines) {
      const p = phrasesOf(w, () => luck);
      expect(w.accuse('Mao')).toContain(p.accuse('Mao'));
      expect(w.trust('Mao')).toContain(p.trust('Mao'));
      expect(w.innocent).toContain(p.innocent());
      expect(w.quiet).toContain(p.quiet());
      expect(w.defend).toContain(p.defend());
      expect(w.campaign).toContain(p.campaign());
      expect(w.claimHunter).toContain(p.claimHunter());
      expect(w.claimIdiot).toContain(p.claimIdiot());
      expect(w.claimWitch(null)).toContain(p.claimWitch(null));
      expect(w.claimWitch('Mao')).toContain(p.claimWitch('Mao'));
      expect(w.last(null)).toContain(p.last(null));
      expect(w.last('Mao')).toContain(p.last('Mao'));
    }
  });

  it('names the player it speaks of', () => {
    const p = phrasesOf(w, seeded(2));
    expect(p.accuse('Mao')).toContain('Mao');
    expect(p.trust('Rice')).toContain('Rice');
    expect(p.claimWitch('Haru')).toContain('Haru');
    expect(p.last('Senko')).toContain('Senko');
  });

  it('reports the seer\'s checks, each as the words of the language have it', () => {
    const p = phrasesOf(w, seeded(2));
    const said = p.claimSeer([{ name: 'Mao', wolf: true }, { name: 'Rice', wolf: false }]);
    const found = w.join([w.checkWolf('Mao'), w.checkGood('Rice')]);
    expect(w.claimSeer(found)).toContain(said);
    expect(said).toContain(w.checkWolf('Mao'));
    expect(said).toContain(w.checkGood('Rice'));
  });

  it('picks the first line for 0 and the last for nearly 1, and varies with the numbers', () => {
    expect(phrasesOf(w, () => 0).quiet()).toBe(w.quiet[0]);
    expect(phrasesOf(w, () => 0.999999).quiet()).toBe(w.quiet.at(-1));
    expect(phrasesOf(w, () => 1).quiet()).toBe(w.quiet.at(-1));
    const seen = new Set(Array.from({ length: 30 }, (_x, i) => phrasesOf(w, seeded(i + 1)).quiet()));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('joins what it has to say into one speech with the language\'s own sentences', () => {
    const p = phrasesOf(w, seeded(1));
    expect(p.join(['One.', 'Two.'])).toBe(w.sentences(['One.', 'Two.']));
    expect(p.join([])).toBe(w.sentences([]));
  });
});
