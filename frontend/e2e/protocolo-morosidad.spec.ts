import { expect, test } from '@playwright/test';

import { ingresar, ingresarEquipo } from './apoyo';

/**
 * 03b-4.2 contra el seed demo: protocolo del centro (interno con "leído" y
 * registro para la direccion; de pacientes con acuse en el portal). MVP sin
 * COBROS (2026-11-11): sin morosidad ni comision por derivacion.
 */
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
