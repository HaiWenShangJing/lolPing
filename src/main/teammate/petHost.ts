import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { strings, type Lang } from '../../shared/i18n';
import type { Settings } from '../../shared/settings';
import type { AgentRunSpec } from '../../shared/teammate/agents';
import type { BridgeContent } from '../../shared/teammate/bridgeProtocol';
import type { PetId } from '../../shared/teammate/pet';
import { parsePetCall, type SayTo } from '../../shared/teammate/petControl';
import {
  HOST_CALLS_MAX, HOST_IDLE_SECONDS, HOST_TURNS_MAX, HOST_TURN_MAX_MS, hostArgs, hostIntro, hostMcpConfig, hostToolDefs,
  hostWake, isHostTool, parseRest, pickHostAgent, restDelayMs, type HostActivity, type HostHeard, type HostMoment,
  type HostWho, type WakeKind,
} from '../../shared/teammate/petHost';
import { PET_NAMES, addNote, noteAbout, personaOf, type PetNote } from '../../shared/teammate/petMind';
import { heardLine, type RoomLine } from '../../shared/teammate/petSociety';
import type { ToolDef } from '../../shared/teammate/tools';
import { AgentStartError } from './agents/runner';
import type { AcpSession } from './acp/session';
import type { PetWindows } from './petWindows';

const TOKEN_BYTES = 16;
/** The first wake-up comes this long after hosting starts, so the user sees it work. */
const FIRST_MS = 10_000;
/** Paused, an ask is on screen, no pet showing or the user away: look again in a minute. */
const RETRY_MS = 60_000;
/** Something said to this pet is waiting and the pets are busy with an ask: look again soon. */
const EVENT_RETRY_MS = 5_000;
/** A wake-up that could not happen for this long no longer matters: what was said is stale. */
const WAKE_TTL_MS = 120_000;
/** After a cancel, the agent has this long to end the wake-up before its process is stopped. */
const CANCEL_GRACE_MS = 10_000;
/** The rest ends a wake-up, but the calls that came with it still go through; after this long the turn is cancelled, as models tend to go on. */
const REST_GRACE_MS = 2_500;
/** Failures in a row (a session that won't start, a wake-up that did nothing) before hosting gives up until it is turned off and on. */
const FAILS_MAX = 3;
const BACKOFF_MS = [30_000, 60_000, 120_000];
const FAIL_LINE_MAX = 120;
const RECENT_MAX = 6;

const NOT_AVAILABLE: BridgeContent[] = [{ text: 'Not available.' }];
const PAUSED: BridgeContent[] = [{ text: 'lolPing is paused.' }];
const INVALID: BridgeContent[] = [{ text: 'Ignored: the arguments were not valid.' }];
const ENOUGH: BridgeContent[] = [{ text: 'That is enough for this wake-up. Call pet_rest and stop.' }];

type Result = { content: BridgeContent[]; isError: boolean };

/** Hosting can't work as it is set up: the pets say why and wait for the user to turn it off and on. */
class GiveUp extends Error {}
/** One try failed: the pets say so the first time, and after a few in a row hosting gives up. */
class Failure extends Error {}

/** What a brain hears of the rooms and says into them; the society behind it decides who else is woken. */
export interface PetRoom {
  /**
   * The others' speech since `seq` that `me` has not heard, and the `seq` to ask from next time. `groups` names the
   * groups the lines were said in (by id); `group` is the one `me`'s next words go to, null for the big room.
   */
  heard(me: PetId, seq: number): { lines: RoomLine[]; seq: number; groups: Readonly<Record<string, string>>; group: string | null };
  /** `me` said `text` (to someone, or just spoke up), in the room it was last spoken in. */
  said(me: PetId, text: string, to: SayTo | null): void;
  /** `me` kept a note. */
  noted(me: PetId, text: string): void;
  /** The groups `me` is in. */
  groups(me: PetId): readonly { name: string; members: readonly PetId[] }[];
}

