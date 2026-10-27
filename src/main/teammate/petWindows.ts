import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_SCHEME } from '../appProtocol';
import { IS_LINUX, IS_MAC, loadPage, preloadPath } from '../paths';
import { PET_CH, parsePetDrag, parsePetHit, type PetInit, type PetLookMsg, type PetPoseMsg, type PetTalkMsg } from '../../shared/petIpc';
import {
  keepInside, parsePetManifest, petIds, standBeside, standLeftOf, stepToward, DEFAULT_PETS, PET_FACES, type PetId, type PetManifest, type PetPose, type PetsSetting,
} from '../../shared/teammate/pet';
import { moodAnim, type Mood } from '../../shared/teammate/mood';
import { glanceFlip, lifeStep, startLife, type Life } from '../../shared/teammate/life';
import { gazeToward } from '../../shared/teammate/live2d';

type Point = { x: number; y: number };

const inside = (r: { x: number; y: number; width: number; height: number }, p: Point): boolean =>
  p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
/** "Quickly": a pet crosses a 1920 px display in about two seconds. */
const RUN_SPEED = 900;
const TICK_MS = 16;
/** The second pet leaves a moment after the first, so two of them don't move as one. */
const STAGGER_MS = 160;
/** How often a resting pet looks at the pointer and at the clock for its next little show. */
const LIFE_TICK_MS = 1000;
/** How often a Live2D pet's eyes are told where the pointer is. */
const LOOK_TICK_MS = 50;
/** Where a Live2D pet's head is, as a fraction of its window's height from the top; its eyes follow the pointer from there. */
const HEAD_AT = 0.24;
/** Space between pets standing at home, and from the display's corner. */
const HOME_GAP = 12;
/** How long pets stay by an ordinary ping before they walk home. */

type Where = 'home' | 'toPing' | 'atPing' | 'back';

interface Pet {
  id: PetId;
  manifest: PetManifest;
  win: BrowserWindow;
  at: Point;
  home: Point;
  target: Point;
  where: Where;
  moveAt: number;
  flip: boolean;
  pose: PetPose;
  /** The animation the page was last told to play. */
  anim: string;
  /** The animation it rests in at home. */
  rest: string;
  /** The facing the page was last told. */
  sentFlip: boolean;
  /** Pointer and window position when a drag began; null when none is on. */
  drag: { pointer: Point; from: Point } | null;
  /** What it does at home when idle: its next little show, or the one it is playing. */
  life: Life;
  /** Where a Live2D pet was last told to look. */
  gaze: Point | null;
  /** Whether a Live2D pet's window takes the mouse (the pointer is on the character) rather than passing it through. */
  interactive: boolean;
}

/**
 * The desktop pets: a small window each, standing at home on the desktop where the user can drag it. An ask sends them
 * to the ping; they think while the answer comes, cheer when it is in, and walk home when it is over. The art is a
 * folder per character in `<settings folder>/pets/<id>/` (manifest.json and frames), not part of lolPing.
 */
export class PetWindows {
  private readonly pets = new Map<PetId, Pet>();
  private loading = new Set<PetId>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lifeTimer: ReturnType<typeof setInterval> | null = null;
  private lookTimer: ReturnType<typeof setInterval> | null = null;
  private lifeOn = true;
  private lastTick = 0;
  private setting: PetsSetting = DEFAULT_PETS;
  /** Where the ask's ping is, while pets are sent to it. */
  private ping: Point | null = null;
  /** The answer hasn't come yet: pets at the ping think, otherwise they are happy. */
  private waiting = false;
  /** The ping is an ordinary one: pets just stand there in their chosen resting animation. */
  private visiting = false;
  /** How the answer that came in was said; null until one does. */
  private mood: Mood | null = null;
  /** How long the answer that came in takes to say; a Live2D pet moves its mouth for it. */
  private talkMs = 0;
  private captureExcluded = false;

  constructor(private readonly dir: string) {
    ipcMain.on(PET_CH.drag, this.onDrag);
    ipcMain.on(PET_CH.hit, this.onHit);
  }

  /** Brings the shown pets in line with the setting; `life` lets resting pets play now and then and look at the pointer. */
  sync(setting: PetsSetting, life = true): void {
    this.setting = setting;
    this.lifeOn = life;
    const want = petIds(setting);
    for (const [id, pet] of [...this.pets]) {
      if (want.includes(id)) continue;
      this.pets.delete(id);
      if (!pet.win.isDestroyed()) pet.win.destroy();
    }
    for (const id of want) {
      const pet = this.pets.get(id);
      if (!pet) continue;
      pet.rest = this.restFor(id, pet.manifest);
      if (pet.pose === 'idle' && !pet.drag) this.setPose(pet, 'idle');
    }
    for (const id of want) if (!this.pets.has(id) && !this.loading.has(id)) void this.create(id);
    if (want.length === 0) this.stopTimer();
    this.syncLife(want.length > 0);
    this.syncLook();
  }

