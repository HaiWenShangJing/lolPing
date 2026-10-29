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
  /** Called with each piece of text the agent says in a session (a reply is the pieces of one prompt, in order). */
  onText?: (sessionId: string, text: string) => void;
}

/** The text of an `agent_message_chunk` update, with the session it is for; null for any other message. */
export function messageText(method: string, params: unknown): { sessionId: string; text: string } | null {
  if (method !== 'session/update' || !isRecord(params) || typeof params.sessionId !== 'string') return null;
  const u = params.update;
  if (!isRecord(u) || u.sessionUpdate !== 'agent_message_chunk' || !isRecord(u.content)) return null;
  return u.content.type === 'text' && typeof u.content.text === 'string' ? { sessionId: params.sessionId, text: u.content.text } : null;
}

/** Starts the agent and a session in it (no MCP servers of the client's: the agent reads its own from its flags). */
export async function startAcpSession(o: AcpStart): Promise<AcpSession> {
  const proc = await o.open(o.command, o.args, o.cwd, o.env);
  const onText = o.onText;
  const client = new AcpClient(proc, o.after, {
    request: refuseAll,
    ...(onText ? {
      notification: (method: string, params: unknown) => {
        const m = messageText(method, params);
        if (m) onText(m.sessionId, m.text);
      },
    } : {}),
  });
  const stderr = (): string => proc.stderr?.() ?? '';
  try {
    await client.request('initialize', {
      protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'lolPing', version: o.version },
    }, INIT_MS);
    const made = await openSession(client, o.cwd);
    return { client, sessionId: made.id, models: made.models, stderr };
  } catch (err) {
    client.close();
    throw err;
  }
}

/** Opens one more session in the agent. */
export async function newAcpSession(client: AcpClient, cwd: string): Promise<string> {
  return (await openSession(client, cwd)).id;
}

async function openSession(client: AcpClient, cwd: string): Promise<{ id: string; models: HostModel[] }> {
  const made = await client.request<unknown>('session/new', { cwd, mcpServers: [] }, NEW_SESSION_MS);
  const id = isRecord(made) ? made.sessionId : null;
  if (typeof id !== 'string' || id === '') throw new Error('The agent gave no session.');
  return { id, models: parseHostModels(made) };
}

/** The models Copilot CLI offers this user: a session is opened for the list alone and closed, and no prompt is sent. */
export async function listHostModels(o: Omit<AcpStart, 'args'>): Promise<HostModel[]> {
  const args = ['--acp', '--disable-builtin-mcps', '--no-custom-instructions', '--no-ask-user', '--no-auto-update'];
  const session = await startAcpSession({ ...o, args });
  session.client.close();
  return session.models;
}