/** One pet's notes, kept across sessions and restarts. */
export interface PetNotes {
  notes(id: PetId): readonly PetNote[];
  set(id: PetId, notes: readonly PetNote[]): void;
}

/** What the pets are called in a bubble's header, in the user's language. */
export interface PetNames {
  pet: Readonly<Record<PetId, string>>;
  everyone: string;
}

export interface PetHostDeps {
  /** The pet this mind is. */
  who: PetId;
  settings: () => Settings;
  /** False while lolPing is paused or the teammate is going down. */
  enabled: () => boolean;
  /** An ask is running: the pets are with it. */
  busy: () => boolean;
  lang: () => Lang;
  now: () => Date;
  /** Seconds since the user last touched the keyboard or mouse. */
  idleSeconds: () => number;
  pet: Pick<PetWindows, 'drive' | 'shown'>;
  room: PetRoom;
  minds: PetNotes;
  names: () => PetNames;
  /** Says something as lolPing itself (a failure); the society keeps all the pets from saying the same thing at once. */
  tell: (text: string) => void;
  /** How long after the others this mind's first wake-up comes, so they don't all start at once. */
  stagger: () => number;
  /** Starts the agent with these arguments in `cwd` and a session in it. */
  start: (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<AcpSession>;
  /** How the agent starts the bridge for token `ask`; null while lolPing's end of it isn't listening. */
  bridge: (ask: string) => AgentRunSpec['bridge'] | null;
  /** lolPing's environment with the user's PATH, for the agent. */
  env: () => Promise<NodeJS.ProcessEnv>;
  /** The folder the session's own folder goes in; the agent runs in that folder, which holds only its config. */
  tempDir: () => string;
  files: {
    makeDir(path: string): Promise<void>;
    writeFile(path: string, text: string): Promise<void>;
    removeDir(path: string): Promise<void>;
  };
  /** Calls `fn` after `ms`; the result cancels it. */
  after: (ms: number, fn: () => void) => () => void;
  random: () => number;
}

interface Live {
  token: string;
  session: AcpSession;
  dir: string;
  /** The agent's name, as the failure lines say who stopped. */
  from: string;
  /** Tool calls made in the wake-up under way, the invalid ones too. */
  calls: number;
  /** What the agent asked to sleep for in this wake-up, in seconds. */
  rest: number | null;
  /** Cancels the prompt under way; null between wake-ups. */
  cancel: (() => void) | null;
  /** Stops the wait that ends the wake-up after its rest. */
  ending: (() => void) | null;
  /** Wake-ups so far; the session starts over after HOST_TURNS_MAX. */
  turns: number;
  /** No prompt has gone to it yet: the first one briefs it. */
  fresh: boolean;
}

/** Someone spoke to this pet or it overheard something, and it has not been woken for it yet. */
interface Wake {
  kind: WakeKind;
  /** The user did it: then the pet answers even though they are away. */
  fromUser: boolean;
  at: number;
}

/**
 * One desktop pet's mind: a Copilot CLI session that stays on, and every so often lolPing wakes it with a short note
 * about the moment (the time, the pets, how long the user has been away) and what it heard the others say. The agent
 * answers through the pet tools, which reach lolPing's bridge under the session's own token, and says how long it
 * wants to sleep; someone speaking to it wakes it sooner. It plays only its own pet, keeps its own notes, and gets
 * nothing from the screen: any other permission it asks for is refused.
 */
export class PetHost {
  private on = false;
  /** Changes whenever hosting is stopped or started, so a loop that outlives its start ends. */
  private gen = 0;
  private seq = 0;
  private fails = 0;
  private live: Live | null = null;
  /**
   * The token of a session that is still being started. The agent connects to the bridge and lists the tools while it
   * opens the session, and asks only once, so the token has to be known before the session is.
   */
  private starting: string | null = null;
  /** The session of the wake-up under way or just ended, kept after `live` is cleared so a failure can be told from the session. */
  private last: Live | null = null;
  private model: string | null = null;
  private persona = '';
  /** The session no longer matches the settings (the character or a note changed): the next wake-up starts a new one. */
  private stale = false;
  private wake: Wake | null = null;
  /** The last line of the room this mind was told. */
  private heardSeq = 0;
  /** What this pet said, so the agent knows (and a fresh session does too). */
  private recent: { text: string; at: number }[] = [];
  /** Ends the sleep now. */
  private wakeUp: (() => void) | null = null;
  /** Hosting gave up (no Copilot profile, not found, too many failures); it starts again when the user turns it off and on. */
  private suspended = false;

