import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Page } from '@playwright/test';

/** Seed demo (docs/pruebas/guion_manual.md 0.5). */
export const PASSWORD = 'dev-password';
export const correo = (u: string) => `${u}@centro-prueba.cl`;

/** Codigo TOTP (RFC 6238, SHA-1, 30 s, 6 digitos) desde infra/local/totp-demo.txt. */
export function codigoTotp(usuario: string): string {
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

/** Ingreso al panel del equipo; con TOTP si la cuenta lo tiene. */
export async function ingresarEquipo(page: Page, usuario: string) {
  await page.goto('/ingreso');
  await page.getByRole('button', { name: 'Soy del equipo' }).click();
  await page.getByLabel('Correo del centro').fill(correo(usuario));
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar al panel' }).click();
  const codigo = page.getByLabel('Código de verificación');
  // Segundo paso (TOTP) o entrada directa al panel (en movil el menu parte oculto: se espera la URL).
  await Promise.race([codigo.waitFor(), page.waitForURL(/\/admin$/)]);
  if (await codigo.isVisible()) {
    await codigo.fill(codigoTotp(usuario));
    await page.getByRole('button', { name: 'Verificar' }).click();
  }
  await expect(page).toHaveURL(/\/admin$/);
}
