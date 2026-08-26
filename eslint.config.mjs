import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'services/engine/**',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      // The foundation must stay type-safe: escape hatches are errors, not warnings.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description', 'ts-nocheck': true },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Config files and Next.js pages are not part of the Node service source tree.
    files: ['**/*.config.{ts,mts,js,mjs}', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // Plain Node scripts (build gates, tooling) use Node globals directly.
    files: ['**/scripts/**/*.mjs', 'bench/**/*.mjs', '**/next.config.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  prettier,
)
