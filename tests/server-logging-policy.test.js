/** @jest-environment node */
const { findDirectConsole } = require('../scripts/logging-policy.cjs');

test('detects direct console access even if an inline lint directive disables the rule', () => {
  expect(
    findDirectConsole(
      '/* eslint-disable no-console */\nconsole.error(secret);',
      'file.ts',
    ),
  ).toEqual([{ file: 'file.ts', line: 2 }]);
});

test('detects computed and aliased console access', () => {
  expect(
    findDirectConsole('const log = console["log"];\nlog(value);', 'file.ts'),
  ).toHaveLength(1);
  expect(findDirectConsole('const { log } = console;', 'file.ts')).toHaveLength(
    1,
  );
});

test('allows the logger and text that only mentions console', () => {
  expect(
    findDirectConsole(
      'logger.error(error);\nconst help = "console.log(1)";\n// console.warn(x)',
      'file.ts',
    ),
  ).toEqual([]);
});

test.each([
  '(console as Console).error(secret)',
  '(<Console>console).error(secret)',
  '(console!).error(secret)',
  '(console satisfies Console).error(secret)',
  "globalThis['console'].error(secret)",
  'window[`console`].warn(secret)',
  "(globalThis as typeof globalThis)['console'].log(secret)",
  'let sink; sink = console; sink.error(secret)',
])('rejects ordinary equivalent console access: %s', (expression) => {
  expect(
    findDirectConsole(
      `/* eslint-disable no-console */\n${expression};`,
      'file.ts',
    ),
  ).toEqual([{ file: 'file.ts', line: 2 }]);
});

test('does not mistake unrelated properties named console for the global console', () => {
  expect(
    findDirectConsole(
      'const help = { console: "terminal" }; help.console;',
      'file.ts',
    ),
  ).toEqual([]);
});
