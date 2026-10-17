import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DisponibilidadProfesional, ModalidadAtencion } from '@prisma/client';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import type { BloqueAtencionVista, BloquesLiberados, HoraLibreBox } from './dto/agenda-respuestas.dto';
import type {
  BloqueAtencionDto,
  BloqueEspacioDto,
  CrearBloqueoAgendaDto,
  CrearDisponibilidadDto,
  CrearEspacioDto,
  EditarEspacioDto,
  HorarioDto,
} from './dto/agenda.dto';

const VISTA_BLOQUE = { id: true, profesionalId: true, espacioId: true, inicio: true, fin: true, creadoEn: true } as const;

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
 * Espacios (con su horario por periodo), bloques de box apartados por cada
 * profesional (03b: su agenda), disponibilidad semanal (horario habitual,
 * referencia para apartar), bloqueos de agenda, soft-locks y consultas de
 * ocupacion. La conversion de minutos locales a instantes la
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

  horarioEspacio(espacioId: string) {
    return this.bd.tx().horarioEspacio.findMany({ where: { espacioId }, orderBy: [{ diaSemana: 'asc' }, { inicioMin: 'asc' }] });
  }

  /**
   * Reemplaza el horario del box (03a; 03b: filas por periodo). Si deja
   * bloques ya apartados fuera del horario nuevo, 409 y no cambia nada (la
   * transaccion se revierte): primero se liberan o mueven esos bloques.
   */
  async reemplazarHorarioEspacio(espacioId: string, bloques: BloqueEspacioDto[]) {
    const tx = this.bd.tx();
    for (const b of bloques) {
      if (b.inicioMin >= b.finMin || (b.vigenteDesde && b.vigenteHasta && b.vigenteHasta < b.vigenteDesde)) {
        throw new BadRequestException('Cada fila: inicio antes del fin y periodo con desde antes de hasta');
      }
    }
    await tx.espacio.findUniqueOrThrow({ where: { id: espacioId }, select: { id: true } });
    await tx.horarioEspacio.deleteMany({ where: { espacioId } });
    await tx.horarioEspacio.createMany({ data: bloques.map((b) => ({ ...b, espacioId })) });
    const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT bloques_fuera_de_horario(${espacioId}::uuid) AS n`;
    if (n > 0) {
      throw new ConflictException({
        message: `El horario nuevo deja ${n} bloque(s) apartado(s) fuera: liberelos o muevalos primero`,
        restriccion: 'horarios_espacio_bloques_fuera',
      });
    }
    return this.horarioEspacio(espacioId);
  }

  /** Horas libres de cada box para apartar (horario vigente del box o del centro, menos bloques). Max. 62 dias. */
  disponibilidadEspacios(desde: Date, hasta: Date): Promise<HoraLibreBox[]> {
    return this.bd.tx().$queryRaw<HoraLibreBox[]>`
      SELECT espacio_id AS "espacioId", inicio, fin FROM disponibilidad_espacios(${desde}, ${hasta})`;
  }

  /** Bloques de box del profesional (el propio o ADMIN/GESTION: RLS) que tocan el rango. */
  bloques(profesionalId: string, desde: Date, hasta: Date): Promise<BloqueAtencionVista[]> {
    return this.bd.tx().bloqueAtencion.findMany({
      where: { profesionalId, inicio: { lt: hasta }, fin: { gt: desde } },
      select: VISTA_BLOQUE,
      orderBy: { inicio: 'asc' },
    });
  }

  /**
   * Aparta horas de box (todas o ninguna). El trigger valida rol, box activo
   * y horario del box/centro (422); el EXCLUDE, que el box o el profesional
   * no esten ya apartados a esa hora (409).
   */
  async apartarBloques(profesionalId: string, bloques: BloqueAtencionDto[]): Promise<BloqueAtencionVista[]> {
    if (bloques.some((b) => b.fin <= b.inicio)) {
      throw new BadRequestException('fin debe ser posterior a inicio');
    }
    const creadoPorId = this.bd.usuario().id;
    // createMany: una sola sentencia (el aviso a la lista de espera sale una vez).
    await this.bd.tx().bloqueAtencion.createMany({ data: bloques.map((b) => ({ ...b, profesionalId, creadoPorId })) });
    const desde = new Date(Math.min(...bloques.map((b) => b.inicio.getTime())));
    const hasta = new Date(Math.max(...bloques.map((b) => b.fin.getTime())));
    return this.bloques(profesionalId, desde, hasta);
  }

  /** Libera un bloque sin citas ni retenciones dentro (si las tiene, la BD responde 409). */
  async liberarBloque(profesionalId: string, id: string): Promise<BloquesLiberados> {
    const { count } = await this.bd.tx().bloqueAtencion.deleteMany({ where: { id, profesionalId } });
    return { eliminados: count };
  }

  /** Espacio, inicio y fin de bloques apartados y soft-locks activos (sin pacientes ni profesionales). */
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
        // Presencial: la BD le pone el box del bloque del profesional.
        espacioId: null,
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
