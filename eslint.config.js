import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const pluginRule = {
  patterns: [
    {
      group: ['@kernel/*', '!@kernel/contracts', '**/kernel/*', '!**/kernel/contracts'],
      message: 'Plug-ins may only import from kernel/contracts (see docs/conventions.md).',
    },
    {
      group: ['@plugins/*'],
      message: 'Plug-ins must not depend on other plug-ins (see docs/conventions.md).',
    },
  ],
};

const kernelRule = {
  patterns: [
    {
      group: ['@plugins/*', '**/plugins/*'],
      message: 'The kernel must never depend on a specific plug-in (see docs/conventions.md).',
    },
  ],
};

export default tseslint.config(
    { ignores: ['dist', 'node_modules', 'coverage'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
    { files: ['src/plugins/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', pluginRule] } },
    { files: ['src/kernel/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', kernelRule] } },
);