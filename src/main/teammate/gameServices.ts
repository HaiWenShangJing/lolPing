import type { PetId } from '../../shared/teammate/pet';
import type { GameWords } from '../../shared/teammate/gameText';
import type { GameBrain } from './gameBrain';

/** What a game needs from the app: the user's words and pets, a mind for the computer players, and time. */
export interface GameServices {
  /** The words in the user's language, what each pet is called, and the language the players speak in prompts. */
  words(): { g: GameWords; names: Record<PetId, string>; language: string };
  /** The pets that are out on the desktop. */
  petsOn(): PetId[];
  persona(id: PetId): string;
  /** Whether a mind can be started: Copilot CLI is set up. */
  canThink(): boolean;
  /** A new mind for one game, or null when none can be started. */
  brain(): GameBrain | null;
  after(ms: number, fn: () => void): () => void;
  random(): number;
  /** The folder with each pet's files, where the scenes read them from. */
  petsDir: string;
}
