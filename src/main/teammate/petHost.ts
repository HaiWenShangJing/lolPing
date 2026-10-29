import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { strings, type Lang } from '../../shared/i18n';
import type { Settings } from '../../shared/settings';
import type { AgentRunSpec } from '../../shared/teammate/agents';
import type { BridgeContent } from '../../shared/teammate/bridgeProtocol';
import type { PetId } from '../../shared/teammate/pet';
import { parsePetCall } from '../../shared/teammate/petControl';
import {
  HOST_CALLS_MAX, HOST_IDLE_SECONDS, HOST_TURNS_MAX, HOST_TURN_MAX_MS, hostArgs, hostChat, hostIntro, hostMcpConfig, hostToolDefs,
  hostWake, isHostTool, parseRest, pickHostAgent, restDelayMs, HOST_CHAT_MAX, type HostActivity, type HostMoment, type HostSay,
} from '../../shared/teammate/petHost';
import type { ToolDef } from '../../shared/teammate/tools';
import { AgentStartError } from './agents/runner';
import type { AcpSession } from './acp/session';
import type { PetWindows } from './petWindows';

const TOKEN_BYTES = 16;
/** The first wake-up comes this long after hosting starts, so the user sees it work. */
const FIRST_MS = 10_000;
/** Paused, an ask is on screen, no pet showing or the user away: look again in a minute. */
const RETRY_MS = 60_000;
/** Something the user typed is waiting and the pets are busy with an ask: look again soon. */
const EVENT_RETRY_MS = 5_000;
/** After a cancel, the agent has this long to end the wake-up before its process is stopped. */
const CANCEL_GRACE_MS = 10_000;
/** The rest ends a wake-up, but the calls that came with it still go through; after this long the turn is cancelled, as models tend to go on. */
const REST_GRACE_MS = 2_500;
/** Failures in a row (a session that won't start, a wake-up that did nothing) before hosting gives up until it is turned off and on. */
const FAILS_MAX = 3;
const BACKOFF_MS = [30_000, 60_000, 120_000];
const FAIL_LINE_MAX = 120;
const EVENTS_MAX = 3;
const RECENT_MAX = 6;
const FROM = 'lolPing';

const NOT_AVAILABLE: BridgeContent[] = [{ text: 'Not available.' }];
const PAUSED: BridgeContent[] = [{ text: 'lolPing is paused.' }];
const INVALID: BridgeContent[] = [{ text: 'Ignored: the arguments were not valid.' }];
const ENOUGH: BridgeContent[] = [{ text: 'That is enough for this wake-up. Call pet_rest and stop.' }];

type Result = { content: BridgeContent[]; isError: boolean };

/** Hosting can't work as it is set up: the pets say why and wait for the user to turn it off and on. */
class GiveUp extends Error {}
/** One try failed: the pets say so the first time, and after a few in a row hosting gives up. */
class Failure extends Error {}

export interface PetHostDeps {
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
  /** The agent's name, as the pets' bubble says who is talking. */
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

/**
 * Pets that a coding agent hosts: one Copilot CLI session stays on, and every so often lolPing wakes it with a short
 * note about the moment (the time, the pets, how long the user has been away). The agent answers through the pet tools,
 * which reach lolPing's bridge under the session's own token, and says how long it wants to sleep. What the user types
 * to a pet wakes it at once. The agent gets nothing from the screen, and only the pet tools: any other permission it
 * asks for is refused.
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
  /** What the user typed since the last wake-up. */
  private events: HostSay[] = [];
  /** What the pets said, so the agent knows (and a fresh session does too). */
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

  /** Follows the settings: starts hosting when it is turned on, restarts it with another model, stops it when it is off. */
  sync(): void {
    const t = this.deps.settings().teammate;
    if (!t.petRoam || t.petRoamKind !== 'host') {
      this.stop();
      this.suspended = false;
      this.fails = 0;
      return;
    }
    if (this.suspended) return;
    if (this.on && this.model === t.petHostModel) return;
    this.stop();
    this.on = true;
    this.model = t.petHostModel;
    const gen = ++this.gen;
    this.run(gen).catch((err: unknown) => console.warn('[teammate] pet host:', err));
  }

  /** Ends the session and the wait for the next wake-up. */
  stop(): void {
    this.on = false;
    this.gen += 1;
    this.events = [];
    this.wakeUp?.();
    this.drop();
  }

