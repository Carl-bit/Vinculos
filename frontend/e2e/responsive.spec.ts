import { expect, test, type Page } from '@playwright/test';

import { ingresar, ingresarEquipo } from './apoyo';

/**
 * 03b-6: publico y portal pensados para movil; backoffice usable en tablet.
 * Prueba objetiva: a ese ancho ninguna vista desborda en horizontal (la
 * pagina no se desplaza de lado). Los flujos completos en celular con red
 * lenta estan en playwright.movil.config.ts.
 */
async function sinDesborde(page: Page, rutas: string[]) {
  const desbordes: string[] = [];
  for (const ruta of rutas) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    const { ancho, visible } = await page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, visible: window.innerWidth }));
    if (ancho > visible + 1) desbordes.push(`${ruta}: ${ancho}px de contenido en ${visible}px`);
  }
  expect(desbordes).toEqual([]);
}

test.describe('celular (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('sitio público', async ({ page }) => {
    await sinDesborde(page, ['/', '/equipo', '/match', '/pedir-hora', '/ingreso', '/derechos']);
  });

  test('portal del paciente', async ({ page }) => {
    await ingresar(page, 'paciente', 'portal');
    await sinDesborde(page, ['/portal', '/portal/pedir-hora', '/portal/pagos', '/portal/documentos', '/portal/consentimientos', '/portal/resenas']);
  });
});

test.describe('tablet (768 px, vertical)', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });

  test('panel del equipo', async ({ page }) => {
    await ingresarEquipo(page, 'admin');
    await sinDesborde(page, ['/admin', '/admin/agenda', '/admin/fichas', '/admin/equipo', '/admin/cobros', '/admin/mensajes', '/admin/configuracion']);
  });
});
