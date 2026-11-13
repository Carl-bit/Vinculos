import { createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, scryptSync, type KeyObject } from 'node:crypto';

/**
 * AUD-02: cifrado de la exportacion del centro, formato v2.
 *
 * La clave del ADMIN deriva (scrypt + sal) la llave privada X25519; la BD
 * guarda solo la publica y la sal. El job cifra cada archivo con una llave
 * AES-256-GCM sacada de un ECDH entre un par efimero (su publica va en la
 * cabecera) y la publica del ADMIN. Abrirlo exige la clave: la privada no se
 * guarda nunca. Misma logica en infra/scripts/exportacion/descifrar.mjs.
 *
 * Archivo v2: MAGIA_V2 | sal(16) | publica efimera(32) | iv(12) | tag(16) | cuerpo.
 */
export const MAGIA_V2 = Buffer.from('VINCULOS-EXPORT-2\n', 'utf8');
export const LARGO_CABECERA_V2 = MAGIA_V2.length + 16 + 32 + 12 + 16;
export const POS_TAG_V2 = MAGIA_V2.length + 16 + 32 + 12;

const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const INFO = Buffer.from('vinculos-exportacion-centro-v2', 'utf8');

const privadaDesdeRaw = (raw: Buffer): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: 'der', type: 'pkcs8' });
const publicaDesdeRaw = (raw: Buffer): KeyObject => createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: 'der', type: 'spki' });
const rawPublica = (k: KeyObject): Buffer => k.export({ format: 'der', type: 'spki' }).subarray(SPKI_X25519.length);

/** Al pedir: la publica de la clave del ADMIN (lo unico que se guarda, junto con la sal). */
export function publicaDesdeClave(clave: string, sal: Buffer): Buffer {
  const raw = scryptSync(clave, sal, 32, SCRYPT);
  try {
    return rawPublica(createPublicKey(privadaDesdeRaw(raw)));
  } finally {
    raw.fill(0);
  }
}

const llaveArchivo = (secreto: Buffer, efimera: Buffer, publica: Buffer) =>
  Buffer.from(hkdfSync('sha256', secreto, Buffer.concat([efimera, publica]), INFO, 32));

/** En el job: llave AES del archivo y la publica efimera que va en la cabecera. */
export function llaveParaCifrar(publicaAdmin: Buffer): { llave: Buffer; efimera: Buffer } {
  const par = generateKeyPairSync('x25519');
  const efimera = rawPublica(par.publicKey);
  const secreto = diffieHellman({ privateKey: par.privateKey, publicKey: publicaDesdeRaw(publicaAdmin) });
  return { llave: llaveArchivo(secreto, efimera, publicaAdmin), efimera };
}

/** Al abrir (tests y descifrar.mjs): la misma llave desde la clave. */
export function llaveParaDescifrar(clave: string, sal: Buffer, efimera: Buffer): Buffer {
  const raw = scryptSync(clave, sal, 32, SCRYPT);
  try {
    const privada = privadaDesdeRaw(raw);
    const secreto = diffieHellman({ privateKey: privada, publicKey: publicaDesdeRaw(efimera) });
    return llaveArchivo(secreto, efimera, rawPublica(createPublicKey(privada)));
  } finally {
    raw.fill(0);
  }
}
