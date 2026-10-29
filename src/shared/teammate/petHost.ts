/**
 * Pets hosted by a coding agent that stays on: lolPing keeps one Copilot CLI session open (over the Agent Client
 * Protocol) and wakes it now and then with a short note about the moment. The agent decides what the pets do and
 * when it wants to be woken next. This is the pure part: settings values, prompts, the tool list and the process flags.
 */

import type { AgentRunSpec } from './agents';
import { PET_SAY_MAX, PET_TOOLS, describePets, describePetsBrief, petToolDefs, type PetStatus } from './petControl';
import type { AgentProfile, Profile } from './settings';
import type { ToolDef } from './tools';

/** Roaming comes as visits (a fresh agent run each time) or as a host (one session that stays on). */
export const ROAM_KINDS = ['visit', 'host'] as const;
export type RoamKind = (typeof ROAM_KINDS)[number];

export const HOST_ACTIVITIES = ['calm', 'normal', 'lively'] as const;
export type HostActivity = (typeof HOST_ACTIVITIES)[number];

export const DEFAULT_ROAM_KIND: RoamKind = 'visit';
export const DEFAULT_HOST_ACTIVITY: HostActivity = 'normal';

export const roamKind = (raw: unknown): RoamKind => ROAM_KINDS.find((k) => k === raw) ?? DEFAULT_ROAM_KIND;
export const hostActivity = (raw: unknown): HostActivity => HOST_ACTIVITIES.find((a) => a === raw) ?? DEFAULT_HOST_ACTIVITY;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** The profile that hosts the pets: only Copilot CLI speaks the protocol; the default profile if it is one, else the first. */
export function pickHostAgent(profiles: readonly Profile[], defaultProfile: string | null): AgentProfile | null {
  const copilots = profiles.filter((p): p is AgentProfile => p.kind === 'agent' && p.preset === 'copilot');
  return copilots.find((p) => p.id === defaultProfile) ?? copilots[0] ?? null;
}

/** A model id as Copilot CLI names it; null (its own choice) for anything else. */
export function hostModel(raw: unknown): string | null {
  return typeof raw === 'string' && MODEL_ID.test(raw) ? raw : null;
}

/** How long the agent may sleep between wake-ups, per activity: its own pick is kept inside this. */
export const HOST_REST: Record<HostActivity, { min: number; max: number; usual: number }> = {
  calm: { min: 120, max: 900, usual: 360 },
  normal: { min: 45, max: 420, usual: 150 },
  lively: { min: 15, max: 150, usual: 50 },
};

/** The seconds the agent asked to sleep, kept inside the activity's range; null when it named none. */
export function clampRest(raw: unknown, activity: HostActivity): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const { min, max } = HOST_REST[activity];
  return Math.min(max, Math.max(min, Math.round(raw)));
}

/** The wait until the next wake-up: what the agent asked for, else the usual for the activity, a little shaken. */
export function restDelayMs(activity: HostActivity, asked: number | null, random: number): number {
  const seconds = asked ?? HOST_REST[activity].usual * (0.8 + 0.4 * random);
  return Math.round(seconds * 1000);
}

/** Tool calls one wake-up may make; lolPing refuses the rest. */
export const HOST_CALLS_MAX = 10;
/** A wake-up that has not ended by now is cancelled. */
export const HOST_TURN_MAX_MS = 90_000;
/** After this many wake-ups the session starts over, so its memory doesn't grow without end. */
export const HOST_TURNS_MAX = 40;
/** No keyboard or mouse for this long: the user is away, and the pets are left to sleep. */
export const HOST_IDLE_SECONDS = 600;
/** What a user's line to a pet may be at most. */
export const HOST_CHAT_MAX = 200;

/** The MCP server's name in the host session; its tools are named `lolping-pets-<tool>`. */
export const HOST_SERVER = 'lolping-pets';

export const HOST_TOOLS = [...PET_TOOLS, 'pet_rest'] as const;
export type HostTool = (typeof HOST_TOOLS)[number];

export const isHostTool = (name: string): name is HostTool => (HOST_TOOLS as readonly string[]).includes(name);

