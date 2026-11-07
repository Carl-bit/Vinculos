import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type Rol } from '@prisma/client';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LIMITE_POR_DEFECTO } from '../../core/validacion/paginacion';
import type { FiltroAuditoriaDto, PaginaAuditoria } from './dto/nucleo.dto';

const SIETE_DIAS = 7 * 86_400_000;

type Fila = {
  id: string;
  origen: 'ACCESO_FICHA' | 'EXPORTACION';
  ocurrido_en: Date;
  /** ocurrido_en en texto con microsegundos: el cursor no pierde precision (Date de JS llega a ms). */
  marca: string;
  usuario_id: string;
  rol: Rol;
  paciente_id: string | null;
  recurso: string;
  accion: string;
  detalle: string | null;
};

/** Cursor opaco: base64url de "marca|id" de la ultima fila entregada. */
const cursorDe = (f: Fila) => Buffer.from(`${f.marca}|${f.id}`).toString('base64url');
function leerCursor(cursor: string): [string, string] {
  const [marca, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  // Texto de timestamptz de Postgres ("2026-11-07 14:30:12.123456-03"); Date.parse no acepta el offset "-03".
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/.test(marca ?? '') || !/^[0-9a-f-]{36}$/.test(id ?? '')) {
    throw new BadRequestException('cursor invalido');
  }
  return [marca, id];
}

/**
 * AUD-01 (E1.5, CENS-S3): auditoria de accesos para ADMIN. Une accesos_ficha
 * (lecturas, escrituras, descargas, envios y exportaciones de datos de un
 * paciente) y registro_exportaciones (descargas sin paciente). Ambas tablas
 * las lee solo ADMIN (RLS). Los nombres del equipo salen de
 * directorio_interno(); los de pacientes, de la fila que ADMIN ya ve.
 * AUD-02 (API-01): paginada por cursor (ocurrido_en, id), maximo 100 por pagina.
 */
@Injectable()
export class AuditoriaService {
  constructor(private readonly bd: ContextoBd) {}

  async registros(f: FiltroAuditoriaDto): Promise<PaginaAuditoria> {
    const tx = this.bd.tx();
    const limite = f.limite ?? LIMITE_POR_DEFECTO;
    const hasta = f.hasta ?? new Date();
    const desde = f.desde ?? new Date(hasta.getTime() - SIETE_DIAS);
    const [marca, idCursor] = f.cursor ? leerCursor(f.cursor) : [null, null];
    const antes = marca ? Prisma.sql`AND (ocurrido_en, id) < (${marca}::timestamptz, ${idCursor}::uuid)` : Prisma.empty;
    const deAcceso = Prisma.sql`${f.pacienteId ? Prisma.sql`AND paciente_id = ${f.pacienteId}::uuid` : Prisma.empty}
      ${f.usuarioId ? Prisma.sql`AND usuario_id = ${f.usuarioId}::uuid` : Prisma.empty}
      ${f.accion ? Prisma.sql`AND accion = ${f.accion}` : Prisma.empty}`;
    // Las exportaciones sin paciente no aparecen al filtrar por paciente ni por otra accion.
    const conExportaciones = !f.pacienteId && (!f.accion || f.accion === 'EXPORTACION' || f.accion === 'DESCARGA');
    const [filas, equipo] = await Promise.all([
      tx.$queryRaw<Fila[]>(Prisma.sql`
        SELECT * FROM (
          SELECT id, 'ACCESO_FICHA' AS origen, ocurrido_en, ocurrido_en::text AS marca, usuario_id, rol, paciente_id, recurso, accion, detalle
          FROM accesos_ficha
          WHERE ocurrido_en >= ${desde} AND ocurrido_en < ${hasta} ${deAcceso} ${antes}
          UNION ALL
          SELECT id, 'EXPORTACION', ocurrido_en, ocurrido_en::text, usuario_id, rol, NULL::uuid, recurso, 'DESCARGA', detalle
          FROM registro_exportaciones
          WHERE ${conExportaciones} AND ocurrido_en >= ${desde} AND ocurrido_en < ${hasta}
            ${f.usuarioId ? Prisma.sql`AND usuario_id = ${f.usuarioId}::uuid` : Prisma.empty} ${antes}
        ) t
        ORDER BY ocurrido_en DESC, id DESC
        LIMIT ${limite + 1}`),
      tx.$queryRaw<{ id: string; nombre: string | null }[]>(Prisma.sql`SELECT id, nombre FROM directorio_interno()`),
    ]);
    const pagina = filas.slice(0, limite);
    const idsPacientes = [...new Set(pagina.flatMap((a) => (a.paciente_id ? [a.paciente_id] : [])))];
    const pacientes = idsPacientes.length
      ? await tx.paciente.findMany({ where: { id: { in: idsPacientes } }, select: { id: true, nombre: true, apellido: true } })
      : [];
    const nombreUsuario = new Map(equipo.map((u) => [u.id, u.nombre]));
    const nombrePaciente = new Map(pacientes.map((p) => [p.id, `${p.nombre} ${p.apellido}`]));
    return {
      items: pagina.map((a) => ({
        id: a.id,
        origen: a.origen,
        ocurridoEn: a.ocurrido_en,
        usuarioId: a.usuario_id,
        usuarioNombre: nombreUsuario.get(a.usuario_id) ?? null,
        rol: a.rol,
        pacienteId: a.paciente_id,
        pacienteNombre: a.paciente_id ? (nombrePaciente.get(a.paciente_id) ?? null) : null,
        recurso: a.recurso,
        accion: a.accion,
        detalle: a.detalle,
      })),
      siguienteCursor: filas.length > limite ? cursorDe(pagina[pagina.length - 1]) : null,
    };
  }
}
