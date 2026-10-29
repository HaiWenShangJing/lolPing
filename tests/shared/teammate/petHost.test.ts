import { describe, expect, it } from 'vitest';
import type { PetStatus } from '../../../src/shared/teammate/petControl';
import {
  CHAT_SIZE, DOUBLE_TAP_MS, FALLBACK_HOST_MODELS, HOST_CALLS_MAX, HOST_REST, HOST_SERVER, HOST_TOOLS, TAP_MAX_MOVE, TAP_MAX_MS,
  chatAt, clampRest, hostActivity, hostArgs, hostChat, hostIntro, hostMcpConfig, hostModel, hostToolDefs, hostWake, isHostTool,
  isTap, parseHostModels, parseRest, pickHostAgent, restDelayMs, roamKind, type HostMoment,
} from '../../../src/shared/teammate/petHost';
import type { AgentProfile, Profile } from '../../../src/shared/teammate/settings';

const agent = (over: Partial<AgentProfile> = {}): AgentProfile => ({
  id: 'cp', kind: 'agent', name: 'Copilot CLI', tagColor: 1, tagColorCustom: null, preset: 'copilot', command: 'copilot',
  customArgs: [], folder: { kind: 'fixed', path: 'C:\\code' }, timeoutS: 300, ...over,
});

const pet: PetStatus = { id: 'naiwa', xPct: 90, yPct: 80, away: false, anims: ['idle', 'dance', 'think'] };
const moment = (over: Partial<HostMoment> = {}): HostMoment => ({
  hour: 9, minute: 5, idleSeconds: 20, pets: [pet], recent: [], ...over,
});

describe('settings values', () => {
  it('knows the kinds and activities and falls back on anything else', () => {
    expect(roamKind('host')).toBe('host');
    expect(roamKind('visit')).toBe('visit');
    expect(roamKind('always')).toBe('visit');
    expect(roamKind(undefined)).toBe('visit');
    expect(hostActivity('lively')).toBe('lively');
    expect(hostActivity('wild')).toBe('normal');
  });

  it('takes a model id only when it is one a command line can carry safely', () => {
    expect(hostModel('claude-haiku-4.5')).toBe('claude-haiku-4.5');
    expect(hostModel('gpt-5.3-codex')).toBe('gpt-5.3-codex');
    expect(hostModel('--yolo')).toBeNull();
    expect(hostModel('a b')).toBeNull();
    expect(hostModel('')).toBeNull();
    expect(hostModel(7)).toBeNull();
    expect(hostModel('x'.repeat(65))).toBeNull();
  });
});

describe('pickHostAgent', () => {
  it('prefers the default profile when it is Copilot CLI, else the first Copilot CLI profile', () => {
    const profiles: Profile[] = [agent({ id: 'a' }), agent({ id: 'b' })];
    expect(pickHostAgent(profiles, 'b')?.id).toBe('b');
    expect(pickHostAgent(profiles, 'zzz')?.id).toBe('a');
    expect(pickHostAgent(profiles, null)?.id).toBe('a');
  });

  it('skips agents that do not speak the protocol, and gives null when none does', () => {
    expect(pickHostAgent([agent({ id: 'cc', preset: 'claude' })], 'cc')).toBeNull();
    expect(pickHostAgent([], null)).toBeNull();
  });
});

