import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AcpSession } from '../../../src/main/teammate/acp/session';
import { AgentStartError } from '../../../src/main/teammate/agents/runner';
import { bridgeHandler } from '../../../src/main/teammate/askController';
import { PetHost } from '../../../src/main/teammate/petHost';
import { strings } from '../../../src/shared/i18n';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/settings';
import type { PetCommand, PetDriveResult, PetStatus } from '../../../src/shared/teammate/petControl';
import {
  HOST_CALLS_MAX, HOST_CHAT_MAX, HOST_IDLE_SECONDS, HOST_REST, HOST_SERVER, HOST_TURNS_MAX, HOST_TURN_MAX_MS, hostArgs, restDelayMs,
} from '../../../src/shared/teammate/petHost';
import { DEFAULT_TEAMMATE, type AgentProfile, type Profile } from '../../../src/shared/teammate/settings';

const words = strings('en').teammate.ask;
const FIRST_MS = 10_000;
const RETRY_MS = 60_000;
const EVENT_RETRY_MS = 5_000;
const CANCEL_GRACE_MS = 10_000;
const REST_GRACE_MS = 2_500;
const BACKOFF_MS = [30_000, 60_000, 120_000];
const USUAL_MS = restDelayMs('normal', null, 0.5);
const TEMP = 'C:\\tmp\\lolping-teammate';
const dirOf = (n: number): string => join(TEMP, `host-${n}`);

const text = (r: { content: unknown[] }): string => (r.content[0] as { text?: string } | undefined)?.text ?? '';

const agent = (over: Partial<AgentProfile> = {}): AgentProfile => ({
  id: 'cp', kind: 'agent', name: 'Copilot CLI', tagColor: 1, tagColorCustom: null, preset: 'copilot', command: 'copilot',
  customArgs: [], folder: { kind: 'fixed', path: 'C:\\code\\lolPing' }, timeoutS: 300, ...over,
});

const pet: PetStatus = { id: 'naiwa', xPct: 90, yPct: 80, away: false, anims: ['idle', 'dance'] };

interface Sess {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  token: string;
  prompts: string[];
  notes: Array<{ method: string; params: unknown }>;
  kills: number;
  closed: boolean;
  /** The agent ends its turn. */
  finish(): void;
  /** The agent's turn fails. */
  crash(message: string): void;
}

interface Timer {
  ms: number;
  fn: () => void;
  live: boolean;
}

interface Options {
  profiles?: Profile[];
  startThrows?: Error;
  bridgeDown?: boolean;
  lang?: 'en' | 'zh-CN';
  /** Runs while the agent is still opening its session, as its connection to the bridge does. */
  whileStarting?: (host: PetHost, token: string) => void;
}

