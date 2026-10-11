import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import type { EstadoCita, ModalidadAtencion, TipoNotificacion } from '@prisma/client';

import { ContextoBd } from '../bd/contexto-bd.service';
import { LlaveroService } from '../crypto/llavero.service';
import { EVENTOS, type CitaCancelada, type CitaConfirmada, type CitaReprogramada, type NotificacionSolicitada } from '../eventos/eventos';
import { eventoDeCita, ProveedorCalendario } from '../integraciones/calendario';
import { JobsService, type ResultadoJob } from '../jobs/jobs.service';
import { type Adjunto, type Correo, ProveedorCorreo } from './correo';

const ASUNTOS: Record<TipoNotificacion, string> = {
  CITA_CONFIRMADA: 'Cita confirmada',
  CITA_CANCELADA: 'Cita cancelada',
  CITA_REPROGRAMADA: 'Cita reprogramada',
  ENLACE_ONLINE: 'Enlace de su sesion online',
  CONSENTIMIENTO_SOLICITADO: 'Solicitud de consentimiento',
  AVISO_CAMBIO_SUPERVISOR: 'Aviso: cambio de supervisor',
  DERIVACION_OFRECIDA: 'Nueva oferta de derivacion',
  MENSAJE_PACIENTE: 'Nuevo mensaje de un paciente',
  DOCUMENTO_CLINICO: 'Documento disponible',
  DERIVACION_ACTUALIZADA: 'Cambios en una derivacion',
};

interface Pendiente {
  id: string;
  tipo: TipoNotificacion;
  referencia_id: string;
  email: string | null;
  enlace: Uint8Array | null;
  adjunto: Uint8Array | null;
  datos: {
    centro: string;
    inicio?: string;
    fin?: string;
    modalidad?: ModalidadAtencion;
    estado?: EstadoCita;
    espacio?: string | null;
    documento_id?: string;
    nombre_archivo?: string;
    tipo_mime?: string;
    modo?: 'ENLACE' | 'ADJUNTO';
    expira_en?: string;
  };
}

/**
 * Notificaciones (02f, 02h). Escucha los eventos de dominio (despues del
 * COMMIT) y registra cada aviso en `notificaciones` (PENDIENTE) con el
 * contexto del actor; los avisos de derivacion los registra la BD (triggers).
 * El job de envio (sin contexto, con advisory lock) toma las pendientes,
 * envia por la interfaz de correo con el nombre del centro como remitente y
 * las cierra. Nunca loguea emails, enlaces ni contenido.
 *
 * Contenido: los correos avisan y remiten al portal. Excepciones: el enlace
 * de videollamada, el .ics de la cita (solo "Sesion", modalidad, horario y
 * enlace o box) y los documentos clinicos emitidos (enlace que expira y exige
 * iniciar sesion; adjunto solo si el paciente lo pidio).
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger('Notificaciones');

  constructor(
    private readonly bd: ContextoBd,
    private readonly jobs: JobsService,
    private readonly llavero: LlaveroService,
    private readonly correo: ProveedorCorreo,
    private readonly calendario: ProveedorCalendario,
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
      const pendientes = await tx.$queryRaw<Pendiente[]>`
        SELECT id, tipo, referencia_id, email, enlace, adjunto, datos FROM notificaciones_por_enviar(50)`;
      let enviadas = 0;
      for (const n of pendientes) {
        let error: string | null = null;
        if (!n.email) {
          error = 'destinatario sin email';
        } else {
          try {
            await this.correo.enviar(this.armar(n, n.email));
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

  private armar(n: Pendiente, para: string): Correo {
    const base = { para, asunto: ASUNTOS[n.tipo], remitente: n.datos.centro };
    const portal = 'Revise el detalle en el portal del centro.';
    switch (n.tipo) {
      case 'ENLACE_ONLINE':
        if (n.enlace) {
          return { ...base, texto: `Enlace de su sesion online: ${this.enlaceCita(n)}\nNo comparta este enlace.` };
        }
        break;
      case 'CITA_CONFIRMADA':
      case 'CITA_REPROGRAMADA':
        return { ...base, texto: `${ASUNTOS[n.tipo]}. ${portal}`, adjuntos: n.datos.inicio ? [this.ics(n)] : [] };
      case 'DOCUMENTO_CLINICO':
        return this.documento(n, base);
      case 'DERIVACION_OFRECIDA':
        // Solo que tiene una oferta: nunca la lista, el orden ni quien rechazo.
        return { ...base, texto: 'Tiene una nueva oferta de derivacion. Revisela en el sistema antes de que venza.' };
      case 'DERIVACION_ACTUALIZADA':
        return { ...base, texto: 'Una derivacion que usted origino cambio de estado. Revise el detalle en el sistema.' };
    }
    return { ...base, texto: `${ASUNTOS[n.tipo]}. ${portal}` };
  }

  private enlaceCita(n: Pendiente): string {
    const { url } = JSON.parse(this.llavero.descifrarCampo(n.enlace, 'citas', 'enlace_online', n.referencia_id)!) as { url: string };
    return url;
  }

  /** .ics con la misma regla de contenido que el feed (eventoDeCita). */
  private ics(n: Pendiente): Adjunto {
    const d = n.datos;
    const evento = eventoDeCita({
      id: n.referencia_id,
      inicio: new Date(d.inicio!),
      fin: new Date(d.fin!),
      modalidad: d.modalidad!,
      estado: d.estado!,
      espacio: d.espacio ?? null,
      enlace: n.enlace ? this.enlaceCita(n) : null,
    });
    return { nombre: 'sesion.ics', tipo: 'text/calendar; charset=utf-8', contenido: Buffer.from(this.calendario.calendario(d.centro, [evento]), 'utf8') };
  }

  /** Documento emitido: enlace que expira y exige iniciar sesion, o adjunto pedido por el paciente. */
  private documento(n: Pendiente, base: Omit<Correo, 'texto'>): Correo {
    const d = n.datos;
    if (d.modo === 'ADJUNTO' && n.adjunto) {
      const base64 = this.llavero.descifrarCampo(n.adjunto, 'documentos_clinicos', 'contenido', d.documento_id!)!;
      return {
        ...base,
        texto: 'Adjuntamos el documento que solicito. Tambien esta disponible en el portal del centro.',
        adjuntos: [{ nombre: d.nombre_archivo!, tipo: d.tipo_mime!, contenido: Buffer.from(base64, 'base64') }],
      };
    }
    const url = this.llavero.descifrarCampo(n.enlace, 'envios_documento', 'enlace', n.referencia_id)!;
    const vence = new Date(d.expira_en!).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    return {
      ...base,
      texto: `Tiene un documento disponible: ${url}\nPara descargarlo debe iniciar sesion. El enlace vence el ${vence}.\nNo comparta este enlace.`,
    };
  }
}
