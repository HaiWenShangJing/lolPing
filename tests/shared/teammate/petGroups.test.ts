import { describe, expect, it } from 'vitest';
import {
  GROUPS_MAX, GROUP_NAME_MAX, MAIN_ROOM, cleanMembers, isGroupId, membersOf, newGroupId, normalizeGroups, removeGroup,
  roomsOf, saveGroup, type PetGroup,
} from '../../../src/shared/teammate/petGroups';

const group = (id: string, members: PetGroup['members'] = ['naiwa', 'airi'], name = id): PetGroup => ({ id, name, members });
const fixed = (n: number) => () => n;

describe('isGroupId', () => {
  it('takes an id that starts with g and is short and plain, and never the big room', () => {
    expect(isGroupId('g1')).toBe(true);
    expect(isGroupId('gabc123xyz')).toBe(true);
    expect(isGroupId(MAIN_ROOM)).toBe(false);
    expect(isGroupId('')).toBe(false);
    expect(isGroupId('g')).toBe(false);
    expect(isGroupId('G1')).toBe(false);
    expect(isGroupId('g1 2')).toBe(false);
    expect(isGroupId('g'.repeat(20))).toBe(false);
    expect(isGroupId(7)).toBe(false);
    expect(isGroupId(null)).toBe(false);
  });
});

describe('cleanMembers', () => {
  it('keeps the pets that exist, once each, in the order of the pets', () => {
    expect(cleanMembers(['hiyori', 'airi', 'airi', 'dragon', 3, 'naiwa'])).toEqual(['naiwa', 'airi', 'hiyori']);
    expect(cleanMembers('airi')).toEqual([]);
    expect(cleanMembers(null)).toEqual([]);
  });
});

describe('normalizeGroups', () => {
  it('reads groups that fit and leaves out the rest', () => {
    const raw = [
      { id: 'g1', name: ' Code   club ', members: ['airi', 'naiwa'] },
      { id: 'g2', name: 'One', members: ['airi'] },
      { id: 'g3', name: '   ', members: ['airi', 'naiwa'] },
      { id: 'g1', name: 'Same id', members: ['airi', 'naiwa'] },
      { id: 'main', name: 'Big', members: ['airi', 'naiwa'] },
      { name: 'No id', members: ['airi', 'naiwa'] },
      null, 4,
    ];
    expect(normalizeGroups(raw)).toEqual([{ id: 'g1', name: 'Code club', members: ['naiwa', 'airi'] }]);
    expect(normalizeGroups({})).toEqual([]);
    expect(normalizeGroups(undefined)).toEqual([]);
  });

  it('cuts a long name and keeps no more groups than the limit', () => {
    const many = Array.from({ length: GROUPS_MAX + 3 }, (_, i) => ({ id: `g${i}`, name: 'n'.repeat(80), members: ['airi', 'naiwa'] }));
    const read = normalizeGroups(many);
    expect(read).toHaveLength(GROUPS_MAX);
    expect(read[0].name).toHaveLength(GROUP_NAME_MAX);
  });
});

describe('newGroupId', () => {
  it('is a group id nobody has', () => {
    const id = newGroupId(new Set(), fixed(0.5));
    expect(isGroupId(id)).toBe(true);
    expect(newGroupId(new Set([id]), fixed(0.5))).not.toBe(id);
    expect(isGroupId(newGroupId(new Set([id]), fixed(0.5)))).toBe(true);
  });

  it('always ends, however the dice fall', () => {
    const taken = new Set(['g1', 'g2', newGroupId(new Set(), fixed(0))]);
    const id = newGroupId(taken, fixed(0));
    expect(taken.has(id)).toBe(false);
    expect(isGroupId(id)).toBe(true);
  });
});

describe('saveGroup', () => {
  it('makes a group with a new id', () => {
    const { groups, saved } = saveGroup([], { id: null, name: ' Duo ', members: ['airi', 'naiwa'] }, fixed(0.1));
    expect(saved).toMatchObject({ name: 'Duo', members: ['naiwa', 'airi'] });
    expect(isGroupId(saved?.id)).toBe(true);
    expect(groups).toEqual([saved]);
  });

  it('changes a group where it is, keeping its id and the order of the groups', () => {
    const before = [group('g1'), group('g2'), group('g3')];
    const { groups, saved } = saveGroup(before, { id: 'g2', name: 'Renamed', members: ['hiyori', 'whale'] }, fixed(0.1));
    expect(saved).toEqual({ id: 'g2', name: 'Renamed', members: ['whale', 'hiyori'] });
    expect(groups.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
    expect(before[1].name).toBe('g2');
  });

  it('refuses an empty name, fewer than two pets, a full house, or a group that is gone, and changes nothing', () => {
    const before = [group('g1')];
    const refuse = (input: { id: unknown; name: unknown; members: unknown }) => saveGroup(before, input, fixed(0.1));
    for (const input of [
      { id: null, name: '', members: ['airi', 'naiwa'] },
      { id: null, name: 4, members: ['airi', 'naiwa'] },
      { id: null, name: 'Solo', members: ['airi'] },
      { id: null, name: 'Strangers', members: ['dragon', 'airi'] },
      { id: 'g9', name: 'Gone', members: ['airi', 'naiwa'] },
    ]) {
      const r = refuse(input);
      expect(r.saved).toBeNull();
      expect(r.groups).toEqual(before);
    }
    const full = Array.from({ length: GROUPS_MAX }, (_, i) => group(`g${i}`));
    expect(saveGroup(full, { id: null, name: 'One more', members: ['airi', 'naiwa'] }, fixed(0.1)).saved).toBeNull();
    expect(saveGroup(full, { id: 'g0', name: 'Still fine', members: ['airi', 'naiwa'] }, fixed(0.1)).saved).not.toBeNull();
  });
});

describe('removeGroup', () => {
  it('drops the group with that id, and leaves the rest', () => {
    expect(removeGroup([group('g1'), group('g2')], 'g1').map((g) => g.id)).toEqual(['g2']);
    expect(removeGroup([group('g1')], 'g9')).toHaveLength(1);
  });
});

describe('roomsOf and membersOf', () => {
  const groups = [group('g1', ['naiwa', 'airi']), group('g2', ['airi', 'hiyori'])];

  it('gives a pet the big room and each of its groups', () => {
    expect(roomsOf(groups, 'naiwa')).toEqual(['main', 'g1']);
    expect(roomsOf(groups, 'airi')).toEqual(['main', 'g1', 'g2']);
    expect(roomsOf(groups, 'whale')).toEqual(['main']);
  });

  it('gives the members of a group, none for a group that is gone, and null for the big room everybody hears', () => {
    expect(membersOf(groups, 'g2')).toEqual(['airi', 'hiyori']);
    expect(membersOf(groups, 'g9')).toEqual([]);
    expect(membersOf(groups, MAIN_ROOM)).toBeNull();
  });
});