function harness(opts: Options = {}) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    teammate: {
      ...DEFAULT_TEAMMATE, profiles: opts.profiles ?? [agent()], defaultProfile: 'cp', petRoam: false, petRoamKind: 'host',
      petHostActivity: 'normal', petHostModel: null,
    },
  };
  const driven: Array<{ cmd: PetCommand; from: string }> = [];
  const sessions: Sess[] = [];
  const timers: Timer[] = [];
  const tokens: string[] = [];
  const made: string[] = [];
  const removed: string[] = [];
  const written = new Map<string, string>();
  const state = { enabled: true, busy: false, idle: 5, pets: [pet] as PetStatus[] };

  const makeSession = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): AcpSession => {
    const closers: Array<() => void> = [];
    let turn: { ok(): void; err(e: Error): void } | null = null;
    const s: Sess = {
      command, args, cwd, env, token: tokens.at(-1) ?? '', prompts: [], notes: [], kills: 0, closed: false,
      finish: () => turn?.ok(),
      crash: (m) => turn?.err(new Error(m)),
    };
    sessions.push(s);
    const client = {
      request: (method: string, params: { prompt?: Array<{ text: string }> }) => {
        if (method !== 'session/prompt') return Promise.resolve({});
        s.prompts.push(params.prompt?.[0]?.text ?? '');
        return new Promise((resolve, reject) => { turn = { ok: () => resolve({ stopReason: 'end_turn' }), err: reject }; });
      },
      notify: (method: string, params: unknown) => { s.notes.push({ method, params }); },
      // As the real client does: what is waiting fails first, then whoever listens for the end is told.
      close: () => {
        if (s.closed) return;
        s.closed = true;
        s.kills += 1;
        turn?.err(new Error('The agent was stopped.'));
        for (const cb of closers) cb();
      },
      onClose: (cb: () => void) => { if (s.closed) cb(); else closers.push(cb); },
      get closed() { return s.closed; },
    };
    return { client: client as unknown as AcpSession['client'], sessionId: `sess-${sessions.length}`, models: [], stderr: () => 'stderr tail' };
  };

  const host = new PetHost({
    settings: () => settings,
    enabled: () => state.enabled,
    busy: () => state.busy,
    lang: () => opts.lang ?? 'en',
    now: () => new Date(2026, 0, 1, 9, 5),
    idleSeconds: () => state.idle,
    pet: {
      drive: (cmd, from): PetDriveResult => {
        driven.push({ cmd, from });
        return { ok: true, text: 'done' };
      },
      shown: () => state.pets,
    },
    start: async (command, args, cwd, env) => {
      opts.whileStarting?.(host, tokens.at(-1) ?? '');
      if (opts.startThrows) throw opts.startThrows;
      return makeSession(command, args, cwd, env);
    },
    bridge: (ask) => {
      tokens.push(ask);
      return opts.bridgeDown ? null : { command: 'lolPing.exe', args: ['bridge.js'], env: { LOLPING_ASK: ask } };
    },
    env: async () => ({ PATH: 'C:\\bin' }),
    tempDir: () => TEMP,
    files: {
      makeDir: async (p) => { made.push(p); },
      writeFile: async (p, t) => { written.set(p, t); },
      removeDir: async (p) => { removed.push(p); },
    },
    after: (ms, fn) => {
      const t: Timer = { ms, fn, live: true };
      timers.push(t);
      return () => { t.live = false; };
    },
    random: () => 0.5,
  });

  /** The timers waiting to fire, apart from a wake-up's own time limit. */
  const pending = () => timers.filter((t) => t.live && t.ms !== HOST_TURN_MAX_MS);
  const fire = (t: Timer | undefined): void => {
    if (!t) throw new Error('no timer');
    t.live = false;
    t.fn();
  };
  const prompts = () => sessions.reduce((n, s) => n + s.prompts.length, 0);
  const turnOn = (): void => {
    settings.teammate.petRoam = true;
    host.sync();
  };
  const turnOff = (): void => {
    settings.teammate.petRoam = false;
    host.sync();
  };
  /** Ends the sleep and waits until the n-th prompt, over all sessions, has gone to the agent. */
  const wake = async (n: number): Promise<Sess> => {
    fire(pending().at(-1));
    await vi.waitFor(() => expect(prompts()).toBe(n), { interval: 1 });
    return sessions.at(-1) as Sess;
  };
  /** The agent does what it does in a wake-up and ends its turn. */
  const reply = async (s: Sess, o: { say?: string | null; rest?: number } = {}): Promise<void> => {
    if (o.say !== null) await host.call(s.token, 'pet_say', { text: o.say ?? 'hi' });
    if (o.rest !== undefined) await host.call(s.token, 'pet_rest', { seconds: o.rest });
    s.finish();
  };
  const settle = () => vi.waitFor(() => expect(pending()).toHaveLength(1), { interval: 1 });
  const said = () => driven.filter((d) => d.cmd.kind === 'say').map((d) => (d.cmd as { text: string }).text);
  const delays = () => pending().map((t) => t.ms);
  return { host, settings, driven, sessions, timers, made, removed, written, state, tokens, pending, fire, prompts, turnOn, turnOff, wake, reply, settle, said, delays };
}

