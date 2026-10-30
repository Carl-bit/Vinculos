import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import type { RecordatorioPersonalDto, RecordatorioPersonalVista } from './dto/nucleo.dto';

const VISTA = { id: true, texto: true, venceEl: true, hechoEn: true, creadoEn: true } as const;

const vista = (r: { id: string; texto: Uint8Array; venceEl: Date | null; hechoEn: Date | null; creadoEn: Date }): RecordatorioPersonalVista => ({
  ...r,
  texto: texto(r.texto),
  venceEl: r.venceEl ? r.venceEl.toISOString().slice(0, 10) : null,
});

/**
 * 03b-4.2: recordatorios personales del equipo (lista de tareas del inicio).
 * La RLS deja ver y escribir solo los del autor; el texto va cifrado.
 */
@Injectable()
export class RecordatoriosPersonalesService {
  constructor(private readonly bd: ContextoBd) {}

  /** Pendientes primero (por fecha), luego los hechos recientes. */
  async listar(): Promise<RecordatorioPersonalVista[]> {
    const filas = await this.bd.tx().recordatorioPersonal.findMany({
      select: VISTA,
      orderBy: [{ hechoEn: { sort: 'desc', nulls: 'first' } }, { venceEl: { sort: 'asc', nulls: 'last' } }, { creadoEn: 'asc' }],
      take: 200,
    });
    return filas.map(vista);
  }

  async crear(dto: RecordatorioPersonalDto): Promise<RecordatorioPersonalVista> {
    const r = await this.bd.tx().recordatorioPersonal.create({
      data: {
        id: randomUUID(),
        autorId: this.bd.usuario().id,
        texto: claro(dto.texto),
        venceEl: dto.venceEl ? new Date(`${dto.venceEl}T00:00:00Z`) : null,
      },
      select: VISTA,
    });
    return vista(r);
  }

  async marcar(id: string, hecho: boolean): Promise<RecordatorioPersonalVista> {
    const tx = this.bd.tx();
    encontrado(await tx.recordatorioPersonal.findUnique({ where: { id }, select: { id: true } }), 'Recordatorio');
    return vista(await tx.recordatorioPersonal.update({ where: { id }, data: { hechoEn: hecho ? new Date() : null }, select: VISTA }));
  }

  async eliminar(id: string): Promise<void> {
    const { count } = await this.bd.tx().recordatorioPersonal.deleteMany({ where: { id } });
    encontrado(count || null, 'Recordatorio');
  }
}
