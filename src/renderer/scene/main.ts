/**
 * The scene page. One pixi stage draws the table and the pets; the page's own elements lie over it for the speech, the
 * shouts, the name plates and the buttons. The director plays rounds on the table, and the page seats the pets, sets
 * them again when the user picks others, and keeps the frame rate within what the machine can do.
 */

import * as PIXI from 'pixi.js';
import type { SceneInit, ScenePet } from '../../shared/sceneIpc';
import type { PetId } from '../../shared/teammate/pet';
import { pickCast, togglePick } from '../../shared/teammate/scene';
import { gazeAt, pickFps } from '../../shared/teammate/sceneMotion';
import { loadActor, type Actor } from './actors';
import { makeDecor } from './decor';
import { Director, type HudApi } from './director';
import { Bar, Overlay, Picker } from './hud';
import { CENTER, SEAT_X, fitStage } from './layout';
import { Sounds } from './sound';
import { MahjongStage } from './stage';
import { makeTiles } from './tiles';

const SEATS = SEAT_X.length;
/** The frame rate the page starts at; it steps down if the machine cannot keep it. */
const FPS_START = 60;
/** How long after the last click in the list of pets the table is set again, so a few clicks make one change. */
const RESEAT_DELAY_MS = 350;
/** How often the frame rate is looked at, and the longest frame that says anything about it (a longer one is a stall). */
const FPS_CHECK_MS = 2000;
const FRAME_STALL_MS = 250;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing`);
  return el as T;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Sets up the table and the pets, and plays on until the window closes. */
async function run(init: SceneInit, say: (text: string | null) => void): Promise<void> {
  const { text, pets } = init;
  const words = text.words;
  const app = new PIXI.Application({
    view: byId<HTMLCanvasElement>('stage'), width: window.innerWidth, height: window.innerHeight, backgroundColor: 0x1d1612,
    antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true, sharedTicker: true,
  });
  const sounds = new Sounds(storage());
  const table = new MahjongStage(makeTiles(), makeDecor(), sounds);
  app.stage.addChild(table.root);

  const overlay = new Overlay(byId('overlay'), words);
  const picker = new Picker(byId('picker'), (id) => pick(id));
  const bar = new Bar(
    {
      root: byId('bar'), title: byId('title'), round: byId('round'), wall: byId('wall'),
      seats: byId('seats'), reseat: byId('reseat'), sound: byId('sound'),
    },
    words,
    text.title,
    {
      seats: () => {
        picker.open = !picker.open;
        bar.seats(picker.open);
      },
      reseat: () => reseat(),
      sound: () => {
        sounds.set(!sounds.enabled);
        bar.sound(sounds.enabled);
      },
    },
  );
  const hud: HudApi = {
    bubble: (seat, line, ms) => overlay.bubble(seat, line, ms),
    shout: (seat, word, ms) => overlay.shout(seat, word, ms),
    toast: (note, ms) => overlay.toast(note, ms),
    round: (n) => bar.round(n),
    wall: (n) => bar.wall(n),
    dealer: (seat) => overlay.dealer(seat),
  };

  const actors: (Actor | null)[] = SEAT_X.map(() => null);
  const director = new Director({
    table, player: (seat) => actors[seat] ?? null, hud, words, lines: text.lines, random: Math.random,
  });

  const byPet = new Map<PetId, ScenePet>(pets.map((p) => [p.id, p]));
  const installed = pets.map((p) => p.id);
  let cast: PetId[] = init.picks.filter((id) => byPet.has(id)).slice(0, SEATS);
  if (cast.length === 0) cast = pickCast([], installed, SEATS, Math.random);

  /** Counts the times the table was set, so a load that finishes after the pets were changed again knows to give up. */
  let generation = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;

  async function seat(next: readonly PetId[]): Promise<void> {
    const mine = ++generation;
    director.stop();
    actors.forEach((a, i) => {
      a?.destroy();
      actors[i] = null;
    });
    overlay.clear();
    table.reset();
    say(words.loading ?? '');
    for (const [no, id] of next.slice(0, SEATS).entries()) {
      const pet = byPet.get(id);
      if (!pet) continue;
      const actor = await loadActor(pet, no, table.actors);
      if (mine !== generation) {
        actor.destroy();
        return;
      }
      actors[no] = actor;
      overlay.sit(no, pet, actor.top);
      const look = gazeAt(SEAT_X[no] ?? CENTER.x, CENTER.x);
      actor.gaze(look.x, look.y);
    }
    say(null);
    director.start();
  }

  const failed = (err: unknown): void => {
    console.error('[scene] the table could not be set:', err);
    say(words.failed ?? '');
  };

  function pick(id: PetId): void {
    cast = togglePick(cast, id, SEATS);
    picker.render(pets, cast);
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      seat(cast).catch(failed);
    }, RESEAT_DELAY_MS);
  }

  function reseat(): void {
    if (pending !== null) clearTimeout(pending);
    pending = null;
    cast = pickCast([], installed, SEATS, Math.random);
    picker.render(pets, cast);
    seat(cast).catch(failed);
  }

  // A click on the picture puts the list of pets away.
  byId('stage').addEventListener('pointerdown', () => {
    if (!picker.open) return;
    picker.open = false;
    bar.seats(false);
  });

  let fit = true;
  window.addEventListener('resize', () => {
    fit = true;
  });
  const place = (): void => {
    fit = false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    app.renderer.resize(w, h);
    const f = fitStage(w, h);
    table.root.position.set(f.x, f.y);
    table.root.scale.set(f.scale);
    overlay.place(f);
  };

  let fps = FPS_START;
  let avgMs = 1000 / fps;
  let checked = performance.now();
  app.ticker.maxFPS = fps;
  app.ticker.add(() => {
    const now = performance.now();
    if (fit) place();
    const dt = Math.min(100, app.ticker.deltaMS);
    table.tick(dt);
    director.update(dt);
    for (const actor of actors) actor?.update(now);
    overlay.update(now);
    if (app.ticker.elapsedMS < FRAME_STALL_MS) avgMs += (app.ticker.elapsedMS - avgMs) * 0.05;
    if (now - checked < FPS_CHECK_MS) return;
    checked = now;
    const next = pickFps(fps, avgMs);
    if (next === fps) return;
    fps = next;
    app.ticker.maxFPS = next;
  });

  place();
  bar.show();
  bar.sound(sounds.enabled);
  picker.render(pets, cast);
  await seat(cast);
}

async function start(): Promise<void> {
  const status = byId('status');
  const say = (text: string | null): void => {
    status.textContent = text ?? '';
    status.hidden = text === null || text === '';
  };
  const init = await window.sceneApi.init().catch(() => null);
  if (!init) return;
  document.title = init.text.title;
  if (init.pets.length === 0) {
    say(init.text.words.empty ?? '');
    return;
  }
  await run(init, say).catch((err: unknown) => {
    console.error('[scene] could not start:', err);
    say(init.text.words.failed ?? '');
  });
}

void start();