  constructor(private readonly deps: PetHostDeps) {}

  /** Hosting is on and has not given up. */
  get active(): boolean {
    return this.on && !this.suspended;
  }

  /** Follows the settings: starts the mind when it is turned on, brings it up to date, stops it when it is off. */
  sync(): void {
    const t = this.deps.settings().teammate;
    const mine = t.pets[this.deps.who];
    if (!t.petRoam || t.petRoamKind !== 'host' || !mine.on) {
      this.stop();
      this.suspended = false;
      this.fails = 0;
      return;
    }
    if (this.suspended) return;
    const model = mine.model ?? t.petHostModel;
    if (!this.on) {
      this.on = true;
      this.model = model;
      this.persona = mine.persona;
      const gen = ++this.gen;
      this.run(gen).catch((err: unknown) => console.warn('[teammate] pet host:', err));
      return;
    }
    if (mine.persona !== this.persona) {
      this.persona = mine.persona;
      this.stale = true;
    }
    if (model !== this.model) {
      this.model = model;
      this.switchModel();
    }
  }

  /** Ends the session and the wait for the next wake-up. */
  stop(): void {
    this.on = false;
    this.gen += 1;
    this.wake = null;
    this.stale = false;
    this.wakeUp?.();
    this.drop();
  }

  /** The notes were changed from outside (the user edited them): the session is briefed again at the next wake-up. */
  rebrief(): void {
    this.stale = true;
  }

  /** Someone spoke to this pet or something was said near it: it wakes soon. False when this mind isn't on to hear it. */
  nudge(kind: WakeKind, fromUser: boolean): boolean {
    if (!this.active) return false;
    const old = this.wake && this.deps.now().getTime() - this.wake.at < WAKE_TTL_MS ? this.wake : null;
    this.wake = {
      kind: old?.kind === 'direct' ? 'direct' : kind,
      fromUser: fromUser || (old?.fromUser ?? false),
      at: old?.at ?? this.deps.now().getTime(),
    };
    this.wakeUp?.();
    return true;
  }

  /** The tools of the session with token `ask`; null when that is no session of this mind. */
  tools(ask: string): ToolDef[] | null {
    return this.live?.token === ask || this.starting === ask ? hostToolDefs(this.activity()) : null;
  }

  async call(ask: string, name: string, args: unknown): Promise<Result> {
    const live = this.live;
    if (live?.token !== ask || !isHostTool(name)) return { content: NOT_AVAILABLE, isError: true };
    if (!this.deps.enabled() || !this.active) return { content: PAUSED, isError: true };
    // The rest is always let through: it is what ends a wake-up.
    if (live.calls >= HOST_CALLS_MAX && name !== 'pet_rest') return { content: ENOUGH, isError: true };
    live.calls += 1;
    if (name === 'pet_rest') {
      const seconds = parseRest(args, this.activity());
      if (seconds === null) return { content: INVALID, isError: true };
      live.rest = seconds;
      this.endSoon(live);
      return {
        content: [{ text: `Sleeping for about ${seconds} seconds. This wake-up is over: make no more tool calls and write nothing.` }],
        isError: false,
      };
    }
    if (name === 'pet_remember' || name === 'pet_forget') return this.keep(name, args);
    return this.act(name, args);
  }

