import { defineConfig, devices } from '@playwright/test';

/**
 * 03b-6: flujos publicos y del portal en un celular (Pixel 7) con red 3G
 * lenta (e2e/prueba.ts), contra un build de produccion (en dev los bundles
 * no estan divididos ni minificados y la medicion no sirve). Compila en
 * .next-movil para no pisar el dev server. Misma API local, seed y Mailpit.
 *   npx playwright test -c playwright.movil.config.ts
 */
const PUERTO = 3100;

export default defineConfig({
  testDir: './e2e',
  // Separado del de escritorio: correr ambas a la vez no se borra los traces.
  outputDir: 'test-results-movil',
  testMatch: ['publico.spec.ts', 'portal.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 45_000 },
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    trace: 'retain-on-failure',
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    navigationTimeout: 120_000,
    actionTimeout: 45_000,
  },
  projects: [{ name: 'movil-3g', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: `npx next build && npx next start -p ${PUERTO}`,
    env: { NEXT_DIST_DIR: '.next-movil' },
    url: `http://localhost:${PUERTO}/ingreso`,
    reuseExistingServer: true,
    timeout: 600_000,
  },
});
