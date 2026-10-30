import { describe, expect, it } from 'vitest';
import { Bots } from '../../../src/shared/teammate/sanguoshaAi';
import { shuffle } from '../../../src/shared/teammate/sanguoshaCards';
import type { Card } from '../../../src/shared/teammate/sanguoshaCards';
import {
  SGS_BUDGET, SGS_SAY_MAX, cardsQuestion, makeSgsMind, parseCards, parseHero, parsePlan, resolveStep, statusText,
} from '../../../src/shared/teammate/sanguoshaMind';
import type { SgsMindDeps, Step } from '../../../src/shared/teammate/sanguoshaMind';
import { runSanguosha } from '../../../src/shared/teammate/sanguoshaRun';
import { skillOptions } from '../../../src/shared/teammate/sanguoshaSkills';
import { ROLE_SETS } from '../../../src/shared/teammate/sanguoshaTypes';
import type { Ask, Entry, Reply, Size } from '../../../src/shared/teammate/sanguoshaTypes';
import { legalUses } from '../../../src/shared/teammate/sanguoshaUse';
import { enSanguosha as w } from '../../../src/shared/teammate/sanguoshaWords';
import { hold, info, out, rig, stack } from './sanguoshaRig';
import type { Rig } from './sanguoshaRig';

type PlayAsk = Extract<Ask, { k: 'play' }>;
type CardsAsk = Extract<Ask, { k: 'cards' }>;

const NAMES = ['Me', 'Ayla', 'Bo', 'Cy', 'Dee'];
const names = (seat: number): string => (seat === 0 ? 'the user' : (NAMES[seat] ?? `Seat ${seat}`));

const playAsk = (r: Rig, seat: number): PlayAsk => ({ k: 'play', uses: legalUses(r.e, seat), skills: skillOptions(r.e, seat) });

/** Takes cards out of a hand, as playing them does. */
const drop = (r: Rig, seat: number, ...cards: Card[]): void => {
  const p = r.e.p(seat);
  p.hand = p.hand.filter((c) => !cards.includes(c));
};

/** A Peach asked for, for the dying seat 3. */
const dying = (...ids: number[]): CardsAsk => ({ k: 'cards', why: 'tao', ctx: { target: 3 }, cards: ids, min: 0, max: 1 });

const plan = (steps: object[], say = ''): string => JSON.stringify({ plan: steps, say });

/** What a prompt says has happened since the mind last looked; nothing when it says no such thing. */
const told = (text: string): string => /What has happened since you last looked:\n([\s\S]*?)(?:\n\n|$)/.exec(text)?.[1] ?? '';

/** The first step of a plan as a mind would write it. */
const stepOf = (raw: object): Step => parsePlan(plan([raw]))?.steps[0] as Step;

/** A mind whose replies are the ones given, one for each request, and which keeps what it was asked. */
function minded(replies: readonly (string | null | Error)[], extra: Partial<SgsMindDeps> = {}) {
  const prompts: { seat: number; text: string }[] = [];
  const thinking: string[] = [];
  const queue = [...replies];
  const mind = makeSgsMind({
    names,
    character: (seat) => ({ name: NAMES[seat] ?? '', persona: seat === 1 ? 'a cheerful fox' : '' }),
    language: 'English',
    ask: async (seat, text) => {
      prompts.push({ seat, text });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    },
    think: (seat, on) => {
      thinking.push(`${on ? '+' : '-'}${seat}`);
    },
    ...extra,
  });
  return { mind, prompts, thinking };
}

