import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIVE2D_PETS, parsePetManifest, PET_IDS, PET_POSES, PET_RESTS } from '../../../src/shared/teammate/pet';

const root = join(__dirname, '..', '..', '..', 'assets', 'pets');
// Live2D Inc.'s files can't be committed: a pack that is downloaded is checked only where tools/import-pets has put it.
const downloaded = new Set<string>(LIVE2D_PETS);
const packs = PET_IDS.filter((id) => !downloaded.has(id) || existsSync(join(root, id, 'manifest.json')));

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

  it('has the model and the core of a Live2D pack', () => {
    const files = manifest?.live2d ? [manifest.live2d.model, manifest.live2d.core] : [];
    expect(files.filter((f) => !existsSync(join(root, id, f)))).toEqual([]);
  });

  it('only names motions its model has, and carries none of Live2D\'s voice clips', () => {
    if (!manifest?.live2d) return;
    const model = JSON.parse(readFileSync(join(root, id, manifest.live2d.model), 'utf8')) as {
      FileReferences: { Motions?: Record<string, { Sound?: string }[]> };
    };
    const groups = model.FileReferences.Motions ?? {};
    for (const [name, ref] of Object.entries(manifest.live2d.motions ?? {})) {
      expect(groups[ref.group]?.length ?? 0, `${name} → ${ref.group}/${ref.index}`).toBeGreaterThan(ref.index);
    }
    expect(Object.values(groups).flat().filter((m) => m.Sound !== undefined)).toEqual([]);
  });
});
