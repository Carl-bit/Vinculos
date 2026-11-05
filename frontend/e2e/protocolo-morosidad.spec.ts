import { expect, test } from '@playwright/test';

import { ingresar, ingresarEquipo } from './apoyo';

/**
 * 03b-4.2 contra el seed demo: paciente moroso con registro (deuda, hora
 * autorizada con motivo), protocolo del centro (interno con "leído" y
 * registro para la direccion; de pacientes con acuse en el portal) y la
 * regla de comision por derivacion.
 */
test('Moroso del demo: Rodrigo figura con deuda en Mis pacientes del profesional y llegó por el centro', async ({ page }) => {
  await ingresarEquipo(page, 'profesional1');
  await page.goto('/admin/perfil/cuenta?seccion=pacientes');
  const fila = page.getByRole('listitem').filter({ hasText: 'Rodrigo' });
  await expect(fila.getByText(/Con deuda · \$/)).toBeVisible();

  await page.goto('/admin/fichas');
  const riel = page.getByRole('region', { name: 'Mis pacientes' });
  await riel.getByRole('tab', { name: 'Todos' }).click();
  await riel.getByRole('searchbox', { name: 'Buscar paciente' }).fill('Rodrigo');
  await riel
    .getByRole('button', { name: /Rodrigo/ })
    .first()
    .click();
  await expect(page.getByText('Llegó por el centro')).toBeVisible();
});

test('Protocolo interno: Profesional Uno lo tiene leído en Mi cuenta', async ({ page }) => {
  await ingresarEquipo(page, 'profesional1');
  await page.goto('/admin/perfil/cuenta?seccion=protocolo');
  await expect(page.getByRole('heading', { level: 2, name: 'Protocolo del centro' })).toBeVisible();
  await expect(page.getByText(/Lo marcaste como leído el/)).toBeVisible();
});

test('Protocolo interno: la cuenta madre ve quién lo leyó y quién falta', async ({ page }) => {
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/configuracion?vista=politicas');
  await expect(page.getByRole('heading', { name: 'Protocolo interno del equipo' })).toBeVisible();
  await expect(page.getByText(/1 de \d+ integrantes lo leyeron/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Protocolo para pacientes' })).toBeVisible();
});

test('Protocolo de pacientes: Paciente Prueba ya lo leyó en su portal', async ({ page }) => {
  await ingresar(page, 'paciente', 'portal');
  await page.goto('/portal/consentimientos');
  await expect(page.getByRole('heading', { name: 'Protocolo del centro' })).toBeVisible();
  await expect(page.getByText(/Leíste la versión 1 el/)).toBeVisible();
});

test('Cobro por derivación: Cobros muestra el monto fijo de pacientes del centro', async ({ page }) => {
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/cobros');
  await expect(page.getByText(/\$5\.000 por sesión de pacientes que llegaron por el centro/)).toBeVisible();
});
