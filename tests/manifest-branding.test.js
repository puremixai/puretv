/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tempRoot = fs.realpathSync(os.tmpdir());
let fixture;

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(tempRoot, 'puretv-manifest-test-'));
  fs.mkdirSync(path.join(fixture, 'scripts'));
  fs.copyFileSync(
    path.resolve(__dirname, '../scripts/generate-manifest.js'),
    path.join(fixture, 'scripts/generate-manifest.js'),
  );
});

afterEach(() => {
  const target = fs.realpathSync(fixture);
  if (
    path.dirname(target) !== tempRoot ||
    !path.basename(target).startsWith('puretv-manifest-test-')
  ) {
    throw new Error('Refusing to remove a fixture outside the test directory');
  }
  fs.rmSync(target, { recursive: true, force: true });
});

test.each([
  ['', 'PureTV'],
  ['家庭影院', '家庭影院'],
])('generates the installable app name for site override %s', (siteName, expected) => {
  const result = spawnSync(process.execPath, ['scripts/generate-manifest.js'], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, NEXT_PUBLIC_SITE_NAME: siteName },
  });
  expect(result.status).toBe(0);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture, 'public/manifest.json'), 'utf8'),
  );
  expect(manifest).toMatchObject({
    name: expected,
    short_name: expected,
    start_url: '/',
    scope: '/',
    display: 'standalone',
  });
});
