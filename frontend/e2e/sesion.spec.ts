import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/** Seed demo (docs/pruebas/guion_manual.md 0.5). */
const PASSWORD = 'dev-password';
const correo = (u: string) => `${u}@centro-prueba.cl`;

/** Codigo TOTP (RFC 6238, SHA-1, 30 s, 6 digitos) desde infra/local/totp-demo.txt. */
function codigoTotp(usuario: string): string {
  const linea = readFileSync(join(__dirname, '..', '..', 'infra', 'local', 'totp-demo.txt'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${correo(usuario)} `));
  if (!linea) throw new Error(`Sin secreto TOTP para ${usuario}`);
  const base32 = linea.split(' ')[1]!.replace(/=+$/, '');
  let bits = '';
  for (const c of base32) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0');
  const llave = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac('sha1', llave).update(contador).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function ingresar(page: Page, usuario: string, perfil: 'paciente' | 'equipo' = 'equipo') {
  await page.goto('/ingreso');
  if (perfil === 'equipo') await page.getByRole('button', { name: 'Soy del equipo' }).click();
  await page.getByLabel(perfil === 'equipo' ? 'Correo del centro' : 'Correo o RUT').fill(usuario.includes('-') ? usuario : correo(usuario));
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: perfil === 'equipo' ? 'Entrar al panel' : 'Entrar a mi cuenta' }).click();
}

test('sin sesion, el backoffice manda al login con la ruta de vuelta', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/ingreso\?volver=%2Fadmin$/);
});

test('ADMIN: entra al backoffice, ve su rol y el menu de su rol; la sesion sobrevive a recargar y sale', async ({ page, context }) => {
  await ingresar(page, 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  const menu = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(menu.getByRole('link', { name: 'Configuración' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Agenda y Espacios' })).toBeVisible();
  await expect(page.getByText('Rol activo: Cuenta madre')).toBeVisible();
  await expect(page.getByLabel('Equipo')).toBeVisible();

  // El refresh token nunca llega al JS: cookie httpOnly limitada a /sesion.
  const cookie = (await context.cookies()).find((c) => c.name === 'vinculos_refresh');
  expect(cookie).toMatchObject({ httpOnly: true, path: '/sesion', sameSite: 'Strict' });

  await page.reload();
  await expect(menu.getByRole('link', { name: 'Configuración' })).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/ingreso$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/ingreso\?volver=/);
});

test('PROFESIONAL con TOTP: segundo paso y menu sin opciones de ADMIN', async ({ page }) => {
  await ingresar(page, 'profesional1');
  await expect(page.getByRole('heading', { name: 'Ingresa tu código.' })).toBeVisible();
  await page.getByLabel('Código de verificación').fill(codigoTotp('profesional1'));
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const menu = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(menu.getByRole('link', { name: 'Fichas y Pacientes' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Configuración' })).toHaveCount(0);
  await expect(page.getByLabel('Equipo')).toHaveCount(0);
});

test('cuenta con dos roles: cambia el rol activo, recarga permisos y el cambio sobrevive a recargar', async ({ page }) => {
  await ingresar(page, 'directora');
  await page.getByLabel('Código de verificación').fill(codigoTotp('directora'));
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const menu = page.getByRole('navigation', { name: 'Menú principal' });
  const selector = page.getByLabel('Rol activo');
  await expect(selector).toHaveValue('ADMIN');
  await expect(selector.locator('option:checked')).toHaveText('Cuenta madre');
  await expect(menu.getByRole('link', { name: 'Configuración' })).toBeVisible();

  await selector.selectOption('PROFESIONAL');
  await expect(menu.getByRole('link', { name: 'Configuración' })).toHaveCount(0);
  await expect(page.getByLabel('Equipo')).toHaveCount(0);
  await expect(selector).toHaveValue('PROFESIONAL');

  await page.reload();
  await expect(page.getByLabel('Rol activo')).toHaveValue('PROFESIONAL');
  await expect(menu.getByRole('link', { name: 'Configuración' })).toHaveCount(0);
});

test('PACIENTE con RUT: entra al portal y no puede quedarse en el backoffice', async ({ page }) => {
  await ingresar(page, '11.111.111-1', 'paciente');
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hola');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/portal$/);
});

test('errores: RUT con DV invalido y credenciales incorrectas con texto claro', async ({ page }) => {
  await page.goto('/ingreso');
  await page.getByLabel('Correo o RUT').fill('11.111.111-2');
  await page.getByLabel('Contraseña', { exact: true }).fill('x');
  await page.getByRole('button', { name: 'Entrar a mi cuenta' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText('El RUT no es válido. Revisa el dígito verificador.');

  await page.getByLabel('Correo o RUT').fill(correo('admin'));
  await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar a mi cuenta' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText(/no coinciden con una cuenta con acceso/);
});

test('ruta del panel sin pagina (03b): el 404 se ve dentro del panel, con el menu y el rol activo', async ({ page }) => {
  await ingresar(page, 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Fichas y Pacientes' }).click();
  await expect(page.getByText('Esta sección no existe o todavía no está disponible')).toBeVisible();
  await expect(page.getByText('Rol activo: Cuenta madre')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Esta sección no existe o todavía no está disponible')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
});

test('inactividad (03b): 30 minutos sin actividad cierran la sesion y el login lo explica', async ({ page }) => {
  await page.clock.install();
  await ingresar(page, 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.clock.fastForward('20:00');
  await expect(page).toHaveURL(/\/admin$/);
  await page.clock.fastForward('11:00');
  await expect(page).toHaveURL(/\/ingreso\?volver=%2Fadmin&motivo=inactividad$/);
  await expect(page.getByText('Cerramos tu sesión porque estuvo 30 minutos sin actividad.', { exact: false })).toBeVisible();
  // La sesion quedo cerrada tambien en el servidor: volver al panel pide ingresar.
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/ingreso\?volver=%2Fadmin$/);
});
