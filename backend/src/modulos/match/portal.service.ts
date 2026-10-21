import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { EstadoCita, ModoVideollamada } from '@prisma/client';

import { HORA, nuevoTokenCorreo } from '../../core/auth/tokens-correo';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { EVENTOS, type NotificacionSolicitada } from '../../core/eventos/eventos';
import { ProveedorVideollamada } from '../../core/integraciones/videollamada';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';
import type { MisDatosDto, ReservaPortalDto } from './dto/match.dto';
import type { ReservaPortal } from './dto/portal-respuestas.dto';

/**
 * Portal del paciente: su equipo tratante, sus citas, datos de pago (cobro
 * directo), mensajes al profesional (asimetricos: el profesional responde
 * por canales externos) y solicitudes de epicrisis. Consentimientos y avisos
 * estan en /consentimientos y /avisos-consentimiento (la RLS ya filtra).
 *
 * 03a (D-4): el adulto responsable (RESPONSABLE) opera por sus menores
 * indicando pacienteId; el adolescente (14-17) tiene cuenta restringida: sus
 * citas, recordatorios y mensajes (la RLS le oculta pagos, documentos y
 * epicrisis). C-9: el paciente edita solo su telefono y su correo.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly eventos: EventEmitter2,
    private readonly correos: CorreosCuenta,
    private readonly video: ProveedorVideollamada,
    private readonly config: ConfigService,
  ) {}

  equipo() {
    return this.bd.tx().$queryRaw<{ id: string; nombre: string | null }[]>`SELECT id, nombre FROM mi_equipo_tratante()`;
  }

  /** 03b-3: quien supervisa a los practicantes de sus consentimientos y avisos (solo nombres). */
  supervisores() {
    return this.bd.tx().$queryRaw<{ id: string; nombre: string | null }[]>`SELECT id, nombre FROM supervisores_portal()`;
  }

  /** Futuras por defecto; con todas, tambien el historial (solo datos administrativos). */
  async citas(pacienteId?: string, todas = false) {
    const filas = await this.bd.tx().cita.findMany({
      where: {
        pacienteId,
        ...(todas ? {} : { estado: { in: ['CONFIRMADA', 'POR_REPROGRAMAR', 'PENDIENTE_PAGO'] }, fin: { gt: new Date() } }),
      },
      select: {
        id: true,
        pacienteId: true,
        profesionalId: true,
        modalidad: true,
        espacioId: true,
        espacio: { select: { nombre: true } },
        inicio: true,
        fin: true,
        estado: true,
        medioConfirmacion: true,
        pagoVenceEn: true,
        agendadaPorEquipo: true,
      },
      orderBy: { inicio: todas ? 'desc' : 'asc' },
    });
    const ahora = new Date();
    // 03b-3: el nombre del box (catalogo, no un dato de otro usuario) para "Presencial, Box 2".
    // La RLS solo deja ver citas de sus pacientes: nunca una hora retenida sin paciente.
    return filas.map(({ espacio, ...c }) => ({
      ...c,
      pacienteId: c.pacienteId!,
      espacioNombre: espacio?.nombre ?? null,
      realizada: c.estado === 'CONFIRMADA' && c.fin <= ahora,
    }));
  }

  /**
   * Datos de transferencia del profesional de SU cita, solo con cobro directo
   * y cita CONFIRMADA con saldo > 0 ("pago pendiente" de Cobros, 02h).
   * 0 filas = no corresponde: { aplica: false }.
   */
  async datosPago(citaId: string) {
    const [f] = await this.bd.tx().$queryRaw<
      {
        profesional_id: string;
        rut: Uint8Array | null;
        banco: Uint8Array | null;
        tipo_cuenta: Uint8Array | null;
        numero_cuenta: Uint8Array | null;
        titular: Uint8Array | null;
      }[]
    >`SELECT * FROM datos_pago_profesional(${citaId}::uuid)`;
    if (!f) {
      return { aplica: false as const };
    }
    const d = (col: 'rut' | 'banco' | 'tipo_cuenta' | 'numero_cuenta' | 'titular') =>
      this.llavero.descifrarCampo(f[col], 'profesional_datos_privados', col, f.profesional_id);
    return {
      aplica: true as const,
      profesionalId: f.profesional_id,
      rut: d('rut'),
      banco: d('banco'),
      tipoCuenta: d('tipo_cuenta'),
      numeroCuenta: d('numero_cuenta'),
      titular: d('titular'),
    };
  }

  /** Horas libres del tratante (disponibilidad_publica con el contexto del paciente: sirve aunque no tenga perfil publico). */
  async disponibilidad(pacienteDelPortal: string | undefined, desde: Date, hasta: Date) {
    const pacienteId = await this.pacienteDelPortal(pacienteDelPortal);
    const tx = this.bd.tx();
    const p = await tx.paciente.findUniqueOrThrow({ where: { id: pacienteId }, select: { profesionalId: true } });
    if (!p.profesionalId) {
      return [];
    }
    return tx.$queryRaw<{ modalidad: 'PRESENCIAL' | 'ONLINE'; inicio: Date; fin: Date }[]>`
      SELECT modalidad, inicio, fin FROM disponibilidad_publica(${p.profesionalId}::uuid, ${desde}, ${hasta})`;
  }

  /**
   * Antes de 03b-4: hora con su tratante desde la cuenta (reservar_cita_portal
   * valida todo: tratante actual, disponibilidad de los bloques, politica
   * vigente, menor y cuenta restringida; el EXCLUDE manda). Online: enlace de
   * videollamada en la misma transaccion, como una cita agendada por el equipo.
   */
  async reservar(dto: ReservaPortalDto): Promise<ReservaPortal> {
    const pacienteId = await this.pacienteDelPortal(dto.pacienteId);
    const tx = this.bd.tx();
    const [r] = await tx.$queryRaw<
      { cita_id: string; estado: EstadoCita; profesional_id: string; sala_modo: ModoVideollamada | null; sala_enlace: Uint8Array | null }[]
    >`SELECT * FROM reservar_cita_portal(${pacienteId}::uuid, ${dto.modalidad}::modalidad_atencion, ${dto.inicio}::timestamptz,
                                          ${dto.fin}::timestamptz, ${dto.politicaId}::uuid, ${dto.terminosId}::uuid)`;
    if (dto.modalidad === 'ONLINE') {
      const sala = await this.video.crearSala({
        citaId: r.cita_id,
        inicio: dto.inicio,
        fin: dto.fin,
        expiraEn: new Date(dto.fin.getTime() + this.config.getOrThrow<number>('ENLACE_ONLINE_HORAS_TRAS_FIN') * HORA),
        modo: r.sala_modo ?? 'ENLACE_PROPIO',
        enlacePropio: this.llavero.descifrarCampo(r.sala_enlace, 'salas_videollamada', 'enlace', r.profesional_id),
      });
      const enlace = JSON.stringify({ url: sala.url, expiraEn: sala.expiraEn.toISOString() });
      await tx.$executeRaw`SELECT guardar_enlace_portal(${r.cita_id}::uuid, ${this.llavero.cifrarCampo(enlace, 'citas', 'enlace_online', r.cita_id)})`;
    }
    return { citaId: r.cita_id, estado: r.estado, profesionalId: r.profesional_id };
  }

  /** Solo a su equipo tratante (RLS). Se avisa al profesional por correo, sin el contenido. */
  async enviarMensaje(profesionalId: string, contenido: string, pacienteDelPortal?: string) {
    const actor = this.bd.usuario();
    const pacienteId = await this.pacienteDelPortal(pacienteDelPortal);
    const m = await this.bd
      .tx()
      .mensajePaciente.create({ data: { id: randomUUID(), pacienteId, profesionalId, autorId: actor.id, contenido: claro(contenido) } });
    const evento: NotificacionSolicitada = { actor, tipo: 'MENSAJE_PACIENTE', destino: { usuarioId: profesionalId }, referenciaId: m.id };
    this.bd.alConfirmar(() => this.eventos.emitAsync(EVENTOS.NOTIFICACION_SOLICITADA, evento));
    return { id: m.id, profesionalId: m.profesionalId, contenido: texto(m.contenido), creadoEn: m.creadoEn };
  }

  /** PACIENTE: los de su registro. RESPONSABLE: los que el escribio. PROFESIONAL/PRACTICANTE: los recibidos (RLS). */
  async mensajes() {
    const filas = await this.bd.tx().mensajePaciente.findMany({ orderBy: { creadoEn: 'desc' }, take: 200 });
    return filas.map((m) => ({ ...m, contenido: texto(m.contenido) }));
  }

  async marcarLeido(id: string) {
    await this.bd.tx().$executeRaw`SELECT marcar_mensaje_leido(${id}::uuid)`;
    return { id, leido: true };
  }

  async solicitarEpicrisis(motivo?: string, pacienteDelPortal?: string) {
    const pacienteId = await this.pacienteDelPortal(pacienteDelPortal);
    const s = await this.bd.tx().solicitudEpicrisis.create({ data: { id: randomUUID(), pacienteId, motivo: claro(motivo) } });
    return { ...s, motivo: texto(s.motivo) };
  }

  async epicrisis() {
    const filas = await this.bd.tx().solicitudEpicrisis.findMany({ orderBy: { solicitadaEn: 'desc' } });
    return filas.map((s) => ({ ...s, motivo: texto(s.motivo) }));
  }

  async resolverEpicrisis(id: string, estado: 'EN_PROCESO' | 'ENTREGADA' | 'RECHAZADA', documentoRef?: string) {
    await this.bd.tx().$executeRaw`
      SELECT resolver_solicitud_epicrisis(${id}::uuid, ${estado}::estado_epicrisis, ${documentoRef ?? null})`;
    const s = await this.bd.tx().solicitudEpicrisis.findUniqueOrThrow({ where: { id } });
    return { ...s, motivo: texto(s.motivo) };
  }

  /** Pacientes visibles en el portal: el propio, o los menores a cargo del adulto responsable (RLS). */
  async misPacientes() {
    const filas = await this.bd.tx().paciente.findMany({
      select: { id: true, nombre: true, apellido: true, fechaNacimiento: true, email: true, telefono: true, profesionalId: true },
      orderBy: { nombre: 'asc' },
    });
    return filas.map((p) => ({ ...p, telefono: texto(p.telefono) }));
  }

  /** Datos del paciente (y sus adultos responsables) para "Mis datos". */
  async misDatos(pacienteDelPortal?: string) {
    const pacienteId = await this.pacienteDelPortal(pacienteDelPortal);
    const tx = this.bd.tx();
    const p = await tx.paciente.findUniqueOrThrow({
      where: { id: pacienteId },
      select: { id: true, nombre: true, apellido: true, fechaNacimiento: true, email: true, telefono: true, contactoEmergencia: true },
    });
    const adultos = await tx.adultoResponsable.findMany({
      where: { pacienteId },
      select: { id: true, nombre: true, parentesco: true, telefono: true, email: true, usuarioId: true },
      orderBy: { createdAt: 'asc' },
    });
    const yo = this.bd.usuario().id;
    return {
      ...p,
      telefono: texto(p.telefono),
      // 03b-3: lo registra el centro; el portal solo lo muestra (C-9).
      contactoEmergencia: texto(p.contactoEmergencia),
      // esMiCuenta: el adulto responsable responde consentimientos con su propio registro (validar_otorgante).
      adultosResponsables: adultos.map(({ usuarioId, ...a }) => ({ ...a, telefono: texto(a.telefono), esMiCuenta: usuarioId === yo })),
    };
  }

  /**
   * C-9: telefono (cifrado con el id del paciente) y correo; el correo nuevo
   * queda pendiente hasta confirmarlo con el enlace que se le envia.
   */
  async actualizarMisDatos(dto: MisDatosDto) {
    const actor = this.bd.usuario();
    if (dto.telefono !== undefined) {
      if (actor.rol !== 'PACIENTE') {
        throw new BadRequestException('El adulto responsable no edita el telefono del paciente: pidalo al centro');
      }
      const pacienteId = await this.pacienteDelPortal();
      await this.bd.tx().$executeRaw`
        SELECT actualizar_telefono_paciente(${this.llavero.cifrarCampo(dto.telefono, 'pacientes', 'telefono', pacienteId)})`;
    }
    let verificacion: Date | null = null;
    if (dto.email !== undefined) {
      const { token, hash } = nuevoTokenCorreo();
      verificacion = new Date(Date.now() + 24 * HORA);
      await this.bd.tx().$executeRaw`SELECT crear_token_cambio_correo(${dto.email}, ${hash}, ${verificacion})`;
      const email = dto.email;
      const vence = verificacion;
      this.bd.alConfirmar(() => this.correos.enviar('VERIFICACION_CORREO', email, token, vence));
    }
    return { telefonoActualizado: dto.telefono !== undefined, correoPendienteHasta: verificacion };
  }

  /**
   * 03b-3: version vigente del consentimiento informado de atencion y la
   * ultima que acepto el paciente (RLS: adulto o adulto responsable; el
   * adolescente no ve aceptaciones y recibe aceptada = null).
   */
  async estadoConsentimientoAtencion(pacienteDelPortal?: string) {
    const pacienteId = await this.pacienteDelPortal(pacienteDelPortal);
    const tx = this.bd.tx();
    const [vigente] = await tx.$queryRaw<{ id: string; version: number; texto: string; vigente_desde: Date }[]>`
      SELECT * FROM politica_vigente('CONSENTIMIENTO_ATENCION'::tipo_politica)`;
    const ultima = await tx.aceptacionPolitica.findFirst({
      where: { pacienteId, politica: { tipo: 'CONSENTIMIENTO_ATENCION' } },
      orderBy: { aceptadaEn: 'desc' },
      select: { aceptadaEn: true, canal: true, politica: { select: { version: true } } },
    });
    return {
      pacienteId,
      vigente: vigente ? { id: vigente.id, version: vigente.version, texto: vigente.texto, vigenteDesde: vigente.vigente_desde } : null,
      aceptada: ultima ? { version: ultima.politica.version, aceptadaEn: ultima.aceptadaEn, canal: ultima.canal } : null,
    };
  }

  /** Consentimiento informado de atencion aceptado en el portal (D-3): el paciente adulto o el adulto responsable. */
  async aceptarConsentimientoAtencion(pacienteDelPortal?: string) {
    const actor = this.bd.usuario();
    const pacienteId = await this.pacienteDelPortal(pacienteDelPortal);
    const adulto =
      actor.rol === 'RESPONSABLE'
        ? (await this.bd.tx().adultoResponsable.findFirst({ where: { pacienteId, usuarioId: actor.id }, select: { id: true } }))?.id
        : undefined;
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`
      SELECT registrar_aceptacion('CONSENTIMIENTO_ATENCION', ${pacienteId}::uuid, ${adulto ?? null}::uuid, NULL) AS id`;
    return { id, pacienteId };
  }

  /**
   * Paciente sobre el que actua la cuenta: el propio (PACIENTE) o un menor a
   * cargo del adulto responsable (RESPONSABLE, obligatorio indicarlo).
   */
  async pacienteDelPortal(pacienteId?: string): Promise<string> {
    const actor = this.bd.usuario();
    if (actor.rol === 'RESPONSABLE') {
      if (!pacienteId) {
        throw new BadRequestException('Indique pacienteId (menor a su cargo)');
      }
      const a = await this.bd.tx().adultoResponsable.findFirst({ where: { pacienteId, usuarioId: actor.id }, select: { id: true } });
      if (!a) {
        throw new NotFoundException('Paciente no encontrado');
      }
      return pacienteId;
    }
    const u = await this.bd.tx().usuario.findUniqueOrThrow({ where: { id: actor.id }, select: { pacienteId: true } });
    return u.pacienteId!;
  }
}
