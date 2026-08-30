// @ts-check
/**
 * One ESLint config for three runtimes.
 *
 * This repo is not a monorepo with a framework preset to inherit from — it is a
 * Cloudflare Worker, an Expo/React Native app and a set of plain ESM modules and
 * CLIs that all import the same `shared/` code. Each has a different global
 * object and a different set of things that count as a mistake, so the config is
 * split by path rather than duplicated into three tool installs.
 *
 * Type-aware linting is deliberately NOT enabled. `npm run typecheck` already
 * runs `tsc --noEmit` against both the Worker's tsconfig and the app's
 * (`expo/tsconfig.base`, which resolves React Native's types) — that is the
 * authoritative type gate. Running typescript-eslint's type-checked rules would
 * mean a third, differently-configured type graph over the same files, whose
 * disagreements with `tsc` would be config bugs rather than code bugs.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'coverage/**',
      'docs/assets/**',
      '.wrangler/**',
      '.expo/**',
      'dist/**',
      // Emitted by scripts/seed.mjs and scripts/lunker-verify.mjs, byte-compared
      // in CI. Nothing hand-written lives here.
      'seed/**',
    ],
  },

  // ── Baseline for every JS/TS file in the repo ────────────────────────────
  js.configs.recommended,
  {
    linterOptions: {
      // An unused eslint-disable is a claim about a problem that no longer
      // exists. This repo documents each disable inline; a stale one is a stale
      // comment, so it fails.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-implicit-coercion': ['error', { boolean: false }],
      // Currency amounts, roll seeds and epoch milliseconds all round-trip
      // through this code. A silently-truncated float is exactly the class of
      // bug that would show up as a wrong balance.
      'no-loss-of-precision': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ── Node ESM: shared modules, CLIs, tests, tool configs ──────────────────
  {
    files: [
      'shared/**/*.js',
      'scripts/**/*.mjs',
      'tests/**/*.js',
      'vitest.config.js',
      'eslint.config.mjs',
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },

  // ── Cloudflare Worker (TypeScript, Workers runtime) ──────────────────────
  {
    files: ['worker/src/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // @cloudflare/workers-types supplies the type-level globals; this supplies
      // the lint-level ones so `no-undef` is meaningful for the plain-JS rules.
      globals: { ...globals.worker, ...globals.serviceworker },
    },
    rules: {
      // The Worker is the only component holding the RevenueCat secret key and
      // the OneSignal REST key. `console.error` in the top-level catch is the
      // only place an unhandled failure is observable at all, and Workers logs
      // are the deploy's only telemetry surface.
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // A floating promise in a payment path is a grant that may never land.
      // (Not type-aware, so this catches the syntactic cases only; the real
      // guard is that every route awaits its RevenueCat call before responding.)
      'require-await': 'error',
    },
  },

  // ── Expo / React Native app ──────────────────────────────────────────────
  {
    files: ['app/**/*.{ts,tsx}', 'app/*.js'],
    extends: [...tseslint.configs.recommended],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        __DEV__: 'readonly',
      },
    },
    settings: { react: { version: '19.0' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // React 17+ JSX transform — Expo's babel preset injects the runtime.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The minigame runs a fixed-step loop off the wall clock; a stale closure
      // over `zone` or `elapsed` is the bug that makes the fish uncatchable.
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // Must stay last: turns off every stylistic rule Prettier owns.
  prettier,
);
