import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { DOUDIZHU_PAGE } from '../../../src/main/teammate/doudizhuPage';
import { SANGUOSHA_PAGE } from '../../../src/main/teammate/sanguoshaPage';
import { WEREWOLF_PAGE } from '../../../src/main/teammate/werewolfPage';

// A game page is a classic <script> in a real window, and a window owns its window, document,
// location and top for good: a top-level let, const, class or function with one of those names
// throws a SyntaxError and leaves the page blank. The jsdom page tests wrap the script in a
// function, which hides that. So each script is instantiated at the global scope of a fresh
// process that has the same four properties, and is stopped before its first statement runs.
// It has to be one process per script: what a script declares stays declared in its global.
const DRIVER = [
  "const vm = require('node:vm');",
  "for (const k of ['window', 'document', 'location', 'top']) {",
  '  Object.defineProperty(globalThis, k, { get() {}, enumerable: true, configurable: false });',
  '}',
  "const src = require('node:fs').readFileSync(0, 'utf8');",
  "try { vm.runInThisContext('throw 0;' + src); } catch (e) { process.stdout.write(e === 0 ? 'ok' : String(e)); }",
].join('\n');

function atWindowScope(script: string): string {
  return execFileSync(process.execPath, ['-e', DRIVER], {
    input: script, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
}

const scriptOf = (page: string): string => /<script>([\s\S]*)<\/script>/.exec(page)?.[1] ?? '';

const PAGES: Record<string, string> = { werewolf: WEREWOLF_PAGE, sanguosha: SANGUOSHA_PAGE, doudizhu: DOUDIZHU_PAGE };
const CLASHES: Record<string, string> = {
  top: 'let seat = null, top = null, hand = [];',
  location: 'const location = {};',
  document: 'class document {}',
  window: 'function window() {}',
};

describe('the game pages at the global scope of a window', () => {
  it.each(Object.keys(CLASHES))('is able to tell that %s is already taken', (name) => {
    expect(atWindowScope(CLASHES[name] as string)).toBe(`SyntaxError: Identifier '${name}' has already been declared`);
  });

  it('lets through the names that a window does not keep for itself', () => {
    expect(atWindowScope('let topSeat = null, name = 0, status = 0, parent = null, length = 0;')).toBe('ok');
  });

  it.each(Object.keys(PAGES))('lets the %s page script declare everything it declares', (name) => {
    const script = scriptOf(PAGES[name] as string);
    expect(script.length).toBeGreaterThan(1000);
    expect(atWindowScope(script)).toBe('ok');
  });
});
