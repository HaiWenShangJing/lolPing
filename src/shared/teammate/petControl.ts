/**
 * What a coding agent may ask of the desktop pets through lolPing's bridge, once the user lets it: say a line, walk
 * somewhere, play an animation. The agent names what it wants; lolPing decides where it goes and how long it lasts.
 */

import { MOODS, parseMood, type Mood } from './mood';
import { PET_IDS, keepInside, standBeside, type PetId } from './pet';
import type { ToolDef } from './tools';

export const PET_TOOLS = ['pet_status', 'pet_say', 'pet_walk', 'pet_play'] as const;
export type PetTool = (typeof PET_TOOLS)[number];

export const isPetTool = (name: string): name is PetTool => (PET_TOOLS as readonly string[]).includes(name);

/** Places a pet can be sent to, on the main display: the corners are the bottom ones, where pets live. */
export const PET_PLACES = ['home', 'cursor', 'left', 'right', 'top', 'center', 'random'] as const;
export type PetPlace = (typeof PET_PLACES)[number];

/** Where a pet goes: a named place, a spot on the display, or beside another pet. */
export type PetTarget = { place: PetPlace } | { xPct: number; yPct: number } | { beside: PetId };

/** Who a line is meant for: one pet, or all of them. Without it a pet is just speaking up. */
export type SayTo = PetId | 'all';

export type PetCommand =
  | { kind: 'status' }
  | { kind: 'say'; pet: PetId | null; text: string; mood: Mood | null; to?: SayTo | null }
  | { kind: 'walk'; pet: PetId | null; to: PetTarget }
  | { kind: 'play'; pet: PetId | null; anim: string | null; mood: Mood | null };

/** What the pets answer an agent: whether it worked, and in words what happened. */
export interface PetDriveResult {
  ok: boolean;
  text: string;
}

export const PET_SAY_MAX = 160;
const ANIM_NAME = /^[a-z0-9_]{1,32}$/;

const PET_PROP = {
  pet: {
    type: 'string',
    enum: PET_IDS,
    description: 'Which pet. Leave it out to address the pets the user has on (pet_say picks the first).',
  },
};

/** The tools an agent is offered when the user has let agents drive the pets. */
export function petToolDefs(): ToolDef[] {
  return [
    {
      name: 'pet_status',
      description: "List the user's desktop pets that are showing: where each stands and which animations it has.",
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'pet_say',
      description: `Make a desktop pet say a short line in a speech bubble above it (at most ${PET_SAY_MAX} characters). `
        + 'The bubble goes away by itself. Use it sparingly: it appears on the user\'s screen.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'What it says: one or two short sentences.' },
          mood: { type: 'string', enum: MOODS, description: 'Optional: the pet acts the feeling out.' },
          ...PET_PROP,
        },
        required: ['text'],
      },
    },
    {
      name: 'pet_walk',
      description: 'Make a desktop pet run somewhere on the main display. It stays there for a while, then walks '
        + 'home by itself. Say where with `to`, or with `x` and `y` (percent of the display: 0 is left/top, 100 is '
        + 'right/bottom), which win over `to`.',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            enum: PET_PLACES,
            description: 'home (its usual spot), cursor (beside the mouse pointer), left or right (the bottom corners), '
              + 'top, center, or random.',
          },
          x: { type: 'number', description: 'Percent from the left edge, 0 to 100.' },
          y: { type: 'number', description: 'Percent from the top edge, 0 to 100.' },
          ...PET_PROP,
        },
      },
    },
    {
      name: 'pet_play',
      description: 'Make a desktop pet play one of its animations for a few seconds. Name one with `animation` '
        + '(see pet_status for what each pet has), or give a `mood` and the pet plays its own animation for it.',
      parameters: {
        type: 'object',
        properties: {
          animation: { type: 'string', description: 'An animation the pet has, for example dance or wave.' },
          mood: { type: 'string', enum: MOODS, description: 'A feeling to act out, instead of naming an animation.' },
          ...PET_PROP,
        },
      },
    },
  ];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pct = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null);

/** The pet an agent named: undefined when it named none, null when the name is no pet. */
function petArg(raw: Record<string, unknown>): PetId | null | undefined {
  if (raw.pet === undefined) return undefined;
  return PET_IDS.find((id) => id === raw.pet) ?? null;
}

/** Reads one pet tool's arguments; null when they can't be used, so a bad call does nothing. */
export function parsePetCall(name: string, args: unknown): PetCommand | null {
  const raw = isRecord(args) ? args : {};
  if (name === 'pet_status') return { kind: 'status' };
  const pet = petArg(raw);
  if (pet === null) return null;
  const who = pet ?? null;
  if (name === 'pet_say') {
    const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, PET_SAY_MAX) : '';
    const to = raw.to === 'all' ? 'all' : (PET_IDS.find((id) => id === raw.to) ?? null);
    return text ? { kind: 'say', pet: who, text, mood: parseMood(raw.mood), ...(to === null ? {} : { to }) } : null;
  }
  if (name === 'pet_walk') {
    const xPct = pct(raw.x);
    const yPct = pct(raw.y);
    if (xPct !== null && yPct !== null) return { kind: 'walk', pet: who, to: { xPct, yPct } };
    const beside = PET_IDS.find((id) => id === raw.beside);
    if (beside) return beside === who ? null : { kind: 'walk', pet: who, to: { beside } };
    const place = PET_PLACES.find((p) => p === raw.to);
    return place ? { kind: 'walk', pet: who, to: { place } } : null;
  }
  if (name === 'pet_play') {
    const anim = typeof raw.animation === 'string' && ANIM_NAME.test(raw.animation) ? raw.animation : null;
    const mood = parseMood(raw.mood);
    return anim || mood ? { kind: 'play', pet: who, anim, mood } : null;
  }
  return null;
}

