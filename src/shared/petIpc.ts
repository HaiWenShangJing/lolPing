import type { PetId, PetManifest } from './teammate/pet';

/** init, pose, look and talk: main → page. drag, hit, chat and chatClose: page → main. */
export const PET_CH = {
  init: 'pet:init', pose: 'pet:pose', drag: 'pet:drag', look: 'pet:look', talk: 'pet:talk', hit: 'pet:hit',
  chat: 'pet:chat', chatClose: 'pet:chatClose',
} as const;

/** What a pet window needs to draw: `base` is the URL its frame names are under. */
export interface PetInit {
  id: PetId;
  base: string;
  manifest: PetManifest;
  /** The animation to rest in. */
  rest: string;
}

/** `anim`: the animation to play (a key of the manifest's anims). `flip`: the pet faces left. */
export interface PetPoseMsg {
  anim: string;
  flip: boolean;
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

export function parsePetHit(raw: unknown): PetHitMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return typeof r.over === 'boolean' ? { over: r.over } : null;
}
