/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const helper = pathToFileURL(
  path.resolve('scripts/cloudflare-output-links.mjs')
).href;
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'puretv-cf-links-'));
});
afterEach(() => {
  if (
    !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
    !path.basename(root).startsWith('puretv-cf-links-')
  )
    throw new Error('Unsafe fixture cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}
function run(code) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { repairCloudflareOutputLinks, patchBundleEntry } from ${JSON.stringify(
        helper
      )}; ${code}`,
    ],
    { cwd: root, encoding: 'utf8', timeout: 10000 }
  );
}

test('rebases copied dependency links to patched output without modifying source files', () => {
  const packageSuffix = 'node_modules/.pnpm/next@fixture/node_modules/next';
  const original = path.join(root, packageSuffix);
  const output = path.join(root, '.open-next/server-functions/default');
  write(path.join(original, 'index.js'), 'module.exports = "unpatched";');
  write(
    path.join(output, packageSuffix, 'index.js'),
    'module.exports = "patched";'
  );
  fs.symlinkSync(
    original,
    path.join(output, 'node_modules/next'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const result = run(`
    import {createRequire} from 'node:module';
    const options={appPath:process.cwd(), monorepoRoot:process.cwd(), outputDir:process.cwd()+'/.open-next'};
    const first=repairCloudflareOutputLinks(options), second=repairCloudflareOutputLinks(options);
    const require=createRequire(process.cwd()+'/.open-next/server-functions/default/index.mjs');
    console.log(JSON.stringify({first,second,value:require('next')}));
  `);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    first: 1,
    second: 0,
    value: 'patched',
  });
  expect(fs.readFileSync(path.join(original, 'index.js'), 'utf8')).toBe(
    'module.exports = "unpatched";'
  );
});

test('rejects output paths outside .open-next and unknown adapter entry shapes', () => {
  const result = run(`
    for(const fn of [()=>repairCloudflareOutputLinks({appPath:process.cwd(),outputDir:process.cwd()+'/node_modules'}),()=>patchBundleEntry('export const unsupported = true;', 'file:///helper.mjs')]) {
      try { fn(); process.exitCode=1; } catch(error) { console.log(error.message); }
    }
  `);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/\.open-next/);
  expect(result.stdout).toMatch(/bundleServer/);
});
