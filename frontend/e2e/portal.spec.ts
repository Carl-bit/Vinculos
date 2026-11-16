import { expect, test } from './prueba';
import type { Page } from '@playwright/test';

import { aprobarHora, ingresarEquipo, sqlPrueba } from './apoyo';

/** Seed demo (docs/pruebas/guion_manual.md): pacientes y adulto responsable del portal (03b-3). */
const PASSWORD = 'dev-password';
const correo = (u: string) => `${u}@centro-prueba.cl`;

async function ingresar(page: Page, usuario: string) {
  await page.goto('/ingreso');
  await page.getByLabel('Correo o RUT').fill(correo(usuario));
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar a mi cuenta' }).click();
  await expect(page).toHaveURL(/\/portal$/);
}

const secciones = (page: Page) => page.getByRole('navigation', { name: 'Secciones de mi cuenta' });

test('paciente: Mi cuenta con su profesional, horas, mensajes y datos; contacto de emergencia solo lectura', async ({ page }) => {
  await ingresar(page, 'paciente');
  await expect(page.getByRole('heading', { name: 'Hola, Paciente.' })).toBeVisible();
  await expect(page.getByText('Mi profesional')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Próximas/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Contacto Demo (hermana) +56922222222')).toBeVisible();
  await expect(page.getByText('Mensaje demo: ¿la sesión del jueves es presencial u online? Gracias.')).toBeVisible();
  // Editar: solo telefono y correo.
  await page.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByLabel('Teléfono')).toBeEditable();
  await expect(page.getByLabel('Contacto de emergencia')).toHaveCount(0);
  await page.getByLabel('Teléfono').fill('123');
  await page.getByRole('button', { name: 'Guardar mis datos' }).click();
  await expect(page.getByText('Escribe el teléfono con código de país')).toBeVisible();
});

test('paciente: documentos y copia de ficha', async ({ page }) => {
  await ingresar(page, 'paciente');
  await secciones(page).getByRole('link', { name: 'Documentos' }).click();
  await expect(page.getByText(/Certificado de atencion/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Copia de la ficha clínica' })).toBeVisible();
  await expect(page.getByText(/Pedida el/)).toBeVisible();
});

test('adolescente: cuenta restringida sin documentos ni consentimientos', async ({ page }) => {
  await ingresar(page, 'adolescente');
  await expect(page.getByText(/Tu cuenta es de adolescente/)).toBeVisible();
  await expect(secciones(page).getByRole('link', { name: 'Documentos' })).toHaveCount(0);
  await page.goto('/portal/documentos');
  await expect(page.getByText('Esta sección la ve tu adulto responsable')).toBeVisible();
});

test('adulto responsable: elige al menor y ve sus horas; los mensajes son solo los que el escribio', async ({ page }) => {
  await ingresar(page, 'madre.demo');
  await expect(page.getByLabel('Estás viendo la cuenta de')).toHaveValue(/.+/);
  await expect(page.getByRole('heading', { name: 'Su profesional' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Datos de Sofia/ })).toBeVisible();
  await expect(page.getByText(/Mensaje demo de la madre/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
});

test('recuperar contraseña y enlace de acceso: respuesta identica exista o no la cuenta', async ({ page }) => {
  await page.goto('/ingreso');
  await page.getByRole('link', { name: '¿La olvidaste?' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Correo').fill('nadie@ejemplo.cl');
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo.' })).toBeVisible();
  await page.goto('/cuenta/acceso');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Correo').fill(correo('paciente'));
  await page.getByRole('button', { name: 'Enviar enlace de acceso' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo.' })).toBeVisible();
  await page.goto('/cuenta/activar?token=token-que-no-existe-0000000');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Contraseña', { exact: true }).fill('una frase larga');
  await page.getByLabel('Repite la contraseña').fill('una frase larga');
  await page.getByRole('button', { name: 'Activar y entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Esta invitación ya no sirve.' })).toBeVisible();
});

test('paciente: pide hora con su tratante sin repetir datos y descarga su documento', async ({ page, browser }) => {
  // Dos ingresos con codigo por correo (paciente y su tratante, que aprueba) y la limpieza como ADMIN.
  test.setTimeout(120_000);
  await ingresar(page, 'paciente');
  await page.goto('/portal/pedir-hora');
  await expect(page.getByRole('heading', { name: /^Con / })).toBeVisible();
  await page.getByRole('button', { name: 'Reservar esta hora' }).waitFor();
  // Primera hora libre de la grilla.
  await page
    .locator('button[aria-pressed]')
    .filter({ hasText: /^\d{2}:\d{2}$/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Reservar esta hora' }).click();
  await expect(page.getByText('Para reservar, acepta la política de datos')).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Reservar esta hora' }).click();
  // MVP sin COBROS: sin paso de pago; la hora llega a su tratante (SOLICITADA) y el la aprueba.
  await expect(page.getByRole('heading', { name: 'Enviamos tu solicitud' })).toBeVisible();
  const citaId = sqlPrueba(
    `SELECT c.id FROM citas c JOIN usuarios u ON u.paciente_id = c.paciente_id
     WHERE u.email = '${correo('paciente')}' AND c.estado = 'SOLICITADA' ORDER BY c.created_at DESC LIMIT 1`,
  );
  await aprobarHora(page, citaId);

  // Limpieza: la hora confirmada ocuparia la agenda de Profesional Uno en las otras pruebas.
  // Recepcion (GESTION, un solo rol) la anula desde la agenda.
  const admin = await (await browser.newContext()).newPage();
  await ingresarEquipo(admin, 'gestion');
  await admin.goto(`/admin/agenda?cita=${citaId}`);
  await admin.getByRole('dialog').getByRole('button', { name: 'Cancelar cita' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Sí, cancelar' }).click();
  await expect.poll(() => sqlPrueba(`SELECT estado FROM citas WHERE id = '${citaId}'`)).toBe('CANCELADA');
  await admin.close();

  await page.goto('/portal/documentos');
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar' }).first().click();
  expect((await descarga).suggestedFilename()).toMatch(/\.pdf$/);
});

test('adolescente: no pide horas desde su cuenta', async ({ page }) => {
  await ingresar(page, 'adolescente');
  await page.goto('/portal/pedir-hora');
  await expect(page.getByText('Tus horas las pide tu adulto responsable')).toBeVisible();
});

test('03b-6: reseña con moderación: editarla la deja en revisión y ADMIN la publica en el perfil', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const texto = `Muy buena atención, me sentí escuchada (e2e ${Date.now()}).`;
  await ingresar(page, 'paciente');
  await page.goto('/portal/resenas');
  const mia = page.getByRole('listitem').filter({ hasText: 'Profesional Uno' });
  await mia.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Tu reseña (opcional)').fill(texto);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: texto }).getByText('En revisión')).toBeVisible();

  const admin = await (await browser.newContext()).newPage();
  await ingresarEquipo(admin, 'admin');
  await admin.goto('/admin/equipo?vista=resenas');
  const resena = admin.getByRole('article').filter({ hasText: texto });
  await expect(resena.getByText('Por moderar')).toBeVisible();
  await resena.getByRole('button', { name: 'Publicar' }).click();
  await expect(resena.getByText('Publicada')).toBeVisible();

  // El perfil publico se renderiza en el servidor (Data Cache de 60 s, se revalida al pedirlo vencido): se recarga hasta verla.
  await page.goto('/equipo');
  await page.getByRole('link', { name: /Ver perfil completo de Ps\. Profesional Uno/ }).click();
  await expect(page).toHaveURL(/\/equipo\/[0-9a-f-]{36}$/);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(texto)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000, intervals: [5_000] });
});
