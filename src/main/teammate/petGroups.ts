import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalizeGroups, removeGroup, saveGroup, type PetGroup } from '../../shared/teammate/petGroups';
import { renameWithRetry } from '../settingsStore';

/** What the society asks of the groups: read them, make or change one, delete one. */
export interface GroupStore {
  list(): readonly PetGroup[];
  /** The group as saved; null when it was refused (see `saveGroup`). */
  save(input: { id: string | null; name: string; members: readonly string[] }): PetGroup | null;
  /** False when there was no such group. */
  remove(id: string): boolean;
}

/** The groups the user made, in one small file. Held in memory; every change is written out in order. */
export class PetGroups implements GroupStore {
  private data: PetGroup[];
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, private readonly random: () => number = Math.random) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // no file yet, or not readable: no groups
    }
    this.data = normalizeGroups(raw);
  }

  list(): readonly PetGroup[] {
    return this.data;
  }

  save(input: { id: string | null; name: string; members: readonly string[] }): PetGroup | null {
    const { groups, saved } = saveGroup(this.data, input, this.random);
    if (saved) this.set(groups);
    return saved;
  }

  remove(id: string): boolean {
    const groups = removeGroup(this.data, id);
    if (groups.length === this.data.length) return false;
    this.set(groups);
    return true;
  }

  /** Settles once every change so far is on disk (or failed to get there). */
  flush(): Promise<void> {
    return this.writing;
  }

  private set(groups: PetGroup[]): void {
    this.data = groups;
    const snapshot = JSON.stringify(groups);
    this.writing = this.writing.then(() => this.write(snapshot)).catch((err: unknown) => {
      console.warn('[teammate] pet groups:', err);
    });
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
