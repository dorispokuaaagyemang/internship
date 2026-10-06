import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite()],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Build configuration runs in Node, not the browser.
    files: ['*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Test helpers mix components and functions; fast refresh never loads them.
    files: ['src/test/**', '**/*.test.{js,jsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
]);
