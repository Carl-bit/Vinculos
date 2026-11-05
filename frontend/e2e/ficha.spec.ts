import { expect, test, type Page } from '@playwright/test';

import { ingresarEquipo } from './apoyo';

/**
 * Ficha clinica 03b-5.1 contra la API local y el seed demo. Idempotentes: la
 * evolucion confirmada no se borra (append-only), asi que se prueba el
 * borrador (se descarta al final) y la vista previa (no emite).
 */

/** Riel "Mis pacientes" > Todos > Paciente Prueba: la ficha completa se abre al lado. */
async function elegirPacientePrueba(page: Page) {
  await page.goto('/admin/fichas');
  const riel = page.getByRole('region', { name: 'Mis pacientes' });
  await riel.getByRole('tab', { name: 'Todos' }).click();
  await riel.getByRole('searchbox', { name: 'Buscar paciente' }).fill('Prueba');
  await riel.getByRole('button', { name: /Paciente Prueba/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Paciente Prueba' })).toBeVisible();
}

/** Ficha de Paciente Prueba con el archivo de evoluciones a pantalla completa. */
async function abrirFichaPrueba(page: Page) {
  await elegirPacientePrueba(page);
  await page.getByRole('region', { name: 'Evoluciones' }).getByRole('button', { name: 'Abrir archivo' }).click();
  await expect(page).toHaveURL(/\/admin\/fichas\/[^/]+\?vista=evoluciones/);
}

test('Evoluciones: editor con formato y bloques; archivo en pilas con lectura y versiones', async ({ page }) => {
  await ingresarEquipo(page, 'profesional1');
  await abrirFichaPrueba(page);

  // Archivo: la pila del mes mas reciente abierta; Corregidas lleva a la lectura con versiones.
  await expect(page.getByRole('heading', { name: 'Evoluciones guardadas' })).toBeVisible();
  await page.getByRole('button', { name: 'Corregidas' }).click();
  await page.getByRole('button', { name: 'Desplegar' }).first().click();
  await page.getByRole('button', { name: /^Evaluacion inicial \(corregida\)/ }).click();
  await expect(page.getByRole('heading', { level: 3 })).toBeVisible();
  await page.getByRole('button', { name: 'Ver versiones' }).click();
  await expect(page.getByRole('list', { name: 'Versiones de este registro' }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Volver a la pila' }).click();
  await page.getByRole('button', { name: 'Todas' }).click();

  // Editor: formato en el texto, bloque de escala y borrador en su pila.
  await page.getByRole('button', { name: 'Nueva evolución' }).click();
  await expect(page.getByRole('heading', { name: 'Para escribir esta sesión' })).toBeVisible();
  await page.getByLabel('Título de la evolución').fill('Seguimiento e2e');
  const notas = page.getByLabel('Notas de la sesión');
  await notas.fill('Texto ficticio');
  await notas.selectText();
  await page.getByRole('button', { name: 'Negrita' }).click();
  await expect(notas).toHaveValue('**Texto ficticio**');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.getByRole('menuitem', { name: /Escala/ }).click();
  await page.getByRole('radiogroup', { name: 'Ánimo' }).getByText('7', { exact: true }).click();
  await page.getByRole('button', { name: 'Guardar como borrador' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tu progreso queda en la pila Borradores' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Seguimiento e2e/ })).toBeVisible();
  await page.getByRole('button', { name: 'Descartar borrador' }).click();
  await page.getByRole('dialog', { name: '¿Descartar el borrador?' }).getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByRole('button', { name: 'Nueva evolución' })).toBeVisible();
});

test('Ficha: el borrador se guarda solo, exige tipo y riesgo para confirmar y se puede descartar', async ({ page }) => {
  await ingresarEquipo(page, 'profesional1');
  await abrirFichaPrueba(page);
  await expect(page.getByRole('button', { name: 'Volver a la ficha' })).toBeVisible();

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
  await elegirPacientePrueba(page);
  await page.getByRole('navigation', { name: 'Índice de la ficha' }).getByRole('link', { name: 'Documentos' }).click();
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
  const indice = page.getByRole('navigation', { name: 'Índice de la ficha' });
  await expect(indice.getByRole('link', { name: 'Sesiones' })).toBeVisible();
  await expect(indice.getByRole('link', { name: /Evoluciones/ })).toHaveCount(0);

  await page.goto('/admin/fichas?vista=plantillas');
  await expect(page.getByText('Evolucion psicoterapia (Demo)')).toBeVisible();
  const config = page.getByRole('group', { name: 'Configuración clínica' });
  await config.getByText('Catálogos', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tipos de sesión' })).toBeVisible();
  await config.getByText('Retención', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revisar' })).toBeVisible();
});
