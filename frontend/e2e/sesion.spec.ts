import { expect, test, type Page } from '@playwright/test';

import { codigoCorreo, correo, ingresar, PASSWORD } from './apoyo';

/** Primer paso del login (correo o RUT y contraseña), sin responder el segundo. */
async function primerPaso(page: Page, usuario: string, perfil: 'paciente' | 'equipo' = 'equipo') {
  await page.goto('/ingreso');
  if (perfil === 'equipo') await page.getByRole('button', { name: 'Soy del equipo' }).click();
  await page.getByLabel('Correo o RUT').fill(usuario.includes('.') && !usuario.includes('@') ? usuario : correo(usuario));
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  const antes = new Date();
  await page.getByRole('button', { name: perfil === 'equipo' ? 'Entrar al panel' : 'Entrar a mi cuenta' }).click();
  return antes;
}

test('sin sesion, el backoffice manda al login con la ruta de vuelta', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/ingreso\?volver=%2Fadmin$/);
});

test('ADMIN: codigo por correo, menu de su rol, sin tokens en el almacen del navegador; recargar mantiene la sesion y salir la cierra', async ({
  page,
  context,
}) => {
  const antes = await primerPaso(page, 'admin');
  await expect(page.getByRole('heading', { name: 'Revisa tu correo.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reenviar código \(\d+ s\)/ })).toBeDisabled();
  await page.getByLabel('Código de verificación').fill('000000');
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText('El código no es válido o venció. Puedes pedir uno nuevo.');
  await page.getByLabel('Código de verificación').fill(await codigoCorreo(correo('admin'), antes));
  await page.getByRole('button', { name: 'Verificar' }).click();
  const listo = page.getByRole('button', { name: 'Ya los guardé, continuar' });
  await Promise.race([listo.waitFor(), page.waitForURL(/\/admin$/)]);
  if (await listo.isVisible()) await listo.click();
  await expect(page).toHaveURL(/\/admin$/);

  const menu = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(menu.getByRole('link', { name: 'Configuración' })).toBeVisible();
  await expect(page.getByLabel('Equipo')).toBeVisible();
  // El seed demo da ADMIN + PROFESIONAL al admin: el selector de rol aparece.
  await expect(page.getByLabel('Rol activo')).toHaveValue('ADMIN');

  // El refresh token nunca llega al JS: cookie httpOnly limitada a /sesion (Secure solo con HTTPS).
  const cookie = (await context.cookies()).find((c) => c.name === 'vinculos_refresh');
  expect(cookie).toMatchObject({ httpOnly: true, path: '/sesion', sameSite: 'Strict', secure: false });
  const almacen = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(almacen).not.toMatch(/eyJ|refresh|accessToken|token/i);

  await page.reload();
  await expect(menu.getByRole('link', { name: 'Configuración' })).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/ingreso$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/ingreso\?volver=/);
});

test('sesion persistente (03b-4.1): del panel a la landing muestra "Ir a mi panel" y volver no pide ingresar; el login con sesion activa redirige', async ({
  page,
}) => {
  await ingresar(page, 'gestion');
  await page.goto('/');
  const ir = page.getByRole('link', { name: 'Ir a mi panel' });
  await expect(ir).toBeVisible();
  await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toHaveCount(0);
  await ir.click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
  await page.goto('/ingreso');
  await expect(page).toHaveURL(/\/admin$/);
});

test('cerrar sesion en una pestaña la termina en las demas', async ({ page, context }) => {
  await ingresar(page, 'gestion');
  const otra = await context.newPage();
  await otra.goto('/admin/agenda');
  await expect(otra.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(otra).toHaveURL(/\/ingreso/);
  await otra.goto('/admin');
  await expect(otra).toHaveURL(/\/ingreso\?volver=/);
});

test('PROFESIONAL entra con su RUT (equipo) y ve el menu sin opciones de ADMIN', async ({ page }) => {
  const antes = await primerPaso(page, '12.345.678-5');
  await page.getByLabel('Código de verificación').fill(await codigoCorreo(correo('profesional1'), antes));
  await page.getByRole('button', { name: 'Verificar' }).click();
  const listo = page.getByRole('button', { name: 'Ya los guardé, continuar' });
  await Promise.race([listo.waitFor(), page.waitForURL(/\/admin$/)]);
  if (await listo.isVisible()) await listo.click();
  await expect(page).toHaveURL(/\/admin$/);
  const menu = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(menu.getByRole('link', { name: 'Fichas y Pacientes' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Configuración' })).toHaveCount(0);
  await expect(page.getByLabel('Equipo')).toHaveCount(0);
  await expect(page.getByText('Rol activo: Profesional')).toBeVisible();
});

test('cuenta con dos roles: cambia el rol activo, recarga permisos y el cambio sobrevive a recargar', async ({ page }) => {
  await ingresar(page, 'directora');
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

test('PACIENTE con RUT: entra al portal sin segundo paso y no puede quedarse en el backoffice', async ({ page }) => {
  await primerPaso(page, '11.111.111-1', 'paciente');
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hola');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/portal$/);
});

test('errores: RUT con DV invalido (en el campo, mientras se escribe) y credenciales incorrectas con texto generico', async ({ page }) => {
  await page.goto('/ingreso');
  await page.getByLabel('Correo o RUT').fill('11.111.111-2');
  await expect(page.locator('form').getByRole('alert')).toHaveText('El RUT no es válido: revisa el dígito verificador.');

  await page.getByLabel('Correo o RUT').fill(correo('admin'));
  await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar a mi cuenta' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText(/no coinciden con una cuenta con acceso/);
});

test('ruta del panel sin pagina (03b): el 404 se ve dentro del panel, con el menu', async ({ page }) => {
  await ingresar(page, 'gestion');
  await page.goto('/admin/seccion-inexistente');
  await expect(page.getByText('Esta sección no existe o todavía no está disponible')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Esta sección no existe o todavía no está disponible')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
});

test('inactividad (03b): 30 minutos sin actividad cierran la sesion y el login lo explica', async ({ page }) => {
  await page.clock.install();
  await ingresar(page, 'gestion');
  await page.clock.fastForward('20:00');
  await expect(page).toHaveURL(/\/admin$/);
  await page.clock.fastForward('11:00');
  await expect(page).toHaveURL(/\/ingreso\?volver=%2Fadmin&motivo=inactividad$/);
  await expect(page.getByText('Cerramos tu sesión porque estuvo 30 minutos sin actividad.', { exact: false })).toBeVisible();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/ingreso\?volver=%2Fadmin$/);
});
