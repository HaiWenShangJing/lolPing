import { describe, expect, it } from 'vitest';
import { PET_GAMES, isPetGame, parsePicks, parseReply, parseSgsIn, parseWolfIn } from '../../src/shared/gameIpc';
import { PET_IDS, type PetId } from '../../src/shared/teammate/pet';
import { CARD_NAMES, DECK_SIZE } from '../../src/shared/teammate/sanguoshaCards';
import { HERO_IDS, SKILLS } from '../../src/shared/teammate/sanguoshaHeroes';
import { SEATS } from '../../src/shared/teammate/werewolf';

const [a, b, c] = PET_IDS as readonly PetId[];
const everyone: PetId[] = PET_IDS.slice(0, SEATS);

describe('isPetGame', () => {
  it('knows the four games', () => {
    expect(isPetGame('werewolf')).toBe(true);
    expect(isPetGame('sanguosha')).toBe(true);
    expect(isPetGame('mahjong')).toBe(true);
    expect(isPetGame('fight')).toBe(true);
    expect(PET_GAMES.every(isPetGame)).toBe(true);
    expect(PET_GAMES).toHaveLength(4);
  });

  it('refuses anything else', () => {
    expect(isPetGame('chess')).toBe(false);
    expect(isPetGame('Werewolf')).toBe(false);
    expect(isPetGame(undefined)).toBe(false);
    expect(isPetGame(null)).toBe(false);
    expect(isPetGame(3)).toBe(false);
  });
});

describe('parsePicks', () => {
  it('keeps real pets once each, up to the seats there are', () => {
    expect(parsePicks([a, b, a, c], 5)).toEqual([a, b, c]);
    expect(parsePicks([a, b, c], 2)).toEqual([a, b]);
    expect(parsePicks([], 5)).toEqual([]);
  });

  it('keeps as many pets as sit with a user who plays, or with one who only watches', () => {
    expect(parsePicks(everyone, SEATS - 1)).toEqual(everyone.slice(0, SEATS - 1));
    expect(parsePicks(everyone, SEATS)).toEqual(everyone);
  });

  it('refuses anything that is not a list of pets', () => {
    expect(parsePicks(a, 5)).toBeNull();
    expect(parsePicks(undefined, 5)).toBeNull();
    expect(parsePicks({ 0: a }, 5)).toBeNull();
    expect(parsePicks([a, 'dragon'], 5)).toBeNull();
    expect(parsePicks([1], 5)).toBeNull();
    expect(parsePicks([null], 5)).toBeNull();
    expect(parsePicks(new Array<string>(PET_IDS.length + 1).fill(a as string), 5)).toBeNull();
  });
});

