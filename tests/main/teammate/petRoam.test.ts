import { describe, expect, it, vi } from 'vitest';
import { AgentStartError, type AgentResult, type AgentRun } from '../../../src/main/teammate/agents/runner';
import { bridgeHandler } from '../../../src/main/teammate/askController';
import { PetRoam } from '../../../src/main/teammate/petRoam';
import { strings } from '../../../src/shared/i18n';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/settings';
import type { AgentRunSpec } from '../../../src/shared/teammate/agents';
import type { PetCommand, PetDriveResult } from '../../../src/shared/teammate/petControl';
import { ROAM_CALLS_MAX, roamDelayMs } from '../../../src/shared/teammate/petRoam';
import { DEFAULT_TEAMMATE, type AgentProfile, type Profile } from '../../../src/shared/teammate/settings';

const words = strings('en').teammate.ask;
const FIRST_MS = 5_000;
const RETRY_MS = 60_000;
const RUN_MAX_MS = 120_000;
const GAP_MS = roamDelayMs(15, 0.5);

const text = (r: { content: unknown[] }): string => (r.content[0] as { text?: string } | undefined)?.text ?? '';

const agent = (over: Partial<AgentProfile> = {}): AgentProfile => ({
  id: 'cp', kind: 'agent', name: 'Copilot CLI', tagColor: 1, tagColorCustom: null, preset: 'copilot', command: 'copilot',
  customArgs: [], folder: { kind: 'fixed', path: 'C:\\code\\lolPing' }, timeoutS: 300, ...over,
});

interface Started {
  profile: AgentProfile;
  spec: AgentRunSpec;
  cwd: string;
  kills: number;
  token: string;
  exit(r?: Partial<AgentResult>): void;
}

interface Timer {
  ms: number;
  fn: () => void;
  live: boolean;
}

interface Options {
  profiles?: Profile[];
  startThrows?: AgentStartError;
  bridgeDown?: boolean;
  lang?: 'en' | 'zh-CN';
}

function harness(opts: Options = {}) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    teammate: { ...DEFAULT_TEAMMATE, profiles: opts.profiles ?? [agent()], defaultProfile: 'cp', petRoam: false },
  };
  const driven: Array<{ cmd: PetCommand; from: string }> = [];
  const started: Started[] = [];
  const timers: Timer[] = [];
  const made: string[] = [];
  const removed: string[] = [];
  const state = { showing: true, enabled: true, busy: false };

  const roam = new PetRoam({
    settings: () => settings,
    enabled: () => state.enabled,
    busy: () => state.busy,
    lang: () => opts.lang ?? 'en',
    now: () => new Date(2026, 0, 1, 9),
    pet: {
      drive: (cmd, from): PetDriveResult => {
        driven.push({ cmd, from });
        return cmd.kind === 'status' && !state.showing ? { ok: false, text: 'No desktop pet is showing.' } : { ok: true, text: 'done' };
      },
    },
    runner: {
      start: async (profile, spec, cwd): Promise<AgentRun> => {
        if (opts.startThrows) throw opts.startThrows;
        let resolve: (r: AgentResult) => void = () => undefined;
        const done = new Promise<AgentResult>((r) => { resolve = r; });
        const s: Started = {
          profile, spec, cwd, kills: 0, token: spec.bridge.env.LOLPING_ASK ?? '',
          exit: (r = {}) => resolve({ code: 0, session: null, error: null, tail: '', ...r }),
        };
        started.push(s);
        return { done, session: () => null, kill: () => { s.kills += 1; resolve({ code: null, session: null, error: null, tail: '' }); } };
      },
    },
    bridge: (ask) => (opts.bridgeDown ? null : { command: 'lolPing.exe', args: ['bridge.js'], env: { LOLPING_ASK: ask } }),
    env: async () => ({ PATH: 'C:\\bin' }),
    tempDir: () => 'C:\\tmp\\lolping-teammate',
    files: {
      makeDir: async (p) => { made.push(p); },
      removeDir: async (p) => { removed.push(p); },
    },
    after: (ms, fn) => {
      const t: Timer = { ms, fn, live: true };
      timers.push(t);
      return () => { t.live = false; };
    },
    random: () => 0.5,
  });

  /** The timers waiting to fire, apart from a visit's own time limit. */
  const pending = () => timers.filter((t) => t.live && t.ms !== RUN_MAX_MS);
  const fire = (t: Timer | undefined): void => {
    if (!t) throw new Error('no timer');
    t.live = false;
    t.fn();
  };
  /** Roaming is off when lolPing starts, then the user turns it on. */
  const turnOn = (min?: number): void => {
    roam.sync();
    settings.teammate.petRoam = true;
    if (min !== undefined) settings.teammate.petRoamMin = min;
    roam.sync();
  };
  const turnOff = (): void => {
    settings.teammate.petRoam = false;
    roam.sync();
  };
  /** Fires the next visit and waits until the agent is started. */
  const visit = async (n: number): Promise<Started> => {
    fire(pending().at(-1));
    await vi.waitFor(() => expect(started).toHaveLength(n));
    return started[n - 1];
  };
  const said = () => driven.filter((d) => d.cmd.kind === 'say').map((d) => (d.cmd as { text: string }).text);
  const settle = () => vi.waitFor(() => expect(pending()).toHaveLength(1));
  return { roam, settings, driven, started, timers, made, removed, state, pending, fire, turnOn, turnOff, visit, said, settle };
}

