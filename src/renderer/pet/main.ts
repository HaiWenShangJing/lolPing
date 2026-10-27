import type { PetApi } from '../../shared/petIpc';
import type { PetAnim } from '../../shared/teammate/pet';
import { PET_POSES } from '../../shared/teammate/pet';

declare global {
  interface Window {
    petApi: PetApi;
  }
}

const img = document.getElementById('pet') as HTMLImageElement;
let base = '';
let anims: Record<string, PetAnim> | null = null;
let current = 'idle';
let timer: ReturnType<typeof setInterval> | null = null;
const cache = new Map<string, HTMLImageElement>();

function preload(url: string): void {
  if (cache.has(url)) return;
  const el = new Image();
  el.src = url;
  cache.set(url, el);
}

function preloadAnim(name: string): void {
  for (const f of anims?.[name]?.frames ?? []) preload(`${base}/${f}`);
}

function play(name: string): void {
  if (timer !== null) clearInterval(timer);
  const a = anims?.[name];
  if (!a) return;
  current = name;
  preloadAnim(name);
  let i = 0;
  const show = (): void => {
    img.src = `${base}/${a.frames[i % a.frames.length]}`;
    i += 1;
  };
  show();
  timer = setInterval(show, 1000 / a.fps);
}

window.petApi.onInit((init) => {
  base = init.base;
  anims = init.manifest.anims;
  // A pack can have dozens of long animations: only the ones the pet moves through are loaded ahead; the rest load when played.
  for (const pose of PET_POSES) preloadAnim(pose);
  preloadAnim(init.rest);
  play(init.rest);
});

window.petApi.onPose(({ anim, flip }) => {
  img.classList.toggle('flip', flip);
  if (anim !== current || timer === null) play(anim);
});

// Moving the window under the pointer moves the pointer's own coordinates, so main works from screen positions.
img.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  img.setPointerCapture(e.pointerId);
  img.classList.add('dragging');
  window.petApi.drag({ phase: 'start', x: e.screenX, y: e.screenY });
});
img.addEventListener('pointermove', (e) => {
  if (img.hasPointerCapture(e.pointerId)) window.petApi.drag({ phase: 'move', x: e.screenX, y: e.screenY });
});
const release = (e: PointerEvent): void => {
  if (!img.hasPointerCapture(e.pointerId)) return;
  img.releasePointerCapture(e.pointerId);
  img.classList.remove('dragging');
  window.petApi.drag({ phase: 'end', x: e.screenX, y: e.screenY });
};
img.addEventListener('pointerup', release);
img.addEventListener('pointercancel', release);
img.addEventListener('contextmenu', (e) => e.preventDefault());
