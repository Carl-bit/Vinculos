import { Injectable } from '@nestjs/common';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import type { AgregarFeriadoDto, FeriadoVista } from './dto/nucleo.dto';

/**
 * AUD-01 (E2.3a): feriados para los plazos en dias habiles. Los de la ley los
 * calcula la BD (generar_feriados, job diario); el ADMIN agrega los puntuales
 * o regionales y quita uno si hace falta, solo de hoy en adelante.
 */
@Injectable()
export class FeriadosService {
  constructor(private readonly bd: ContextoBd) {}

  async delAnio(anio: number): Promise<FeriadoVista[]> {
    const filas = await this.bd.tx().feriado.findMany({
      where: { fecha: { gte: new Date(Date.UTC(anio, 0, 1)), lt: new Date(Date.UTC(anio + 1, 0, 1)) } },
      select: { fecha: true, nombre: true, origen: true, quitadoEn: true },
      orderBy: { fecha: 'asc' },
    });
    return filas.map((f) => ({
      fecha: f.fecha.toISOString().slice(0, 10),
      nombre: f.nombre,
      origen: f.origen as FeriadoVista['origen'],
      quitado: f.quitadoEn !== null,
    }));
  }

  async agregar(dto: AgregarFeriadoDto): Promise<FeriadoVista[]> {
    await this.bd.tx().$executeRaw`SELECT agregar_feriado(${dto.fecha}::date, ${dto.nombre})`;
    return this.delAnio(Number(dto.fecha.slice(0, 4)));
  }

  async quitar(fecha: string): Promise<FeriadoVista[]> {
    await this.bd.tx().$executeRaw`SELECT quitar_feriado(${fecha}::date)`;
    return this.delAnio(Number(fecha.slice(0, 4)));
  }
}
