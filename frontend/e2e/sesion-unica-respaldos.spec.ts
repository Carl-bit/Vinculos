import { expect, test } from '@playwright/test';

import { ingresarEquipo } from './apoyo';

/**
 * 2026-11-07: sesion unica con registro de conexiones (Mi cuenta > Seguridad)
 * y respaldo de titulos como archivo (Formacion). Contra la API local y el seed demo.
 */

test('Sesion unica: entrar en otro navegador cierra la sesion anterior y queda en el registro de conexiones', async ({ browser }) => {
  const primero = await browser.newContext();
  const a = await primero.newPage();
  await ingresarEquipo(a, 'profesional2');

  const segundo = await browser.newContext();
  const b = await segundo.newPage();
  await ingresarEquipo(b, 'profesional2');

  // El primer navegador, en su siguiente accion, vuelve al login con el aviso.
  await a.goto('/admin/perfil/cuenta?seccion=seguridad');
  await expect(a).toHaveURL(/\/ingreso\?.*motivo=otro-ingreso/);
  await expect(a.getByRole('status')).toContainText('otro navegador o dispositivo');

  // El segundo ve su sesion actual y la anterior cerrada por el nuevo ingreso.
  await b.goto('/admin/perfil/cuenta?seccion=seguridad');
  const conexiones = b
    .locator('section')
    .filter({ has: b.getByRole('heading', { name: 'Sesión y conexiones' }) })
    .last();
  await expect(conexiones.getByText('Esta sesión')).toBeVisible();
  await expect(conexiones.getByText(/Se inició sesión en otro lugar/).first()).toBeVisible();

  await primero.close();
  await segundo.close();
});

test('Formacion: agregar un titulo exige el respaldo; queda en revision con su archivo', async ({ page }) => {
  await ingresarEquipo(page, 'profesional3');
  await page.goto('/admin/perfil');
  const lienzo = page.getByRole('article', { name: 'Vista previa de mi perfil público' });
  await lienzo.getByRole('button', { name: 'Editar Formación' }).click();
  const editor = page.getByRole('complementary', { name: 'Editor del perfil' });
  const titulo = `Diplomado e2e ${Date.now()}`;

  await editor.getByRole('textbox', { name: 'Título', exact: true }).fill(titulo);
  await editor.getByRole('textbox', { name: 'Institución' }).fill('Universidad de Prueba');
  await editor.getByRole('textbox', { name: 'Año' }).fill('2021');
  await editor.getByRole('button', { name: 'Agregar título y respaldo' }).click();
  await expect(editor.getByRole('alert')).toContainText('necesitas subir su respaldo');

  await editor.getByLabel('Respaldo del título').setInputFiles({
    name: 'diplomado.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% respaldo e2e\n%%EOF\n'),
  });
  await editor.getByRole('button', { name: 'Agregar título y respaldo' }).click();
  const fila = editor.getByRole('listitem').filter({ hasText: titulo });
  await expect(fila).toContainText('diplomado.pdf');
  await expect(fila).toContainText('En revisión');
  await expect(fila.getByRole('button', { name: 'Nueva versión' })).toBeVisible();

  // Limpieza: el titulo de prueba se elimina (se lleva su respaldo).
  await fila.getByRole('button', { name: `Eliminar ${titulo}` }).click();
  await expect(editor.getByRole('listitem').filter({ hasText: titulo })).toHaveCount(0);
});
