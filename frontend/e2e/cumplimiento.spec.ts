import { expect, test } from '@playwright/test';

import { ingresar, ingresarEquipo } from './apoyo';

/**
 * AUD-01 (docs/cumplimiento/roadmap_aud01.md) contra el seed demo: comprobante
 * de pago y boleta del SII (E1.4) y auditoria de accesos (E1.5).
 */
test('Cobros: la sesion pagada muestra el comprobante (no tributario); ADMIN registra y anula la boleta del SII', async ({ page }) => {
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/cobros');
  await page.getByRole('tab', { name: 'Asistencia y pago' }).click();
  await page.getByRole('tab', { name: 'Todas' }).click();
  const pagada = page.locator('li, tr').filter({ hasText: 'Pagada' }).first();
  await pagada.getByRole('button', { name: 'Asistencia y pago' }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByText(/Comprobante de pago CP-\d{8} \(no es boleta del SII\)/)).toBeVisible();

  const folio = String(Date.now()).slice(-9);
  await modal.getByRole('button', { name: 'Registrar boleta emitida' }).click();
  await expect(modal.getByLabel(/Tipo de documento/)).not.toContainText('Boleta de honorarios');
  await modal.getByLabel(/Folio/).fill(folio);
  await modal.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(modal.getByText(`Boleta electrónica folio ${folio}`)).toBeVisible();

  // Se anula con motivo y queda registrado (la sesion vuelve a quedar sin documento para la proxima corrida).
  await modal.getByRole('region', { name: 'Documento tributario (SII)' }).getByRole('button', { name: 'Anular' }).last().click();
  await modal.getByLabel(/Motivo de la anulación/).fill('Prueba automatizada');
  await modal.getByRole('button', { name: 'Anular registro' }).click();
  await expect(modal.getByText(/anulado: Prueba automatizada/).last()).toBeVisible();
});

test('Cobros y Configuracion (ADMIN): bandeja de transferencias del seed y medios de pago sin pasarela', async ({ page }) => {
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/cobros?vista=transferencias');
  const tabla = page.getByRole('table', { name: 'Transferencias' });
  await expect(tabla).toBeVisible();
  await tabla.getByRole('button', { name: 'Validar' }).first().click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Validar y registrar pago' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

  await page.goto('/admin/configuracion?vista=medios');
  await expect(page.getByRole('switch', { name: /Transferencia/ })).toBeChecked();
  await expect(page.getByLabel(/Banco/)).toHaveValue('Banco Ficticio (Demo)');
  await expect(page.getByText(/Pasarela/i)).toHaveCount(0);
});

test('Configuracion (ADMIN): auditoria de accesos con quien, rol activo y accion', async ({ page }) => {
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/configuracion?vista=auditoria');
  await expect(page.getByRole('tab', { name: 'Auditoría de accesos', selected: true })).toBeVisible();
  const tabla = page.getByRole('table', { name: 'Registros de auditoría' });
  await expect(tabla).toBeVisible();
  await expect(tabla.getByRole('row').nth(1)).toBeVisible();
  await page.getByLabel('Acción').selectOption('ESCRITURA');
  await expect(tabla.getByRole('cell', { name: 'Escritura o edición' }).first()).toBeVisible();
});

test('Configuracion (ADMIN): contrato con Vinculos aceptado, soporte autorizado y revocado, y solicitudes de datos con plazo', async ({ page }) => {
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/configuracion?vista=politicas');
  const contrato = page.getByRole('region', { name: 'Contrato con Vinculos' }).or(page.locator('section', { hasText: 'Contrato con Vinculos' }));
  await expect(contrato.first()).toContainText('Términos de servicio de Vinculos');
  await expect(contrato.first()).toContainText('Aceptada');

  await page.goto('/admin/configuracion?vista=soporte');
  await expect(page.getByText('El soporte nunca ve datos de pacientes ni del equipo')).toBeVisible();
  await page.getByLabel(/Motivo/).fill('Prueba automatizada de soporte');
  await page.getByLabel(/Plazo \(horas\)/).fill('2');
  await page.getByRole('button', { name: 'Autorizar soporte' }).click();
  const tabla = page.getByRole('table', { name: 'Autorizaciones de soporte' });
  await expect(tabla.getByRole('row', { name: /Prueba automatizada de soporte/ }).first()).toContainText('Vigente');
  await tabla
    .getByRole('row', { name: /Prueba automatizada de soporte/ })
    .first()
    .getByRole('button', { name: 'Revocar' })
    .click();
  await expect(tabla.getByRole('row', { name: /Prueba automatizada de soporte/ }).first()).toContainText('Revocada');

  await page.goto('/admin/configuracion?vista=derechos');
  await page.getByLabel('Derecho').selectOption('OPOSICION');
  const detalle = `Prueba automatizada ${Date.now()}: no quiere recibir recordatorios`;
  await page.getByLabel(/Detalle/).fill(detalle);
  await page.getByRole('button', { name: 'Registrar solicitud' }).click();
  const fila = page.locator('li', { hasText: detalle }).first();
  await expect(fila).toContainText(/Vence el .* 30 días hábiles/);
  await fila.getByLabel(/Respuesta al titular/).fill('Se apagaron sus recordatorios.');
  await fila.getByRole('button', { name: 'Resolver' }).click();
  await expect(fila).toContainText('Resuelta');
});