  /** Tells Live2D pets where the pointer is, for as long as there is one. */
  private syncLook(): void {
    if ([...this.pets.values()].some((p) => p.manifest.live2d)) {
      this.lookTimer ??= setInterval(() => this.lookTick(), LOOK_TICK_MS);
      return;
    }
    if (this.lookTimer === null) return;
    clearInterval(this.lookTimer);
    this.lookTimer = null;
  }

  private lookTick(): void {
    const pointer = screen.getCursorScreenPoint();
    for (const pet of this.pets.values()) {
      if (!pet.manifest.live2d || pet.win.isDestroyed()) continue;
      if (pet.interactive && !pet.drag && !inside(pet.win.getBounds(), pointer)) this.setInteractive(pet, false); // the page can't tell it left
      const head = { x: pet.at.x + pet.manifest.width / 2, y: pet.at.y + pet.manifest.height * HEAD_AT };
      const gaze = gazeToward(head, pointer);
      if (pet.gaze && pet.gaze.x === gaze.x && pet.gaze.y === gaze.y) continue;
      pet.gaze = gaze;
      const msg: PetLookMsg = gaze;
      pet.win.webContents.send(PET_CH.look, msg);
    }
  }

  /** Runs the idle-life clock while there are pets to live it; stopping it puts the pets back to rest. */
  private syncLife(pets: boolean): void {
    if (this.lifeOn && pets) {
      this.lifeTimer ??= setInterval(() => this.lifeTick(), LIFE_TICK_MS);
      return;
    }
    if (this.lifeTimer === null) return;
    clearInterval(this.lifeTimer);
    this.lifeTimer = null;
    for (const pet of this.pets.values()) {
      pet.life = startLife(Date.now(), Math.random);
      if (pet.where !== 'home' || pet.drag) continue;
      pet.flip = false;
      this.setPose(pet, 'idle');
    }
  }

  /** One second of idle life: resting pets at home look at the pointer and, now and then, play a little show. */
  private lifeTick(): void {
    const now = Date.now();
    const pointer = screen.getCursorScreenPoint();
    for (const pet of this.pets.values()) {
      if (pet.win.isDestroyed()) continue;
      if (pet.drag || pet.where !== 'home' || this.ping !== null) {
        pet.life = startLife(now, Math.random); // a show waits until the pet has been quiet at home a while
        continue;
      }
      // A Live2D pet looks at the pointer with its eyes, so only a pack of frames turns round to face it.
      const flip = pet.manifest.live2d ? pet.flip : glanceFlip(pet.id, pet.at.x + pet.manifest.width / 2, pointer.x, pet.flip);
      if (flip !== pet.flip) {
        pet.flip = flip;
        this.setPose(pet, pet.pose, pet.anim);
      }
      const step = lifeStep(pet.life, now, pet.id, pet.rest, Math.random);
      pet.life = step.life;
      if (step.action?.kind === 'play') this.setPose(pet, 'idle', step.action.anim);
      else if (step.action?.kind === 'rest') this.setPose(pet, 'idle');
    }
  }

  /** The ask's ping is at `ping` (screen DIPs): every pet walks to stand left of it and thinks, the bubble opens on the right. */
  goTo(ping: Point): void {
    if (this.pets.size === 0) return;
    this.ping = ping;
    this.waiting = true;
    this.mood = null;
    this.talkMs = 0;
    this.visiting = false;
    const all = [...this.pets.values()];
    const sizes = all.map((p) => p.manifest);
    const left = this.areaAt(ping).x;
    all.forEach((pet, i) => {
      pet.drag = null; // a drag whose release was swallowed by the ping gesture would freeze it
      pet.where = 'toPing';
      pet.target = this.keepOnDisplay(standLeftOf(ping, i, sizes, left), ping, pet);
      pet.moveAt = Date.now() + i * STAGGER_MS;
    });
    this.startTimer();
  }

  /** An ordinary ping was placed at ping (screen DIPs): pets run over and stay there until the next ping or a drag. */
  visit(ping: Point): void {
    if (this.pets.size === 0) return;
    this.ping = ping;
    this.waiting = false;
    this.talkMs = 0;
    this.visiting = true;
    const all = [...this.pets.values()];
    all.forEach((pet, i) => {
      pet.drag = null; // a drag whose release was swallowed by the ping gesture would freeze it
      pet.where = 'toPing';
      pet.target = this.standingAt(ping, i, all.length, pet);
      pet.moveAt = Date.now() + i * STAGGER_MS;
    });
    this.startTimer();
  }

