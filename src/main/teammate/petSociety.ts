import type { Settings } from '../../shared/settings';
import { PET_IDS, type PetId } from '../../shared/teammate/pet';
import type { PetStatus, SayTo } from '../../shared/teammate/petControl';
import { MAIN_ROOM, membersOf, roomsOf, type PetGroup } from '../../shared/teammate/petGroups';
import { HOST_IDLE_SECONDS, type WakeKind } from '../../shared/teammate/petHost';
import { cleanLine } from '../../shared/teammate/petText';
import {
  SOCIAL_HOURLY, contextRoom, depthAfter, heardBy, planWakes, pushLine, wakeBudget, type RoomLine, type Speaker,
} from '../../shared/teammate/petSociety';
import type { ToolDef } from '../../shared/teammate/tools';
import { PET_CHAT_MAX } from '../../shared/petIpc';
import type { GroupStore } from './petGroups';
import type { PetHost, PetRoom } from './petHost';
import type { PetMinds } from './petMinds';

/** Failures and give-ups are one line from lolPing, however many minds hit them at once. */
const TELL_GAP_MS = 60_000;
/** Minds start this far apart, so the pets don't all say hello in the same second. */
const START_GAP_MS = 7_000;

/** The part of a mind the society uses. */
export type Brain = Pick<PetHost, 'sync' | 'stop' | 'tools' | 'call' | 'nudge' | 'rebrief' | 'active'>;

export interface SocietyDeps {
  settings: () => Settings;
  now: () => number;
  /** Seconds since the user last touched the keyboard or mouse. */
  idleSeconds: () => number;
  /** The pets on screen. */
  shown: () => PetStatus[];
  minds: PetMinds;
  /** The groups the user made. */
  groups: GroupStore;
  /** Says a line as lolPing itself. */
  say: (text: string) => void;
  /** Makes the mind of pet `who`; `stagger` is how long after the others its first wake-up should come. */
  make: (who: PetId, room: PetRoom, stagger: () => number, tell: (text: string) => void) => Brain;
  after: (ms: number, fn: () => void) => () => void;
  random: () => number;
}

/** What the lounge is told: a line was said, or the pets that can be spoken to (or the groups) changed. */
export type RoomEvent = { kind: 'line'; line: RoomLine } | { kind: 'roster' };

/** How a conversation in one room is going. */
interface Chain {
  /** Replies in a row that pets woke each other for, since the user last spoke or things went quiet. */
  depth: number;
  /** When the last thing was said, for the quiet gap. */
  lastSayAt: number;
}

/**
 * The pets as a society: one mind each, and the rooms they share: the big one everybody hears, and the groups the user
 * made, which only their members hear. Everything a pet says is kept (the lounge shows it) and heard by the others in
 * the room, who may be woken by it; the user can speak to one pet or to everyone in a room. The pure rules for who
 * wakes and when are `planWakes`; this runs them and keeps the transcript.
 */
export class PetSociety {
  private readonly brains = new Map<PetId, Brain>();
  private lines: RoomLine[] = [];
  private seq = 0;
  private readonly chains = new Map<string, Chain>();
  /** The room each pet last heard something in: where what it says next goes. */
  private readonly context = new Map<PetId, string>();
  /** When pets woke other pets in the last hour. */
  private stamps: number[] = [];
  private readonly timers = new Set<() => void>();
  private readonly listeners = new Set<(e: RoomEvent) => void>();
  private readonly told = new Map<string, number>();
  private readonly stopNotes: () => void;

  constructor(private readonly deps: SocietyDeps) {
    for (const id of PET_IDS) {
      this.brains.set(id, deps.make(id, this.roomFor(), () => this.staggerOf(id), (text) => this.tell(text)));
    }
    this.stopNotes = deps.minds.onChange((id, by) => {
      if (by === 'user') this.brains.get(id)?.rebrief();
    });
  }

  /** Some pet's mind is on. */
  get active(): boolean {
    return [...this.brains.values()].some((b) => b.active);
  }

  /** Follows the settings: starts the minds of the pets that are on, stops the rest. */
  sync(): void {
    for (const brain of this.brains.values()) brain.sync();
    this.emit({ kind: 'roster' });
  }

  stop(): void {
    for (const brain of this.brains.values()) brain.stop();
    for (const cancel of this.timers) cancel();
    this.timers.clear();
    this.stopNotes();
  }

  /** The tools of the session with token `ask`, if it is one of the minds'. */
  tools(ask: string): ToolDef[] | null {
    for (const brain of this.brains.values()) {
      const tools = brain.tools(ask);
      if (tools) return tools;
    }
    return null;
  }

  call(ask: string, name: string, args: unknown): ReturnType<PetHost['call']> {
    for (const brain of this.brains.values()) if (brain.tools(ask)) return brain.call(ask, name, args);
    return Promise.resolve({ content: [{ text: 'Not available.' }], isError: true });
  }

  /** The pets that can hear `room` now: showing, with a mind that is on, and in the group when it is one. */
  roster(room: string = MAIN_ROOM): PetId[] {
    const shown = this.deps.shown().map((p) => p.id);
    const members = membersOf(this.deps.groups.list(), room);
    return PET_IDS.filter((id) => shown.includes(id) && this.brains.get(id)?.active && (members === null || members.includes(id)));
  }

  /** The groups the user made. */
  groups(): readonly PetGroup[] {
    return this.deps.groups.list();
  }

