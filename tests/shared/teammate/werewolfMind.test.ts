import { describe, expect, it } from 'vitest';
import { PET_IDS } from '../../../src/shared/teammate/pet';
import {
  ROLES, SAY_MAX, SEATS, WerewolfGame, type Entry, type Question, type Role, type Who,
} from '../../../src/shared/teammate/werewolf';
import {
  MIND_BUDGET, describeEntry, introPrompt, jsonOf, makeAi, parseAnswer, questionText, type Names,
} from '../../../src/shared/teammate/werewolfMind';

const PETS: Who[] = PET_IDS.slice(0, SEATS);
/** Wolves 1-4, villagers 5-8, then the seer 9, the witch 10, the hunter 11 and the idiot 12. */
const board = (roles: readonly Role[] = ROLES): WerewolfGame =>
  WerewolfGame.seat(roles.map((role, i) => ({ who: PETS[i] as Who, role })));
const names: Names = (seat) => `Pet${seat}`;
const night = (): WerewolfGame => {
  const g = board();
  g.startNight();
  return g;
};
const out = (g: WerewolfGame, ...seats: number[]): void => {
  for (const s of seats) g.die(s, 'wolves');
  g.deaths.length = 0;
};
const speak: Question = { kind: 'speak', talk: 'day' };

describe('jsonOf', () => {
  it('reads a bare object, one in a code fence and one among words', () => {
    expect(jsonOf('{"target": 5}')).toEqual({ target: 5 });
    expect(jsonOf('```json\n{"target": 5}\n```')).toEqual({ target: 5 });
    expect(jsonOf('Sure! Here you go: {"say": "hi", "suspect": null} Hope that helps.'))
      .toEqual({ say: 'hi', suspect: null });
  });

  it('is not fooled by braces and quotes inside a string', () => {
    expect(jsonOf('{"say": "a } b { c", "suspect": 3}')).toEqual({ say: 'a } b { c', suspect: 3 });
    expect(jsonOf('{"say": "he said \\"hi\\" }"}')).toEqual({ say: 'he said "hi" }' });
  });

  it('reads a nested object whole, and takes the first of several', () => {
    expect(jsonOf('{"checks": [{"seat": 3, "wolf": true}], "say": "x"}'))
      .toEqual({ checks: [{ seat: 3, wolf: true }], say: 'x' });
    expect(jsonOf('{"a": 1} and {"b": 2}')).toEqual({ a: 1 });
    expect(jsonOf('[{"a": 1}]')).toEqual({ a: 1 });
  });

  it('skips braces that are not an object and finds the next one', () => {
    expect(jsonOf('{not json} {"ok": true}')).toEqual({ ok: true });
    expect(jsonOf('use {braces} like {"seat": 4}')).toEqual({ seat: 4 });
  });

  it('finds nothing without an object: in empty text, an array, a number or an object left open', () => {
    for (const text of ['', 'no idea', '[1, 2]', '{"a": 1', '}{', '"{"', 'null', '42']) {
      expect(jsonOf(text), text).toBeNull();
    }
  });

  it('looks only at the first 4000 characters', () => {
    expect(jsonOf(`${'x'.repeat(3980)}{"a": 1}`)).toEqual({ a: 1 });
    expect(jsonOf(`${'x'.repeat(4001)}{"a": 1}`)).toBeNull();
  });
});

describe('parseAnswer: the target of a night action', () => {
  it('reads a seat as a number, a string or a #seat, under any key a mind may use', () => {
    const g = night();
    const q: Question = { kind: 'kill' };
    const texts = [
      '{"target": 5}', '{"seat": "5"}', '{"to": "#5"}', '{"target": " 5 "}', 'Kill 5', '5', '#5',
      '```json\n{"target": 5}\n```',
    ];
    for (const text of texts) expect(parseAnswer(g, 1, q, text), text).toEqual({ kind: 'target', seat: 5 });
  });

  it('lets a wolf name itself or a partner, as the rules do', () => {
    const g = night();
    expect(parseAnswer(g, 1, { kind: 'kill' }, '{"target": 1}')).toEqual({ kind: 'target', seat: 1 });
    expect(parseAnswer(g, 1, { kind: 'kill' }, '{"target": 2}')).toEqual({ kind: 'target', seat: 2 });
  });

  it('drops a seat that is not a legal target, and anything that is not a seat', () => {
    const g = night();
    out(g, 6);
    const bad = [
      '{"target": 6}', '{"target": 0}', '{"target": 13}', '{"target": 5.5}', '{"target": -2}', '{"target": null}',
      '{"target": "five"}', '{"target": [5]}', '{}', 'no idea', '', 'seats 3 and 4', '123',
    ];
    for (const text of bad) expect(parseAnswer(g, 1, { kind: 'kill' }, text), text).toBeNull();
  });

  it('lets the seer check only a player she has not checked, and not herself', () => {
    const g = night();
    g.record([9], { kind: 'check', seat: 9, target: 3, wolf: true });
    const q: Question = { kind: 'check' };
    expect(parseAnswer(g, 9, q, '{"target": 4}')).toEqual({ kind: 'target', seat: 4 });
    expect(parseAnswer(g, 9, q, '{"target": 3}')).toBeNull();
    expect(parseAnswer(g, 9, q, '{"target": 9}')).toBeNull();
  });
});