describe('PetRoam schedule', () => {
  it('does nothing while roaming is off', () => {
    const h = harness();
    h.roam.sync();
    expect(h.pending()).toEqual([]);
  });

  it('makes the first visit five seconds after roaming is turned on', () => {
    const h = harness();
    h.turnOn();
    expect(h.pending().map((t) => t.ms)).toEqual([FIRST_MS]);
  });

  it('waits a whole gap when roaming is already on as lolPing starts', () => {
    const h = harness();
    h.settings.teammate.petRoam = true;
    h.roam.sync();
    expect(h.pending().map((t) => t.ms)).toEqual([GAP_MS]);
  });

  it('stops the schedule when roaming is turned off', () => {
    const h = harness();
    h.turnOn();
    h.turnOff();
    expect(h.pending()).toEqual([]);
  });

  it('follows a change of the gap', () => {
    const h = harness();
    h.turnOn();
    h.settings.teammate.petRoamMin = 60;
    h.roam.sync();
    expect(h.pending().map((t) => t.ms)).toEqual([roamDelayMs(60, 0.5)]);
  });

  it('schedules the next visit a gap after one ends', async () => {
    const h = harness();
    h.turnOn();
    const run = await h.visit(1);
    await h.roam.call(run.token, 'pet_say', { text: 'hi' });
    run.exit();
    await h.settle();
    expect(h.pending().map((t) => t.ms)).toEqual([GAP_MS]);
  });

  it('looks again in a minute while paused or while an ask is running, and starts nothing', async () => {
    const h = harness();
    h.turnOn();
    h.state.enabled = false;
    fireNext(h);
    await vi.waitFor(() => expect(h.pending().map((t) => t.ms)).toEqual([RETRY_MS]));
    h.state.enabled = true;
    h.state.busy = true;
    fireNext(h);
    await vi.waitFor(() => expect(h.pending().map((t) => t.ms)).toEqual([RETRY_MS]));
    expect(h.started).toEqual([]);
  });

  it('starts nothing while no pet is showing, to save the agent\'s quota', async () => {
    const h = harness();
    h.state.showing = false;
    h.turnOn();
    fireNext(h);
    await h.settle();
    expect(h.started).toEqual([]);
    expect(h.said()).toEqual([]);
    expect(h.pending().map((t) => t.ms)).toEqual([GAP_MS]);
  });
});

function fireNext(h: ReturnType<typeof harness>): void {
  h.fire(h.pending().at(-1));
}

