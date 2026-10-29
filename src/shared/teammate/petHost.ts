/**
 * Pets hosted by a coding agent that stays on: lolPing keeps one Copilot CLI session open (over the Agent Client
 * Protocol) and wakes it now and then with a short note about the moment. The agent decides what the pets do and
 * when it wants to be woken next. This is the pure part: settings values, prompts, the tool list and the process flags.
 */

import type { AgentRunSpec } from './agents';
import { PET_IDS, type PetId } from './pet';
import { PET_SAY_MAX, PET_TOOLS, PET_PLACES, describePets, describePetsBrief, type PetStatus } from './petControl';
import { NOTE_MAX, PET_NAMES, noteLines, type PetNote } from './petMind';
import { modelId } from './petText';
import type { AgentProfile, Profile } from './settings';
import type { ToolDef } from './tools';
import { MOODS } from './mood';

/** Roaming comes as visits (a fresh agent run each time) or as a host (one session that stays on). */
export const ROAM_KINDS = ['visit', 'host'] as const;
export type RoamKind = (typeof ROAM_KINDS)[number];

export const HOST_ACTIVITIES = ['calm', 'normal', 'lively'] as const;
export type HostActivity = (typeof HOST_ACTIVITIES)[number];

export const DEFAULT_ROAM_KIND: RoamKind = 'visit';
export const DEFAULT_HOST_ACTIVITY: HostActivity = 'normal';

export const roamKind = (raw: unknown): RoamKind => ROAM_KINDS.find((k) => k === raw) ?? DEFAULT_ROAM_KIND;
export const hostActivity = (raw: unknown): HostActivity => HOST_ACTIVITIES.find((a) => a === raw) ?? DEFAULT_HOST_ACTIVITY;

/** The profile that hosts the pets: only Copilot CLI speaks the protocol; the default profile if it is one, else the first. */
export function pickHostAgent(profiles: readonly Profile[], defaultProfile: string | null): AgentProfile | null {
  const copilots = profiles.filter((p): p is AgentProfile => p.kind === 'agent' && p.preset === 'copilot');
  return copilots.find((p) => p.id === defaultProfile) ?? copilots[0] ?? null;
}

/** A model id as Copilot CLI names it; null (its own choice) for anything else. */
export const hostModel = modelId;

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

export const HOST_TOOLS = [...PET_TOOLS, 'pet_remember', 'pet_forget', 'pet_rest'] as const;
export type HostTool = (typeof HOST_TOOLS)[number];

export const isHostTool = (name: string): name is HostTool => (HOST_TOOLS as readonly string[]).includes(name);

/**
 * The tools of one pet's mind. It is bound to its own pet, so none of them names which pet acts; `pet_say` may be
 * `to` another pet or everyone, `pet_walk` may go `beside` another pet, and the mind keeps notes with `pet_remember`.
 * `pet_rest` carries the sleep range of `activity`.
 */
export function hostToolDefs(activity: HostActivity): ToolDef[] {
  const { min, max } = HOST_REST[activity];
  return [
    {
      name: 'pet_status',
      description: 'List the pets that are showing: where each stands and which animations it has.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'pet_say',
      description: `Say a short line in a speech bubble above you (at most ${PET_SAY_MAX} characters). The user sees it, `
        + 'and so do the other pets. Name `to` when you are talking to a pet or to everyone; leave it out when you are '
        + 'talking to the user or just speaking up. The bubble goes away by itself.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'What you say: one or two short sentences.' },
          mood: { type: 'string', enum: MOODS, description: 'Optional: you act the feeling out.' },
          to: { type: 'string', enum: [...PET_IDS, 'all'], description: 'Optional: the pet you are talking to, or all.' },
        },
        required: ['text'],
      },
    },
    {
      name: 'pet_walk',
      description: 'Run somewhere on the main display. You stay there for a while, then walk home by yourself. Say where with '
        + '`to`, with `beside` (stand next to another pet, to talk to it), or with `x` and `y` (percent of the display: 0 is '
        + 'left/top, 100 is right/bottom), which win over `to`.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', enum: PET_PLACES, description: 'home, cursor (beside the mouse pointer), left or right (the bottom corners), top, center, or random.' },
          beside: { type: 'string', enum: PET_IDS, description: 'Another pet to stand next to.' },
          x: { type: 'number', description: 'Percent from the left edge, 0 to 100.' },
          y: { type: 'number', description: 'Percent from the top edge, 0 to 100.' },
        },
      },
    },
    {
      name: 'pet_play',
      description: 'Play one of your animations for a few seconds. Name one with `animation` (see pet_status), or give a '
        + '`mood` and you play your own animation for it.',
      parameters: {
        type: 'object',
        properties: {
          animation: { type: 'string', description: 'An animation you have, for example dance or wave.' },
          mood: { type: 'string', enum: MOODS, description: 'A feeling to act out, instead of naming an animation.' },
        },
      },
    },
    {
      name: 'pet_remember',
      description: `Keep a note you will read again whenever you start (one short sentence, at most ${NOTE_MAX} characters): `
        + 'what the user likes or told you, something you share with them, how another pet is. Not trivia.',
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: 'The note.' },
          about: { type: 'string', enum: ['user', ...PET_IDS], description: 'Optional: who it is about.' },
        },
        required: ['note'],
      },
    },
    {
      name: 'pet_forget',
      description: 'Drop one of your notes by its number, when it is no longer true or no longer matters.',
      parameters: {
        type: 'object',
        properties: { number: { type: 'number', description: 'The note\'s number in your list, from 1.' } },
        required: ['number'],
      },
    },
    {
      name: 'pet_rest',
      description: 'Say how long you sleep until lolPing wakes you again, in seconds. Call it last in every wake-up: '
        + `${min} to ${max} are allowed (anything else is moved into that range). Sleep shorter while something is going on. `
        + 'Someone speaking to you wakes you earlier.',
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

/** What lolPing tells a pet's mind about the moment: the clock, the user's idleness, the pets and what it said last. */
export interface HostMoment {
  hour: number;
  minute: number;
  /** Seconds since the user last touched the keyboard or mouse. */
  idleSeconds: number;
  /** Every pet showing, this one included. */
  pets: readonly PetStatus[];
  /** The lines this pet said last, newest last, with how long ago. */
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
    lines.push(`What you said last: ${m.recent.slice(-4).map((r) => `"${r.text}" (${ago(r.agoSeconds)})`).join('; ')}.`);
  }
  return lines;
}

