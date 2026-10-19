import { expect, test, type Page } from '@playwright/test';

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

test('paciente: pagos con saldo, documentos, y copia de ficha', async ({ page }) => {
  await ingresar(page, 'paciente');
  await secciones(page).getByRole('link', { name: 'Pagos' }).click();
  await expect(page.getByText(/Tienes \$[\d.]+ por pagar/)).toBeVisible();
  await expect(page.getByText('Pago parcial')).toBeVisible();
  await secciones(page).getByRole('link', { name: 'Documentos' }).click();
  await expect(page.getByText(/Certificado de atencion/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Copia de la ficha clínica' })).toBeVisible();
  await expect(page.getByText(/Pedida el/)).toBeVisible();
});

test('adolescente: cuenta restringida sin pagos, documentos ni consentimientos', async ({ page }) => {
  await ingresar(page, 'adolescente');
  await expect(page.getByText(/Tu cuenta es de adolescente/)).toBeVisible();
  await expect(secciones(page).getByRole('link', { name: 'Pagos' })).toHaveCount(0);
  await expect(secciones(page).getByRole('link', { name: 'Documentos' })).toHaveCount(0);
  await page.goto('/portal/pagos');
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

test('paciente: pide hora con su tratante sin repetir datos y descarga su documento', async ({ page }) => {
  await ingresar(page, 'paciente');
  await page.getByRole('navigation', { name: 'Menú del portal' }).getByRole('link', { name: 'Pedir una hora' }).click();
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
  await expect(page.getByRole('heading', { name: /Tu hora quedó confirmada|Enviamos tu solicitud/ })).toBeVisible();

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