describe('parseAnswer: the witch', () => {
  it('reads her choice: nothing, the antidote or a poison', () => {
    const g = night();
    const q = g.witchQuestion(6);
    expect(parseAnswer(g, 10, q, '{"save": true, "poison": null}'))
      .toEqual({ kind: 'witch', save: true, poison: null });
    expect(parseAnswer(g, 10, q, '{"save": false, "poison": 3}')).toEqual({ kind: 'witch', save: false, poison: 3 });
    expect(parseAnswer(g, 10, q, '{"save": false, "poison": "#3"}'))
      .toEqual({ kind: 'witch', save: false, poison: 3 });
    const nothing = ['{"save": false}', '{"save": false, "poison": null}', '{"poison": null}',
      '{"save": null, "poison": false}'];
    for (const text of nothing) {
      expect(parseAnswer(g, 10, q, text), text).toEqual({ kind: 'witch', save: false, poison: null });
    }
  });

  it('uses at most one potion a night: the antidote wins over a poison', () => {
    const g = night();
    expect(parseAnswer(g, 10, g.witchQuestion(6), '{"save": true, "poison": 3}'))
      .toEqual({ kind: 'witch', save: true, poison: null });
  });

  it('drops a save she may not make: not on her own death after the first night, not without the antidote', () => {
    const g = night();
    expect(parseAnswer(g, 10, g.witchQuestion(10), '{"save": true}'))
      .toEqual({ kind: 'witch', save: true, poison: null });
    g.startNight();
    const later = g.witchQuestion(10);
    expect(later.save).toBe(false);
    expect(parseAnswer(g, 10, later, '{"save": true}')).toBeNull();
    expect(parseAnswer(g, 10, later, '{"save": false, "poison": 3}'))
      .toEqual({ kind: 'witch', save: false, poison: 3 });
    g.antidote = false;
    expect(parseAnswer(g, 10, g.witchQuestion(6), '{"save": true}')).toBeNull();
  });

  it('drops a poison she has not got, and a target she may not poison', () => {
    const g = night();
    out(g, 7);
    const q = g.witchQuestion(6);
    for (const poison of ['10', '7', '13', '0', '"x"', '2.5', '[3]', 'true']) {
      expect(parseAnswer(g, 10, q, `{"save": false, "poison": ${poison}}`), poison).toBeNull();
    }
    g.poison = false;
    const spent = g.witchQuestion(6);
    expect(parseAnswer(g, 10, spent, '{"save": false, "poison": 3}')).toBeNull();
    expect(parseAnswer(g, 10, spent, '{"save": true}')).toEqual({ kind: 'witch', save: true, poison: null });
    expect(parseAnswer(g, 10, spent, '{"save": false, "poison": null}'))
      .toEqual({ kind: 'witch', save: false, poison: null });
  });

  it('drops a reply that does not say what she does', () => {
    const g = night();
    const q = g.witchQuestion(6);
    for (const text of ['', 'no idea', '{}', '{"target": 3}', '{"save": "yes"}', '{"save": 1}', '{"save": "true"}']) {
      expect(parseAnswer(g, 10, q, text), text).toBeNull();
    }
  });
});

describe('parseAnswer: a shot and a badge', () => {
  it('reads a living target, or null for no shot and for tearing the badge up', () => {
    const g = night();
    out(g, 6);
    const qs: Question[] = [{ kind: 'shoot' }, { kind: 'badge' }];
    for (const q of qs) {
      expect(parseAnswer(g, 11, q, '{"target": 3}')).toEqual({ kind: 'pick', seat: 3 });
      expect(parseAnswer(g, 11, q, '{"target": null}')).toEqual({ kind: 'pick', seat: null });
      expect(parseAnswer(g, 11, q, '3')).toEqual({ kind: 'pick', seat: 3 });
      for (const bad of ['{"target": 6}', '{"target": 11}', '{"target": 99}', 'nobody', '']) {
        expect(parseAnswer(g, 11, q, bad), bad).toBeNull();
      }
    }
  });
});

