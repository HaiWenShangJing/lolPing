import { describe, expect, it } from 'vitest';
import { hpTone, ringScript, type RingMsg } from '../../src/shared/ringMsg';

/** Runs the script the way the overlay's page does, and returns what `window.ring` was called with. */
function deliver(script: string): unknown {
  let got: unknown = null;
  new Function('window', script)({ ring: (msgs: unknown) => (got = msgs) });
  return got;
}

describe('ringScript', () => {
  const msgs: RingMsg[] = [
    { op: 'init', plates: [{ x: 10, y: 20, width: 150, name: 'Whale', color: '#4fc3f7' }, { x: 300, y: 20, width: 150, name: 'Mao', color: '#f06292' }] },
    { op: 'bar', side: 0, hp: 64, fury: 30 },
    { op: 'pop', x: 100, y: 120, kind: 'crit', text: 'CRIT -28' },
    { op: 'banner', kind: 'win', text: 'Whale wins!', sub: 'by a knockout', ms: 3000 },
  ];

  it('hands the page exactly the messages, in order', () => {
    expect(deliver(ringScript(msgs))).toEqual(msgs);
  });

  it('keeps a word that looks like code or markup as a word', () => {
    const nasty: RingMsg[] = [
      { op: 'pop', x: 1, y: 2, kind: 'hit', text: '"); window.hacked = 1; ("' },
      { op: 'banner', kind: 'win', text: '</script><img src=x onerror=alert(1)>\n\u2028\u2029', ms: 1000 },
    ];
    expect(deliver(ringScript(nasty))).toEqual(nasty);
  });

  it('delivers nothing but a call', () => {
    expect(ringScript([])).toBe('window.ring([])');
    expect(ringScript(msgs).startsWith('window.ring(')).toBe(true);
  });
});

describe('hpTone', () => {
  it('is green above half, amber from half, red from a quarter', () => {
    expect(hpTone(100)).toBe('ok');
    expect(hpTone(51)).toBe('ok');
    expect(hpTone(50)).toBe('low');
    expect(hpTone(26)).toBe('low');
    expect(hpTone(25)).toBe('critical');
    expect(hpTone(1)).toBe('critical');
    expect(hpTone(0)).toBe('critical');
  });
});