describe('parseWolfIn', () => {
  it('reads each message of the werewolf page', () => {
    expect(parseWolfIn({ t: 'start', pets: [a], play: true })).toEqual({ t: 'start', pets: [a], play: true });
    expect(parseWolfIn({ t: 'start', pets: [a, b], play: false })).toEqual({ t: 'start', pets: [a, b], play: false });
    expect(parseWolfIn({ t: 'target', seat: 3 })).toEqual({ t: 'target', seat: 3 });
    expect(parseWolfIn({ t: 'vote', seat: 2 })).toEqual({ t: 'vote', seat: 2 });
    expect(parseWolfIn({ t: 'vote', seat: null })).toEqual({ t: 'vote', seat: null });
    expect(parseWolfIn({ t: 'pick', seat: 12 })).toEqual({ t: 'pick', seat: 12 });
    expect(parseWolfIn({ t: 'pick', seat: null })).toEqual({ t: 'pick', seat: null });
    expect(parseWolfIn({ t: 'say', text: 'I am the seer' })).toEqual({ t: 'say', text: 'I am the seer' });
    expect(parseWolfIn({ t: 'say', text: '' })).toEqual({ t: 'say', text: '' });
    expect(parseWolfIn({ t: 'witch', save: true, poison: null })).toEqual({ t: 'witch', save: true, poison: null });
    expect(parseWolfIn({ t: 'witch', save: false, poison: 4 })).toEqual({ t: 'witch', save: false, poison: 4 });
    expect(parseWolfIn({ t: 'run', run: true })).toEqual({ t: 'run', run: true });
    expect(parseWolfIn({ t: 'run', run: false })).toEqual({ t: 'run', run: false });
    expect(parseWolfIn({ t: 'boom' })).toEqual({ t: 'boom' });
    expect(parseWolfIn({ t: 'again' })).toEqual({ t: 'again' });
  });

  it('takes a start that does not say whether the user plays as a game he plays in', () => {
    expect(parseWolfIn({ t: 'start', pets: [a] })).toEqual({ t: 'start', pets: [a], play: true });
  });

  it('refuses a start whose `play` is not a boolean', () => {
    for (const play of ['yes', 1, 0, null, [], {}]) {
      expect(parseWolfIn({ t: 'start', pets: [a], play }), JSON.stringify(play)).toBeNull();
    }
  });

  it('names at most eleven pets for a user who plays and twelve for one who only watches', () => {
    expect(parseWolfIn({ t: 'start', pets: everyone, play: true })).toEqual({
      t: 'start', pets: everyone.slice(0, SEATS - 1), play: true,
    });
    expect(parseWolfIn({ t: 'start', pets: everyone, play: false })).toEqual({
      t: 'start', pets: everyone, play: false,
    });
    expect(parseWolfIn({ t: 'start', pets: everyone })).toEqual({
      t: 'start', pets: everyone.slice(0, SEATS - 1), play: true,
    });
  });

  it('counts the seats of the table it is given', () => {
    const six = PET_IDS.slice(0, 6);
    expect(parseWolfIn({ t: 'start', pets: six }, 5)).toEqual({ t: 'start', pets: six.slice(0, 4), play: true });
    expect(parseWolfIn({ t: 'start', pets: six, play: false }, 5)).toEqual({
      t: 'start', pets: six.slice(0, 5), play: false,
    });
  });

  it('seats nobody but the pets it names, and none twice', () => {
    expect(parseWolfIn({ t: 'start', pets: [] })).toEqual({ t: 'start', pets: [], play: true });
    expect(parseWolfIn({ t: 'start', pets: [a, b, a, b, c] })).toEqual({ t: 'start', pets: [a, b, c], play: true });
  });

  it('refuses a start that names anything but pets', () => {
    expect(parseWolfIn({ t: 'start', pets: ['nobody'] })).toBeNull();
    expect(parseWolfIn({ t: 'start', pets: [a, 5] })).toBeNull();
    expect(parseWolfIn({ t: 'start', pets: a })).toBeNull();
    expect(parseWolfIn({ t: 'start', pets: null })).toBeNull();
    expect(parseWolfIn({ t: 'start' })).toBeNull();
    expect(parseWolfIn({ t: 'start', pets: new Array<string>(PET_IDS.length + 1).fill(a as string) })).toBeNull();
  });

  it('knows the twelve seats: every message that names one takes 1 to 12', () => {
    for (let seat = 1; seat <= SEATS; seat++) {
      expect(parseWolfIn({ t: 'target', seat })).toEqual({ t: 'target', seat });
      expect(parseWolfIn({ t: 'vote', seat })).toEqual({ t: 'vote', seat });
      expect(parseWolfIn({ t: 'pick', seat })).toEqual({ t: 'pick', seat });
      const poison = { t: 'witch', save: false, poison: seat };
      expect(parseWolfIn(poison)).toEqual(poison);
    }
  });

  it('refuses seats that are not at the table', () => {
    const strange = [0, -1, SEATS + 1, 99, 1.5, NaN, Infinity, '2', undefined, true, [], {}];
    for (const seat of strange) {
      const shown = String(seat);
      expect(parseWolfIn({ t: 'target', seat }), `target ${shown}`).toBeNull();
      expect(parseWolfIn({ t: 'vote', seat }), `vote ${shown}`).toBeNull();
      expect(parseWolfIn({ t: 'pick', seat }), `pick ${shown}`).toBeNull();
      expect(parseWolfIn({ t: 'witch', save: true, poison: seat }), `poison ${shown}`).toBeNull();
    }
    expect(parseWolfIn({ t: 'target', seat: null })).toBeNull();
    expect(parseWolfIn({ t: 'target' })).toBeNull();
    expect(parseWolfIn({ t: 'vote' })).toBeNull();
    expect(parseWolfIn({ t: 'pick' })).toBeNull();
  });

  it('lets a vote, a shot and a badge name nobody, and a target never', () => {
    expect(parseWolfIn({ t: 'vote', seat: null })).toEqual({ t: 'vote', seat: null });
    expect(parseWolfIn({ t: 'pick', seat: null })).toEqual({ t: 'pick', seat: null });
    expect(parseWolfIn({ t: 'target', seat: null })).toBeNull();
  });

  it('cuts a long speech short', () => {
    expect(parseWolfIn({ t: 'say', text: 'x'.repeat(5000) })).toEqual({ t: 'say', text: 'x'.repeat(400) });
    expect(parseWolfIn({ t: 'say', text: 'y'.repeat(400) })).toEqual({ t: 'say', text: 'y'.repeat(400) });
  });

  it('refuses a speech that is not text', () => {
    for (const text of [5, null, undefined, ['x'], { length: 1 }, true]) {
      expect(parseWolfIn({ t: 'say', text }), String(text)).toBeNull();
    }
    expect(parseWolfIn({ t: 'say' })).toBeNull();
  });

  it('refuses a witch message that is not a yes or no and a seat or nobody', () => {
    expect(parseWolfIn({ t: 'witch', save: 'yes', poison: null })).toBeNull();
    expect(parseWolfIn({ t: 'witch', save: 1, poison: null })).toBeNull();
    expect(parseWolfIn({ t: 'witch', poison: null })).toBeNull();
    expect(parseWolfIn({ t: 'witch', save: true, poison: 99 })).toBeNull();
    expect(parseWolfIn({ t: 'witch', save: true, poison: '3' })).toBeNull();
    expect(parseWolfIn({ t: 'witch', save: true })).toBeNull();
  });

  it('refuses a run message that is not a yes or no', () => {
    for (const run of ['yes', 1, 0, null, undefined, []]) {
      expect(parseWolfIn({ t: 'run', run }), String(run)).toBeNull();
    }
    expect(parseWolfIn({ t: 'run' })).toBeNull();
  });

  it('reads the fields it needs and no others', () => {
    expect(parseWolfIn({ t: 'boom', seat: 3, extra: 'x' })).toEqual({ t: 'boom' });
    expect(parseWolfIn({ t: 'again', play: false })).toEqual({ t: 'again' });
    expect(parseWolfIn({ t: 'vote', seat: 2, text: 'hi' })).toEqual({ t: 'vote', seat: 2 });
    expect(parseWolfIn({ t: 'start', pets: [a], play: true, seat: 4 })).toEqual({ t: 'start', pets: [a], play: true });
  });

  it('ignores whatever is not a message of the page', () => {
    expect(parseWolfIn({ t: 'discard', at: 1 })).toBeNull();
    expect(parseWolfIn({ t: 'START', pets: [] })).toBeNull();
    expect(parseWolfIn({ t: 5 })).toBeNull();
    expect(parseWolfIn({ kind: 'boom' })).toBeNull();
    expect(parseWolfIn({})).toBeNull();
    expect(parseWolfIn(null)).toBeNull();
    expect(parseWolfIn(undefined)).toBeNull();
    expect(parseWolfIn([])).toBeNull();
    expect(parseWolfIn([{ t: 'boom' }])).toBeNull();
    expect(parseWolfIn('start')).toBeNull();
    expect(parseWolfIn(42)).toBeNull();
    expect(parseWolfIn(true)).toBeNull();
  });
});

