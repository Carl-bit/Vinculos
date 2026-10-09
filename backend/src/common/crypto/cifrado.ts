/**
 * Cifrado de aplicacion (envelope encryption). La BD nunca ve llaves en claro.
 *
 * KEK (llave de cifrado de llaves): 32 bytes por silo, Docker secret montado
 * solo en el servicio api. Envuelve las DEK (llaves de datos) guardadas en
 * llaves_datos. Cada DEK cifra una categoria de datos con AES-256-GCM.
 *
 * Formato de un valor cifrado (bytea en la BD):
 *   [1 formato][16 id DEK][4 version DEK][12 IV][N cifrado][16 tag]
 * AAD = "tabla:columna:id_fila": un valor copiado a otra fila o columna no
 * descifra. Largo minimo = 49 bytes (texto vacio), igual al CHECK de la BD.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type CategoriaLlave = 'IDENTIFICACION' | 'CLINICO' | 'FINANCIERO' | 'HMAC';
export const CATEGORIAS: readonly CategoriaLlave[] = ['IDENTIFICACION', 'CLINICO', 'FINANCIERO', 'HMAC'];

/** Fila de llaves_vigentes() (lo que la API puede leer). */
export interface FilaLlave {
  id: string;
  categoria: CategoriaLlave;
  version: number;
  activa: boolean;
  dekPorKek: Buffer;
  huellaKek: string;
  canario: Buffer;
}

export class ErrorCifrado extends Error {}

const FORMATO = 1;
const LARGO_ID = 16;
const LARGO_IV = 12;
const LARGO_TAG = 16;
const LARGO_CABECERA = 1 + LARGO_ID + 4;
export const LARGO_MINIMO = LARGO_CABECERA + LARGO_IV + LARGO_TAG;
/** Valor conocido que se cifra con cada DEK para detectar llaves rotas. */
export const CANARIO = 'vinculos:canario:v1';

export function aad(tabla: string, columna: string, idFila: string): string {
  return `${tabla}:${columna}:${idFila}`;
}

/** Huella de la KEK: identifica la llave sin revelarla (HMAC, no hash directo). */
export function huellaKek(kek: Buffer): string {
  return createHmac('sha256', kek).update('vinculos:huella-kek').digest('hex');
}

function gcmCifrar(llave: Buffer, claro: Buffer, aadTexto: string): { iv: Buffer; cifrado: Buffer; tag: Buffer } {
  const iv = randomBytes(LARGO_IV);
  const c = createCipheriv('aes-256-gcm', llave, iv);
  c.setAAD(Buffer.from(aadTexto, 'utf8'));
  const cifrado = Buffer.concat([c.update(claro), c.final()]);
  return { iv, cifrado, tag: c.getAuthTag() };
}

function gcmDescifrar(llave: Buffer, iv: Buffer, cifrado: Buffer, tag: Buffer, aadTexto: string): Buffer {
  try {
    const d = createDecipheriv('aes-256-gcm', llave, iv);
    d.setAAD(Buffer.from(aadTexto, 'utf8'));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(cifrado), d.final()]);
  } catch {
    throw new ErrorCifrado('No se pudo descifrar: dato alterado, AAD distinto o llave incorrecta');
  }
}

/** DEK envuelta con la KEK: IV | cifrado | tag, AAD = "dek:<id>". */
export function envolverConKek(kek: Buffer, dek: Buffer, dekId: string): Buffer {
  const { iv, cifrado, tag } = gcmCifrar(kek, dek, `dek:${dekId}`);
  return Buffer.concat([iv, cifrado, tag]);
}

export function desenvolverConKek(kek: Buffer, envuelta: Buffer, dekId: string): Buffer {
  return gcmDescifrar(
    kek,
    envuelta.subarray(0, LARGO_IV),
    envuelta.subarray(LARGO_IV, envuelta.length - LARGO_TAG),
    envuelta.subarray(envuelta.length - LARGO_TAG),
    `dek:${dekId}`,
  );
}

function uuidABytes(id: string): Buffer {
  return Buffer.from(id.replace(/-/g, ''), 'hex');
}

