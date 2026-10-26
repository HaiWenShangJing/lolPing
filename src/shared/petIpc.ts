import type { PetId, PetManifest } from './teammate/pet';

/** init and pose: main → page. drag: page → main. */
export const PET_CH = { init: 'pet:init', pose: 'pet:pose', drag: 'pet:drag' } as const;

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

export interface PetApi {
  onInit(cb: (init: PetInit) => void): () => void;
  onPose(cb: (msg: PetPoseMsg) => void): () => void;
  drag(msg: PetDragMsg): void;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parsePetDrag(raw: unknown): PetDragMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if ((r.phase !== 'start' && r.phase !== 'move' && r.phase !== 'end') || !isNum(r.x) || !isNum(r.y)) return null;
  return { phase: r.phase, x: r.x, y: r.y };
}