describe('reading a plan', () => {
  it('takes cards, skills and targets, and turns the table\'s seat numbers into the engine\'s', () => {
    const text = JSON.stringify({
      plan: [{ card: 12, targets: [3] }, { skill: 'rende', cards: [4, '#5'], target: '2' }, { card: '[7]', as: 'Strike' }],
      say: 'Here we go!',
    });
    expect(parsePlan(text)).toEqual({
      steps: [
        { card: 12, targets: [2] },
        { skill: 'rende', cards: [4, 5], targets: [1] },
        { card: 7, as: 'Strike', targets: null },
      ],
      say: 'Here we go!',
    });
  });

  it('finds the plan among words and in a code fence', () => {
    const text = 'Here is my plan:\n```json\n{"plan": [{"card": 3}], "say": ""}\n```\nGood luck!';
    expect(parsePlan(text)).toEqual({ steps: [{ card: 3, targets: null }], say: null });
  });

  it('is not fooled by a reply with no plan in it', () => {
    for (const text of ['', 'I will pass.', '{"say": "hi"}', '{"plan": "attack"}', '[{"card": 3}]']) {
      expect(parsePlan(text), text).toBeNull();
    }
  });

  it('drops the steps it cannot read and keeps the rest', () => {
    const steps = [7, 'x', null, [1], { say: 'hmm' }, { card: 'abc' }, { card: 5, targets: ['x'] }, { card: 5.5 }, { card: 9 }];
    expect(parsePlan(JSON.stringify({ plan: steps }))?.steps).toEqual([{ card: 9, targets: null }]);
  });

  it('keeps to twelve steps', () => {
    const steps = Array.from({ length: 20 }, (_, i) => ({ card: i + 1 }));
    expect(parsePlan(plan(steps))?.steps.map((s) => s.card)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('makes a remark one short line', () => {
    expect(parsePlan('{"plan": [], "say": "  Not\\n  so  fast  "}')?.say).toBe('Not so fast');
    expect(parsePlan(plan([], 'x'.repeat(300)))?.say).toHaveLength(SGS_SAY_MAX);
    expect(parsePlan(JSON.stringify({ plan: [], say: 5 }))?.say).toBeNull();
  });
});

describe('turning a step into a play the table will take', () => {
  it('plays a card at the seat named, counting seats from 1', () => {
    const r = rig(5, { turn: 1 });
    const [sha] = hold(r.e, 1, 'sha');
    const ask = playAsk(r, 1);
    expect(resolveStep(stepOf({ card: sha.id, targets: [3] }), ask)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [2] });
    expect(resolveStep(stepOf({ card: sha.id, targets: ['#1'] }), ask)).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [0] });
  });

  it('does not play at a seat that is out of reach, at nobody, or at too many', () => {
    const r = rig(5, { turn: 1 });
    const [sha] = hold(r.e, 1, 'sha');
    const ask = playAsk(r, 1);
    for (const bad of [{ card: sha.id, targets: [4] }, { card: sha.id }, { card: sha.id, targets: [1, 3] }, { card: sha.id, targets: [3, 3] }]) {
      expect(resolveStep(stepOf(bad), ask), JSON.stringify(bad)).toBeNull();
    }
  });

  it('takes the one target there is when none is named', () => {
    const r = rig(5, { turn: 1 });
    out(r.e, 2, 3, 4);
    const [sha] = hold(r.e, 1, 'sha');
    expect(resolveStep(stepOf({ card: sha.id }), playAsk(r, 1))).toEqual({ k: 'use', card: sha.id, as: 'sha', targets: [0] });
  });

  it('ignores the targets named for a card that takes none', () => {
    const r = rig(5, { turn: 1 });
    const [draw] = hold(r.e, 1, 'wuzhong');
    expect(resolveStep(stepOf({ card: draw.id, targets: [3] }), playAsk(r, 1)))
      .toEqual({ k: 'use', card: draw.id, as: 'wuzhong', targets: [] });
  });

  it('does not play a card that is not in the hand, or one that cannot be played now', () => {
    const r = rig(5, { turn: 1 });
    const [dodge] = hold(r.e, 1, 'shan');
    const ask = playAsk(r, 1);
    expect(resolveStep(stepOf({ card: 9999 }), ask)).toBeNull();
    expect(resolveStep(stepOf({ card: dodge.id }), ask)).toBeNull();
  });

  it('turns a card into another by the card\'s name or the skill\'s', () => {
    const r = rig(5, { turn: 1, heroes: { 1: 'guanyu' } });
    const [peach] = hold(r.e, 1, ['tao', 'heart', 5]);
    const strike = { k: 'use', card: peach.id, as: 'sha', skill: 'wusheng', targets: [2] };
    // Unhurt, the Peach can be nothing but a Strike.
    expect(resolveStep(stepOf({ card: peach.id, targets: [3] }), playAsk(r, 1))).toEqual(strike);
    r.e.p(1).hp = 2;
    const ask = playAsk(r, 1);
    expect(resolveStep(stepOf({ card: peach.id }), ask)).toEqual({ k: 'use', card: peach.id, as: 'tao', targets: [] });
    expect(resolveStep(stepOf({ card: peach.id, as: w.card.sha.name, targets: [3] }), ask)).toEqual(strike);
    expect(resolveStep(stepOf({ card: peach.id, as: w.card.sha.name.toUpperCase(), targets: [3] }), ask)).toEqual(strike);
    expect(resolveStep(stepOf({ card: peach.id, skill: w.skill.wusheng.name, targets: [3] }), ask)).toEqual(strike);
    expect(resolveStep(stepOf({ card: peach.id, skill: 'wusheng', targets: [3] }), ask)).toEqual(strike);
    expect(resolveStep(stepOf({ card: peach.id, as: 'nonsense' }), ask)).toBeNull();
    expect(resolveStep(stepOf({ card: peach.id, skill: 'nonsense' }), ask)).toBeNull();
  });

  it('starts a skill with the cards and the seat it names', () => {
    const r = rig(5, { turn: 1 });
    const [a, b, c] = hold(r.e, 1, 'sha', 'shan', 'tao');
    const ask = playAsk(r, 1);
    expect(resolveStep(stepOf({ skill: 'rende', cards: [a.id, b.id], targets: [3] }), ask))
      .toEqual({ k: 'skill', skill: 'rende', cards: [a.id, b.id], targets: [2] });
    expect(resolveStep(stepOf({ skill: w.skill.rende.name, cards: [c.id], targets: [1] }), ask))
      .toEqual({ k: 'skill', skill: 'rende', cards: [c.id], targets: [0] });
    const bad = [
      { skill: 'rende', targets: [3] },
      { skill: 'rende', cards: [9999], targets: [3] },
      { skill: 'rende', cards: [a.id, a.id], targets: [3] },
      { skill: 'rende', cards: [a.id] },
      { skill: 'rende', cards: [a.id], targets: [3, 4] },
      { skill: 'rende', cards: [a.id], targets: [2] },
      { skill: 'zhiheng', cards: [a.id] },
      { skill: 'nonsense' },
    ];
    for (const step of bad) expect(resolveStep(stepOf(step), ask), JSON.stringify(step)).toBeNull();
  });

  it('starts a skill that needs neither cards nor a seat, and takes cards from the equipment for one that may', () => {
    const r = rig(5, { turn: 1, heroes: { 1: 'huanggai', 2: 'sunquan' } });
    expect(resolveStep(stepOf({ skill: 'kurou', cards: [4], targets: [3] }), playAsk(r, 1)))
      .toEqual({ k: 'skill', skill: 'kurou', cards: [], targets: [] });
    const [a] = hold(r.e, 2, 'sha');
    expect(resolveStep(stepOf({ skill: 'zhiheng', cards: [a.id] }), playAsk(r, 2)))
      .toEqual({ k: 'skill', skill: 'zhiheng', cards: [a.id], targets: [] });
  });
});