  /** A pet tool, always for this mind's own pet: whatever pet the agent names is ignored. */
  private act(name: string, args: unknown): Result {
    const { who } = this.deps;
    const raw = typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    const cmd = parsePetCall(name, { ...raw, pet: who });
    if (!cmd) return { content: INVALID, isError: true };
    const to = cmd.kind === 'say' && cmd.to !== who ? (cmd.to ?? null) : null;
    const done = this.deps.pet.drive(cmd, this.label(to));
    if (cmd.kind === 'say' && done.ok) {
      this.recent.push({ text: cmd.text, at: this.deps.now().getTime() });
      if (this.recent.length > RECENT_MAX) this.recent.shift();
      this.deps.room.said(who, cmd.text, to);
    }
    return { content: [{ text: done.text }], isError: !done.ok };
  }

  /** What a bubble's header says: this pet, and who it speaks to. */
  private label(to: SayTo | null): string {
    const names = this.deps.names();
    const me = names.pet[this.deps.who];
    return to === null ? me : `${me} → ${to === 'all' ? names.everyone : names.pet[to]}`;
  }

  /** `pet_remember` and `pet_forget`: this pet's notes. */
  private keep(name: 'pet_remember' | 'pet_forget', args: unknown): Result {
    const { who, minds } = this.deps;
    const raw = typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    const notes = minds.notes(who);
    if (name === 'pet_remember') {
      const about = noteAbout(raw.about);
      const r = addNote(notes, raw.note, about === who ? null : about, this.deps.now().getTime());
      if (!r.kept) return { content: INVALID, isError: true };
      minds.set(who, r.notes);
      this.deps.room.noted(who, r.kept.text);
      return { content: [{ text: `Noted (${r.notes.length} notes).` }], isError: false };
    }
    const number = typeof raw.number === 'number' ? raw.number : -1;
    const at = Number.isInteger(number) ? number - 1 : -1;
    const removed = notes[at];
    if (!removed) return { content: [{ text: 'You have no such note.' }], isError: true };
    minds.set(who, notes.filter((_, i) => i !== at));
    return { content: [{ text: `Forgot: ${removed.text}` }], isError: false };
  }

  private activity(): HostActivity {
    return this.deps.settings().teammate.petHostActivity;
  }

  private alive(gen: number): boolean {
    return this.on && this.gen === gen;
  }

  /** A model change goes to the session as it is; a pet back on the shared default, or a refusal, starts a new session. */
  private switchModel(): void {
    const live = this.live;
    const model = this.model;
    if (!live || model === null) {
      this.stale = true;
      return;
    }
    live.session.client.request('session/set_model', { sessionId: live.session.sessionId, modelId: model }).catch(() => {
      this.stale = true;
    });
  }

  /** The wake that is still worth answering. */
  private pending(): Wake | null {
    if (this.wake && this.deps.now().getTime() - this.wake.at >= WAKE_TTL_MS) this.wake = null;
    return this.wake;
  }

  private async run(gen: number): Promise<void> {
    let wait = FIRST_MS + this.deps.stagger();
    /** The last look found the pets not ready, so this sleep is a real one: waiting words don't cut it short. */
    let retry = false;
    while (this.alive(gen)) {
      await this.sleep(wait, !retry);
      if (!this.alive(gen)) return;
      if (!this.ready()) {
        wait = this.pending() ? EVENT_RETRY_MS : RETRY_MS;
        retry = true;
        continue;
      }
      retry = false;
      try {
        wait = await this.turn(gen);
        this.fails = 0;
      } catch (err) {
        if (!this.alive(gen)) return;
        // The agent ending clears `live` before the failed prompt reaches here, so what the wake-up did is read from `last`.
        const last = this.last;
        const worked = (last?.calls ?? 0) > 0;
        this.drop();
        if (err instanceof GiveUp) return this.giveUp(err.message);
        if (!worked) {
          const line = this.failureLine(err, last);
          this.fails += 1;
          if (this.fails === 1) this.deps.tell(line);
          if (this.fails >= FAILS_MAX) {
            this.deps.tell(strings(this.deps.lang()).teammate.ask.hostGaveUp);
            this.suspended = true;
            return;
          }
        }
        wait = worked ? restDelayMs(this.activity(), null, this.deps.random()) : BACKOFF_MS[Math.min(this.fails, BACKOFF_MS.length) - 1];
        retry = !worked;
      }
    }
  }

