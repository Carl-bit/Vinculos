/**
 * Marca de "valor en claro a cifrar" para los campos de CAMPOS_CIFRADOS.
 *
 * Los servicios nunca cifran a mano: escriben `rut: claro(dto.rut)` y la
 * extension de Prisma (cifrado.extension.ts) lo cifra con el AAD de la fila.
 * Un Buffer en un campo cifrado se rechaza (evita guardar texto plano o un
 * cifrado hecho con otro AAD). Al leer, la extension deja el campo como
 * string: `texto(fila.rut)` lo recupera con su tipo real.
 *
 * Es un objeto plano tipado como Uint8Array (el tipo Bytes de Prisma): Prisma
 * clona los args antes de la extension y un Uint8Array marcado perderia la
 * marca al clonarse.
 */
const MARCA = '__vinculosClaro';

export interface Claro {
  [MARCA]: string;
}

export function esClaro(valor: unknown): valor is Claro {
  return typeof valor === 'object' && valor !== null && typeof (valor as Record<string, unknown>)[MARCA] === 'string';
}

export function valorClaro(valor: Claro): string {
  return valor[MARCA];
}

export function claro(valor: string): Uint8Array<ArrayBuffer>;
export function claro(valor: string | null | undefined): Uint8Array<ArrayBuffer> | null | undefined;
export function claro(valor: string | null | undefined): Uint8Array<ArrayBuffer> | null | undefined {
  return valor === null || valor === undefined ? valor : ({ [MARCA]: valor } as unknown as Uint8Array<ArrayBuffer>);
}

/** Campo cifrado ya descifrado por la extension (en runtime es string). */
export function texto(valor: Uint8Array): string;
export function texto(valor: Uint8Array | null | undefined): string | null;
export function texto(valor: Uint8Array | null | undefined): string | null {
  if (valor === null || valor === undefined) {
    return null;
  }
  if (typeof valor !== 'string') {
    throw new Error('Campo cifrado sin descifrar: falta pasar por la extension de cifrado');
  }
  return valor;
}