describe('parseAnswer: a speech', () => {
  it('reads what the player says and whom it suspects', () => {
    const g = night();
    const a = parseAnswer(g, 5, speak, '{"say": "  I think\\n 3 is   a wolf. ", "suspect": 3}');
    expect(a).toEqual({
      kind: 'text', text: 'I think 3 is a wolf.', meaning: { suspect: 3, claim: null, checks: [], saved: null },
    });
    expect(parseAnswer(g, 5, speak, '{"say": "x", "suspect": "#4"}')).toMatchObject({ meaning: { suspect: 4 } });
    expect(parseAnswer(g, 5, speak, '{"say": "x", "suspect": "nobody"}'))
      .toMatchObject({ meaning: { suspect: null } });
  });

  it('takes other keys for the words, and a plain reply as the words themselves', () => {
    const g = night();
    expect(parseAnswer(g, 5, speak, '{"text": "Hello"}')).toMatchObject({ kind: 'text', text: 'Hello' });
    expect(parseAnswer(g, 5, speak, '{"speech": "Hi"}')).toMatchObject({ kind: 'text', text: 'Hi' });
    expect(parseAnswer(g, 5, speak, '"I am a villager."')).toEqual({ kind: 'text', text: 'I am a villager.' });
    expect(parseAnswer(g, 5, speak, 'I am a villager.')).toEqual({ kind: 'text', text: 'I am a villager.' });
  });

  it('drops an empty reply, and a JSON reply without words', () => {
    const g = night();
    for (const text of ['', '   ', '""', '{}', '{"suspect": 3}', '{"say": ""}', '{"say": 5}']) {
      expect(parseAnswer(g, 5, speak, text), text).toBeNull();
    }
  });

  it('cuts a long speech', () => {
    const g = night();
    const a = parseAnswer(g, 5, speak, `{"say": "${'a'.repeat(500)}"}`);
    expect(a?.kind === 'text' && a.text.length).toBe(SAY_MAX);
  });

  it('reads a claim and the results the player says it has, and only the roles that can be claimed', () => {
    const g = night();
    const reply = JSON.stringify({
      say: 'I am the seer.', suspect: '#5', claim: 'seer',
      checks: [{ seat: 3, wolf: true }, { seat: '#4', wolf: false }, { seat: 5 }, { seat: 6, wolf: 'yes' }, 'x', null],
    });
    expect(parseAnswer(g, 1, speak, reply)).toMatchObject({
      kind: 'text',
      meaning: { suspect: 5, claim: 'seer', checks: [{ seat: 3, wolf: true }, { seat: 4, wolf: false }] },
    });
    for (const claim of ['wolf', 'villager', 'king', 5, null]) {
      const a = parseAnswer(g, 1, speak, JSON.stringify({ say: 'x', claim }));
      expect(a, String(claim)).toMatchObject({ meaning: { claim: null } });
    }
  });

  it('has a real seer report what she really found, whatever her mind says; a wolf\'s report stands as said', () => {
    const g = night();
    g.record([9], { kind: 'check', seat: 9, target: 2, wolf: true });
    g.record([9], { kind: 'check', seat: 9, target: 6, wolf: false });
    const reply = JSON.stringify({ say: 'Seer here.', claim: 'seer', checks: [{ seat: 7, wolf: true }] });
    expect(parseAnswer(g, 9, speak, reply)).toMatchObject({
      meaning: { claim: 'seer', checks: [{ seat: 2, wolf: true }, { seat: 6, wolf: false }] },
    });
    expect(parseAnswer(g, 1, speak, reply)).toMatchObject({
      meaning: { claim: 'seer', checks: [{ seat: 7, wolf: true }] },
    });
  });

  it('has a real witch report whom she really saved, and none if she saved none', () => {
    const g = night();
    g.record([10], { kind: 'witchDid', seat: 10, saved: 6, poisoned: null });
    const reply = JSON.stringify({ say: 'Witch here.', claim: 'witch', saved: 4 });
    expect(parseAnswer(g, 10, speak, reply)).toMatchObject({ meaning: { claim: 'witch', saved: 6 } });
    expect(parseAnswer(g, 5, speak, reply)).toMatchObject({ meaning: { claim: 'witch', saved: 4 } });
    expect(parseAnswer(night(), 10, speak, reply)).toMatchObject({ meaning: { claim: 'witch', saved: null } });
  });

  it('never reads the run for sheriff or a vote from a reply: those are not put to a mind', () => {
    const g = night();
    expect(parseAnswer(g, 5, { kind: 'run' }, '{"run": true}')).toBeNull();
    expect(parseAnswer(g, 5, { kind: 'vote', why: 'exile', among: null }, '{"target": 3}')).toBeNull();
  });
});

