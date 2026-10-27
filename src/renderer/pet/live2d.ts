import type { PetApi, PetInit, PetLookMsg, PetPoseMsg, PetTalkMsg } from '../../shared/petIpc';
import {
  blinkFactor, faceOf, gestureAt, mouthAt, nextBlink, performanceFor, pickPoke, POKE_MS, stepBlend, walkAt, type Blend, type Param,
} from '../../shared/teammate/live2d';

declare global {
  interface Window {
    Live2DCubismCore?: unknown;
  }
}

/** What the page drives on a Live2D pet; main sends poses, where the pointer is and when the teammate speaks. */
export interface Live2dPet {
  pose(msg: PetPoseMsg): void;
  look(msg: PetLookMsg): void;
  talk(msg: PetTalkMsg): void;
}

interface CoreModel {
  setParameterValueById(id: string, value: number, weight?: number): void;
  addParameterValueById(id: string, value: number, weight?: number): void;
}

/** The pointer must move this far (px) with the button down before it is a drag; a click is a poke. */
const DRAG_PX = 4;
/** Alpha (0 to 255) above which the pixel under the pointer is the character. */
const HIT_ALPHA = 12;
/** The figure's height as a fraction of the window, leaving room above for it to hop. */
const FIT = 0.94;
/** How long a reaction motion plays before the character settles back into its idle loop, though the face stays. */
const MOTION_CAP_MS = 4800;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`cannot load ${src}`));
    document.head.append(el);
  });
}

/**
 * Draws a Live2D pack in a transparent canvas filling the window. The Cubism Core is a script the pack brings, so it is
 * loaded first and the libraries that need it only after.
 */
