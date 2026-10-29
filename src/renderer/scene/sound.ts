/**
 * The scene's sounds, made with the Web Audio API as they are played so nothing has to be shipped with the app: the
 * clack of a tile, shuffling, dice, a call and a win. A page that cannot make sound simply stays quiet.
 */

const KEY = 'lolping.scene.sound';

export interface SoundStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class Sounds {
  private audio: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private on: boolean;

  constructor(private readonly store: SoundStore | null) {
    this.on = Sounds.read(store) !== false;
  }

  private static read(store: SoundStore | null): boolean | null {
    try {
      const v = store?.getItem(KEY);
      return v === '1' ? true : v === '0' ? false : null;
    } catch {
      return null;
    }
  }

  get enabled(): boolean {
    return this.on;
  }

  set(on: boolean): void {
    this.on = on;
    try {
      this.store?.setItem(KEY, on ? '1' : '0');
    } catch {
      // A store that cannot save only forgets the choice.
    }
  }

  /** The audio context, made on first use; null where there is no Web Audio. */
  private ctx(): AudioContext | null {
    if (!this.on) return null;
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended') void this.audio.resume();
      return this.audio;
    } catch {
      return null;
    }
  }

  /** Half a second of white noise, which every click and rattle is cut from. */
  private noiseOf(a: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * 0.5), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  /** A burst of noise through a band pass filter, fading out. */
  private burst(a: AudioContext, at: number, ms: number, freq: number, q: number, volume: number): void {
    const src = a.createBufferSource();
    src.buffer = this.noiseOf(a);
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = a.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
    src.connect(filter).connect(gain).connect(a.destination);
    src.start(at, Math.random() * 0.3, ms / 1000 + 0.02);
  }

  private tone(a: AudioContext, at: number, ms: number, from: number, to: number, volume: number, type: OscillatorType): void {
    const osc = a.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + ms / 1000);
    const gain = a.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
    osc.connect(gain).connect(a.destination);
    osc.start(at);
    osc.stop(at + ms / 1000 + 0.02);
  }

  /** A tile put down on the table: a short click and a low knock. */
  clack(volume = 1): void {
    const a = this.ctx();
    if (!a) return;
    const t = a.currentTime;
    this.burst(a, t, 45, 2400 + Math.random() * 900, 1.2, 0.28 * volume);
    this.tone(a, t, 70, 200, 110, 0.22 * volume, 'sine');
  }

  /** A tile dealt or drawn: softer than a throw. */
  tick(): void {
    this.clack(0.35);
  }

  /** Tiles washed about for `ms`. */
  shuffle(ms: number): void {
    const a = this.ctx();
    if (!a) return;
    const t = a.currentTime;
    for (let i = 0; i < ms / 55; i++) {
      this.burst(a, t + (i * 55 + Math.random() * 40) / 1000, 70 + Math.random() * 50, 900 + Math.random() * 1800, 0.9, 0.11);
    }
  }

  /** Two dice rattling and landing. */
  roll(): void {
    const a = this.ctx();
    if (!a) return;
    const t = a.currentTime;
    for (let i = 0; i < 9; i++) this.burst(a, t + i * 0.05, 40, 3000 + Math.random() * 1500, 2, 0.14);
    this.burst(a, t + 0.45, 60, 1800, 1, 0.3);
    this.burst(a, t + 0.75, 50, 2000, 1, 0.22);
  }

  /** A claim: two quick rising notes. */
  call(): void {
    const a = this.ctx();
    if (!a) return;
    const t = a.currentTime;
    this.tone(a, t, 110, 660, 660, 0.16, 'triangle');
    this.tone(a, t + 0.1, 160, 880, 880, 0.16, 'triangle');
  }

  /** A win: a run up the scale and a held chord. */
  win(): void {
    const a = this.ctx();
    if (!a) return;
    const t = a.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(a, t + i * 0.11, 220, f, f, 0.14, 'triangle'));
    [523, 659, 784].forEach((f) => this.tone(a, t + 0.5, 900, f, f, 0.09, 'sine'));
  }

  close(): void {
    const a = this.audio;
    this.audio = null;
    this.noise = null;
    if (a) void a.close().catch(() => undefined);
  }
}
