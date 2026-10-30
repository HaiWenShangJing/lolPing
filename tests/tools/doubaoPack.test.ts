import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIFE_ANIMS } from '../../src/shared/teammate/life';
import { MOOD_ANIMS } from '../../src/shared/teammate/mood';
import { LIVE2D_PETS, PET_POSES, PET_RESTS, parsePetManifest } from '../../src/shared/teammate/pet';

// The art itself is cut only where tools/import-pets has run (it needs @napi-rs/canvas and the sheet), but the table of
// animations it cuts is plain data: this pins it to the maps the app keeps for Doubao, on every checkout.
const generator = pathToFileURL(join(__dirname, '..', '..', 'tools', 'import-pets', 'doubao.mjs')).href;
const { ANIMS, MARK_NAMES, ROW_CELLS, frameFile, parseStep } = (await import(/* @vite-ignore */ generator)) as {
  ANIMS: Record<string, { fps: number; frames: string[]; mark?: string }>;
  MARK_NAMES: string[];
  ROW_CELLS: number[];
  frameFile: (name: string, index: number, step: string, mark?: string) => string;
  parseStep: (step: string) => { row: number; col: number; flip: boolean; dx: number; dy: number };
};

const files = (name: string): string[] => ANIMS[name].frames.map((step, i) => frameFile(name, i, step, ANIMS[name].mark));

const manifest = (): unknown => ({
  id: 'doubao', width: 126, height: 160,
  anims: Object.fromEntries(Object.keys(ANIMS).map((name) => [name, { frames: files(name), fps: ANIMS[name].fps }])),
});

describe('the Doubao pack tools/import-pets cuts', () => {
  it('is a frame pack, not a Live2D one', () => {
    expect(LIVE2D_PETS).not.toContain('doubao');
  });

  it('writes a manifest the app accepts, with every animation and frame it cuts', () => {
    const parsed = parsePetManifest(manifest());
    expect(parsed?.id).toBe('doubao');
    for (const [name, { frames, fps }] of Object.entries(ANIMS)) {
      expect(parsed?.anims[name]?.frames, name).toHaveLength(frames.length);
      expect(parsed?.anims[name]?.fps, name).toBe(fps);
    }
    expect(Object.keys(parsed?.anims ?? {}).sort()).toEqual(Object.keys(ANIMS).sort());
  });

  it('cuts the five poses every frame pack needs', () => {
    for (const pose of PET_POSES) expect(ANIMS[pose], pose).toBeDefined();
  });

  it('cuts every animation the settings, the idle life and the moods ask for', () => {
    const asked = [...PET_RESTS.doubao, ...LIFE_ANIMS.doubao, ...Object.values(MOOD_ANIMS.doubao)];
    for (const name of asked) expect(ANIMS[name], name).toBeDefined();
  });

  it('starts at rest in its standing animation', () => {
    expect(PET_RESTS.doubao[0]).toBe('idle');
  });

  it('only names cells the sheet has, and marks it can draw', () => {
    for (const [name, { frames, mark }] of Object.entries(ANIMS)) {
      for (const step of frames) {
        const { row, col } = parseStep(step);
        expect(col, `${name} ${step}`).toBeLessThan(ROW_CELLS[row]);
      }
      if (mark) expect(MARK_NAMES, name).toContain(mark);
    }
    expect(() => parseStep('0.7')).toThrow();
    expect(() => parseStep('11.0')).toThrow();
    expect(() => parseStep('3.1x')).toThrow();
  });

  it('gives a frame the same file only when it looks the same', () => {
    const looks = new Map<string, string>();
    for (const [name, { frames, mark }] of Object.entries(ANIMS)) {
      frames.forEach((step, i) => {
        const file = frameFile(name, i, step, mark);
        const look = mark ? `${name} ${i}` : JSON.stringify(parseStep(step));
        expect(looks.get(file) ?? look, file).toBe(look);
        looks.set(file, look);
      });
    }
  });
});