describe('describeEntry', () => {
  const d = (e: Entry): string | null => describeEntry(e, names);
  const say = (talk: 'day' | 'campaign' | 'pk' | 'last'): Entry => ({
    kind: 'say', day: 1, seat: 5, talk, text: 'Hello.',
    meaning: { suspect: null, claim: null, checks: [], saved: null },
  });

  it('says nothing of what a seat is told some other way', () => {
    expect(d({ kind: 'start', seat: 1, role: 'wolf' })).toBeNull();
    expect(d({ kind: 'wolves', seats: [1, 2] })).toBeNull();
    expect(d({ kind: 'witchInfo', seat: 10, victim: 6, save: true, poison: true })).toBeNull();
  });

  it('puts the night into lines for the seat that may read them', () => {
    expect(d({ kind: 'night', day: 2 })).toBe('Night 2 falls.');
    expect(d({ kind: 'wolfPick', seat: 2, target: 6 })).toBe('Your partner #2 Pet2 would kill #6 Pet6.');
    expect(d({ kind: 'wolfKill', target: 6 })).toBe('Your pack kills #6 Pet6 tonight.');
    expect(d({ kind: 'check', seat: 9, target: 3, wolf: true })).toBe('Your check: #3 Pet3 is a wolf.');
    expect(d({ kind: 'check', seat: 9, target: 3, wolf: false })).toBe('Your check: #3 Pet3 is not a wolf.');
    expect(d({ kind: 'witchDid', seat: 10, saved: 6, poisoned: null })).toBe('You used the antidote on #6 Pet6.');
    expect(d({ kind: 'witchDid', seat: 10, saved: null, poisoned: 3 })).toBe('You poisoned #3 Pet3.');
    expect(d({ kind: 'witchDid', seat: 10, saved: null, poisoned: null })).toBe('You used no potion.');
  });

  it('tells the dawn, with the names of who died and no roles', () => {
    expect(d({ kind: 'dawn', day: 2, died: [] })).toBe('Day 2 dawns. Nobody died in the night.');
    expect(d({ kind: 'dawn', day: 2, died: [3, 6] })).toBe('Day 2 dawns. Died in the night: #3 Pet3, #6 Pet6.');
  });

  it('gives a speech with who spoke and what kind of speech it was', () => {
    expect(d(say('day'))).toBe('#5 Pet5: Hello.');
    expect(d(say('campaign'))).toBe('#5 Pet5 (sheriff campaign): Hello.');
    expect(d(say('pk'))).toBe('#5 Pet5 (tie, second round): Hello.');
    expect(d(say('last'))).toBe('#5 Pet5 (last words): Hello.');
  });

  it('gives the sheriff election: who runs, how the vote went, who won', () => {
    expect(d({ kind: 'runners', seats: [3, 4] })).toBe('Running for sheriff: #3 Pet3, #4 Pet4.');
    expect(d({ kind: 'runners', seats: [] })).toBe('Nobody runs for sheriff.');
    expect(d({ kind: 'sheriff', seat: 7, cancelled: false })).toBe('#7 Pet7 is the sheriff.');
    expect(d({ kind: 'sheriff', seat: null, cancelled: false })).toBe('Nobody becomes sheriff.');
    expect(d({ kind: 'sheriff', seat: null, cancelled: true }))
      .toBe('A wolf blew up: the sheriff election is called off, and nobody is sheriff.');
    expect(d({
      kind: 'votes', day: 1, why: 'sheriff', round: 1, ballots: [{ target: 3, voters: [5, 6], total: 2 }],
      abstained: [], out: 3, tied: [],
    })).toBe('Sheriff vote: #3 Pet3 got 2 from #5 #6. #3 Pet3 wins the badge.');
  });

  it('gives an exile vote: the ballots, who held back, a tie or the player voted out', () => {
    expect(d({
      kind: 'votes', day: 2, why: 'exile', round: 1, abstained: [8], out: 3, tied: [],
      ballots: [{ target: 3, voters: [5, 6], total: 2 }, { target: 4, voters: [7], total: 1 }],
    })).toBe('Exile vote: #3 Pet3 got 2 from #5 #6; #4 Pet4 got 1 from #7. Abstained: #8. #3 Pet3 is voted out.');
    expect(d({
      kind: 'votes', day: 2, why: 'exile', round: 2, abstained: [], out: null, tied: [3, 4],
      ballots: [{ target: 3, voters: [5], total: 1 }, { target: 4, voters: [6], total: 1 }],
    })).toBe(
      'Exile vote, second round: #3 Pet3 got 1 from #5; #4 Pet4 got 1 from #6. A tie between #3 Pet3, #4 Pet4.',
    );
    expect(d({ kind: 'votes', day: 2, why: 'exile', round: 1, abstained: [], out: null, tied: [], ballots: [] }))
      .toBe('Exile vote: no votes. No result.');
  });

  it('gives the badge, the flipped idiot, the self-destruct, the shot and the end', () => {
    expect(d({ kind: 'badge', from: 7, to: 8 })).toBe('#7 Pet7 hands the sheriff\'s badge to #8 Pet8.');
    expect(d({ kind: 'badge', from: 7, to: null }))
      .toBe('#7 Pet7 tears up the sheriff\'s badge: nobody is sheriff now.');
    expect(d({ kind: 'flip', seat: 12 }))
      .toBe('#12 Pet12 turns his card: the idiot. He stays alive but cannot vote any more.');
    expect(d({ kind: 'boom', seat: 2 })).toBe('#2 Pet2 self-destructs: a wolf, dead at once. The day is over.');
    expect(d({ kind: 'shot', hunter: 11, target: 3 })).toBe('The hunter #11 Pet11 shoots #3 Pet3.');
    expect(d({ kind: 'over', winner: 'wolves', why: 'gods' })).toBe('The game is over: the wolves win.');
    expect(d({ kind: 'over', winner: 'village', why: 'wolves' })).toBe('The game is over: the village win.');
  });
});

