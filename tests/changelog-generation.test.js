/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../scripts/convert-changelog.js');
const tempRoot = fs.realpathSync(os.tmpdir());
let fixture;

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(tempRoot, 'puretv-version-test-'));
  fs.mkdirSync(path.join(fixture, 'src/lib'), { recursive: true });
});

afterEach(() => {
  const target = fs.realpathSync(fixture);
  if (
    path.dirname(target) !== tempRoot ||
    !path.basename(target).startsWith('puretv-version-test-')
  ) {
    throw new Error('Refusing to remove a fixture outside the test directory');
  }
  fs.rmSync(target, { recursive: true, force: true });
});

const run = (...args) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'false' },
  });

test('generates prerelease notes and safely escapes their text', () => {
  fs.writeFileSync(
    path.join(fixture, 'CHANGELOG'),
    '# PureTV\n\n## [0.1.0-dev.1] - 2026-09-14\n### Changed\n- Keeps "quoted" text and C:\\video paths\n',
  );
  const result = run();
  expect(result.status).toBe(0);
  const generated = fs.readFileSync(
    path.join(fixture, 'src/lib/changelog.ts'),
    'utf8',
  );
  const json = generated.match(
    /export const changelog: ChangelogEntry\[\] = (\[[\s\S]*\]);/,
  )[1];
  expect(JSON.parse(json)).toEqual([
    {
      version: '0.1.0-dev.1',
      date: '2026-09-14',
      added: [],
      changed: ['Keeps "quoted" text and C:\\video paths'],
      fixed: [],
    },
  ]);
});

test.each(['0.1.0-dev.1', '0.1.0', '0.1.0-dev.1+build.001'])(
  'generates the installed version from VERSION.txt: %s',
  (version) => {
    fs.writeFileSync(path.join(fixture, 'VERSION.txt'), version + '\n');
    expect(run('--sync-version').status).toBe(0);
    expect(
      fs.readFileSync(path.join(fixture, 'src/lib/version.ts'), 'utf8'),
    ).toContain(`const CURRENT_VERSION = '${version}';`);
  },
);

test.each(['1..0', '0.1.0-dev.01', '0.1', '0.1.0;process.exit(0)'])(
  'rejects an invalid installed version without overwriting generated code: %s',
  (version) => {
    fs.writeFileSync(path.join(fixture, 'VERSION.txt'), version);
    fs.writeFileSync(path.join(fixture, 'src/lib/version.ts'), 'unchanged');
    expect(run('--sync-version').status).not.toBe(0);
    expect(
      fs.readFileSync(path.join(fixture, 'src/lib/version.ts'), 'utf8'),
    ).toBe('unchanged');
  },
);

test('fails on a malformed release heading rather than merging its notes into the previous version', () => {
  fs.writeFileSync(
    path.join(fixture, 'CHANGELOG'),
    '# PureTV\n\n## [0.1.0] - 2026-09-14\n### Added\n- First release\n\n## [0.1.0-dev.01] - 2026-09-13\n### Changed\n- Invalid release\n',
  );
  fs.writeFileSync(path.join(fixture, 'src/lib/changelog.ts'), 'unchanged');
  expect(run().status).not.toBe(0);
  expect(
    fs.readFileSync(path.join(fixture, 'src/lib/changelog.ts'), 'utf8'),
  ).toBe('unchanged');
});
