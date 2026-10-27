import type { PetId, PetManifest } from './teammate/pet';

/** init, pose, look and talk: main → page. drag and hit: page → main. */
export const PET_CH = {
  init: 'pet:init', pose: 'pet:pose', drag: 'pet:drag', look: 'pet:look', talk: 'pet:talk', hit: 'pet:hit',
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
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