describe('reading a hero and a card played for a Peach', () => {
  const ask = { k: 'hero', heroes: ['liubei', 'guanyu', 'zhangfei'], lord: false } as const;

  it('takes the hero by its number or its name', () => {
    expect(parseHero('{"pick": 2}', { ...ask, heroes: [...ask.heroes] })).toBe('guanyu');
    expect(parseHero('{"pick": "3"}', { ...ask, heroes: [...ask.heroes] })).toBe('zhangfei');
    expect(parseHero('2', { ...ask, heroes: [...ask.heroes] })).toBe('guanyu');
    expect(parseHero(`{"pick": "${w.hero.zhangfei}"}`, { ...ask, heroes: [...ask.heroes] })).toBe('zhangfei');
    expect(parseHero('{"hero": "liubei"}', { ...ask, heroes: [...ask.heroes] })).toBe('liubei');
  });

  it('takes no hero that was not offered', () => {
    for (const text of ['{"pick": 0}', '{"pick": 4}', '{"pick": "Zhuge Liang"}', '{"pick": []}', 'whatever', '']) {
      expect(parseHero(text, { ...ask, heroes: [...ask.heroes] }), text).toBeNull();
    }
  });

  it('reads the cards to play, none, or a plain yes or no', () => {
    const peach = dying(5, 6);
    expect(parseCards('{"play": [6]}', peach)).toEqual([6]);
    expect(parseCards('{"play": []}', peach)).toEqual([]);
    expect(parseCards('{"cards": [5]}', peach)).toEqual([5]);
    expect(parseCards('{"play": true}', peach)).toEqual([5]);
    expect(parseCards('{"play": "yes"}', peach)).toEqual([5]);
    expect(parseCards('{"play": false}', peach)).toEqual([]);
    expect(parseCards('{"play": "no"}', peach)).toEqual([]);
  });

  it('reads no cards that were not offered, too many, or no answer at all', () => {
    const peach = dying(5, 6);
    for (const text of ['', 'yes', '{"play": null}', '{"play": [7]}', '{"play": [5, 6]}', '{"play": [5, 5]}', '{"play": "maybe"}', '{"other": 1}']) {
      expect(parseCards(text, peach), text).toBeNull();
    }
  });
});

