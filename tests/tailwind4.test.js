const path = require('node:path');
const { spawnSync } = require('node:child_process');
const postcss = require('postcss');
const { twMerge } = require('tailwind-merge');

const projectRoot = path.resolve(__dirname, '..');
const candidates = [
  'dark:bg-primary-700',
  'mobile-landscape:h-16',
  'bg-primary-500',
  'font-primary',
  'animate-flicker',
  'animate-shimmer',
  'animate-fade-in',
  'animate-slide-up',
  'animate-slide-down',
  'animate-slide-in-from-right',
  'form-input',
  'prose',
  'prose-headings:text-primary-700',
  'scrollbar-hide',
  'sm:scrollbar-hide',
  'mobile-landscape:scrollbar-hide',
  'shadow-xs',
  'outline-hidden',
  'outline-none',
  'text-gray-900',
];
let css;
let themeCss;
let gradientButtonClass;

beforeAll(() => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'helpers/tailwind4-compile.cjs')],
    {
      cwd: projectRoot,
      input: JSON.stringify(candidates),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      result.error?.message || result.stderr || 'PostCSS compilation failed',
    );
  const compiled = JSON.parse(result.stdout);
  css = postcss.parse(compiled.css);
  themeCss = postcss.parse(compiled.themeCss);
  gradientButtonClass = compiled.gradientButtonClass;
}, 65000);

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  document.documentElement.className = '';
});

function rulesFor(className) {
  const selector = '.' + className.replace(/([^\w-])/g, '\\$1');
  const matches = [];
  css.walkRules((rule) => {
    const index = rule.selector.indexOf(selector);
    if (
      index >= 0 &&
      !/[\w-]/.test(rule.selector[index + selector.length] || '')
    )
      matches.push(rule);
  });
  return matches;
}

function declarations(node, property) {
  return (node.nodes || [])
    .filter((child) => child.type === 'decl' && child.prop === property)
    .map((child) => child.value);
}

function ancestors(node, name) {
  const matches = [];
  for (let parent = node.parent; parent; parent = parent.parent)
    if (parent.type === 'atrule' && parent.name === name)
      matches.push(parent.params);
  return matches;
}

function rootValue(property) {
  const values = [];
  css.walkDecls(property, (decl) => values.push(decl.value));
  return values;
}

test('scans actual component utilities without allowing tests into the source scan', () => {
  expect(rulesFor('hover:scale-110').length).toBeGreaterThan(0);
  // This unique candidate exists only in tests, outside the configured src tree.
  expect(rulesFor('z-[918273]')).toHaveLength(0);
});

test('dark utilities follow the .dark class independently of the system color scheme', () => {
  const rule = rulesFor('dark:bg-primary-700').find(
    (node) => declarations(node, 'background-color').length,
  );
  expect(rule).toBeDefined();
  expect(ancestors(rule, 'media').join(' ')).not.toContain(
    'prefers-color-scheme',
  );
  const element = document.createElement('div');
  element.className = 'dark:bg-primary-700';
  document.body.append(element);
  expect(element.matches(rule.selector)).toBe(false);
  document.documentElement.classList.add('dark');
  expect(element.matches(rule.selector)).toBe(true);
  document.documentElement.classList.remove('dark');
  expect(element.matches(rule.selector)).toBe(false);
  expect(declarations(rule, 'background-color')).toEqual([
    'var(--color-primary-700)',
  ]);
});

test('mobile-landscape keeps its short landscape viewport restriction', () => {
  const rule = rulesFor('mobile-landscape:h-16')[0];
  expect(rule).toBeDefined();
  expect(ancestors(rule, 'media').join(' ')).toMatch(
    /orientation:\s*landscape/,
  );
  expect(ancestors(rule, 'media').join(' ')).toMatch(/max-height:\s*700px/);
  expect(declarations(rule, 'height')).toEqual(['calc(var(--spacing) * 16)']);
});

test('custom primary color and Inter font resolve through generated theme variables', () => {
  expect(
    declarations(rulesFor('bg-primary-500')[0], 'background-color'),
  ).toEqual(['var(--color-primary-500)']);
  expect(rootValue('--color-primary-500')).toContain('#0ea5e9');
  expect(declarations(rulesFor('font-primary')[0], 'font-family')).toEqual([
    'var(--font-primary)',
  ]);
  expect(rootValue('--font-primary').join(' ')).toMatch(
    /Inter.*ui-sans-serif.*system-ui/,
  );
});