  /** Sleeps `ms`, or less when someone speaks to this pet or hosting stops; `skippable` sleeps are skipped when words are already waiting. */
  private sleep(ms: number, skippable: boolean): Promise<void> {
    if (skippable && this.pending()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let cancel: () => void = () => undefined;
      const done = (): void => {
        cancel();
        if (this.wakeUp === done) this.wakeUp = null;
        resolve();
      };
      cancel = this.deps.after(ms, done);
      this.wakeUp = done;
    });
  }

  /**
   * Not while paused, with an ask on screen, with this pet not showing, or while the user is away: that would spend
   * quota for nothing. The user speaking to the pet is the exception to the last.
   */
  private ready(): boolean {
    const { deps } = this;
    if (!deps.enabled() || deps.busy() || !deps.pet.shown().some((p) => p.id === deps.who)) return false;
    return (this.pending()?.fromUser ?? false) || deps.idleSeconds() < HOST_IDLE_SECONDS;
  }

  private moment(): HostMoment {
    const now = this.deps.now();
    return {
      hour: now.getHours(),
      minute: now.getMinutes(),
      idleSeconds: this.deps.idleSeconds(),
      pets: this.deps.pet.shown(),
      recent: this.recent.slice(-4).map((r) => ({ text: r.text, agoSeconds: Math.round((now.getTime() - r.at) / 1000) })),
    };
  }

  /** What the others said since this mind was last told, and why it woke; none when nothing was said. */
  private heard(): HostHeard | undefined {
    const { who, room } = this.deps;
    const wake = this.pending();
    this.wake = null;
    const { lines, seq, groups, group } = room.heard(who, this.heardSeq);
    this.heardSeq = seq;
    if (lines.length === 0) return undefined;
    return {
      kind: wake?.kind ?? 'timer', group,
      lines: lines.map((l) => heardLine(l, who, PET_NAMES, groups[l.room] ?? null)),
    };
  }

  /** Who this mind plays, as its first prompt tells it. */
  private who(): HostWho {
    const { who, settings, minds } = this.deps;
    const t = settings().teammate;
    return {
      id: who,
      persona: personaOf(who, t.pets[who].persona),
      notes: minds.notes(who),
      friends: this.deps.pet.shown().filter((p) => p.id !== who).map((p) => ({ id: p.id, persona: personaOf(p.id, t.pets[p.id].persona) })),
      social: t.petSocial,
      groups: this.deps.room.groups(who),
    };
  }

  /** One wake-up; the milliseconds until the next one. A wake-up in which the agent made no call has failed. */
  private async turn(gen: number): Promise<number> {
    this.last = null;
    if (this.stale) {
      this.stale = false;
      this.drop();
    }
    const live = this.live ?? await this.open(gen);
    this.last = live;
    const heard = this.heard();
    const moment = this.moment();
    const language = this.deps.lang() === 'zh-CN' ? 'Simplified Chinese' : 'English';
    const activity = this.activity();
    const text = live.fresh
      ? hostIntro({ language, activity, moment, who: this.who(), heard })
      : hostWake({ moment, heard });
    live.fresh = false;
    live.calls = 0;
    live.rest = null;
    await this.prompt(live, text);
    if (!this.alive(gen)) return 0;
    live.turns += 1;
    if (live.calls === 0) {
      throw new Failure(strings(this.deps.lang()).teammate.ask.hostSilent(this.deps.names().pet[this.deps.who]));
    }
    const wait = restDelayMs(activity, live.rest, this.deps.random());
    if (live.turns >= HOST_TURNS_MAX) this.drop();
    return wait;
  }

