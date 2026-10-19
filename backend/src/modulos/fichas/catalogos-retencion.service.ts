import { Injectable } from '@nestjs/common';
import type { DecisionRetencion, EstadoTipoSesion } from '@prisma/client';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import type { CatalogoDto, EditarCatalogoDto, ProponerTipoSesionDto, RevisarTipoSesionDto, RevisionRetencionDto } from './dto/fichas.dto';

/**
 * Catalogos clinicos (B) y revision de retencion (15 años, sin purga
 * automatica). Tipos de sesion: PROFESIONAL/PRACTICANTE proponen (la BD los
 * deja PROPUESTO), solo ADMIN aprueba, rechaza o desactiva.
 */
@Injectable()
export class CatalogosRetencionService {
  constructor(private readonly bd: ContextoBd) {}

  tiposSesion(estado?: EstadoTipoSesion) {
    return this.bd.tx().tipoSesion.findMany({ where: estado ? { estado } : {}, orderBy: { nombre: 'asc' } });
  }

  proponerTipoSesion(dto: ProponerTipoSesionDto) {
    return this.bd.tx().tipoSesion.create({ data: { nombre: dto.nombre, descripcion: dto.descripcion, propuestoPorId: this.bd.usuario().id } });
  }

  revisarTipoSesion(id: string, dto: RevisarTipoSesionDto) {
    return this.bd.tx().tipoSesion.update({ where: { id }, data: { estado: dto.estado, activo: dto.activo } });
  }

  intervenciones() {
    return this.bd.tx().intervencion.findMany({ orderBy: { nombre: 'asc' } });
  }

  crearIntervencion(dto: CatalogoDto) {
    return this.bd.tx().intervencion.create({ data: dto });
  }

  /** Solo ADMIN (RLS intervenciones_update). Inexistente -> 404 (P2025). */
  editarIntervencion(id: string, dto: EditarCatalogoDto) {
    return this.bd.tx().intervencion.update({ where: { id }, data: dto });
  }

  estadosAvance() {
    return this.bd.tx().estadoAvance.findMany({ orderBy: { nombre: 'asc' } });
  }

  crearEstadoAvance(dto: CatalogoDto) {
    return this.bd.tx().estadoAvance.create({ data: dto });
  }

  editarEstadoAvance(id: string, dto: EditarCatalogoDto) {
    return this.bd.tx().estadoAvance.update({ where: { id }, data: dto });
  }

  /** Registra la consulta (consultas_retencion) y cada ficha (accesos_ficha RETENCION). */
  fichasSobreRetencion() {
    return this.bd.tx().$queryRaw<
      { ficha_id: string; paciente_id: string; ultima_atencion_en: Date; ultima_decision: DecisionRetencion | null; ultima_revision_en: Date | null }[]
    >`SELECT * FROM fichas_sobre_retencion()`;
  }

  /** PURGAR solo registra la decision: la API no borra fichas. */
  revisarRetencion(dto: RevisionRetencionDto) {
    return this.bd.tx().revisionRetencion.create({
      data: { fichaId: dto.fichaId, decision: dto.decision, motivo: dto.motivo, revisadoPorId: this.bd.usuario().id },
    });
  }

  revisionesRetencion() {
    return this.bd.tx().revisionRetencion.findMany({ orderBy: { revisadoEn: 'desc' } });
  }
}
