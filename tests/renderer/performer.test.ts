import { describe, expect, it } from 'vitest';
import { Performer } from '../../src/renderer/scene/performer';
import { L2D_ANIMS } from '../../src/shared/teammate/live2d';
import { PET_RESTS } from '../../src/shared/teammate/pet';
import { CUES, CUE_SPECS } from '../../src/shared/teammate/sceneMotion';

const hasAll = (): boolean => true;
const hasOnly = (...names: string[]) => (anim: string): boolean => names.includes(anim);

describe('Performer', () => {
  it('starts out sitting, at the pet\'s rest animation', () => {
    const p = new Performer('hiyori', hasAll);
    expect(p.playing).toBe('sit');
    expect(p.busy).toBe(false);
    expect(p.anim).toBe(PET_RESTS.hiyori[0]);
  });

  it('plays a cue for the time of its spec and then sits back', () => {
    const p = new Performer('hiyori', hasAll);
    p.start('win', 1000);
    expect(p.busy).toBe(true);
    expect(p.step(1000 + CUE_SPECS.win.ms - 1)).toBe(false);
    expect(p.playing).toBe('win');
    expect(p.step(1000 + CUE_SPECS.win.ms)).toBe(true);
    expect(p.playing).toBe('sit');
    expect(p.busy).toBe(false);
  });

  it('plays a cue for the time it is told, when it is told', () => {
    const p = new Performer('hiyori', hasAll);
    p.start('think', 0, 5000);
    expect(p.step(4999)).toBe(false);
    expect(p.step(5000)).toBe(true);
  });

  it('never ends sitting, and a new cue replaces the one playing', () => {
    const p = new Performer('hiyori', hasAll);
    expect(p.step(1e9)).toBe(false);
    p.start('throw', 0);
    p.start('shock', 100);
    expect(p.playing).toBe('shock');
    expect(p.step(100 + CUE_SPECS.throw.ms)).toBe(false);
    expect(p.step(100 + CUE_SPECS.shock.ms)).toBe(true);
  });

  it('gives every cue an animation the pack has', () => {
    for (const cue of CUES) {
      const p = new Performer('hiyori', (a) => L2D_ANIMS.includes(a));
      p.start(cue, 0);
      expect(L2D_ANIMS).toContain(p.anim);
    }
  });

  it('falls back to idle when the pack has not the animation the cue wants', () => {
    const p = new Performer('whale', hasOnly('idle'));
    for (const cue of CUES) {
      p.start(cue, 0);
      expect(p.anim).toBe('idle');
    }
  });

  it('sways a seated pet, each one a little differently, but moves a cue from its start whatever the phase', () => {
    const a = new Performer('hiyori', hasAll, 0);
    const b = new Performer('hiyori', hasAll, 900);
    expect(a.sway(1500).face).not.toEqual(b.sway(1500).face);
    a.start('draw', 2000);
    b.start('draw', 2000);
    expect(a.sway(2300)).toEqual(b.sway(2300));
  });

  it('opens the mouth only while talking', () => {
    const p = new Performer('hiyori', hasAll);
    expect(p.mouth(500)).toBeNull();
    p.talk(1000, 1500);
    expect(p.mouth(999)).toBeNull();
    expect(p.mouth(1400)).not.toBeNull();
    expect(p.mouth(2500)).toBeNull();
  });
});
