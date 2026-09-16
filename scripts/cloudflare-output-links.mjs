import fs from 'node:fs';
import path from 'node:path';

function inside(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    !relative.startsWith('..' + path.sep) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

// On Windows, pnpm junctions copied by OpenNext retain absolute source targets.
// Rebase only links in generated output so esbuild sees OpenNext's patched files.
export function repairCloudflareOutputLinks(options) {
  const expectedOutput = path.resolve(options.appPath, '.open-next');
  if (path.resolve(options.outputDir) !== expectedOutput) {
    throw new Error(
      'Cloudflare link repair only supports the application .open-next output directory'
    );
  }
  const output = path.join(expectedOutput, 'server-functions/default');
  if (fs.realpathSync(output) !== output)
    throw new Error('Cloudflare .open-next output must not be a link');
  const source = path.resolve(options.monorepoRoot || options.appPath);
  const plans = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = path.resolve(path.dirname(file), fs.readlinkSync(file));
        if (inside(output, target) || !inside(source, target)) continue;
        const destination = path.join(output, path.relative(source, target));
        // Optional platform dependencies can be excluded by the adapter.
        if (!fs.existsSync(destination)) continue;
        if (
          !inside(output, file) ||
          !inside(output, destination) ||
          !inside(output, fs.realpathSync(destination))
        ) {
          throw new Error(
            'Cloudflare dependency link would escape .open-next output'
          );
        }
        plans.push({ file, destination });
      } else if (entry.isDirectory()) walk(file);
    }
  }
  walk(output);
  for (const { file, destination } of plans) {
    // unlink removes the junction itself; never recursively delete its target.
    fs.unlinkSync(file);
    fs.symlinkSync(
      process.platform === 'win32'
        ? destination
        : path.relative(path.dirname(file), destination),
      file,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  }
  const nextPackage = fs.realpathSync(path.join(output, 'node_modules/next'));
  if (!inside(output, nextPackage)) {
    throw new Error(
      'Cloudflare Next dependency still resolves outside .open-next; refusing to bundle unpatched source'
    );
  }
  return plans.length;
}

export function patchBundleEntry(source, helperURL) {
  const target =
    /export async function bundleServer\(buildOpts, projectOpts\)\s*\{/g;
  if ([...source.matchAll(target)].length !== 1) {
    throw new Error(
      'Unsupported OpenNext bundleServer entry; recheck the Windows output-link hook for this adapter version'
    );
  }
  return (
    `import { repairCloudflareOutputLinks as __repairOutputLinks } from ${JSON.stringify(
      helperURL
    )};\n` + source.replace(target, '$&\n__repairOutputLinks(buildOpts);')
  );
}
