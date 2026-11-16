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
  // next dev compila cada ruta la primera vez: 10 s evita falsos fallos en frio.
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure', locale: 'es-CL', timezoneId: 'America/Santiago' },
  // E2E_NAVEGADOR=chrome (o msedge) usa el navegador instalado en el equipo en vez del Chromium
  // de Playwright (`npx playwright install chromium`). Sin la variable, el de Playwright: misma
  // version en todas las maquinas y en CI.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.E2E_NAVEGADOR ? { channel: process.env.E2E_NAVEGADOR } : {}) } }],
  webServer: { command: 'npm run dev', url: 'http://localhost:3000/ingreso', reuseExistingServer: true, timeout: 120_000 },
});