describe('PetHost schedule', () => {
  it('does nothing while hosting is off or roaming is in visit mode', () => {
    const h = harness();
    h.host.sync();
    h.settings.teammate.petRoam = true;
    h.settings.teammate.petRoamKind = 'visit';
    h.host.sync();
    expect(h.pending()).toEqual([]);
    expect(h.host.active).toBe(false);
  });

  it('makes the first wake-up ten seconds after hosting is turned on', () => {
    const h = harness();
    h.turnOn();
    expect(h.delays()).toEqual([FIRST_MS]);
    expect(h.host.active).toBe(true);
    expect(h.sessions).toEqual([]);
  });

  it('keeps its sleep when synced again with nothing changed', () => {
    const h = harness();
    h.turnOn();
    h.host.sync();
    expect(h.timers).toHaveLength(1);
  });

  it('stops when hosting is turned off, or switched to visits', () => {
    const h = harness();
    h.turnOn();
    h.turnOff();
    expect(h.pending()).toEqual([]);
    expect(h.host.active).toBe(false);
    h.turnOn();
    h.settings.teammate.petRoamKind = 'visit';
    h.host.sync();
    expect(h.pending()).toEqual([]);
  });
});

describe('PetHost wake-ups', () => {
  it('starts one session for the first wake-up and briefs it', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    expect(h.sessions).toHaveLength(1);
    expect(s.command).toBe('copilot');
    expect(s.cwd).toBe(dirOf(1));
    expect(s.args).toEqual(hostArgs({ model: null, configPath: join(dirOf(1), 'mcp.json') }));
    expect(s.env).toEqual({ PATH: 'C:\\bin' });
    expect(h.made).toEqual([dirOf(1)]);
    expect(s.token).toMatch(/^host-1\.[0-9a-f]{32}$/);
    const config = JSON.parse(h.written.get(join(dirOf(1), 'mcp.json')) ?? '{}') as { mcpServers: Record<string, { env: Record<string, string> }> };
    expect(config.mcpServers[HOST_SERVER].env.LOLPING_ASK).toBe(s.token);
    expect(s.prompts[0]).toContain('first wake-up');
    expect(s.prompts[0]).toContain('pet_rest');
  });

  it('wakes the same session again with a short note, and sleeps as long as the agent asked', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.reply(s, { rest: 120 });
    await h.settle();
    expect(h.delays()).toEqual([120_000]);
    expect(await h.wake(2)).toBe(s);
    expect(h.sessions).toHaveLength(1);
    expect(s.prompts[1]).toContain('09:05');
    expect(s.prompts[1]).not.toContain('first wake-up');
  });

  it('keeps what it asked for inside the range of the activity, and sleeps the usual when it asked for nothing', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.reply(s, { rest: 5 });
    await h.settle();
    expect(h.delays()).toEqual([HOST_REST.normal.min * 1000]);
    await h.wake(2);
    await h.reply(s);
    await h.settle();
    expect(h.delays()).toEqual([USUAL_MS]);
  });

  it('tells the pets what the agent says in its name, and tells the agent what the pets said last', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.reply(s, { say: 'good morning', rest: 120 });
    await h.settle();
    expect(h.driven).toEqual([{ cmd: { kind: 'say', pet: null, text: 'good morning', mood: null }, from: 'Copilot CLI' }]);
    await h.wake(2);
    expect(s.prompts[1]).toContain('"good morning"');
  });

  it('waits for the pets to be ready: not paused, no ask running, a pet showing, the user not away', async () => {
    const h = harness();
    h.turnOn();
    const cases: Array<() => void> = [
      () => { h.state.enabled = false; },
      () => { h.state.enabled = true; h.state.busy = true; },
      () => { h.state.busy = false; h.state.pets = []; },
      () => { h.state.pets = [pet]; h.state.idle = HOST_IDLE_SECONDS; },
    ];
    for (const set of cases) {
      set();
      h.fire(h.pending().at(-1));
      await vi.waitFor(() => expect(h.delays()).toEqual([RETRY_MS]));
    }
    expect(h.sessions).toEqual([]);
    h.state.idle = 5;
    await h.wake(1);
    expect(h.sessions).toHaveLength(1);
  });

  it('does not start a session while no pet is showing, and says nothing', async () => {
    const h = harness();
    h.state.pets = [];
    h.turnOn();
    h.fire(h.pending().at(-1));
    await vi.waitFor(() => expect(h.delays()).toEqual([RETRY_MS]));
    expect(h.said()).toEqual([]);
  });

  it('ends a wake-up that takes too long, and the session when it won\'t stop', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.host.call(s.token, 'pet_say', { text: 'hi' });
    const limit = h.timers.find((t) => t.live && t.ms === HOST_TURN_MAX_MS);
    h.fire(limit);
    expect(s.notes).toEqual([{ method: 'session/cancel', params: { sessionId: 'sess-1' } }]);
    expect(s.closed).toBe(false);
    h.fire(h.timers.find((t) => t.live && t.ms === CANCEL_GRACE_MS));
    expect(s.closed).toBe(true);
    // it had made a call, so this was a long wake-up and not a failure
    await h.settle();
    expect(h.said()).toEqual(['hi']);
    expect(h.delays()).toEqual([USUAL_MS]);
  });

  it('lets a wake-up that ends in time keep its session, and stops its time limit', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.reply(s, { rest: 120 });
    await h.settle();
    expect(h.timers.filter((t) => t.live && t.ms === HOST_TURN_MAX_MS)).toEqual([]);
    expect(s.closed).toBe(false);
  });

  it('cancels the turn a moment after the agent rests, as it would go on calling tools, and keeps the session', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.host.call(s.token, 'pet_say', { text: 'hi' });
    await h.host.call(s.token, 'pet_rest', { seconds: 120 });
    expect(s.notes).toEqual([]);
    h.fire(h.timers.find((t) => t.live && t.ms === REST_GRACE_MS));
    expect(s.notes).toEqual([{ method: 'session/cancel', params: { sessionId: 'sess-1' } }]);
    s.finish();
    await vi.waitFor(() => expect(h.delays()).toEqual([restDelayMs('normal', 120, 0.5)]), { interval: 1 });
    expect(s.closed).toBe(false);
  });

  it('still takes the calls that come with the rest, and sets the wait only once', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.host.call(s.token, 'pet_rest', { seconds: 120 });
    await h.host.call(s.token, 'pet_rest', { seconds: 100 });
    expect((await h.host.call(s.token, 'pet_say', { text: 'late' })).isError).toBe(false);
    expect(h.timers.filter((t) => t.live && t.ms === REST_GRACE_MS)).toHaveLength(1);
    expect(h.said()).toEqual(['late']);
  });

  it('does not cancel a turn that ended by itself after the rest', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.reply(s, { rest: 120 });
    await h.settle();
    expect(h.timers.filter((t) => t.live && t.ms === REST_GRACE_MS)).toEqual([]);
    expect(s.notes).toEqual([]);
  });
});

