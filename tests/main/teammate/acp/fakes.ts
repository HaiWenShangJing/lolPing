import type { AcpProcess } from '../../../../src/main/teammate/acp/client';

/** A process whose agent end the test plays by hand. */
export function fake() {
  const sent: Array<Record<string, unknown>> = [];
  let line: (l: string) => void = () => undefined;
  let close: (code: number | null) => void = () => undefined;
  let kills = 0;
  const proc: AcpProcess = {
    send: (l) => { sent.push(JSON.parse(l) as Record<string, unknown>); },
    onLine: (cb) => { line = cb; },
    onClose: (cb) => { close = cb; },
    kill: () => { kills += 1; close(null); },
    stderr: () => 'boom',
  };
  return {
    proc, sent,
    kills: () => kills,
    /** The agent writes a message (or a raw line). */
    agent: (m: unknown): void => line(typeof m === 'string' ? m : JSON.stringify(m)),
    exit: (code: number | null = 0): void => close(code),
  };
}

interface Timer { ms: number; fn: () => void; live: boolean }

export function clock() {
  const timers: Timer[] = [];
  const after = (ms: number, fn: () => void): (() => void) => {
    const t: Timer = { ms, fn, live: true };
    timers.push(t);
    return () => { t.live = false; };
  };
  return { after, live: () => timers.filter((t) => t.live) };
}
