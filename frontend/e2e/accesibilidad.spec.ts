import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { ingresar, ingresarEquipo } from './apoyo';

/**
 * 03b-6: accesibilidad automatica (axe-core, WCAG 2.0/2.1 A y AA) en las
 * vistas principales de cada zona. axe no reemplaza la revision con teclado
 * y lector de pantalla, pero detecta contraste, nombres accesibles, roles y
 * etiquetas. Cada violacion se lista con el selector para corregirla.
 */
/** Violaciones de una ruta: regla, impacto y hasta 5 nodos (con colores y ratio si es contraste). */
async function violaciones(page: Page, ruta: string): Promise<string[]> {
  await page.goto(ruta);
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.flatMap((v) =>
    v.nodes.slice(0, 5).map((n) => {
      const d = n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
      const color = d?.contrastRatio ? ` [${d.fgColor} sobre ${d.bgColor} = ${d.contrastRatio}]` : '';
      return `${ruta} · ${v.id} (${v.impact}): ${n.target.join(' ')}${color}`;
    }),
  );
}

/** Revisa todas las rutas y falla una vez con la lista completa. Estados finales: sin animaciones de entrada. */
async function sinViolaciones(page: Page, rutas: string[]) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const todas: string[] = [];
  for (const ruta of rutas) todas.push(...(await violaciones(page, ruta)));
  expect(todas).toEqual([]);
}

test('sitio público sin violaciones WCAG AA', async ({ page }) => {
  await sinViolaciones(page, ['/', '/equipo', '/match', '/pedir-hora', '/ingreso', '/politicas/POLITICA_DATOS', '/derechos']);
});

test('portal del paciente sin violaciones WCAG AA', async ({ page }) => {
  await ingresar(page, 'paciente', 'portal');
  await sinViolaciones(page, ['/portal', '/portal/pedir-hora', '/portal/documentos', '/portal/consentimientos', '/portal/resenas', '/portal/seguridad']);
});

test('panel del equipo sin violaciones WCAG AA', async ({ page }) => {
  await ingresarEquipo(page, 'admin');
  await sinViolaciones(page, ['/admin', '/admin/agenda', '/admin/fichas', '/admin/equipo', '/admin/mensajes', '/admin/configuracion']);
});

test('teclado: el primer Tab ofrece saltar al contenido y lleva el foco al main', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const saltar = page.getByRole('link', { name: 'Saltar al contenido' });
  await expect(saltar).toBeFocused();
  await expect(saltar).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#contenido')).toBeFocused();
});
