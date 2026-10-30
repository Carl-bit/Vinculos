import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { test, type Page } from '@playwright/test';

import { ingresarEquipo } from './apoyo';

/**
 * Capturas de entrega 03b-4.2 a 1920x1080 (agenda, inicio, vista del
 * paciente y registro SIS). Solo con CAPTURAS=<carpeta>; no es parte de la
 * suite normal. Informa un numero de registro de profesional1 (dato demo).
 */
const DESTINO = process.env.CAPTURAS;

async function foto(page: Page, nombre: string, completa = false) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(DESTINO!, `${nombre}.png`), fullPage: completa });
}

async function abrirPaciente(page: Page, admin: boolean) {
  // Un solo goto: dos seguidos rotan el refresh dos veces y la sesion se revoca.
  await page.goto(admin ? '/admin/fichas?vista=pacientes' : '/admin/fichas');
  await page
    .getByRole('link', { name: /Prueba, Paciente|Paciente Prueba/ })
    .first()
    .click();
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const usuario of ['profesional1', 'admin'] as const) {
  test(`capturas 03b-4.2: ${usuario}`, async ({ page }) => {
    test.skip(!DESTINO, 'Solo con CAPTURAS=<carpeta>');
    test.setTimeout(180_000);
    mkdirSync(DESTINO!, { recursive: true });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await ingresarEquipo(page, usuario);
    await page.goto('/admin');
    await foto(page, `inicio-${usuario}`);
    await page.goto('/admin/agenda');
    await foto(page, `agenda-${usuario}-semana`);
    await page.goto('/admin/agenda?vista=box');
    await foto(page, `agenda-${usuario}-por-box`);
    // Box elegido: horario libre y ocupado de fondo, sesiones del profesional encima.
    await page.getByLabel('Filtrar por box').selectOption({ label: 'Box 1 (Demo)' });
    await foto(page, `agenda-${usuario}-box-elegido`);
    await page.goto('/admin/agenda?vista=box');
    await page.waitForLoadState('networkidle');
    await abrirPaciente(page, usuario === 'admin');
    await foto(page, `paciente-${usuario}`);
    if (usuario === 'profesional1') {
      await page.goto(`${page.url().split('?')[0]}?vista=evoluciones`);
      await foto(page, 'paciente-profesional1-evoluciones');
      // Registro SIS: informar y verificar (simulado sin apikey).
      await page.goto('/admin/perfil');
      const panel = page
        .getByRole('region', { name: 'Registro en la Superintendencia' })
        .or(page.locator('section', { hasText: 'Registro en la Superintendencia' }))
        .first();
      await panel.scrollIntoViewIfNeeded();
      const campo = panel.getByLabel(/Número de registro|Cambiar número/);
      await campo.fill('123456');
      await panel.getByRole('button', { name: 'Guardar y verificar' }).click();
      await page.waitForTimeout(1200);
      await panel.screenshot({ path: join(DESTINO!, 'mi-perfil-registro-sis.png') });
      await page.goto('/equipo');
      await page.waitForLoadState('networkidle');
      const tarjeta = page.locator('article', { hasText: 'Profesional Uno' }).first();
      await tarjeta.scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await tarjeta.screenshot({ path: join(DESTINO!, 'equipo-publico-tarjeta-registro-sis.png') });
      await tarjeta.getByRole('link', { name: /Ver perfil completo/ }).click();
      await foto(page, 'perfil-completo-registro-sis', true);
    }
  });
}
