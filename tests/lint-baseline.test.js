/** @jest-environment node */
const path = require('node:path');
const {
  summarizeWarnings,
  compareWarnings,
} = require('../scripts/lint-baseline.cjs');

const root = path.resolve('lint-fixture');
const result = (file, rules) => ({
  filePath: path.join(root, file),
  messages: rules.map((ruleId) => ({ severity: 1, ruleId })),
});

test('counts warnings separately for each relative file and rule', () => {
  expect(
    summarizeWarnings(
      [
        result('src/a.ts', ['no-console', 'no-console', null]),
        result('src/b.ts', ['no-console']),
      ],
      root,
    ),
  ).toEqual({
    'src/a.ts': { 'no-console': 2, 'unused-disable': 1 },
    'src/b.ts': { 'no-console': 1 },
  });
});

test('rejects warnings moved to a different file even when the total is unchanged', () => {
  expect(
    compareWarnings(
      { 'src/b.ts': { 'no-console': 1 } },
      {
        'src/a.ts': { 'no-console': 1 },
      },
    ),
  ).toEqual([{ file: 'src/b.ts', rule: 'no-console', count: 1, allowed: 0 }]);
});

test('rejects warnings moved to a different rule in the same file', () => {
  expect(
    compareWarnings(
      { 'src/a.ts': { 'no-console': 1 } },
      {
        'src/a.ts': { 'react-hooks/exhaustive-deps': 1 },
      },
    ),
  ).toHaveLength(1);
});

test('accepts reductions but rejects an increase inside an existing group', () => {
  const baseline = { 'src/a.ts': { 'no-console': 2 } };
  expect(compareWarnings({}, baseline)).toEqual([]);
  expect(
    compareWarnings({ 'src/a.ts': { 'no-console': 1 } }, baseline),
  ).toEqual([]);
  expect(
    compareWarnings({ 'src/a.ts': { 'no-console': 3 } }, baseline),
  ).toEqual([{ file: 'src/a.ts', rule: 'no-console', count: 3, allowed: 2 }]);
});

test('ignores lint errors in the warning budget rather than making them acceptable', () => {
  const entry = result('src/a.ts', []);
  entry.messages.push({ severity: 2, ruleId: 'no-undef' });
  expect(summarizeWarnings([entry], root)).toEqual({});
});
