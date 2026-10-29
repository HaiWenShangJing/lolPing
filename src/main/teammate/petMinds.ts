import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PET_IDS, type PetId } from '../../shared/teammate/pet';
import { normalizeNotes, type PetNote } from '../../shared/teammate/petMind';
import { renameWithRetry } from '../settingsStore';

type Notes = Record<PetId, PetNote[]>;

function parse(text: string): Notes {
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    // no file yet, or not readable: every pet starts with no notes
  }
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const notes = {} as Notes;
  for (const id of PET_IDS) notes[id] = normalizeNotes(r[id]);
  return notes;
}

/** Who changed the notes: the pet itself, or the user in Settings (then the pet's session needs briefing again). */
export type NotesBy = 'pet' | 'user';

/** What each pet has chosen to remember, in one small file. Held in memory; every change is written out in order. */
export class PetMinds {
  private data: Notes;
  private writing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(id: PetId, by: NotesBy) => void>();

  constructor(private readonly file: string) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      // no file yet
    }
    this.data = parse(text);
  }

  notes(id: PetId): readonly PetNote[] {
    return this.data[id];
  }

  /** Replaces a pet's notes (normalised) and saves them. */
  set(id: PetId, notes: readonly PetNote[], by: NotesBy = 'pet'): void {
    this.data = { ...this.data, [id]: normalizeNotes(notes) };
    const snapshot = JSON.stringify(this.data);
    this.writing = this.writing.then(() => this.write(snapshot)).catch((err: unknown) => {
      console.warn('[teammate] pet notes:', err);
    });
    for (const fn of this.listeners) fn(id, by);
  }

  /** Calls `fn` whenever a pet's notes change. The result stops it. */
  onChange(fn: (id: PetId, by: NotesBy) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Settles once every change so far is on disk (or failed to get there). */
  flush(): Promise<void> {
    return this.writing;
  }

  private async write(text: string): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    try {
      await writeFile(tmp, text);
      await renameWithRetry(tmp, this.file);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }
}
