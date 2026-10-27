import { describe, expect, it } from 'vitest';
import {
  MEMORY_ITEM_MAX, MEMORY_MAX_ITEMS, addMemory, cleanNote, looksSecret, memoryText, normalizeMemory, parseMemoryText,
  rememberReply,
} from '../../../src/shared/teammate/memory';

describe('cleanNote', () => {
  it('makes one trimmed line with single spaces', () => {
    expect(cleanNote('  likes\n short   answers \t')).toBe('likes short answers');
  });

  it('cuts a long note to the limit with an ellipsis', () => {
    const note = cleanNote('a '.repeat(200));
    expect(note.length).toBeLessThanOrEqual(MEMORY_ITEM_MAX);
    expect(note.endsWith('…')).toBe(true);
  });
});

describe('looksSecret', () => {
  it.each([
    'my key is sk-abcdefghijklmnopqrstuvwx',
    'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'password is hunter2',
    'My password: hunter2',
    '我的密码是 123456',
    'card 4111 1111 1111 1111',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'AKIAABCDEFGHIJKLMNOP',
    'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8',
  ])('flags %s', (text) => {
    expect(looksSecret(text)).toBe(true);
  });

  it.each([
    'Prefers short answers in Chinese',
    'Call me Sam',
    'Works on a Windows PC and uses Visual Studio Code',
    '喜欢简短的回答',
    'Phone model is Pixel 8, 128 GB',
  ])('lets %s through', (text) => {
    expect(looksSecret(text)).toBe(false);
  });
});

describe('normalizeMemory', () => {
  it('is empty for anything but an array', () => {
    expect(normalizeMemory(undefined)).toEqual([]);
    expect(normalizeMemory('a')).toEqual([]);
    expect(normalizeMemory({})).toEqual([]);
  });

  it('cleans notes, drops blanks and non-strings, and keeps the later of two repeats', () => {
    expect(normalizeMemory([' A  ', '', 3, 'b', 'a', null])).toEqual(['b', 'a']);
  });

  it('keeps the newest notes at the cap', () => {
    const many = Array.from({ length: MEMORY_MAX_ITEMS + 5 }, (_, i) => `note ${i}`);
    const out = normalizeMemory(many);
    expect(out).toHaveLength(MEMORY_MAX_ITEMS);
    expect(out[0]).toBe('note 5');
    expect(out.at(-1)).toBe(`note ${MEMORY_MAX_ITEMS + 4}`);
  });

  it('keeps what the user typed even when it looks like a secret', () => {
    expect(normalizeMemory(['password is hunter2'])).toEqual(['password is hunter2']);
  });
});

describe('addMemory', () => {
  it('adds a cleaned note at the end', () => {
    expect(addMemory(['a'], ' b \n c ')).toEqual({ outcome: 'saved', items: ['a', 'b c'] });
  });

  it('ignores a note already there, whatever its case', () => {
    expect(addMemory(['Call me Sam'], 'call me sam')).toEqual({ outcome: 'known', items: ['Call me Sam'] });
  });

  it('refuses blank text and secrets', () => {
    expect(addMemory(['a'], '   ')).toEqual({ outcome: 'empty', items: ['a'] });
    expect(addMemory(['a'], 'password is hunter2')).toEqual({ outcome: 'secret', items: ['a'] });
  });

  it('drops the oldest note when full', () => {
    const full = Array.from({ length: MEMORY_MAX_ITEMS }, (_, i) => `note ${i}`);
    const r = addMemory(full, 'newest');
    expect(r.outcome).toBe('saved');
    expect(r.items).toHaveLength(MEMORY_MAX_ITEMS);
    expect(r.items[0]).toBe('note 1');
    expect(r.items.at(-1)).toBe('newest');
  });

  it('does not change the list it was given', () => {
    const items = ['a'];
    addMemory(items, 'b');
    expect(items).toEqual(['a']);
  });
});

describe('the settings text', () => {
  it('is one note per line and reads back the same', () => {
    const items = ['Call me Sam', 'Answers in Chinese'];
    expect(memoryText(items)).toBe('Call me Sam\nAnswers in Chinese');
    expect(parseMemoryText('Call me Sam\r\n\r\n Answers in Chinese \n')).toEqual(items);
  });
});

describe('rememberReply', () => {
  it('tells the model what happened to its note', () => {
    expect(rememberReply('saved')).toBe('Remembered.');
    expect(rememberReply('secret')).toContain('Not remembered');
    expect(new Set(['saved', 'known', 'empty', 'secret'].map((o) => rememberReply(o as 'saved'))).size).toBe(4);
  });
});
