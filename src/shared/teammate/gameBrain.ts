/**
 * What the games need of Copilot CLI as a mind: the arguments that start it with nothing but its words to offer, and the
 * reading of what it says back. `main/teammate/gameBrain.ts` runs it.
 */

/** A tool name that does not exist: the agent is left with no tool at all, so a turn is only a reply (and much faster). */
const NO_TOOLS = '--available-tools=lolping-none';

/** Copilot CLI's arguments for a game's minds: ACP over stdio, no tools, and as little standing context as it allows. */
export function gameArgs(model: string | null): string[] {
  return [
    '--acp', NO_TOOLS, '--disable-builtin-mcps', '--no-custom-instructions', '--no-ask-user', '--no-auto-update',
    ...(model === null ? [] : ['--model', model]),
  ];
}

/**
 * What a mind said, without the notice Copilot CLI may put before its first words (it names the tools it left out); null
 * when there is nothing left. A notice runs up to the first `{`, as a reply that is not an object has none to give.
 */
export function replyText(raw: string): string | null {
  let text = raw.trim();
  if (/^Info:/.test(text)) {
    const at = text.indexOf('{');
    text = at < 0 ? '' : text.slice(at);
  }
  return text === '' ? null : text;
}