/** Why a mind is woken: its own timer, someone speaking to it, or a line it overheard. */
export type WakeKind = 'timer' | 'direct' | 'overheard';

/** What a mind hears: lines already worded by `heardLine`, and why it woke. */
export interface HostHeard {
  kind: WakeKind;
  lines: readonly string[];
  /** The group the answer goes to, when the wake-up was about a group's talk; absent for the big room. */
  group?: string | null;
}

function heardLines(h: HostHeard | undefined): string[] {
  if (!h || h.lines.length === 0) return [];
  const clean = (t: string): string => t.replace(/\s+/g, ' ').trim().slice(0, HOST_CHAT_MAX + 80);
  const heard = h.lines.map((l) => `- ${clean(l)}`);
  const inGroup = h.group
    ? [
      `This was said in your group ${JSON.stringify(h.group)}: what you pet_say goes there, to everyone in it (set \`to\` `
      + 'only to single out one pet). Talk it over: give your own view, build on what the others said or disagree with it '
      + 'kindly, never just echo them, and answer the user if they asked. A line there may be two short sentences.',
    ]
    : [];
  if (h.kind === 'direct') {
    return [
      'Someone spoke to you:', ...heard,
      'Answer in character with pet_say (set `to` to the pet who spoke; leave it out when it was the user), plus an '
      + 'animation or mood if it fits, then pet_rest for a short while in case they answer. If a pet spoke, you may walk '
      + 'beside it first.',
      ...inGroup,
    ];
  }
  if (h.kind === 'overheard') {
    return [
      'You overheard:', ...heard,
      'Join in only if you have something to add (pet_say, a reaction with pet_play, or walk beside whoever spoke); '
      + 'otherwise do nothing. Then pet_rest.',
      ...inGroup,
    ];
  }
  return ['Meanwhile you heard:', ...heard, ...inGroup];
}

/** The pet a mind plays, as its intro needs it. */
export interface HostWho {
  id: PetId;
  /** The character: what the user wrote, else its own. */
  persona: string;
  notes: readonly PetNote[];
  /** The other pets showing, each with its character. */
  friends: readonly { id: PetId; persona: string }[];
  /** Pets may talk to one another. */
  social: boolean;
  /** The groups of pets the user made that this pet is in; none when absent. */
  groups?: readonly { name: string; members: readonly PetId[] }[];
}

/**
 * The first prompt of a pet's session: who it is, what it remembers, who else is about, what it may do, and the first
 * moment. `language` is the user's, in English. Several lines are fine here: it goes over stdin, not as an argument.
 */
