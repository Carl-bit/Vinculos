import { Injectable } from '@nestjs/common';

import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import type { EditarEspecialidadDto, EspecialidadDto } from './dto/mensajeria-interna.dto';

const VISTA_DECLARADA = { profesionalId: true, especialidadId: true, estado: true, revisadoEn: true, createdAt: true } as const;

/**
 * Especialidades (03a-2): catalogo (B) que solo ADMIN escribe; el profesional
 * declara las suyas (PROPUESTO) y ADMIN las aprueba o rechaza
 * (revisar_especialidad), como los tipos de atencion. Las plantillas clinicas
 * de una especialidad las usa quien la tiene aprobada.
 */
@Injectable()
export class EspecialidadesService {
  constructor(private readonly bd: ContextoBd) {}

  listar() {
    return this.bd.tx().especialidad.findMany({ orderBy: { nombre: 'asc' } });
  }

  crear(dto: EspecialidadDto) {
    return this.bd.tx().especialidad.create({ data: dto });
  }

  async editar(id: string, dto: EditarEspecialidadDto) {
    encontrado(await this.bd.tx().especialidad.findUnique({ where: { id }, select: { id: true } }), 'Especialidad');
    return this.bd.tx().especialidad.update({ where: { id }, data: dto });
  }

  declarar(especialidadId: string) {
    return this.bd.tx().profesionalEspecialidad.create({
      data: { profesionalId: this.bd.usuario().id, especialidadId },
      select: VISTA_DECLARADA,
    });
  }

  /** ADMIN/GESTION: todas; el propio: las suyas; el equipo clinico: las aprobadas (RLS). */
  declaradas(profesionalId?: string) {
    return this.bd.tx().profesionalEspecialidad.findMany({
      where: profesionalId ? { profesionalId } : {},
      select: VISTA_DECLARADA,
      orderBy: { createdAt: 'asc' },
    });
  }

  async revisar(profesionalId: string, especialidadId: string, aprobar: boolean) {
    const tx = this.bd.tx();
    await tx.$executeRaw`SELECT revisar_especialidad(${profesionalId}::uuid, ${especialidadId}::uuid, ${aprobar})`;
    return tx.profesionalEspecialidad.findUniqueOrThrow({
      where: { profesionalId_especialidadId: { profesionalId, especialidadId } },
      select: VISTA_DECLARADA,
    });
  }
}