/** The pet tools and `pet_rest`, with the sleep range of `activity` in its description. */
export function hostToolDefs(activity: HostActivity): ToolDef[] {
  const { min, max } = HOST_REST[activity];
  return [
    ...petToolDefs(),
    {
      name: 'pet_rest',
      description: 'Say how long you sleep until lolPing wakes you again, in seconds. Call it last in every wake-up: '
        + `${min} to ${max} are allowed (anything else is moved into that range). Sleep shorter while something is going on.`,
      parameters: {
        type: 'object',
        properties: { seconds: { type: 'number', description: `Seconds until the next wake-up, ${min} to ${max}.` } },
        required: ['seconds'],
      },
    },
  ];
}

/** What the agent sleeps for, if the call named a number. */
export function parseRest(args: unknown, activity: HostActivity): number | null {
  const raw = typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  return clampRest(raw.seconds, activity);
}

/** Copilot CLI's config for the host session: the bridge, as a server it may use whatever it offers of. */
export function hostMcpConfig(bridge: AgentRunSpec['bridge']): string {
  return JSON.stringify({
    mcpServers: { [HOST_SERVER]: { type: 'stdio', command: bridge.command, args: bridge.args, env: bridge.env, tools: ['*'] } },
  });
}

/**
 * Copilot CLI's arguments for the host: ACP over stdio, the pet tools and nothing else, and as little standing context
 * as it allows (a session left at its defaults sends tens of thousands of tokens each wake-up). The tool list is by
 * full name because a server's tools are only known by name once its config is read at start.
 */
export function hostArgs(o: { model: string | null; configPath: string }): string[] {
  const tools = HOST_TOOLS.map((t) => `${HOST_SERVER}-${t}`);
  return [
    '--acp', '--additional-mcp-config', `@${o.configPath}`, `--allow-tool=${HOST_SERVER}`, `--available-tools=${tools.join(',')}`,
    '--disable-builtin-mcps', '--no-custom-instructions', '--no-ask-user', '--no-auto-update',
    ...(o.model === null ? [] : ['--model', o.model]),
  ];
}

const dayPart = (hour: number): string => {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'late at night';
};

const two = (n: number): string => String(n).padStart(2, '0');

/** What lolPing tells the agent about the moment: the clock, the user's idleness, the pets and what it did last. */
export interface HostMoment {
  hour: number;
  minute: number;
  /** Seconds since the user last touched the keyboard or mouse. */
  idleSeconds: number;
  pets: readonly PetStatus[];
  /** The lines the pets said last, newest last, with how long ago. */
  recent: readonly { text: string; agoSeconds: number }[];
}