  /**
   * The answer is in; `mood` is how the teammate said it, which each pet plays in its own animation. `talkMs` is how long
   * saying it takes: a Live2D pet moves its mouth that long.
   */
  cheer(mood: Mood | null = null, talkMs = 0): void {
    this.waiting = false;
    this.mood = mood;
    this.talkMs = talkMs;
    for (const pet of this.pets.values()) {
      if (pet.where !== 'atPing') continue;
      this.setPose(pet, 'happy', this.cheerAnim(pet));
      this.speak(pet);
    }
  }

  /** The ask is over, or was dropped: pets go home. */
  release(): void {
    this.ping = null;
    this.waiting = false;
    this.mood = null;
    this.talkMs = 0;
    for (const pet of this.pets.values()) {
      if (pet.where === 'home') continue;
      pet.where = 'back';
      pet.target = pet.home;
      pet.moveAt = Date.now();
    }
    this.startTimer();
  }

  setCaptureExcluded(on: boolean): void {
    this.captureExcluded = on;
    for (const pet of this.pets.values()) if (!pet.win.isDestroyed()) pet.win.setContentProtection(on);
  }

  destroy(): void {
    ipcMain.removeListener(PET_CH.drag, this.onDrag);
    ipcMain.removeListener(PET_CH.hit, this.onHit);
    this.stopTimer();
    if (this.lifeTimer !== null) clearInterval(this.lifeTimer);
    this.lifeTimer = null;
    if (this.lookTimer !== null) clearInterval(this.lookTimer);
    this.lookTimer = null;
    for (const pet of this.pets.values()) if (!pet.win.isDestroyed()) pet.win.destroy();
    this.pets.clear();
  }

  private standingAt(ping: Point, index: number, count: number, pet: Pet): Point {
    return this.keepOnDisplay(standBeside(ping, index, count, pet.manifest), ping, pet);
  }

  private areaAt(ping: Point): { x: number; y: number; width: number; height: number } {
    return screen.getDisplayNearestPoint({ x: Math.round(ping.x), y: Math.round(ping.y) }).workArea;
  }

  private keepOnDisplay(spot: Point, ping: Point, pet: Pet): Point {
    return keepInside(spot, pet.manifest, this.areaAt(ping));
  }

