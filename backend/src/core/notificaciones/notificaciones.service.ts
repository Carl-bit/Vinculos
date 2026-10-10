import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import type { TipoNotificacion } from '@prisma/client';

import { ContextoBd } from '../bd/contexto-bd.service';
import { LlaveroService } from '../crypto/llavero.service';
import { EVENTOS, type CitaCancelada, type CitaConfirmada, type CitaReprogramada, type NotificacionSolicitada } from '../eventos/eventos';
import { JobsService, type ResultadoJob } from '../jobs/jobs.service';
import { ProveedorCorreo } from './correo';

const ASUNTOS: Record<TipoNotificacion, string> = {
  CITA_CONFIRMADA: 'Cita confirmada',
  CITA_CANCELADA: 'Cita cancelada',
  CITA_REPROGRAMADA: 'Cita reprogramada',
  ENLACE_ONLINE: 'Enlace de su sesion online',
  CONSENTIMIENTO_SOLICITADO: 'Solicitud de consentimiento',
  AVISO_CAMBIO_SUPERVISOR: 'Aviso: cambio de supervisor',
  DERIVACION_OFRECIDA: 'Nueva oferta de derivacion',
  MENSAJE_PACIENTE: 'Nuevo mensaje de un paciente',
};

/**
 * Notificaciones (02f). Escucha los eventos de dominio (despues del COMMIT)
 * y registra cada aviso en `notificaciones` (PENDIENTE) con el contexto del
 * actor. El job de envio (sin contexto, con advisory lock) toma las
 * pendientes, envia por la interfaz de correo y las cierra. Nunca loguea
 * emails ni enlaces.
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger('Notificaciones');

  constructor(
    private readonly bd: ContextoBd,
    private readonly jobs: JobsService,
    private readonly llavero: LlaveroService,
    private readonly correo: ProveedorCorreo,
  ) {}

  @OnEvent(EVENTOS.CITA_CONFIRMADA)
  citaConfirmada(e: CitaConfirmada) {
    return this.avisarCita('CITA_CONFIRMADA', e);
  }

  @OnEvent(EVENTOS.CITA_REPROGRAMADA)
  citaReprogramada(e: CitaReprogramada) {
    return this.avisarCita('CITA_REPROGRAMADA', e);
  }

  private async avisarCita(tipo: TipoNotificacion, e: CitaConfirmada) {
    await this.registrar(e.actor, [
      { tipo, pacienteId: e.pacienteId, referenciaId: e.citaId },
      ...(e.conEnlace ? [{ tipo: 'ENLACE_ONLINE' as const, pacienteId: e.pacienteId, referenciaId: e.citaId }] : []),
    ]);
  }

  @OnEvent(EVENTOS.CITA_CANCELADA)
  async citaCancelada(e: CitaCancelada) {
    await this.registrar(e.actor, [{ tipo: 'CITA_CANCELADA', pacienteId: e.pacienteId, referenciaId: e.citaId }]);
  }

  @OnEvent(EVENTOS.NOTIFICACION_SOLICITADA)
  async solicitada(e: NotificacionSolicitada) {
    await this.registrar(e.actor, [{ tipo: e.tipo, referenciaId: e.referenciaId, ...e.destino }]);
  }

  private async registrar(
    actor: NotificacionSolicitada['actor'],
    filas: { tipo: TipoNotificacion; referenciaId: string; pacienteId?: string; usuarioId?: string }[],
  ) {
    // createMany: el actor no siempre puede leer la fila que inserta (RETURNING).
    await this.bd.enTransaccion(actor, () =>
      this.bd.tx().notificacion.createMany({ data: filas.map((f) => ({ ...f, creadaPorId: actor.id })) }),
    );
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'enviar_notificaciones' })
  enviarPendientes(): Promise<ResultadoJob> {
    return this.jobs.conLock('enviar_notificaciones', async (tx) => {
      const pendientes = await tx.$queryRaw<{ id: string; tipo: TipoNotificacion; referencia_id: string; email: string | null; enlace: Uint8Array | null }[]>`
        SELECT id, tipo, referencia_id, email, enlace FROM notificaciones_por_enviar(50)`;
      let enviadas = 0;
      for (const n of pendientes) {
        let error: string | null = null;
        if (!n.email) {
          error = 'destinatario sin email';
        } else {
          try {
            await this.correo.enviar({ para: n.email, asunto: ASUNTOS[n.tipo], texto: this.texto(n) });
          } catch {
            error = 'fallo el envio';
          }
        }
        await tx.$executeRaw`SELECT marcar_notificacion(${n.id}::uuid, ${error === null}, ${error})`;
        enviadas += error === null ? 1 : 0;
      }
      if (pendientes.length > enviadas) {
        this.logger.warn(`enviar_notificaciones: ${pendientes.length - enviadas} fallida(s)`);
      }
      return enviadas;
    });
  }

  private texto(n: { tipo: TipoNotificacion; referencia_id: string; enlace: Uint8Array | null }): string {
    if (n.tipo === 'ENLACE_ONLINE' && n.enlace) {
      const { url } = JSON.parse(this.llavero.descifrarCampo(n.enlace, 'citas', 'enlace_online', n.referencia_id)!) as { url: string };
      return `Enlace de su sesion online: ${url}\nNo comparta este enlace.`;
    }
    return `${ASUNTOS[n.tipo]}. Revise el detalle en el portal del centro.`;
  }
}
