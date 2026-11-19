/**
 * Respuestas de los endpoints de agenda nuevos en 03b (bloques de box). En un
 * archivo *.dto.ts para que el plugin de Swagger documente el contrato y el
 * front lo tome del esquema generado.
 */
import { ApiProperty } from '@nestjs/swagger';
import { EstadoCita, ModalidadAtencion, MotivoBloqueoAgenda, RespuestaRecordatorio } from '@prisma/client';

/** Horas de box apartadas por un profesional (su agenda). */
export class BloqueAtencionVista {
  id!: string;
  profesionalId!: string;
  espacioId!: string;
  inicio!: Date;
  fin!: Date;
  creadoEn!: Date;
}

/** Horas libres de un box para apartar (sin profesionales ni pacientes). */
export class HoraLibreBox {
  espacioId!: string;
  inicio!: Date;
  fin!: Date;
}

export class BloquesLiberados {
  eliminados!: number;
}

/** Si cancela ahora: a tiempo (dentro del plazo de aviso) o tardia. Sin cargos (MVP sin cobros). */
export class CancelacionRecordatorio {
  aTiempo!: boolean;
  @ApiProperty({ required: false })
  plazoAvisoHoras?: number;
}

/** Pagina del recordatorio (sin sesion, no consume el enlace). */
export class RecordatorioConsulta {
  inicio!: Date;
  fin!: Date;
  @ApiProperty({ enum: ModalidadAtencion, enumName: 'ModalidadAtencion' })
  modalidad!: ModalidadAtencion;
  @ApiProperty({ type: String, nullable: true })
  profesional!: string | null;
  @ApiProperty({ enum: RespuestaRecordatorio, enumName: 'RespuestaRecordatorio', nullable: true })
  respuesta!: RespuestaRecordatorio | null;
  /** Se puede responder (antes del inicio, sin respuesta y la cita sigue igual). */
  vigente!: boolean;
  cancelacion!: CancelacionRecordatorio;
}

export class RecordatorioRespuesta {
  @ApiProperty({ enum: RespuestaRecordatorio, enumName: 'RespuestaRecordatorio' })
  respuesta!: RespuestaRecordatorio;
  @ApiProperty({ type: CancelacionRecordatorio, required: false })
  cancelacion?: CancelacionRecordatorio;
}

/** Enlace de videollamada de una cita online (vence al terminar la cita). */
export class EnlaceCita {
  url!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  expiraEn!: string;
}

/** Cita (datos administrativos). Presencial: box del bloque del profesional. */
export class CitaVista {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  espacioId!: string | null;
  @ApiProperty({ enum: ModalidadAtencion, enumName: 'ModalidadAtencion' })
  modalidad!: ModalidadAtencion;
  profesionalId!: string;
  /** 03b-3.2: nulo solo en RETENIDA (reserva sin cuenta en curso: el paciente nace al verificar el correo). */
  @ApiProperty({ type: String, nullable: true })
  pacienteId!: string | null;
  inicio!: Date;
  fin!: Date;
  @ApiProperty({ enum: EstadoCita, enumName: 'EstadoCita' })
  estado!: EstadoCita;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  canceladaEn!: Date | null;
  /** RETENIDA: plazo para verificar el correo (si no, la hora se libera sola). */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  retencionVenceEn!: Date | null;
  /** MVP sin COBROS: plazo para que el profesional apruebe la hora SOLICITADA (despues el job la cancela). */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  aprobacionVenceEn!: Date | null;
  /** Punto 7: solicitud original de la que sale una hora PROPUESTA (el plazo para elegir es aprobacionVenceEn). */
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  propuestaDeId!: string | null;
  /** 03b-3.3: hora retenida liberada a mano por ADMIN/GESTION (LIBERADA). */
  @ApiProperty({ type: String, nullable: true })
  motivoLiberacion!: string | null;
  /** 2026-11-18: POR_REPROGRAMAR porque el profesional no atiende ese dia (dias sin atencion o cambio de horario). */
  @ApiProperty({ type: String, nullable: true, description: 'DIA_SIN_ATENCION o nulo' })
  motivoReprogramacion!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}

/** Box del centro (catalogo; nunca se borra: se desactiva). */
export class EspacioVista {
  id!: string;
  nombre!: string;
  activo!: boolean;
  @ApiProperty({ type: String, nullable: true })
  nota!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  duracionDefectoMin!: number | null;
  createdAt!: Date;
  updatedAt!: Date;
}

