import { describe, expect, it } from 'vitest';
import { gameArgs, replyText } from '../../../src/shared/teammate/gameBrain';

describe('gameArgs', () => {
  it('runs ACP with no tools and no standing context', () => {
    const args = gameArgs(null);
    expect(args).toContain('--acp');
    expect(args).toContain('--available-tools=lolping-none');
    expect(args).toContain('--no-custom-instructions');
    expect(args).not.toContain('--model');
  });

  it('adds the model when one is chosen', () => {
    expect(gameArgs('gpt-6-luna').slice(-2)).toEqual(['--model', 'gpt-6-luna']);
  });
});

describe('replyText', () => {
  it('trims a reply and gives null for an empty one', () => {
    expect(replyText('  {"a": 1}\n')).toBe('{"a": 1}');
    expect(replyText('   ')).toBeNull();
  });

  it('drops a notice before the first reply', () => {
    expect(replyText('Info: Disabled tools: a, b.Info: Unknown tool name: "x"{"say":"hi"}')).toBe('{"say":"hi"}');
    expect(replyText('Info: Disabled tools: a, b')).toBeNull();
  });

  it('keeps plain words as they are', () => {
    expect(replyText('I vote for 3.')).toBe('I vote for 3.');
  });
});
