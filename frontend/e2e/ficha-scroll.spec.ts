import { expect, test } from '@playwright/test';

import { ingresarEquipo } from './apoyo';

/**
 * Ficha del profesional en una pagina con indice: sin ficha abierta al
 * entrar; la rueda del mouse baja sin "rebotar" y cada salto del indice
 * llega a su seccion (el encabezado fijo no cambia de alto).
 */
test('Ficha: scroll con rueda y saltos del indice llegan a su seccion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ingresarEquipo(page, 'profesional1');
  await page.goto('/admin/fichas');
  await expect(page.getByText('No has seleccionado ningún paciente')).toBeVisible();

  const riel = page.getByRole('region', { name: 'Mis pacientes' });
  await riel.getByRole('tab', { name: 'Todos' }).click();
  await riel.getByRole('searchbox', { name: 'Buscar paciente' }).fill('Prueba');
  await riel
    .getByRole('button', { name: /Paciente Prueba/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Paciente Prueba' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  // Rueda: cada paso baja (nunca vuelve atras ni se queda pegado).
  const alto = await page.locator('#encabezado-paciente').evaluate((e) => (e as HTMLElement).offsetHeight);
  let antes = await page.evaluate(() => window.scrollY);
  await page.mouse.move(900, 600);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(150);
    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(antes);
    antes = y;
    expect(await page.locator('#encabezado-paciente').evaluate((e) => (e as HTMLElement).offsetHeight)).toBe(alto);
  }

  // Saltos del indice: la seccion queda justo bajo el encabezado y queda marcada.
  const indice = page.getByRole('navigation', { name: 'Índice de la ficha' });
  for (const [enlace, region] of [
    ['Sesiones', 'Sesiones'],
    ['Evoluciones', 'Evoluciones'],
    ['Cobros', 'Cobros'],
    ['Consentimientos', 'Consentimientos'],
    ['Datos', 'Datos'],
  ] as const) {
    await indice.getByRole('link', { name: new RegExp(`^${enlace}`) }).click();
    await page.waitForTimeout(1200);
    const top = await page.getByRole('region', { name: region, exact: true }).evaluate((e) => e.getBoundingClientRect().top);
    expect(Math.abs(top - (alto + 12)), `${enlace}: top ${top}`).toBeLessThan(6);
    await expect(indice.getByRole('link', { name: new RegExp(`^${enlace}`) })).toHaveAttribute('aria-current', 'location');
  }

  // Tocar otra vez al paciente cierra la ficha.
  await riel
    .getByRole('button', { name: /Paciente Prueba/, pressed: true })
    .first()
    .click();
  await expect(page.getByText('No has seleccionado ningún paciente')).toBeVisible();
});

test('Seguimiento: "Ver su agenda" abre la agenda del profesional por semana o mes y deriva a Agenda y Espacios', async ({ page }) => {
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/fichas');
  await page.getByRole('button', { name: 'Ver su agenda' }).click();
  const modal = page.getByRole('dialog', { name: /^Agenda de / });
  const vista = modal.getByRole('group', { name: 'Vista de la agenda' });
  await expect(vista.getByRole('radio', { name: 'Semana' })).toBeChecked();
  // Semana en la misma grilla de tiempo de Agenda y Espacios.
  await expect(modal.getByRole('region', { name: 'Calendario' })).toBeVisible();
  await expect(modal.getByText('08:00')).toBeVisible();
  await modal.getByRole('button', { name: 'Semana siguiente' }).click();
  await expect(modal.getByRole('button', { name: 'Esta semana' })).toBeVisible();
  await vista.getByText('Mes', { exact: true }).click();
  await expect(modal.getByRole('button', { name: /sesi(ón|ones)\. Ver la semana$/ }).first()).toBeVisible();
  await expect(modal.getByRole('link', { name: 'Abrir en Agenda y Espacios' })).toHaveAttribute('href', /\/admin\/agenda\?equipo=/);
  await modal.getByRole('link', { name: 'Agregar una hora' }).click();
  await expect(page).toHaveURL(/\/admin\/agenda\?equipo=[^&]+&nueva=1/);
});