function bytesAUuid(b: Buffer): string {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function cifrarConDek(dek: Buffer, dekId: string, version: number, valor: string, aadTexto: string): Buffer {
  const cabecera = Buffer.alloc(LARGO_CABECERA);
  cabecera.writeUInt8(FORMATO, 0);
  uuidABytes(dekId).copy(cabecera, 1);
  cabecera.writeUInt32BE(version, 1 + LARGO_ID);
  // La cabecera tambien se autentica: cambiar la DEK o version referida falla.
  const { iv, cifrado, tag } = gcmCifrar(dek, Buffer.from(valor, 'utf8'), aadTexto + '|' + cabecera.toString('hex'));
  return Buffer.concat([cabecera, iv, cifrado, tag]);
}

export function leerCabecera(datos: Buffer): { dekId: string; version: number } {
  if (datos.length < LARGO_MINIMO || datos.readUInt8(0) !== FORMATO) {
    throw new ErrorCifrado('Formato de dato cifrado desconocido');
  }
  return { dekId: bytesAUuid(datos.subarray(1, 1 + LARGO_ID)), version: datos.readUInt32BE(1 + LARGO_ID) };
}

export function descifrarConDek(dek: Buffer, datos: Buffer, aadTexto: string): string {
  leerCabecera(datos);
  const cabecera = datos.subarray(0, LARGO_CABECERA);
  const claro = gcmDescifrar(
    dek,
    datos.subarray(LARGO_CABECERA, LARGO_CABECERA + LARGO_IV),
    datos.subarray(LARGO_CABECERA + LARGO_IV, datos.length - LARGO_TAG),
    datos.subarray(datos.length - LARGO_TAG),
    aadTexto + '|' + cabecera.toString('hex'),
  );
  return claro.toString('utf8');
}

export function hmacConDek(dek: Buffer, valor: string): Buffer {
  return createHmac('sha256', dek).update(valor, 'utf8').digest();
}

/** Canario de una DEK: HMAC para la categoria HMAC, cifrado para el resto. */
export function crearCanario(categoria: CategoriaLlave, dek: Buffer, dekId: string, version: number): Buffer {
  return categoria === 'HMAC'
    ? hmacConDek(dek, CANARIO)
    : cifrarConDek(dek, dekId, version, CANARIO, `canario:${dekId}`);
}

export function canarioValido(categoria: CategoriaLlave, dek: Buffer, dekId: string, canario: Buffer): boolean {
  try {
    if (categoria === 'HMAC') {
      const esperado = hmacConDek(dek, CANARIO);
      return esperado.length === canario.length && timingSafeEqual(esperado, canario);
    }
    return descifrarConDek(dek, canario, `canario:${dekId}`) === CANARIO;
  } catch {
    return false;
  }
}

/**
 * RUT chileno normalizado para el indice ciego: sin puntos, guion ni
 * espacios, K mayuscula. La validacion de digito verificador es de los DTOs.
 */
export function normalizarRut(rut: string): string {
  const limpio = rut.replace(/[.\-\s]/g, '').toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) {
    throw new ErrorCifrado('RUT con formato invalido');
  }
  return limpio;
}

interface DekCargada {
  fila: FilaLlave;
  dek: Buffer;
}

/**
 * Llavero de la API: DEKs desenvueltas en memoria. `cargar` falla cerrado (la
 * API no debe arrancar) si la huella de la KEK montada no coincide, si algun
 * canario no verifica o si falta una DEK activa por categoria.
 */
export class Llavero {
  private constructor(
    private readonly porId: Map<string, DekCargada>,
    private readonly activas: Map<CategoriaLlave, DekCargada>,
  ) {}

  static cargar(kek: Buffer, filas: FilaLlave[]): Llavero {
    if (kek.length !== 32) {
      throw new ErrorCifrado('La KEK debe tener 32 bytes');
    }
    const huella = huellaKek(kek);
    const porId = new Map<string, DekCargada>();
    const activas = new Map<CategoriaLlave, DekCargada>();
    for (const fila of filas) {
      if (fila.huellaKek !== huella) {
        throw new ErrorCifrado(`La KEK montada no corresponde a la DEK ${fila.categoria} v${fila.version}`);
      }
      const dek = desenvolverConKek(kek, fila.dekPorKek, fila.id);
      if (!canarioValido(fila.categoria, dek, fila.id, fila.canario)) {
        throw new ErrorCifrado(`Canario invalido en DEK ${fila.categoria} v${fila.version}`);
      }
      const cargada = { fila, dek };
      porId.set(fila.id, cargada);
      if (fila.activa) {
        activas.set(fila.categoria, cargada);
      }
    }
    for (const categoria of CATEGORIAS) {
      if (!activas.has(categoria)) {
        throw new ErrorCifrado(`Sin DEK activa para ${categoria}`);
      }
    }
    return new Llavero(porId, activas);
  }

  cifrar(valor: string, categoria: Exclude<CategoriaLlave, 'HMAC'>, aadTexto: string): Buffer {
    const { fila, dek } = this.activas.get(categoria)!;
    return cifrarConDek(dek, fila.id, fila.version, valor, aadTexto);
  }

  /** Descifra con la DEK que indica la cabecera (sirve para versiones retiradas). */
  descifrar(datos: Buffer, aadTexto: string): string {
    const { dekId, version } = leerCabecera(datos);
    const cargada = this.porId.get(dekId);
    if (!cargada || cargada.fila.version !== version) {
      throw new ErrorCifrado('DEK del dato no disponible');
    }
    return descifrarConDek(cargada.dek, datos, aadTexto);
  }

  hmac(valor: string): Buffer {
    return hmacConDek(this.activas.get('HMAC')!.dek, valor);
  }

  hmacRut(rut: string): Buffer {
    return this.hmac(normalizarRut(rut));
  }
}
