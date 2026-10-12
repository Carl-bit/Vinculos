import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import type { CanalMensaje, EstadoCita, ModalidadAtencion, ModoEnvioDocumento, TipoNotificacion } from '@prisma/client';

import { ContextoBd, type Tx } from '../bd/contexto-bd.service';
import { LlaveroService } from '../crypto/llavero.service';
import { generarPdfDocumento } from '../documentos/pdf';
import { EVENTOS, type CitaCancelada, type CitaConfirmada, type CitaReprogramada, type NotificacionSolicitada } from '../eventos/eventos';
import { eventoDeCita, ProveedorCalendario } from '../integraciones/calendario';
import { JobsService, type ResultadoJob } from '../jobs/jobs.service';
import { type Adjunto, ProveedorCorreo } from './correo';

/** Variables permitidas en plantillas de mensaje (la BD valida la misma lista). */
export const VARIABLES_MENSAJE = ['nombre_paciente', 'nombre_profesional', 'fecha', 'hora', 'modalidad', 'enlace', 'nombre_centro'] as const;
type Variables = Record<(typeof VARIABLES_MENSAJE)[number], string>;

/** Reemplaza {{variable}}; una variable sin valor queda vacia. */
export function armarPlantilla(plantilla: string, valores: Partial<Record<string, string>>): string {
  return plantilla.replace(/\{\{([^{}]*)\}\}/g, (_, nombre: string) => valores[nombre.trim()] ?? '');
}

/** Sin plantilla (evento sin ejemplo, p. ej. ENLACE_ONLINE de 02h): la bandeja igual registra. */
const PLANTILLA_GENERICA = { asunto: 'Aviso de {{nombre_centro}}', cuerpo: 'Tiene un aviso nuevo. Detalle: {{enlace}}' };

/** Correo con .ics de la cita (UID fijo, SEQUENCE; CANCEL si esta cancelada). */
const CON_ICS: TipoNotificacion[] = ['CITA_CONFIRMADA', 'CITA_REPROGRAMADA', 'CITA_CANCELADA'];

const AAD_ENLACE: Record<string, string> = { citas: 'enlace_online', envios_documento: 'enlace', recordatorios_cita: 'enlace' };

interface Pendiente {
  id: string;
  tipo: TipoNotificacion;
  canal: CanalMensaje;
  referencia_id: string;
  email: string | null;
  asunto: Uint8Array | null;
  cuerpo: Uint8Array | null;
  plantilla_asunto: string | null;
  plantilla_cuerpo: string | null;
  enlace: Uint8Array | null;
  enlace_origen: string | null;
  enlace_id: string | null;
  adjunto: Uint8Array | null;
  datos: {
    centro: string;
    destinatario: 'PACIENTE' | 'EQUIPO';
    paciente?: string;
    profesional?: string;
    cita_id?: string;
    inicio?: string;
    fin?: string;
    modalidad?: ModalidadAtencion;
    estado?: EstadoCita;
    secuencia?: number;
    espacio?: string;
    documento_id?: string;
    tipo_documento?: string;
    nombre_archivo?: string;
    emitido_en?: string;
    modo?: ModoEnvioDocumento;
    creada_en: string;
  };
}

const ZONA = 'America/Santiago';

