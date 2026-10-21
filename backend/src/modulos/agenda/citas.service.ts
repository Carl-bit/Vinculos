import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Cita, ModalidadAtencion, Prisma } from '@prisma/client';

import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { MENSAJE_POR_RESTRICCION } from '../../core/errores/sqlstate';
import { EVENTOS, type CitaCancelada, type CitaConfirmada, type NotificacionSolicitada } from '../../core/eventos/eventos';
import { AgendaService } from './agenda.service';
import type { CrearCitaDto, CubrirCitaDto, FiltroCitasDto, HorarioDto, LiberarHoraDto, ReprogramarCitaDto } from './dto/agenda.dto';
import { ProveedorVideollamada } from '../../core/integraciones/videollamada';

/** Sin enlace (cifrado) en las listas: se pide aparte en /citas/:id/enlace. */
const VISTA = {
  id: true,
  espacioId: true,
  modalidad: true,
  margenTrasladoMin: true,
  profesionalId: true,
  pacienteId: true,
  inicio: true,
  fin: true,
  estado: true,
  monto: true,
  canceladaEn: true,
  pagoVenceEn: true,
  medioConfirmacion: true,
  motivoLiberacion: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CitaSelect;

export interface Verificacion {
  disponible: boolean;
  /** PROFESIONAL_NO_DISPONIBLE (fuera de sus bloques de box, bloqueos, otra cita, margen). */
  motivos: string[];
  /** Huecos mas cercanos de la misma modalidad y duracion. */
  alternativas: { inicio: Date; fin: Date }[];
}

const DIA = 86_400_000;
const MAX_ALTERNATIVAS = 3;

/**
 * Citas: crear, cancelar y reprogramar (UPDATE de estado, nunca DELETE).
 * Fuente de verdad anti-choque = EXCLUDE de la BD (23P01 -> 409).
 *
 * 03b-3.2: la cita que agenda el equipo queda PENDIENTE_PAGO hasta 12 h antes
 * de la sesion (lo decide la BD: trigger citas_pago_previo_equipo) y se avisa
 * al paciente (PAGO_PENDIENTE; recordatorios 48 h / 24 h los manda el job).
 * Confirma directo si solo se paga en el centro, si no hay nada que cobrar o
 * si ya no queda plazo (pago en el centro).
 *
 * 03b-3.3: el plazo son las horas que configura el centro y, vencido sin pago,
 * la cita se mantiene con pago en el centro (el job). Un paciente con deuda no
 * agenda (trigger citas_paciente_moroso, 422) salvo que ADMIN/GESTION lo
 * autoricen con motivo en la misma transaccion.
 *
 * Opcion C (requisitos_02_apis.md 7): antes de confirmar se verifica con
 * disponibilidad_publica() (bloques de box del profesional menos citas,
 * bloqueos, soft-locks y margen de traslado); si la hora no esta libre se
 * responde 409 con alternativas sin intentar el INSERT. El box presencial lo
 * fija la BD (el del bloque, 03b): ya no se verifica aparte. Si dos
 * confirmaciones pasan la verificacion a la vez, la BD rechaza la segunda (409).
 */
@Injectable()
export class CitasService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly agenda: AgendaService,
    private readonly video: ProveedorVideollamada,
    private readonly eventos: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  async listar(filtro: FiltroCitasDto) {
    return this.bd.tx().cita.findMany({
      where: {
        profesionalId: filtro.profesionalId,
        pacienteId: filtro.pacienteId,
        estado: filtro.estado,
        inicio: filtro.hasta ? { lt: filtro.hasta } : undefined,
        fin: filtro.desde ? { gt: filtro.desde } : undefined,
      },
      select: VISTA,
      orderBy: { inicio: 'asc' },
    });
  }

  async obtener(id: string) {
    return encontrado(await this.bd.tx().cita.findUnique({ where: { id }, select: VISTA }), 'Cita');
  }

  /** Verificacion previa para la UI (no reserva nada; para retener, usar /agenda/horarios-tomados). */
  async verificar(dto: HorarioDto): Promise<Verificacion> {
    this.validarRango(dto.inicio, dto.fin);
    return this.verificarHorario(dto);
  }

  async crear(dto: CrearCitaDto) {
    this.validarRango(dto.inicio, dto.fin);
    const tx = this.bd.tx();
    await this.exigirAdultoSiEsMenor(dto.pacienteId);
    await this.soltarHorariosPropios(dto);
    await this.exigirDisponible(dto);
    if (dto.motivoAutorizacionDeuda) {
      await tx.$queryRaw`SELECT autorizar_cita_con_deuda(${dto.pacienteId}::uuid, ${dto.motivoAutorizacionDeuda})`;
    }
    const cita = await tx.cita.create({
      data: {
        pacienteId: dto.pacienteId,
        profesionalId: dto.profesionalId,
        modalidad: dto.modalidad,
        // Presencial: la BD le pone el box del bloque del profesional.
        espacioId: null,
        inicio: dto.inicio,
        fin: dto.fin,
        estado: 'CONFIRMADA',
      },
      select: VISTA,
    });
    const conEnlace = await this.generarEnlace(cita);
    if (cita.estado === 'PENDIENTE_PAGO') {
      const evento: NotificacionSolicitada = {
        actor: this.bd.usuario(),
        tipo: 'PAGO_PENDIENTE',
        destino: { pacienteId: dto.pacienteId },
        referenciaId: cita.id,
      };
      this.bd.alConfirmar(() => this.eventos.emitAsync(EVENTOS.NOTIFICACION_SOLICITADA, evento));
    } else {
      this.emitirConfirmada(EVENTOS.CITA_CONFIRMADA, cita, conEnlace);
    }
    return cita;
  }

  async cancelar(id: string) {
    const tx = this.bd.tx();
    const actual = await this.obtener(id);
    if (actual.estado === 'CANCELADA') {
      throw new ConflictException('La cita ya esta cancelada');
    }
    if (actual.estado === 'LIBERADA') {
      throw new ConflictException('La cita ya se libero por vencimiento del pago');
    }
    if (!actual.pacienteId) {
      throw new ConflictException('La hora esta retenida por una reserva en curso: se libera sola si no se paga a tiempo, o se libera con motivo');
    }
    const cita = await tx.cita.update({ where: { id }, data: { estado: 'CANCELADA', enlaceOnline: null }, select: VISTA });
    const actor = this.bd.usuario();
    const evento: CitaCancelada = { actor, citaId: id, pacienteId: actual.pacienteId, profesionalId: cita.profesionalId };
    this.bd.alConfirmar(() => this.eventos.emitAsync(EVENTOS.CITA_CANCELADA, evento));
    return cita;
  }

  /** 03b-3.3: liberar a mano la hora retenida (ADMIN/GESTION, con motivo; la reserva ya no se concreta). */
  async liberar(id: string, { motivo }: LiberarHoraDto) {
    await this.bd.tx().$executeRaw`SELECT liberar_hora_retenida(${id}::uuid, ${motivo})`;
    return this.obtener(id);
  }

  /**
   * Nuevo horario (o modalidad) para una cita CONFIRMADA o POR_REPROGRAMAR.
   * Primero se libera su horario actual (POR_REPROGRAMAR, en la misma
   * transaccion) para que la verificacion no choque consigo misma; si algo
   * falla, el rollback deja la cita como estaba.
   */
  async reprogramar(id: string, dto: ReprogramarCitaDto) {
    this.validarRango(dto.inicio, dto.fin);
    const tx = this.bd.tx();
    const actual = await this.obtener(id);
    if (actual.estado === 'CANCELADA') {
      throw new ConflictException('Una cita cancelada no se reprograma');
    }
    // 03b-3.1: la hora pendiente de pago (o retenida) se confirma o se libera; la liberada ya no existe.
    if (actual.estado === 'PENDIENTE_PAGO' || actual.estado === 'RETENIDA' || actual.estado === 'LIBERADA') {
      throw new ConflictException('La cita no esta confirmada (pago pendiente o vencido): no se reprograma');
    }
    const modalidad = dto.modalidad ?? actual.modalidad;
    const horario: HorarioDto = { profesionalId: actual.profesionalId, modalidad, inicio: dto.inicio, fin: dto.fin };
    await tx.cita.update({ where: { id }, data: { estado: 'POR_REPROGRAMAR' }, select: { id: true } });
    await this.soltarHorariosPropios(horario);
    await this.exigirDisponible(horario);
    const cita = await tx.cita.update({
      where: { id },
      data: { estado: 'CONFIRMADA', modalidad, espacioId: null, inicio: dto.inicio, fin: dto.fin, enlaceOnline: null },
      select: VISTA,
    });
    const conEnlace = await this.generarEnlace(cita);
    this.emitirConfirmada(EVENTOS.CITA_REPROGRAMADA, cita, conEnlace);
    return cita;
  }

  /**
   * "Cubrir sesion" (C-5): la cita pasa a otro profesional solo si tiene
   * acceso clinico temporal vigente en ese horario (si no, 422 de la BD:
   * citas_profesional_con_acceso). Para cambiar de tratante: derivacion.
   */
  async cubrir(id: string, { profesionalId, otorgarAccesoHasta }: CubrirCitaDto) {
    if (otorgarAccesoHasta && this.bd.usuario().rol !== 'ADMIN') {
      throw new ForbiddenException('Solo administracion otorga accesos clinicos temporales');
    }
    const actual = await this.obtener(id);
    if (actual.estado !== 'CONFIRMADA') {
      throw new ConflictException('Solo se cubre una cita confirmada');
    }
    // Misma transaccion del RlsInterceptor: si mover la cita falla, el acceso no queda otorgado.
    if (otorgarAccesoHasta) {
      await this.bd.tx().$queryRaw`
        SELECT otorgar_acceso_temporal(${actual.pacienteId}::uuid, ${profesionalId}::uuid, 'REEMPLAZO'::motivo_acceso_temporal,
                                       'LECTURA_ESCRITURA'::alcance_acceso_temporal, NULL, ${otorgarAccesoHasta})`;
    }
    const cita = await this.bd.tx().cita.update({ where: { id }, data: { profesionalId, enlaceOnline: null }, select: VISTA });
    const conEnlace = await this.generarEnlace(cita);
    this.emitirConfirmada(EVENTOS.CITA_REPROGRAMADA, cita, conEnlace);
    return cita;
  }

  /** "Requerir cierre" (ADMIN): avisa al profesional que la sesion sigue sin evolucion registrada. */
  async requerirCierre(id: string) {
    const cita = await this.obtener(id);
    const evento: NotificacionSolicitada = {
      actor: this.bd.usuario(),
      tipo: 'CIERRE_REQUERIDO',
      destino: { usuarioId: cita.profesionalId },
      referenciaId: id,
    };
    this.bd.alConfirmar(() => this.eventos.emitAsync(EVENTOS.NOTIFICACION_SOLICITADA, evento));
    return { citaId: id, avisado: true };
  }

  /** POR_REPROGRAMAR: tratante saliente, revocacion o baja (lista para reprogramar y avisar). */
  porReprogramar() {
    return this.bd.tx().cita.findMany({ where: { estado: 'POR_REPROGRAMAR' }, select: VISTA, orderBy: { inicio: 'asc' } });
  }

  /** Enlace de videollamada: el paciente de la cita, su profesional y ADMIN/GESTION (RLS). Vencido -> 410. */
  async enlace(id: string) {
    const cita = encontrado(await this.bd.tx().cita.findUnique({ where: { id }, select: { id: true, modalidad: true, enlaceOnline: true } }), 'Cita');
    const guardado = texto(cita.enlaceOnline);
    if (cita.modalidad !== 'ONLINE' || !guardado) {
      throw new NotFoundException('La cita no tiene enlace de videollamada');
    }
    const enlace = JSON.parse(guardado) as { url: string; expiraEn: string };
    if (new Date(enlace.expiraEn) <= new Date()) {
      throw new GoneException('El enlace de videollamada vencio');
    }
    return enlace;
  }

  private validarRango(inicio: Date, fin: Date) {
    if (fin <= inicio) {
      throw new BadRequestException('fin debe ser posterior a inicio');
    }
    if (fin.getTime() - inicio.getTime() > DIA) {
      throw new BadRequestException('Una cita dura como maximo 24 horas');
    }
  }

  /**
   * Menor de edad sin adulto responsable: se rechaza antes del INSERT (la BD
   * lo impide igual con citas_menor_requiere_adulto_responsable). La edad la
   * calcula la BD en hora de Chile, igual que el trigger.
   */
  private async exigirAdultoSiEsMenor(pacienteId: string) {
    const [fila] = await this.bd.tx().$queryRaw<{ falta: boolean }[]>`
      SELECT age((now() AT TIME ZONE 'America/Santiago')::date, p.fecha_nacimiento) < interval '18 years'
             AND NOT EXISTS (SELECT 1 FROM adultos_responsables a WHERE a.paciente_id = p.id) AS falta
      FROM pacientes p WHERE p.id = ${pacienteId}::uuid AND p.deleted_at IS NULL`;
    if (!fila) {
      throw new NotFoundException('Paciente no encontrado');
    }
    if (fila.falta) {
      throw new UnprocessableEntityException({
        message: MENSAJE_POR_RESTRICCION.citas_menor_requiere_adulto_responsable,
        restriccion: 'citas_menor_requiere_adulto_responsable',
      });
    }
  }

  /** Confirmar consume los soft-locks propios sobre ese profesional y horario. */
  private async soltarHorariosPropios(h: HorarioDto) {
    await this.bd.tx().bloqueoTemporal.deleteMany({
      where: { profesionalId: h.profesionalId, inicio: { lt: h.fin }, fin: { gt: h.inicio } },
    });
  }

  private async exigirDisponible(h: HorarioDto) {
    const v = await this.verificarHorario(h);
    if (!v.disponible) {
      throw new ConflictException({
        message: 'El horario no esta disponible',
        restriccion: 'agenda_no_disponible',
        motivos: v.motivos,
        alternativas: v.alternativas,
      });
    }
  }

  private async verificarHorario(h: HorarioDto): Promise<Verificacion> {
    const duracion = h.fin.getTime() - h.inicio.getTime();
    const ahora = Date.now();
    const desde = new Date(Math.max(ahora, h.inicio.getTime() - 7 * DIA));
    const hasta = new Date(Math.max(desde.getTime() + DIA, h.fin.getTime() + 7 * DIA));
    const huecos = (await this.agenda.huecos(h.profesionalId, desde, hasta)).filter((x) => x.modalidad === h.modalidad);
    if (huecos.some((x) => x.inicio <= h.inicio && x.fin >= h.fin)) {
      return { disponible: true, motivos: [], alternativas: [] };
    }
    const motivos = ['PROFESIONAL_NO_DISPONIBLE'];

    const candidatas: { inicio: number; fin: number }[] = [];
    for (const x of huecos) {
      const primero = Math.max(x.inicio.getTime(), ahora);
      const ultimo = x.fin.getTime() - duracion;
      // El inicio mas cercano al pedido dentro del hueco, en pasos de 15 minutos.
      const paso = 15 * 60_000;
      for (let t = primero; t <= ultimo && candidatas.length < 200; t += paso) {
        candidatas.push({ inicio: t, fin: t + duracion });
      }
    }
    const pedido = h.inicio.getTime();
    const alternativas = candidatas
      .sort((a, b) => Math.abs(a.inicio - pedido) - Math.abs(b.inicio - pedido))
      .slice(0, MAX_ALTERNATIVAS)
      .sort((a, b) => a.inicio - b.inicio)
      .map((c) => ({ inicio: new Date(c.inicio), fin: new Date(c.fin) }));
    return { disponible: false, motivos, alternativas };
  }

  /**
   * ONLINE: enlace cifrado (CLINICO) con expiracion, generado con la cita ya
   * creada (id = AAD), segun el modo de videollamada del profesional
   * (salas_videollamada; sin fila = ENLACE_PROPIO sin enlace).
   */
  private async generarEnlace(cita: Pick<Cita, 'id' | 'modalidad' | 'inicio' | 'fin' | 'profesionalId'>): Promise<boolean> {
    if (cita.modalidad !== 'ONLINE') {
      return false;
    }
    const horas = this.config.getOrThrow<number>('ENLACE_ONLINE_HORAS_TRAS_FIN');
    const config = await this.bd.tx().salaVideollamada.findUnique({ where: { usuarioId: cita.profesionalId } });
    const sala = await this.video.crearSala({
      citaId: cita.id,
      inicio: cita.inicio,
      fin: cita.fin,
      expiraEn: new Date(cita.fin.getTime() + horas * 3_600_000),
      modo: config?.modo ?? 'ENLACE_PROPIO',
      enlacePropio: texto(config?.enlace),
    });
    await this.bd.tx().cita.update({
      where: { id: cita.id },
      data: { enlaceOnline: claro(JSON.stringify({ url: sala.url, expiraEn: sala.expiraEn.toISOString() })) },
      select: { id: true },
    });
    return true;
  }

  private emitirConfirmada(
    nombre: string,
    cita: { id: string; pacienteId: string | null; profesionalId: string; modalidad: ModalidadAtencion; inicio: Date; fin: Date },
    conEnlace: boolean,
  ) {
    // Solo la hora retenida (reserva sin cuenta) no tiene paciente, y esa no pasa por aqui.
    if (!cita.pacienteId) {
      return;
    }
    const evento: CitaConfirmada = {
      actor: this.bd.usuario(),
      citaId: cita.id,
      pacienteId: cita.pacienteId,
      profesionalId: cita.profesionalId,
      modalidad: cita.modalidad,
      inicio: cita.inicio,
      fin: cita.fin,
      conEnlace,
    };
    this.bd.alConfirmar(() => this.eventos.emitAsync(nombre, evento));
  }
}
