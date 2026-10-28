import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import type { FiltroAuditoriaDto, RegistroAuditoria } from './dto/nucleo.dto';

const LIMITE = 300;
const SIETE_DIAS = 7 * 86_400_000;

/**
 * AUD-01 (E1.5, CENS-S3): auditoria de accesos para ADMIN. Une accesos_ficha
 * (lecturas, escrituras, descargas, envios y exportaciones de datos de un
 * paciente) y registro_exportaciones (descargas sin paciente). Ambas tablas
 * las lee solo ADMIN (RLS). Los nombres del equipo salen de
 * directorio_interno(); los de pacientes, de la fila que ADMIN ya ve.
 */
@Injectable()
export class AuditoriaService {
  constructor(private readonly bd: ContextoBd) {}

  async registros(f: FiltroAuditoriaDto): Promise<RegistroAuditoria[]> {
    const tx = this.bd.tx();
    const hasta = f.hasta ?? new Date();
    const desde = f.desde ?? new Date(hasta.getTime() - SIETE_DIAS);
    const enRango = { gte: desde, lt: hasta };
    const [accesos, exportaciones, equipo] = await Promise.all([
      tx.accesoFicha.findMany({
        where: { ocurridoEn: enRango, pacienteId: f.pacienteId, usuarioId: f.usuarioId, accion: f.accion },
        orderBy: { ocurridoEn: 'desc' },
        take: LIMITE,
      }),
      // Las exportaciones sin paciente no aparecen al filtrar por paciente.
      f.pacienteId || (f.accion && f.accion !== 'EXPORTACION' && f.accion !== 'DESCARGA')
        ? Promise.resolve([])
        : tx.registroExportacion.findMany({
            where: { ocurridoEn: enRango, usuarioId: f.usuarioId },
            orderBy: { ocurridoEn: 'desc' },
            take: LIMITE,
          }),
      tx.$queryRaw<{ id: string; nombre: string | null }[]>(Prisma.sql`SELECT id, nombre FROM directorio_interno()`),
    ]);
    const idsPacientes = [...new Set(accesos.map((a) => a.pacienteId))];
    const pacientes = idsPacientes.length
      ? await tx.paciente.findMany({ where: { id: { in: idsPacientes } }, select: { id: true, nombre: true, apellido: true } })
      : [];
    const nombreUsuario = new Map(equipo.map((u) => [u.id, u.nombre]));
    const nombrePaciente = new Map(pacientes.map((p) => [p.id, `${p.nombre} ${p.apellido}`]));
    const filas: RegistroAuditoria[] = [
      ...accesos.map((a) => ({
        id: a.id,
        origen: 'ACCESO_FICHA' as const,
        ocurridoEn: a.ocurridoEn,
        usuarioId: a.usuarioId,
        usuarioNombre: nombreUsuario.get(a.usuarioId) ?? null,
        rol: a.rol,
        pacienteId: a.pacienteId,
        pacienteNombre: nombrePaciente.get(a.pacienteId) ?? null,
        recurso: a.recurso,
        accion: a.accion,
        detalle: a.detalle,
      })),
      ...exportaciones.map((e) => ({
        id: e.id,
        origen: 'EXPORTACION' as const,
        ocurridoEn: e.ocurridoEn,
        usuarioId: e.usuarioId,
        usuarioNombre: nombreUsuario.get(e.usuarioId) ?? null,
        rol: e.rol,
        pacienteId: null,
        pacienteNombre: null,
        recurso: e.recurso,
        accion: 'DESCARGA',
        detalle: e.detalle,
      })),
    ];
    return filas.sort((x, y) => y.ocurridoEn.getTime() - x.ocurridoEn.getTime()).slice(0, LIMITE);
  }
}
