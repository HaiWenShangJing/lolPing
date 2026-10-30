import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FAN_PETS, LIVE2D_PETS, parsePetManifest, PET_IDS, PET_POSES, PET_REST_CHOICES, PET_RESTS,
} from '../../../src/shared/teammate/pet';

const root = join(__dirname, '..', '..', '..', 'assets', 'pets');
// Live2D Inc.'s sample models can't be committed: such a pack is checked only where tools/import-pets has put it. The fan and
// game packs and Doubao are committed, so a checkout that lacks one fails here.
const local = new Set<string>(LIVE2D_PETS.filter((id) => !FAN_PETS.includes(id)));
const packs = PET_IDS.filter((id) => !local.has(id) || existsSync(join(root, id, 'manifest.json')));

/** The motion groups a Live2D pack's model lists. */
const motionGroups = (id: string, modelFile: string): Record<string, { Sound?: string }[]> => {
  const model = JSON.parse(readFileSync(join(root, id, modelFile), 'utf8')) as {
    FileReferences: { Motions?: Record<string, { Sound?: string }[]> };
  };
  return model.FileReferences.Motions ?? {};
};

describe.each(packs)('bundled %s pack', (id) => {
  const manifest = parsePetManifest(JSON.parse(readFileSync(join(root, id, 'manifest.json'), 'utf8')));

  it('has a valid manifest', () => {
    expect(manifest?.id).toBe(id);
  });

  it('has every pose and every resting animation the settings offer', () => {
    for (const name of [...PET_POSES, ...PET_RESTS[id]]) expect(manifest?.anims[name], name).toBeDefined();
  });

  it('has every frame file it lists', () => {
    const missing = Object.values(manifest?.anims ?? {}).flatMap((a) => a.frames).filter((f) => !existsSync(join(root, id, f)));
    expect(missing).toEqual([]);
  });

  it('has the model of a Live2D pack, and names the Cubism Core that .gitignore keeps out of the repository', () => {
    if (!manifest?.live2d) return;
    expect(existsSync(join(root, id, manifest.live2d.model))).toBe(true);
    expect(manifest.live2d.core).toBe('live2dcubismcore.min.js');
  });

  it('only names motions its model has, and carries none of Live2D\'s voice clips', () => {
    if (!manifest?.live2d) return;
    const groups = motionGroups(id, manifest.live2d.model);
    for (const [name, ref] of Object.entries(manifest.live2d.motions ?? {})) {
      expect(groups[ref.group]?.length ?? 0, `${name} → ${ref.group}/${ref.index}`).toBeGreaterThan(ref.index);
    }
    expect(Object.values(groups).flat().filter((m) => m.Sound !== undefined)).toEqual([]);
  });

  // The model starts its idle loop from the `Idle` group: without one it stands still between reactions.
  it('has an Idle motion group for its Live2D model to loop', () => {
    if (!manifest?.live2d) return;
    expect(motionGroups(id, manifest.live2d.model).Idle?.length ?? 0).toBeGreaterThan(0);
  });

  it('offers, to rest in, idle and each animation a Live2D pack has a motion for, and every one when it has none', () => {
    const motions = Object.keys(manifest?.live2d?.motions ?? {});
    if (motions.length === 0) {
      expect(PET_REST_CHOICES[id]).toEqual(PET_RESTS[id]);
      return;
    }
    expect([...PET_REST_CHOICES[id]].sort()).toEqual(['idle', ...motions].sort());
    expect(PET_REST_CHOICES[id][0]).toBe('idle');
  });
});
