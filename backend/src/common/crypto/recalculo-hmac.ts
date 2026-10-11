/**
 * Recalculo de los indices ciegos rut_hmac ante compromiso de la DEK HMAC
 * (docs/seguridad/runbooks_llaves.md, seccion 5). Comando MANUAL de
 * mantencion (nunca en el contenedor de la API ni programado): lo corre el
 * operador con `sh infra/scripts/llaves/rotar.sh recalcular-hmac` en un
 * contenedor puntual (servicio migrate), con la API detenida, despues de
 * crear la HMAC nueva y ANTES de activarla (usa la version pendiente si la
 * hay: si el recalculo falla, nada quedo activado). Luego `activar` y
 * `verificar-hmac`.
 *
 * Corre como dueño (BYPASSRLS, como el resto de la CLI de llaves): la API
 * (app_user) no puede actualizar profesional_datos_privados ajenos. Descifra
 * cada RUT con su AAD y recalcula el HMAC con la DEK HMAC activa, en lotes y
 * en transacciones. Idempotente: volver a correrlo deja el mismo resultado.
 * Un 23505 es un RUT duplicado real: el lote se reintenta fila a fila y el
 * duplicado se informa para resolverlo a mano.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import { aad, type Llavero } from './cifrado';

interface TablaRut {
  tabla: 'pacientes' | 'adultos_responsables' | 'profesional_datos_privados';
  id: 'id' | 'usuario_id';
}

export const TABLAS_RUT: readonly TablaRut[] = [
  { tabla: 'pacientes', id: 'id' },
  { tabla: 'adultos_responsables', id: 'id' },
  { tabla: 'profesional_datos_privados', id: 'usuario_id' },
];

export interface ResultadoRecalculo {
  tabla: string;
  conRut: number;
  actualizadas: number;
  duplicados: string[];
}

/**
 * Llavero para el recalculo: si hay una HMAC creada y aun no activada, la usa
 * como activa (solo en memoria); si no, la activa vigente.
 */
export function filasParaRecalculo<T extends { categoria: string; activa: boolean; retiradaEn: Date | null; id: string }>(filas: T[]): T[] {
  const pendiente = filas.find((f) => f.categoria === 'HMAC' && !f.activa && f.retiradaEn === null);
  return pendiente ? filas.map((f) => (f.categoria === 'HMAC' ? { ...f, activa: f.id === pendiente.id } : f)) : filas;
}

export interface ResultadoVerificacion {
  tabla: string;
  conRut: number;
  /** Filas cuyo rut_hmac coincide con el HMAC activo (la busqueda por RUT las encuentra). */
  coinciden: number;
  /** Indices repetidos (pacientes y profesionales: 0 por indice unico; adultos puede repetir). */
  repetidos: number;
}

/** Verificacion posterior: cada rut_hmac = HMAC activo del RUT descifrado, y conteo de repetidos. */
export async function verificarRutHmac(prisma: PrismaClient, llavero: Llavero): Promise<ResultadoVerificacion[]> {
  const resultados: ResultadoVerificacion[] = [];
  for (const t of TABLAS_RUT) {
    const tabla = Prisma.raw(t.tabla);
    const columnaId = Prisma.raw(t.id);
    const filas = await prisma.$queryRaw<{ id: string; rut: Uint8Array; rut_hmac: Uint8Array | null }[]>`
      SELECT ${columnaId}::text AS id, rut, rut_hmac FROM ${tabla} WHERE rut IS NOT NULL`;
    const coinciden = filas.filter(
      (f) => f.rut_hmac && llavero.hmacRut(llavero.descifrar(Buffer.from(f.rut), aad(t.tabla, 'rut', f.id))).equals(Buffer.from(f.rut_hmac)),
    ).length;
    const [{ n }] = await prisma.$queryRaw<[{ n: number }]>`
      SELECT count(*)::int AS n FROM (SELECT rut_hmac FROM ${tabla} WHERE rut_hmac IS NOT NULL GROUP BY rut_hmac HAVING count(*) > 1) x`;
    resultados.push({ tabla: t.tabla, conRut: filas.length, coinciden, repetidos: n });
  }
  return resultados;
}

export async function recalcularRutHmac(prisma: PrismaClient, llavero: Llavero, lote = 500): Promise<ResultadoRecalculo[]> {
  const resultados: ResultadoRecalculo[] = [];
  for (const t of TABLAS_RUT) {
    const tabla = Prisma.raw(t.tabla);
    const columnaId = Prisma.raw(t.id);
    const r: ResultadoRecalculo = { tabla: t.tabla, conRut: 0, actualizadas: 0, duplicados: [] };
    let despues = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const filas = await prisma.$queryRaw<{ id: string; rut: Uint8Array }[]>`
        SELECT ${columnaId}::text AS id, rut FROM ${tabla}
        WHERE rut IS NOT NULL AND ${columnaId} > ${despues}::uuid ORDER BY ${columnaId} LIMIT ${lote}`;
      if (filas.length === 0) {
        break;
      }
      const nuevos = filas.map((f) => ({
        id: f.id,
        hmac: llavero.hmacRut(llavero.descifrar(Buffer.from(f.rut), aad(t.tabla, 'rut', f.id))),
      }));
      const actualizar = (x: { id: string; hmac: Buffer }) =>
        prisma.$executeRaw`UPDATE ${tabla} SET rut_hmac = ${x.hmac} WHERE ${columnaId} = ${x.id}::uuid`;
      try {
        await prisma.$transaction(nuevos.map(actualizar));
        r.actualizadas += nuevos.length;
      } catch {
        for (const x of nuevos) {
          try {
            await actualizar(x);
            r.actualizadas += 1;
          } catch {
            r.duplicados.push(x.id);
          }
        }
      }
      r.conRut += filas.length;
      despues = filas[filas.length - 1].id;
    }
    resultados.push(r);
  }
  return resultados;
}
