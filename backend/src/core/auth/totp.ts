/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 digitos, paso de 30 s), compatible con las
 * apps de autenticacion. Se acepta el paso anterior y el siguiente (deriva de
 * reloj). El secreto (20 bytes) se guarda cifrado en usuarios.totp_secreto.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASO_SEGUNDOS = 30;

export function base32(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      salida += BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? salida + BASE32[(valor << (5 - bits)) & 31] : salida;
}

export function desdeBase32(texto: string): Buffer {
  let bits = 0;
  let valor = 0;
  const salida: number[] = [];
  for (const c of texto.replace(/=+$/, '').toUpperCase()) {
    const i = BASE32.indexOf(c);
    if (i < 0) {
      throw new Error('base32 invalido');
    }
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      salida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(salida);
}

/** Secreto nuevo en base32 (lo que se guarda y lo que muestra la app). */
export function nuevoSecretoTotp(): string {
  return base32(randomBytes(20));
}

export function codigoTotp(secreto: string, instante = Date.now()): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(instante / 1000 / PASO_SEGUNDOS)));
  const hmac = createHmac('sha1', desdeBase32(secreto)).update(contador).digest();
  const desplazamiento = hmac[hmac.length - 1] & 0xf;
  const numero = (hmac.readUInt32BE(desplazamiento) & 0x7fffffff) % 1_000_000;
  return numero.toString().padStart(6, '0');
}

/** Compara en tiempo constante contra los pasos -1, 0 y +1. */
export function verificarTotp(secreto: string, codigo: string, instante = Date.now()): boolean {
  if (!/^\d{6}$/.test(codigo)) {
    return false;
  }
  const dado = createHash('sha256').update(codigo).digest();
  return [-1, 0, 1].some((d) =>
    timingSafeEqual(createHash('sha256').update(codigoTotp(secreto, instante + d * PASO_SEGUNDOS * 1000)).digest(), dado),
  );
}

/** URI otpauth:// para el codigo QR de la app de autenticacion. */
export function uriTotp(secreto: string, cuenta: string, emisor: string): string {
  const e = encodeURIComponent(emisor);
  return `otpauth://totp/${e}:${encodeURIComponent(cuenta)}?secret=${secreto}&issuer=${e}&algorithm=SHA1&digits=6&period=30`;
}