test.each([
  ['flicker', 'flicker', '3s', 'opacity', '0.99'],
  ['shimmer', 'shimmer', '1.3s', 'background-position', '700px 0'],
  ['fade-in', 'fadeIn', '0.3s', 'opacity', '1'],
  ['slide-up', 'slideUp', '0.3s', 'transform', 'translateY(0)'],
  ['slide-down', 'slideDown', '0.3s', 'transform', 'translateY(0)'],
  [
    'slide-in-from-right',
    'slideInFromRight',
    '0.3s',
    'transform',
    'translateX(0)',
  ],
])(
  'animate-%s retains its timing and terminal keyframe',
  (utility, name, duration, prop, value) => {
    expect(
      declarations(rulesFor('animate-' + utility)[0], 'animation'),
    ).toEqual(['var(--animate-' + utility + ')']);
    const animation = rootValue('--animate-' + utility).join(' ');
    expect(animation.split(/\s+/)).toEqual(
      expect.arrayContaining([name, duration]),
    );
    const terminalValues = [];
    css.walkAtRules('keyframes', (keyframes) => {
      if (keyframes.params !== name) return;
      keyframes.walkRules((frame) => {
        if (
          frame.selector
            .split(',')
            .map((part) => part.trim())
            .includes('100%')
        )
          terminalValues.push(...declarations(frame, prop));
      });
    });
    expect(terminalValues).toContain(value);
  },
);

test('forms plugin still resets inputs and provides a visible focus ring', () => {
  const input = rulesFor('form-input')[0];
  expect(input).toBeDefined();
  expect(declarations(input, 'appearance')).toContain('none');
  expect(declarations(input, 'border-width')).toContain('1px');
  const focus = [];
  input.walkRules((rule) => {
    if (rule.selector.includes(':focus'))
      focus.push(...declarations(rule, 'box-shadow'));
  });
  expect(focus.join(' ')).toContain('--tw-ring-shadow');
});

test('typography plugin styles headings while excluding nested not-prose content', () => {
  const prose = rulesFor('prose')[0];
  expect(prose).toBeDefined();
  expect(declarations(prose, 'max-width')).toContain('65ch');
  const headingRules = [];
  prose.walkRules((rule) => {
    if (
      rule.selector.includes(':where(h1)') &&
      declarations(rule, 'font-size').length
    )
      headingRules.push(rule);
  });
  expect(headingRules.length).toBeGreaterThan(0);
  expect(
    headingRules.every((rule) => rule.selector.includes('not-prose')),
  ).toBe(true);
  const overrides = rulesFor('prose-headings:text-primary-700');
  const colors = [];
  overrides.forEach((rule) =>
    rule.walkDecls('color', (decl) => colors.push(decl.value)),
  );
  expect(colors).toContain('var(--color-primary-700)');
});

test.each([
  ['scrollbar-hide', null],
  ['sm:scrollbar-hide', /width\s*>=\s*40rem|min-width:\s*40rem/],
  ['mobile-landscape:scrollbar-hide', /orientation:\s*landscape/],
])(
  '%s hides Firefox and WebKit scrollbars in the same responsive scope',
  (utility, media) => {
    const rules = rulesFor(utility);
    const firefox = rules.find((rule) =>
      declarations(rule, 'scrollbar-width').includes('none'),
    );
    const scopedRules = [...rules];
    rules.forEach((rule) => rule.walkRules((child) => scopedRules.push(child)));
    const webkit = scopedRules.find((rule) =>
      rule.selector.includes('::-webkit-scrollbar'),
    );
    expect(firefox).toBeDefined();
    expect(webkit).toBeDefined();
    expect(declarations(webkit, 'display')).toContain('none');
    expect(ancestors(webkit, 'media')).toEqual(ancestors(firefox, 'media'));
    if (media) expect(ancestors(firefox, 'media').join(' ')).toMatch(media);
    else expect(ancestors(firefox, 'media')).toEqual([]);
  },
);