describe('PetHost model', () => {
  it('starts the session with the chosen model', async () => {
    const h = harness();
    h.settings.teammate.petHostModel = 'claude-haiku-4.5';
    h.turnOn();
    const s = await h.wake(1);
    expect(s.args.slice(s.args.indexOf('--model'))).toEqual(['--model', 'claude-haiku-4.5']);
  });

  it('starts over with another model when it is changed, and keeps going when it is not', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.reply(s, { rest: 120 });
    await h.settle();
    h.host.sync();
    expect(s.closed).toBe(false);
    h.settings.teammate.petHostModel = 'gpt-6-sol';
    h.host.sync();
    expect(s.closed).toBe(true);
    expect(h.removed).toContain(dirOf(1));
    expect(h.delays()).toEqual([FIRST_MS]);
    const next = await h.wake(2);
    expect(next).not.toBe(s);
    expect(next.args).toContain('gpt-6-sol');
    expect(next.prompts[0]).toContain('first wake-up');
  });
});

describe('PetHost chat', () => {
  it('wakes the agent at once for what the user typed, and puts it in the briefing of a new session', async () => {
    const h = harness();
    h.turnOn();
    expect(h.host.chat('naiwa', '  hello  ')).toBe(true);
    await vi.waitFor(() => expect(h.prompts()).toBe(1));
    expect(h.sessions[0].prompts[0]).toContain('The user types to naiwa: "hello"');
    expect(h.sessions[0].prompts[0]).toContain('pet_rest');
  });

  it('passes it to a running session as a short note, not the whole briefing', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.reply(s, { rest: 300 });
    await h.settle();
    h.host.chat(null, 'are you there?');
    await vi.waitFor(() => expect(h.prompts()).toBe(2));
    expect(s.prompts[1]).toContain('The user types to the pets: "are you there?"');
    expect(s.prompts[1]).not.toContain('first wake-up');
    expect(h.sessions).toHaveLength(1);
  });

  it('is heard while the user is away, but not while an ask is running, and is tried again in five seconds', async () => {
    const h = harness();
    h.turnOn();
    h.state.idle = HOST_IDLE_SECONDS * 3;
    h.state.busy = true;
    h.host.chat('naiwa', 'hi');
    await vi.waitFor(() => expect(h.delays()).toEqual([EVENT_RETRY_MS]));
    expect(h.sessions).toEqual([]);
    h.state.busy = false;
    h.fire(h.pending().at(-1));
    await vi.waitFor(() => expect(h.prompts()).toBe(1));
    expect(h.sessions[0].prompts[0]).toContain('The user types to naiwa: "hi"');
  });

  it('does not spin while the words wait for the pets to be ready', async () => {
    const h = harness();
    h.turnOn();
    h.state.busy = true;
    h.host.chat('naiwa', 'hi');
    await vi.waitFor(() => expect(h.delays()).toEqual([EVENT_RETRY_MS]));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.timers).toHaveLength(2); // the first sleep and one retry, nothing more
  });

  it('keeps the last few lines, cut to length', async () => {
    const h = harness();
    h.turnOn();
    h.state.busy = true;
    for (const n of [1, 2, 3, 4]) h.host.chat('naiwa', n === 4 ? 'x'.repeat(HOST_CHAT_MAX + 50) : `line ${n}`);
    await vi.waitFor(() => expect(h.delays()).toEqual([EVENT_RETRY_MS]));
    h.state.busy = false;
    h.fire(h.pending().at(-1));
    await vi.waitFor(() => expect(h.prompts()).toBe(1));
    const first = h.sessions[0].prompts[0];
    expect(first).not.toContain('line 1');
    expect(first).toContain('line 2');
    expect(first).toContain('line 3');
    expect(first).toContain('x'.repeat(HOST_CHAT_MAX));
    expect(first).not.toContain('x'.repeat(HOST_CHAT_MAX + 1));
  });

  it('hears nothing while hosting is off, has given up, or the line is empty', async () => {
    const h = harness();
    expect(h.host.chat('naiwa', 'hi')).toBe(false);
    h.turnOn();
    expect(h.host.chat('naiwa', '   ')).toBe(false);
    expect(h.host.chat('naiwa', 'hi')).toBe(true);
    h.turnOff();
    expect(h.host.chat('naiwa', 'hi')).toBe(false);
    const g = harness({ profiles: [] });
    g.turnOn();
    g.fire(g.pending().at(-1));
    await vi.waitFor(() => expect(g.host.active).toBe(false));
    expect(g.host.chat('naiwa', 'hi')).toBe(false);
  });
});

