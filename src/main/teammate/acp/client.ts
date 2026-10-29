/**
 * A client of the Agent Client Protocol: JSON-RPC 2.0 over an agent's stdin and stdout, one message per line. lolPing
 * is the client and Copilot CLI the agent; the agent sends updates while it works and may ask the client for things.
 */

export interface AcpProcess {
  send(line: string): void;
  onLine(cb: (line: string) => void): void;
  /** Called once, when the agent's process has ended. */
  onClose(cb: (code: number | null) => void): void;
  kill(): void;
  /** The last of what the agent wrote on stderr, for the line that says why it failed. */
  stderr?(): string;
}

/** The agent answered a request with an error. */
export class AcpError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'AcpError';
  }
}

export interface AcpHandlers {
  /** What the agent asks of the client; a throw becomes an error reply, and no handler a "method not found". */
  request?(method: string, params: unknown): unknown;
  notification?(method: string, params: unknown): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cancelTimer: (() => void) | null;
}

const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class AcpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private ended = false;
  private readonly closers: (() => void)[] = [];

  /** `after(ms, fn)` runs `fn` later and returns the way to cancel it. */
  constructor(
    private readonly proc: AcpProcess,
    private readonly after: (ms: number, fn: () => void) => () => void,
    private readonly handlers: AcpHandlers = {},
  ) {
    proc.onLine((line) => this.read(line));
    proc.onClose(() => this.end(new Error('The agent ended.')));
  }

  get closed(): boolean {
    return this.ended;
  }

  /** Calls `cb` once the agent is gone, whoever ended it. */
  onClose(cb: () => void): void {
    if (this.ended) cb();
    else this.closers.push(cb);
  }

  /** `timeoutMs` 0 waits for as long as the agent lives. */
  request<T = unknown>(method: string, params: unknown, timeoutMs = 0): Promise<T> {
    if (this.ended) return Promise.reject(new Error('The agent ended.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = {
        resolve: (v) => resolve(v as T),
        reject,
        cancelTimer: timeoutMs > 0
          ? this.after(timeoutMs, () => {
            this.pending.delete(id);
            reject(new Error(`${method} timed out.`));
          })
          : null,
      };
      this.pending.set(id, entry);
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.ended) this.write({ jsonrpc: '2.0', method, params });
  }

  /** Ends the agent's process; whatever was waiting for it fails. */
  close(): void {
    if (this.ended) return;
    this.end(new Error('The agent was stopped.'));
    this.proc.kill();
  }

  private write(message: Record<string, unknown>): void {
    this.proc.send(JSON.stringify(message));
  }

  private end(reason: Error): void {
    if (this.ended) return;
    this.ended = true;
    for (const p of this.pending.values()) {
      p.cancelTimer?.();
      p.reject(reason);
    }
    this.pending.clear();
    for (const cb of this.closers.splice(0)) cb();
  }

  private read(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // anything that isn't a message (a log line on stdout) is not the protocol's
    }
    if (!isRecord(msg)) return;
    const { id, method } = msg;
    if (typeof method === 'string') {
      if (typeof id === 'number' || typeof id === 'string') this.answer(id, method, msg.params);
      else this.handlers.notification?.(method, msg.params);
      return;
    }
    if (typeof id !== 'number') return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.cancelTimer?.();
    if (isRecord(msg.error)) {
      entry.reject(new AcpError(typeof msg.error.code === 'number' ? msg.error.code : INTERNAL_ERROR,
        typeof msg.error.message === 'string' ? msg.error.message : 'The agent reported an error.'));
    } else entry.resolve(msg.result);
  }

  private answer(id: number | string, method: string, params: unknown): void {
    const handler = this.handlers.request;
    if (!handler) {
      this.write({ jsonrpc: '2.0', id, error: { code: METHOD_NOT_FOUND, message: `${method} is not supported.` } });
      return;
    }
    try {
      this.write({ jsonrpc: '2.0', id, result: handler(method, params) ?? null });
    } catch (err) {
      this.write({ jsonrpc: '2.0', id, error: { code: INTERNAL_ERROR, message: err instanceof Error ? err.message : 'failed' } });
    }
  }
}
