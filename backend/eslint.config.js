// eslint.config.js — ESLint v9 flat config
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node.js globals (not injected by default in flat config)
        process:      'readonly',
        Buffer:       'readonly',
        console:      'readonly',
        setTimeout:   'readonly',
        setInterval:  'readonly',
        clearInterval:'readonly',
        URL:          'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      // Ignore variables/args intentionally prefixed with _ (convention for unused)
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
];
