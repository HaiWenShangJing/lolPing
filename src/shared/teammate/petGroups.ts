/**
 * Groups of pets the user makes in the lounge: a name and the pets that take part. What is said in a group is heard
 * only by its members (and shown in the group's tab); everything else is said in the one big room, which everybody
 * hears. This is the pure part; `main/teammate/petGroups.ts` keeps them on disk.
 */

import { PET_IDS, type PetId } from './pet';
import { cleanLine } from './petText';

/** The room everybody hears: the lounge's first tab. */
export const MAIN_ROOM = 'main';
export const GROUPS_MAX = 8;
export const GROUP_NAME_MAX = 24;
/** A group is for talking things over, so it needs at least two pets. */
export const GROUP_MEMBERS_MIN = 2;

export interface PetGroup {
  /** What lines say they were said in; never `MAIN_ROOM`. */
  id: string;
  name: string;
  /** In the order of `PET_IDS`, each at most once. */
  members: PetId[];
}

const GROUP_ID = /^g[a-z0-9]{1,12}$/;
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const isGroupId = (raw: unknown): raw is string => typeof raw === 'string' && GROUP_ID.test(raw);

/** The pets named, once each, in the order of `PET_IDS`; anything that is no pet is left out. */
export function cleanMembers(raw: unknown): PetId[] {
  const list = Array.isArray(raw) ? raw : [];
  return PET_IDS.filter((id) => list.includes(id));
}

/** Reads saved groups; one that doesn't fit, or repeats an id, is left out. */
export function normalizeGroups(raw: unknown): PetGroup[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const groups: PetGroup[] = [];
  for (const g of raw) {
    if (typeof g !== 'object' || g === null) continue;
    const o = g as Record<string, unknown>;
    const name = cleanLine(o.name, GROUP_NAME_MAX);
    const members = cleanMembers(o.members);
    if (!isGroupId(o.id) || seen.has(o.id)) continue;
    if (name === '' || members.length < GROUP_MEMBERS_MIN) continue;
    seen.add(o.id);
    groups.push({ id: o.id, name, members });
  }
  return groups.slice(0, GROUPS_MAX);
}

/** An id no group has: random, with a counter to fall back on, so it always ends. */
export function newGroupId(taken: ReadonlySet<string>, random: () => number): string {
  for (let i = 0; i < 8; i++) {
    let id = 'g';
    for (let c = 0; c < 6; c++) id += ID_CHARS[Math.min(ID_CHARS.length - 1, Math.floor(random() * ID_CHARS.length))];
    if (!taken.has(id)) return id;
  }
  let n = taken.size + 1;
  while (taken.has(`g${n}`)) n += 1;
  return `g${n}`;
}

/**
 * Makes a group (`input.id` null) or changes one. `saved` is null, and nothing changes, when the name is empty, fewer
 * than two pets are named, the groups are at their limit, or the id is no group's (it was deleted meanwhile).
 */
export function saveGroup(
  groups: readonly PetGroup[], input: { id: unknown; name: unknown; members: unknown }, random: () => number,
): { groups: PetGroup[]; saved: PetGroup | null } {
  const name = cleanLine(input.name, GROUP_NAME_MAX);
  const members = cleanMembers(input.members);
  const creating = input.id === null || input.id === undefined;
  const existing = creating ? undefined : groups.find((g) => g.id === input.id);
  const refused = name === '' || members.length < GROUP_MEMBERS_MIN
    || (creating ? groups.length >= GROUPS_MAX : existing === undefined);
  if (refused) return { groups: [...groups], saved: null };
  const saved: PetGroup = { id: existing?.id ?? newGroupId(new Set(groups.map((g) => g.id)), random), name, members };
  return { groups: existing ? groups.map((g) => (g === existing ? saved : g)) : [...groups, saved], saved };
}

export function removeGroup(groups: readonly PetGroup[], id: unknown): PetGroup[] {
  return groups.filter((g) => g.id !== id);
}

/** The rooms a pet hears: the big one, and every group it is in. */
export function roomsOf(groups: readonly PetGroup[], me: PetId): string[] {
  return [MAIN_ROOM, ...groups.filter((g) => g.members.includes(me)).map((g) => g.id)];
}

/** The pets that hear `room`: the members of a group, or null for the big room, which all of them hear. */
export function membersOf(groups: readonly PetGroup[], room: string): readonly PetId[] | null {
  if (room === MAIN_ROOM) return null;
  return groups.find((g) => g.id === room)?.members ?? [];
}
