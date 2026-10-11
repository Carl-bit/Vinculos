import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { claro, texto } from '../../core/bd/claro';
import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { EVENTOS, type NotificacionSolicitada } from '../../core/eventos/eventos';

/**
 * Portal del paciente: su equipo tratante, sus citas, datos de pago (cobro
 * directo), mensajes al profesional (asimetricos: el profesional responde
 * por canales externos) y solicitudes de epicrisis. Consentimientos y avisos
 * estan en /consentimientos y /avisos-consentimiento (la RLS ya filtra).
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly eventos: EventEmitter2,
  ) {}

  equipo() {
    return this.bd.tx().$queryRaw<{ id: string; nombre: string | null }[]>`SELECT id, nombre FROM mi_equipo_tratante()`;
  }

  citas() {
    return this.bd.tx().cita.findMany({
      where: { estado: { in: ['CONFIRMADA', 'POR_REPROGRAMAR'] }, fin: { gt: new Date() } },
      select: { id: true, profesionalId: true, modalidad: true, espacioId: true, inicio: true, fin: true, estado: true },
      orderBy: { inicio: 'asc' },
    });
  }

  /**
   * Datos de transferencia del profesional de SU cita, solo con cobro directo
   * y cita CONFIRMADA con saldo > 0 ("pago pendiente" de Cobros, 02h).
   * 0 filas = no corresponde: { aplica: false }.
   */
  async datosPago(citaId: string) {
    const [f] = await this.bd.tx().$queryRaw<
      { profesional_id: string; rut: Uint8Array | null; banco: Uint8Array | null; tipo_cuenta: Uint8Array | null; numero_cuenta: Uint8Array | null; titular: Uint8Array | null }[]
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
  async enviarMensaje(profesionalId: string, contenido: string) {
    const actor = this.bd.usuario();
    const pacienteId = await this.miPacienteId();
    const m = await this.bd.tx().mensajePaciente.create({ data: { id: randomUUID(), pacienteId, profesionalId, contenido: claro(contenido) } });
    const evento: NotificacionSolicitada = { actor, tipo: 'MENSAJE_PACIENTE', destino: { usuarioId: profesionalId }, referenciaId: m.id };
    this.bd.alConfirmar(() => this.eventos.emitAsync(EVENTOS.NOTIFICACION_SOLICITADA, evento));
    return { id: m.id, profesionalId: m.profesionalId, contenido: texto(m.contenido), creadoEn: m.creadoEn };
  }

  /** PACIENTE: los que envio. PROFESIONAL/PRACTICANTE: los que recibio (RLS). */
  async mensajes() {
    const filas = await this.bd.tx().mensajePaciente.findMany({ orderBy: { creadoEn: 'desc' }, take: 200 });
    return filas.map((m) => ({ ...m, contenido: texto(m.contenido) }));
  }

  async marcarLeido(id: string) {
    await this.bd.tx().$executeRaw`SELECT marcar_mensaje_leido(${id}::uuid)`;
    return { id, leido: true };
  }

  async solicitarEpicrisis(motivo?: string) {
    const pacienteId = await this.miPacienteId();
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

  private async miPacienteId(): Promise<string> {
    const u = await this.bd.tx().usuario.findUniqueOrThrow({ where: { id: this.bd.usuario().id }, select: { pacienteId: true } });
    return u.pacienteId!;
  }
}
