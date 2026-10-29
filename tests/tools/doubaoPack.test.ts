import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIFE_ANIMS } from '../../src/shared/teammate/life';
import { MOOD_ANIMS } from '../../src/shared/teammate/mood';
import { LIVE2D_PETS, PET_POSES, PET_RESTS, parsePetManifest } from '../../src/shared/teammate/pet';

// The art itself is drawn only where tools/import-pets has run (it needs @napi-rs/canvas), but the table of animations
// it draws is plain data: this pins it to the maps the app keeps for Doubao, on every checkout.
const generator = pathToFileURL(join(__dirname, '..', '..', 'tools', 'import-pets', 'doubao.mjs')).href;
const { ANIMS } = (await import(/* @vite-ignore */ generator)) as { ANIMS: Record<string, { frames: number; fps: number }> };

const manifest = (): unknown => ({
  id: 'doubao', width: 160, height: 160,
  anims: Object.fromEntries(Object.entries(ANIMS).map(([name, { frames, fps }]) => [
    name, { frames: Array.from({ length: frames }, (_, i) => `${name}_${String(i).padStart(2, '0')}.png`), fps },
  ])),
});

describe('the Doubao pack tools/import-pets draws', () => {
  it('is a frame pack, not a Live2D one', () => {
    expect(LIVE2D_PETS).not.toContain('doubao');
  });

  it('writes a manifest the app accepts, with every animation and frame it draws', () => {
    const parsed = parsePetManifest(manifest());
    expect(parsed?.id).toBe('doubao');
    for (const [name, { frames, fps }] of Object.entries(ANIMS)) {
      expect(parsed?.anims[name]?.frames, name).toHaveLength(frames);
      expect(parsed?.anims[name]?.fps, name).toBe(fps);
    }
    expect(Object.keys(parsed?.anims ?? {}).sort()).toEqual(Object.keys(ANIMS).sort());
  });

  it('draws the five poses every frame pack needs', () => {
    for (const pose of PET_POSES) expect(ANIMS[pose], pose).toBeDefined();
  });

  it('draws every animation the settings, the idle life and the moods ask for', () => {
    const asked = [...PET_RESTS.doubao, ...LIFE_ANIMS.doubao, ...Object.values(MOOD_ANIMS.doubao)];
    for (const name of asked) expect(ANIMS[name], name).toBeDefined();
  });

  it('starts at rest in its standing animation', () => {
    expect(PET_RESTS.doubao[0]).toBe('idle');
  });
});
