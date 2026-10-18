import { Injectable } from '@nestjs/common';

import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import type { MetricasMatch } from './dto/publico-respuestas.dto';
import type { EditarOpcionMatchDto, EditarPreguntaMatchDto, OpcionMatchDto, PreguntaMatchDto } from './dto/match.dto';

/** Configuracion del cuestionario del match (ADMIN, D-5). Nunca DELETE: se desactiva. */
@Injectable()
export class MatchConfigService {
  constructor(private readonly bd: ContextoBd) {}

  preguntas() {
    return this.bd.tx().matchPregunta.findMany({ include: { opciones: { orderBy: { orden: 'asc' } } }, orderBy: { orden: 'asc' } });
  }

  crearPregunta(dto: PreguntaMatchDto) {
    return this.bd.tx().matchPregunta.create({ data: { ...dto, propiaCentro: true }, include: { opciones: true } });
  }

  async editarPregunta(id: string, dto: EditarPreguntaMatchDto) {
    const tx = this.bd.tx();
    encontrado(await tx.matchPregunta.findUnique({ where: { id }, select: { id: true } }), 'Pregunta');
    return tx.matchPregunta.update({ where: { id }, data: dto, include: { opciones: true } });
  }

  async crearOpcion(preguntaId: string, dto: OpcionMatchDto) {
    const tx = this.bd.tx();
    encontrado(await tx.matchPregunta.findUnique({ where: { id: preguntaId }, select: { id: true } }), 'Pregunta');
    return tx.matchOpcion.create({ data: { ...dto, preguntaId } });
  }

  async editarOpcion(id: string, dto: EditarOpcionMatchDto) {
    const tx = this.bd.tx();
    encontrado(await tx.matchOpcion.findUnique({ where: { id }, select: { id: true } }), 'Opcion');
    return tx.matchOpcion.update({ where: { id }, data: dto });
  }

  async metricas(dias = 30) {
    const [{ m }] = await this.bd.tx().$queryRaw<[{ m: MetricasMatch }]>`SELECT metricas_match(${dias}::int) AS m`;
    return m;
  }
}
