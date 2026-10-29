import type { PetId, PetManifest } from './teammate/pet';
import { isPetId } from './teammate/pet';
import { GROUP_NAME_MAX, MAIN_ROOM, cleanMembers, isGroupId, type PetGroup } from './teammate/petGroups';
import type { RoomLine } from './teammate/petSociety';

/**
 * init, pose, look and talk: main → page. drag, hit, chat and chatClose: page → main. lounge: main → the lounge page;
 * loungeSend and loungeGroup: the lounge page → main.
 */
export const PET_CH = {
  init: 'pet:init', pose: 'pet:pose', drag: 'pet:drag', look: 'pet:look', talk: 'pet:talk', hit: 'pet:hit',
  chat: 'pet:chat', chatClose: 'pet:chatClose', lounge: 'pet:lounge', loungeSend: 'pet:loungeSend',
  loungeGroup: 'pet:loungeGroup',
} as const;

/** What a pet window needs to draw: `base` is the URL its frame names are under. */
export interface PetInit {
  id: PetId;
  base: string;
  manifest: PetManifest;
  /** The animation to rest in. */
  rest: string;
}

/**
 * A cue of a fight (`FightCue`): `dir` is the way the pet faces, 1 right and -1 left, and `n` counts the cues sent, so
 * the same cue twice in a row is told apart from one that is still going and plays again.
 */
export interface PetFx {
  cue: string;
  dir: 1 | -1;
  n: number;
}

/**
 * `anim`: the animation to play (a key of the manifest's anims). `flip`: the pet faces left. `fx`: a cue of a fight to
 * act out on top, which a page that does not know it leaves out.
 */
export interface PetPoseMsg {
  anim: string;
  flip: boolean;
  fx?: PetFx;
}

/** Screen position of the pointer in DIPs; main moves the window by how far it went since `start`. */
export interface PetDragMsg {
  phase: 'start' | 'move' | 'end';
  x: number;
  y: number;
}

/** Where a Live2D pet looks, -1 to 1 either way, `y` positive up: main works it out from the pointer on the whole screen. */
export interface PetLookMsg {
  x: number;
  y: number;
}

/** A Live2D pet's mouth moves for `ms`: the teammate is saying its line. */
export interface PetTalkMsg {
  ms: number;
}

/** Whether the pointer is over the character itself: the empty corners of a Live2D pet's window let clicks through. */
export interface PetHitMsg {
  over: boolean;
}

/** The words the lounge page shows, in the user's language. */
export interface LoungeText {
  title: string;
  /** Placeholder of the box the user types in. */
  hint: string;
  /** The first choice of who to talk to. */
  everyone: string;
  send: string;
  /** Shown instead of the box while no pet is out to hear. */
  empty: string;
  /** What the user's own lines are called. */
  you: string;
  /** Said between a pet's name and a note it kept. */
  noted: string;
  /** The tab of the room everybody hears. */
  main: string;
  /** The button that makes a group, and the title of its form. */
  newGroup: string;
  /** Edits the open group. */
  editGroup: string;
  groupName: string;
  members: string;
  /** Under the member choices: what a group needs. */
  membersHint: string;
  save: string;
  cancel: string;
  delete: string;
  /** What the delete button asks before it deletes, on a second press. */
  sure: string;
  /** Shown instead of the box while no member of the open group is out to hear. */
  groupEmpty: string;
}

/** What the lounge knows of its groups: they and who can be spoken to in each room now (`MAIN_ROOM` and each group id). */
export interface LoungeState {
  groups: PetGroup[];
  rosters: Record<string, PetId[]>;
}

/** What the lounge page starts with. */
export interface LoungeInit extends LoungeState {
  text: LoungeText;
  names: Record<PetId, string>;
  lines: RoomLine[];
}

export type LoungeMsg =
  | { kind: 'init'; init: LoungeInit }
  | { kind: 'line'; line: RoomLine }
  | ({ kind: 'state' } & LoungeState);

/** The user speaks in a room of the lounge, to one pet or to everyone in it. */
export interface LoungeSend {
  room: string;
  to: 'all' | PetId;
  text: string;
}

/** The user makes a group (`id` null) or changes one, or deletes one. */
export type LoungeGroupMsg =
  | { op: 'save'; id: string | null; name: string; members: PetId[] }
  | { op: 'delete'; id: string };

export interface PetApi {
  onInit(cb: (init: PetInit) => void): () => void;
  onPose(cb: (msg: PetPoseMsg) => void): () => void;
  onLook(cb: (msg: PetLookMsg) => void): () => void;
  onTalk(cb: (msg: PetTalkMsg) => void): () => void;
  drag(msg: PetDragMsg): void;
  hit(msg: PetHitMsg): void;
  /** The chat box's page: what the user typed to the pet. */
  chat(text: string): void;
  /** The chat box's page: the user dismissed it. */
  closeChat(): void;
  /** The lounge page: what happens in the room. */
  onLounge(cb: (msg: LoungeMsg) => void): () => void;
  /** The lounge page: the user said something. */
  loungeSend(msg: LoungeSend): void;
  /** The lounge page: the user made, changed or deleted a group. */
  loungeGroup(msg: LoungeGroupMsg): void;
}

/** A tap is a press and release in about the same place, quickly; two taps close together make a double tap. */
export const TAP_MAX_MS = 400;
export const TAP_MAX_MOVE = 5;
export const DOUBLE_TAP_MS = 500;

export function isTap(dx: number, dy: number, ms: number): boolean {
  return Math.hypot(dx, dy) <= TAP_MAX_MOVE && ms >= 0 && ms <= TAP_MAX_MS;
}

/** The longest line the user can type to a pet. */
export const PET_CHAT_MAX = 200;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** What the user typed in the chat box: trimmed and cut to length; null when there is nothing. */
export function parsePetChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, PET_CHAT_MAX);
  return text === '' ? null : text;
}

export function parsePetDrag(raw: unknown): PetDragMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if ((r.phase !== 'start' && r.phase !== 'move' && r.phase !== 'end') || !isNum(r.x) || !isNum(r.y)) return null;
  return { phase: r.phase, x: r.x, y: r.y };
}

/** What the lounge page sent: a room, one pet or everyone, and the words cut as a pet chat is; null for anything else. */
export function parseLoungeSend(raw: unknown): LoungeSend | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const to = r.to === 'all' ? 'all' : isPetId(r.to) ? r.to : null;
  const room = r.room === MAIN_ROOM || isGroupId(r.room) ? r.room : null;
  const text = parsePetChat(r.text);
  return to && room && text ? { room, to, text } : null;
}

/** What the lounge page sent about a group; the name and members are checked again where they are saved. */
export function parseLoungeGroup(raw: unknown): LoungeGroupMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.op === 'delete') return isGroupId(r.id) ? { op: 'delete', id: r.id } : null;
  if (r.op !== 'save' || typeof r.name !== 'string') return null;
  if (r.id !== null && !isGroupId(r.id)) return null;
  return { op: 'save', id: r.id, name: r.name.slice(0, GROUP_NAME_MAX * 4), members: cleanMembers(r.members) };
}

export function parsePetHit(raw: unknown): PetHitMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return typeof r.over === 'boolean' ? { over: r.over } : null;
}