function ago(seconds: number): string {
  if (seconds < 90) return 'a moment ago';
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

/** `full` lists each pet's animations too: once is enough, the agent keeps them in mind. */
function momentLines(m: HostMoment, full = false): string[] {
  const idle = m.idleSeconds < 60 ? 'just now' : ago(m.idleSeconds);
  const lines = [
    `It is ${two(m.hour)}:${two(m.minute)} (${dayPart(m.hour)}). The user last touched the keyboard or mouse ${idle}.`,
    full ? describePets(m.pets) : describePetsBrief(m.pets),
  ];
  if (m.recent.length > 0) {
    lines.push(`What the pets said last: ${m.recent.slice(-4).map((r) => `"${r.text}" (${ago(r.agoSeconds)})`).join('; ')}.`);
  }
  return lines;
}

/** The user typed `text` to `pet` (null: to the pets). */
export interface HostSay {
  pet: string | null;
  text: string;
}

function chatLines(says: readonly HostSay[]): string[] {
  const clean = (t: string): string => t.replace(/\s+/g, ' ').trim().slice(0, HOST_CHAT_MAX);
  return [
    ...says.map((s) => `The user types to ${s.pet ?? 'the pets'}: ${JSON.stringify(clean(s.text))}`),
    'Answer in character with pet_say (from the pet they spoke to), plus an animation or mood if it fits, then pet_rest '
    + 'for a short while in case they write back.',
  ];
}

/**
 * The first prompt of a session: who the agent is, what it may do, and the first moment. `language` is the user's, in
 * English. Several lines are fine here: it goes over stdin, not as an argument.
 */
export function hostIntro(o: { language: string; activity: HostActivity; moment: HostMoment; says?: readonly HostSay[] }): string {
  const { min, max } = HOST_REST[o.activity];
  const says = o.says ?? [];
  return [
    'You are the mind of the desktop pets the user keeps on their screen with lolPing, and you stay on for as long as '
    + 'lolPing runs. Nobody asks you anything: every so often lolPing wakes you with a short note about the moment, and '
    + 'you decide what the pets do.',
    'You act only through the lolping-pets tools (pet_status, pet_say, pet_walk, pet_play, pet_rest). Use no other tool, '
    + 'never read or change files or run commands, and write no answer text: do it with the tools, then stop.',
    `Each wake-up: do what feels right: a pet runs somewhere new, says something, plays an animation. At most ${HOST_CALLS_MAX} `
    + `tool calls. Always end with pet_rest(seconds), how long you sleep until the next wake-up, ${min} to ${max} seconds: `
    + 'longer when nothing is going on or the user seems busy or away, shorter while something is going on or the user is '
    + 'chatting with a pet. pet_rest ends the wake-up: after it, make no more calls and write nothing.',
    'Be alive, not noisy: vary what you do, never repeat yourself, and mostly do small things. One pet speaks at a time; '
    + `give each its own voice. A line is one short sentence of at most ${PET_SAY_MAX} characters in ${o.language}, `
    + 'friendly and playful, in character, and a pet never says it is an AI or talks about tools.',
    'You learn the time of day, how long ago the user last used the computer and where the pets are, never anything from '
    + 'their screen or files, and you must not claim to see them. When the user types to a pet you get their words and '
    + 'answer as that pet.',
    ...momentLines(o.moment, true),
    ...(says.length > 0 ? chatLines(says) : ['This is your first wake-up: say hello in your own way, then pet_rest.']),
  ].join('\n');
}

/** A wake-up of a session that is already on. */
export function hostWake(m: HostMoment): string {
  return ['Wake-up.', ...momentLines(m), 'Do something (or nothing), then pet_rest.'].join('\n');
}

/** What the user typed, with the moment. */
export function hostChat(o: { says: readonly HostSay[]; moment: HostMoment }): string {
  return [...chatLines(o.says), ...momentLines(o.moment)].join('\n');
}

export { DOUBLE_TAP_MS, TAP_MAX_MOVE, TAP_MAX_MS, isTap } from '../petIpc';

/** The box the user types to a pet in. */
export const CHAT_SIZE = { width: 300, height: 48 } as const;
const CHAT_GAP = 6;

/** Where the chat box goes for a pet in window `pet`: beside it, on the left unless that runs off `area`, and inside `area`. */
export function chatAt(
  pet: { x: number; y: number; width: number; height: number },
  area: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  let x = pet.x - CHAT_SIZE.width - CHAT_GAP;
  if (x < area.x) x = pet.x + pet.width + CHAT_GAP;
  return {
    x: clamp(x, area.x, area.x + area.width - CHAT_SIZE.width),
    y: clamp(Math.round(pet.y + pet.height / 2 - CHAT_SIZE.height / 2), area.y, area.y + area.height - CHAT_SIZE.height),
  };
}

/** A model Copilot CLI offers: `cost` is its price multiplier as it words it ("0.33x"), when it says. */
export interface HostModel {
  id: string;
  name: string;
  cost: string | null;
}

/** Models to offer when the list can't be had from Copilot CLI. */
export const FALLBACK_HOST_MODELS: readonly HostModel[] = [
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', cost: '0.33x' },
  { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', cost: null },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex', cost: null },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The models in a `session/new` result (`models.availableModels`); an entry that doesn't fit is left out. */
export function parseHostModels(result: unknown): HostModel[] {
  const models = isRecord(result) && isRecord(result.models) ? result.models.availableModels : null;
  if (!Array.isArray(models)) return [];
  return models.flatMap((m): HostModel[] => {
    if (!isRecord(m)) return [];
    const id = hostModel(m.modelId);
    if (id === null) return [];
    const meta = isRecord(m._meta) ? m._meta : {};
    const cost = typeof meta.copilotUsage === 'string' && meta.copilotUsage.length <= 12 ? meta.copilotUsage : null;
    const name = typeof m.name === 'string' && m.name.trim() !== '' ? m.name.trim().slice(0, 60) : id;
    return [{ id, name, cost }];
  });
}
