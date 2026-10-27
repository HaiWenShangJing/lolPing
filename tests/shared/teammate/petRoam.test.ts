import { describe, expect, it } from 'vitest';
import {
  ROAM_CALLS_MAX, ROAM_CHOICES, ROAM_DEFAULT_MINUTES, ROAM_IDEAS, ROAM_MAX_MINUTES, ROAM_MIN_MINUTES,
  pickRoamAgent, roamDelayMs, roamMinutes, roamPrompt,
} from '../../../src/shared/teammate/petRoam';
import type { AgentProfile, BuiltinProfile, Profile } from '../../../src/shared/teammate/settings';

const agent = (id: string): AgentProfile => ({
  id, kind: 'agent', name: id, tagColor: 1, tagColorCustom: null, preset: 'copilot', command: 'copilot',
  customArgs: [], folder: { kind: 'fixed', path: 'C:\\code' }, timeoutS: 300,
});
const builtin: BuiltinProfile = {
  id: 'fast', kind: 'builtin', name: 'fast', tagColor: 3, tagColorCustom: null, provider: 'openai', protocol: 'openai',
  baseUrl: 'https://api.example.com/v1', model: 'm',
};

describe('roamMinutes', () => {
  it('keeps a whole number of minutes within the limits', () => {
    expect(roamMinutes(30)).toBe(30);
    expect(roamMinutes(7.6)).toBe(8);
  });

  it('clamps to the limits', () => {
    expect(roamMinutes(1)).toBe(ROAM_MIN_MINUTES);
    expect(roamMinutes(100_000)).toBe(ROAM_MAX_MINUTES);
  });

  it('takes the default for anything that is not a finite number', () => {
    for (const raw of [undefined, null, '15', NaN, Infinity, {}]) expect(roamMinutes(raw)).toBe(ROAM_DEFAULT_MINUTES);
  });

  it('offers only gaps that are within the limits', () => {
    for (const c of ROAM_CHOICES) expect(roamMinutes(c)).toBe(c);
    expect(ROAM_CHOICES).toContain(ROAM_DEFAULT_MINUTES);
  });
});

describe('roamDelayMs', () => {
  it('is the gap, 20 % shorter to 20 % longer', () => {
    expect(roamDelayMs(10, 0)).toBe(480_000);
    expect(roamDelayMs(10, 0.5)).toBe(600_000);
    expect(roamDelayMs(10, 1)).toBe(720_000);
  });
});

describe('pickRoamAgent', () => {
  it('takes the default profile when it is an agent', () => {
    const profiles: Profile[] = [agent('a'), agent('b')];
    expect(pickRoamAgent(profiles, 'b')?.id).toBe('b');
  });

  it('takes the first agent when the default is a built-in model or missing', () => {
    const profiles: Profile[] = [builtin, agent('a'), agent('b')];
    expect(pickRoamAgent(profiles, 'fast')?.id).toBe('a');
    expect(pickRoamAgent(profiles, null)?.id).toBe('a');
    expect(pickRoamAgent(profiles, 'gone')?.id).toBe('a');
  });

  it('is null without an agent', () => {
    expect(pickRoamAgent([builtin], 'fast')).toBeNull();
    expect(pickRoamAgent([], null)).toBeNull();
  });
});

describe('roamPrompt', () => {
  const prompt = (o: Partial<Parameters<typeof roamPrompt>[0]> = {}) =>
    roamPrompt({ language: 'English', hour: 9, idea: 0, ...o });

  it('limits the agent to a few pet calls and sends nothing from the screen', () => {
    const p = prompt();
    expect(p).toContain('at most 3 calls');
    expect(p).toContain('pet_status');
    expect(p).toContain('Do not use any other tool');
    expect(ROAM_CALLS_MAX).toBeGreaterThan(3);
  });

  it('is one line, since a Windows agent starts through cmd.exe, which rejects a line break in an argument', () => {
    for (let idea = 0; idea < ROAM_IDEAS.length; idea += 1) expect(prompt({ idea })).not.toMatch(/[\r\n]/);
  });

  it('asks for the user\'s language and names the time of day', () => {
    expect(prompt({ language: 'Simplified Chinese' })).toContain('one short sentence in Simplified Chinese');
    expect(prompt({ hour: 6 })).toContain('It is morning');
    expect(prompt({ hour: 13 })).toContain('It is afternoon');
    expect(prompt({ hour: 20 })).toContain('It is evening');
    expect(prompt({ hour: 2 })).toContain('It is late at night');
    expect(prompt({ hour: 23 })).toContain('It is late at night');
  });

  it('picks a nudge by the index, however large or odd', () => {
    expect(prompt({ idea: 1 })).toContain(ROAM_IDEAS[1]);
    expect(prompt({ idea: ROAM_IDEAS.length })).toContain(ROAM_IDEAS[0]);
    expect(prompt({ idea: -2 })).toContain(ROAM_IDEAS[2]);
    expect(prompt({ idea: 1.9 })).toContain(ROAM_IDEAS[1]);
  });
});