  /** The user typed to a pet (null: to the pets): the agent is woken for it. False when no host is on to hear it. */
  chat(pet: PetId | null, text: string): boolean {
    const said = text.trim().slice(0, HOST_CHAT_MAX);
    if (!this.active || said === '') return false;
    this.events.push({ pet, text: said });
    if (this.events.length > EVENTS_MAX) this.events.shift();
    this.wakeUp?.();
    return true;
  }

  /** The tools of the session with token `ask`; null when that is no session of this host. */
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
    const cmd = parsePetCall(name, args);
    if (!cmd) return { content: INVALID, isError: true };
    const done = this.deps.pet.drive(cmd, live.from);
    if (cmd.kind === 'say' && done.ok) {
      this.recent.push({ text: cmd.text, at: this.deps.now().getTime() });
      if (this.recent.length > RECENT_MAX) this.recent.shift();
    }
    return { content: [{ text: done.text }], isError: !done.ok };
  }

  private activity(): HostActivity {
    return this.deps.settings().teammate.petHostActivity;
  }

  private alive(gen: number): boolean {
    return this.on && this.gen === gen;
  }

  private async run(gen: number): Promise<void> {
    let wait = FIRST_MS;
    /** The last look found the pets not ready, so this sleep is a real one: queued words don't cut it short. */
    let retry = false;
    while (this.alive(gen)) {
      await this.sleep(wait, !retry);
      if (!this.alive(gen)) return;
      if (!this.ready()) {
        wait = this.events.length > 0 ? EVENT_RETRY_MS : RETRY_MS;
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
          if (this.fails === 1) this.tell(line);
          if (this.fails >= FAILS_MAX) {
            this.tell(strings(this.deps.lang()).teammate.ask.hostGaveUp);
            this.suspended = true;
            return;
          }
        }
        wait = worked ? restDelayMs(this.activity(), null, this.deps.random()) : BACKOFF_MS[Math.min(this.fails, BACKOFF_MS.length) - 1];
        retry = !worked;
      }
    }
  }

  /** Sleeps `ms`, or less when the user types to a pet or hosting stops; `skippable` sleeps are skipped when words are already waiting. */
  private sleep(ms: number, skippable: boolean): Promise<void> {
    if (skippable && this.events.length > 0) return Promise.resolve();
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

  /** Not while paused, with an ask on screen, with no pet showing, or while the user is away: that would spend quota for nothing. */
  private ready(): boolean {
    const { deps } = this;
    if (!deps.enabled() || deps.busy() || deps.pet.shown().length === 0) return false;
    return this.events.length > 0 || deps.idleSeconds() < HOST_IDLE_SECONDS;
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

  /** One wake-up; the milliseconds until the next one. A wake-up in which the agent made no call has failed. */
  private async turn(gen: number): Promise<number> {
    this.last = null;
    const live = this.live ?? await this.open(gen);
    this.last = live;
    const says = this.events.splice(0);
    const moment = this.moment();
    const language = this.deps.lang() === 'zh-CN' ? 'Simplified Chinese' : 'English';
    const activity = this.activity();
    let text: string;
    if (live.fresh) text = hostIntro({ language, activity, moment, says });
    else text = says.length > 0 ? hostChat({ says, moment }) : hostWake(moment);
    live.fresh = false;
    live.calls = 0;
    live.rest = null;
    await this.prompt(live, text);
    if (!this.alive(gen)) return 0;
    live.turns += 1;
    if (live.calls === 0) throw new Failure(strings(this.deps.lang()).teammate.ask.hostSilent(live.from));
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
    const token = `host-${++this.seq}.${randomBytes(TOKEN_BYTES).toString('hex')}`;
    const bridge = deps.bridge(token);
    if (!bridge) throw new Failure(words.agent.noBridge);
    const dir = join(deps.tempDir(), `host-${this.seq}`);
    await deps.files.makeDir(dir);
    const configPath = join(dir, 'mcp.json');
    let session: AcpSession;
    this.starting = token;
    try {
      await deps.files.writeFile(configPath, hostMcpConfig(bridge));
      const env = await deps.env();
      session = await deps.start(profile.command, hostArgs({ model: t.petHostModel, configPath }), dir, env);
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
    this.tell(line);
    this.suspended = true;
  }

  private tell(text: string): void {
    this.deps.pet.drive({ kind: 'say', pet: null, text, mood: null }, FROM);
  }
}
