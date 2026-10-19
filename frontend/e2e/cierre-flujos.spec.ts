import { expect, test } from '@playwright/test';

import { ingresarEquipo } from './apoyo';

/**
 * 03b-5.3: flujos que quedaban sin pantalla. Idempotentes: no envian lo que
 * no se puede deshacer (reporte, resolucion de la copia, requerir cierre).
 */

test('Match publico: "Prefiero filtrar yo mismo" busca sin cuestionario y ofrece pedir hora', async ({ page }) => {
  await page.goto('/match');
  await page.getByRole('button', { name: 'Prefiero filtrar yo mismo' }).first().click();
  await expect(page.getByRole('heading', { name: 'Filtra el equipo a tu manera' })).toBeVisible();
  await page.getByText('Próximas dos semanas').click();
  await page.getByRole('button', { name: 'Ver profesionales' }).click();
  await expect(page.getByRole('link', { name: /Pedir hora con/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Volver al cuestionario' }).click();
  await expect(page.getByText(/Paso 1 de/).first()).toBeVisible();
});

test('Perfil publico: una valoracion se puede reportar (el formulario exige el motivo; no se envia)', async ({ page }) => {
  // Seed: la valoracion publicada es de Profesional Uno.
  await page.goto('/equipo');
  await page
    .getByRole('article')
    .filter({ hasText: 'Profesional Uno' })
    .getByRole('link', { name: /Ver perfil/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Reportar valoración' }).first().click();
  await expect(page.getByRole('button', { name: 'Enviar reporte' })).toBeDisabled();
  await page.getByLabel('¿Qué problema tiene?').fill('Prueba');
  await expect(page.getByRole('button', { name: 'Enviar reporte' })).toBeEnabled();
});

test('Ficha: el tratante ve las solicitudes de copia de la ficha en Documentos', async ({ page }) => {
  await ingresarEquipo(page, 'profesional1');
  await page.goto('/admin/fichas');
  await page
    .getByRole('link', { name: /Prueba, Paciente|Paciente Prueba/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Abrir ficha clínica' }).click();
  await page.getByRole('tab', { name: 'Documentos' }).click();
  await expect(page.getByRole('heading', { name: 'Solicitudes de copia de la ficha' })).toBeVisible();
});

test('Movil: el menu del panel se abre con un boton y el rol activo queda visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ingresarEquipo(page, 'admin');
  await expect(page.getByText(/Rol: Cuenta madre/)).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await expect(menu).toBeVisible();
  await menu.getByRole('link', { name: 'Agenda y Espacios' }).click();
  await expect(page).toHaveURL(/\/admin\/agenda/);
  await expect(menu).toBeHidden();
});