describe('what a mind is told', () => {
  it('is briefed on the game, its seat and its character, and then asked for a plan', async () => {
    const r = rig(5, { turn: 1 });
    const [sha] = hold(r.e, 1, 'sha');
    const { mind, prompts } = minded([plan([])]);
    await mind.answer(1, playAsk(r, 1), r.e);
    const text = prompts[0]?.text ?? '';
    expect(prompts).toHaveLength(1);
    expect(text).toContain('You play Sanguosha with 5 players, in seats numbered #1 to #5.');
    expect(text).toContain('Identity game for 5 or 8 players');
    expect(text).not.toContain('An unofficial');
    expect(text).toContain('You are seat #2, Ayla, and you are the Loyalist.');
    expect(text).toContain('Your character: a cheerful fox');
    expect(text).toContain('Speak in English');
    expect(text).toContain('The heroes at the table');
    expect(text).toContain(`[${sha.id}] ${w.card.sha.name}`);
    expect(text).toContain('"plan"');
  });

  it('is told the table it plays at, and the language of the players', async () => {
    const r = rig(8, { turn: 1 });
    const { mind, prompts } = minded([plan([])], { language: 'Simplified Chinese' });
    await mind.answer(1, playAsk(r, 1), r.e);
    expect(prompts[0]?.text).toContain('You play Sanguosha with 8 players, in seats numbered #1 to #8.');
    expect(prompts[0]?.text).toContain('Speak in Simplified Chinese');
  });

  it('is told of its character only when it has one', async () => {
    const r = rig(5, { turn: 2 });
    const { mind, prompts } = minded([plan([])]);
    await mind.answer(2, playAsk(r, 2), r.e);
    expect(prompts[0]?.text).not.toContain('Your character');
  });

  it('is briefed once, and later told only what happened since it last looked', async () => {
    const r = rig(5, { turn: 2 });
    const [peach] = hold(r.e, 1, 'tao');
    const { mind, prompts } = minded(['{"play": []}', '{"play": []}']);
    r.e.turns = 4;
    mind.observe({ k: 'turn', seat: 2 }, r.e);
    await mind.answer(1, dying(peach.id), r.e);
    mind.observe({ k: 'damage', seat: 3, n: 1, source: 2 }, r.e);
    await mind.answer(1, dying(peach.id), r.e);
    const [first = '', second = ''] = prompts.map((p) => p.text);
    expect(first).toContain('You play Sanguosha');
    expect(first).toContain('The heroes at the table');
    expect(told(first)).toBe('Turn 4: #3 Bo');
    expect(second).not.toContain('You play Sanguosha');
    expect(second).not.toContain('The heroes at the table');
    expect(told(second)).toBe('#4 Cy took 1 damage from #3 Bo.');
  });

  it('is told what it missed again when its request got no answer', async () => {
    const r = rig(5, { turn: 2 });
    const [peach] = hold(r.e, 1, 'tao');
    const { mind, prompts } = minded([null, '{"play": []}']);
    mind.observe({ k: 'turn', seat: 2 }, r.e);
    expect(await mind.answer(1, dying(peach.id), r.e)).toBeNull();
    expect(await mind.answer(1, dying(peach.id), r.e)).not.toBeNull();
    expect(prompts[1]?.text).toContain('You play Sanguosha');
    expect(told(prompts[1]?.text ?? '')).toBe('Turn 0: #3 Bo');
  });

  it('keeps each seat\'s own account of what it has been told', async () => {
    const r = rig(5, { turn: 2 });
    const { mind, prompts } = minded(['{"play": []}', '{"play": []}', '{"play": []}']);
    mind.observe({ k: 'turn', seat: 2 }, r.e);
    await mind.answer(1, dying(1), r.e);
    await mind.answer(2, dying(1), r.e);
    await mind.answer(1, dying(1), r.e);
    expect(prompts.map((p) => p.seat)).toEqual([1, 2, 1]);
    expect(prompts[1]?.text).toContain('You are seat #3, Bo, and you are the Rebel.');
    expect(told(prompts[1]?.text ?? '')).toBe('Turn 0: #3 you');
    expect(prompts[2]?.text).not.toContain('You play Sanguosha');
    expect(told(prompts[2]?.text ?? '')).toBe('');
  });

  it('leaves out the oldest of a long account', async () => {
    const r = rig(5, { turn: 2 });
    const { mind, prompts } = minded(['{"play": []}']);
    for (let n = 0; n < 100; n++) {
      r.e.turns = n;
      mind.observe({ k: 'turn', seat: 2 }, r.e);
    }
    await mind.answer(1, dying(1), r.e);
    const lines = told(prompts[0]?.text ?? '').split('\n');
    expect(lines).toHaveLength(81);
    expect(lines[0]).toBe('(20 earlier events left out)');
    expect(lines[1]).toBe('Turn 20: #3 Bo');
    expect(lines[80]).toBe('Turn 99: #3 Bo');
  });

  it('is shown only what its seat can see of the others', async () => {
    const r = rig(5, { turn: 1 });
    const [mine] = hold(r.e, 1, 'sha');
    const [theirs] = hold(r.e, 2, ['nanman', 'club', 3]);
    const { mind, prompts } = minded([plan([])]);
    await mind.answer(1, playAsk(r, 1), r.e);
    const text = prompts[0]?.text ?? '';
    expect(text).toContain(`[${mine.id}]`);
    expect(text).not.toContain(`[${theirs.id}]`);
    expect(text).toMatch(/#3 Bo[^\n]*: HP 4\/4, 1 hand card,/);
  });

  it('is told the cards that were drawn only if they were its own', async () => {
    const r = rig(5, { turn: 3 });
    const [drawn] = stack(r.e, ['sha', 'heart', 9]);
    const draw: Entry = { k: 'draw', seat: 3, n: 1, cards: [info(drawn)] };
    const { mind, prompts } = minded([plan([]), plan([])]);
    mind.observe(draw, r.e);
    await mind.answer(1, playAsk(r, 1), r.e);
    await mind.answer(3, playAsk(r, 3), r.e);
    expect(prompts[0]?.text).toContain('#4 Cy drew 1 card');
    expect(prompts[0]?.text).not.toContain('♥9');
    expect(prompts[1]?.text).toContain('#4 you drew');
    expect(prompts[1]?.text).toContain('♥9');
  });
});

describe('the table as a seat sees it', () => {
  it('shows the roles of the lord, of oneself and of the fallen, and no others', () => {
    const r = rig(5, { turn: 2 });
    const text = statusText(r.e, 2, names);
    expect(text).toContain('#1 the user, Lord');
    expect(text).toContain('#3 you, Rebel');
    expect(text).not.toContain('Loyalist');
    expect(text).not.toContain('Traitor');
    expect(text.match(/Rebel/g)).toHaveLength(1);
    out(r.e, 4);
    expect(statusText(r.e, 2, names)).toContain('#5 Dee, Traitor');
    expect(statusText(r.e, 2, names)).toContain('out of the game');
  });

  it('shows the equipment of everybody, and the ids of one\'s own only', () => {
    const r = rig(5, { turn: 1 });
    const [mine] = hold(r.e, 1, 'sha');
    const text = statusText(r.e, 1, names);
    expect(text).toContain(`Your hand: [${mine.id}] ${w.card.sha.name}`);
    expect(text).toContain('#2 you');
  });

  it('puts a Peach question with the cards that would do, and the ones that count as one', () => {
    const r = rig(5, { turn: 1, heroes: { 1: 'huatuo' } });
    const [peach, red] = hold(r.e, 1, 'tao', ['sha', 'heart', 2]);
    const text = cardsQuestion(r.e, 1, dying(peach.id, red.id), names);
    expect(text).toContain(`[${peach.id}] ${w.card.tao.name}`);
    expect(text).toContain(`(counts as a ${w.card.tao.name})`);
    expect(text.match(/counts as a/g)).toHaveLength(1);
    expect(text).toContain('{"play": []}');
  });
});

describe('a mind picking a hero', () => {
  const ask: Ask = { k: 'hero', heroes: ['liubei', 'guanyu', 'zhangfei'], lord: false };

  it('asks with the heroes numbered, and takes the one it picks', async () => {
    const r = rig(5, { turn: 1 });
    const { mind, prompts } = minded(['{"pick": 2, "say": "ignored"}']);
    expect(await mind.answer(1, ask, r.e)).toEqual({ reply: { k: 'hero', hero: 'guanyu' }, say: null });
    const text = prompts[0]?.text ?? '';
    expect(text).toContain('You play Sanguosha');
    expect(text).toContain(`1. ${w.hero.liubei} (`);
    expect(text).toContain(`3. ${w.hero.zhangfei} (`);
    expect(text).toContain('{"pick": <number>}');
    expect(text).not.toContain('The heroes at the table');
  });

  it('asks the lord with the lord\'s words', async () => {
    const r = rig(5, { turn: 0 });
    const { mind, prompts } = minded(['{"pick": 1}']);
    await mind.answer(0, { ...ask, lord: true }, r.e);
    expect(prompts[0]?.text).toContain(w.ask.heroLord);
  });

  it('leaves the choice to the rules when it picks nothing that was offered', async () => {
    const r = rig(5, { turn: 1 });
    const { mind } = minded(['{"pick": 9}', 'Hmm, hard to say.', null]);
    expect(await mind.answer(1, ask, r.e)).toBeNull();
    expect(await mind.answer(1, ask, r.e)).toBeNull();
    expect(await mind.answer(1, ask, r.e)).toBeNull();
  });

  it('is told the heroes at the table once it has to play them, and only then', async () => {
    const r = rig(5, { turn: 1 });
    const { mind, prompts } = minded(['{"pick": 1}', plan([]), plan([])]);
    await mind.answer(1, ask, r.e);
    await mind.answer(1, playAsk(r, 1), r.e);
    r.e.turns += 1;
    await mind.answer(1, playAsk(r, 1), r.e);
    expect(prompts[0]?.text).not.toContain('The heroes at the table');
    expect(prompts[1]?.text).toContain('The heroes at the table');
    expect(prompts[1]?.text).toContain(`#3 Bo: ${w.hero.liubei} (4 HP)`);
    expect(prompts[2]?.text).not.toContain('The heroes at the table');
  });
});

describe('a mind answering for a dying player or a trick', () => {
  it('plays the card it names, or holds back', async () => {
    const r = rig(5, { turn: 2 });
    const [peach] = hold(r.e, 1, 'tao');
    const { mind, prompts } = minded(['{"play": [' + peach.id + '], "say": "ignored"}', '{"play": []}', 'no idea']);
    expect(await mind.answer(1, dying(peach.id), r.e)).toEqual({ reply: { k: 'cards', ids: [peach.id] }, say: null });
    expect(await mind.answer(1, dying(peach.id), r.e)).toEqual({ reply: { k: 'cards', ids: [] }, say: null });
    expect(await mind.answer(1, dying(peach.id), r.e)).toBeNull();
    expect(prompts[0]?.text).toContain('Cards you may play:');
  });

  it('is asked about a Counter as well', async () => {
    const r = rig(5, { turn: 2 });
    const [counter] = hold(r.e, 1, 'wuxie');
    const ask: Ask = { k: 'cards', why: 'wuxie', ctx: { name: 'nanman', from: 2, on: true }, cards: [counter.id], min: 0, max: 1 };
    const { mind } = minded([`{"play": [${counter.id}]}`]);
    expect(await mind.answer(1, ask, r.e)).toEqual({ reply: { k: 'cards', ids: [counter.id] }, say: null });
  });

  it('leaves every other question to the rules, and asks nothing about them', async () => {
    const r = rig(5, { turn: 2 });
    const { mind, prompts, thinking } = minded([]);
    const others: Ask[] = [
      { k: 'cards', why: 'shan', ctx: {}, cards: [1], min: 1, max: 1 },
      { k: 'cards', why: 'discard', ctx: { amount: 1 }, cards: [1, 2], min: 1, max: 1 },
      { k: 'area', why: 'chai', ctx: {}, owner: 2, hand: 1, equip: [], judges: [] },
      { k: 'seat', why: 'tuxi', ctx: {}, options: [2, 3], min: 0, max: 2 },
      { k: 'confirm', why: 'bagua', ctx: {} },
    ];
    for (const ask of others) expect(await mind.answer(1, ask, r.e), JSON.stringify(ask)).toBeNull();
    expect(prompts).toEqual([]);
    expect(thinking).toEqual([]);
  });
});

describe('a mind planning a turn', () => {
  it('plays its plan a step at a time, asking once, and skips the steps that can no longer be played', async () => {
    const r = rig(5, { turn: 1 });
    const [sha, dodge] = hold(r.e, 1, 'sha', 'shan');
    const { mind, prompts } = minded([plan([
      { card: sha.id, targets: [3] }, { card: dodge.id }, { card: sha.id, targets: [1] },
    ])]);
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toEqual({
      reply: { k: 'use', card: sha.id, as: 'sha', targets: [2] }, say: null,
    });
    drop(r, 1, sha);
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toEqual({ reply: { k: 'end' }, say: null });
    expect(prompts).toHaveLength(1);
  });

  it('ends the turn at once when its plan is empty', async () => {
    const r = rig(5, { turn: 1 });
    hold(r.e, 1, 'sha');
    const { mind, prompts } = minded([plan([], 'Not this time.')]);
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toEqual({ reply: { k: 'end' }, say: 'Not this time.' });
    expect(prompts).toHaveLength(1);
  });

  it('says its line with the first play of the plan, and only once', async () => {
    const r = rig(5, { turn: 1 });
    const [draw, sha] = hold(r.e, 1, 'wuzhong', 'sha');
    const { mind } = minded([plan([{ card: draw.id }, { card: sha.id, targets: [3] }], 'Charge!')]);
    const first = await mind.answer(1, playAsk(r, 1), r.e);
    expect(first?.say).toBe('Charge!');
    drop(r, 1, draw);
    const second = await mind.answer(1, playAsk(r, 1), r.e);
    expect(second?.reply).toMatchObject({ k: 'use', card: sha.id });
    expect(second?.say).toBeNull();
    drop(r, 1, sha);
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toEqual({ reply: { k: 'end' }, say: null });
  });

  it('plans again when what it planned is played and it has cards it did not have then', async () => {
    const r = rig(5, { turn: 1 });
    const [draw] = hold(r.e, 1, 'wuzhong');
    const { mind, prompts } = minded([plan([{ card: draw.id }]), plan([])]);
    expect((await mind.answer(1, playAsk(r, 1), r.e))?.reply).toMatchObject({ k: 'use', card: draw.id });
    drop(r, 1, draw);
    hold(r.e, 1, 'sha', 'sha');
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toEqual({ reply: { k: 'end' }, say: null });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]?.text).toContain('You have played what you planned');
    expect(prompts[1]?.text).not.toContain('You play Sanguosha');
  });

  it('does not plan again when it holds nothing new', async () => {
    const r = rig(5, { turn: 1 });
    const [draw] = hold(r.e, 1, 'wuzhong');
    hold(r.e, 1, 'shan');
    const { mind, prompts } = minded([plan([{ card: draw.id }])]);
    await mind.answer(1, playAsk(r, 1), r.e);
    drop(r, 1, draw);
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toEqual({ reply: { k: 'end' }, say: null });
    expect(prompts).toHaveLength(1);
  });

  it('plans again no more than twice in a turn', async () => {
    const r = rig(5, { turn: 1 });
    const [first, second, third] = hold(r.e, 1, 'wuzhong', 'wuzhong', 'wuzhong');
    const { mind, prompts } = minded([plan([{ card: first.id }]), plan([{ card: second.id }]), plan([{ card: third.id }])]);
    const reply = async (): Promise<Reply | undefined> => (await mind.answer(1, playAsk(r, 1), r.e))?.reply;
    expect(await reply()).toMatchObject({ card: first.id });
    drop(r, 1, first);
    hold(r.e, 1, 'sha');
    expect(await reply()).toMatchObject({ card: second.id });
    drop(r, 1, second);
    hold(r.e, 1, 'sha');
    expect(await reply()).toMatchObject({ card: third.id });
    drop(r, 1, third);
    hold(r.e, 1, 'sha');
    expect(await reply()).toEqual({ k: 'end' });
    expect(prompts).toHaveLength(3);
  });

  it('leaves the turn to the rules when the reply holds no plan, and plans again the next turn', async () => {
    const r = rig(5, { turn: 1 });
    hold(r.e, 1, 'sha');
    const { mind, prompts } = minded(['I think I will wing it.', plan([])]);
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toBeNull();
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toBeNull();
    expect(prompts).toHaveLength(1);
    r.e.turns += 1;
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toEqual({ reply: { k: 'end' }, say: null });
    expect(prompts).toHaveLength(2);
  });

  it('leaves the turn to the rules when it cannot be reached', async () => {
    const r = rig(5, { turn: 1 });
    hold(r.e, 1, 'sha');
    const { mind, prompts } = minded([null, new Error('gone')]);
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toBeNull();
    r.e.turns += 1;
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toBeNull();
    expect(prompts).toHaveLength(2);
  });

  it('leaves the turn to the rules when none of what it planned can be played', async () => {
    const r = rig(5, { turn: 1 });
    hold(r.e, 1, 'sha');
    const { mind, prompts } = minded([plan([{ card: 9999, targets: [3] }, { card: 4242 }])]);
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toBeNull();
    expect(await mind.answer(1, playAsk(r, 1), r.e)).toBeNull();
    expect(prompts).toHaveLength(1);
  });

  it('keeps a plan for each seat', async () => {
    const r = rig(5, { turn: 1 });
    const [a] = hold(r.e, 1, 'wuzhong');
    const [b] = hold(r.e, 2, 'wuzhong');
    const { mind, prompts } = minded([plan([{ card: a.id }]), plan([{ card: b.id }])]);
    expect((await mind.answer(1, playAsk(r, 1), r.e))?.reply).toMatchObject({ card: a.id });
    expect((await mind.answer(2, playAsk(r, 2), r.e))?.reply).toMatchObject({ card: b.id });
    expect(prompts.map((p) => p.seat)).toEqual([1, 2]);
  });
});