/**
 * Mensajeria (02f, 02h, 02i) en tres capas:
 *  - Eventos: catalogo fijo (enum tipo_notificacion; destinatarios en
 *    docs/api/integraciones.md). La API los pide despues del COMMIT con
 *    notificar() (contexto del actor); la BD crea los de derivaciones,
 *    recordatorios y consentimientos por vencer.
 *  - Plantillas: plantillas_mensaje (ADMIN las personaliza). Solo variables
 *    de VARIABLES_MENSAJE: nunca motivo, diagnostico, notas ni contenido
 *    clinico.
 *  - Canales: una fila por canal. BANDEJA siempre (registro oficial); CORREO
 *    segun plantilla activa y preferencias del paciente; WHATSAPP reservado.
 *
 * El job (sin contexto, advisory lock, SKIP LOCKED) arma cada mensaje una vez
 * (asunto y cuerpo cifrados en la fila), cierra la BANDEJA y envia el CORREO;
 * un fallo de envio reintenta con backoff y nunca afecta la operacion que lo
 * origino. Nunca loguea emails, enlaces ni contenido.
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
    private readonly config: ConfigService,
  ) {}

  @OnEvent(EVENTOS.CITA_CONFIRMADA)
  citaConfirmada(e: CitaConfirmada) {
    return this.registrar(e.actor, { tipo: 'CITA_CONFIRMADA', destino: { pacienteId: e.pacienteId }, referenciaId: e.citaId });
  }

  @OnEvent(EVENTOS.CITA_REPROGRAMADA)
  citaReprogramada(e: CitaReprogramada) {
    return this.registrar(e.actor, { tipo: 'CITA_REPROGRAMADA', destino: { pacienteId: e.pacienteId }, referenciaId: e.citaId });
  }

  @OnEvent(EVENTOS.CITA_CANCELADA)
  citaCancelada(e: CitaCancelada) {
    return this.registrar(e.actor, { tipo: 'CITA_CANCELADA', destino: { pacienteId: e.pacienteId }, referenciaId: e.citaId });
  }

  @OnEvent(EVENTOS.NOTIFICACION_SOLICITADA)
  solicitada(e: NotificacionSolicitada) {
    return this.registrar(e.actor, e);
  }

  private async registrar(actor: NotificacionSolicitada['actor'], n: Omit<NotificacionSolicitada, 'actor'>) {
    const pacienteId = 'pacienteId' in n.destino ? n.destino.pacienteId : null;
    const usuarioId = 'usuarioId' in n.destino ? n.destino.usuarioId : null;
    await this.bd.enTransaccion(actor, () =>
      this.bd.tx().$executeRaw`
        SELECT notificar(${n.tipo}::tipo_notificacion, ${pacienteId}::uuid, ${usuarioId}::uuid, ${n.referenciaId}::uuid)`,
    );
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'enviar_notificaciones' })
  enviarPendientes(): Promise<ResultadoJob> {
    return this.jobs.conLock('enviar_notificaciones', async (tx) => {
      const pendientes = await tx.$queryRaw<Pendiente[]>`SELECT * FROM notificaciones_por_enviar(50)`;
      let enviadas = 0;
      let fallidas = 0;
      for (const n of pendientes) {
        const ok = await this.procesar(tx, n);
        enviadas += ok ? 1 : 0;
        fallidas += ok ? 0 : 1;
      }
      if (fallidas > 0) {
        this.logger.warn(`enviar_notificaciones: ${fallidas} con error (reintento o FALLIDO)`);
      }
      return enviadas;
    });
  }

  private async procesar(tx: Tx, n: Pendiente): Promise<boolean> {
    const marcar = (enviada: boolean, detalle: string | null, reintentar: boolean) =>
      tx.$executeRaw`SELECT marcar_notificacion(${n.id}::uuid, ${enviada}, ${detalle}, ${reintentar})`;
    let mensaje: { asunto: string; cuerpo: string };
    try {
      mensaje = n.asunto ? this.descifrarMensaje(n) : this.armar(n);
    } catch {
      await marcar(false, 'no se pudo armar el mensaje', false);
      return false;
    }
    if (!n.asunto) {
      await tx.$executeRaw`
        SELECT guardar_contenido_notificacion(${n.id}::uuid,
          ${this.llavero.cifrarCampo(mensaje.asunto, 'notificaciones', 'asunto', n.id)},
          ${this.llavero.cifrarCampo(mensaje.cuerpo, 'notificaciones', 'cuerpo', n.id)})`;
    }
    if (n.canal === 'BANDEJA') {
      await marcar(true, null, false);
      return true;
    }
    if (!n.email) {
      await marcar(false, 'destinatario sin email', false);
      return false;
    }
    try {
      await this.correo.enviar({ para: n.email, asunto: mensaje.asunto, texto: mensaje.cuerpo, remitente: n.datos.centro, adjuntos: await this.adjuntos(n) });
    } catch {
      await marcar(false, 'fallo el envio', true);
      return false;
    }
    await marcar(true, null, false);
    return true;
  }

  private descifrarMensaje(n: Pendiente) {
    return {
      asunto: this.llavero.descifrarCampo(n.asunto, 'notificaciones', 'asunto', n.id)!,
      cuerpo: this.llavero.descifrarCampo(n.cuerpo, 'notificaciones', 'cuerpo', n.id)!,
    };
  }

  /** Plantilla vigente con las variables del evento. Un CORREO sin plantilla activa (la desactivaron) no sale. */
  private armar(n: Pendiente) {
    if (!n.plantilla_asunto && n.canal === 'CORREO') {
      throw new Error('plantilla de correo desactivada');
    }
    const plantilla = n.plantilla_asunto ? { asunto: n.plantilla_asunto, cuerpo: n.plantilla_cuerpo! } : PLANTILLA_GENERICA;
    const valores = this.variables(n);
    return { asunto: armarPlantilla(plantilla.asunto, valores), cuerpo: armarPlantilla(plantilla.cuerpo, valores) };
  }

  /** Solo las variables permitidas. El nombre del paciente, solo si el es el destinatario. */
  private variables(n: Pendiente): Variables {
    const d = n.datos;
    const cuando = new Date(d.inicio ?? d.emitido_en ?? d.creada_en);
    return {
      nombre_paciente: d.paciente ?? '',
      nombre_profesional: d.profesional ?? '',
      fecha: cuando.toLocaleDateString('es-CL', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      hora: cuando.toLocaleTimeString('es-CL', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }),
      modalidad: d.modalidad === 'ONLINE' ? 'online' : d.modalidad ? 'presencial' : '',
      enlace: this.enlace(n),
      nombre_centro: d.centro,
    };
  }

  /** Enlace propio del evento (videollamada, recordatorio, descarga) o el portal. */
  private enlace(n: Pendiente): string {
    if (n.enlace && n.enlace_origen && n.enlace_id) {
      const valor = this.llavero.descifrarCampo(n.enlace, n.enlace_origen, AAD_ENLACE[n.enlace_origen], n.enlace_id)!;
      return n.enlace_origen === 'citas' ? (JSON.parse(valor) as { url: string }).url : valor;
    }
    const base = this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
    return n.datos.destinatario === 'PACIENTE' ? `${base}/portal` : base;
  }

  private async adjuntos(n: Pendiente): Promise<Adjunto[]> {
    const d = n.datos;
    if (CON_ICS.includes(n.tipo) && d.inicio) {
      return [this.ics(n)];
    }
    if (n.tipo === 'DOCUMENTO_CLINICO' && d.modo === 'ADJUNTO' && n.adjunto) {
      const texto = this.llavero.descifrarCampo(n.adjunto, 'documentos_clinicos', 'contenido', d.documento_id!)!;
      const pdf = await generarPdfDocumento({ centro: d.centro, titulo: d.tipo_documento!, texto, emitidoEn: new Date(d.emitido_en!) });
      return [{ nombre: d.nombre_archivo!, tipo: 'application/pdf', contenido: pdf }];
    }
    return [];
  }

  /** .ics con la misma regla de contenido que el feed (eventoDeCita), con el estado actual de la cita. */
  private ics(n: Pendiente): Adjunto {
    const d = n.datos;
    const cancelada = d.estado === 'CANCELADA';
    const evento = eventoDeCita({
      id: d.cita_id!,
      inicio: new Date(d.inicio!),
      fin: new Date(d.fin!),
      modalidad: d.modalidad!,
      estado: d.estado!,
      espacio: d.espacio ?? null,
      enlace: n.enlace && n.enlace_origen === 'citas' ? this.enlace(n) : null,
      secuencia: d.secuencia ?? 0,
    });
    const texto = this.calendario.calendario(d.centro, [evento], {
      metodo: cancelada ? 'CANCEL' : 'PUBLISH',
      organizador: { nombre: d.centro, email: this.config.getOrThrow<string>('CORREO_REMITENTE') },
    });
    return { nombre: 'sesion.ics', tipo: `text/calendar; charset=utf-8; method=${cancelada ? 'CANCEL' : 'PUBLISH'}`, contenido: Buffer.from(texto, 'utf8') };
  }
}
