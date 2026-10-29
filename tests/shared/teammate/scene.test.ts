import { describe, expect, it } from 'vitest';
import { strings } from '../../../src/shared/i18n';
import { PET_IDS, type PetId } from '../../../src/shared/teammate/pet';
import { fillCount, mahjongSceneText, pickCast, togglePick } from '../../../src/shared/teammate/scene';

const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('pickCast', () => {
  const all: PetId[] = [...PET_IDS];

  it('seats the pets on the desktop first, in their order', () => {
    expect(pickCast(['mao', 'whale'], all, 4, lcg(1)).slice(0, 2)).toEqual(['mao', 'whale']);
  });

  it('fills the rest of the table with other pets, each once', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const cast = pickCast(['senko'], all, 4, lcg(seed));
      expect(cast).toHaveLength(4);
      expect(cast[0]).toBe('senko');
      expect(new Set(cast).size).toBe(4);
    }
  });

  it('seats at most `count` of the pets on the desktop', () => {
    expect(pickCast(['whale', 'naiwa', 'shenshen', 'airi', 'mao'], all, 4, lcg(1))).toEqual([
      'whale', 'naiwa', 'shenshen', 'airi',
    ]);
  });

  it('leaves out a pet whose files are not installed', () => {
    const installed: PetId[] = ['whale', 'airi', 'mao'];
    const cast = pickCast(['javelin', 'mao'], installed, 4, lcg(1));
    expect(cast[0]).toBe('mao');
    expect([...cast].sort()).toEqual(['airi', 'mao', 'whale']);
  });

  it('seats fewer when fewer are installed, and nobody when none is', () => {
    expect(pickCast(['whale'], ['whale'], 4, lcg(1))).toEqual(['whale']);
    expect(pickCast(['whale'], [], 4, lcg(1))).toEqual([]);
    expect(pickCast([], all, 0, lcg(1))).toEqual([]);
  });

  it('mixes the others up, and the same way for the same random', () => {
    const casts = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) casts.add(pickCast([], all, 4, lcg(seed)).join());
    expect(casts.size).toBeGreaterThan(10);
    expect(pickCast([], all, 4, lcg(9))).toEqual(pickCast([], all, 4, lcg(9)));
  });

  it('does not change what it is given', () => {
    const on: PetId[] = ['mao'];
    const copy = [...all];
    pickCast(on, all, 4, lcg(3));
    expect(on).toEqual(['mao']);
    expect(all).toEqual(copy);
  });
});

describe('togglePick', () => {
  it('seats a pet that is not at the table, after the others', () => {
    expect(togglePick(['whale'], 'mao', 4)).toEqual(['whale', 'mao']);
    expect(togglePick([], 'mao', 4)).toEqual(['mao']);
  });

  it('stands a pet that is at the table up, and the others keep their order', () => {
    expect(togglePick(['whale', 'mao', 'airi'], 'mao', 4)).toEqual(['whale', 'airi']);
  });

  it('keeps the last pet at the table', () => {
    expect(togglePick(['mao'], 'mao', 4)).toEqual(['mao']);
  });

  it('puts a new pet in the place of the one that sat first when the table is full', () => {
    expect(togglePick(['whale', 'naiwa', 'airi', 'mao'], 'senko', 4)).toEqual(['naiwa', 'airi', 'mao', 'senko']);
    expect(togglePick(['whale'], 'mao', 1)).toEqual(['mao']);
  });

  it('does not change what it is given', () => {
    const cast: PetId[] = ['whale', 'mao'];
    togglePick(cast, 'mao', 4);
    togglePick(cast, 'airi', 4);
    expect(cast).toEqual(['whale', 'mao']);
    const one: PetId[] = ['mao'];
    expect(togglePick(one, 'mao', 4)).not.toBe(one);
  });
});

describe('fillCount', () => {
  it('puts the number where the {n} is', () => {
    expect(fillCount('Wall {n}', 70)).toBe('Wall 70');
    expect(fillCount('第 {n} 局', 3)).toBe('第 3 局');
  });

  it('leaves a string without a place for it as it is', () => {
    expect(fillCount('Wall', 70)).toBe('Wall');
  });
});

describe('mahjongSceneText', () => {
  const KINDS =  ['draw', 'think', 'throw', 'tease', 'pong', 'chow', 'win', 'lose', 'cheer'];
  const WORDS = [
    'wall', 'round', 'loading', 'failed', 'empty', 'seats', 'reseat', 'soundOn', 'soundOff', 'shuffle', 'dealer', 'drawGame',
    'pong', 'chow', 'tsumo', 'ron',
  ];

  for (const lang of ['en', 'zh-CN'] as const) {
    describe(lang, () => {
      const g = strings(lang, 'win').teammate.games;
      const text = mahjongSceneText(g);

      it('has a title and every word the page shows', () => {
        expect(text.title).toBe(g.mahjongTitle);
        expect(text.title.length).toBeGreaterThan(0);
        for (const w of WORDS) expect(text.words[w]?.trim().length, w).toBeGreaterThan(0);
      });

      it('leaves a place for the number in the wall and round counters', () => {
        expect(text.words.wall).toContain('{n}');
        expect(text.words.round).toContain('{n}');
      });

      it('has lines for every moment, several each so the pets do not repeat themselves', () => {
        for (const k of KINDS) {
          const lines = text.lines[k] ?? [];
          expect(lines.length, k).toBeGreaterThanOrEqual(3);
          expect(new Set(lines).size, k).toBe(lines.length);
          for (const l of lines) expect(l.trim().length).toBeGreaterThan(0);
        }
      });

      it('is a copy: changing it does not change the words', () => {
        text.lines.win?.push('x');
        expect(g.mahjong.lines.win).not.toContain('x');
      });
    });
  }

  it('speaks in the user\'s language', () => {
    expect(mahjongSceneText(strings('zh-CN', 'win').teammate.games).title).not.toBe(
      mahjongSceneText(strings('en', 'win').teammate.games).title,
    );
  });
});
