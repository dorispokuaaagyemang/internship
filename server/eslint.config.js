import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    // sequelize-cli require()s migrations and seeders, so they stay CommonJS.
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
];