describe('rest', () => {
  it('keeps what the agent asks for inside the range of the activity', () => {
    expect(clampRest(1, 'normal')).toBe(HOST_REST.normal.min);
    expect(clampRest(99999, 'normal')).toBe(HOST_REST.normal.max);
    expect(clampRest(100.4, 'normal')).toBe(100);
    expect(clampRest(10, 'lively')).toBe(HOST_REST.lively.min);
  });

  it('gives null for anything that is not a number', () => {
    expect(clampRest('60', 'normal')).toBeNull();
    expect(clampRest(Number.NaN, 'normal')).toBeNull();
    expect(clampRest(undefined, 'normal')).toBeNull();
    expect(parseRest(null, 'normal')).toBeNull();
    expect(parseRest([60], 'normal')).toBeNull();
    expect(parseRest({ seconds: 'soon' }, 'normal')).toBeNull();
    expect(parseRest({ seconds: 90 }, 'normal')).toBe(90);
  });

  it('waits what was asked, or the usual for the activity shaken by a fifth either way', () => {
    expect(restDelayMs('normal', 90, 0.9)).toBe(90_000);
    expect(restDelayMs('normal', null, 0.5)).toBe(HOST_REST.normal.usual * 1000);
    expect(restDelayMs('normal', null, 0)).toBe(Math.round(HOST_REST.normal.usual * 0.8 * 1000));
    expect(restDelayMs('normal', null, 1)).toBe(Math.round(HOST_REST.normal.usual * 1.2 * 1000));
  });

  it('is calmer for calm than for lively', () => {
    expect(HOST_REST.calm.usual).toBeGreaterThan(HOST_REST.normal.usual);
    expect(HOST_REST.normal.usual).toBeGreaterThan(HOST_REST.lively.usual);
  });
});

describe('tools', () => {
  it('offers the pet tools and pet_rest, with the range of the activity in the description', () => {
    const defs = hostToolDefs('lively');
    expect(defs.map((d) => d.name)).toEqual([...HOST_TOOLS]);
    const rest = defs.find((d) => d.name === 'pet_rest');
    expect(rest?.description).toContain(`${HOST_REST.lively.min} to ${HOST_REST.lively.max}`);
  });

  it('knows its own tools only', () => {
    expect(isHostTool('pet_rest')).toBe(true);
    expect(isHostTool('pet_say')).toBe(true);
    expect(isHostTool('say')).toBe(false);
    expect(isHostTool('bash')).toBe(false);
  });
});

describe('the host session config', () => {
  it('names the bridge as one stdio server, with every tool it offers', () => {
    const bridge = { command: 'C:\\lolPing.exe', args: ['bridge.js'], env: { LOLPING_ASK: 'host-1.ab' } };
    expect(JSON.parse(hostMcpConfig(bridge))).toEqual({
      mcpServers: { [HOST_SERVER]: { type: 'stdio', command: bridge.command, args: bridge.args, env: bridge.env, tools: ['*'] } },
    });
  });

  it('starts Copilot CLI over the protocol with only the pet tools allowed and listed', () => {
    const args = hostArgs({ model: null, configPath: 'C:\\t\\mcp.json' });
    expect(args[0]).toBe('--acp');
    expect(args).toContain('--additional-mcp-config');
    expect(args).toContain('@C:\\t\\mcp.json');
    expect(args).toContain(`--allow-tool=${HOST_SERVER}`);
    const list = args.find((a) => a.startsWith('--available-tools='))?.slice('--available-tools='.length).split(',');
    expect(list).toEqual(HOST_TOOLS.map((t) => `${HOST_SERVER}-${t}`));
    expect(args).toContain('--no-ask-user');
    expect(args).toContain('--disable-builtin-mcps');
    expect(args).not.toContain('--model');
    expect(args.every((a) => !/[\r\n]/.test(a))).toBe(true);
  });

  it('adds the model when one is chosen', () => {
    const args = hostArgs({ model: 'claude-haiku-4.5', configPath: 'x' });
    expect(args.slice(args.indexOf('--model'))).toEqual(['--model', 'claude-haiku-4.5']);
  });
});

