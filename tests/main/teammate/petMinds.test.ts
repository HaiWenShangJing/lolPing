import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PetMinds } from '../../../src/main/teammate/petMinds';
import { NOTES_MAX, type PetNote } from '../../../src/shared/teammate/petMind';

const file = () => join(mkdtempSync(join(tmpdir(), 'lolping-minds-')), 'teammate', 'pet-notes.json');
const note = (text: string, about: PetNote['about'] = null, at = 1): PetNote => ({ text, about, at });

describe('PetMinds', () => {
  it('starts with no notes when there is no file, or it is not readable', () => {
    expect(new PetMinds(file()).notes('naiwa')).toEqual([]);
    const f = file();
    new PetMinds(f).set('airi', [note('x')]);
    const bad = join(mkdtempSync(join(tmpdir(), 'lolping-minds-')), 'bad.json');
    writeFileSync(bad, '{ not json');
    expect(new PetMinds(bad).notes('airi')).toEqual([]);
  });

  it('keeps each pet\'s notes apart, and writes them out so a new start reads them again', async () => {
    const f = file();
    const minds = new PetMinds(f);
    minds.set('naiwa', [note('likes tea', 'user')]);
    minds.set('airi', [note('is bright', 'hiyori', 2)]);
    await minds.flush();
    const again = new PetMinds(f);
    expect(again.notes('naiwa')).toEqual([note('likes tea', 'user')]);
    expect(again.notes('airi')).toEqual([note('is bright', 'hiyori', 2)]);
    expect(again.notes('whale')).toEqual([]);
  });

  it('keeps no more notes than the limit, and drops the ones that are no good', async () => {
    const f = file();
    const minds = new PetMinds(f);
    minds.set('naiwa', Array.from({ length: NOTES_MAX + 5 }, (_, i) => note(`note ${i}`, null, i)));
    expect(minds.notes('naiwa')).toHaveLength(NOTES_MAX);
    minds.set('naiwa', [note('ok'), { text: '   ', about: null, at: 1 }]);
    expect(minds.notes('naiwa').map((n) => n.text)).toEqual(['ok']);
    await minds.flush();
    expect(JSON.parse(readFileSync(f, 'utf8')).naiwa).toHaveLength(1);
  });

  it('tells who changed the notes, so a change by the user can brief the pet again', () => {
    const minds = new PetMinds(file());
    const seen: Array<[string, string]> = [];
    const stop = minds.onChange((id, by) => seen.push([id, by]));
    minds.set('naiwa', [note('a')]);
    minds.set('naiwa', [], 'user');
    stop();
    minds.set('naiwa', [note('b')]);
    expect(seen).toEqual([['naiwa', 'pet'], ['naiwa', 'user']]);
  });

  it('writes changes in the order they were made', async () => {
    const f = file();
    const minds = new PetMinds(f);
    for (let i = 0; i < 20; i++) minds.set('hiyori', [note(`n${i}`)]);
    await minds.flush();
    expect(new PetMinds(f).notes('hiyori').map((n) => n.text)).toEqual(['n19']);
  });
});
