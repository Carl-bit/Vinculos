/**
 * 03b-4.1: verificacion en dos pasos por correo. La BD guarda el HMAC-SHA256
 * del codigo con una llave derivada de JWT_SECRET (un respaldo filtrado no
 * permite probar el millon de codigos sin la llave del silo).
 */
import { createHmac, randomInt } from 'node:crypto';

/** Sin 0/O ni 1/I: se leen y se dictan sin confusion. */
const ALFABETO_RESPALDO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const ESPERA_REENVIO_SEGUNDOS = 60;

export function hashCodigo(secreto: string, usuarioId: string, codigo: string): Buffer {
  return createHmac('sha256', secreto)
    .update(`segundo-factor:${usuarioId}:${normalizarCodigo(codigo)}`)
    .digest();
}

/** Mayusculas, sin espacios ni guiones (un respaldo se acepta con o sin guion). */
export const normalizarCodigo = (codigo: string) => codigo.toUpperCase().replace(/[\s-]/g, '');

export const nuevoCodigoCorreo = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** 10 codigos de respaldo XXXXX-XXXXX. */
export function nuevosCodigosRespaldo(): string[] {
  return Array.from({ length: 10 }, () => {
    const c = Array.from({ length: 10 }, () => ALFABETO_RESPALDO[randomInt(ALFABETO_RESPALDO.length)]).join('');
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}

export const esCodigoRespaldo = (codigo: string) => /^[A-Z0-9]{10}$/.test(normalizarCodigo(codigo));

/** "ca•••@correo.cl": el usuario reconoce su correo sin exponerlo completo. */
export function enmascararCorreo(email: string | null): string | null {
  if (!email) return null;
  const [local, dominio] = email.split('@');
  return `${local.slice(0, 2)}•••@${dominio}`;
}