describe('what a mind is told', () => {
  const persona = 'Cheerful and a little clumsy.';
  const intro = (g: WerewolfGame, seat: number, language = 'English'): string =>
    introPrompt(g, seat, { name: names(seat), persona, names, language });
  const brief: Record<Role, string> = {
    wolf: 'and you are a wolf.',
    villager: 'and you are a villager.',
    seer: 'and you are the seer, a god.',
    witch: 'and you are the witch, a god.',
    hunter: 'and you are the hunter, a god.',
    idiot: 'and you are the idiot, a god.',
  };

  it('briefs a seat on the game, its seat, its role and its character, in the language of the table', () => {
    const g = board();
    ROLES.forEach((role, i) => {
      const seat = i + 1;
      const text = intro(g, seat);
      expect(text).toContain(`You are seat #${seat}, ${names(seat)}, ${brief[role]}`);
      expect(text).toContain(`Your character: ${persona}`);
      expect(text).toContain('You play Werewolf with 12 players: 4 wolves, 4 villagers and 4 gods');
      expect(text).toContain('Speak in English');
    });
    expect(intro(g, 1, 'Simplified Chinese')).toContain('Speak in Simplified Chinese');
  });

  it('lists the players by seat and name only, with no role among them', () => {
    const g = board();
    const roster = Array.from({ length: SEATS }, (_, i) => `#${i + 1} Pet${i + 1}`).join(', ');
    for (let seat = 1; seat <= SEATS; seat++) expect(intro(g, seat)).toContain(`Players: ${roster}.`);
  });

  it('names the fellow wolves to a wolf, and to nobody else', () => {
    const g = board();
    for (let seat = 1; seat <= SEATS; seat++) {
      const partners = /Your fellow wolves: (.*)\./.exec(intro(g, seat));
      if (seat > 4) {
        expect(partners, `${seat}`).toBeNull();
        continue;
      }
      const others = [1, 2, 3, 4].filter((s) => s !== seat).map((s) => `#${s} ${names(s)}`);
      expect(partners?.[1]).toBe(others.join(', '));
    }
  });

  it('opens every question with the table as its seat knows it', () => {
    const g = board();
    g.startNight();
    out(g, 6);
    g.say(9, 'day', 'I am the seer.', { claim: 'seer', checks: [{ seat: 3, wolf: true }] });
    g.exile(12);
    g.elect(7);
    g.boom(2);
    g.deaths.length = 0;
    g.startNight();
    const villager = questionText(g, 5, { kind: 'run' }, names);
    expect(villager).toContain('You are #5 Pet5, the villager.');
    expect(villager).toContain('Day 2. Alive: ');
    expect(villager).toContain('#12 Pet12 (the flipped idiot, no vote)');
    expect(villager).toContain('Dead (their roles are not known): #2 Pet2 (wolf), #6 Pet6.');
    expect(villager).toContain('The sheriff is #7 Pet7.');
    expect(villager).toContain('Claims at the table: #9 Pet9 claims seer (says: #3 wolf).');
    expect(villager).not.toContain('Your potions');
    expect(questionText(g, 1, { kind: 'run' }, names)).toContain('You are #1 Pet1, a wolf.');
    g.elect(null);
    expect(questionText(g, 5, { kind: 'run' }, names)).toContain('There is no sheriff.');
  });

  it('tells only the witch what is left of her potions', () => {
    const g = night();
    expect(questionText(g, 10, g.witchQuestion(6), names)).toContain('Your potions: antidote unused, poison unused.');
    g.antidote = false;
    expect(questionText(g, 10, g.witchQuestion(6), names)).toContain('Your potions: antidote used, poison unused.');
    g.poison = false;
    expect(questionText(g, 10, g.witchQuestion(6), names)).toContain('Your potions: antidote used, poison used.');
    for (const seat of [1, 5, 9, 11, 12]) {
      expect(questionText(g, seat, { kind: 'run' }, names)).not.toContain('potions');
    }
  });

  it('asks the wolves to kill, offering every living player, a partner or themselves too', () => {
    const g = night();
    out(g, 6);
    const text = questionText(g, 1, { kind: 'kill' }, names);
    expect(text).toContain('Night: the wolves choose whom to kill.');
    for (const seat of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]) expect(text).toContain(`#${seat} Pet${seat}`);
    expect(text.split('\n').pop()).toBe('Reply with JSON only: {"target": <seat>}');
    expect(text).not.toContain('#6 Pet6,');
  });

  it('asks the seer to check only a player she has not checked', () => {
    const g = night();
    g.record([9], { kind: 'check', seat: 9, target: 3, wolf: false });
    const text = questionText(g, 9, { kind: 'check' }, names);
    const list = /Not yet checked: (.*)\./.exec(text)?.[1] ?? '';
    expect(list).not.toContain('#3 ');
    expect(list).not.toContain('#9 ');
    expect(list.split(', ')).toHaveLength(10);
  });

  it('puts to the witch who was attacked and what she may do', () => {
    const g = night();
    const full = questionText(g, 10, g.witchQuestion(6), names);
    expect(full).toContain('The wolves attacked #6 Pet6.');
    expect(full).toContain('save him with the antidote');
    expect(full).toContain('poison a player (');
    expect(full).toContain('or do nothing');
    expect(full).toContain('At most one potion tonight.');
    expect(full.split('\n').pop()).toBe('Reply with JSON only: {"save": <true or false>, "poison": <seat or null>}');

    g.startNight();
    const noSelfSave = questionText(g, 10, g.witchQuestion(10), names);
    expect(noSelfSave).toContain('The wolves attacked #10 Pet10.');
    expect(noSelfSave).not.toContain('save him');
    g.antidote = false;
    const noAntidote = questionText(g, 10, g.witchQuestion(6), names);
    expect(noAntidote).toContain('You are not told who was attacked: your antidote is gone.');
    expect(noAntidote).not.toContain('The wolves attacked');
    g.poison = false;
    const none = questionText(g, 10, g.witchQuestion(6), names);
    expect(none).not.toContain('poison a player');
    expect(none).toContain('or do nothing');
  });

  it('puts each kind of speech as what it is, with the shape of the reply', () => {
    const g = night();
    const ask = (talk: 'day' | 'campaign' | 'pk' | 'last'): string =>
      questionText(g, 5, { kind: 'speak', talk }, names);
    expect(ask('day')).toContain('It is your turn to speak in the day\'s talk.');
    expect(ask('campaign')).toContain('You run for sheriff');
    expect(ask('pk')).toContain('The vote was tied');
    expect(ask('last')).toContain('These are your last words.');
    for (const talk of ['day', 'campaign', 'pk', 'last'] as const) {
      expect(ask(talk)).toContain('Reply with JSON only: {"say": "<what you say>", "suspect": ');
      expect(ask(talk)).toContain('it is also whom you vote for');
    }
  });

  it('offers a hunter his targets and a sheriff his heirs, never himself or the dead', () => {
    const g = night();
    out(g, 6);
    const shoot = questionText(g, 11, { kind: 'shoot' }, names);
    expect(shoot).toContain('You are dead and you shoot one player now.');
    const badge = questionText(g, 11, { kind: 'badge' }, names);
    expect(badge).toContain('hand the badge to a living player you trust, or tear it up');
    expect(badge).toContain('null to tear it up');
    for (const text of [shoot, badge]) {
      const list = text.split('\n').find((l) => /(Targets|Players): /.test(l)) ?? '';
      expect(list).not.toContain('#11 ');
      expect(list).not.toContain('#6 ');
      expect(list).toContain('#12 Pet12');
    }
  });
});

