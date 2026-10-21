/**
 * Respuestas de los endpoints de agenda nuevos en 03b (bloques de box). En un
 * archivo *.dto.ts para que el plugin de Swagger documente el contrato y el
 * front lo tome del esquema generado.
 */
import { ApiProperty } from '@nestjs/swagger';
import { EstadoCita, MedioConfirmacion, ModalidadAtencion, MotivoBloqueoAgenda, RespuestaRecordatorio } from '@prisma/client';

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

/** Si cancela ahora: a tiempo (sin cargo) o tardia (penalizacion sobre lo pagado). */
export class CancelacionRecordatorio {
  aTiempo!: boolean;
  @ApiProperty({ required: false })
  plazoAvisoHoras?: number;
  penalizacionPorcentaje!: number;
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
  margenTrasladoMin!: number;
  profesionalId!: string;
  /** 03b-3.2: nulo solo en RETENIDA (reserva sin cuenta en curso: el paciente nace con el pago). */
  @ApiProperty({ type: String, nullable: true })
  pacienteId!: string | null;
  inicio!: Date;
  fin!: Date;
  @ApiProperty({ enum: EstadoCita, enumName: 'EstadoCita' })
  estado!: EstadoCita;
  @ApiProperty({ type: Number, nullable: true, description: 'Fijado por la BD al confirmar' })
  monto!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  canceladaEn!: Date | null;
  /** 03b-3.2: plazo de pago (PENDIENTE_PAGO o RETENIDA); la agendada por el equipo, hasta las horas configuradas antes (12 por defecto). */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pagoVenceEn!: Date | null;
  /** PAGO_EN_CENTRO en una cita del equipo sin plazo para el cobro previo, o cuyo plazo vencio sin pago (03b-3.3). */
  @ApiProperty({ enum: MedioConfirmacion, enumName: 'MedioConfirmacion', nullable: true })
  medioConfirmacion!: MedioConfirmacion | null;
  /** 03b-3.3: hora retenida liberada a mano por ADMIN/GESTION (LIBERADA). */
  @ApiProperty({ type: String, nullable: true })
  motivoLiberacion!: string | null;
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
  /** PROFESIONAL_NO_DISPONIBLE: fuera de sus bloques de box, bloqueos, otra cita o margen. */
  motivos!: string[];
  /** Horarios libres mas cercanos de la misma modalidad y duracion. */
  alternativas!: AlternativaCita[];
}

/** Cita futura que no cumple el margen de traslado vigente (no se mueve sola). */
export class ConflictoMargen {
  cita_id!: string;
  cita_conflicto_id!: string;
  inicio!: Date;
  separacion_min!: number;
  margen_min!: number;
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
