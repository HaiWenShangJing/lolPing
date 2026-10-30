import { describe, expect, it, vi } from 'vitest';
import { AcpClient } from '../../../src/main/teammate/acp/client';
import { messageText } from '../../../src/main/teammate/acp/session';
import { GameBrain, type BrainDeps } from '../../../src/main/teammate/gameBrain';
import { clock, fake } from './acp/fakes';

const chunk = (sessionId: string, text: string) => ({
  jsonrpc: '2.0', method: 'session/update',
  params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } },
});

function brain(over: Partial<BrainDeps> = {}) {
  const f = fake();
  const k = clock();
  const started: unknown[] = [];
  const deps: BrainDeps = {
    start: (command, args, cwd, _env, onText) => {
      started.push({ command, args, cwd });
      const client = new AcpClient(f.proc, k.after, {
        notification: (method, params) => {
          const m = messageText(method, params);
          if (m) onText(m.sessionId, m.text);
        },
      });
      return Promise.resolve({ client, sessionId: 's1', models: [], stderr: () => '' });
    },
    command: 'copilot', model: 'claude-haiku-4.5', cwd: 'C:\\g', env: () => Promise.resolve({}), after: k.after, ...over,
  };
  return { f, k, started, b: new GameBrain(deps) };
}

describe('GameBrain', () => {
  it('starts Copilot CLI with no tools and the chosen model, once', async () => {
    const { f, started, b } = brain();
    const first = b.ask(1, 'hello');
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    f.agent({ jsonrpc: '2.0', id: 1, result: { stopReason: 'end_turn' } });
    await first;
    const second = b.ask(1, 'again');
    await vi.waitFor(() => expect(f.sent).toHaveLength(2));
    f.agent({ jsonrpc: '2.0', id: 2, result: { stopReason: 'end_turn' } });
    await second;
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ command: 'copilot', cwd: 'C:\\g' });
    expect((started[0] as { args: string[] }).args).toEqual(expect.arrayContaining([
      '--acp', '--available-tools=lolping-none', '--model', 'claude-haiku-4.5',
    ]));
  });

  it('sends the prompt to the seat’s session and returns what the agent said in it', async () => {
    const { f, b } = brain();
    const asked = b.ask(1, 'Who do you vote for?');
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    expect(f.sent[0]).toMatchObject({
      method: 'session/prompt', params: { sessionId: 's1', prompt: [{ type: 'text', text: 'Who do you vote for?' }] },
    });
    f.agent(chunk('s1', '{"vote":'));
    f.agent(chunk('s1', ' 3}'));
    f.agent({ jsonrpc: '2.0', id: 1, result: { stopReason: 'end_turn' } });
    expect(await asked).toBe('{"vote": 3}');
  });

  it('gives every other seat a session of its own, so no seat hears another', async () => {
    const { f, b } = brain();
    const one = b.ask(1, 'a');
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    const two = b.ask(2, 'b');
    await vi.waitFor(() => expect(f.sent).toHaveLength(2));
    expect(f.sent[1]).toMatchObject({ method: 'session/new', params: { cwd: 'C:\\g', mcpServers: [] } });
    f.agent({ jsonrpc: '2.0', id: 2, result: { sessionId: 's2' } });
    await vi.waitFor(() => expect(f.sent).toHaveLength(3));
    expect(f.sent[2]).toMatchObject({ method: 'session/prompt', params: { sessionId: 's2' } });
    f.agent(chunk('s2', 'two'));
    f.agent(chunk('s1', 'one'));
    f.agent({ jsonrpc: '2.0', id: 1, result: {} });
    f.agent({ jsonrpc: '2.0', id: 3, result: {} });
    expect(await one).toBe('one');
    expect(await two).toBe('two');
  });

  /** Opens seat 1 on the agent's own session, then asks seat 2 and lets its session fail; the next request sent is returned. */
  async function failSeatTwo(h: ReturnType<typeof brain>, id: number, prompt: string): Promise<Promise<string | null>> {
    const asked = h.b.ask(2, prompt);
    await vi.waitFor(() => expect(h.f.sent).toHaveLength(id));
    expect(h.f.sent[id - 1]).toMatchObject({ method: 'session/new' });
    h.f.agent({ jsonrpc: '2.0', id, error: { code: -32000, message: 'busy' } });
    return asked;
  }

  it('tries a seat again at its next question when its session would not open', async () => {
    const h = brain();
    const one = h.b.ask(1, 'a');
    await vi.waitFor(() => expect(h.f.sent).toHaveLength(1));
    h.f.agent({ jsonrpc: '2.0', id: 1, result: {} });
    await one;

    expect(await failSeatTwo(h, 2, 'b')).toBeNull();
    const again = h.b.ask(2, 'c');
    await vi.waitFor(() => expect(h.f.sent).toHaveLength(3));
    // A new session is asked for: the agent's own session stays with seat 1.
    expect(h.f.sent[2]).toMatchObject({ method: 'session/new' });
    h.f.agent({ jsonrpc: '2.0', id: 3, result: { sessionId: 's2' } });
    await vi.waitFor(() => expect(h.f.sent).toHaveLength(4));
    expect(h.f.sent[3]).toMatchObject({ method: 'session/prompt', params: { sessionId: 's2', prompt: [{ text: 'c' }] } });
    h.f.agent(chunk('s2', '{"say":"hi"}'));
    h.f.agent({ jsonrpc: '2.0', id: 4, result: {} });
    expect(await again).toBe('{"say":"hi"}');
  });

  it('leaves a seat to the rules once its session failed three times', async () => {
    const h = brain();
    const one = h.b.ask(1, 'a');
    await vi.waitFor(() => expect(h.f.sent).toHaveLength(1));
    h.f.agent({ jsonrpc: '2.0', id: 1, result: {} });
    await one;

    expect(await failSeatTwo(h, 2, 'b')).toBeNull();
    expect(await failSeatTwo(h, 3, 'c')).toBeNull();
    expect(await failSeatTwo(h, 4, 'd')).toBeNull();
    expect(await h.b.ask(2, 'e')).toBeNull();
    expect(h.f.sent).toHaveLength(4);
    // Another seat is not held back by it.
    const three = h.b.ask(3, 'f');
    await vi.waitFor(() => expect(h.f.sent).toHaveLength(5));
    expect(h.f.sent[4]).toMatchObject({ method: 'session/new' });
    h.f.agent({ jsonrpc: '2.0', id: 5, result: { sessionId: 's3' } });
    await vi.waitFor(() => expect(h.f.sent).toHaveLength(6));
    h.f.agent(chunk('s3', 'ok'));
    h.f.agent({ jsonrpc: '2.0', id: 6, result: {} });
    expect(await three).toBe('ok');
  });

  it('drops the notice Copilot CLI puts before a first reply', async () => {
    const { f, b } = brain();
    const asked = b.ask(1, 'a');
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    f.agent(chunk('s1', 'Info: Disabled tools: a, b, edit'));
    f.agent(chunk('s1', '{"say":"hi"}'));
    f.agent({ jsonrpc: '2.0', id: 1, result: {} });
    expect(await asked).toBe('{"say":"hi"}');
  });

  it('cancels a turn that takes too long and gives null', async () => {
    const { f, k, b } = brain();
    const asked = b.ask(1, 'a');
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    const [slow] = k.live();
    slow?.fn();
    expect(f.sent[1]).toMatchObject({ method: 'session/cancel', params: { sessionId: 's1' } });
    f.agent(chunk('s1', '{"say":"late"}'));
    f.agent({ jsonrpc: '2.0', id: 1, result: { stopReason: 'cancelled' } });
    expect(await asked).toBeNull();
  });

  it('gives null when the agent will not start, and when it ends', async () => {
    const down = brain({ start: () => Promise.reject(new Error('no copilot')) });
    expect(await down.b.ask(1, 'a')).toBeNull();

    const { f, b } = brain();
    const asked = b.ask(1, 'a');
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    f.exit(1);
    expect(await asked).toBeNull();
    expect(await b.ask(1, 'b')).toBeNull();
  });

  it('stops the agent when the game is over', async () => {
    const { f, b } = brain();
    const asked = b.ask(1, 'a');
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    f.agent({ jsonrpc: '2.0', id: 1, result: {} });
    await asked;
    b.close();
    await vi.waitFor(() => expect(f.kills()).toBe(1));
    expect(await b.ask(1, 'b')).toBeNull();
  });
});
