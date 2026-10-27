import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { strings, type Lang } from '../../shared/i18n';
import type { Settings } from '../../shared/settings';
import type { AgentRunSpec } from '../../shared/teammate/agents';
import type { BridgeContent } from '../../shared/teammate/bridgeProtocol';
import { isPetTool, parsePetCall, petToolDefs } from '../../shared/teammate/petControl';
import { ROAM_CALLS_MAX, ROAM_IDEAS, pickRoamAgent, roamDelayMs, roamPrompt } from '../../shared/teammate/petRoam';
import type { ToolDef } from '../../shared/teammate/tools';
import { AgentStartError, type AgentResult, type AgentRun, type AgentRunner } from './agents/runner';
import type { PetWindows } from './petWindows';

const TOKEN_BYTES = 16;
/** The first visit comes this long after roaming is turned on, so the user sees it work. */
const FIRST_MS = 5_000;
/** Paused, or an ask is on screen: look again in a minute. */
const RETRY_MS = 60_000;
/** A visit that has not ended by now is stopped. */
const RUN_MAX_MS = 120_000;
/** A visit that fails this many times in a row ends roaming until the user turns it off and on. */
const FAILS_MAX = 3;
const FAIL_LINE_MAX = 120;
const FROM = 'lolPing';

const NOT_AVAILABLE: BridgeContent[] = [{ text: 'Not available.' }];
const PAUSED: BridgeContent[] = [{ text: 'lolPing is paused.' }];
const INVALID: BridgeContent[] = [{ text: 'Ignored: the arguments were not valid.' }];
const ENOUGH: BridgeContent[] = [{ text: 'That is enough for this visit. Stop now.' }];

type Result = { content: BridgeContent[]; isError: boolean };

export interface PetRoamDeps {
  settings: () => Settings;
  /** False while lolPing is paused or the teammate is going down. */
  enabled: () => boolean;
  /** An ask is running: the pets are with it. */
  busy: () => boolean;
  lang: () => Lang;
  now: () => Date;
  pet: Pick<PetWindows, 'drive'>;
  runner: Pick<AgentRunner, 'start'>;
  /** How the agent starts the bridge for token `ask`; null while lolPing's end of it isn't listening. */
  bridge: (ask: string) => AgentRunSpec['bridge'] | null;
  /** lolPing's environment with the user's PATH, for the agent. */
  env: () => Promise<NodeJS.ProcessEnv>;
  /** The folder a visit's own folder goes in; the agent runs in that folder, which is empty. */
  tempDir: () => string;
  files: { makeDir(path: string): Promise<void>; removeDir(path: string): Promise<void> };
  /** Calls `fn` after `ms`; the result cancels it. */
  after: (ms: number, fn: () => void) => () => void;
  random: () => number;
}

interface Visit {
  token: string;
  /** Tool calls made so far, the invalid ones too. */
  calls: number;
  /** The agent's name, as the pets' bubble says who is talking. */
  from: string;
  /** Roaming was turned off while it ran. */
  stopped: boolean;
  run: AgentRun | null;
}

/**
 * Pets that roam on their own: every so often it starts the user's coding agent headless with a short prompt and a
 * token of its own, and the agent calls the pet tools through lolPing's bridge. The token is the only way to them,
 * so the visit needs no switch for agents the user runs elsewhere, and it ends when the agent does.
 */
export class PetRoam {
  private cancel: (() => void) | null = null;
  private visit: Visit | null = null;
  private seq = 0;
  private fails = 0;
  private on = false;
  private everyMin = 0;
  /** Roaming is off and then on again: the first visit comes soon. Already on when lolPing starts: it waits a full gap. */
  private synced = false;
  /** Roaming gave up (no agent, not found, too many failures); it starts again when the user turns it off and on. */
  private suspended = false;

  constructor(private readonly deps: PetRoamDeps) {}

  /** Follows the settings: starts the visits when roaming is turned on, stops them when it is turned off. */
  sync(): void {
    const t = this.deps.settings().teammate;
    const first = !this.synced;
    this.synced = true;
    if (!t.petRoam) {
      this.stop();
      this.suspended = false;
      this.fails = 0;
      return;
    }
    if (this.suspended) return;
    if (this.on && this.everyMin === t.petRoamMin) return;
    const starting = !this.on;
    this.on = true;
    this.everyMin = t.petRoamMin;
    const wait = starting && !first ? FIRST_MS : roamDelayMs(this.everyMin, this.deps.random());
    if (this.visit === null) this.schedule(wait);
  }

  /** Stops the schedule and a visit under way. */
  stop(): void {
    this.on = false;
    this.cancel?.();
    this.cancel = null;
    if (this.visit) this.visit.stopped = true;
    this.visit?.run?.kill();
  }

  /** The tools of the visit with token `ask`; null when that is no visit. */
  tools(ask: string): ToolDef[] | null {
    return this.visit?.token === ask ? petToolDefs() : null;
  }

