import { createHash, randomBytes } from 'node:crypto';

/** Token de un solo uso para un enlace por correo: el valor viaja en la URL; la BD guarda solo el SHA-256. */
export function nuevoTokenCorreo(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export const HORA = 3_600_000;
