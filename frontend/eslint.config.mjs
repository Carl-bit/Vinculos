/**
 * ESLint del front (flat config). Reglas de Next (core-web-vitals +
 * TypeScript) y accesibilidad (jsx-a11y recomendado: contraste y teclado
 * se revisan ademas con impeccable). El formato lo decide Prettier.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'src/lib/api/esquema.d.ts', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript', 'plugin:jsx-a11y/recommended'),
  {
    rules: {
      // Variables con _ al inicio: descartadas a proposito (destructuring).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];

export default config;
