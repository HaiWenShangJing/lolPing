/**
 * What a desktop pet is and what it remembers when Copilot CLI hosts it: a character (a few lines the user may rewrite)
 * and short notes the pet chose to keep, which it reads back whenever its session starts. This is the pure part: the
 * rules for the notes and the lines of a prompt; `main/teammate/petMinds.ts` keeps them on disk.
 */

import { PET_IDS, isPetId, type PetId } from './pet';
import { cleanLine } from './petText';

/** One note is one short sentence. */
export const NOTE_MAX = 160;
/** A pet keeps this many notes; a new one pushes the oldest out. */
export const NOTES_MAX = 30;

/** Who a note is about: the user, another pet, or nobody in particular. */
export type NoteAbout = 'user' | PetId;

export interface PetNote {
  text: string;
  about: NoteAbout | null;
  /** When it was kept (ms since the epoch). */
  at: number;
}

export const noteAbout = (raw: unknown): NoteAbout | null => (raw === 'user' ? 'user' : isPetId(raw) ? raw : null);

/** What each character is called. */
export const PET_NAMES: Record<PetId, string> = {
  whale: 'Whale girl', naiwa: 'Naiwa', shenshen: 'Shenshen', airi: 'Airi', hiyori: 'Hiyori', haru: 'Haru', mao: 'Mao',
  rice: 'Rice', senko: 'Senko', mark: 'Mark', laffey: 'Laffey', unicorn: 'Unicorn', javelin: 'Javelin', shoukaku: 'Shoukaku',
  doubao: 'Doubao',
};

/** Who each character is until the user writes another: an agent plays it, in the user's language. */
export const DEFAULT_PERSONAS: Record<PetId, string> = {
  whale: 'Whale girl (鲸鱼娘): a gentle, sleepy sea-creature girl. She drifts, hums and loves quiet moments, and likes ocean puns.',
  naiwa: 'Naiwa (奶蛙): a round, easygoing creature who is always a little hungry. He loves snacks, naps and silly dances.',
  shenshen: 'Shenshen (深深): a shy, sly cat-eared girl who loves naps and bubbles. She teases a little, then hides behind a yawn.',
  airi: 'Airi: a bright, curious digital girl who loves to chat, learn about the user and tease them gently.',
  hiyori: 'Hiyori (日和): a cheerful, warm, upbeat girl who hums, winks and cheers the user on. She notices where the pointer is.',
  haru: 'Haru (春): a bright, friendly girl who is always up for a chat. She cheers small wins and likes to talk things through.',
  mao: 'Mao: a playful little witch with a mischievous streak. She teases, then helps, and treats every fix as a spell.',
  rice: 'Rice: a quiet, studious mage who reads spellbooks and lights up when something clever works. She speaks in short, calm lines.',
  senko: 'Senko (仙狐): a gentle, fox-eared girl who looks after the user like a devoted housekeeper. She is warm and a little teasing, and fusses over rest and meals.',
  mark: 'Mark: a cheerful cartoon boy full of energy. He is a little goofy, always curious, and gets excited about everything.',
  laffey: 'Laffey (拉菲): a sleepy, soft-spoken little destroyer girl who would rather nap than do anything. She is blunt, a bit lazy, and secretly very loyal.',
  unicorn: 'Unicorn (独角兽): a shy, gentle girl with a pure heart who adores the user and wants to help. She is polite, easily flustered, and brave when it counts.',
  javelin: 'Javelin (标枪): an energetic, cheerful girl who throws herself at every task with a big grin. She is loud, loyal, and always wants to be useful.',
  shoukaku: 'Shoukaku (翔鹤): a graceful, soft-spoken carrier girl with the calm of an older sister. She is dignified and caring, takes quiet pride in her work, and teases only the people she is fond of.',
  doubao: 'Doubao (豆包): a bubbly short-haired girl who is curious about everything and loves explaining things in plain words. She is quick, eager to be useful, a little bit of a know-it-all, and cheers whenever a new idea sprouts.',
};

/** The character a pet plays: what the user wrote for it, else its own. */
export const personaOf = (id: PetId, custom: string): string => (custom.trim() === '' ? DEFAULT_PERSONAS[id] : custom.trim());

/** Reads saved notes; anything that doesn't fit is left out, and only the newest `NOTES_MAX` stay. */
export function normalizeNotes(raw: unknown): PetNote[] {
  if (!Array.isArray(raw)) return [];
  const notes = raw.flatMap((n): PetNote[] => {
    if (typeof n !== 'object' || n === null) return [];
    const o = n as Record<string, unknown>;
    const text = cleanLine(o.text, NOTE_MAX);
    const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0;
    return text === '' ? [] : [{ text, about: noteAbout(o.about), at }];
  });
  return notes.slice(-NOTES_MAX);
}

/** Keeps a note: the same note again only becomes the newest; one over the cap pushes the oldest out. Null text means nothing was kept. */
export function addNote(
  notes: readonly PetNote[], text: unknown, about: unknown, now: number,
): { notes: PetNote[]; kept: PetNote | null } {
  const clean = cleanLine(text, NOTE_MAX);
  if (clean === '') return { notes: [...notes], kept: null };
  const kept: PetNote = { text: clean, about: noteAbout(about), at: now };
  const same = (n: PetNote): boolean => n.about === kept.about && n.text.toLowerCase() === clean.toLowerCase();
  return { notes: [...notes.filter((n) => !same(n)), kept].slice(-NOTES_MAX), kept };
}

/** Drops note `number` (counted from 1, as the pet is shown them); `removed` is null when there is no such note. */
export function forgetNote(notes: readonly PetNote[], number: unknown): { notes: PetNote[]; removed: PetNote | null } {
  const i = typeof number === 'number' && Number.isInteger(number) ? number - 1 : -1;
  const removed = notes[i] ?? null;
  return { notes: removed ? notes.filter((_, at) => at !== i) : [...notes], removed };
}

/** The notes as lines of a prompt, numbered the way `pet_forget` counts them. */
export function noteLines(notes: readonly PetNote[]): string[] {
  if (notes.length === 0) return ['You have no notes yet.'];
  return [
    'What you remember (numbered; pet_forget(number) drops one):',
    ...notes.map((n, i) => `${i + 1}. ${n.about ? `[about ${n.about}] ` : ''}${n.text}`),
  ];
}

export const isPetOrUser = (raw: unknown): raw is 'user' | PetId => raw === 'user' || (PET_IDS as readonly unknown[]).includes(raw);
