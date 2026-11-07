#!/usr/bin/env node
// AUD-01 Fase 3 (LEG-04): descifra la exportacion completa de un centro.
//
//   CLAVE='<clave que se uso al exportar>' node infra/scripts/exportacion/descifrar.mjs exportacion-centro-AAAA-MM-DD.vxp carpeta-salida
//
// La clave la eligio el ADMIN del centro al pedir la exportacion; Vinculos no
// la guarda, asi que sin ella el archivo no se puede abrir. Deja:
//   carpeta-salida/indice.json          formato, version, fecha, centro y conteo por tabla
//   carpeta-salida/datos/<tabla>.json   una tabla por archivo (JSON con las columnas legibles)
//   carpeta-salida/fichas/<paciente>.pdf   la ficha clinica legible de cada paciente
// Solo usa Node (sin dependencias). La clave va por variable de entorno para
// que no quede en el historial de comandos.
import { createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [archivo, salida] = process.argv.slice(2);
const clave = process.env.CLAVE;
if (!archivo || !salida || !clave) {
  console.error("Uso: CLAVE='...' node descifrar.mjs ARCHIVO.vxp CARPETA_SALIDA");
  process.exit(1);
}

// v1 (AUD-01): MAGIA | sal(16) | iv(12) | tag(16) | cuerpo; llave = scrypt(clave, sal).
// v2 (AUD-02): MAGIA | sal(16) | publica efimera X25519(32) | iv(12) | tag(16) | cuerpo;
//   privada = scrypt(clave, sal); llave = HKDF-SHA256(ECDH(privada, efimera), efimera || publica).
const MAGIA_V1 = Buffer.from('VINCULOS-EXPORT-1\n', 'utf8');
const MAGIA_V2 = Buffer.from('VINCULOS-EXPORT-2\n', 'utf8');
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const datos = readFileSync(archivo);
const v2 = datos.subarray(0, MAGIA_V2.length).equals(MAGIA_V2);
if (!v2 && !datos.subarray(0, MAGIA_V1.length).equals(MAGIA_V1)) {
  console.error('El archivo no es una exportacion de Vinculos (version 1 o 2).');
  process.exit(1);
}
let p = MAGIA_V1.length;
const sal = datos.subarray(p, (p += 16));
const efimera = v2 ? datos.subarray(p, (p += 32)) : null;
const iv = datos.subarray(p, (p += 12));
const etiqueta = datos.subarray(p, (p += 16));
const cuerpo = datos.subarray(p);

function llaveV2() {
  const raw = scryptSync(clave, sal, 32, SCRYPT);
  const privada = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), raw]), format: 'der', type: 'pkcs8' });
  const spki = Buffer.from('302a300506032b656e032100', 'hex');
  const publica = createPublicKey(privada).export({ format: 'der', type: 'spki' }).subarray(spki.length);
  const secreto = diffieHellman({ privateKey: privada, publicKey: createPublicKey({ key: Buffer.concat([spki, efimera]), format: 'der', type: 'spki' }) });
  return Buffer.from(hkdfSync('sha256', secreto, Buffer.concat([efimera, publica]), Buffer.from('vinculos-exportacion-centro-v2', 'utf8'), 32));
}

let plano;
try {
  const llave = v2 ? llaveV2() : scryptSync(clave, sal, 32, SCRYPT);
  const d = createDecipheriv('aes-256-gcm', llave, iv);
  d.setAuthTag(etiqueta);
  plano = Buffer.concat([d.update(cuerpo), d.final()]);
} catch {
  console.error('Clave incorrecta o archivo alterado.');
  process.exit(1);
}

const exp = JSON.parse(plano.toString('utf8'));
mkdirSync(join(salida, 'datos'), { recursive: true, mode: 0o700 });
mkdirSync(join(salida, 'fichas'), { recursive: true, mode: 0o700 });
const conteo = {};
for (const [tabla, filas] of Object.entries(exp.datos)) {
  writeFileSync(join(salida, 'datos', `${tabla}.json`), JSON.stringify(filas, null, 2), { mode: 0o600 });
  conteo[tabla] = filas.length;
}
for (const [paciente, pdf] of Object.entries(exp.fichasPdf ?? {})) {
  writeFileSync(join(salida, 'fichas', `${paciente}.pdf`), Buffer.from(pdf, 'base64'), { mode: 0o600 });
}
writeFileSync(
  join(salida, 'indice.json'),
  JSON.stringify({ formato: exp.formato, version: exp.version, generadoEn: exp.generadoEn, centro: exp.centro, tablas: conteo }, null, 2),
  { mode: 0o600 },
);
console.log(`Listo: ${Object.keys(conteo).length} tablas y ${Object.keys(exp.fichasPdf ?? {}).length} fichas en ${salida}`);