test('shadow-xs retains the migrated small control shadow', () => {
  const shadow = rulesFor('shadow-xs')[0];
  expect(shadow).toBeDefined();
  expect(declarations(shadow, '--tw-shadow').join(' ')).toMatch(
    /^0 1px 2px 0 /,
  );
  expect(declarations(shadow, 'box-shadow').join(' ')).toContain(
    'var(--tw-shadow)',
  );
});

test('outline-hidden preserves forced-colors focus unlike the explicit outline-none utility', () => {
  const hidden = rulesFor('outline-hidden')[0];
  const none = rulesFor('outline-none')[0];
  expect(declarations(hidden, 'outline-style')).toContain('none');
  expect(declarations(none, 'outline-style')).toContain('none');
  const forced = [];
  hidden.walkAtRules('media', (rule) => {
    if (rule.params.includes('forced-colors: active')) forced.push(rule);
  });
  expect(forced).toHaveLength(1);
  expect(declarations(forced[0], 'outline')).toContain('2px solid transparent');
  const unwanted = [];
  none.walkAtRules('media', (rule) => unwanted.push(rule));
  expect(unwanted).toHaveLength(0);
});

test('body text utilities can override the global base color under native cascade layers', () => {
  const bodyColors = [];
  css.walkRules((rule) => {
    if (
      rule.selector
        .split(',')
        .map((part) => part.trim())
        .includes('body') &&
      declarations(rule, 'color').length
    )
      bodyColors.push(rule);
  });
  expect(bodyColors.length).toBeGreaterThan(0);
  bodyColors.forEach((rule) => {
    expect(ancestors(rule, 'layer')).toContain('base');
    rule.walkDecls('color', (decl) =>
      expect(Boolean(decl.important)).toBe(false),
    );
  });
  const text = rulesFor('text-gray-900')[0];
  expect(ancestors(text, 'layer')).toContain('utilities');
  expect(declarations(text, 'color')).toContain('var(--color-gray-900)');
  const order = [];
  css.walkAtRules('layer', (rule) => {
    if (!rule.nodes)
      order.push(...rule.params.split(',').map((part) => part.trim()));
  });
  expect(order.indexOf('base')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('utilities')).toBeGreaterThan(order.indexOf('base'));
});

function gradientButton() {
  expect(typeof gradientButtonClass).toBe('string');
  const scope = document.createElement('div');
  scope.className = 'cinema-ui';
  const button = document.createElement('button');
  button.className = gradientButtonClass;
  scope.append(button);
  document.body.append(scope);
  return { scope, button };
}

test('cinema theme matches the real download button after gradient utility renaming', () => {
  const { scope, button } = gradientButton();
  const matches = [];
  themeCss.walkRules((rule) => {
    if (
      declarations(rule, 'background-image').includes('none') &&
      button.matches(rule.selector)
    )
      matches.push(rule);
  });
  expect(matches.length).toBeGreaterThan(0);
  const themeRule = matches.find(
    (rule) => declarations(rule, 'background-color').length,
  );
  expect(themeRule).toBeDefined();
  scope.classList.add('cinema-reading');
  expect(button.matches(themeRule.selector)).toBe(false);
  scope.classList.remove('cinema-reading');
  button.classList.add('from-red-500');
  expect(button.matches(themeRule.selector)).toBe(false);
});

test('music theme text override still matches a migrated gradient control', () => {
  const { scope, button } = gradientButton();
  const music = document.createElement('section');
  music.dataset.cinemaSpecialty = 'music';
  scope.append(music);
  music.append(button);
  const overrides = [];
  themeCss.walkRules((rule) => {
    if (
      rule.selector.includes('data-cinema-specialty') &&
      button.matches(rule.selector)
    )
      rule.walkDecls('color', (decl) => {
        if (decl.important) overrides.push(decl.value);
      });
  });
  expect(overrides).toContain('#111318');
});

test.each([
  ['shadow-xs shadow-sm', 'shadow-sm'],
  ['outline-hidden outline-none', 'outline-none'],
  ['bg-linear-to-r bg-linear-to-br', 'bg-linear-to-br'],
  ['bg-linear-to-r bg-radial', 'bg-radial'],
  ['shadow-xs hover:shadow-xs hover:shadow-lg', 'shadow-xs hover:shadow-lg'],
])(
  'merges migrated utility conflicts without dropping separate variants: %s',
  (input, output) => {
    expect(twMerge(input)).toBe(output);
  },
);
