import { hpTone, type RingMsg, type RingPlate, type RingSide } from '../../shared/ringMsg';

declare global {
  interface Window {
    /** Called by the main process (see `ringScript`) with what to draw. */
    ring: (msgs: readonly RingMsg[]) => void;
  }
}

const CONFETTI = ['#ff5252', '#ffd23f', '#4fc3f7', '#69f0ae', '#ea80fc', '#ffffff'];
const CONFETTI_BITS = 18;

const root = document.getElementById('ring') as HTMLDivElement;

interface Plate {
  box: HTMLDivElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  fury: HTMLElement;
  furyBar: HTMLElement;
  combo: HTMLElement;
}
const plates: Plate[] = [];
const stars = new Map<string, HTMLElement>();

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Puts `el` on the ring and takes it off again once its animation is over. */
function flash<T extends HTMLElement>(el: T, x: number, y: number): T {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.addEventListener('animationend', () => el.remove(), { once: true });
  root.append(el);
  return el;
}

function addPlate(spec: RingPlate, side: RingSide): Plate {
  const box = make('div', `plate side${side}`);
  box.style.left = `${spec.x}px`;
  box.style.top = `${spec.y}px`;
  box.style.width = `${spec.width}px`;
  box.style.setProperty('--c', spec.color);
  const name = make('div', 'name');
  const label = make('span', 'label', spec.name);
  const combo = make('span', 'combo');
  name.append(label, combo);
  const hp = make('div', 'hp');
  const ghost = make('i', 'ghost');
  const fill = make('i', 'fill');
  hp.append(ghost, fill);
  const furyBar = make('div', 'fury');
  const fury = make('i', '');
  furyBar.append(fury);
  box.append(name, hp, furyBar);
  root.append(box);
  return { box, fill, ghost, fury, furyBar, combo };
}

const pct = (v: number): string => `${Math.max(0, Math.min(100, v))}%`;

function bar(side: RingSide, hp: number, fury: number): void {
  const p = plates[side];
  if (!p) return;
  p.fill.style.width = pct(hp);
  p.ghost.style.width = pct(hp);
  p.fill.className = `fill ${hpTone(hp) === 'ok' ? '' : hpTone(hp)}`.trim();
  p.fury.style.width = pct(fury);
  p.furyBar.classList.toggle('full', fury >= 100);
}

function combo(side: RingSide, text: string): void {
  const el = plates[side]?.combo;
  if (!el) return;
  el.textContent = text;
  el.classList.remove('on');
  void el.offsetWidth; // restart the animation
  el.classList.add('on');
}

function confetti(x: number, y: number): void {
  for (let i = 0; i < CONFETTI_BITS; i++) {
    const bit = make('i', 'bit');
    bit.style.setProperty('--x', String(Math.round((Math.random() - 0.5) * 240)));
    bit.style.setProperty('--r', String(Math.round((Math.random() - 0.5) * 900)));
    bit.style.setProperty('--c', CONFETTI[i % CONFETTI.length]);
    bit.style.animationDelay = `${Math.round(Math.random() * 220)}ms`;
    flash(bit, x, y);
  }
}

function apply(msg: RingMsg): void {
  switch (msg.op) {
    case 'init':
      root.replaceChildren();
      plates.length = 0;
      stars.clear();
      msg.plates.forEach((spec, side) => plates.push(addPlate(spec, side === 0 ? 0 : 1)));
      return;
    case 'bar':
      bar(msg.side, msg.hp, msg.fury);
      return;
    case 'pop':
      flash(make('div', `pop ${msg.kind}`, msg.text), msg.x, msg.y);
      return;
    case 'spark':
      flash(make('div', `spark ${msg.kind}`), msg.x, msg.y);
      return;
    case 'combo':
      combo(msg.side, msg.text);
      return;
    case 'banner': {
      const banner = make('div', `banner ${msg.kind}`, msg.text);
      if (msg.sub) banner.append(make('small', '', msg.sub));
      banner.style.setProperty('--ms', `${msg.ms}ms`);
      banner.addEventListener('animationend', () => banner.remove(), { once: true });
      root.append(banner);
      return;
    }
    case 'stars': {
      const key = `${Math.round(msg.x)},${Math.round(msg.y)}`;
      stars.get(key)?.remove();
      stars.delete(key);
      if (!msg.on) return;
      const el = make('div', 'stars');
      el.style.left = `${msg.x}px`;
      el.style.top = `${msg.y}px`;
      el.append(make('i', '', '★'), make('i', '', '★'), make('i', '', '★'));
      root.append(el);
      stars.set(key, el);
      return;
    }
    case 'confetti':
      confetti(msg.x, msg.y);
      return;
  }
}

window.ring = (msgs) => {
  for (const msg of msgs) apply(msg);
};