  /** Who can be spoken to now in each room: the big one and every group. */
  rosters(): Record<string, PetId[]> {
    const rosters: Record<string, PetId[]> = { [MAIN_ROOM]: this.roster() };
    for (const g of this.groups()) rosters[g.id] = this.roster(g.id);
    return rosters;
  }

  /** Makes a group (`id` null) or changes one; null when it was refused. */
  saveGroup(input: { id: string | null; name: string; members: readonly string[] }): PetGroup | null {
    const saved = this.deps.groups.save(input);
    if (saved) this.emit({ kind: 'roster' });
    return saved;
  }

  /** Deletes a group with everything that was said in it. */
  deleteGroup(id: string): boolean {
    if (!this.deps.groups.remove(id)) return false;
    this.lines = this.lines.filter((l) => l.room !== id);
    this.chains.delete(id);
    this.emit({ kind: 'roster' });
    return true;
  }

  /** Everything said so far, oldest first. */
  transcript(): readonly RoomLine[] {
    return this.lines;
  }

  /** Calls `fn` for what happens in the rooms. The result stops it. */
  onEvent(fn: (e: RoomEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The user speaks in `room` to one pet or to all of them there; false when none of those is there to hear it. */
  userSays(to: PetId | 'all', raw: string, room: string = MAIN_ROOM): boolean {
    const text = cleanLine(raw, PET_CHAT_MAX);
    const roster = this.roster(room);
    if (text === '' || !(to === 'all' ? roster.length > 0 : roster.includes(to))) return false;
    this.add({ room, from: 'user', to, text, kind: 'say' });
    return true;
  }

  /** The room a pet's words go to now: where it last heard something, if it is still in that group. */
  private roomOf(who: PetId): string {
    const room = this.context.get(who) ?? MAIN_ROOM;
    return roomsOf(this.groups(), who).includes(room) ? room : MAIN_ROOM;
  }

  private roomFor(): PetRoom {
    return {
      heard: (who, seq) => {
        const lines = heardBy(this.lines, who, seq, roomsOf(this.groups(), who));
        const room = contextRoom(lines, who);
        this.context.set(who, room);
        const names = Object.fromEntries(this.groups().map((g) => [g.id, g.name]));
        return { lines, seq: this.seq, groups: names, group: names[room] ?? null };
      },
      said: (who, text, to) => {
        const room = this.roomOf(who);
        // In a group a line is for the whole group unless it singles one member out.
        const members = membersOf(this.groups(), room);
        const target = members === null ? to : to !== null && to !== 'all' && members.includes(to) ? to : 'all';
        this.add({ room, from: who, to: target, text, kind: 'say' });
      },
      noted: (who, text) => this.add({ room: this.roomOf(who), from: who, to: null, text, kind: 'note' }),
      groups: (who) => this.groups().filter((g) => g.members.includes(who)).map((g) => ({ name: g.name, members: g.members })),
    };
  }

  private add(l: { room: string; from: Speaker; to: SayTo | null; text: string; kind: RoomLine['kind'] }): void {
    const now = this.deps.now();
    const line: RoomLine = { seq: ++this.seq, room: l.room, from: l.from, to: l.to, text: l.text, at: now, kind: l.kind };
    this.lines = pushLine(this.lines, line);
    this.emit({ kind: 'line', line });
    if (l.kind === 'say') this.wake(line, now);
  }

  /** Works out who the line wakes and when, and sets the timers. */
  private wake(line: RoomLine, now: number): void {
    const t = this.deps.settings().teammate;
    const chain = this.chains.get(line.room) ?? { depth: 0, lastSayAt: 0 };
    this.chains.set(line.room, chain);
    const gap = chain.lastSayAt === 0 ? Infinity : now - chain.lastSayAt;
    chain.lastSayAt = now;
    const budget = wakeBudget(this.stamps, now, SOCIAL_HOURLY[t.petHostActivity]);
    this.stamps = budget.stamps;
    const plans = planWakes({
      from: line.from, to: line.to, textLength: line.text.length, shown: this.roster(line.room),
      depth: depthAfter(chain.depth, line.from, gap, false), social: t.petSocial, activity: t.petHostActivity,
      userAway: this.deps.idleSeconds() >= HOST_IDLE_SECONDS, budgetLeft: budget.left, random: this.deps.random,
    });
    chain.depth = depthAfter(chain.depth, line.from, gap, plans.length > 0);
    const fromUser = line.from === 'user';
    if (!fromUser) for (let i = 0; i < plans.length; i++) this.stamps.push(now);
    for (const plan of plans) {
      const kind: WakeKind = plan.direct ? 'direct' : 'overheard';
      const brain = this.brains.get(plan.pet);
      if (plan.delayMs <= 0) {
        brain?.nudge(kind, fromUser);
        continue;
      }
      const cancel = this.deps.after(plan.delayMs, () => {
        this.timers.delete(cancel);
        brain?.nudge(kind, fromUser);
      });
      this.timers.add(cancel);
    }
  }

  private staggerOf(id: PetId): number {
    const on = PET_IDS.filter((p) => this.deps.settings().teammate.pets[p].on);
    return Math.max(0, on.indexOf(id)) * START_GAP_MS;
  }

  private tell(text: string): void {
    const now = this.deps.now();
    const last = this.told.get(text);
    if (last !== undefined && now - last < TELL_GAP_MS) return;
    this.told.set(text, now);
    this.deps.say(text);
  }

  private emit(e: RoomEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}