interface Sent {
  seat: number;
  prompt: string;
}

function harness(
  g: WerewolfGame,
  reply: (seat: number, prompt: string) => string | null = () => null,
  budget?: number,
) {
  const sent: Sent[] = [];
  const ai = makeAi({
    game: g,
    character: (seat) => ({ name: names(seat), persona: `Persona of ${seat}.` }),
    names,
    language: 'English',
    ask: async (seat, prompt) => {
      sent.push({ seat, prompt });
      return reply(seat, prompt);
    },
    budget,
  });
  return { ai, sent };
}

describe('makeAi: what is put to a mind', () => {
  it('puts nothing to a mind for the run for sheriff and for the sheriff vote', async () => {
    const { ai, sent } = harness(night(), () => '{"run": true, "target": 3}');
    expect(await ai(5, { kind: 'run' })).toBeNull();
    expect(await ai(5, { kind: 'vote', why: 'sheriff', among: [3, 4] })).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('puts one request for each of the other questions', async () => {
    const g = night();
    const { ai, sent } = harness(g, () => '{"target": 3, "say": "x", "save": false, "poison": null}');
    expect(await ai(9, { kind: 'check' })).toEqual({ kind: 'target', seat: 3 });
    expect(await ai(10, g.witchQuestion(6))).toEqual({ kind: 'witch', save: false, poison: null });
    expect(await ai(5, speak)).toMatchObject({ kind: 'text', text: 'x' });
    expect(await ai(11, { kind: 'shoot' })).toEqual({ kind: 'pick', seat: 3 });
    expect(await ai(7, { kind: 'badge' })).toEqual({ kind: 'pick', seat: 3 });
    expect(sent.map((m) => m.seat)).toEqual([9, 10, 5, 11, 7]);
  });

  it('answers null to a reply it cannot use, and still counts the request', async () => {
    const { ai, sent } = harness(night(), () => 'I have no idea.');
    expect(await ai(9, { kind: 'check' })).toBeNull();
    expect(await ai(5, { kind: 'shoot' })).toBeNull();
    expect(sent).toHaveLength(2);
  });

  it('answers null when the mind cannot answer at all', async () => {
    const { ai, sent } = harness(night(), () => null);
    expect(await ai(5, speak)).toBeNull();
    expect(sent).toHaveLength(1);
  });
});

describe('makeAi: the exile vote', () => {
  const vote: Question = { kind: 'vote', why: 'exile', among: null };

  it('is the player the seat named in its own speech of the day, with no request', async () => {
    const g = night();
    g.say(5, 'day', 'I suspect 3.', { suspect: 3 });
    const { ai, sent } = harness(g);
    expect(await ai(5, vote)).toEqual({ kind: 'vote', seat: 3 });
    expect(sent).toHaveLength(0);
  });

  it('is the latest of its speeches, and none when that one named nobody', async () => {
    const g = night();
    g.say(5, 'day', 'I suspect 3.', { suspect: 3 });
    g.say(6, 'day', 'I suspect 3.', { suspect: 3 });
    g.say(5, 'pk', 'Now I suspect 4.', { suspect: 4 });
    g.say(6, 'pk', 'I am not sure.');
    const { ai } = harness(g);
    expect(await ai(5, vote)).toEqual({ kind: 'vote', seat: 4 });
    expect(await ai(6, vote)).toBeNull();
  });

  it('is nothing for a seat that has not spoken, and for words that are not the day\'s talk', async () => {
    const g = night();
    g.say(1, 'campaign', 'Vote for me. I suspect 3.', { suspect: 3 });
    g.say(2, 'last', 'I suspect 3.', { suspect: 3 });
    const { ai } = harness(g);
    expect(await ai(1, vote)).toBeNull();
    expect(await ai(2, vote)).toBeNull();
    expect(await ai(5, vote)).toBeNull();
  });

  it('is nothing for a speech of an earlier day', async () => {
    const g = night();
    g.say(5, 'day', 'I suspect 3.', { suspect: 3 });
    g.startNight();
    const { ai } = harness(g);
    expect(await ai(5, vote)).toBeNull();
  });

  it('is nothing when the suspect is dead, is the flipped idiot, or is not among the tied players', async () => {
    const g = night();
    g.say(5, 'day', 'Seat 4.', { suspect: 4 });
    g.say(6, 'day', 'Seat 12.', { suspect: 12 });
    g.say(7, 'day', 'Seat 3.', { suspect: 3 });
    g.exile(12);
    out(g, 4);
    const { ai } = harness(g);
    expect(await ai(5, vote)).toBeNull();
    expect(await ai(6, vote)).toBeNull();
    expect(await ai(7, vote)).toEqual({ kind: 'vote', seat: 3 });
    expect(await ai(7, { kind: 'vote', why: 'exile', among: [3, 8] })).toEqual({ kind: 'vote', seat: 3 });
    expect(await ai(7, { kind: 'vote', why: 'exile', among: [8, 9] })).toBeNull();
  });
});

describe('makeAi: the wolves', () => {
  const kill: Question = { kind: 'kill' };

  it('asks one wolf a night for the whole pack, and the others agree', async () => {
    const g = night();
    const { ai, sent } = harness(g, (seat) => `{"target": ${seat === 1 ? 9 : 5}}`);
    const answers = [];
    for (const seat of [1, 2, 3, 4]) answers.push(await ai(seat, kill));
    expect(answers).toEqual([9, 9, 9, 9].map((seat) => ({ kind: 'target', seat })));
    expect(sent.map((m) => m.seat)).toEqual([1]);
  });

  it('asks again the next night, once more, of whichever wolf comes first', async () => {
    const g = night();
    const { ai, sent } = harness(g, (seat) => `{"target": ${seat === 1 ? 9 : 5}}`);
    await ai(1, kill);
    await ai(2, kill);
    g.startNight();
    expect(await ai(2, kill)).toEqual({ kind: 'target', seat: 5 });
    expect(await ai(3, kill)).toEqual({ kind: 'target', seat: 5 });
    expect(await ai(1, kill)).toEqual({ kind: 'target', seat: 5 });
    expect(sent.map((m) => m.seat)).toEqual([1, 2]);
  });

  it('asks the next wolf when the first one has no usable answer', async () => {
    const g = night();
    const { ai, sent } = harness(g, (seat) => (seat === 1 ? 'no idea' : seat === 2 ? null : '{"target": 7}'));
    expect(await ai(1, kill)).toBeNull();
    expect(await ai(2, kill)).toBeNull();
    expect(await ai(3, kill)).toEqual({ kind: 'target', seat: 7 });
    expect(await ai(4, kill)).toEqual({ kind: 'target', seat: 7 });
    expect(sent.map((m) => m.seat)).toEqual([1, 2, 3]);
  });
});

describe('makeAi: what a seat has been told', () => {
  it('tells a seat the game once, and then only what its seat has seen since, with every question', async () => {
    const g = night();
    const { ai, sent } = harness(g, () => '{"say": "hello"}');
    await ai(5, speak);
    g.say(6, 'day', 'Hi all.');
    await ai(5, speak);
    await ai(5, speak);
    const [first, second, third] = sent.map((m) => m.prompt);
    expect(first).toContain('You play Werewolf with 12 players');
    expect(first).toContain('Persona of 5.');
    expect(first).toContain('What has happened since you last looked:\nNight 1 falls.');
    expect(first).toContain('You are #5 Pet5, the villager.');
    expect(second).not.toContain('You play Werewolf');
    expect(second).toContain('What has happened since you last looked:\n#6 Pet6: Hi all.');
    expect(second).not.toContain('Night 1 falls.');
    expect(second).toContain('It is your turn to speak');
    expect(third).not.toContain('What has happened since you last looked');
    expect(third).not.toContain('You play Werewolf');
  });

  it('tells it all again when a request got no reply', async () => {
    const g = night();
    let calls = 0;
    const { ai, sent } = harness(g, () => (++calls === 1 ? null : '{"say": "hello"}'));
    expect(await ai(5, speak)).toBeNull();
    expect(await ai(5, speak)).toMatchObject({ kind: 'text' });
    expect(await ai(5, speak)).toMatchObject({ kind: 'text' });
    const [first, second, third] = sent.map((m) => m.prompt);
    expect(second).toContain('You play Werewolf with 12 players');
    expect(second).toContain('Night 1 falls.');
    expect(first).toContain('You play Werewolf');
    expect(third).not.toContain('You play Werewolf');
    expect(third).not.toContain('Night 1 falls.');
  });

  it('keeps a session for each seat', async () => {
    const g = night();
    const { ai, sent } = harness(g, () => '{"say": "hello"}');
    await ai(5, speak);
    await ai(6, speak);
    expect(sent[1]?.prompt).toContain('You play Werewolf with 12 players');
    expect(sent[1]?.prompt).toContain('You are seat #6, Pet6');
  });

  it('never shows a seat what only another may know', async () => {
    const g = board();
    g.startNight();
    g.record([1, 3, 4], { kind: 'wolfPick', seat: 2, target: 6 });
    g.record([1, 2, 3, 4], { kind: 'wolfKill', target: 6 });
    g.record([9], { kind: 'check', seat: 9, target: 3, wolf: true });
    g.record([10], { kind: 'witchDid', seat: 10, saved: 6, poisoned: null });
    g.endNight({ kill: 6, saved: true, poisoned: null });
    g.say(5, 'day', 'Good morning.');
    const { ai, sent } = harness(g, () => '{"say": "hello"}');
    for (let seat = 1; seat <= SEATS; seat++) await ai(seat, speak);
    for (let seat = 1; seat <= SEATS; seat++) {
      const prompt = sent.find((m) => m.seat === seat)?.prompt ?? '';
      const wolf = seat <= 4;
      const says = (text: string): boolean => prompt.includes(text);
      expect(says('Your fellow wolves'), `${seat} partners`).toBe(wolf);
      expect(says('Your pack kills'), `${seat} pack`).toBe(wolf);
      expect(says('Your partner #2 Pet2 would kill #6 Pet6'), `${seat} pick`).toBe(wolf && seat !== 2);
      expect(says('Your check'), `${seat} check`).toBe(seat === 9);
      expect(says('You used the antidote'), `${seat} antidote`).toBe(seat === 10);
      expect(says('Your potions'), `${seat} potions`).toBe(seat === 10);
      expect(says('Day 1 dawns. Nobody died in the night.'), `${seat} dawn`).toBe(true);
      expect(prompt, `${seat} roles`).not.toMatch(/Pet\d+ \((wolf|villager|seer|witch|hunter|idiot)\)/);
    }
  });
});

describe('makeAi: the budget', () => {
  it('stops asking when the budget is spent, and then every question has no answer', async () => {
    const { ai, sent } = harness(night(), () => '{"say": "hi"}', 3);
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push(await ai(5, speak));
    expect(sent).toHaveLength(3);
    expect(answers.slice(0, 3).every((a) => a?.kind === 'text')).toBe(true);
    expect(answers.slice(3)).toEqual([null, null, null]);
  });

  it('asks nothing with no budget', async () => {
    const { ai, sent } = harness(night(), () => '{"say": "hi"}', 0);
    expect(await ai(5, speak)).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('has a default of MIND_BUDGET requests, which keeps a game to a few dozen', async () => {
    expect(MIND_BUDGET).toBeLessThanOrEqual(100);
    expect(MIND_BUDGET).toBeGreaterThanOrEqual(60);
    const { ai, sent } = harness(night(), () => '{"say": "hi"}');
    for (let i = 0; i < MIND_BUDGET + 20; i++) await ai(5, speak);
    expect(sent).toHaveLength(MIND_BUDGET);
  });

  it('spends none of it on the questions it does not put', async () => {
    const g = night();
    g.say(5, 'day', 'Seat 3.', { suspect: 3 });
    const { ai, sent } = harness(g, () => '{"say": "hi"}', 1);
    for (let i = 0; i < 10; i++) {
      await ai(5, { kind: 'run' });
      await ai(5, { kind: 'vote', why: 'exile', among: null });
      await ai(5, { kind: 'vote', why: 'sheriff', among: [3, 4] });
    }
    expect(sent).toHaveLength(0);
    expect(await ai(5, speak)).toMatchObject({ kind: 'text' });
  });
});
