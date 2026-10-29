import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseLoungeGroup, parseLoungeSend, parsePetChat, parsePetDrag, parsePetHit, PET_CH, PET_CHAT_MAX,
} from '../../src/shared/petIpc';

describe('parsePetChat', () => {
  it('reads a line the user typed, on one line and trimmed', () => {
    expect(parsePetChat('  hello\n there  ')).toBe('hello there');
  });

  it('cuts a long line', () => {
    expect(parsePetChat('a'.repeat(PET_CHAT_MAX + 50))).toHaveLength(PET_CHAT_MAX);
  });

  it('refuses what is not text or has no words', () => {
    expect(parsePetChat(null)).toBeNull();
    expect(parsePetChat({ text: 'hi' })).toBeNull();
    expect(parsePetChat('   \n ')).toBeNull();
  });
});

describe('parsePetDrag', () => {
  it('reads a phase and a position', () => {
    expect(parsePetDrag({ phase: 'move', x: 10, y: -4.5 })).toEqual({ phase: 'move', x: 10, y: -4.5 });
  });

  it('refuses anything else', () => {
    expect(parsePetDrag(null)).toBeNull();
    expect(parsePetDrag('start')).toBeNull();
    expect(parsePetDrag({ phase: 'drop', x: 1, y: 1 })).toBeNull();
    expect(parsePetDrag({ phase: 'start', x: Number.NaN, y: 1 })).toBeNull();
    expect(parsePetDrag({ phase: 'start', x: 1 })).toBeNull();
  });
});

describe('parseLoungeSend', () => {
  it('reads the room, who the user spoke to and the words, cut as a pet chat is', () => {
    expect(parseLoungeSend({ room: 'main', to: 'airi', text: '  hi\n you ' })).toEqual({ room: 'main', to: 'airi', text: 'hi you' });
    expect(parseLoungeSend({ room: 'g1abc', to: 'all', text: 'a'.repeat(PET_CHAT_MAX + 9) })).toMatchObject({ room: 'g1abc' });
    expect(parseLoungeSend({ room: 'main', to: 'all', text: 'a'.repeat(PET_CHAT_MAX + 9) })?.text).toHaveLength(PET_CHAT_MAX);
  });

  it('refuses a pet that does not exist, no words, no room, or anything that is not a message', () => {
    expect(parseLoungeSend({ room: 'main', to: 'dragon', text: 'hi' })).toBeNull();
    expect(parseLoungeSend({ room: 'main', to: 'user', text: 'hi' })).toBeNull();
    expect(parseLoungeSend({ room: 'main', to: 'all', text: '  ' })).toBeNull();
    expect(parseLoungeSend({ room: 'main', to: 'all' })).toBeNull();
    expect(parseLoungeSend({ room: 'main', text: 'hi' })).toBeNull();
    expect(parseLoungeSend({ to: 'all', text: 'hi' })).toBeNull();
    expect(parseLoungeSend({ room: 'lounge', to: 'all', text: 'hi' })).toBeNull();
    expect(parseLoungeSend({ room: 7, to: 'all', text: 'hi' })).toBeNull();
    expect(parseLoungeSend('hi')).toBeNull();
    expect(parseLoungeSend(null)).toBeNull();
  });
});

describe('parseLoungeGroup', () => {
  it('reads a new group, with only the pets that exist, once each', () => {
    expect(parseLoungeGroup({ op: 'save', id: null, name: 'Code club', members: ['airi', 'naiwa', 'airi', 'dragon'] }))
      .toEqual({ op: 'save', id: null, name: 'Code club', members: ['naiwa', 'airi'] });
  });

  it('reads a change to a group and a delete', () => {
    expect(parseLoungeGroup({ op: 'save', id: 'g1abc', name: 'X', members: ['airi', 'naiwa'] })).toMatchObject({ id: 'g1abc' });
    expect(parseLoungeGroup({ op: 'delete', id: 'g1abc' })).toEqual({ op: 'delete', id: 'g1abc' });
  });

  it('cuts a very long name down, to be cleaned where it is saved', () => {
    const msg = parseLoungeGroup({ op: 'save', id: null, name: 'n'.repeat(5000), members: [] });
    expect(msg?.op === 'save' && msg.name.length).toBeLessThan(200);
  });

  it('refuses anything that is not a group message', () => {
    expect(parseLoungeGroup({ op: 'delete', id: 'main' })).toBeNull();
    expect(parseLoungeGroup({ op: 'delete' })).toBeNull();
    expect(parseLoungeGroup({ op: 'save', id: 'main', name: 'X', members: [] })).toBeNull();
    expect(parseLoungeGroup({ op: 'save', id: undefined, name: 'X', members: [] })).toBeNull();
    expect(parseLoungeGroup({ op: 'save', id: null, name: 3, members: [] })).toBeNull();
    expect(parseLoungeGroup({ op: 'rename', id: null, name: 'X' })).toBeNull();
    expect(parseLoungeGroup('save')).toBeNull();
    expect(parseLoungeGroup(null)).toBeNull();
  });
});

describe('parsePetHit', () => {
  it('reads whether the pointer is over the character', () => {
    expect(parsePetHit({ over: true })).toEqual({ over: true });
    expect(parsePetHit({ over: false })).toEqual({ over: false });
  });

  it('refuses a value that is not a boolean, so a page cannot make a pet swallow clicks by sending junk', () => {
    expect(parsePetHit(null)).toBeNull();
    expect(parsePetHit({})).toBeNull();
    expect(parsePetHit({ over: 1 })).toBeNull();
    expect(parsePetHit({ over: 'true' })).toBeNull();
    expect(parsePetHit(true)).toBeNull();
  });
});

describe('the pet preload', () => {
  // The preload is bundled on its own and cannot import this file, so it repeats the channel names.
  const source = readFileSync(join(__dirname, '..', '..', 'src', 'preload', 'pet.ts'), 'utf8');

  it.each(Object.values(PET_CH))('uses the channel %s', (channel) => {
    expect(source).toContain(`'${channel}'`);
  });

  it('has a channel each', () => {
    expect(new Set(Object.values(PET_CH)).size).toBe(Object.keys(PET_CH).length);
  });
});