export function hostIntro(o: {
  language: string; activity: HostActivity; moment: HostMoment; who: HostWho; heard?: HostHeard;
}): string {
  const { min, max } = HOST_REST[o.activity];
  const { who } = o;
  const friends = who.friends.length === 0
    ? 'You are the only pet showing right now.'
    : `The other pets showing: ${who.friends.map((f) => `${f.id} (${PET_NAMES[f.id]}: ${f.persona})`).join('; ')}.`;
  const groups = (who.groups ?? []).map((g) => {
    const others = g.members.filter((m) => m !== who.id).map((m) => PET_NAMES[m]).join(', ');
    return `${JSON.stringify(g.name)} (with ${others})`;
  });
  return [
    `You are ${PET_NAMES[who.id]} (${who.id}), a desktop pet the user keeps on their screen with lolPing, with a mind of `
    + 'your own. You stay on for as long as lolPing runs. Nobody asks you anything: every so often lolPing wakes you with a '
    + 'short note about the moment, and you decide what you do.',
    `Who you are: ${who.persona}`,
    friends,
    ...noteLines(who.notes),
    'You act only through the lolping-pets tools (pet_status, pet_say, pet_walk, pet_play, pet_remember, pet_forget, '
    + 'pet_rest). You are always the pet who acts: none of them takes a pet name for you. Use no other tool, never read '
    + 'or change files or run commands, and write no answer text: do it with the tools, then stop.',
    `Each wake-up: do what feels right: run somewhere new, say something, play an animation. At most ${HOST_CALLS_MAX} `
    + `tool calls. Always end with pet_rest(seconds), how long you sleep until the next wake-up, ${min} to ${max} seconds: `
    + 'longer when nothing is going on or the user seems busy or away, shorter while something is going on or someone is '
    + 'talking with you. pet_rest ends the wake-up: after it, make no more calls and write nothing.',
    ...(who.social && who.friends.length > 0
      ? [
        'The other pets are people to you: greet them, tease them, ask them things, stand next to one when you talk '
        + '(pet_walk beside), and answer when one speaks to you. When you talk to a pet, name it in pet_say `to`. '
        + 'Everything said in the room reaches you, but only what you are woken for.',
      ]
      : []),
    ...(groups.length > 0
      ? [
        `The user made groups of pets and you are in ${groups.join('; ')}. `
        + 'What is said in a group is heard only by its members. When you are woken by something said in a group, your '
        + 'pet_say answers in that group, to everyone in it: that is where the user and the pets talk things over, '
        + 'so when the user brings a problem there, think it through with the others rather than only chatting.',
      ]
      : []),
    'Keep what matters with pet_remember (what the user likes or told you, a joke you share, how another pet is), one '
    + 'short sentence each, and not trivia; you read your notes again whenever you start. Drop one that is no longer true '
    + 'with pet_forget(number).',
    'Be alive, not noisy: vary what you do, never repeat yourself, and mostly do small things. '
    + `A line is one short sentence of at most ${PET_SAY_MAX} characters in ${o.language}, friendly and in your own voice, `
    + 'and you never say you are an AI or talk about tools.',
    'You learn the time of day, how long ago the user last used the computer and where the pets are, never anything from '
    + 'their screen or files, and you must not claim to see them. When the user or a pet speaks to you, you get their words.',
    ...momentLines(o.moment, true),
    ...(o.heard && o.heard.lines.length > 0
      ? heardLines(o.heard)
      : ['This is your first wake-up: say hello in your own way, then pet_rest.']),
  ].join('\n');
}

/** A wake-up of a session that is already on: the moment, and what the mind heard if anything. */
export function hostWake(o: { moment: HostMoment; heard?: HostHeard }): string {
  const heard = heardLines(o.heard);
  return [
    o.heard?.kind === 'direct' ? 'Someone is talking to you.' : o.heard?.kind === 'overheard' ? 'Something was said.' : 'Wake-up.',
    ...momentLines(o.moment),
    ...(heard.length > 0 ? heard : ['Do something (or nothing), then pet_rest.']),
  ].join('\n');
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

/**
 * The models a page is shown, and where they come from: `live` was just asked of Copilot CLI, `cache` is what it said
 * last time (shown while a new answer is awaited, or when it can't be asked), `fallback` is the short built-in list.
 * `error` says why Copilot CLI couldn't be asked, if that is so.
 */
export interface HostModelList {
  models: HostModel[];
  source: 'live' | 'cache' | 'fallback';
  error: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The models read back from the file that keeps the last answer; whatever doesn't fit is left out. */
export function normalizeHostModels(raw: unknown): HostModel[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: HostModel[] = [];
  for (const m of raw) {
    if (!isRecord(m)) continue;
    const id = hostModel(m.id);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    const name = typeof m.name === 'string' && m.name.trim() !== '' ? m.name.trim().slice(0, 60) : id;
    const cost = typeof m.cost === 'string' && m.cost.length <= 12 ? m.cost : null;
    out.push({ id, name, cost });
  }
  return out.slice(0, 100);
}

/**
 * The models in a `session/new` result (`models.availableModels`); an entry that doesn't fit, or that the account can't
 * use, is left out. Copilot CLI lists `auto` twice (once bare): an id shows once, as its most complete entry.
 */
export function parseHostModels(result: unknown): HostModel[] {
  const models = isRecord(result) && isRecord(result.models) ? result.models.availableModels : null;
  if (!Array.isArray(models)) return [];
  const byId = new Map<string, { model: HostModel; rich: boolean }>();
  for (const m of models) {
    if (!isRecord(m)) continue;
    const id = hostModel(m.modelId);
    if (id === null) continue;
    const meta = isRecord(m._meta) ? m._meta : {};
    if (typeof meta.copilotEnablement === 'string' && meta.copilotEnablement !== 'enabled') continue;
    const cost = typeof meta.copilotUsage === 'string' && meta.copilotUsage.length <= 12 ? meta.copilotUsage : null;
    const name = typeof m.name === 'string' && m.name.trim() !== '' ? m.name.trim().slice(0, 60) : id;
    const rich = Object.keys(meta).length > 0;
    const seen = byId.get(id);
    if (!seen || (rich && !seen.rich)) byId.set(id, { model: { id, name, cost }, rich });
  }
  return [...byId.values()].map((e) => e.model);
}
