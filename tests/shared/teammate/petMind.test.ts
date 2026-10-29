import { describe, expect, it } from 'vitest';
import { PET_IDS } from '../../../src/shared/teammate/pet';
import {
  DEFAULT_PERSONAS, NOTE_MAX, NOTES_MAX, addNote, forgetNote, noteLines, normalizeNotes, personaOf,
  type PetNote,
} from '../../../src/shared/teammate/petMind';
import { cleanLine, modelId } from '../../../src/shared/teammate/petText';

const note = (text: string, about: PetNote['about'] = null, at = 1): PetNote => ({ text, about, at });

describe('modelId', () => {
  it('accepts the ids Copilot CLI uses and nothing else', () => {
    for (const id of ['auto', 'claude-sonnet-5.5', 'gpt-6.1-sol', 'gemini-4-argon', 'a:b_c']) expect(modelId(id)).toBe(id);
    for (const bad of ['', ' x', '-x', 'a b', 'a/b', 'x'.repeat(65), 7, null, undefined]) expect(modelId(bad)).toBeNull();
  });
});

describe('cleanLine', () => {
  it('collapses whitespace, trims and cuts', () => {
    expect(cleanLine('  a \n b\t c ', 50)).toBe('a b c');
    expect(cleanLine('abcdef', 3)).toBe('abc');
    expect(cleanLine(5, 3)).toBe('');
  });
});

describe('personaOf', () => {
  it('uses what the user wrote, else the character\'s own', () => {
    expect(personaOf('airi', '  ')).toBe(DEFAULT_PERSONAS.airi);
    expect(personaOf('airi', ' a pirate ')).toBe('a pirate');
    for (const id of PET_IDS) expect(DEFAULT_PERSONAS[id].length).toBeGreaterThan(20);
  });
});

describe('normalizeNotes', () => {
  it('keeps good notes and drops the rest', () => {
    const notes = normalizeNotes([
      { text: ' likes   tea ', about: 'user', at: 5 }, { text: '', about: 'user' }, 'x', null,
      { text: 'airi is loud', about: 'airi' }, { text: 'odd', about: 'nobody', at: 'x' },
    ]);
    expect(notes).toEqual([
      { text: 'likes tea', about: 'user', at: 5 }, { text: 'airi is loud', about: 'airi', at: 0 },
      { text: 'odd', about: null, at: 0 },
    ]);
  });

  it('is empty for anything that is not a list, and keeps only the newest ones', () => {
    expect(normalizeNotes({})).toEqual([]);
    const many = Array.from({ length: NOTES_MAX + 5 }, (_, i) => ({ text: `n${i}` }));
    const kept = normalizeNotes(many);
    expect(kept).toHaveLength(NOTES_MAX);
    expect(kept[0].text).toBe('n5');
  });
});

describe('addNote', () => {
  it('appends a cleaned note', () => {
    const r = addNote([note('a')], '  likes   tea ', 'user', 9);
    expect(r.kept).toEqual({ text: 'likes tea', about: 'user', at: 9 });
    expect(r.notes.map((n) => n.text)).toEqual(['a', 'likes tea']);
  });

  it('cuts a long note and ignores an empty one', () => {
    expect(addNote([], 'x'.repeat(500), null, 1).kept?.text).toHaveLength(NOTE_MAX);
    const none = addNote([note('a')], '   ', null, 1);
    expect(none.kept).toBeNull();
    expect(none.notes).toEqual([note('a')]);
  });

  it('moves a repeated note to the newest instead of keeping two', () => {
    const r = addNote([note('Likes tea', 'user'), note('b')], 'likes tea', 'user', 7);
    expect(r.notes.map((n) => n.text)).toEqual(['b', 'likes tea']);
  });

  it('keeps a same-worded note about someone else', () => {
    const r = addNote([note('is loud', 'airi')], 'is loud', 'naiwa', 3);
    expect(r.notes).toHaveLength(2);
  });

  it('pushes the oldest out past the cap', () => {
    const full = Array.from({ length: NOTES_MAX }, (_, i) => note(`n${i}`));
    const r = addNote(full, 'new', null, 1);
    expect(r.notes).toHaveLength(NOTES_MAX);
    expect(r.notes[0].text).toBe('n1');
    expect(r.notes.at(-1)?.text).toBe('new');
  });

  it('turns an unknown "about" into none', () => {
    expect(addNote([], 'x', 'the moon', 1).kept?.about).toBeNull();
  });
});

describe('forgetNote', () => {
  it('drops a note by the number it is shown with', () => {
    const r = forgetNote([note('a'), note('b'), note('c')], 2);
    expect(r.removed?.text).toBe('b');
    expect(r.notes.map((n) => n.text)).toEqual(['a', 'c']);
  });

  it('removes nothing for a number that is not a note', () => {
    const notes = [note('a')];
    for (const bad of [0, 2, -1, 1.5, '1', null]) {
      const r = forgetNote(notes, bad);
      expect(r.removed).toBeNull();
      expect(r.notes).toEqual(notes);
    }
  });
});

describe('noteLines', () => {
  it('says so when there is nothing, else numbers the notes', () => {
    expect(noteLines([])).toEqual(['You have no notes yet.']);
    const lines = noteLines([note('likes tea', 'user'), note('naps a lot')]);
    expect(lines[1]).toBe('1. [about user] likes tea');
    expect(lines[2]).toBe('2. naps a lot');
  });
});
