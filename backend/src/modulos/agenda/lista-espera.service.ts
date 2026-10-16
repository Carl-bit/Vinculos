import { Injectable } from '@nestjs/common';

import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import type { CrearListaEsperaDto, FiltroListaEsperaDto } from './dto/agenda.dto';

/**
 * Lista de espera (03a) por profesional o tipo de atencion. El aviso al
 * liberarse una hora lo crea la BD (trigger sobre citas, HORA_LIBERADA).
 * ADMIN/GESTION todas; el profesional las suyas y las de sus pacientes; el
 * paciente (o su adulto responsable) las propias (RLS).
 */
@Injectable()
export class ListaEsperaService {
  constructor(private readonly bd: ContextoBd) {}

  listar(filtro: FiltroListaEsperaDto) {
    return this.bd.tx().listaEspera.findMany({
      where: { profesionalId: filtro.profesionalId, estado: filtro.estado ?? 'ACTIVA' },
      orderBy: { creadaEn: 'asc' },
    });
  }

  crear(dto: CrearListaEsperaDto) {
    return this.bd.tx().listaEspera.create({
      data: {
        pacienteId: dto.pacienteId,
        profesionalId: dto.profesionalId,
        tipoAtencionId: dto.tipoAtencionId,
        preferencias: dto.preferencias,
        creadaPorId: this.bd.usuario().id,
      },
    });
  }

  /** ASIGNADA (se le dio un cupo) o CANCELADA. */
  async cerrar(id: string, estado: 'ASIGNADA' | 'CANCELADA') {
    const tx = this.bd.tx();
    encontrado(await tx.listaEspera.findUnique({ where: { id }, select: { id: true } }), 'Entrada de lista de espera');
    return tx.listaEspera.update({ where: { id }, data: { estado, cerradaEn: new Date() } });
  }
}
