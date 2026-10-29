import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_SCHEME } from '../appProtocol';
import { IS_LINUX, IS_MAC, loadPage, preloadPath } from '../paths';
import { PET_CH, parsePetDrag, parsePetHit, type PetInit, type PetLookMsg, type PetPoseMsg, type PetTalkMsg } from '../../shared/petIpc';
import {
  keepInside, parsePetManifest, petIds, standBeside, standLeftOf, stepToward, DEFAULT_PETS, PET_FACES, PET_IDS, type PetId, type PetManifest, type PetPose, type PetsSetting,
} from '../../shared/teammate/pet';
import { moodAnim, type Mood } from '../../shared/teammate/mood';
import { glanceFlip, lifeStep, startLife, type Life } from '../../shared/teammate/life';
import { gazeToward } from '../../shared/teammate/live2d';
import {
  NO_PETS, PETS_BUSY, describePets, speechMs, walkSpot, type PetCommand, type PetDriveResult, type PetStatus, type PetTarget,
} from '../../shared/teammate/petControl';
import { PetSpeech } from './petSpeech';
import { PetChat } from './petChat';
import { DOUBLE_TAP_MS, isTap } from '../../shared/teammate/petHost';

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
/** How often an agent's hold on a pet is checked: when its show is over, and when it is time to walk home. */
const DRIVE_TICK_MS = 500;
/** How long a pet an agent sent somewhere stays there once it arrives, before it walks home by itself. */
const SPOT_HOLD_MS = 45_000;
/** How long an animation an agent asked for plays before the pet goes back to resting. */
const SHOW_MS = 8_000;

/** `toSpot` and `atSpot` are an agent's errand (see `drive`); the others follow the user's pings. */
type Where = 'home' | 'toPing' | 'atPing' | 'back' | 'toSpot' | 'atSpot';

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
  /** Pointer and window position when a drag began, and when (ms since the epoch); null when none is on. */
  drag: { pointer: Point; from: Point; at: number } | null;
  /** When the pet was last tapped (pressed and let go without moving), to tell a double tap; 0 when not lately. */
  clickAt: number;
  /** What it does at home when idle: its next little show, or the one it is playing. */
  life: Life;
  /** Where a Live2D pet was last told to look. */
  gaze: Point | null;
  /** Whether a Live2D pet's window takes the mouse (the pointer is on the character) rather than passing it through. */
  interactive: boolean;
  /**
   * An agent has the pet: until when (ms since the epoch; Infinity while it is on its way) it stays away from home
   * and keeps its idle life off. Null when no agent has it.
   */
  hold: number | null;
  /** When the animation an agent asked for ends and the pet rests again; 0 when none plays. */
  show: number;
  /** An animation an agent asked for while the pet was on its way: it plays on arrival. */
  arrive: string | null;
}

