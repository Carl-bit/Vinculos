/**
 * Contingencia de llaves: aprovisionamiento, rotacion en dos fases,
 * re-envoltura con KEK nueva y recuperacion con 2 de 3 partes.
 *
 * Toda DEK queda envuelta dos veces: con la KEK operacional y con la llave
 * publica de recuperacion (RSA-OAEP-4096, SHA-256). La privada de recuperacion
 * nunca se escribe en un servidor: se divide con Shamir 2 de 3
 * (shamir-secret-sharing, auditada por Cure53 y Zellic) y cada parte va a un
 * custodio distinto. Con la KEK perdida o comprometida, 2 partes bastan para
 * recuperar las DEK y envolverlas con una KEK nueva.
 *
 * Reglas: nada genera llaves automaticamente (solo los scripts, a mano);
 * ninguna version con datos se destruye; aprovisionar nunca sobrescribe.
 *
 * Lo usan los scripts de infra/scripts/llaves (via prisma/scripts/llaves.ts)
 * y los tests. El acceso a la BD va por la interfaz AlmacenLlaves.
 */
import {
  constants,
  createPrivateKey,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { combine, split } from 'shamir-secret-sharing';
import {
  CATEGORIAS,
  CategoriaLlave,
  ErrorCifrado,
  FilaLlave,
  canarioValido,
  crearCanario,
  desenvolverConKek,
  envolverConKek,
  huellaKek,
} from './cifrado';

export interface FilaLlaveCompleta extends FilaLlave {
  dekPorRecuperacion: Buffer;
  retiradaEn: Date | null;
}

export type TipoEventoLlaves =
  | 'APROVISIONAMIENTO'
  | 'ROTACION'
  | 'VERIFICACION'
  | 'FALLO_CANARIO'
  | 'RESTAURACION'
  | 'SIMULACRO'
  | 'CAMBIO_CUSTODIO'
  | 'COMPROMISO';

export interface Custodio {
  parte: number;
  custodio: string;
  rol: string;
}

export interface AlmacenLlaves {
  listar(): Promise<FilaLlaveCompleta[]>;
  insertar(filas: FilaLlaveCompleta[], custodios: Custodio[]): Promise<void>;
  /** Activa las versiones dadas y retira la activa anterior de su categoria. */
  activar(ids: string[]): Promise<void>;
  reenvolver(cambios: { id: string; dekPorKek: Buffer; huellaKek: string }[]): Promise<void>;
  /** Par de recuperacion nuevo: reemplaza envolturas y custodios en una transaccion. */
  reenvolverRecuperacion(cambios: { id: string; dekPorRecuperacion: Buffer }[], custodios: Custodio[]): Promise<void>;
  evento(tipo: TipoEventoLlaves, detalle: string, actor: string): Promise<void>;
}

export const PARTES = 3;
export const UMBRAL = 2;

export function generarKek(): Buffer {
  return randomBytes(32);
}

export function generarParRecuperacion(): { publica: string; privada: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publica: publicKey, privada: privateKey };
}

