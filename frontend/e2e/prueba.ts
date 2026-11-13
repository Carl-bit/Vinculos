import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * 03b-6: `test` de los flujos publicos y del portal. En el proyecto movil-3g
 * (playwright.movil.config.ts) la pagina principal navega con red 3G lenta
 * (perfil "Slow 3G" de Chrome DevTools: 400 ms de latencia, 400 kbit/s).
 * En el proyecto de escritorio no cambia nada.
 */
export const test = base.extend<{ redLenta: void }>({
  redLenta: [
    async ({ page, browserName }, usar, info) => {
      if (info.project.name === 'movil-3g' && browserName === 'chromium') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 400,
          downloadThroughput: (400 * 1024) / 8,
          uploadThroughput: (400 * 1024) / 8,
        });
      }
      await usar();
    },
    { auto: true },
  ],
});