describe('parseReply', () => {
  const hero = HERO_IDS[0];
  const skill = SKILLS[0];

  it('reads each answer the Sanguosha table asks for', () => {
    expect(parseReply({ k: 'hero', hero })).toEqual({ k: 'hero', hero });
    expect(parseReply({ k: 'use', card: 7, as: 'sha', targets: [2] })).toEqual({
      k: 'use', card: 7, as: 'sha', targets: [2],
    });
    expect(parseReply({ k: 'use', card: 7, as: 'tao', skill, targets: [] })).toEqual({
      k: 'use', card: 7, as: 'tao', skill, targets: [],
    });
    expect(parseReply({ k: 'skill', skill, cards: [3, 4], targets: [1] })).toEqual({
      k: 'skill', skill, cards: [3, 4], targets: [1],
    });
    expect(parseReply({ k: 'end' })).toEqual({ k: 'end' });
    expect(parseReply({ k: 'cards', ids: [1, DECK_SIZE] })).toEqual({ k: 'cards', ids: [1, DECK_SIZE] });
    expect(parseReply({ k: 'cards', ids: [] })).toEqual({ k: 'cards', ids: [] });
    expect(parseReply({ k: 'area', zone: 'hand', card: null })).toEqual({ k: 'area', zone: 'hand', card: null });
    expect(parseReply({ k: 'area', zone: 'equip', card: 9 })).toEqual({ k: 'area', zone: 'equip', card: 9 });
    expect(parseReply({ k: 'area', zone: 'judge', card: 12 })).toEqual({ k: 'area', zone: 'judge', card: 12 });
    expect(parseReply({ k: 'seat', seats: [0, 7] })).toEqual({ k: 'seat', seats: [0, 7] });
    expect(parseReply({ k: 'confirm', yes: true })).toEqual({ k: 'confirm', yes: true });
    expect(parseReply({ k: 'confirm', yes: false })).toEqual({ k: 'confirm', yes: false });
  });

  it('leaves the skill out of a card played as itself, which the table needs', () => {
    const reply = parseReply({ k: 'use', card: 7, as: 'sha', targets: [2] });
    expect(reply && 'skill' in reply).toBe(false);
  });

  it('knows every card, hero and skill there is and no other', () => {
    for (const as of CARD_NAMES) expect(parseReply({ k: 'use', card: 1, as, targets: [] }), as).not.toBeNull();
    for (const h of HERO_IDS) expect(parseReply({ k: 'hero', hero: h }), h).not.toBeNull();
    for (const s of SKILLS) expect(parseReply({ k: 'skill', skill: s, cards: [], targets: [] }), s).not.toBeNull();
    expect(parseReply({ k: 'use', card: 1, as: 'bomb', targets: [] })).toBeNull();
    expect(parseReply({ k: 'use', card: 1, as: 'sha', skill: 'fly', targets: [] })).toBeNull();
    expect(parseReply({ k: 'hero', hero: 'nobody' })).toBeNull();
    expect(parseReply({ k: 'skill', skill: 'fly', cards: [], targets: [] })).toBeNull();
  });

  it('takes the cards of the deck, from the first to the last', () => {
    expect(parseReply({ k: 'cards', ids: [1] })).not.toBeNull();
    expect(parseReply({ k: 'cards', ids: [DECK_SIZE] })).not.toBeNull();
    for (const id of [0, -1, DECK_SIZE + 1, 1.5, NaN, '3', null, undefined, {}, []]) {
      expect(parseReply({ k: 'cards', ids: [id] }), String(id)).toBeNull();
      expect(parseReply({ k: 'use', card: id, as: 'sha', targets: [] }), `use ${String(id)}`).toBeNull();
      expect(parseReply({ k: 'skill', skill, cards: [id], targets: [] }), `skill ${String(id)}`).toBeNull();
    }
    expect(parseReply({ k: 'cards', ids: new Array<number>(DECK_SIZE + 1).fill(1) })).toBeNull();
    expect(parseReply({ k: 'cards', ids: 3 })).toBeNull();
    expect(parseReply({ k: 'cards' })).toBeNull();
  });

  it('takes the seats of the biggest table, from the first to the eighth', () => {
    expect(parseReply({ k: 'seat', seats: [0, 1, 2, 3, 4, 5, 6, 7] })).not.toBeNull();
    for (const seat of [-1, 8, 99, 0.5, NaN, Infinity, '1', null, undefined, true, []]) {
      expect(parseReply({ k: 'seat', seats: [seat] }), String(seat)).toBeNull();
      expect(parseReply({ k: 'use', card: 1, as: 'sha', targets: [seat] }), `use ${String(seat)}`).toBeNull();
      expect(parseReply({ k: 'skill', skill, cards: [], targets: [seat] }), `skill ${String(seat)}`).toBeNull();
    }
    expect(parseReply({ k: 'seat', seats: [0, 1, 2, 3, 4, 5, 6, 7, 0] })).toBeNull();
    expect(parseReply({ k: 'seat', seats: 2 })).toBeNull();
    expect(parseReply({ k: 'seat' })).toBeNull();
    expect(parseReply({ k: 'use', card: 1, as: 'sha' })).toBeNull();
  });

  it('refuses an area answer that names no zone of a player or a card that is not one', () => {
    expect(parseReply({ k: 'area', zone: 'pile', card: 3 })).toBeNull();
    expect(parseReply({ k: 'area', card: 3 })).toBeNull();
    expect(parseReply({ k: 'area', zone: 'hand', card: 0 })).toBeNull();
    expect(parseReply({ k: 'area', zone: 'hand', card: DECK_SIZE + 1 })).toBeNull();
    expect(parseReply({ k: 'area', zone: 'hand', card: 'x' })).toBeNull();
    expect(parseReply({ k: 'area', zone: 'hand' })).toEqual({ k: 'area', zone: 'hand', card: null });
  });

  it('refuses a confirmation that is not a yes or no', () => {
    for (const yes of ['yes', 1, 0, null, undefined, []]) {
      expect(parseReply({ k: 'confirm', yes }), String(yes)).toBeNull();
    }
  });

  it('ignores whatever is not an answer', () => {
    expect(parseReply({ k: 'pass' })).toBeNull();
    expect(parseReply({ t: 'end' })).toBeNull();
    expect(parseReply({})).toBeNull();
    expect(parseReply(null)).toBeNull();
    expect(parseReply(undefined)).toBeNull();
    expect(parseReply([])).toBeNull();
    expect(parseReply('end')).toBeNull();
    expect(parseReply(7)).toBeNull();
  });
});

