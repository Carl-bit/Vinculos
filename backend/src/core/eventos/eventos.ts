/**
 * Contratos de los eventos de dominio: el unico "lenguaje comun" entre
 * modulos (ningun modulo importa el service de otro). Se emiten despues del
 * COMMIT (ContextoBd.alConfirmar) con EventEmitter2; los listeners que
 * escriben en la BD abren su propia transaccion con el contexto del actor.
 *
 * Los payloads llevan ids y fechas, nunca datos cifrados ni de contacto.
 */
import type { ModalidadAtencion, Rol, TipoNotificacion } from '@prisma/client';

export const EVENTOS = {
  CITA_CONFIRMADA: 'agenda.cita_confirmada',
  CITA_CANCELADA: 'agenda.cita_cancelada',
  CITA_REPROGRAMADA: 'agenda.cita_reprogramada',
  NOTIFICACION_SOLICITADA: 'notificaciones.solicitada',
} as const;

interface Actor {
  /** Quien origino el cambio (usuarios.id y rol): contexto para los listeners. */
  actor: { id: string; rol: Rol };
}

export interface CitaConfirmada extends Actor {
  citaId: string;
  pacienteId: string;
  profesionalId: string;
  modalidad: ModalidadAtencion;
  inicio: Date;
  fin: Date;
  /** ONLINE: hay enlace de videollamada para enviar al paciente. */
  conEnlace: boolean;
}

export interface CitaCancelada extends Actor {
  citaId: string;
  pacienteId: string;
  profesionalId: string;
}

export type CitaReprogramada = CitaConfirmada;

export interface NotificacionSolicitada extends Actor {
  tipo: TipoNotificacion;
  /** Destinatario: un paciente o un usuario del equipo. */
  destino: { pacienteId: string } | { usuarioId: string };
  /** Fila que origina el aviso (cita, consentimiento, aviso, derivacion, mensaje). */
  referenciaId: string;
}
