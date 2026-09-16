const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function isExpressionWrapper(node) {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}

function unwrapExpression(node) {
  while (isExpressionWrapper(node)) node = node.expression;
  return node;
}

function isGlobalObject(node) {
  const expression = unwrapExpression(node);
  return (
    ts.isIdentifier(expression) &&
    ['globalThis', 'global', 'window'].includes(expression.text)
  );
}

function findDirectConsole(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === 'console') {
      let expression = node;
      while (isExpressionWrapper(expression.parent))
        expression = expression.parent;
      const parent = expression.parent;
      const accessed =
        (ts.isPropertyAccessExpression(parent) ||
          ts.isElementAccessExpression(parent)) &&
        parent.expression === expression;
      const aliased =
        (ts.isVariableDeclaration(parent) &&
          parent.initializer === expression) ||
        (ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          parent.right === expression);
      const globalAccess =
        ts.isPropertyAccessExpression(parent) &&
        parent.name === node &&
        isGlobalObject(parent.expression);
      if (accessed || aliased || globalAccess) {
        violations.push({
          file,
          line:
            tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
        });
      }
    }
    if (ts.isElementAccessExpression(node) && isGlobalObject(node.expression)) {
      const name = unwrapExpression(node.argumentExpression);
      if (ts.isStringLiteralLike(name) && name.text === 'console') {
        violations.push({
          file,
          line:
            tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return violations;
}

function checkServerLogging(root) {
  const violations = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const file = path.relative(root, full).split(path.sep).join('/');
      if (
        file === 'src/lib/logger.ts' ||
        file.startsWith('src/lib/pancheck/vendor/')
      )
        continue;
      if (entry.isDirectory()) walk(full);
      else if (/\.[jt]sx?$/.test(entry.name)) {
        violations.push(
          ...findDirectConsole(fs.readFileSync(full, 'utf8'), file),
        );
      }
    }
  };
  walk(path.join(root, 'src/lib'));
  walk(path.join(root, 'src/app/api'));
  return violations;
}

module.exports = { findDirectConsole, checkServerLogging };