export async function startLive2d(init: PetInit, api: Pick<PetApi, 'drag' | 'hit'>): Promise<Live2dPet> {
  const pack = init.manifest.live2d;
  if (!pack) throw new Error('not a Live2D pack');
  await loadScript(`${init.base}/${pack.core}`);
  if (!window.Live2DCubismCore) throw new Error('the Cubism Core did not load');
  const [PIXI, live2d] = await Promise.all([import('pixi.js'), import('pixi-live2d-display/cubism4')]);
  const { Live2DModel, MotionPriority } = live2d;
  Live2DModel.registerTicker(PIXI.Ticker);

  const { width, height } = init.manifest;
  const canvas = document.createElement('canvas');
  canvas.id = 'stage';
  document.body.append(canvas);
  const app = new PIXI.Application({
    view: canvas, width, height, backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true,
  });
  const renderer = app.renderer;
  if (!(renderer instanceof PIXI.Renderer)) throw new Error('WebGL is not available');
  const model = await Live2DModel.from(`${init.base}/${pack.model}`, { autoInteract: false });
  const internal = model.internalModel;
  const core = internal.coreModel as unknown as CoreModel;
  const scale = (height * FIT) / internal.originalHeight;
  model.scale.set(scale);
  model.anchor.set(0.5, 1);
  const baseY = height;
  model.position.set(width / 2, baseY);
  app.stage.addChild(model);

  const thought = new PIXI.Container();
  const puff = new PIXI.Graphics();
  puff.lineStyle(1, 0xb0bec5).beginFill(0xffffff, 0.96).drawRoundedRect(-24, -11, 48, 22, 11).endFill();
  const specks = [0, 1, 2].map((i) => {
    const g = new PIXI.Graphics();
    g.beginFill(0x546e7a).drawCircle(0, 0, 3).endFill();
    g.x = -13 + i * 13;
    return g;
  });
  thought.addChild(puff, ...specks);
  thought.position.set(width * 0.76, height * 0.1);
  thought.visible = false;
  app.stage.addChild(thought);

  let commanded = init.rest;
  let flip = false;
  let effective = '';
  let effectiveAt = 0;
  let reacting = false;
  let reactUntil = 0;
  let pokeAnim: string | null = null;
  let pokeUntil = 0;
  let lastPoke: string | null = null;
  let talkAt = 0;
  let talkFor = 0;
  let blend: Blend = {};
  let lastFrame = performance.now();
  let blinkAt = nextBlink(lastFrame, Math.random);
  let blinkStart = -1000;
  let down: { id: number; x: number; y: number; dragging: boolean } | null = null;
  let probe: { x: number; y: number } | null = null;
  let over = false;

  // Sent on every probe: the main process keeps what's current and may have reset it when the pointer left the window.
  const setOver = (value: boolean): void => {
    over = value;
    api.hit({ over });
  };

  const begin = (name: string, now: number): void => {
    effective = name;
    effectiveAt = now;
    const motion = performanceFor(name).motion;
    if (motion) {
      void model.motion(motion.group, motion.index, MotionPriority.FORCE);
      reacting = true;
      reactUntil = now + MOTION_CAP_MS;
    } else if (reacting) {
      internal.motionManager.stopAllMotions();
      reacting = false;
    }
  };

  internal.on('beforeModelUpdate', () => {
    const now = performance.now();
    const dt = now - lastFrame;
    lastFrame = now;
    const want = pokeAnim !== null && now < pokeUntil ? pokeAnim : commanded;
    if (want !== effective) begin(want, now);
    if (reacting && now >= reactUntil && effective !== 'think') {
      internal.motionManager.stopAllMotions();
      reacting = false;
    }
    if (now >= blinkAt) {
      blinkStart = now;
      blinkAt = nextBlink(now, Math.random);
    }
    const perf = performanceFor(effective);
    blend = stepBlend(blend, faceOf(perf), perf.weight, dt);
    const blink = blinkFactor(now - blinkStart);
    for (const [id, slot] of Object.entries(blend) as [Param, { value: number; weight: number }][]) {
      const eye = id === 'ParamEyeLOpen' || id === 'ParamEyeROpen';
      core.setParameterValueById(id, eye ? slot.value * blink : slot.value, slot.weight);
    }
    const sway = effective === 'walk'
      ? walkAt(now - effectiveAt, flip ? -1 : 1)
      : gestureAt(perf.gesture, now - effectiveAt);
    for (const [id, value] of Object.entries(sway.face) as [Param, number][]) core.addParameterValueById(id, value);
    const mouth = mouthAt(now - talkAt, talkFor);
    if (mouth) {
      core.setParameterValueById('ParamMouthOpenY', mouth.open, 1);
      core.setParameterValueById('ParamMouthForm', mouth.form, 0.9);
    }
    model.y = baseY - sway.lift;
    thought.visible = perf.dots === true;
    if (thought.visible) specks.forEach((s, i) => { s.y = -3 * Math.max(0, Math.sin(now / 260 - i * 0.8)); });
  });

  // The window passes clicks through the empty corners: the pixel under the pointer says whether it is on the character.
  renderer.on('postrender', () => {
    if (!probe) return;
    const { x, y } = probe;
    probe = null;
    const gl = renderer.gl;
    const res = renderer.resolution;
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(x * res), Math.floor(canvas.height - 1 - y * res), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    setOver(px[3] > HIT_ALPHA);
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    down = { id: e.pointerId, x: e.screenX, y: e.screenY, dragging: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (down && down.id === e.pointerId) {
      if (!down.dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > DRAG_PX) {
        down.dragging = true;
        canvas.classList.add('dragging');
        api.drag({ phase: 'start', x: down.x, y: down.y });
      }
      if (down.dragging) api.drag({ phase: 'move', x: e.screenX, y: e.screenY });
      return;
    }
    probe = { x: e.clientX, y: e.clientY };
  });
  // A window that ignores the mouse is only forwarded plain mouse moves, not pointer events.
  window.addEventListener('mousemove', (e) => {
    if (!down) probe = { x: e.clientX, y: e.clientY };
  });
  const release = (e: PointerEvent, cancelled: boolean): void => {
    if (!down || down.id !== e.pointerId) return;
    const { dragging } = down;
    down = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (dragging) {
      canvas.classList.remove('dragging');
      api.drag({ phase: 'end', x: e.screenX, y: e.screenY });
    } else if (!cancelled && commanded !== 'walk' && commanded !== 'held') {
      lastPoke = pickPoke(lastPoke, Math.random);
      pokeAnim = lastPoke;
      pokeUntil = performance.now() + POKE_MS;
    }
    probe = { x: e.clientX, y: e.clientY };
  };
  window.addEventListener('pointerup', (e) => release(e, false));
  window.addEventListener('pointercancel', (e) => release(e, true));
  // While the window ignores the mouse, Chromium follows every forwarded move with a leave; only a leave from an interactive window is real.
  document.addEventListener('mouseleave', () => {
    if (down || !over) return;
    probe = null;
    setOver(false);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    pose: (msg) => {
      commanded = msg.anim;
      flip = msg.flip;
    },
    look: ({ x, y }) => internal.focusController.focus(x, y),
    talk: ({ ms }) => {
      talkAt = performance.now();
      talkFor = ms;
    },
  };
}
