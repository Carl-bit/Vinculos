import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DisponibilidadProfesional, ModalidadAtencion } from '@prisma/client';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import type { CrearBloqueoAgendaDto, CrearDisponibilidadDto, CrearEspacioDto, EditarEspacioDto, HorarioDto } from './dto/agenda.dto';

/** Minutos desde la medianoche -> "HH:MM" (solo presentacion; 1440 = "24:00", fin del dia). */
export function hora(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

const vistaDisponibilidad = (d: DisponibilidadProfesional) => ({ ...d, horaInicio: hora(d.inicioMin), horaFin: hora(d.finMin) });

export interface Hueco {
  modalidad: ModalidadAtencion;
  inicio: Date;
  fin: Date;
}

/**
 * Espacios, disponibilidad semanal, bloqueos de agenda, soft-locks y
 * consultas de ocupacion. La conversion de minutos locales a instantes la
 * hace solo la BD (minuto_local, America/Santiago): aqui no se calcula.
 */
@Injectable()
export class AgendaService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly config: ConfigService,
  ) {}

  espacios() {
    return this.bd.tx().espacio.findMany({ orderBy: { nombre: 'asc' } });
  }

  crearEspacio(dto: CrearEspacioDto) {
    return this.bd.tx().espacio.create({ data: dto });
  }

  /** Nunca DELETE: se desactiva. */
  editarEspacio(id: string, dto: EditarEspacioDto) {
    return this.bd.tx().espacio.update({ where: { id }, data: dto });
  }

  /** Espacio, inicio y fin de citas confirmadas y soft-locks activos (sin pacientes). */
  ocupacion(desde: Date, hasta: Date) {
    return this.bd.tx().$queryRaw<{ espacio_id: string; inicio: Date; fin: Date }[]>`
      SELECT espacio_id, inicio, fin FROM ocupacion_espacios(${desde}, ${hasta})`;
  }

  /** Huecos libres (descuenta citas, bloqueos, soft-locks y margen de traslado). Max. 62 dias. */
  huecos(profesionalId: string, desde: Date, hasta: Date): Promise<Hueco[]> {
    return this.bd.tx().$queryRaw<Hueco[]>`
      SELECT modalidad, inicio, fin FROM disponibilidad_publica(${profesionalId}::uuid, ${desde}, ${hasta})`;
  }

  async disponibilidad(profesionalId: string) {
    const filas = await this.bd.tx().disponibilidadProfesional.findMany({
      where: { profesionalId },
      orderBy: [{ diaSemana: 'asc' }, { inicioMin: 'asc' }],
    });
    return filas.map(vistaDisponibilidad);
  }

  /** Edita el propio y ADMIN/GESTION (RLS). */
  async crearDisponibilidad(profesionalId: string, dto: CrearDisponibilidadDto) {
    if (dto.inicioMin >= dto.finMin) {
      throw new BadRequestException('inicioMin debe ser menor que finMin');
    }
    return vistaDisponibilidad(await this.bd.tx().disponibilidadProfesional.create({ data: { profesionalId, ...dto } }));
  }

  async eliminarDisponibilidad(profesionalId: string, id: string) {
    const { count } = await this.bd.tx().disponibilidadProfesional.deleteMany({ where: { id, profesionalId } });
    return { eliminados: count };
  }

  /** El motivo solo lo ven el propio y ADMIN/GESTION; el resto ve huecos sin motivo. */
  bloqueos(profesionalId: string) {
    return this.bd.tx().bloqueoAgenda.findMany({ where: { profesionalId }, orderBy: { inicio: 'asc' } });
  }

  crearBloqueo(profesionalId: string, dto: CrearBloqueoAgendaDto) {
    return this.bd.tx().bloqueoAgenda.create({ data: { profesionalId, inicio: dto.inicio, fin: dto.fin, motivo: dto.motivo } });
  }

  /** El bloqueo BAJA no se toca (trigger -> 403). */
  async eliminarBloqueo(profesionalId: string, id: string) {
    const { count } = await this.bd.tx().bloqueoAgenda.deleteMany({ where: { id, profesionalId } });
    return { eliminados: count };
  }

  /**
   * Soft-lock con TTL (solo UX: evita que dos personas elijan el mismo hueco
   * en pantalla). Nunca reemplaza al EXCLUDE de citas. Retiene al profesional
   * siempre y el box solo si es presencial.
   */
  tomarHorario(dto: HorarioDto) {
    const ttl = this.config.getOrThrow<number>('BLOQUEO_TEMPORAL_TTL_SEGUNDOS');
    return this.bd.tx().bloqueoTemporal.create({
      data: {
        usuarioId: this.bd.usuario().id,
        profesionalId: dto.profesionalId,
        modalidad: dto.modalidad,
        espacioId: dto.modalidad === 'PRESENCIAL' ? dto.espacioId : null,
        inicio: dto.inicio,
        fin: dto.fin,
        expiraEn: new Date(Date.now() + ttl * 1000),
      },
    });
  }

  misHorariosTomados() {
    return this.bd.tx().bloqueoTemporal.findMany({ where: { expiraEn: { gt: new Date() } }, orderBy: { inicio: 'asc' } });
  }

  async soltarHorario(id: string) {
    const { count } = await this.bd.tx().bloqueoTemporal.deleteMany({ where: { id } });
    return { eliminados: count };
  }

  citasEnConflictoMargen(profesionalId: string) {
    return this.bd.tx().$queryRaw<{ cita_id: string; cita_conflicto_id: string; inicio: Date; separacion_min: number; margen_min: number }[]>`
      SELECT * FROM citas_en_conflicto_margen(${profesionalId}::uuid)`;
  }
}
