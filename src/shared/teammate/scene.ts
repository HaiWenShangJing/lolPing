/** What the scene windows need from the pets and the user's language: who sits down, and the words they say. */

import type { SceneText } from '../sceneIpc';
import type { GameWords } from './gameText';
import type { PetId } from './pet';

/**
 * Up to `count` pets for a scene: `on` (the pets out on the desktop) first, in their order, then the rest in random order.
 * Only pets in `available` can sit, since a pet whose files are not installed cannot be drawn.
 */
export function pickCast(on: readonly PetId[], available: readonly PetId[], count: number, random: () => number): PetId[] {
  const can = (id: PetId): boolean => available.includes(id);
  const cast = on.filter(can).slice(0, count);
  const rest = available.filter((id) => !cast.includes(id));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j] as PetId, rest[i] as PetId];
  }
  return [...cast, ...rest].slice(0, count);
}

/**
 * The cast after the user clicks `id` in the list of pets: one that sits stands up (the last one cannot, since a table
 * of nobody is no scene), another sits down at the end, and at a full table it takes the place of whoever sat first.
 */
export function togglePick(cast: readonly PetId[], id: PetId, max: number): PetId[] {
  if (cast.includes(id)) return cast.length > 1 ? cast.filter((p) => p !== id) : [...cast];
  return cast.length < max ? [...cast, id] : [...cast.slice(Math.max(0, cast.length - max + 1)), id];
}

/** `template` with its `{n}` replaced by `n`. */
export const fillCount = (template: string, n: number): string => template.replace('{n}', String(n));

/** The mahjong scene's words: `{n}` in a string stands for a number the page fills in. */
export function mahjongSceneText(g: GameWords): SceneText {
  const m = g.mahjong;
  return {
    title: g.mahjongTitle,
    words: {
      wall: m.wall('{n}'), round: m.round('{n}'), loading: m.loading, failed: m.failed, empty: m.empty, seats: m.seats,
      reseat: m.reseat,
      soundOn: m.soundOn, soundOff: m.soundOff, shuffle: m.shuffle, dealer: m.dealer, drawGame: m.drawGame,
      pong: m.shout.pong, chow: m.shout.chow, tsumo: m.shout.tsumo, ron: m.shout.ron,
    },
    lines: Object.fromEntries(Object.entries(m.lines).map(([kind, lines]) => [kind, [...lines]])),
  };
}
