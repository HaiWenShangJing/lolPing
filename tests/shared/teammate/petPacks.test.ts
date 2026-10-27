import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePetManifest, PET_IDS, PET_POSES, PET_RESTS } from '../../../src/shared/teammate/pet';

const root = join(__dirname, '..', '..', '..', 'assets', 'pets');

describe.each(PET_IDS)('bundled %s pack', (id) => {
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
});