describe('PetHost failures', () => {
  /** Wakes up and has the agent end its turn without a call. */
  const silent = async (h: ReturnType<typeof harness>, n: number): Promise<void> => {
    const s = await h.wake(n);
    s.finish();
  };

  it('says so the first time a wake-up did nothing, ends that session, and tries again after a pause', async () => {
    const h = harness();
    h.turnOn();
    await silent(h, 1);
    await h.settle();
    expect(h.said()).toEqual([words.hostSilent('Copilot CLI')]);
    expect(h.sessions[0].closed).toBe(true);
    expect(h.delays()).toEqual([BACKOFF_MS[0]]);
    expect(h.host.active).toBe(true);
    await silent(h, 2);
    await h.settle();
    expect(h.said()).toHaveLength(1);
    expect(h.delays()).toEqual([BACKOFF_MS[1]]);
    expect(h.sessions).toHaveLength(2);
  });

  it('gives up after three in a row, says so, and starts again only when turned off and on', async () => {
    const h = harness();
    h.turnOn();
    await silent(h, 1);
    await h.settle();
    await silent(h, 2);
    await h.settle();
    await silent(h, 3);
    await vi.waitFor(() => expect(h.host.active).toBe(false));
    expect(h.said()).toEqual([words.hostSilent('Copilot CLI'), words.hostGaveUp]);
    expect(h.pending()).toEqual([]);
    h.host.sync();
    expect(h.pending()).toEqual([]);
    h.turnOff();
    h.turnOn();
    expect(h.host.active).toBe(true);
    expect(h.delays()).toEqual([FIRST_MS]);
  });

  it('starts counting again after a wake-up that worked', async () => {
    const h = harness();
    h.turnOn();
    await silent(h, 1);
    await h.settle();
    const s = await h.wake(2);
    await h.reply(s, { rest: 120 });
    await h.settle();
    expect(h.delays()).toEqual([120_000]);
    await silent(h, 3);
    await h.settle();
    expect(h.said().filter((t) => t === words.hostSilent('Copilot CLI'))).toHaveLength(2);
  });

  it('says what went wrong when the agent fails a wake-up, naming it as the user named it', async () => {
    const h = harness({ profiles: [agent({ name: 'My Copilot' })] });
    h.turnOn();
    const s = await h.wake(1);
    s.crash('no quota left');
    await h.settle();
    expect(h.said()).toEqual([words.agent.error('My Copilot', 'no quota left')]);
    expect(s.closed).toBe(true);
  });

  it('treats a crash after the agent had acted as an ordinary rest', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.host.call(s.token, 'pet_say', { text: 'hi' });
    s.crash('socket closed');
    await h.settle();
    expect(h.said()).toEqual(['hi']);
    expect(h.delays()).toEqual([USUAL_MS]);
    expect(s.closed).toBe(true);
  });

  it('gives up at once when there is no Copilot CLI profile, and says why', async () => {
    const h = harness({ profiles: [agent({ preset: 'claude' })] });
    h.turnOn();
    h.fire(h.pending().at(-1));
    await vi.waitFor(() => expect(h.host.active).toBe(false));
    expect(h.said()).toEqual([words.hostNoAgent]);
    expect(h.sessions).toEqual([]);
    expect(h.pending()).toEqual([]);
  });

  it('gives up at once when the program is not found', async () => {
    const h = harness({ startThrows: new AgentStartError('notFound', 'x') });
    h.turnOn();
    h.fire(h.pending().at(-1));
    await vi.waitFor(() => expect(h.host.active).toBe(false));
    expect(h.said()).toEqual([words.agent.notFound('copilot')]);
    expect(h.removed).toEqual([dirOf(1)]);
  });

  it('tries again when the program failed to start', async () => {
    const h = harness({ startThrows: new AgentStartError('spawn', 'x') });
    h.turnOn();
    h.fire(h.pending().at(-1));
    await vi.waitFor(() => expect(h.delays()).toEqual([BACKOFF_MS[0]]));
    expect(h.said()).toEqual([words.agent.noStart('copilot')]);
    expect(h.host.active).toBe(true);
  });

  it('says when lolPing\'s agent connection is down, and starts nothing', async () => {
    const h = harness({ bridgeDown: true });
    h.turnOn();
    h.fire(h.pending().at(-1));
    await vi.waitFor(() => expect(h.delays()).toEqual([BACKOFF_MS[0]]));
    expect(h.said()).toEqual([words.agent.noBridge]);
    expect(h.sessions).toEqual([]);
  });

  it('speaks in the language of the user', async () => {
    const h = harness({ lang: 'zh-CN', profiles: [] });
    h.turnOn();
    h.fire(h.pending().at(-1));
    await vi.waitFor(() => expect(h.said()).toEqual([strings('zh-CN').teammate.ask.hostNoAgent]));
  });
});