describe('the requests a mind makes', () => {
  it('stops at its budget, which the whole table shares, and the rules answer from then on', async () => {
    const r = rig(5, { turn: 2 });
    const { mind, prompts, thinking } = minded(['{"play": []}', null, '{"play": []}'], { budget: 2 });
    expect(await mind.answer(1, dying(1), r.e)).not.toBeNull();
    expect(await mind.answer(2, dying(1), r.e)).toBeNull();
    expect(await mind.answer(3, dying(1), r.e)).toBeNull();
    expect(prompts).toHaveLength(2);
    expect(thinking).toEqual(['+1', '-1', '+2', '-2']);
  });

  it('keeps a game to a good many requests', () => {
    expect(SGS_BUDGET).toBeGreaterThanOrEqual(100);
    expect(SGS_BUDGET).toBeLessThanOrEqual(200);
  });

  it('says when a seat starts and stops thinking, even when the request fails', async () => {
    const r = rig(5, { turn: 2 });
    const { mind, thinking } = minded(['{"play": []}', new Error('boom'), null]);
    expect(await mind.answer(1, dying(1), r.e)).not.toBeNull();
    expect(await mind.answer(2, dying(1), r.e)).toBeNull();
    expect(await mind.answer(3, dying(1), r.e)).toBeNull();
    expect(thinking).toEqual(['+1', '-1', '+2', '-2', '+3', '-3']);
  });

  it('is asked in the order the table asks', async () => {
    const r = rig(5, { turn: 1 });
    const seen: string[] = [];
    const { mind } = minded([], {
      ask: async (seat) => {
        seen.push(`ask ${seat}`);
        return '{"play": []}';
      },
      think: (seat, on) => {
        seen.push(`${on ? 'start' : 'stop'} ${seat}`);
      },
    });
    await mind.answer(1, dying(1), r.e);
    expect(seen).toEqual(['start 1', 'ask 1', 'stop 1']);
  });
});