/** How long a bubble stays: time to read it, at least a few seconds and never longer than a quarter of a minute. */
export function speechMs(text: string): number {
  return Math.min(15_000, Math.max(3_500, 1_500 + text.length * 90));
}

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Rect = Point & Size;

const EDGE_GAP = 12;
const SPREAD_GAP = 8;
const NEXT_TO_GAP = 10;

/**
 * Where pet `index` of `count` goes for `target` (its top-left, DIPs). `area` is the main display's work area; `home`
 * is this pet's own home. Pets sent together stand in a row so they don't pile up. `beside` gives where another pet
 * is (or is going): a pet sent to it stands on its right, or on its left when that is off the display.
 */
export function walkSpot(
  target: PetTarget, size: Size, index: number, count: number,
  where: { area: Rect; cursor: { at: Point; area: Rect }; home: Point; random: () => number; beside?: (id: PetId) => Rect | null },
): Point {
  const { area } = where;
  if ('beside' in target) {
    const other = where.beside?.(target.beside);
    if (!other) return where.home;
    const right = other.x + other.width + NEXT_TO_GAP;
    const x = right + size.width <= area.x + area.width ? right : other.x - NEXT_TO_GAP - size.width;
    return keepInside({ x, y: other.y + other.height - size.height }, size, area);
  }
  if ('place' in target && target.place === 'home') return where.home;
  if ('place' in target && target.place === 'cursor') {
    return keepInside(standBeside(where.cursor.at, index, count, size), size, where.cursor.area);
  }
  const mid = (v: number, len: number): number => v + len / 2;
  const center = ((): Point => {
    if (!('place' in target)) {
      return { x: area.x + (target.xPct / 100) * area.width, y: area.y + (target.yPct / 100) * area.height };
    }
    const bottom = area.y + area.height - size.height / 2 - EDGE_GAP;
    switch (target.place) {
      case 'left': return { x: area.x + size.width / 2 + EDGE_GAP, y: bottom };
      case 'right': return { x: area.x + area.width - size.width / 2 - EDGE_GAP, y: bottom };
      case 'top': return { x: mid(area.x, area.width), y: area.y + size.height / 2 + EDGE_GAP };
      case 'random': return {
        x: area.x + size.width / 2 + where.random() * Math.max(0, area.width - size.width),
        y: area.y + size.height / 2 + where.random() * Math.max(0, area.height - size.height),
      };
      default: return { x: mid(area.x, area.width), y: mid(area.y, area.height) };
    }
  })();
  const spread = 'place' in target && target.place === 'random' ? 0 : (index - (count - 1) / 2) * (size.width + SPREAD_GAP);
  return keepInside({ x: center.x - size.width / 2 + spread, y: center.y - size.height / 2 }, size, area);
}

/** Size of a speech bubble's window and how far down its tail tip sits from the window's bottom, in DIPs. */
export const SPEECH_SIZE: Size = { width: 300, height: 190 };
/** Where on a pet's window, from its top, the tail points: near the top of the character. */
const SPEECH_TAIL_AT = 0.14;

/** Where the bubble's window goes (its top-left) for a pet at `pet`, kept inside `area`. */
export function speechAt(pet: Rect, area: Rect): Point {
  const at = {
    x: pet.x + pet.width / 2 - SPEECH_SIZE.width / 2,
    y: pet.y + pet.height * SPEECH_TAIL_AT - SPEECH_SIZE.height,
  };
  return keepInside(at, SPEECH_SIZE, area);
}

/** One showing pet, as an agent is told about it. */
export interface PetStatus {
  id: PetId;
  /** Where its centre is, percent of the main display from the left and the top. */
  xPct: number;
  yPct: number;
  away: boolean;
  anims: string[];
}

export function describePets(pets: readonly PetStatus[]): string {
  if (pets.length === 0) return NO_PETS;
  const lines = pets.map((p) => `- ${p.id}: at x ${p.xPct}%, y ${p.yPct}% (${p.away ? 'away from home' : 'at home'}); `
    + `animations: ${p.anims.join(', ')}`);
  return `Desktop pets showing:\n${lines.join('\n')}\nMoods: ${MOODS.join(', ')}.`;
}

/** The pets in one line, without their animations: where each stands and whether it is away from home. */
export function describePetsBrief(pets: readonly PetStatus[]): string {
  if (pets.length === 0) return NO_PETS;
  const each = pets.map((p) => `${p.id} (x ${p.xPct}%, y ${p.yPct}%, ${p.away ? 'away from home' : 'at home'})`);
  return `Pets showing: ${each.join('; ')}.`;
}

export const NO_PETS = 'No desktop pet is showing. The user can turn one on in lolPing\'s Desktop pets settings.';
export const PETS_BUSY = 'The pets are busy with the user\'s own ping; try again in a moment.';
export const PETS_FIGHTING = 'The pets are in the middle of a boxing match; try again in a moment.';
