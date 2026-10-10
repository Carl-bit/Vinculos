/**
 * Recalculo de los indices ciegos rut_hmac despues de rotar la DEK HMAC por
 * compromiso (docs/seguridad/runbooks_llaves.md, seccion 5, paso 3). Job
 * MANUAL (no programado): lo corre el operador con
 * `sh infra/scripts/llaves/rotar.sh recalcular-hmac` en la ventana de
 * mantencion, despues de activar la HMAC nueva.
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