describe('PetHost sessions', () => {
  it('ends the session and the wait when stopped, and removes its folder', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    await h.reply(s, { rest: 120 });
    await h.settle();
    h.host.stop();
    expect(s.closed).toBe(true);
    expect(h.pending()).toEqual([]);
    expect(h.removed).toEqual([dirOf(1)]);
    expect(h.host.tools(s.token)).toBeNull();
  });

  it('does not take a session that started as hosting was stopped', async () => {
    const h = harness();
    h.turnOn();
    h.fire(h.pending().at(-1));
    h.turnOff();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.sessions.every((s) => s.closed)).toBe(true);
    expect(h.host.active).toBe(false);
  });

  it('starts a new, briefed session after many wake-ups, under a new token', async () => {
    const h = harness();
    h.turnOn();
    let s = await h.wake(1);
    for (let n = 1; n < HOST_TURNS_MAX; n++) {
      await h.reply(s, { rest: 120 });
      await h.settle();
      s = await h.wake(n + 1);
    }
    await h.reply(s, { rest: 120 });
    await h.settle();
    expect(s.closed).toBe(true);
    expect(h.sessions).toHaveLength(1);
    const fresh = await h.wake(HOST_TURNS_MAX + 1);
    expect(h.sessions).toHaveLength(2);
    expect(fresh.token).not.toBe(s.token);
    expect(fresh.prompts[0]).toContain('first wake-up');
  });
});

