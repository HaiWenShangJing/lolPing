import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PetGroups } from '../../../src/main/teammate/petGroups';
import { GROUPS_MAX } from '../../../src/shared/teammate/petGroups';

const dir = () => mkdtempSync(join(tmpdir(), 'lolping-groups-'));
const file = () => join(dir(), 'teammate', 'pet-groups.json');
/** Ids that come out the same every time. */
const steady = (): (() => number) => {
  let n = 0;
  return () => (n++ % 36) / 36;
};

describe('PetGroups', () => {
  it('starts with no groups when there is no file, or it is not readable', () => {
    expect(new PetGroups(file()).list()).toEqual([]);
    const bad = join(dir(), 'bad.json');
    writeFileSync(bad, '{ not json');
    expect(new PetGroups(bad).list()).toEqual([]);
  });

  it('makes a group with an id of its own, and writes it out so a new start reads it again', async () => {
    const f = file();
    const groups = new PetGroups(f, steady());
    const saved = groups.save({ id: null, name: '  Code   club ', members: ['airi', 'naiwa'] });
    expect(saved).toMatchObject({ name: 'Code club', members: ['naiwa', 'airi'] });
    expect(saved?.id).toMatch(/^g[a-z0-9]+$/);
    await groups.flush();
    expect(new PetGroups(f).list()).toEqual([saved]);
  });

  it('changes a group in place, keeping its id', async () => {
    const f = file();
    const groups = new PetGroups(f, steady());
    const made = groups.save({ id: null, name: 'One', members: ['naiwa', 'airi'] });
    const changed = groups.save({ id: made?.id ?? null, name: 'Two', members: ['airi', 'hiyori', 'whale'] });
    expect(changed).toEqual({ id: made?.id, name: 'Two', members: ['whale', 'airi', 'hiyori'] });
    expect(groups.list()).toHaveLength(1);
    await groups.flush();
    expect(new PetGroups(f).list()).toEqual([changed]);
  });

  it('refuses what makes no group, and leaves what it has as it was', async () => {
    const f = file();
    const groups = new PetGroups(f, steady());
    const made = groups.save({ id: null, name: 'One', members: ['naiwa', 'airi'] });
    expect(groups.save({ id: null, name: '', members: ['naiwa', 'airi'] })).toBeNull();
    expect(groups.save({ id: null, name: 'Solo', members: ['naiwa'] })).toBeNull();
    expect(groups.save({ id: 'gnope', name: 'Ghost', members: ['naiwa', 'airi'] })).toBeNull();
    expect(groups.list()).toEqual([made]);
    await groups.flush();
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([made]);
  });

  it('keeps no more groups than the limit', () => {
    const groups = new PetGroups(file(), steady());
    for (let i = 0; i < GROUPS_MAX + 2; i++) groups.save({ id: null, name: `Group ${i}`, members: ['naiwa', 'airi'] });
    expect(groups.list()).toHaveLength(GROUPS_MAX);
    expect(new Set(groups.list().map((g) => g.id)).size).toBe(GROUPS_MAX);
  });

  it('deletes a group, and says so only when there was one', async () => {
    const f = file();
    const groups = new PetGroups(f, steady());
    const made = groups.save({ id: null, name: 'One', members: ['naiwa', 'airi'] });
    expect(groups.remove('gnope')).toBe(false);
    expect(groups.remove(made?.id ?? '')).toBe(true);
    expect(groups.list()).toEqual([]);
    await groups.flush();
    expect(new PetGroups(f).list()).toEqual([]);
  });

  it('leaves out of a file what is no group: a pet that is not there, one pet alone, a repeated id', () => {
    const f = join(dir(), 'pet-groups.json');
    writeFileSync(f, JSON.stringify([
      { id: 'g1', name: 'Fine', members: ['naiwa', 'airi', 'dragon'] },
      { id: 'g2', name: 'Alone', members: ['naiwa'] },
      { id: 'g1', name: 'Again', members: ['naiwa', 'airi'] },
      { id: 'main', name: 'Not allowed', members: ['naiwa', 'airi'] },
      'junk',
    ]));
    expect(new PetGroups(f).list()).toEqual([{ id: 'g1', name: 'Fine', members: ['naiwa', 'airi'] }]);
  });
});
