import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['**/dist/**', '**/build/**', '**/public/**', '**/node_modules/**', 'server/prisma/migrations/**'],
  },
  js.configs.recommended,
  {
    rules: {
      // Deliberate best-effort swallows (e.g. `try { res.end() } catch {}`) are
      // a common, intentional pattern in this codebase — don't force a comment
      // on every one of them.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Server — Node ESM
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Client — React + browser
  {
    files: ['client/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      // Only the two classic hook-correctness rules — v7's "recommended" also
      // bundles React Compiler-oriented rules (set-state-in-effect,
      // preserve-manual-memoization) that don't apply: this app isn't opted
      // into the compiler, and adopting those rules would mean rearchitecting
      // working data-fetching effects for no behavioral benefit.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Editorial prose copy throughout the UI uses natural contractions
      // ("don't", "it's") — these are valid JSX text, not stray JS syntax.
      'react/no-unescaped-entities': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