describe('PetHost tools', () => {
  const setup = async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    return { h, s };
  };

  it('offers the pet tools to its own session only', async () => {
    const { h, s } = await setup();
    expect(h.host.tools(s.token)?.map((t) => t.name)).toEqual(['pet_status', 'pet_say', 'pet_walk', 'pet_play', 'pet_rest']);
    expect(h.host.tools('host-9.' + '0'.repeat(32))).toBeNull();
    expect(h.host.tools('roam-1.' + '0'.repeat(32))).toBeNull();
  });

  it('does not answer a stranger, another tool, or a call while paused', async () => {
    const { h, s } = await setup();
    expect(text(await h.host.call('host-9.x', 'pet_say', { text: 'hi' }))).toBe('Not available.');
    expect(text(await h.host.call(s.token, 'bash', { command: 'dir' }))).toBe('Not available.');
    h.state.enabled = false;
    expect(await h.host.call(s.token, 'pet_say', { text: 'hi' })).toEqual({ content: [{ text: 'lolPing is paused.' }], isError: true });
    expect(h.driven).toEqual([]);
  });

  it('ignores a call whose arguments are no good, and still counts it', async () => {
    const { h, s } = await setup();
    expect(await h.host.call(s.token, 'pet_say', { text: '' })).toEqual({
      content: [{ text: 'Ignored: the arguments were not valid.' }], isError: true,
    });
    expect((await h.host.call(s.token, 'pet_rest', { seconds: 'soon' })).isError).toBe(true);
    expect(h.driven).toEqual([]);
  });

  it('allows a number of calls in a wake-up, then tells the agent that is enough, but always lets it rest', async () => {
    const { h, s } = await setup();
    for (let n = 0; n < HOST_CALLS_MAX; n++) expect((await h.host.call(s.token, 'pet_status', {})).isError).toBe(false);
    const over = await h.host.call(s.token, 'pet_say', { text: 'more' });
    expect(over.isError).toBe(true);
    expect(text(over)).toContain('enough');
    const rest = await h.host.call(s.token, 'pet_rest', { seconds: 200 });
    expect(rest.isError).toBe(false);
    expect(text(rest)).toContain('Sleeping for about 200 seconds');
    expect(text(rest)).toContain('no more tool calls');
    expect(h.said()).toEqual([]);
  });

  it('counts calls afresh in each wake-up', async () => {
    const { h, s } = await setup();
    for (let n = 0; n < HOST_CALLS_MAX; n++) await h.host.call(s.token, 'pet_status', {});
    s.finish();
    await h.settle();
    await h.wake(2);
    expect((await h.host.call(s.token, 'pet_say', { text: 'again' })).isError).toBe(false);
  });

  it('reports what the pets said when they could not', async () => {
    const { h, s } = await setup();
    expect(text(await h.host.call(s.token, 'pet_status', {}))).toBe('done');
  });
});