test('Portal: WhatsApp es un consentimiento propio, apagado por defecto, que se activa y se retira con fecha', async ({ page }) => {
  await ingresar(page, 'paciente', 'portal');
  await page.goto('/portal/avisos');
  const whatsapp = page.getByRole('switch', { name: /Avisos por WhatsApp/ });
  await expect(whatsapp).toHaveAttribute('aria-checked', 'false');
  await whatsapp.click();
  await expect(whatsapp).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/Lo aceptaste el/)).toBeVisible();
  await whatsapp.click();
  await expect(whatsapp).toHaveAttribute('aria-checked', 'false');
});

test('Derechos sin cuenta: desde el pie del sitio, por RUT, con la misma respuesta exista o no', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Derechos sobre tus datos' }).click();
  await expect(page.getByRole('heading', { name: 'Derechos sobre tus datos' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Mi correo cambió/ })).not.toBeChecked();
  await page.getByLabel('Tu RUT').fill('11.111.111-1');
  await page.getByLabel(/Qué necesitas/).selectOption('ACCESO');
  await page.getByRole('button', { name: 'Enviar solicitud' }).click();
  await expect(page.getByRole('status')).toContainText('Si el RUT corresponde a un paciente del centro');
});

test('Fase 3: ADMIN prepara la copia de datos (espera al tratante), el tratante la ve en la ficha y el centro se exporta cifrado', async ({
  page,
  browser,
}) => {
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/configuracion?vista=derechos');
  await page.getByLabel('Derecho').selectOption('ACCESO');
  await page.getByLabel('Buscar paciente').fill('Prueba');
  await page.getByLabel('Paciente', { exact: true }).selectOption({ index: 1 });
  const detalle = `Copia automatizada ${Date.now()}`;
  await page.getByLabel(/Detalle/).fill(detalle);
  await page.getByRole('button', { name: 'Registrar solicitud' }).click();
  const fila = page.locator('li', { hasText: detalle }).first();
  await fila.getByRole('button', { name: 'Preparar copia de datos' }).click();
  await expect(fila).toContainText(/Copia de datos: (Esperando la parte clínica del tratante|Enviada al paciente)/);

  await page.goto('/admin/configuracion?vista=exportacion');
  await page.getByLabel(/^Clave/).fill('una frase larga de prueba');
  await page.getByLabel(/^Repite la clave/).fill('una frase larga de prueba');
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar y descargar' }).click();
  expect((await descarga).suggestedFilename()).toMatch(/^exportacion-centro-\d{4}-\d{2}-\d{2}\.vxp$/);
  await expect(page.getByRole('status')).toContainText('Archivo descargado');

  const tratante = await browser.newPage();
  await ingresarEquipo(tratante, 'profesional1');
  await expect(tratante.getByText(/copias? de datos por completar/)).toBeVisible();
  await tratante.close();
});

test('Feriados: los de la ley vienen calculados; ADMIN agrega uno regional y lo quita', async ({ page }) => {
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/configuracion?vista=feriados');
  const siguiente = String(new Date().getFullYear() + 1);
  await page.getByRole('tab', { name: siguiente }).click();
  await expect(page.getByRole('cell', { name: 'Año Nuevo' })).toBeVisible();
  const fecha = `${siguiente}-07-07`;
  const fila = page.locator('tr', { hasText: 'Feriado regional de prueba' });
  // Idempotente entre corridas: si quedo quitado, se repone; si no existe, se agrega.
  if (await fila.count()) {
    await fila.getByRole('button', { name: 'Reponer' }).click();
  } else {
    await page.getByLabel('Fecha').fill(fecha);
    await page.getByLabel('Nombre').fill('Feriado regional de prueba');
    await page.getByRole('button', { name: 'Agregar feriado' }).click();
  }
  await expect(fila).toContainText('Centro');
  await fila.getByRole('button', { name: 'Quitar' }).click();
  await expect(fila).toContainText('Quitado');
});
