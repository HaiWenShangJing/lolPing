import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type { Platform } from '../../../shared/platform';
import { findExecutable, spawnArgv } from '../agents/command';
import { AgentStartError, isExecutable, searchPath } from '../agents/runner';
import type { AcpProcess } from './client';

/** A line longer than this is not a message of the protocol: what has built up is dropped. */
const LINE_MAX = 8 * 1024 * 1024;
const STDERR_MAX = 4 * 1024;

export interface AcpSpawnDeps {
  spawn: typeof nodeSpawn;
  platform: Platform;
  killTree: (pid: number) => void;
}

/** The agent's process, with its stderr's last bytes. */
export type OpenedAcp = AcpProcess;

/** Starts `command args` with pipes for the protocol. A .cmd shim goes through cmd.exe, as the runner does it. */
export async function openAcp(
  deps: AcpSpawnDeps, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv,
): Promise<OpenedAcp> {
  const { platform } = deps;
  const file = findExecutable(command, searchPath(env, platform), platform, isExecutable);
  if (file === null) throw new AgentStartError('notFound', `Couldn't find ${command}`);
  const childEnv: NodeJS.ProcessEnv = { ...env };
  // lolPing's own node switch would make any Electron app the agent starts run as plain Node.
  delete childEnv.ELECTRON_RUN_AS_NODE;
  let child: ChildProcess;
  try {
    const argv = spawnArgv(file, args, platform);
    child = deps.spawn(argv.file, argv.args, {
      cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      detached: platform !== 'win', windowsVerbatimArguments: argv.verbatim,
    });
  } catch (e) {
    throw new AgentStartError('spawn', e instanceof Error ? e.message : String(e));
  }
  let stderr = '';
  let partial = '';
  let lineCb: (line: string) => void = () => undefined;
  let closeCb: (code: number | null) => void = () => undefined;
  let over = false;
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    partial += chunk;
    let at = partial.indexOf('\n');
    while (at >= 0) {
      const line = partial.slice(0, at).replace(/\r$/, '');
      partial = partial.slice(at + 1);
      if (line !== '') lineCb(line);
      at = partial.indexOf('\n');
    }
    if (partial.length > LINE_MAX) partial = '';
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_MAX);
  });
  child.stdin?.on('error', () => undefined); // a write after the agent is gone
  // After 'spawn', an error is a failed kill or a broken pipe; 'close' still ends it.
  child.on('error', () => undefined);
  child.once('close', (code: number | null) => {
    over = true;
    closeCb(code);
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (e) => reject(new AgentStartError('spawn', e.message)));
  });
  return {
    send: (line) => {
      if (!over) child.stdin?.write(`${line}\n`);
    },
    onLine: (cb) => {
      lineCb = cb;
    },
    onClose: (cb) => {
      closeCb = cb;
      if (over) cb(null);
    },
    kill: () => {
      if (!over && child.pid !== undefined) deps.killTree(child.pid);
    },
    stderr: () => stderr,
  };
}
