import { gameArgs, replyText } from '../../shared/teammate/gameBrain';
import type { AcpSession, After } from './acp/session';
import { newAcpSession } from './acp/session';

/** A mind that has not answered by now is cancelled and the player plays by its own simple rules. */
export const ASK_MS = 30_000;
/** After a cancel the agent has this long to end the turn before its process is stopped. */
const CANCEL_GRACE_MS = 8_000;

export interface BrainDeps {
  /** Starts Copilot CLI with these arguments; `onText` hears every piece of text it says in any session. */
  start: (
    command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, onText: (sessionId: string, text: string) => void,
  ) => Promise<AcpSession>;
  command: string;
  model: string | null;
  cwd: string;
  env: () => Promise<NodeJS.ProcessEnv>;
  after: After;
}

/**
 * The minds of a game's computer players: one Copilot CLI process, with a session for each seat so that what one player
 * is told never reaches another. A mind that cannot start, is slow or fails answers null, and the game goes on without it.
 */
export class GameBrain {
  private agent: Promise<AcpSession | null> | null = null;
  private readonly sessions = new Map<number, Promise<string | null>>();
  private readonly text = new Map<string, string>();
  private closed = false;

  constructor(private readonly deps: BrainDeps) {}

  /** Starts the agent now, so the first question does not wait for it. */
  warm(): void {
    void this.boot();
  }

  /** Sends `prompt` to the mind of `seat` and returns what it said, or null. */
  async ask(seat: number, prompt: string): Promise<string | null> {
    const agent = await this.boot();
    if (!agent || agent.client.closed || this.closed) return null;
    const id = await this.session(agent, seat);
    if (id === null) return null;
    this.text.set(id, '');
    let timedOut = false;
    const stops: (() => void)[] = [];
    const cancel = (): void => {
      timedOut = true;
      agent.client.notify('session/cancel', { sessionId: id });
      stops.push(this.deps.after(CANCEL_GRACE_MS, () => agent.client.close()));
    };
    stops.push(this.deps.after(ASK_MS, cancel));
    try {
      await agent.client.request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: prompt }] });
    } catch {
      return null;
    } finally {
      for (const stop of stops) stop();
    }
    const said = timedOut ? null : replyText(this.text.get(id) ?? '');
    this.text.delete(id);
    return said;
  }

  close(): void {
    this.closed = true;
    void this.agent?.then((a) => a?.client.close());
  }

  private boot(): Promise<AcpSession | null> {
    this.agent ??= (async (): Promise<AcpSession | null> => {
      try {
        const d = this.deps;
        return await d.start(d.command, gameArgs(d.model), d.cwd, await d.env(), (id, t) => {
          this.text.set(id, (this.text.get(id) ?? '') + t);
        });
      } catch {
        return null;
      }
    })();
    return this.agent;
  }

  private session(agent: AcpSession, seat: number): Promise<string | null> {
    let made = this.sessions.get(seat);
    if (!made) {
      // The session the agent was started with is the first seat's; each other seat opens its own.
      made = this.sessions.size === 0 ? Promise.resolve(agent.sessionId) : newAcpSession(agent.client, this.deps.cwd).catch(() => null);
      this.sessions.set(seat, made);
    }
    return made;
  }
}
