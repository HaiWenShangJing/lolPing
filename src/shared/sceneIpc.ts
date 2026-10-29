/** The pets' scenes: one window where several pets act something out together (a mahjong table for now). */

import type { PetId, PetManifest } from './teammate/pet';

/** The scene page asks main for what it needs to start; main answers with null to a page that is not the scene window. */
export const SCENE_CH = { init: 'scene:init' } as const;

export const SCENE_MODES = ['mahjong'] as const;
export type SceneMode = (typeof SCENE_MODES)[number];

/** A pet that can act in a scene: its name, its colour and where its files are. */
export interface ScenePet {
  id: PetId;
  name: string;
  color: string;
  /** The URL the pet's files are under, as a pet window gets it. */
  base: string;
  manifest: PetManifest;
  /** Which way the art looks when it is not flipped. */
  face: 'left' | 'right';
}

/** The words of a scene in the user's language: single strings and the lines the pets say, by kind. */
export interface SceneText {
  title: string;
  words: Record<string, string>;
  lines: Record<string, string[]>;
}

export interface SceneInit {
  mode: SceneMode;
  text: SceneText;
  /** Every pet whose files are installed. */
  pets: ScenePet[];
  /** Who sits down first: the pets that are out on the desktop, then others. */
  picks: PetId[];
}

/** The page's bridge to main, in the page's global `sceneApi`. */
export interface SceneApi {
  init(): Promise<SceneInit | null>;
}