export function envolverConRecuperacion(publicaPem: string, dek: Buffer): Buffer {
  return publicEncrypt({ key: publicaPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, dek);
}

export function desenvolverConRecuperacion(privadaPem: string, envuelta: Buffer): Buffer {
  try {
    return privateDecrypt({ key: privadaPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, envuelta);
  } catch {
    throw new ErrorCifrado('La llave de recuperacion no abre esta DEK');
  }
}

export function nuevaDek(
  categoria: CategoriaLlave,
  version: number,
  activa: boolean,
  kek: Buffer,
  publicaPem: string,
): FilaLlaveCompleta {
  const id = randomUUID();
  const dek = randomBytes(32);
  return {
    id,
    categoria,
    version,
    activa,
    dekPorKek: envolverConKek(kek, dek, id),
    dekPorRecuperacion: envolverConRecuperacion(publicaPem, dek),
    huellaKek: huellaKek(kek),
    canario: crearCanario(categoria, dek, id, version),
    retiradaEn: null,
  };
}

/** Divide la privada en 3 partes (umbral 2) y verifica cada par posible. */
export async function dividirPrivada(privadaPem: string): Promise<Buffer[]> {
  const secreto = new Uint8Array(Buffer.from(privadaPem, 'utf8'));
  const partes = (await split(secreto, PARTES, UMBRAL)).map((p) => Buffer.from(p));
  for (let i = 0; i < PARTES; i++) {
    for (let j = i + 1; j < PARTES; j++) {
      if ((await reconstruirPrivada([partes[i], partes[j]])) !== privadaPem) {
        throw new ErrorCifrado(`Las partes ${i + 1} y ${j + 1} no reconstruyen la privada`);
      }
    }
  }
  return partes;
}

export async function reconstruirPrivada(partes: Buffer[]): Promise<string> {
  if (partes.length < UMBRAL) {
    throw new ErrorCifrado(`Se necesitan al menos ${UMBRAL} partes`);
  }
  let pem: string;
  try {
    pem = Buffer.from(await combine(partes.map((p) => new Uint8Array(p)))).toString('utf8');
    createPrivateKey(pem);
  } catch {
    throw new ErrorCifrado('Las partes no reconstruyen una llave privada valida');
  }
  return pem;
}

function escribirPartes(partesDir: string, custodios: Custodio[], partes: Buffer[]): void {
  mkdirSync(partesDir, { recursive: true });
  partes.forEach((parte, i) =>
    writeFileSync(join(partesDir, `parte_${custodios[i].parte}.shamir`), parte, { flag: 'wx', mode: 0o600 }),
  );
}

function rutasLibres(rutas: string[]): void {
  for (const ruta of rutas) {
    if (existsSync(ruta)) {
      throw new ErrorCifrado(`Ya existe ${ruta}: el script nunca sobrescribe una llave`);
    }
  }
}

export interface OpcionesAprovisionar {
  kekPath: string;
  publicaPath: string;
  partesDir: string;
  custodios: Custodio[];
  actor: string;
}

/**
 * Aprovisiona un silo: KEK, par de recuperacion, una DEK v1 activa por
 * categoria con su canario, y 3 partes de la privada en archivos separados.
 * Se niega si ya existen la KEK, la publica, partes o filas en llaves_datos.
 * La privada solo vive en memoria: nunca toca el disco.
 */
export async function aprovisionar(op: OpcionesAprovisionar, almacen: AlmacenLlaves): Promise<void> {
  if (op.custodios.length !== PARTES) {
    throw new ErrorCifrado(`Se requieren ${PARTES} custodios`);
  }
  rutasLibres([op.kekPath, op.publicaPath, ...op.custodios.map((c) => join(op.partesDir, `parte_${c.parte}.shamir`))]);
  if ((await almacen.listar()).length > 0) {
    throw new ErrorCifrado('llaves_datos ya tiene llaves: aprovisionar nunca sobrescribe una llave');
  }

  const kek = generarKek();
  const { publica, privada } = generarParRecuperacion();
  const filas = CATEGORIAS.map((categoria) => nuevaDek(categoria, 1, true, kek, publica));
  const partes = await dividirPrivada(privada);

  escribirPartes(op.partesDir, op.custodios, partes);
  writeFileSync(op.kekPath, kek, { flag: 'wx', mode: 0o600 });
  writeFileSync(op.publicaPath, publica, { flag: 'wx', mode: 0o644 });

  await almacen.insertar(filas, op.custodios);
  await almacen.evento('APROVISIONAMIENTO', `DEK v1 de ${CATEGORIAS.join(', ')}; ${PARTES} partes, umbral ${UMBRAL}`, op.actor);
}

/**
 * Rotacion fase 1: crea una version nueva (inactiva) por categoria, envuelta
 * con la KEK y la publica. No toca las versiones existentes. La categoria
 * HMAC no rota de forma rutinaria (invalidaria los indices ciegos): solo ante
 * compromiso, con el recalculo de rut_hmac del runbook (la CLI lo exige
 * explicito).
 */
export async function rotarCrear(
  kek: Buffer,
  publicaPem: string,
  categorias: CategoriaLlave[],
  almacen: AlmacenLlaves,
  actor: string,
): Promise<FilaLlaveCompleta[]> {
  const actuales = await almacen.listar();
  if (actuales.some((f) => !f.activa && f.retiradaEn === null)) {
    throw new ErrorCifrado('Hay una rotacion pendiente: activarla o completarla antes de crear otra');
  }
  const nuevas = categorias.map((categoria) => {
    const version = Math.max(0, ...actuales.filter((f) => f.categoria === categoria).map((f) => f.version)) + 1;
    return nuevaDek(categoria, version, false, kek, publicaPem);
  });
  await almacen.insertar(nuevas, []);
  await almacen.evento('ROTACION', `fase 1 (creadas): ${nuevas.map((f) => `${f.categoria} v${f.version}`).join(', ')}`, actor);
  return nuevas;
}

/**
 * Rotacion fase 2: verifica (KEK abre la DEK, canario OK, envoltura de
 * recuperacion presente) y activa. La version anterior queda retirada: ya no
 * cifra, pero sigue descifrando sus datos.
 */
export async function rotarActivar(kek: Buffer, almacen: AlmacenLlaves, actor: string): Promise<void> {
  const pendientes = (await almacen.listar()).filter((f) => !f.activa && f.retiradaEn === null);
  if (pendientes.length === 0) {
    throw new ErrorCifrado('No hay versiones creadas para activar');
  }
  for (const fila of pendientes) {
    const dek = desenvolverConKek(kek, fila.dekPorKek, fila.id);
    if (!canarioValido(fila.categoria, dek, fila.id, fila.canario) || fila.dekPorRecuperacion.length === 0) {
      throw new ErrorCifrado(`Version ${fila.categoria} v${fila.version} no verifica: no se activa`);
    }
  }
  await almacen.activar(pendientes.map((f) => f.id));
  await almacen.evento('ROTACION', `fase 2 (activadas): ${pendientes.map((f) => `${f.categoria} v${f.version}`).join(', ')}`, actor);
}

async function reenvolverTodas(
  almacen: AlmacenLlaves,
  kekNueva: Buffer,
  abrir: (fila: FilaLlaveCompleta) => Buffer,
): Promise<void> {
  const cambios = (await almacen.listar()).map((fila) => {
    const dek = abrir(fila);
    if (!canarioValido(fila.categoria, dek, fila.id, fila.canario)) {
      throw new ErrorCifrado(`Canario invalido en ${fila.categoria} v${fila.version}: no se re-envuelve nada`);
    }
    return { id: fila.id, dekPorKek: envolverConKek(kekNueva, dek, fila.id), huellaKek: huellaKek(kekNueva) };
  });
  await almacen.reenvolver(cambios);
}

/** Rotacion planificada de la KEK: abre con la actual, envuelve con la nueva. */
export async function rotarKek(kekActual: Buffer, kekNueva: Buffer, almacen: AlmacenLlaves, actor: string): Promise<void> {
  await reenvolverTodas(almacen, kekNueva, (f) => desenvolverConKek(kekActual, f.dekPorKek, f.id));
  await almacen.evento('ROTACION', `KEK re-envuelta; huella nueva ${huellaKek(kekNueva).slice(0, 12)}`, actor);
}

/** KEK perdida o comprometida: 2 partes -> privada -> DEKs -> KEK nueva. */
export async function recuperar(partes: Buffer[], kekNueva: Buffer, almacen: AlmacenLlaves, actor: string): Promise<void> {
  const privada = await reconstruirPrivada(partes);
  await reenvolverTodas(almacen, kekNueva, (f) => desenvolverConRecuperacion(privada, f.dekPorRecuperacion));
  await almacen.evento('RESTAURACION', `DEKs recuperadas con ${partes.length} partes; huella nueva ${huellaKek(kekNueva).slice(0, 12)}`, actor);
}

/**
 * Cambio de custodios (o sospecha sobre una parte): par de recuperacion
 * nuevo, todas las DEK re-envueltas con la publica nueva (se abren con la
 * KEK) y 3 partes nuevas. Las partes anteriores dejan de servir: abren la
 * privada vieja, que ya no corresponde a ninguna envoltura.
 */
export async function rotarRecuperacion(
  kek: Buffer,
  op: { publicaPath: string; partesDir: string; custodios: Custodio[]; actor: string },
  almacen: AlmacenLlaves,
): Promise<void> {
  if (op.custodios.length !== PARTES) {
    throw new ErrorCifrado(`Se requieren ${PARTES} custodios`);
  }
  rutasLibres([op.publicaPath, ...op.custodios.map((c) => join(op.partesDir, `parte_${c.parte}.shamir`))]);
  const { publica, privada } = generarParRecuperacion();
  const cambios = (await almacen.listar()).map((fila) => {
    const dek = desenvolverConKek(kek, fila.dekPorKek, fila.id);
    if (!canarioValido(fila.categoria, dek, fila.id, fila.canario)) {
      throw new ErrorCifrado(`Canario invalido en ${fila.categoria} v${fila.version}: no se cambia nada`);
    }
    return { id: fila.id, dekPorRecuperacion: envolverConRecuperacion(publica, dek) };
  });
  const partes = await dividirPrivada(privada);
  escribirPartes(op.partesDir, op.custodios, partes);
  writeFileSync(op.publicaPath, publica, { flag: 'wx', mode: 0o644 });
  await almacen.reenvolverRecuperacion(cambios, op.custodios);
  await almacen.evento('CAMBIO_CUSTODIO', `par de recuperacion nuevo; custodios: ${op.custodios.map((c) => c.custodio).join(', ')}`, op.actor);
}

/**
 * Verifica todas las versiones por una via (KEK o partes de recuperacion).
 * Devuelve la lista de fallos (vacia = todo OK). No escribe nada.
 */
export async function verificar(
  filas: FilaLlaveCompleta[],
  via: { kek: Buffer } | { partes: Buffer[] },
): Promise<string[]> {
  const privada = 'partes' in via ? await reconstruirPrivada(via.partes) : null;
  const fallos: string[] = [];
  for (const fila of filas) {
    const nombre = `${fila.categoria} v${fila.version}`;
    try {
      if ('kek' in via && fila.huellaKek !== huellaKek(via.kek)) {
        fallos.push(`${nombre}: huella de KEK distinta`);
        continue;
      }
      const dek = privada
        ? desenvolverConRecuperacion(privada, fila.dekPorRecuperacion)
        : desenvolverConKek((via as { kek: Buffer }).kek, fila.dekPorKek, fila.id);
      if (!canarioValido(fila.categoria, dek, fila.id, fila.canario)) {
        fallos.push(`${nombre}: canario invalido`);
      }
    } catch (e) {
      fallos.push(`${nombre}: ${(e as Error).message}`);
    }
  }
  return fallos;
}
