import { defineConfig, devices } from '@playwright/test';

/**
 * E2E contra la API local con el seed demo (npm run seed:demo en backend).
 * La API (y Postgres) deben estar arriba: `npm run dev` en la raiz. El front
 * lo levanta Playwright si no esta corriendo.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure', locale: 'es-CL', timezoneId: 'America/Santiago' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev', url: 'http://localhost:3000/ingreso', reuseExistingServer: true, timeout: 120_000 },
});