  async call(ask: string, name: string, args: unknown): Promise<Result> {
    const visit = this.visit;
    if (visit?.token !== ask || !isPetTool(name)) return { content: NOT_AVAILABLE, isError: true };
    if (!this.deps.enabled() || !this.deps.settings().teammate.petRoam) return { content: PAUSED, isError: true };
    if (visit.calls >= ROAM_CALLS_MAX) return { content: ENOUGH, isError: true };
    visit.calls += 1;
    const cmd = parsePetCall(name, args);
    if (!cmd) return { content: INVALID, isError: true };
    const done = this.deps.pet.drive(cmd, visit.from);
    return { content: [{ text: done.text }], isError: !done.ok };
  }

  private schedule(ms: number): void {
    this.cancel?.();
    this.cancel = this.deps.after(ms, () => {
      this.cancel = null;
      this.tick().catch((err: unknown) => console.warn('[teammate] pet roam:', err));
    });
  }

  private async tick(): Promise<void> {
    const t = this.deps.settings().teammate;
    if (!this.on || !t.petRoam) return;
    this.everyMin = t.petRoamMin;
    if (!this.deps.enabled() || this.deps.busy()) return this.schedule(RETRY_MS);
    try {
      await this.go();
    } catch (err) {
      console.warn('[teammate] pet roam:', err);
      this.failed(null);
    }
    if (this.on && !this.suspended) this.schedule(roamDelayMs(this.everyMin, this.deps.random()));
  }

  /** One visit. Nothing is started while no pet is showing: it would spend the agent's quota for nothing. */
  private async go(): Promise<void> {
    const { deps } = this;
    if (!deps.pet.drive({ kind: 'status' }, FROM).ok) return;
    const t = deps.settings().teammate;
    const words = strings(deps.lang()).teammate.ask;
    const profile = pickRoamAgent(t.profiles, t.defaultProfile);
    if (!profile) return this.giveUp(words.roamNoAgent);
    const token = `roam-${++this.seq}.${randomBytes(TOKEN_BYTES).toString('hex')}`;
    const bridge = deps.bridge(token);
    if (!bridge) return this.failed(words.agent.noBridge);
    const dir = join(deps.tempDir(), `roam-${this.seq}`);
    await deps.files.makeDir(dir);
    const visit: Visit = { token, calls: 0, from: profile.name, stopped: false, run: null };
    this.visit = visit;
    try {
      const spec: AgentRunSpec = {
        prompt: roamPrompt({
          language: deps.lang() === 'zh-CN' ? 'Simplified Chinese' : 'English',
          hour: deps.now().getHours(),
          idea: Math.floor(deps.random() * ROAM_IDEAS.length),
        }),
        askDir: dir, bridge, resume: null,
        mcpConfigPath: join(dir, profile.preset === 'dsh' ? 'mcp.yml' : 'mcp.json'),
      };
      const env = await deps.env();
      let result: AgentResult;
      let limit: (() => void) | null = null;
      try {
        visit.run = await deps.runner.start(profile, spec, dir, env);
        if (visit.stopped) visit.run.kill();
        limit = deps.after(RUN_MAX_MS, () => visit.run?.kill());
        result = await visit.run.done;
      } catch (err) {
        if (!(err instanceof AgentStartError)) throw err;
        const line = err.kind === 'notFound' ? words.agent.notFound(profile.command) : words.agent.noStart(profile.command);
        return err.kind === 'spawn' ? this.failed(line) : this.giveUp(line);
      } finally {
        limit?.();
      }
      if (visit.stopped) return; // the user turned roaming off while it ran: that is not a failure
      if (visit.calls > 0) {
        this.fails = 0;
        return;
      }
      console.warn('[teammate] pet roam: the agent made no pet call', result.code, result.error, result.tail.slice(-300));
      const error = result.error?.trim().slice(0, FAIL_LINE_MAX) ?? '';
      if (result.code === 0) return this.failed(words.agent.notConnected(profile.name));
      this.failed(error ? words.agent.error(profile.name, error) : words.agent.stopped(profile.name));
    } finally {
      if (this.visit === visit) this.visit = null;
      deps.files.removeDir(dir).catch(() => undefined);
    }
  }

  /** A visit that did nothing: the pets say so once, and after FAILS_MAX in a row roaming stops. */
  private failed(line: string | null): void {
    this.fails += 1;
    if (this.fails === 1 && line) this.tell(line);
    if (this.fails >= FAILS_MAX) this.suspended = true;
  }

  /** Roaming can't work as it is set up: the pets say why, and it waits for the user to turn it off and on. */
  private giveUp(line: string): void {
    this.tell(line);
    this.suspended = true;
  }

  private tell(text: string): void {
    this.deps.pet.drive({ kind: 'say', pet: null, text, mood: null }, FROM);
  }
}