describe('parseSgsIn', () => {
  it('reads each message of the Sanguosha page', () => {
    expect(parseSgsIn({ t: 'start', pets: [a, b], size: 5 })).toEqual({ t: 'start', pets: [a, b], size: 5 });
    expect(parseSgsIn({ t: 'start', pets: [], size: 8 })).toEqual({ t: 'start', pets: [], size: 8 });
    expect(parseSgsIn({ t: 'reply', reply: { k: 'end' } })).toEqual({ t: 'reply', reply: { k: 'end' } });
    expect(parseSgsIn({ t: 'again' })).toEqual({ t: 'again' });
  });

  it('seats at most one pet fewer than the table, since the user takes a seat', () => {
    expect(parseSgsIn({ t: 'start', pets: everyone, size: 5 })).toEqual({ t: 'start', pets: everyone.slice(0, 4), size: 5 });
    expect(parseSgsIn({ t: 'start', pets: everyone, size: 8 })).toEqual({ t: 'start', pets: everyone.slice(0, 7), size: 8 });
  });

  it('seats nobody but the pets it names, and none twice', () => {
    expect(parseSgsIn({ t: 'start', pets: [a, b, a, c], size: 5 })).toEqual({ t: 'start', pets: [a, b, c], size: 5 });
    expect(parseSgsIn({ t: 'start', pets: ['nobody'], size: 5 })).toBeNull();
    expect(parseSgsIn({ t: 'start', pets: a, size: 5 })).toBeNull();
    expect(parseSgsIn({ t: 'start', size: 5 })).toBeNull();
  });

  it('plays only the sizes there are: five or eight', () => {
    for (const size of [0, 1, 2, 3, 4, 6, 7, 9, 12, '5', null, undefined, 5.5, NaN]) {
      expect(parseSgsIn({ t: 'start', pets: [], size }), String(size)).toBeNull();
    }
    expect(parseSgsIn({ t: 'start', pets: [] })).toBeNull();
  });

  it('passes on an answer only when it is one', () => {
    expect(parseSgsIn({ t: 'reply', reply: { k: 'bomb' } })).toBeNull();
    expect(parseSgsIn({ t: 'reply' })).toBeNull();
    expect(parseSgsIn({ t: 'reply', reply: null })).toBeNull();
    expect(parseSgsIn({ t: 'reply', reply: { k: 'confirm', yes: true } })).toEqual({
      t: 'reply', reply: { k: 'confirm', yes: true },
    });
  });

  it('reads the fields it needs and no others', () => {
    expect(parseSgsIn({ t: 'again', size: 8, play: false })).toEqual({ t: 'again' });
    expect(parseSgsIn({ t: 'start', pets: [a], size: 5, play: false })).toEqual({ t: 'start', pets: [a], size: 5 });
  });

  it('ignores whatever is not a message of the page, werewolf messages included', () => {
    expect(parseSgsIn({ t: 'boom' })).toBeNull();
    expect(parseSgsIn({ t: 'vote', seat: 2 })).toBeNull();
    expect(parseSgsIn({ t: 'START', pets: [], size: 5 })).toBeNull();
    expect(parseSgsIn({ kind: 'again' })).toBeNull();
    expect(parseSgsIn({})).toBeNull();
    expect(parseSgsIn(null)).toBeNull();
    expect(parseSgsIn(undefined)).toBeNull();
    expect(parseSgsIn([])).toBeNull();
    expect(parseSgsIn('again')).toBeNull();
    expect(parseSgsIn(5)).toBeNull();
  });

  it('is not fooled by a werewolf start that has no size', () => {
    expect(parseSgsIn({ t: 'start', pets: [a], play: true })).toBeNull();
  });
});
