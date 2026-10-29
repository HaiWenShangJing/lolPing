import { parseHostModels, type HostModel } from '../../../shared/teammate/petHost';
import { AcpClient, type AcpProcess } from './client';

const INIT_MS = 20_000;
const NEW_SESSION_MS = 30_000;

export type OpenAcp = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<AcpProcess>;
export type After = (ms: number, fn: () => void) => () => void;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * What lolPing says to anything the agent asks the client for: a permission is always refused (the pet tools are
 * allowed by flag, so a request means the agent wants something else), and nothing else is offered.
 */
export function refuseAll(method: string, params: unknown): unknown {
  if (method !== 'session/request_permission') throw new Error(`${method} is not supported.`);
  const options = isRecord(params) && Array.isArray(params.options) ? params.options : [];
  const refuse = options.find((o) => isRecord(o) && typeof o.kind === 'string' && o.kind.startsWith('reject')
    && typeof o.optionId === 'string');
  return refuse && isRecord(refuse) ? { outcome: { outcome: 'selected', optionId: refuse.optionId } } : { outcome: { outcome: 'cancelled' } };
}

export interface AcpSession {
  client: AcpClient;
  sessionId: string;
  models: HostModel[];
  /** The agent's last words on stderr, for when it fails. */
  stderr: () => string;
}

export interface AcpStart {
  open: OpenAcp;
  after: After;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  version: string;
}

/** Starts the agent and a session in it (no MCP servers of the client's: the agent reads its own from its flags). */
export async function startAcpSession(o: AcpStart): Promise<AcpSession> {
  const proc = await o.open(o.command, o.args, o.cwd, o.env);
  const client = new AcpClient(proc, o.after, { request: refuseAll });
  const stderr = (): string => proc.stderr?.() ?? '';
  try {
    await client.request('initialize', {
      protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'lolPing', version: o.version },
    }, INIT_MS);
    const made = await client.request<unknown>('session/new', { cwd: o.cwd, mcpServers: [] }, NEW_SESSION_MS);
    const id = isRecord(made) ? made.sessionId : null;
    if (typeof id !== 'string' || id === '') throw new Error('The agent gave no session.');
    return { client, sessionId: id, models: parseHostModels(made), stderr };
  } catch (err) {
    client.close();
    throw err;
  }
}

/** The models Copilot CLI offers this user: a session is opened for the list alone and closed, and no prompt is sent. */
export async function listHostModels(o: Omit<AcpStart, 'args'>): Promise<HostModel[]> {
  const args = ['--acp', '--disable-builtin-mcps', '--no-custom-instructions', '--no-ask-user', '--no-auto-update'];
  const session = await startAcpSession({ ...o, args });
  session.client.close();
  return session.models;
}
