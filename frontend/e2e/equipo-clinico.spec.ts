import { expect, test } from '@playwright/test';

import { ingresarEquipo, pacienteNuevo } from './apoyo';

/**
 * 03b-5.2 contra la API local y el seed demo: acceso a fichas ajenas,
 * supervision y mensajeria. Idempotentes: no confirman nada que no se pueda
 * repetir (los mensajes de prueba se retiran dentro de los 5 minutos).
 */

test('Derivaciones: el profesional ve las suyas con su estado y el detalle con candidatos', async ({ page }) => {
  await ingresarEquipo(page, 'profesional1');
  await page.goto('/admin/fichas?vista=derivaciones');
  await expect(page.getByRole('heading', { name: 'Mis derivaciones' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver detalle' }).first().click();
  const modal = page.getByRole('dialog', { name: 'Derivación' });
  await expect(modal.getByText('Candidatos')).toBeVisible();
  await modal.getByRole('button', { name: 'Listo' }).click();
});

test('Derivaciones: el candidato ve la oferta solo con motivo, edad y tipo', async ({ page }) => {
  await ingresarEquipo(page, 'profesional2');
  await page.goto('/admin/fichas?vista=derivaciones');
  await expect(page.getByRole('heading', { name: 'Ofertas de derivación para ti' })).toBeVisible();
  await expect(page.getByText(/años/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aceptar' }).first()).toBeVisible();
});

test('Accesos temporales: ADMIN ve el vigente del seed y el formulario para otorgar', async ({ page }) => {
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/fichas?vista=accesos');
  await expect(page.getByRole('table', { name: 'Accesos clínicos temporales' })).toBeVisible();
  await expect(page.getByText('Interconsulta · solo lectura').first()).toBeVisible();
});

test('Supervision: el supervisor ve casos por codigo, sin nombres, con el comentario del seed', async ({ page }) => {
  await ingresarEquipo(page, 'profesional2');
  await page.goto('/admin/fichas?vista=supervision');
  await page.getByRole('button', { pressed: false }).filter({ hasText: /años/ }).first().click();
  await expect(page.getByText('Comentarios de supervisión').first()).toBeVisible();
  await expect(page.getByText(/Comentario demo de supervision/)).toBeVisible();
  await expect(page.getByText('Camila')).toHaveCount(0);
});

test('Mensajes: conversacion del caso; un mensaje propio se puede retirar dentro de 5 minutos', async ({ page }) => {
  await ingresarEquipo(page, 'profesional1');
  await page.goto('/admin/mensajes');
  await page.getByRole('button', { name: /Interconsulta del caso/ }).click();
  const texto = `Mensaje e2e ${Date.now()}`;
  await page.getByLabel('Mensaje').fill(texto);
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText(texto)).toBeVisible();
  // Retira justo ese mensaje (no otro reciente) y comprueba que deja de verse su texto.
  const retirados = await page.getByText('Mensaje retirado').count();
  await page.getByRole('listitem').filter({ hasText: texto }).getByRole('button', { name: 'Retirar (hasta 5 minutos)' }).click();
  await expect(page.getByText(texto)).toHaveCount(0);
  await expect(page.getByText('Mensaje retirado')).toHaveCount(retirados + 1);

  await page.getByRole('tab', { name: 'De pacientes' }).click();
  await expect(page.getByText(/la sesión del jueves/)).toBeVisible();
  await page.getByRole('tab', { name: 'Avisos' }).click();
  await expect(page).toHaveURL(/vista=avisos/);
});

test('03b-6: hilo CASO: lo ve quien tiene acceso clínico y desaparece al revocarle el acceso', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const { pacienteId } = await pacienteNuevo(page, 'hilo-caso');
  const asunto = `Caso e2e ${Date.now()}`;

  // El tratante (Profesional Uno) da acceso de lectura a Profesional Dos.
  const uno = await (await browser.newContext()).newPage();
  await ingresarEquipo(uno, 'profesional1');
  await uno.goto(`/admin/fichas/${pacienteId}`);
  await uno.getByRole('button', { name: 'Otorgar acceso' }).click();
  const otorgar = uno.getByRole('dialog', { name: 'Otorgar acceso clínico temporal' });
  const selector = otorgar.getByRole('combobox', { name: 'Profesional', exact: true });
  await selector.selectOption((await selector.locator('option', { hasText: 'Profesional Dos' }).getAttribute('value'))!);
  await otorgar.getByRole('button', { name: 'Otorgar acceso' }).click();
  await expect(otorgar).toBeHidden();

  // Conversacion del caso de ese paciente.
  await uno.goto(`/admin/mensajes?caso=${pacienteId}`);
  const nueva = uno.getByRole('dialog', { name: 'Nueva conversación' });
  await nueva.getByLabel('Asunto').fill(asunto);
  await nueva.getByRole('button', { name: 'Crear' }).click();
  await expect(uno.getByRole('region', { name: 'Conversaciones' }).getByText(asunto)).toBeVisible();

  const dos = await (await browser.newContext()).newPage();
  await ingresarEquipo(dos, 'profesional2');
  await dos.goto('/admin/mensajes');
  await expect(dos.getByRole('region', { name: 'Conversaciones' }).getByText(asunto)).toBeVisible();

  // El tratante revoca: Dos deja de ver la ficha y la conversacion del caso.
  await uno.goto(`/admin/fichas/${pacienteId}`);
  await uno.getByRole('button', { name: 'Revocar' }).click();
  await uno.getByRole('dialog', { name: 'Revocar acceso temporal' }).getByRole('button', { name: 'Revocar acceso' }).click();
  await dos.reload();
  await expect(dos.getByRole('region', { name: 'Conversaciones' })).toBeVisible();
  await expect(dos.getByText(asunto)).toHaveCount(0);
  // El tratante conserva la conversacion.
  await uno.goto('/admin/mensajes');
  await expect(uno.getByRole('region', { name: 'Conversaciones' }).getByText(asunto)).toBeVisible();
});
