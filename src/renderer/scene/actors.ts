/**
 * The pets at the table. Each seat gets an actor: a Live2D model driven the way the desktop pet is, a pet drawn in frames
 * shown as a sprite, or, if a pet's files do not load, a plain coloured figure so the seat is not left empty. An actor
 * plays the cue the director gives it (see sceneMotion) and looks where it is told.
 */

import * as PIXI from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display/cubism4';
import type { ScenePet } from '../../shared/sceneIpc';
import {
  blinkFactor, faceOf, nextBlink, performanceFor, stepBlend, type Blend, type Param, type Slot as BlendSlot,
} from '../../shared/teammate/live2d';
import type { Live2dPack } from '../../shared/teammate/pet';
import { spriteMove, type Cue } from '../../shared/teammate/sceneMotion';
import { SEAT_X, figureAt } from './layout';
import { Performer } from './performer';

declare global {
  interface Window {
    Live2DCubismCore?: unknown;
  }
}

export interface Actor {
  readonly pet: ScenePet;
  /** The top of the figure on the stage, which a speech bubble goes over. */
  readonly top: number;
  /** A cue other than sitting is playing. */
  readonly busy: boolean;
  cue(cue: Cue, ms?: number): void;
  /** The mouth moves for `ms`. */
  talk(ms: number): void;
  /** Looks to one side or the other and up or down, each from -1 to 1. */
  gaze(x: number, y: number): void;
  /** Called every frame. */
  update(now: number): void;
  destroy(): void;
}

/** How long a reaction motion plays before the model settles back into its idle loop, though the face stays. */
const MOTION_CAP_MS = 4800;
/** How long a pet may take to load before its seat gets a plain figure instead. */
const LOAD_MS = 25000;
/** How long a pet takes to appear: a picture fades in, and a Live2D model, which cannot be faded, rises from behind the table. */
const FADE_MS = 450;
const RISE_PX = 70;

interface CoreModel {
  setParameterValueById(id: string, value: number, weight?: number): void;
  addParameterValueById(id: string, value: number, weight?: number): void;
}

type Live2dLib = typeof import('pixi-live2d-display/cubism4');

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`cannot load ${src}`));
    document.head.append(el);
  });
}

let kit: Promise<Live2dLib> | null = null;

/** The Live2D library, loaded once for every model: the Cubism Core is a script a pack brings, and the library needs it first. */
function live2dKit(base: string, pack: Live2dPack): Promise<Live2dLib> {
  kit ??= (async () => {
    await loadScript(`${base}/${pack.core}`);
    if (!window.Live2DCubismCore) throw new Error('the Cubism Core did not load');
    const lib = await import('pixi-live2d-display/cubism4');
    lib.Live2DModel.registerTicker(PIXI.Ticker);
    return lib;
  })().catch((err: unknown) => {
    kit = null;
    throw err;
  });
  return kit;
}