/** Fila del horario de un box (minutos desde las 00:00 de Chile; periodo opcional). */
export class HorarioEspacioVista {
  id!: string;
  espacioId!: string;
  /** ISO: 1 = lunes ... 7 = domingo. */
  diaSemana!: number;
  inicioMin!: number;
  finMin!: number;
  @ApiProperty({ type: String, format: 'date', nullable: true })
  vigenteDesde!: Date | null;
  @ApiProperty({ type: String, format: 'date', nullable: true })
  vigenteHasta!: Date | null;
}

/** Box ocupado en un rango (bloque apartado o soft-lock), sin pacientes ni profesionales. */
export class OcupacionBox {
  espacio_id!: string;
  inicio!: Date;
  fin!: Date;
}

/**
 * 03b-4.1: horario que otra persona tiene abierto en pantalla ("Reservando..."),
 * categoria C: solo el box (nulo si es online) y el rango, sin quien ni profesional.
 */
export class RetencionEnCurso {
  @ApiProperty({ type: String, nullable: true })
  espacioId!: string | null;
  inicio!: Date;
  fin!: Date;
}

/** Soft-lock con TTL (solo UX: el EXCLUDE de citas sigue siendo la fuente de verdad). */
export class HorarioTomado {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  espacioId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  usuarioId!: string | null;
  profesionalId!: string;
  @ApiProperty({ enum: ModalidadAtencion, enumName: 'ModalidadAtencion' })
  modalidad!: ModalidadAtencion;
  inicio!: Date;
  fin!: Date;
  /** Fin de la retencion (cuenta regresiva en pantalla). */
  expiraEn!: Date;
  createdAt!: Date;
}

/** Horario habitual semanal (referencia para apartar bloques; ya no decide la agenda). */
export class DisponibilidadHabitual {
  id!: string;
  profesionalId!: string;
  /** ISO: 1 = lunes ... 7 = domingo. */
  diaSemana!: number;
  inicioMin!: number;
  finMin!: number;
  @ApiProperty({ enum: ModalidadAtencion, enumName: 'ModalidadAtencion' })
  modalidad!: ModalidadAtencion;
  /** 2026-11-18: dia desactivado con un clic (la fila se conserva y no decide la agenda). */
  activo!: boolean;
  /** HH:MM. */
  horaInicio!: string;
  horaFin!: string;
  createdAt!: Date;
}

/** Bloqueo de agenda (vacaciones, licencia...). El motivo solo lo ven el propio y ADMIN/GESTION. */
export class BloqueoAgendaVista {
  id!: string;
  profesionalId!: string;
  inicio!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Nulo = indefinido (baja)' })
  fin!: Date | null;
  @ApiProperty({ enum: MotivoBloqueoAgenda, enumName: 'MotivoBloqueoAgenda' })
  motivo!: MotivoBloqueoAgenda;
  createdAt!: Date;
}

/** Hueco libre de un profesional (rango continuo por modalidad), sin motivos. */
export class HuecoAgenda {
  @ApiProperty({ enum: ModalidadAtencion, enumName: 'ModalidadAtencion' })
  modalidad!: ModalidadAtencion;
  inicio!: Date;
  fin!: Date;
}

export class Eliminados {
  eliminados!: number;
}

class AlternativaCita {
  inicio!: Date;
  fin!: Date;
}

/** Verificacion previa de un horario (no reserva nada). */
export class VerificacionHorario {
  disponible!: boolean;
  /** PROFESIONAL_NO_DISPONIBLE: fuera de sus bloques de box, bloqueos, otra cita o su pausa. */
  motivos!: string[];
  /** Horarios libres mas cercanos de la misma modalidad y duracion. */
  alternativas!: AlternativaCita[];
}

/** Sala de videollamada propia: enlace propio (cifrado) o sala Jitsi generada por cita. */
export class SalaVideollamadaVista {
  @ApiProperty({ enum: ['ENLACE_PROPIO', 'JITSI'], enumName: 'ModoVideollamada' })
  modo!: 'ENLACE_PROPIO' | 'JITSI';
  @ApiProperty({ type: String, nullable: true })
  enlace!: string | null;
}

/** URL privada del feed iCal: se muestra una sola vez (regenerarla invalida la anterior). */
export class FeedCalendario {
  url!: string;
}

/** "Requerir cierre": aviso al profesional (sesion sin evolucion). */
export class CierreRequerido {
  citaId!: string;
  avisado!: boolean;
}

export class AvisoPorReprogramar {
  /** Cuantas horas se avisaron (las que siguen por reprogramar, futuras y con paciente). */
  avisadas!: number;
}