/** What a double tap on a pet does: opens a box to type to it, which the host agent answers. */
export interface PetChatHook {
  /** True while a host is on to answer. */
  on(): boolean;
  /** The box's hint. */
  hint(): string;
  /** What the pet says when it can't answer. */
  off(): string;
  send(pet: PetId, text: string): void;
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
  private driveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly speech = new PetSpeech();
  private readonly chat = new PetChat((pet, text) => this.sendChat(pet, text));
  private chatHook: PetChatHook | null = null;
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
      this.speech.hide(id);
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
      if (pet.drag || pet.where !== 'home' || pet.hold !== null || this.ping !== null) {
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
    this.endErrands();
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
    this.endErrands();
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
      pet.hold = null;
      pet.show = 0;
      pet.arrive = null;
      pet.target = pet.home;
      pet.moveAt = Date.now();
    }
    this.startTimer();
  }

  setCaptureExcluded(on: boolean): void {
    this.captureExcluded = on;
    this.speech.setCaptureExcluded(on);
    this.chat.setCaptureExcluded(on);
    for (const pet of this.pets.values()) if (!pet.win.isDestroyed()) pet.win.setContentProtection(on);
  }

  /**
   * An agent drives the pets (the user has let it): `say` opens a speech bubble, `walk` sends a pet somewhere and
   * leaves it there a while, `play` plays an animation for a few seconds. The user's own pings come first: while pets
   * are at one, an agent has to wait, and a ping that comes in takes the pets back. `from` is the agent's name.
   */
  drive(cmd: PetCommand, from: string): PetDriveResult {
    if (this.pets.size === 0) return { ok: false, text: NO_PETS };
    if (cmd.kind === 'status') return { ok: true, text: describePets(this.statuses()) };
    if (this.ping !== null) return { ok: false, text: PETS_BUSY };
    const named = cmd.pet === null ? null : this.pets.get(cmd.pet);
    if (cmd.pet !== null && !named) {
      return { ok: false, text: `The pet ${cmd.pet} isn't showing. ${describePets(this.statuses())}` };
    }
    const shown = PET_IDS.flatMap((id) => this.pets.get(id) ?? []);
    const who = named ? [named] : cmd.kind === 'say' ? shown.slice(0, 1) : shown;
    switch (cmd.kind) {
      case 'say': return this.driveSay(who[0], cmd.text, cmd.mood, from);
      case 'walk': return this.driveWalk(who, cmd.to);
      case 'play': return this.drivePlay(who, cmd.anim, cmd.mood);
    }
  }

  private driveSay(pet: Pet, text: string, mood: Mood | null, from: string): PetDriveResult {
    const ms = speechMs(text);
    this.holdUntil(pet, Date.now() + ms + 1_000);
    if (mood && pet.where !== 'toSpot') this.perform(pet, moodAnim(pet.id, mood, (a) => a in pet.manifest.anims), ms);
    this.speak(pet, ms);
    this.speech.show(pet.id, text, from, pet.win.getBounds(), ms);
    return { ok: true, text: `${pet.id} says it.` };
  }

  private driveWalk(pets: Pet[], to: PetTarget): PetDriveResult {
    const going = pets.filter((p) => !p.drag);
    if (going.length === 0) return { ok: false, text: 'The pet is being dragged by the user right now.' };
    const main = screen.getPrimaryDisplay().workArea;
    const cursor = screen.getCursorScreenPoint();
    const near = { at: cursor, area: screen.getDisplayNearestPoint(cursor).workArea };
    const home = 'place' in to && to.place === 'home';
    const beside = (id: PetId): { x: number; y: number; width: number; height: number } | null => {
      const other = this.pets.get(id);
      if (!other) return null;
      // A pet on its way is where it is going, so two sent to each other end up side by side.
      const at = other.where === 'toSpot' ? other.target : other.at;
      return { x: at.x, y: at.y, width: other.manifest.width, height: other.manifest.height };
    };
    going.forEach((pet, i) => {
      pet.target = walkSpot(to, pet.manifest, i, going.length, { area: main, cursor: near, home: pet.home, random: Math.random, beside });
      pet.where = home ? 'back' : 'toSpot';
      pet.hold = home ? null : Infinity;
      pet.show = 0;
      pet.arrive = null;
      pet.moveAt = Date.now() + i * STAGGER_MS;
      if (home) this.speech.hide(pet.id);
    });
    this.startTimer();
    this.startDriveTimer();
    return { ok: true, text: `${going.map((p) => p.id).join(', ')} ${going.length > 1 ? 'are' : 'is'} on the way.` };
  }

  private drivePlay(pets: Pet[], anim: string | null, mood: Mood | null): PetDriveResult {
    const played: string[] = [];
    for (const pet of pets) {
      const name = anim !== null ? (anim in pet.manifest.anims ? anim : null) : moodAnim(pet.id, mood, (a) => a in pet.manifest.anims);
      if (name === null || pet.drag) continue;
      if (pet.where === 'toSpot') pet.arrive = name;
      else this.perform(pet, name, SHOW_MS);
      played.push(pet.id);
    }
    if (played.length > 0) return { ok: true, text: `${played.join(', ')} plays it.` };
    return { ok: false, text: `No pet has that animation. ${describePets(this.statuses())}` };
  }

  /** Plays `anim` for `ms`, keeping the pet where it is and its idle life off meanwhile. */
  private perform(pet: Pet, anim: string, ms: number): void {
    const until = Date.now() + ms;
    pet.show = until;
    this.holdUntil(pet, until);
    this.setPose(pet, 'happy', anim);
  }

  private holdUntil(pet: Pet, until: number): void {
    pet.hold = pet.hold === null ? until : Math.max(pet.hold, until);
    this.startDriveTimer();
  }

  /** The pets showing, where they are and what they can play: what the agent that hosts them is told. */
  shown(): PetStatus[] {
    return this.statuses();
  }

  /** Lets a double tap on a pet open a box to type to it; null takes that away. */
  setChat(hook: PetChatHook | null): void {
    this.chatHook = hook;
    if (!hook) this.chat.close();
  }

  private statuses(): PetStatus[] {
    const area = screen.getPrimaryDisplay().workArea;
    return PET_IDS.flatMap((id) => {
      const pet = this.pets.get(id);
      if (!pet) return [];
      const share = (v: number, from: number, len: number): number => Math.round(((v - from) / len) * 100);
      return [{
        id,
        xPct: share(pet.at.x + pet.manifest.width / 2, area.x, area.width),
        yPct: share(pet.at.y + pet.manifest.height / 2, area.y, area.height),
        away: pet.where !== 'home',
        anims: Object.keys(pet.manifest.anims),
      }];
    });
  }

  /** The user's own ping comes: whatever an agent had the pets doing is over. */
  private endErrands(): void {
    this.speech.hideAll();
    for (const pet of this.pets.values()) {
      pet.hold = null;
      pet.show = 0;
      pet.arrive = null;
    }
  }

  private startDriveTimer(): void {
    this.driveTimer ??= setInterval(() => this.driveTick(), DRIVE_TICK_MS);
  }

  /** A pet's show ends and it rests again; its time away ends and it walks home. Stops once no agent has a pet. */
  private driveTick(): void {
    const now = Date.now();
    let held = false;
    for (const pet of this.pets.values()) {
      if (pet.win.isDestroyed()) continue;
      if (pet.show !== 0 && now >= pet.show) {
        pet.show = 0;
        if ((pet.where === 'home' || pet.where === 'atSpot') && !pet.drag) this.setPose(pet, 'idle');
      }
      if (pet.hold !== null && now >= pet.hold) {
        pet.hold = null;
        if (pet.where === 'atSpot') {
          pet.show = 0;
          pet.where = 'back';
          pet.target = pet.home;
          pet.moveAt = now;
          this.startTimer();
        }
      }
      if (pet.hold !== null || pet.show !== 0) held = true;
    }
    if (held || this.driveTimer === null) return;
    clearInterval(this.driveTimer);
    this.driveTimer = null;
  }

  destroy(): void {
    ipcMain.removeListener(PET_CH.drag, this.onDrag);
    ipcMain.removeListener(PET_CH.hit, this.onHit);
    this.stopTimer();
    if (this.driveTimer !== null) clearInterval(this.driveTimer);
    this.driveTimer = null;
    this.speech.destroy();
    this.chat.destroy();
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
        id, manifest, win, at: home, home, target: home, where: 'home', moveAt: 0, flip: false, pose: 'idle', anim: rest, rest, sentFlip: false, drag: null, clickAt: 0,
        life: startLife(Date.now(), Math.random), gaze: null, interactive: false, hold: null, show: 0, arrive: null,
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
      if (pet.win.isDestroyed() || pet.drag || pet.where === 'home' || pet.where === 'atPing' || pet.where === 'atSpot') continue;
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
      this.speech.move(pet.id, pet.win.getBounds());
      if (!step.arrived) {
        this.setPose(pet, 'walk');
        moving = true;
      } else if (pet.where === 'toSpot') {
        pet.where = 'atSpot';
        pet.flip = false;
        pet.hold = now + SPOT_HOLD_MS;
        this.startDriveTimer();
        const anim = pet.arrive;
        pet.arrive = null;
        if (anim !== null) this.perform(pet, anim, SHOW_MS);
        else this.setPose(pet, 'idle');
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

  /** A Live2D pet moves its mouth for the line it is saying: at the ping that is the answer, for an agent `ms` is the bubble's time. */
  private speak(pet: Pet, ms = this.talkMs): void {
    if (!pet.manifest.live2d || ms <= 0 || pet.win.isDestroyed()) return;
    const msg: PetTalkMsg = { ms };
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
      pet.drag = { pointer: { x: msg.x, y: msg.y }, from: { ...pet.at }, at: Date.now() };
      pet.hold = null; // the user has taken it: no agent keeps it away, or walks it home from under the pointer
      pet.show = 0;
      pet.arrive = null;
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
    this.speech.move(pet.id, pet.win.getBounds());
    if (msg.phase === 'end') {
      const tapped = isTap(msg.x - drag.pointer.x, msg.y - drag.pointer.y, Date.now() - drag.at);
      pet.drag = null;
      // Where it was put down is home; an ask that comes later sends it from there.
      pet.home = { ...pet.at };
      pet.where = 'home';
      this.setPose(pet, 'idle');
      if (tapped) this.tapped(pet);
    }
  };

  /** A tap, and a second one soon after, is a double tap: the box to type to the pet opens. */
  private tapped(pet: Pet): void {
    const now = Date.now();
    if (pet.clickAt === 0 || now - pet.clickAt > DOUBLE_TAP_MS) {
      pet.clickAt = now;
      return;
    }
    pet.clickAt = 0;
    const hook = this.chatHook;
    if (!hook || this.ping !== null) return;
    if (!hook.on()) {
      this.driveSay(pet, hook.off(), null, 'lolPing');
      return;
    }
    this.chat.open(pet.id, pet.win.getBounds(), hook.hint());
  }

  /** The user sent a line to a pet: the host answers it, and the pet thinks meanwhile. */
  private sendChat(id: PetId, text: string): void {
    this.chatHook?.send(id, text);
    const pet = this.pets.get(id);
    if (pet && 'think' in pet.manifest.anims && !pet.drag) this.drivePlay([pet], 'think', null);
  }
}