describe('prompts', () => {
  it('tells the agent who it is, what it may use and how to rest, in the language of the user', () => {
    const text = hostIntro({ language: 'Simplified Chinese', activity: 'normal', moment: moment() });
    expect(text).toContain('Simplified Chinese');
    expect(text).toContain('pet_rest');
    expect(text).toContain(`At most ${HOST_CALLS_MAX}`);
    expect(text).toContain(`${HOST_REST.normal.min} to ${HOST_REST.normal.max}`);
    expect(text).toContain('naiwa');
    expect(text).toContain('first wake-up');
  });

  it('puts what the user typed into the first prompt of a session that begins with a chat', () => {
    const text = hostIntro({
      language: 'English', activity: 'normal', moment: moment(), says: [{ pet: 'naiwa', text: 'hi there' }],
    });
    expect(text).toContain('The user types to naiwa: "hi there"');
    expect(text).not.toContain('first wake-up');
  });

  it('wakes a running session with the clock, the user\'s idleness and the pets, not the whole briefing', () => {
    const text = hostWake(moment({ hour: 23, minute: 7, idleSeconds: 400 }));
    expect(text).toContain('23:07');
    expect(text).toContain('late at night');
    expect(text).toContain('7 min ago');
    expect(text).toContain('naiwa');
    expect(text).not.toContain('You are the mind');
  });

  it('says what the pets said last', () => {
    const text = hostWake(moment({ recent: [{ text: 'good morning', agoSeconds: 30 }] }));
    expect(text).toContain('"good morning" (a moment ago)');
  });

  it('passes on what the user typed, kept to one line and cut to length, as a quoted string', () => {
    const long = `a\n"b"${'c'.repeat(400)}`;
    const text = hostChat({ says: [{ pet: 'airi', text: long }], moment: moment() });
    const line = text.split('\n').find((l) => l.startsWith('The user types to airi:')) ?? '';
    expect(line).toContain('\\"b\\"');
    expect(line.length).toBeLessThan(260);
    expect(hostChat({ says: [{ pet: null, text: 'hello' }], moment: moment() })).toContain('types to the pets');
  });
});

describe('models', () => {
  it('reads the models of a new session with their price', () => {
    const result = {
      sessionId: 's', models: {
        currentModelId: 'claude-sonnet-5.5', availableModels: [
          { modelId: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', _meta: { copilotUsage: '0.33x' } },
          { modelId: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
          { modelId: 'bad id', name: 'x' },
          'junk',
        ],
      },
    };
    expect(parseHostModels(result)).toEqual([
      { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', cost: '0.33x' },
      { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', cost: null },
    ]);
  });

  it('reads nothing from anything else, and the fallback has a cheap model first', () => {
    expect(parseHostModels(null)).toEqual([]);
    expect(parseHostModels({ models: {} })).toEqual([]);
    expect(parseHostModels({ models: { availableModels: 'x' } })).toEqual([]);
    expect(FALLBACK_HOST_MODELS[0].id).toBe('claude-haiku-4.5');
    expect(FALLBACK_HOST_MODELS.every((m) => hostModel(m.id) === m.id)).toBe(true);
  });
});

describe('taps', () => {
  it('is a tap when the pointer stayed put and was let go soon', () => {
    expect(isTap(0, 0, 100)).toBe(true);
    expect(isTap(TAP_MAX_MOVE, 0, TAP_MAX_MS)).toBe(true);
  });

  it('is a drag when the pointer moved, or a press when it was held', () => {
    expect(isTap(TAP_MAX_MOVE + 1, 0, 100)).toBe(false);
    expect(isTap(3, 4.1, 100)).toBe(false);
    expect(isTap(0, 0, TAP_MAX_MS + 1)).toBe(false);
    expect(isTap(0, 0, -1)).toBe(false);
  });

  it('takes two taps within half a second for a double tap', () => {
    expect(DOUBLE_TAP_MS).toBe(500);
  });
});

describe('chatAt', () => {
  const area = { x: 0, y: 0, width: 1600, height: 720 };

  it('puts the box left of the pet, level with its middle', () => {
    const at = chatAt({ x: 1000, y: 400, width: 150, height: 150 }, area);
    expect(at).toEqual({ x: 1000 - CHAT_SIZE.width - 6, y: 400 + 75 - CHAT_SIZE.height / 2 });
  });

  it('goes to the right of a pet at the left edge', () => {
    const at = chatAt({ x: 10, y: 400, width: 150, height: 150 }, area);
    expect(at.x).toBe(10 + 150 + 6);
  });

  it('stays inside the area', () => {
    const low = chatAt({ x: 1000, y: 700, width: 150, height: 150 }, area);
    expect(low.y + CHAT_SIZE.height).toBeLessThanOrEqual(area.height);
    const right = chatAt({ x: 100, y: 0, width: 150, height: 150 }, { x: 0, y: 0, width: 300, height: 720 });
    expect(right.x + CHAT_SIZE.width).toBeLessThanOrEqual(300);
    expect(right.y).toBeGreaterThanOrEqual(0);
  });
});
