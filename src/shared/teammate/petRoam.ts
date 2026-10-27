/**
 * Pets that roam on their own: now and then lolPing starts the user's coding agent in the background and lets it
 * do something small with the pets. What goes to the agent is this prompt and nothing from the screen.
 */

import type { AgentProfile, Profile } from './settings';

export const ROAM_MIN_MINUTES = 5;
export const ROAM_MAX_MINUTES = 240;
export const ROAM_DEFAULT_MINUTES = 15;
/** The gaps the settings page offers. */
export const ROAM_CHOICES = [5, 10, 15, 30, 60, 120] as const;

/** A time between visits that is a whole number of minutes within the limits; anything else is the default. */
export function roamMinutes(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return ROAM_DEFAULT_MINUTES;
  return Math.min(ROAM_MAX_MINUTES, Math.max(ROAM_MIN_MINUTES, Math.round(raw)));
}

/** The wait until the next visit: the chosen gap, 20 % shorter or longer so it doesn't tick like a clock. */
export function roamDelayMs(minutes: number, random: number): number {
  return Math.round(minutes * 60_000 * (0.8 + 0.4 * random));
}

/** The agent that visits: the default profile when it is an agent, else the first agent profile. */
export function pickRoamAgent(profiles: readonly Profile[], defaultProfile: string | null): AgentProfile | null {
  const agents = profiles.filter((p): p is AgentProfile => p.kind === 'agent');
  return agents.find((p) => p.id === defaultProfile) ?? agents[0] ?? null;
}

/** What the agent is nudged to do this time, so one visit doesn't look like the last. */
export const ROAM_IDEAS = [
  'Say something cheerful to the user.',
  'Walk to a new spot, then say what you are up to.',
  'Play an animation just for fun.',
  'Say something that fits the time of day.',
  'Run to the mouse pointer and say hi.',
  'Wander to a corner and play an animation there.',
] as const;

/** How many tool calls one visit may make; lolPing refuses the rest. */
export const ROAM_CALLS_MAX = 6;

const dayPart = (hour: number): string => {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'late at night';
};

/**
 * The one prompt of a visit; everything the agent knows is in it. `language` is the user's, in English. It is one
 * line: a Windows agent starts through cmd.exe, which can't hold a line break in an argument.
 */
export function roamPrompt(o: { language: string; hour: number; idea: number }): string {
  const idea = ROAM_IDEAS[Math.abs(Math.trunc(o.idea)) % ROAM_IDEAS.length];
  return [
    'You are the mind of the desktop pets the user keeps on their screen with lolPing. Nobody asked you anything: '
    + 'this is a short, idle moment for the pets.',
    'Use only the lolping pet tools, and make at most 3 calls. Call pet_status first to see who is on screen, '
    + 'then one or two of pet_say, pet_walk and pet_play. Name one pet with the `pet` argument instead of moving '
    + 'them all. Keep it small and in character.',
    `This time: ${idea}`,
    `A line a pet says is one short sentence in ${o.language}, friendly and a little playful. `
    + `It is ${dayPart(o.hour)} for the user.`,
    'Do not use any other tool, do not read or change files, do not run commands and do not write an answer: stop '
    + 'as soon as the pets have done it.',
  ].join(' ');
}
