// Run outside Jest so Tailwind's native scanner and ESM plugins use Node resolution.
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const ts = require('typescript');

async function main() {
  const classes = JSON.parse(fs.readFileSync(0, 'utf8'));
  const entry = path.resolve('src/app/globals.css');
  const config = require(path.resolve('postcss.config.js'));
  const plugins = Object.entries(config.plugins).map(([name, options]) =>
    require(name)(options),
  );
  const result = await postcss(plugins).process(
    fs.readFileSync(entry, 'utf8') +
      '\n@source inline(' +
      JSON.stringify(classes.join(' ')) +
      ');',
    { from: entry },
  );

  // Use the real component's button classes as the input to theme selector tests.
  const component = ts.createSourceFile(
    'DownloadBubble.tsx',
    fs.readFileSync('src/components/DownloadBubble.tsx', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let gradientButtonClass;
  function visit(node) {
    if (
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText(component) === 'button'
    ) {
      const attribute = node.attributes.properties.find(
        (prop) =>
          ts.isJsxAttribute(prop) &&
          prop.name.getText(component) === 'className',
      );
      if (attribute?.initializer && ts.isStringLiteral(attribute.initializer)) {
        gradientButtonClass = attribute.initializer.text;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(component);
  process.stdout.write(
    JSON.stringify({
      css: result.css,
      themeCss: fs.readFileSync('src/app/cinema-ui.css', 'utf8'),
      gradientButtonClass,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
