const fs = require('node:fs');
const path = require('node:path');

function summarizeWarnings(results, root) {
  const files = {};
  for (const result of results) {
    const file = path.relative(root, result.filePath).split(path.sep).join('/');
    for (const message of result.messages) {
      if (message.severity !== 1) continue;
      const rule = message.ruleId || 'unused-disable';
      files[file] ||= {};
      files[file][rule] = (files[file][rule] || 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(files)
      .sort()
      .map(([file, rules]) => [
        file,
        Object.fromEntries(Object.entries(rules).sort()),
      ]),
  );
}

function compareWarnings(current, baseline) {
  const increases = [];
  for (const [file, rules] of Object.entries(current)) {
    for (const [rule, count] of Object.entries(rules)) {
      const allowed = baseline[file]?.[rule] || 0;
      if (count > allowed) increases.push({ file, rule, count, allowed });
    }
  }
  return increases;
}

async function main() {
  const { ESLint } = require('eslint');
  const root = path.resolve(__dirname, '..');
  const baselinePath = path.join(root, '.eslint-baseline.json');
  const loggingViolations = require('./logging-policy.cjs').checkServerLogging(
    root,
  );
  if (loggingViolations.length) {
    for (const { file, line } of loggingViolations) {
      console.error(
        `${file}:${line}: use the shared logger; inline no-console suppression is not allowed.`,
      );
    }
    process.exitCode = 1;
    return;
  }
  const update = process.argv.includes('--update');
  if (process.argv.slice(2).some((arg) => arg !== '--update')) {
    throw new Error('Usage: node scripts/lint-baseline.cjs [--update]');
  }
  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintFiles(['src']);
  const errors = results.reduce((sum, item) => sum + item.errorCount, 0);
  const warnings = results.reduce((sum, item) => sum + item.warningCount, 0);
  if (errors) {
    const formatter = await eslint.loadFormatter('stylish');
    console.error(
      formatter.format(results.filter((result) => result.errorCount)),
    );
    process.exitCode = 1;
    return;
  }
  const current = summarizeWarnings(results, root);
  if (update) {
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({ version: 1, files: current }, null, 2) + '\n',
    );
    console.log(
      `ESLint baseline updated: ${warnings} warnings. Review and commit the baseline diff.`,
    );
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  if (
    baseline.version !== 1 ||
    !baseline.files ||
    typeof baseline.files !== 'object'
  ) {
    throw new Error(
      'Invalid ESLint baseline. Review the file before using lint:baseline.',
    );
  }
  const increases = compareWarnings(current, baseline.files);
  if (increases.length) {
    for (const { file, rule, count, allowed } of increases) {
      console.error(
        `${file}: ${rule}: ${count} warnings (baseline ${allowed}, +${count - allowed})`,
      );
    }
    console.error(
      'ESLint warning budget exceeded. Fix new warnings; do not update the baseline to bypass review.',
    );
    process.exitCode = 1;
  } else {
    console.log(
      `ESLint: 0 errors, ${warnings} existing warnings; no file/rule exceeds the baseline.`,
    );
  }
}

module.exports = { summarizeWarnings, compareWarnings };
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