/** `p`, or an error if it takes more than `ms`; what arrives after that is handed to `late` so it can be thrown away. */
function within<T>(ms: number, p: Promise<T>, late: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let over = false;
    const timer = setTimeout(() => {
      over = true;
      reject(new Error(`took more than ${Math.round(ms / 1000)} s`));
    }, ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        if (over) late(value);
        else resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        if (!over) reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** How far into its sway each seat's pet starts, so the four do not breathe in step. */
const phaseOf = (seat: number): number => seat * 730;

class Live2dActor implements Actor {
  readonly top: number;
  private readonly perf: Performer;
  private readonly internal: Live2DModel['internalModel'];
  private readonly core: CoreModel;
  private readonly baseY: number;
  private blend: Blend = {};
  private effective = '';
  private effectiveAt = 0;
  private reacting = false;
  private reactUntil = 0;
  private last = performance.now();
  private readonly born = this.last;
  private blinkAt = nextBlink(this.last, Math.random);
  private blinkStart = -1000;

  constructor(
    readonly pet: ScenePet,
    seat: number,
    layer: PIXI.Container,
    private readonly model: Live2DModel,
    private readonly pack: Live2dPack,
    private readonly force: number,
  ) {
    this.perf = new Performer(pet.id, (a) => a in pet.manifest.anims, phaseOf(seat));
    this.internal = model.internalModel;
    this.core = this.internal.coreModel as unknown as CoreModel;
    const fig = figureAt('live2d', seat);
    this.top = fig.feet - fig.h;
    this.baseY = fig.feet;
    model.anchor.set(0.5, 1);
    model.scale.set(fig.h / this.internal.originalHeight);
    model.position.set(SEAT_X[seat] ?? 0, fig.feet + RISE_PX);
    model.zIndex = seat;
    layer.addChild(model);
    this.internal.on('beforeModelUpdate', this.frame);
  }

  get busy(): boolean {
    return this.perf.busy;
  }

  cue(cue: Cue, ms?: number): void {
    this.perf.start(cue, performance.now(), ms);
  }

  talk(ms: number): void {
    this.perf.talk(performance.now(), ms);
  }

  gaze(x: number, y: number): void {
    this.internal.focusController.focus(x, y);
  }

  update(now: number): void {
    // The model's own update runs only while it is being drawn, so what has to work before that (the rise, which a model
    // that is fully transparent would never get to) is done here, where the page's ticker calls it.
    this.perf.step(now);
    const rise = 1 - Math.min(1, (now - this.born) / FADE_MS);
    this.model.y = this.baseY - this.perf.sway(now).lift + rise ** 3 * RISE_PX;
  }

  private begin(name: string, now: number): void {
    this.effective = name;
    this.effectiveAt = now;
    const motion = this.pack.motions ? (this.pack.motions[name] ?? null) : performanceFor(name).motion;
    if (motion) {
      void this.model.motion(motion.group, motion.index, this.force);
      this.reacting = true;
      this.reactUntil = now + MOTION_CAP_MS;
    } else if (this.reacting) {
      this.internal.motionManager.stopAllMotions();
      this.reacting = false;
    }
  }

  private readonly frame = (): void => {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    this.perf.step(now);
    const want = this.perf.anim;
    if (want !== this.effective) this.begin(want, now);
    if (this.reacting && now >= this.reactUntil && this.effective !== 'think') {
      this.internal.motionManager.stopAllMotions();
      this.reacting = false;
    }
    if (now >= this.blinkAt) {
      this.blinkStart = now;
      this.blinkAt = nextBlink(now, Math.random);
    }
    const perf = performanceFor(this.effective);
    this.blend = stepBlend(this.blend, faceOf(perf), perf.weight, dt);
    const blink = blinkFactor(now - this.blinkStart);
    for (const [id, slot] of Object.entries(this.blend) as [Param, BlendSlot][]) {
      const eye = id === 'ParamEyeLOpen' || id === 'ParamEyeROpen';
      this.core.setParameterValueById(id, eye ? slot.value * blink : slot.value, slot.weight);
    }
    const sway = this.perf.sway(now);
    for (const [id, value] of Object.entries(sway.face) as [Param, number][]) this.core.addParameterValueById(id, value);
    const mouth = this.perf.mouth(now);
    if (mouth) {
      this.core.setParameterValueById('ParamMouthOpenY', mouth.open, 1);
      this.core.setParameterValueById('ParamMouthForm', mouth.form, 0.9);
    }
  };

  destroy(): void {
    this.internal.off('beforeModelUpdate', this.frame);
    this.model.destroy({ children: true, texture: true, baseTexture: true });
  }
}

/** A pet drawn in frames: its animations are strips of pictures, which the sprite shows one after another. */
class FrameActor implements Actor {
  readonly top: number;
  private readonly sprite = new PIXI.Sprite();
  private readonly perf: Performer;
  private readonly frames = new Map<string, PIXI.Texture[]>();
  private readonly flipX: number;
  private readonly feet: number;
  private readonly x: number;
  /** How big a picture may be drawn: the pack's own frame size, scaled to the seat. */
  private readonly box: { w: number; h: number };
  private k = 1;
  private anim = '';
  private animAt = 0;
  private shown: PIXI.Texture | null = null;
  private readonly born = performance.now();

  constructor(readonly pet: ScenePet, seat: number, layer: PIXI.Container, first: PIXI.Texture) {
    const m = pet.manifest;
    const fig = figureAt('frames', seat);
    this.top = fig.feet - fig.h;
    this.feet = fig.feet;
    this.x = SEAT_X[seat] ?? 0;
    const k = fig.h / Math.max(1, m.height);
    this.box = { w: m.width * k, h: fig.h };
    // The art faces one way; the pet looks towards the middle of the table.
    this.flipX = (pet.face === 'right') !== this.x < 640 ? -1 : 1;
    this.perf = new Performer(pet.id, (a) => a in m.anims, phaseOf(seat));
    this.sprite.anchor.set(0.5, 1);
    this.sprite.zIndex = seat;
    this.sprite.alpha = 0;
    layer.addChild(this.sprite);
    this.show(first);
  }

  get busy(): boolean {
    return this.perf.busy;
  }

  cue(cue: Cue, ms?: number): void {
    this.perf.start(cue, performance.now(), ms);
  }

  talk(ms: number): void {
    this.perf.talk(performance.now(), ms);
  }

  gaze(): void {
    // A flat picture has nowhere to look.
  }

  /** The pictures of an animation; they start loading the first time it is asked for. */
  textures(name: string): PIXI.Texture[] {
    let list = this.frames.get(name);
    if (!list) {
      list = (this.pet.manifest.anims[name]?.frames ?? []).map((f) => PIXI.Texture.from(`${this.pet.base}/${f}`));
      this.frames.set(name, list);
    }
    return list;
  }

  private show(tex: PIXI.Texture): void {
    this.shown = tex;
    this.sprite.texture = tex;
    this.k = Math.min(this.box.w / tex.width, this.box.h / tex.height);
  }

  update(now: number): void {
    this.perf.step(now);
    const name = this.perf.anim;
    if (name !== this.anim) {
      this.anim = name;
      this.animAt = now;
    }
    const list = this.textures(name);
    const fps = this.pet.manifest.anims[name]?.fps ?? 8;
    const tex = list.length > 0 ? list[Math.floor(((now - this.animAt) * fps) / 1000) % list.length] : undefined;
    if (tex && tex !== this.shown && tex.baseTexture.valid) this.show(tex);
    const sway = this.perf.sway(now);
    const m = spriteMove(sway);
    const talking = this.perf.mouth(now);
    this.sprite.position.set(this.x + m.dx * this.flipX, this.feet + m.dy);
    this.sprite.rotation = m.rot * this.flipX;
    this.sprite.scale.set(this.k * m.sx * this.flipX, this.k * m.sy * (talking ? 1 + talking.open * 0.03 : 1));
    this.sprite.alpha = Math.min(1, (now - this.born) / FADE_MS);
  }

  destroy(): void {
    this.sprite.destroy();
    for (const list of this.frames.values()) for (const t of list) t.destroy(true);
    this.frames.clear();
  }
}

/** What stands in for a pet whose files cannot be shown: a round, coloured figure that moves like the others. */
class StandIn implements Actor {
  readonly top: number;
  private readonly g = new PIXI.Graphics();
  private readonly perf: Performer;
  private readonly feet: number;
  private readonly x: number;
  private readonly born = performance.now();

  constructor(readonly pet: ScenePet, seat: number, layer: PIXI.Container) {
    const fig = figureAt('frames', seat);
    this.feet = fig.feet;
    this.x = SEAT_X[seat] ?? 0;
    this.top = fig.feet - 230;
    this.perf = new Performer(pet.id, () => false, phaseOf(seat));
    const colour = /^#[0-9a-f]{6}$/i.test(pet.color) ? Number.parseInt(pet.color.slice(1), 16) : 0x8a8a8a;
    const g = this.g;
    g.beginFill(colour, 0.85).drawRoundedRect(-86, -130, 172, 220, 56).endFill();
    g.beginFill(colour).drawCircle(0, -150, 70).endFill();
    g.beginFill(0xffffff).drawCircle(-24, -156, 13).drawCircle(24, -156, 13).endFill();
    g.beginFill(0x2a2420).drawCircle(-22, -154, 6).drawCircle(26, -154, 6).endFill();
    g.lineStyle(4, 0x2a2420).moveTo(-16, -120).quadraticCurveTo(0, -106, 16, -120);
    g.alpha = 0;
    g.zIndex = seat;
    g.position.set(this.x, this.feet);
    layer.addChild(g);
  }

  get busy(): boolean {
    return this.perf.busy;
  }

  cue(cue: Cue, ms?: number): void {
    this.perf.start(cue, performance.now(), ms);
  }

  talk(ms: number): void {
    this.perf.talk(performance.now(), ms);
  }

  gaze(): void {
    // Nothing to look with.
  }

  update(now: number): void {
    this.perf.step(now);
    const m = spriteMove(this.perf.sway(now));
    this.g.position.set(this.x + m.dx, this.feet + m.dy);
    this.g.rotation = m.rot;
    this.g.scale.set(m.sx, m.sy);
    this.g.alpha = Math.min(1, (now - this.born) / FADE_MS);
  }

  destroy(): void {
    this.g.destroy();
  }
}

async function loadLive2d(pet: ScenePet, seat: number, layer: PIXI.Container): Promise<Actor> {
  const pack = pet.manifest.live2d;
  if (!pack) throw new Error('not a Live2D pack');
  const lib = await live2dKit(pet.base, pack);
  const model = await within(LOAD_MS, lib.Live2DModel.from(`${pet.base}/${pack.model}`, { autoInteract: false }), (m) =>
    m.destroy({ children: true, texture: true, baseTexture: true }),
  );
  return new Live2dActor(pet, seat, layer, model, pack, lib.MotionPriority.FORCE);
}

async function loadFrames(pet: ScenePet, seat: number, layer: PIXI.Container): Promise<Actor> {
  const anims = pet.manifest.anims;
  const rest = anims.idle ?? Object.values(anims)[0];
  const file = rest?.frames[0];
  if (!file) throw new Error('the pack has no frames');
  const first = await within(LOAD_MS, PIXI.Texture.fromURL(`${pet.base}/${file}`), (t) => t.destroy(true));
  return new FrameActor(pet, seat, layer, first);
}

/**
 * The actor for `pet` at `seat`, added to `layer` once it is ready. A pet that cannot be loaded (a missing file, a
 * machine without WebGL for Live2D) gets a stand-in, since an empty seat would look like a mistake.
 */
export async function loadActor(pet: ScenePet, seat: number, layer: PIXI.Container): Promise<Actor> {
  try {
    return await (pet.manifest.live2d ? loadLive2d(pet, seat, layer) : loadFrames(pet, seat, layer));
  } catch (err) {
    console.warn(`[scene] ${pet.id} could not be shown:`, err instanceof Error ? err.message : err);
    return new StandIn(pet, seat, layer);
  }
}
