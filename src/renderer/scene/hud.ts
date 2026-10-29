/**
 * What the scene page lays over the picture, made of the page's own elements: speech bubbles over the pets, the shout
 * of a claim or a win, a name plate at each seat, a note about what is going on, the bar along the top and the list of
 * pets to seat. Whatever a pet says or the user's language puts in them goes in as text, never as markup.
 */

import type { ScenePet } from '../../shared/sceneIpc';
import type { PetId } from '../../shared/teammate/pet';
import { fillCount } from '../../shared/teammate/scene';
import { PLATE_Y, SEAT_X, STAGE, bubbleAnchor, type Point } from './layout';

type Words = Readonly<Record<string, string>>;

/** How long a bubble, a shout or a note takes to fade out, which the stylesheet's transition matches. */
const FADE_MS = 220;
/** Where the shout of a claim or a win goes: over the pet's hands, clear of its face. */
const SHOUT_Y = 405;
const TOAST_AT: Point = { x: STAGE.w / 2, y: 74 };

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function put(el: HTMLElement, p: Point): void {
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
}

interface Item {
  el: HTMLElement;
  until: number;
  /** When it began to fade out; null until it does. */
  fading: number | null;
}

/** The elements in the picture's own 1280 by 720 space, which the page scales and shifts to lie over the stage. */
export class Overlay {
  private readonly items = new Map<string, Item>();
  private readonly plates: (HTMLElement | null)[] = SEAT_X.map(() => null);
  private readonly tops: number[] = SEAT_X.map(() => 160);
  private dealerSeat = -1;

  constructor(private readonly root: HTMLElement, private readonly words: Words) {
    root.style.width = `${STAGE.w}px`;
    root.style.height = `${STAGE.h}px`;
  }

  /** Lays the space over the window the way the picture is laid. */
  place(fit: { scale: number; x: number; y: number }): void {
    this.root.style.transform = `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`;
  }

  /** Sits `pet` at `seat`, whose head is `top` from the top of the picture: it gets its plate, and bubbles go over it. */
  sit(seat: number, pet: ScenePet, top: number): void {
    this.leave(seat);
    this.tops[seat] = top;
    const plate = make('div', 'plate');
    plate.style.setProperty('--c', pet.color);
    const badge = make('b', 'badge', this.words.dealer ?? '');
    badge.hidden = this.dealerSeat !== seat;
    plate.append(make('i', 'dot'), make('span', 'name', pet.name), badge);
    put(plate, { x: SEAT_X[seat] ?? 0, y: PLATE_Y });
    this.root.append(plate);
    this.plates[seat] = plate;
  }

  /** The pet at `seat` gets up: its plate and whatever it was saying go. */
  leave(seat: number): void {
    this.plates[seat]?.remove();
    this.plates[seat] = null;
    this.drop(`bubble:${seat}`);
    this.drop(`shout:${seat}`);
  }

  /** Marks the seat of the dealer. */
  dealer(seat: number): void {
    this.dealerSeat = seat;
    this.plates.forEach((plate, i) => {
      const badge = plate?.querySelector('b');
      if (badge) badge.hidden = i !== seat;
    });
  }

  /** `text` in a bubble over the pet at `seat` for `ms`; it takes the place of what that pet said before. */
  bubble(seat: number, text: string, ms: number): void {
    const el = make('div', 'bubble', text);
    put(el, bubbleAnchor(seat, this.tops[seat] ?? 160));
    this.show(`bubble:${seat}`, el, ms);
  }

  /** A big word beside the pet at `seat`: a claim, a win. */
  shout(seat: number, text: string, ms: number): void {
    const el = make('div', 'shout', text);
    put(el, { x: SEAT_X[seat] ?? 0, y: SHOUT_Y });
    this.show(`shout:${seat}`, el, ms);
  }

  /** A note at the top of the picture. */
  toast(text: string, ms: number): void {
    const el = make('div', 'toast', text);
    put(el, TOAST_AT);
    this.show('toast', el, ms);
  }

  /** Fades out what has had its time, and takes away what has faded. */
  update(now: number): void {
    for (const [key, item] of this.items) {
      if (item.fading === null) {
        if (now < item.until) continue;
        item.fading = now;
        item.el.classList.add('out');
      } else if (now - item.fading >= FADE_MS) {
        item.el.remove();
        this.items.delete(key);
      }
    }
  }

  /** Takes everything away: the plates, bubbles, shouts and notes. */
  clear(): void {
    for (const key of [...this.items.keys()]) this.drop(key);
    this.plates.forEach((_, seat) => this.leave(seat));
  }

  private show(key: string, el: HTMLElement, ms: number): void {
    this.drop(key);
    this.root.append(el);
    this.items.set(key, { el, until: performance.now() + ms, fading: null });
  }

  private drop(key: string): void {
    this.items.get(key)?.el.remove();
    this.items.delete(key);
  }
}

export interface BarEls {
  root: HTMLElement;
  title: HTMLElement;
  round: HTMLElement;
  wall: HTMLElement;
  seats: HTMLButtonElement;
  reseat: HTMLButtonElement;
  sound: HTMLButtonElement;
}

export interface BarActions {
  seats(): void;
  reseat(): void;
  sound(): void;
}

/** The bar along the top: the title, how far the game is, and the buttons. */
export class Bar {
  constructor(private readonly els: BarEls, private readonly words: Words, title: string, actions: BarActions) {
    els.title.textContent = title;
    els.seats.textContent = words.seats ?? '';
    els.reseat.textContent = words.reseat ?? '';
    els.seats.addEventListener('click', actions.seats);
    els.reseat.addEventListener('click', actions.reseat);
    els.sound.addEventListener('click', actions.sound);
  }

  show(): void {
    this.els.root.hidden = false;
  }

  round(n: number): void {
    this.els.round.textContent = fillCount(this.words.round ?? '', n);
  }

  wall(n: number): void {
    this.els.wall.textContent = fillCount(this.words.wall ?? '', n);
  }

  sound(on: boolean): void {
    this.els.sound.textContent = (on ? this.words.soundOn : this.words.soundOff) ?? '';
    this.els.sound.setAttribute('aria-pressed', String(on));
  }

  /** Marks whether the list of pets is open. */
  seats(open: boolean): void {
    this.els.seats.setAttribute('aria-expanded', String(open));
  }
}

/** The list of every pet that can sit down, with the seat number of those that do. */
export class Picker {
  constructor(private readonly root: HTMLElement, private readonly pick: (id: PetId) => void) {}

  get open(): boolean {
    return !this.root.hidden;
  }

  set open(open: boolean) {
    this.root.hidden = !open;
  }

  render(pets: readonly ScenePet[], cast: readonly PetId[]): void {
    this.root.replaceChildren(
      ...pets.map((pet) => {
        const seat = cast.indexOf(pet.id);
        const chip = make('button', seat >= 0 ? 'chip on' : 'chip');
        chip.type = 'button';
        chip.style.setProperty('--c', pet.color);
        chip.setAttribute('aria-pressed', String(seat >= 0));
        chip.append(make('i', 'dot'), make('span', 'name', pet.name));
        if (seat >= 0) chip.append(make('b', 'no', String(seat + 1)));
        chip.addEventListener('click', () => this.pick(pet.id));
        return chip;
      }),
    );
  }
}
