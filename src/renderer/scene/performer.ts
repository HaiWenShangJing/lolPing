/**
 * What one pet is doing in the scene, apart from how it is drawn: the cue it is playing, since when, and how long it has
 * been talking. A Live2D pet and a pet drawn in frames both follow one of these, so the cues mean the same to either.
 */

import { mouthAt, type Sway } from '../../shared/teammate/live2d';
import type { PetId } from '../../shared/teammate/pet';
import { CUE_SPECS, cueAnim, sceneGestureAt, type Cue } from '../../shared/teammate/sceneMotion';

export class Performer {
  private cue: Cue = 'sit';
  private at = 0;
  /** When the cue gives way to sitting; null for sitting, which never does. */
  private until: number | null = null;
  private talkAt = 0;
  private talkFor = 0;

  /**
   * `has` says which animations the pet's pack has; `phase` (ms) is how far into its sway the pet is when it sits, so
   * pets that sit down together do not all breathe in step.
   */
  constructor(
    private readonly pet: PetId,
    private readonly has: (anim: string) => boolean,
    private readonly phase = 0,
  ) {}

  get playing(): Cue {
    return this.cue;
  }

  /** A cue other than sitting is playing. */
  get busy(): boolean {
    return this.cue !== 'sit';
  }

  /** Starts `cue` at `now`, for `ms` or its own time; a pet sits back after it. */
  start(cue: Cue, now: number, ms?: number): void {
    this.cue = cue;
    this.at = now;
    this.until = cue === 'sit' ? null : now + (ms ?? CUE_SPECS[cue].ms);
  }

  talk(now: number, ms: number): void {
    this.talkAt = now;
    this.talkFor = ms;
  }

  /** Lets a cue that has run its time give way to sitting; says whether it did. */
  step(now: number): boolean {
    if (this.until === null || now < this.until) return false;
    this.start('sit', now);
    return true;
  }

  /** The animation of the pack to play now: the cue's, or the pet's idle one where the pack has no such animation. */
  get anim(): string {
    const a = cueAnim(this.pet, this.cue, this.has);
    return this.has(a) ? a : 'idle';
  }

  /** The head and body movement now. */
  sway(now: number): Sway {
    const t = now - this.at;
    return sceneGestureAt(CUE_SPECS[this.cue].gesture, this.cue === 'sit' ? t + this.phase : t);
  }

  /** The mouth now, or null when the pet is not talking. */
  mouth(now: number): { open: number; form: number } | null {
    return mouthAt(now - this.talkAt, this.talkFor);
  }
}
