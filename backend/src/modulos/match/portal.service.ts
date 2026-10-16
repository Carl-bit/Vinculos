import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { HORA, nuevoTokenCorreo } from '../../core/auth/tokens-correo';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { EVENTOS, type NotificacionSolicitada } from '../../core/eventos/eventos';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';
import type { MisDatosDto } from './dto/match.dto';

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
  ) {}

  equipo() {
    return this.bd.tx().$queryRaw<{ id: string; nombre: string | null }[]>`SELECT id, nombre FROM mi_equipo_tratante()`;
  }

  /** Futuras por defecto; con todas, tambien el historial (solo datos administrativos). */
  async citas(pacienteId?: string, todas = false) {
    const filas = await this.bd.tx().cita.findMany({
      where: {
        pacienteId,
        ...(todas ? {} : { estado: { in: ['CONFIRMADA', 'POR_REPROGRAMAR', 'SOLICITADA'] }, fin: { gt: new Date() } }),
      },
      select: { id: true, pacienteId: true, profesionalId: true, modalidad: true, espacioId: true, inicio: true, fin: true, estado: true },
      orderBy: { inicio: todas ? 'desc' : 'asc' },
    });
    const ahora = new Date();
    return filas.map((c) => ({ ...c, realizada: c.estado === 'CONFIRMADA' && c.fin <= ahora }));
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
      select: { id: true, nombre: true, apellido: true, fechaNacimiento: true, email: true, telefono: true },
    });
    const adultos = await tx.adultoResponsable.findMany({
      where: { pacienteId },
      select: { id: true, nombre: true, parentesco: true, telefono: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    return { ...p, telefono: texto(p.telefono), adultosResponsables: adultos.map((a) => ({ ...a, telefono: texto(a.telefono) })) };
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
