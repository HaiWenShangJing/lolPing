/**
 * Pets that talk to each other. Every shown pet has its own mind (a Copilot CLI session); this is the pure part of what
 * lets them hear one another: the lines of the room, who is woken by a line and when, and the limits that keep a
 * conversation from running away. `main/teammate/petSociety.ts` carries it out.
 */

import type { PetId } from './pet';
import type { HostActivity } from './petHost';
import type { SayTo } from './petControl';
import { MAIN_ROOM } from './petGroups';

export type Speaker = 'user' | PetId;

/** One thing said in a room, or a note a pet kept (shown dimmed in the lounge, never heard by the others). */
export interface RoomLine {
  seq: number;
  /** `MAIN_ROOM`, or the id of the group it was said in: only that group's members hear it. */
  room: string;
  from: Speaker;
  /** Who it was meant for; null when the speaker only spoke up. A note has none. */
  to: SayTo | null;
  text: string;
  at: number;
  kind: 'say' | 'note';
}

/** The lounge keeps this many lines of each room; the minds are told the last few of them. */
export const ROOM_MAX = 200;
/** A mind is told at most this many lines it has not heard yet. */
export const HEARD_MAX = 8;

/** A line is `to` the pet, to everyone, or to nobody: a pet hears everyone's but its own, and the ones meant for another pet only in passing. */
export const isForMe = (line: RoomLine, me: PetId): boolean => line.to === 'all' || line.to === me;

/** What a pet hears since `seq` in the `rooms` it is in: the speech of others (never its own, never notes), the newest `HEARD_MAX`. */
export function heardBy(lines: readonly RoomLine[], me: PetId, seq: number, rooms: readonly string[]): RoomLine[] {
  return lines.filter((l) => l.seq > seq && l.kind === 'say' && l.from !== me && rooms.includes(l.room)).slice(-HEARD_MAX);
}

/** Appends a line and drops the oldest of its room past `ROOM_MAX`; the other rooms keep theirs. */
export function pushLine(lines: readonly RoomLine[], line: RoomLine): RoomLine[] {
  const all = [...lines, line];
  const over = all.filter((l) => l.room === line.room).length - ROOM_MAX;
  if (over <= 0) return all;
  let drop = over;
  return all.filter((l) => l.room !== line.room || drop-- <= 0);
}

/**
 * Where a pet's reply goes: the room of the last line said to it, else of the last it heard, else the big room.
 * `lines` are what it heard this wake-up, oldest first.
 */
export function contextRoom(lines: readonly RoomLine[], me: PetId): string {
  const last = [...lines].reverse().find((l) => isForMe(l, me)) ?? lines.at(-1);
  return last?.room ?? MAIN_ROOM;
}

/** How an overheard line reads in a prompt. `names` maps each pet to what it is called; `group` is the name of the group it was said in. */
export function heardLine(l: RoomLine, me: PetId, names: Readonly<Record<PetId, string>>, group: string | null = null): string {
  const who = l.from === 'user' ? 'The user' : names[l.from];
  const to = l.to === 'all' ? 'everyone' : l.to === me ? 'you' : l.to ? names[l.to] : null;
  const where = group === null ? '' : ` [in the group ${JSON.stringify(group)}]`;
  return `${who}${where}${to ? ` (to ${to})` : ''}: ${JSON.stringify(l.text)}`;
}

/** Wake-ups caused by pets talking: how deep a chain of replies may go, and how many an hour. */
export const SOCIAL_DEPTH: Record<HostActivity, number> = { calm: 3, normal: 6, lively: 10 };
export const SOCIAL_HOURLY: Record<HostActivity, number> = { calm: 30, normal: 120, lively: 300 };
/** The chance a pet that was not spoken to joins in on a line, for a line from the user and from a pet. */
export const CHIME: Record<HostActivity, { user: number; pet: number }> = {
  calm: { user: 0.15, pet: 0.08 },
  normal: { user: 0.35, pet: 0.18 },
  lively: { user: 0.6, pet: 0.3 },
};
/** A conversation among pets that goes this quiet is over: the next line starts a new chain. */
export const QUIET_MS = 90_000;
/** At most this many pets are woken by one line of a pet. */
export const WAKES_PER_PET_LINE = 3;

const HOUR_MS = 3_600_000;
const STAGGER_MS = 2_500;

/** A reading pause before a pet answers: about as long as the line takes to read. */
export const readingMs = (textLength: number): number => Math.min(5_000, Math.max(1_500, textLength * 50));

/** The chain of pet-to-pet replies after a line: back to 0 for the user or a long quiet, else one deeper when someone was woken. */
export function depthAfter(depth: number, from: Speaker, gapMs: number, woke: boolean): number {
  if (from === 'user' || gapMs >= QUIET_MS) return 0;
  return woke ? depth + 1 : depth;
}

/** The wake-ups of the last hour still counted, and how many more `cap` allows. */
export function wakeBudget(stamps: readonly number[], now: number, cap: number): { stamps: number[]; left: number } {
  const recent = stamps.filter((t) => now - t < HOUR_MS);
  return { stamps: recent, left: Math.max(0, cap - recent.length) };
}

export interface WakePlan {
  pet: PetId;
  /** How long after the line before the pet is woken. */
  delayMs: number;
  /** The line was meant for it, as against it deciding to join in. */
  direct: boolean;
}

/**
 * Who a line wakes, and when. A line to a pet (or to everyone) always wakes who it names: at once when the user wrote
 * it, after a pause to read it when a pet did. Others may join in by chance. A line from a pet wakes anyone only while
 * the pets are allowed to talk, the user is about, the chain isn't too deep and the hour's budget isn't spent. `shown`
 * are the pets that can hear.
 */
export function planWakes(o: {
  from: Speaker; to: SayTo | null; textLength: number; shown: readonly PetId[]; depth: number; social: boolean;
  activity: HostActivity; userAway: boolean; budgetLeft: number; random: () => number;
}): WakePlan[] {
  const others = o.shown.filter((p) => p !== o.from);
  const fromPet = o.from !== 'user';
  if (others.length === 0) return [];
  if (fromPet && (!o.social || o.userAway || o.depth >= SOCIAL_DEPTH[o.activity] || o.budgetLeft <= 0)) return [];
  const direct = o.to === 'all' ? others : others.filter((p) => p === o.to);
  const chance = fromPet ? CHIME[o.activity].pet : CHIME[o.activity].user;
  const chiming = others.filter((p) => !direct.includes(p) && o.random() < chance);
  const read = fromPet ? readingMs(o.textLength) : 0;
  const plans: WakePlan[] = [
    ...direct.map((pet, i): WakePlan => ({ pet, delayMs: read + i * STAGGER_MS, direct: true })),
    ...chiming.map((pet, i): WakePlan => ({
      pet, delayMs: read + 2_000 + Math.round(o.random() * 6_000) + (direct.length + i) * STAGGER_MS, direct: false,
    })),
  ];
  const limit = fromPet ? Math.min(WAKES_PER_PET_LINE, o.budgetLeft) : plans.length;
  return plans.slice(0, limit);
}
