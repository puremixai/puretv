/** @jest-environment node */
const {
  parseVersion,
  compareVersionStrings,
} = require('../src/lib/semantic-version');

test.each([
  '0.1.0-dev.1',
  '0.1.0',
  '1.0.0-alpha.1+build.001',
  '1.0.0-x-y-z.--',
  '9007199254740993.0.0',
])('accepts a complete semantic version: %s', (version) => {
  expect(parseVersion(version)).not.toBeNull();
});

test.each([
  '',
  '1',
  '1.0',
  '01.0.0',
  '1.00.0',
  '1.0.01',
  '1.0.0.1',
  '1.0.0-dev.01',
  '1.0.0-dev..1',
  '1.0.0-',
  '1.0.0+',
  '1.0.0+build..1',
  'v1.0.0',
  ' 1.0.0',
  '1.0.0\n',
  null,
])('rejects malformed semantic versions: %p', (version) => {
  expect(parseVersion(version)).toBeNull();
  expect(compareVersionStrings(version, '0.1.0')).toBeNull();
});

test.each([
  ['0.1.0-dev.2', '0.1.0-dev.10'],
  ['0.1.0-dev.10', '0.1.0'],
  ['0.1.0', '0.2.0-dev.1'],
  ['1.0.0-alpha', '1.0.0-alpha.1'],
  ['1.0.0-alpha.1', '1.0.0-alpha.beta'],
  ['1.0.0-alpha.beta', '1.0.0-beta'],
  ['1.0.0-beta', '1.0.0-beta.2'],
  ['1.0.0-beta.2', '1.0.0-beta.11'],
  ['1.0.0-beta.11', '1.0.0-rc.1'],
  ['1.0.0-rc.1', '1.0.0'],
  ['1.0.0', '2.0.0'],
  ['0.1.9', '0.1.10'],
  ['9007199254740992.0.0', '9007199254740993.0.0'],
  ['0.1.0-dev.9007199254740992', '0.1.0-dev.9007199254740993'],
])('orders %s before %s without numeric precision loss', (older, newer) => {
  expect(compareVersionStrings(older, newer)).toBe(-1);
  expect(compareVersionStrings(newer, older)).toBe(1);
});

test.each([
  ['0.1.0-dev.1', '0.1.0-dev.1'],
  ['0.1.0-dev.1+build.1', '0.1.0-dev.1+build.2'],
  ['0.1.0', '0.1.0+001'],
])('ignores build metadata when comparing %s and %s', (left, right) => {
  expect(compareVersionStrings(left, right)).toBe(0);
});
