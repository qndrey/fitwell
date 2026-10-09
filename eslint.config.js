import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['public', 'dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/db/**/*.ts', 'src/domain/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
