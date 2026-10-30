import { expect, test, type Page } from '@playwright/test';

import { ingresarEquipo } from './apoyo';

/**
 * Ficha clinica 03b-5.1 contra la API local y el seed demo. Idempotentes: la
 * evolucion confirmada no se borra (append-only), asi que se prueba el
 * borrador (se descarta al final) y la vista previa (no emite).
 */

async function abrirFichaPrueba(page: Page) {
  await page.goto('/admin/fichas');
  await page
    .getByRole('link', { name: /Prueba, Paciente|Paciente Prueba/ })
    .first()
    .click();
  // 03b-4.2: sin paso intermedio; el contenido clinico esta en las pestañas.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Evoluciones' }).click();
  await expect(page).toHaveURL(/\/admin\/fichas\/[^/]+\?vista=evoluciones/);
}

test('Ficha: el borrador se guarda solo, exige tipo y riesgo para confirmar y se puede descartar', async ({ page }) => {
  await ingresarEquipo(page, 'profesional1');
  await abrirFichaPrueba(page);
  await expect(page.getByRole('tab', { name: 'Evoluciones' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Contacto de emergencia' })).toBeVisible();

  await page.getByRole('button', { name: 'Nueva evolución' }).click();
  await page.getByLabel('Notas de la sesión').fill(`Borrador e2e ${Date.now()} (texto ficticio)`);
  await expect(page.getByText('Borrador guardado')).toBeVisible();

  await page.getByRole('button', { name: 'Confirmar en el expediente' }).click();
  const modal = page.getByRole('dialog', { name: 'Confirmar en el expediente' });
  await expect(modal.getByText(/ya no se edita ni se borra/)).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  await modal.getByRole('button', { name: 'Volver a editar' }).click();

  await page.getByRole('button', { name: 'Descartar borrador' }).click();
  await page.getByRole('dialog', { name: '¿Descartar el borrador?' }).getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByRole('button', { name: 'Nueva evolución' })).toBeVisible();
});

test('Ficha: vista previa del PDF antes de emitir (sin emitir nada)', async ({ page }) => {
  await ingresarEquipo(page, 'profesional1');
  await abrirFichaPrueba(page);
  await page.getByRole('tab', { name: 'Documentos y adjuntos' }).click();
  await expect(page).toHaveURL(/vista=documentos/);
  await page.getByRole('button', { name: 'Emitir documento' }).click();
  const modal = page.getByRole('dialog', { name: 'Emitir documento' });
  await modal.getByLabel('Tipo de documento').selectOption({ index: 1 });
  await modal.getByLabel('Contenido').fill('Contenido de prueba e2e (ficticio).');
  await expect(modal.getByRole('button', { name: 'Emitir' })).toBeDisabled();
  await modal.getByRole('button', { name: 'Vista previa' }).click();
  await expect(modal.getByTitle('Vista previa del documento')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Emitir' })).toBeEnabled();
  await modal.getByRole('button', { name: 'Cancelar' }).click();
});

test('Ficha: ADMIN no ve el contenido clinico; administra plantillas, catalogos y retencion', async ({ page }) => {
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/fichas?vista=pacientes');
  await page
    .getByRole('link', { name: /Prueba, Paciente|Paciente Prueba/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/fichas\/[^/?]+$/);
  // 03b-4.2: la antigua /ficha lleva a la vista del paciente; ADMIN no tiene pestañas clinicas.
  await page.goto(`${page.url()}/ficha`);
  await expect(page).toHaveURL(/\/admin\/fichas\/[^/]+\?vista=evoluciones/);
  await expect(page.getByRole('tab', { name: 'Sesiones' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Evoluciones' })).toHaveCount(0);

  await page.goto('/admin/fichas?vista=plantillas');
  await expect(page.getByText('Evolucion psicoterapia (Demo)')).toBeVisible();
  await page.getByRole('tab', { name: 'Catálogos clínicos' }).click();
  await expect(page.getByRole('heading', { name: 'Tipos de sesión' })).toBeVisible();
  await page.getByRole('tab', { name: 'Retención' }).click();
  await expect(page.getByRole('button', { name: 'Revisar' })).toBeVisible();
});