describe('PetRoam visit', () => {
  it('starts the default agent headless in a folder of its own, with a token of its own', async () => {
    const h = harness({ profiles: [agent({ id: 'other', name: 'Other' }), agent()] });
    h.turnOn();
    const run = await h.visit(1);
    expect(run.profile.id).toBe('cp');
    expect(run.token).toMatch(/^roam-1\.[0-9a-f]{32}$/);
    expect(run.cwd).toBe('C:\\tmp\\lolping-teammate\\roam-1');
    expect(h.made).toEqual([run.cwd]);
    expect(run.spec.askDir).toBe(run.cwd);
    expect(run.spec.mcpConfigPath).toBe('C:\\tmp\\lolping-teammate\\roam-1\\mcp.json');
    expect(run.spec.prompt).toContain('pet_status');
    expect(run.spec.prompt).toContain('one short sentence in English');
    expect(run.spec.prompt).toContain('It is morning');
  });

  it('asks for the user\'s language and writes a yml config for dsh', async () => {
    const h = harness({ profiles: [agent({ preset: 'dsh', command: 'dsh' })], lang: 'zh-CN' });
    h.turnOn();
    const run = await h.visit(1);
    expect(run.spec.prompt).toContain('one short sentence in Simplified Chinese');
    expect(run.spec.mcpConfigPath).toMatch(/mcp\.yml$/);
  });

  it('gives its pet tools only to the visit\'s token, and only while the visit runs', async () => {
    const h = harness();
    h.turnOn();
    expect(h.roam.tools('roam-1.' + '0'.repeat(32))).toBeNull();
    const run = await h.visit(1);
    expect(h.roam.tools(run.token)?.map((d) => d.name)).toEqual(['pet_status', 'pet_say', 'pet_walk', 'pet_play']);
    expect(h.roam.tools(run.token.replace('roam-1', 'roam-2'))).toBeNull();
    expect((await h.roam.call('roam-1.' + 'f'.repeat(32), 'pet_say', { text: 'hi' })).isError).toBe(true);
    run.exit();
    await h.settle();
    expect(h.roam.tools(run.token)).toBeNull();
    expect((await h.roam.call(run.token, 'pet_say', { text: 'hi' })).isError).toBe(true);
  });

  it('drives the pets under the agent\'s name, and refuses a tool that is no pet tool', async () => {
    const h = harness();
    h.turnOn();
    const run = await h.visit(1);
    const said = await h.roam.call(run.token, 'pet_say', { text: 'Good morning!' });
    expect(said).toEqual({ content: [{ text: 'done' }], isError: false });
    expect(h.driven.at(-1)).toEqual({ cmd: { kind: 'say', pet: null, text: 'Good morning!', mood: null }, from: 'Copilot CLI' });
    expect((await h.roam.call(run.token, 'remember', {})).isError).toBe(true);
    expect((await h.roam.call(run.token, 'pet_say', { text: '' })).isError).toBe(true);
  });

  it('refuses every call after the cap, the invalid ones counted too', async () => {
    const h = harness();
    h.turnOn();
    const run = await h.visit(1);
    for (let i = 0; i < ROAM_CALLS_MAX; i += 1) {
      expect(text(await h.roam.call(run.token, 'pet_say', i % 2 ? {} : { text: 'hi' }))).not.toMatch(/enough/);
    }
    const r = await h.roam.call(run.token, 'pet_say', { text: 'more' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/enough/);
    expect(h.driven.filter((d) => d.cmd.kind === 'say')).toHaveLength(ROAM_CALLS_MAX / 2);
  });

  it('refuses while lolPing is paused, and once roaming is off', async () => {
    const h = harness();
    h.turnOn();
    const run = await h.visit(1);
    h.state.enabled = false;
    expect(text(await h.roam.call(run.token, 'pet_say', { text: 'hi' }))).toBe('lolPing is paused.');
    h.state.enabled = true;
    h.settings.teammate.petRoam = false;
    expect((await h.roam.call(run.token, 'pet_say', { text: 'hi' })).isError).toBe(true);
    expect(h.said()).toEqual([]);
  });

  it('removes the folder when the visit ends, and stops an agent that runs too long', async () => {
    const h = harness();
    h.turnOn();
    const run = await h.visit(1);
    h.fire(h.timers.find((t) => t.live && t.ms === RUN_MAX_MS));
    await vi.waitFor(() => expect(h.removed).toEqual([run.cwd]));
    expect(run.kills).toBe(1);
  });

  it('numbers each visit, so folders and tokens are never reused', async () => {
    const h = harness();
    h.turnOn();
    const first = await h.visit(1);
    await h.roam.call(first.token, 'pet_say', { text: 'hi' });
    first.exit();
    await h.settle();
    const second = await h.visit(2);
    expect(second.token).toMatch(/^roam-2\./);
    expect(second.cwd).toMatch(/roam-2$/);
    expect(h.roam.tools(first.token)).toBeNull();
  });

  it('is not a failure when roaming is turned off mid-visit, and the pets stay quiet', async () => {
    const h = harness();
    h.turnOn();
    const run = await h.visit(1);
    h.turnOff();
    expect(run.kills).toBe(1);
    await vi.waitFor(() => expect(h.removed).toEqual([run.cwd]));
    expect(h.said()).toEqual([]);
    expect(h.pending()).toEqual([]);
    h.turnOn();
    expect(h.pending().map((t) => t.ms)).toEqual([FIRST_MS]);
  });

  it('is not a failure when roaming is turned off and on again mid-visit', async () => {
    const h = harness();
    h.turnOn();
    const run = await h.visit(1);
    h.turnOff();
    h.turnOn();
    await vi.waitFor(() => expect(h.removed).toEqual([run.cwd]));
    await h.settle();
    expect(h.said()).toEqual([]);
  });
});

describe('PetRoam failures', () => {
  it('says once that the agent did not connect, when it ended without a pet call', async () => {
    const h = harness();
    h.turnOn();
    (await h.visit(1)).exit();
    await h.settle();
    expect(h.said()).toEqual([words.agent.notConnected('Copilot CLI')]);
    (await h.visit(2)).exit({ code: 1, error: 'boom' });
    await vi.waitFor(() => expect(h.removed).toHaveLength(2));
    expect(h.said()).toHaveLength(1);
  });

  it('says what the agent reported when it failed the first time', async () => {
    const h = harness();
    h.turnOn();
    (await h.visit(1)).exit({ code: 1, error: 'Not signed in' });
    await h.settle();
    expect(h.said()).toEqual([words.agent.error('Copilot CLI', 'Not signed in')]);
  });

  it('says it stopped when it ended with a code and nothing to say', async () => {
    const h = harness();
    h.turnOn();
    (await h.visit(1)).exit({ code: 2 });
    await h.settle();
    expect(h.said()).toEqual([words.agent.stopped('Copilot CLI')]);
  });

  it('stops roaming after three visits in a row that did nothing, until it is turned off and on', async () => {
    const h = harness();
    h.turnOn();
    for (let n = 1; n <= 3; n += 1) {
      (await h.visit(n)).exit();
      await vi.waitFor(() => expect(h.removed).toHaveLength(n));
    }
    expect(h.pending()).toEqual([]);
    h.settings.teammate.petRoamMin = 30;
    h.roam.sync();
    expect(h.pending()).toEqual([]);
    h.turnOff();
    h.turnOn();
    expect(h.pending().map((t) => t.ms)).toEqual([FIRST_MS]);
  });

  it('counts a visit with a pet call as a success, and the count starts again', async () => {
    const h = harness();
    h.turnOn();
    for (let n = 1; n <= 2; n += 1) {
      (await h.visit(n)).exit();
      await vi.waitFor(() => expect(h.removed).toHaveLength(n));
    }
    const good = await h.visit(3);
    await h.roam.call(good.token, 'pet_say', { text: 'hi' });
    good.exit();
    await vi.waitFor(() => expect(h.removed).toHaveLength(3));
    (await h.visit(4)).exit();
    await h.settle();
    expect(h.pending().map((t) => t.ms)).toEqual([GAP_MS]);
  });

  it('has the pets ask for an agent when there is none, and waits', async () => {
    const h = harness({ profiles: [] });
    h.turnOn();
    fireNext(h);
    await vi.waitFor(() => expect(h.said()).toEqual([words.roamNoAgent]));
    expect(h.started).toEqual([]);
    expect(h.pending()).toEqual([]);
  });

  it('gives up when the agent can not be found', async () => {
    const h = harness({ startThrows: new AgentStartError('notFound', 'nope') });
    h.turnOn();
    fireNext(h);
    await vi.waitFor(() => expect(h.said()).toEqual([words.agent.notFound('copilot')]));
    await vi.waitFor(() => expect(h.removed).toHaveLength(1));
    expect(h.pending()).toEqual([]);
  });

  it('tries again later when the agent could not be run this time', async () => {
    const h = harness({ startThrows: new AgentStartError('spawn', 'EACCES') });
    h.turnOn();
    fireNext(h);
    await h.settle();
    expect(h.said()).toEqual([words.agent.noStart('copilot')]);
    expect(h.pending().map((t) => t.ms)).toEqual([GAP_MS]);
  });

  it('says when lolPing\'s agent connection is down', async () => {
    const h = harness({ bridgeDown: true });
    h.turnOn();
    fireNext(h);
    await h.settle();
    expect(h.said()).toEqual([words.agent.noBridge]);
    expect(h.started).toEqual([]);
  });
});

describe('bridgeHandler with roaming', () => {
  const never = new AbortController().signal;
  const ask = 'ask-1.' + '0'.repeat(32);
  const client = { name: 'copilot', version: '1' };
  const ctl = {
    agentTools: (a: string) => (a === ask ? [{ name: 'say', description: '', parameters: {} }] : null),
    agentCall: async () => ({ content: [{ text: 'ask' }], isError: false }),
    visitorTools: () => [],
    visitorCall: async () => ({ content: [{ text: 'visitor' }], isError: false }),
  };

  it('serves a visit\'s pet tools through its token, and an ask\'s tools as before', async () => {
    const h = harness();
    h.turnOn();
    const run = await h.visit(1);
    const handler = bridgeHandler(ctl, h.roam);
    expect(handler.list({ ask: run.token, client }).map((d) => d.name)).toEqual(['pet_status', 'pet_say', 'pet_walk', 'pet_play']);
    expect((await handler.call({ ask: run.token, client }, 'pet_say', { text: 'hi' }, never)).content).toEqual([{ text: 'done' }]);
    expect(handler.list({ ask, client }).map((d) => d.name)).toEqual(['say']);
    expect((await handler.call({ ask, client }, 'say', {}, never)).content).toEqual([{ text: 'ask' }]);
  });

  it('keeps an unknown token out of both', async () => {
    const h = harness();
    const handler = bridgeHandler(ctl, h.roam);
    const stray = { ask: 'roam-9.' + 'a'.repeat(32), client };
    expect(handler.list(stray)).toEqual([]);
  });
});
