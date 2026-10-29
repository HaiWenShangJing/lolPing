import { describe, expect, it, vi } from 'vitest';
import { AcpClient, AcpError } from '../../../../src/main/teammate/acp/client';
import { clock, fake } from './fakes';

describe('AcpClient requests', () => {
  it('sends a JSON-RPC request and resolves with the result of the reply that has its id', async () => {
    const f = fake();
    const c = new AcpClient(f.proc, clock().after);
    const first = c.request<{ a: number }>('initialize', { x: 1 });
    const second = c.request<{ b: number }>('session/new', {});
    expect(f.sent).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { x: 1 } },
      { jsonrpc: '2.0', id: 2, method: 'session/new', params: {} },
    ]);
    f.agent({ jsonrpc: '2.0', id: 2, result: { b: 2 } });
    f.agent({ jsonrpc: '2.0', id: 1, result: { a: 1 } });
    await expect(first).resolves.toEqual({ a: 1 });
    await expect(second).resolves.toEqual({ b: 2 });
  });

  it('rejects with the agent\'s error', async () => {
    const f = fake();
    const c = new AcpClient(f.proc, clock().after);
    const r = c.request('session/prompt', {});
    f.agent({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'no quota' } });
    await expect(r).rejects.toThrow('no quota');
    await expect(r).rejects.toBeInstanceOf(AcpError);
  });

  it('ignores lines that are not messages, replies nobody asked for, and notifications without a handler', async () => {
    const f = fake();
    const c = new AcpClient(f.proc, clock().after);
    const r = c.request('x', {});
    f.agent('not json');
    f.agent('[1,2]');
    f.agent({ jsonrpc: '2.0', id: 99, result: 1 });
    f.agent({ jsonrpc: '2.0', method: 'session/update', params: {} });
    f.agent({ jsonrpc: '2.0', id: 1, result: 'ok' });
    await expect(r).resolves.toBe('ok');
  });

  it('times a request out and forgets it', async () => {
    const f = fake();
    const k = clock();
    const c = new AcpClient(f.proc, k.after);
    const r = c.request('initialize', {}, 5_000);
    expect(k.live().map((t) => t.ms)).toEqual([5_000]);
    k.live()[0].fn();
    await expect(r).rejects.toThrow('initialize timed out');
    f.agent({ jsonrpc: '2.0', id: 1, result: 'late' }); // nobody is waiting
  });

  it('cancels the timer when the reply comes', async () => {
    const f = fake();
    const k = clock();
    const c = new AcpClient(f.proc, k.after);
    const r = c.request('x', {}, 5_000);
    f.agent({ jsonrpc: '2.0', id: 1, result: 1 });
    await r;
    expect(k.live()).toEqual([]);
  });

  it('sends a notification without an id', () => {
    const f = fake();
    new AcpClient(f.proc, clock().after).notify('session/cancel', { sessionId: 's' });
    expect(f.sent).toEqual([{ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 's' } }]);
  });
});

describe('AcpClient ending', () => {
  it('fails what is waiting when the agent exits, and says so to whoever listens', async () => {
    const f = fake();
    const c = new AcpClient(f.proc, clock().after);
    const closed = vi.fn();
    c.onClose(closed);
    const r = c.request('x', {});
    f.exit(1);
    await expect(r).rejects.toThrow('The agent ended.');
    expect(closed).toHaveBeenCalledOnce();
    expect(c.closed).toBe(true);
    await expect(c.request('y', {})).rejects.toThrow('ended');
    const late = vi.fn();
    c.onClose(late);
    expect(late).toHaveBeenCalledOnce();
  });

  it('kills the process when closed, fails what is waiting, and does it once', async () => {
    const f = fake();
    const c = new AcpClient(f.proc, clock().after);
    const r = c.request('x', {});
    c.close();
    c.close();
    await expect(r).rejects.toThrow('stopped');
    expect(f.kills()).toBe(1);
    c.notify('late', {});
    expect(f.sent).toHaveLength(1); // only the request
  });

  it('stops the timers of what was waiting', async () => {
    const f = fake();
    const k = clock();
    const c = new AcpClient(f.proc, k.after);
    const r = c.request('x', {}, 9_000);
    f.exit();
    await expect(r).rejects.toThrow();
    expect(k.live()).toEqual([]);
  });
});

describe('AcpClient agent requests', () => {
  it('answers what the agent asks with what the handler returns', () => {
    const f = fake();
    new AcpClient(f.proc, clock().after, { request: (m, p) => ({ got: m, p }) });
    f.agent({ jsonrpc: '2.0', id: 'a1', method: 'session/request_permission', params: { n: 1 } });
    expect(f.sent).toEqual([{ jsonrpc: '2.0', id: 'a1', result: { got: 'session/request_permission', p: { n: 1 } } }]);
  });

  it('answers with an error when the handler throws, and "not supported" without a handler', () => {
    const f = fake();
    new AcpClient(f.proc, clock().after, { request: () => { throw new Error('no'); } });
    f.agent({ jsonrpc: '2.0', id: 7, method: 'fs/read_text_file', params: {} });
    expect(f.sent[0]).toMatchObject({ id: 7, error: { message: 'no' } });
    const g = fake();
    new AcpClient(g.proc, clock().after);
    g.agent({ jsonrpc: '2.0', id: 8, method: 'fs/read_text_file', params: {} });
    expect(g.sent[0]).toMatchObject({ id: 8, error: { code: -32601 } });
  });

  it('passes notifications to the handler', () => {
    const f = fake();
    const seen: unknown[] = [];
    new AcpClient(f.proc, clock().after, { notification: (m, p) => seen.push([m, p]) });
    f.agent({ jsonrpc: '2.0', method: 'session/update', params: { u: 1 } });
    expect(seen).toEqual([['session/update', { u: 1 }]]);
  });
});
