import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readMiddlewareMatchers(root) {
  const file = join(root, '.next/server/middleware-manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Required middleware manifest cannot be read: ${file}`, {
      cause: error,
    });
  }
  const matchers = Object.values(manifest.middleware || {}).flatMap(
    (entry) => entry.matchers || []
  );
  if (!matchers.length)
    throw new Error(
      'Required middleware manifest contains no middleware matchers'
    );
  for (const matcher of matchers) {
    if (typeof matcher.regexp !== 'string' || !matcher.regexp) {
      throw new Error(
        'Middleware manifest matcher is missing its compiled regexp'
      );
    }
    if (matcher.has?.length || matcher.missing?.length) {
      throw new Error(
        'EdgeOne middleware patch does not support conditional has/missing matchers'
      );
    }
    try {
      new RegExp(matcher.regexp);
    } catch (error) {
      throw new Error('Middleware manifest contains an invalid regexp', {
        cause: error,
      });
    }
  }
  return matchers;
}

function replaceOnce(code, pattern, replacement, label) {
  const matches = [...code.matchAll(new RegExp(pattern.source, 'g'))];
  if (matches.length !== 1) {
    throw new Error(
      `Required ${label} patch expected one target; found ${matches.length}. EdgeOne adapter output may have changed.`
    );
  }
  return code.replace(pattern, replacement);
}

function patchEnvironmentDefaults(code, scope, target, replacement) {
  const name = scope === 'context' ? 'process' : 'middleware';
  const value = scope === 'context' ? 'context.env' : 'env';
  const condition = scope === 'context' ? 'context?.env' : 'env';
  const marker = `/* edgeone-${name}-env-injected */`;
  const endMarker = `/* edgeone-${name}-env-injected-end */`;
  const block = `${marker}\nif (globalThis.process?.env && ${condition}) {\n  for (const [key, value] of Object.entries(${value})) {\n    if (globalThis.process.env[key] === undefined) globalThis.process.env[key] = value;\n  }\n}\n${endMarker}`;
  if (!code.includes(marker)) {
    return replaceOnce(
      code,
      target,
      `${replacement}\n${block}`,
      `${name} environment`
    );
  }
  // Only migrate the known previous assignment or our complete delimited block.
  // Runtime values (including explicit empty strings) must win over build defaults.
  const existing = code.includes(endMarker)
    ? new RegExp(
        `/\\* edgeone-${name}-env-injected \\*/[\\s\\S]*?/\\* edgeone-${name}-env-injected-end \\*/`
      )
    : new RegExp(
        `/\\* edgeone-${name}-env-injected \\*/\\s*if\\s*\\([^\\r\\n]*\\)\\s*\\{\\s*Object\\.assign\\(globalThis\\.process\\.env,\\s*${value.replace(
          '.',
          '\\.'
        )}\\);\\s*\\}`
      );
  return replaceOnce(code, existing, block, `existing ${name} environment`);
}

export function patchMiddlewareCode(input, matchers) {
  let code = input;
  const requestTarget = /let\s+request\s*=\s*context\.request\s*;/;
  // Verify the entry remains present even for previously patched output.
  if (!requestTarget.test(code))
    throw new Error('Required edge-function request handler was not found');
  code = patchEnvironmentDefaults(code, 'context', requestTarget, '$&');

  const signature =
    /async\s+function\s+executeMiddleware\s*\(\s*\{\s*request\s*(?:,\s*env\s*)?\}\s*\)\s*\{/;
  if (!signature.test(code))
    throw new Error(
      'Required middleware executeMiddleware handler was not found'
    );
  if (
    code.includes('/* edgeone-middleware-env-injected */') &&
    !/executeMiddleware\s*\(\s*\{\s*request\s*,\s*env\s*\}/.test(code)
  )
    throw new Error('Existing middleware environment patch is incomplete');
  code = patchEnvironmentDefaults(
    code,
    'middleware',
    signature,
    'async function executeMiddleware({request, env}) {'
  );

  // Migrate the previous prefix approximation. The manifest regexp below is the
  // authority, including its exact exclusion and base-path semantics.
  const oldMarker = '/* edgeone-middleware-matcher-fallback */';
  if (code.includes(oldMarker)) {
    code = replaceOnce(
      code,
      /\/\* edgeone-middleware-matcher-fallback \*\/[\s\S]*?if\s*\(edgeOneMiddlewareSkipPaths\.some\([\s\S]*?\)\s*\{\s*return null;\s*\}/,
      '',
      'legacy middleware matcher'
    );
  }
  const startMarker = '/* edgeone-middleware-manifest-matcher */';
  const endMarker = '/* edgeone-middleware-manifest-matcher-end */';
  const gate = `${startMarker}\nconst edgeOneMiddlewareMatchers = ${JSON.stringify(
    matchers.map((matcher) => matcher.regexp)
  )};\nif (!edgeOneMiddlewareMatchers.some((regexp) => new RegExp(regexp).test(pathname))) { return null; }\n${endMarker}`;
  code = replaceOnce(
    code,
    code.includes(startMarker)
      ? /\/\* edgeone-middleware-manifest-matcher \*\/[\s\S]*?\/\* edgeone-middleware-manifest-matcher-end \*\//
      : /if\s*\(!matchesPath\(pathname,\s*config\.matcher\)\)\s*\{\s*return null;\s*\}/,
    gate,
    'middleware manifest matcher'
  );
  return code;
}