describe('PetHost while the session starts', () => {
  it('lists the tools for its token while the agent is still opening the session, which is when it asks, and only then', async () => {
    let seen: string[] | null | undefined;
    let other: unknown = 'unset';
    const h = harness({
      whileStarting: (host, token) => {
        seen = host.tools(token)?.map((t) => t.name) ?? null;
        other = host.tools('host-9.' + '0'.repeat(32));
      },
    });
    h.turnOn();
    const s = await h.wake(1);
    expect(seen).toEqual(['pet_status', 'pet_say', 'pet_walk', 'pet_play', 'pet_rest']);
    expect(other).toBeNull();
    expect(h.host.tools(s.token)).not.toBeNull();
  });

  it('forgets the token of a session that did not start', async () => {
    let token = '';
    const h = harness({ startThrows: new AgentStartError('spawn', 'x'), whileStarting: (_host, t) => { token = t; } });
    h.turnOn();
    h.fire(h.pending().at(-1));
    await vi.waitFor(() => expect(h.delays()).toEqual([BACKOFF_MS[0]]));
    expect(h.host.tools(token)).toBeNull();
  });
});

describe('bridgeHandler with a host', () => {
  const never = new AbortController().signal;
  const ask = 'ask-1.' + '0'.repeat(32);
  const client = { name: 'copilot', version: '1' };
  const ctl = {
    agentTools: (a: string) => (a === ask ? [{ name: 'say', description: '', parameters: {} }] : null),
    agentCall: async () => ({ content: [{ text: 'ask' }], isError: false }),
    visitorTools: () => [],
    visitorCall: async () => ({ content: [{ text: 'visitor' }], isError: false }),
  };
  const visits = { tools: () => null, call: async () => ({ content: [{ text: 'visit' }], isError: false }) };

  it('serves the host\'s tools through its token, and an ask\'s as before', async () => {
    const h = harness();
    h.turnOn();
    const s = await h.wake(1);
    const handler = bridgeHandler(ctl, visits, h.host);
    expect(handler.list({ ask: s.token, client }).map((d) => d.name)).toContain('pet_rest');
    expect(text(await handler.call({ ask: s.token, client }, 'pet_say', { text: 'hi' }, never))).toBe('done');
    expect(handler.list({ ask, client }).map((d) => d.name)).toEqual(['say']);
    expect(text(await handler.call({ ask, client }, 'say', {}, never))).toBe('ask');
    expect(h.said()).toEqual(['hi']);
  });

  it('keeps an unknown token out of all of them', () => {
    const h = harness();
    const handler = bridgeHandler(ctl, visits, h.host);
    expect(handler.list({ ask: 'host-9.' + 'a'.repeat(32), client })).toEqual([]);
  });
});
