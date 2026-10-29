import { describe, expect, it, vi } from 'vitest';
import { listHostModels, refuseAll, startAcpSession } from '../../../../src/main/teammate/acp/session';
import { clock, fake } from './fakes';

const models = { availableModels: [{ modelId: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', _meta: { copilotUsage: '0.33x' } }] };

describe('refuseAll', () => {
  const options = [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'always', name: 'Always', kind: 'allow_always' },
    { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
  ];

  it('picks the option that rejects', () => {
    expect(refuseAll('session/request_permission', { options })).toEqual({ outcome: { outcome: 'selected', optionId: 'deny' } });
  });

  it('cancels when there is nothing to reject with', () => {
    expect(refuseAll('session/request_permission', { options: [options[0]] })).toEqual({ outcome: { outcome: 'cancelled' } });
    expect(refuseAll('session/request_permission', null)).toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('supports nothing else the agent could ask of the client', () => {
    expect(() => refuseAll('fs/write_text_file', {})).toThrow('not supported');
    expect(() => refuseAll('terminal/create', {})).toThrow('not supported');
  });
});

describe('startAcpSession', () => {
  it('initializes, opens a session without a client MCP server, and gives its models', async () => {
    const f = fake();
    const k = clock();
    const opened: unknown[] = [];
    const run = startAcpSession({
      open: async (command, args, cwd, env) => { opened.push({ command, args, cwd, env }); return f.proc; },
      after: k.after, command: 'copilot', args: ['--acp'], cwd: 'C:\\h', env: { PATH: 'x' }, version: '1.2.3',
    });
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    expect(f.sent[0]).toMatchObject({
      method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'lolPing', version: '1.2.3' } },
    });
    f.agent({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
    await vi.waitFor(() => expect(f.sent).toHaveLength(2));
    expect(f.sent[1]).toMatchObject({ method: 'session/new', params: { cwd: 'C:\\h', mcpServers: [] } });
    f.agent({ jsonrpc: '2.0', id: 2, result: { sessionId: 'sess-1', models } });
    const s = await run;
    expect(s.sessionId).toBe('sess-1');
    expect(s.models).toEqual([{ id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', cost: '0.33x' }]);
    expect(s.stderr()).toBe('boom');
    expect(opened).toEqual([{ command: 'copilot', args: ['--acp'], cwd: 'C:\\h', env: { PATH: 'x' } }]);
    expect(k.live()).toEqual([]);
    expect(f.kills()).toBe(0);
  });

  it('closes the agent when it gives no session', async () => {
    const f = fake();
    const run = startAcpSession({
      open: async () => f.proc, after: clock().after, command: 'copilot', args: [], cwd: 'C:\\h', env: {}, version: '1',
    });
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    f.agent({ jsonrpc: '2.0', id: 1, result: {} });
    await vi.waitFor(() => expect(f.sent).toHaveLength(2));
    f.agent({ jsonrpc: '2.0', id: 2, result: { sessionId: '' } });
    await expect(run).rejects.toThrow('no session');
    expect(f.kills()).toBe(1);
  });

  it('closes the agent when it does not answer in time', async () => {
    const f = fake();
    const k = clock();
    const run = startAcpSession({
      open: async () => f.proc, after: k.after, command: 'copilot', args: [], cwd: 'C:\\h', env: {}, version: '1',
    });
    await vi.waitFor(() => expect(k.live()).toHaveLength(1));
    k.live()[0].fn();
    await expect(run).rejects.toThrow('timed out');
    expect(f.kills()).toBe(1);
  });

  it('refuses a permission the agent asks for while it works', async () => {
    const f = fake();
    const run = startAcpSession({
      open: async () => f.proc, after: clock().after, command: 'copilot', args: [], cwd: 'C:\\h', env: {}, version: '1',
    });
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    f.agent({
      jsonrpc: '2.0', id: 'p1', method: 'session/request_permission',
      params: { options: [{ optionId: 'ok', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] },
    });
    expect(f.sent[1]).toEqual({ jsonrpc: '2.0', id: 'p1', result: { outcome: { outcome: 'selected', optionId: 'no' } } });
    f.agent({ jsonrpc: '2.0', id: 1, result: {} });
    await vi.waitFor(() => expect(f.sent).toHaveLength(3));
    f.agent({ jsonrpc: '2.0', id: 2, result: { sessionId: 's', models } });
    await run;
  });
});

describe('listHostModels', () => {
  it('opens a session for the list, closes it and sends no prompt', async () => {
    const f = fake();
    const seen: string[][] = [];
    const run = listHostModels({
      open: async (_c, args) => { seen.push(args); return f.proc; },
      after: clock().after, command: 'copilot', cwd: 'C:\\h', env: {}, version: '1',
    });
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    f.agent({ jsonrpc: '2.0', id: 1, result: {} });
    await vi.waitFor(() => expect(f.sent).toHaveLength(2));
    f.agent({
      jsonrpc: '2.0', id: 2, result: { sessionId: 's', models: { availableModels: [{ modelId: 'gpt-6-sol', name: 'GPT-6 Sol' }] } },
    });
    expect(await run).toEqual([{ id: 'gpt-6-sol', name: 'GPT-6 Sol', cost: null }]);
    expect(f.kills()).toBe(1);
    expect(f.sent.map((m) => m.method)).toEqual(['initialize', 'session/new']);
    expect(seen[0]).toContain('--acp');
    expect(seen[0].some((a) => a.startsWith('--additional-mcp-config'))).toBe(false);
  });
});
