import { expect, type Page } from '@playwright/test';

/** Seed demo (docs/pruebas/usuarios_demo.md). */
export const PASSWORD = 'dev-password';
export const correo = (u: string) => `${u}@centro-prueba.cl`;
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/**
 * 03b-4.1: ultimo codigo de verificacion enviado a un correo, leido de la API
 * de Mailpit. `despues`: solo correos posteriores (el codigo anterior queda
 * anulado al emitir otro).
 */
export async function codigoCorreo(destino: string, despues: Date): Promise<string> {
  for (let intento = 0; intento < 40; intento++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${destino}" subject:"código de verificación"`)}&limit=5`);
    const { messages = [] } = (await r.json()) as { messages?: { Subject: string; Created: string }[] };
    const nuevo = messages.find((m) => new Date(m.Created).getTime() >= despues.getTime() - 1000);
    const codigo = nuevo && /(\d{6})/.exec(nuevo.Subject)?.[1];
    if (codigo) return codigo;
    await new Promise((listo) => setTimeout(listo, 250));
  }
  throw new Error(`Sin codigo de verificacion para ${destino} en Mailpit`);
}

/**
 * Ingreso por la pantalla de login con el segundo paso por correo (equipo, y
 * pacientes que lo activaron). Si la cuenta entrega codigos de respaldo (primer
 * ingreso) los confirma. Devuelve cuando la URL es la de la zona.
 */
export async function ingresar(page: Page, usuario: string, zona: 'admin' | 'portal' = 'admin') {
  await page.goto('/ingreso');
  if (zona === 'admin') await page.getByRole('button', { name: 'Soy del equipo' }).click();
  await page.getByLabel('Correo o RUT').fill(correo(usuario));
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  const antes = new Date();
  await page.getByRole('button', { name: zona === 'admin' ? 'Entrar al panel' : 'Entrar a mi cuenta' }).click();
  const codigo = page.getByLabel('Código de verificación');
  await Promise.race([codigo.waitFor(), page.waitForURL(new RegExp(`/${zona}$`))]);
  if (await codigo.isVisible()) {
    await codigo.fill(await codigoCorreo(correo(usuario), antes));
    await page.getByRole('button', { name: 'Verificar' }).click();
    const listo = page.getByRole('button', { name: 'Ya los guardé, continuar' });
    await Promise.race([listo.waitFor(), page.waitForURL(new RegExp(`/${zona}$`))]);
    if (await listo.isVisible()) await listo.click();
  }
  await expect(page).toHaveURL(new RegExp(`/${zona}$`));
}

/** Ingreso al panel del equipo (codigo por correo). */
export const ingresarEquipo = (page: Page, usuario: string) => ingresar(page, usuario, 'admin');