  /** The prompt goes in and the call returns when the agent has finished its turn; one that runs long is cancelled. */
  private async prompt(live: Live, text: string): Promise<void> {
    const { client, sessionId } = live.session;
    const timers: (() => void)[] = [];
    let cancelled = false;
    live.cancel = () => {
      if (cancelled) return;
      cancelled = true;
      client.notify('session/cancel', { sessionId });
      timers.push(this.deps.after(CANCEL_GRACE_MS, () => client.close()));
    };
    timers.push(this.deps.after(HOST_TURN_MAX_MS, live.cancel));
    try {
      await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] });
    } finally {
      for (const stop of timers) stop();
      live.ending?.();
      live.ending = null;
      live.cancel = null;
    }
  }

  /** The agent has rested, which ends its wake-up; it would go on calling tools, so the turn is cancelled in a moment. */
  private endSoon(live: Live): void {
    if (live.ending || !live.cancel) return;
    const cancel = live.cancel;
    live.ending = this.deps.after(REST_GRACE_MS, cancel);
  }

  /** Starts the agent and its session, with a token of its own for the pet tools. */
  private async open(gen: number): Promise<Live> {
    const { deps } = this;
    const t = deps.settings().teammate;
    const words = strings(deps.lang()).teammate.ask;
    const profile = pickHostAgent(t.profiles, t.defaultProfile);
    if (!profile) throw new GiveUp(words.hostNoAgent);
    const token = `host-${deps.who}-${++this.seq}.${randomBytes(TOKEN_BYTES).toString('hex')}`;
    const bridge = deps.bridge(token);
    if (!bridge) throw new Failure(words.agent.noBridge);
    const dir = join(deps.tempDir(), `host-${deps.who}-${this.seq}`);
    await deps.files.makeDir(dir);
    const configPath = join(dir, 'mcp.json');
    let session: AcpSession;
    this.starting = token;
    try {
      await deps.files.writeFile(configPath, hostMcpConfig(bridge));
      const env = await deps.env();
      session = await deps.start(profile.command, hostArgs({ model: this.model, configPath }), dir, env);
    } catch (err) {
      deps.files.removeDir(dir).catch(() => undefined);
      if (err instanceof AgentStartError) {
        const line = err.kind === 'notFound' ? words.agent.notFound(profile.command) : words.agent.noStart(profile.command);
        throw err.kind === 'spawn' ? new Failure(line) : new GiveUp(line);
      }
      throw err;
    } finally {
      if (this.starting === token) this.starting = null;
    }
    const live: Live = { token, session, dir, from: profile.name, calls: 0, rest: null, cancel: null, ending: null, turns: 0, fresh: true };
    session.client.onClose(() => {
      if (this.live === live) this.live = null;
      deps.files.removeDir(dir).catch(() => undefined);
    });
    if (!this.alive(gen)) {
      session.client.close();
      throw new Failure('stopped');
    }
    this.live = live;
    return live;
  }

  /** Ends the session; the next wake-up starts a new one that is briefed again. */
  private drop(): void {
    const live = this.live;
    this.live = null;
    this.starting = null;
    live?.session.client.close();
  }

  private failureLine(err: unknown, live: Live | null): string {
    const words = strings(this.deps.lang()).teammate.ask.agent;
    if (err instanceof Failure) return err.message;
    console.warn('[teammate] pet host:', err, live?.session.stderr().slice(-300) ?? '');
    const message = err instanceof Error ? err.message.trim().slice(0, FAIL_LINE_MAX) : '';
    const name = live?.from ?? 'Copilot CLI';
    return message ? words.error(name, message) : words.stopped(name);
  }

  private giveUp(line: string): void {
    this.deps.tell(line);
    this.suspended = true;
  }
}
