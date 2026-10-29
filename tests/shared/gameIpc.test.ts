import { describe, expect, it } from 'vitest';
import { PET_GAMES, isPetGame, parsePicks, parseWolfIn } from '../../src/shared/gameIpc';
import { PET_IDS, type PetId } from '../../src/shared/teammate/pet';
import { SEATS } from '../../src/shared/teammate/werewolf';

const [a, b, c] = PET_IDS as readonly PetId[];
const everyone: PetId[] = PET_IDS.slice(0, SEATS);

describe('isPetGame', () => {
  it('knows the three games', () => {
    expect(isPetGame('werewolf')).toBe(true);
    expect(isPetGame('mahjong')).toBe(true);
    expect(isPetGame('fight')).toBe(true);
    expect(PET_GAMES.every(isPetGame)).toBe(true);
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
