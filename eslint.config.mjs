import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';

// Preserve the existing lint baseline while enabling React Compiler per component.
const legacyHookRules = {
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'warn',
};
const compilerRules = Object.fromEntries(
  nextVitals
    .flatMap((config) => Object.keys(config.rules || {}))
    .filter(
      (rule) => rule.startsWith('react-hooks/') && !(rule in legacyHookRules)
    )
    .map((rule) => [rule, 'warn'])
);

export default [
  {
    ignores: [
      '.next/**',
      '.next-dev/**',
      '.open-next/**',
      '.edgeone/**',
      '.data/**',
      'public/sw.js',
      'public/workbox-*.js',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...nextVitals,
  ...nextTypescript,
  prettier,
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    languageOptions: { globals: { React: 'readonly', JSX: 'readonly' } },
    rules: {
      ...{
        'no-unused-vars': 'off',
        'no-console': 'warn',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        'react/no-unescaped-entities': 'off',
        'react/display-name': 'off',
        'react/jsx-curly-brace-presence': [
          'warn',
          {
            props: 'never',
            children: 'never',
          },
        ],
        '@typescript-eslint/no-unused-vars': 'off',
        'unused-imports/no-unused-imports': 'warn',
        'unused-imports/no-unused-vars': [
          'warn',
          {
            vars: 'all',
            varsIgnorePattern: '^_',
            args: 'after-used',
            argsIgnorePattern: '^_',
          },
        ],
        'simple-import-sort/exports': 'warn',
        'simple-import-sort/imports': [
          'warn',
          {
            groups: [
              ['^@?\\w', '^\\u0000'],
              ['^.+\\.s?css$'],
              ['^@/lib', '^@/hooks'],
              ['^@/data'],
              ['^@/components', '^@/container'],
              ['^@/store'],
              ['^@/'],
              [
                '^\\./?$',
                '^\\.(?!/?$)',
                '^\\.\\./?$',
                '^\\.\\.(?!/?$)',
                '^\\.\\./\\.\\./?$',
                '^\\.\\./\\.\\.(?!/?$)',
                '^\\.\\./\\.\\./\\.\\./?$',
                '^\\.\\./\\.\\./\\.\\.(?!/?$)',
              ],
              ['^@/types'],
              ['^'],
            ],
          },
        ],
      },
      ...compilerRules,
      ...legacyHookRules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
  {
    files: ['src/lib/**/*.{js,jsx,ts,tsx}', 'src/app/api/**/*.{js,jsx,ts,tsx}'],
    ignores: ['src/lib/logger.ts', 'src/lib/pancheck/vendor/**'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['src/lib/pancheck/vendor/checkers/*.ts'],
    rules: { '@typescript-eslint/ban-ts-comment': 'off' },
  },
];