  private homeFor(index: number, manifest: PetManifest): Point {
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: area.x + area.width - (index + 1) * (manifest.width + HOME_GAP),
      y: area.y + area.height - manifest.height - HOME_GAP,
    };
  }

  private async create(id: PetId): Promise<void> {
    this.loading.add(id);
    try {
      const manifest = parsePetManifest(JSON.parse(await readFile(join(this.dir, id, 'manifest.json'), 'utf8')));
      if (!manifest) throw new Error('manifest.json is incomplete');
      if (!petIds(this.setting).includes(id) || this.pets.has(id)) return; // the setting changed while it loaded
      const rest = this.restFor(id, manifest);
      const home = this.homeFor(petIds(this.setting).indexOf(id), manifest);
      const win = new BrowserWindow({
        x: home.x, y: home.y, width: manifest.width, height: manifest.height,
        transparent: true, backgroundColor: '#00000000', frame: false, resizable: false, minimizable: false,
        maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, hasShadow: false,
        alwaysOnTop: true, show: false, type: IS_MAC ? 'panel' : 'toolbar',
        webPreferences: { preload: preloadPath('pet'), backgroundThrottling: false, spellcheck: false },
      });
      win.setAlwaysOnTop(true, 'floating');
      if (this.captureExcluded) win.setContentProtection(true);
      if (IS_LINUX) win.setVisibleOnAllWorkspaces(true);
      if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      // A Live2D pet is as big as its window but not as its art: clicks pass through until the page says the pointer is on the character.
      if (manifest.live2d && !IS_LINUX) win.setIgnoreMouseEvents(true, { forward: true });
      const pet: Pet = {
        id, manifest, win, at: home, home, target: home, where: 'home', moveAt: 0, flip: false, pose: 'idle', anim: rest, rest, sentFlip: false, drag: null,
        life: startLife(Date.now(), Math.random), gaze: null, interactive: false,
      };
      const init: PetInit = { id, base: `${APP_SCHEME}://pets/${id}`, manifest, rest };
      win.webContents.on('did-finish-load', () => {
        if (win.isDestroyed()) return;
        win.webContents.send(PET_CH.init, init);
        pet.gaze = null; // what was sent while the page was loading went nowhere
      });
      win.once('ready-to-show', () => win.showInactive());
      this.pets.set(id, pet);
      this.syncLook();
      await loadPage(win, 'pet');
      // An ask that began while this pet was loading sends it now.
      if (this.ping) this.goTo(this.ping);
    } catch (err) {
      console.warn(`[pet] ${id} not shown:`, err instanceof Error ? err.message : err);
    } finally {
      this.loading.delete(id);
    }
  }

  /** The animation chosen for resting, if this pack has it; the pack's own idle otherwise. */
  private restFor(id: PetId, manifest: PetManifest): string {
    const rest = this.setting[id].rest;
    return rest in manifest.anims ? rest : 'idle';
  }

  /** The animation this pet plays for the answer that just came in. */
  private cheerAnim(pet: Pet): string {
    return moodAnim(pet.id, this.mood, (name) => name in pet.manifest.anims);
  }

  private setPose(pet: Pet, pose: PetPose, anim: string = pose === 'idle' ? pet.rest : pose): void {
    if ((pet.anim === anim && pet.sentFlip === pet.flip) || pet.win.isDestroyed()) return;
    pet.pose = pose;
    pet.anim = anim;
    pet.sentFlip = pet.flip;
    const msg: PetPoseMsg = { anim, flip: pet.flip };
    pet.win.webContents.send(PET_CH.pose, msg);
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const now = Date.now();
    const dt = Math.min(now - this.lastTick, 100);
    this.lastTick = now;
    let moving = false;
    for (const pet of this.pets.values()) {
      if (pet.win.isDestroyed() || pet.drag || pet.where === 'home' || pet.where === 'atPing') continue;
      if (now < pet.moveAt) {
        moving = true;
        continue;
      }
      const step = stepToward(pet.at, pet.target, RUN_SPEED, dt);
      const artLeft = PET_FACES[pet.id] === 'left';
      const flip = pet.target.x < pet.at.x ? !artLeft : pet.target.x > pet.at.x ? artLeft : pet.flip;
      pet.flip = flip;
      pet.at = step.at;
      pet.win.setBounds({
        x: Math.round(step.at.x), y: Math.round(step.at.y), width: pet.manifest.width, height: pet.manifest.height,
      });
      if (!step.arrived) {
        this.setPose(pet, 'walk');
        moving = true;
      } else if (pet.where === 'toPing') {
        pet.where = 'atPing';
        pet.flip = false;
        if (this.waiting) this.setPose(pet, 'think');
        else if (this.visiting) this.setPose(pet, 'idle');
        else {
          this.setPose(pet, 'happy', this.cheerAnim(pet));
          this.speak(pet);
        }
      } else {
        pet.where = 'home';
        pet.flip = false;
        this.setPose(pet, 'idle');
      }
    }
    if (!moving) this.stopTimer();
  }

  /** A Live2D pet at the ping moves its mouth for the line it is saying. */
  private speak(pet: Pet): void {
    if (!pet.manifest.live2d || this.talkMs <= 0 || pet.win.isDestroyed()) return;
    const msg: PetTalkMsg = { ms: this.talkMs };
    pet.win.webContents.send(PET_CH.talk, msg);
  }

  private petOf(senderId: number): Pet | undefined {
    return [...this.pets.values()].find((p) => !p.win.isDestroyed() && p.win.webContents.id === senderId);
  }

  private readonly onHit = (event: IpcMainEvent, raw: unknown): void => {
    const pet = this.petOf(event.sender.id);
    const msg = parsePetHit(raw);
    if (pet && msg) this.setInteractive(pet, msg.over);
  };

  /** A Live2D window takes the mouse only while the pointer is on the character; everywhere else it lets the mouse through. */
  private setInteractive(pet: Pet, on: boolean): void {
    if (IS_LINUX || pet.interactive === on || pet.win.isDestroyed()) return;
    pet.interactive = on;
    if (on) pet.win.setIgnoreMouseEvents(false);
    else pet.win.setIgnoreMouseEvents(true, { forward: true });
  }

  private readonly onDrag = (event: IpcMainEvent, raw: unknown): void => {
    const pet = this.petOf(event.sender.id);
    const msg = parsePetDrag(raw);
    if (!pet || !msg) return;
    if (msg.phase === 'start') {
      pet.drag = { pointer: { x: msg.x, y: msg.y }, from: { ...pet.at } };
      this.setPose(pet, 'held');
      return;
    }
    const drag = pet.drag;
    if (!drag) return;
    const area = screen.getDisplayNearestPoint({ x: Math.round(msg.x), y: Math.round(msg.y) }).workArea;
    pet.at = keepInside(
      { x: drag.from.x + (msg.x - drag.pointer.x), y: drag.from.y + (msg.y - drag.pointer.y) }, pet.manifest, area,
    );
    pet.win.setBounds({ ...pet.at, width: pet.manifest.width, height: pet.manifest.height });
    if (msg.phase === 'end') {
      pet.drag = null;
      // Where it was put down is home; an ask that comes later sends it from there.
      pet.home = { ...pet.at };
      pet.where = 'home';
      this.setPose(pet, 'idle');
    }
  };
}