// Whole games

/** A seeded generator whose first values differ from one seed to the next (mulberry32). */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A stand-in for a model: it reads the question as it is written and answers with the first thing offered. */
function model(text: string): string {
  if (text.includes('{"pick": <number>}')) return '{"pick": 1}';
  if (text.includes('"plan"')) {
    const lines = text.matchAll(/^\[(\d+)\] [^\n]*?: (?:no target|aim at \d+(?: to \d+)? of #(\d+))/gm);
    const steps = [...lines].map((m) => (m[2] === undefined ? { card: Number(m[1]) } : { card: Number(m[1]), targets: [Number(m[2])] }));
    return plan(steps, 'On we go.');
  }
  const card = /Cards you may play: \[(\d+)\]/.exec(text)?.[1];
  return JSON.stringify({ play: card === undefined ? [] : [Number(card)] });
}

/** What is wrong with a reply of a mind to a question, apart from the plays of the play phase. */
function wrong(ask: Ask, reply: Reply): string | null {
  if (reply.k === 'hero') return ask.k === 'hero' && ask.heroes.includes(reply.hero) ? null : 'a hero that was not offered';
  if (reply.k !== 'cards') return null;
  const fits = ask.k === 'cards' && reply.ids.every((id) => ask.cards.includes(id))
    && reply.ids.length >= ask.min && reply.ids.length <= ask.max;
  return fits ? null : 'cards that do not fit';
}

/** A game of `size` from `seed`, the rules in seat 0 and the minds, answered by `reply`, in the others. */
async function played(size: Size, seed: number, reply: (text: string) => string | null, withMinds = true) {
  const random = seeded(seed);
  const roles = shuffle([...ROLE_SETS[size]], random);
  const bots = new Bots(roles, random);
  const prompts: string[] = [];
  const entries: Entry[] = [];
  const faults: string[] = [];
  const said: string[] = [];
  const mind = makeSgsMind({
    names,
    character: (seat) => ({ name: NAMES[seat] ?? `Seat ${seat}`, persona: '' }),
    language: 'English',
    ask: async (_seat, text) => {
      prompts.push(text);
      return reply(text);
    },
  });
  /** A play of a mind that the table has not taken yet. */
  let waiting = false;
  let taken = 0;
  let refused = 0;
  const outcome = await runSanguosha(
    {
      random,
      ask: async (seat, ask, e) => {
        if (waiting) refused++;
        waiting = false;
        const thought = seat === 0 || !withMinds ? null : await mind.answer(seat, ask, e);
        if (!thought) return bots.answer(seat, ask, e);
        const fault = wrong(ask, thought.reply);
        if (fault) faults.push(`seat ${seat}: ${fault}: ${JSON.stringify(ask)} -> ${JSON.stringify(thought.reply)}`);
        if (thought.say) said.push(thought.say);
        waiting = thought.reply.k === 'use';
        return thought.reply;
      },
      emit: (entry, e) => {
        entries.push(entry);
        bots.observe(entry, e);
        mind.observe(entry, e);
        if (entry.k === 'use' && waiting) {
          waiting = false;
          taken++;
        }
      },
      stopped: () => false,
    },
    roles,
  );
  return { outcome, entries, prompts, faults, said, taken, refused };
}

describe.each([5, 8] as const)('a game at a table of %i with minds', (size) => {
  it('is played out, and the table takes every play the minds make', async () => {
    const game = await played(size, 3, model);
    expect(game.outcome?.turns).toBeGreaterThan(3);
    expect(game.faults).toEqual([]);
    expect(game.refused).toBe(0);
    expect(game.taken).toBeGreaterThan(5);
    expect(game.said.length).toBeGreaterThan(0);
    expect(game.prompts.length).toBeGreaterThan(5);
    expect(game.prompts.length).toBeLessThanOrEqual(SGS_BUDGET);
  }, 60_000);

  it('is played out the same from seed to seed', async () => {
    const a = await played(size, 11, model);
    const b = await played(size, 11, model);
    expect(b.entries).toEqual(a.entries);
    expect(b.prompts).toEqual(a.prompts);
  }, 60_000);

  it('is the rules\' game when the minds cannot answer', async () => {
    const rules = await played(size, 5, () => null, false);
    const silent = await played(size, 5, () => null);
    const babble = await played(size, 5, () => 'I would rather not say.');
    expect(rules.entries.length).toBeGreaterThan(50);
    expect(silent.prompts.length).toBeGreaterThan(0);
    expect(babble.prompts.length).toBeGreaterThan(0);
    expect(silent.entries).toEqual(rules.entries);
    expect(babble.entries).toEqual(rules.entries);
  }, 60_000);
});
