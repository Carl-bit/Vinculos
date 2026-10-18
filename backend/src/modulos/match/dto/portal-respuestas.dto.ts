/**
 * Respuestas del portal del paciente (03b-3): solo documentan el contrato
 * para el cliente generado del front. Nunca contenido clinico de la ficha:
 * citas (datos administrativos), mensajes enviados por la cuenta, reseñas
 * propias y datos de contacto.
 */
import { ApiProperty } from '@nestjs/swagger';
import { CanalAceptacion, EstadoCita, EstadoEpicrisis, EstadoResena, ModalidadAtencion, MostrarResena } from '@prisma/client';

/** mi_equipo_tratante() o supervisores_portal(): solo id y nombre. */
export class PersonaPortal {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  nombre!: string | null;
}

export class PacientePortal {
  id!: string;
  nombre!: string;
  apellido!: string;
  @ApiProperty({ type: String, format: 'date' })
  fechaNacimiento!: Date;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true })
  telefono!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Tratante actual' })
  profesionalId!: string | null;
}

export class CitaPortal {
  id!: string;
  pacienteId!: string;
  profesionalId!: string;
  @ApiProperty({ enum: ModalidadAtencion, enumName: 'ModalidadAtencion' })
  modalidad!: ModalidadAtencion;
  @ApiProperty({ type: String, nullable: true })
  espacioId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Box de la cita presencial' })
  espacioNombre!: string | null;
  inicio!: Date;
  fin!: Date;
  @ApiProperty({ enum: EstadoCita, enumName: 'EstadoCita' })
  estado!: EstadoCita;
  /** CONFIRMADA y ya terminada (la inasistencia se resuelve en Cobros). */
  realizada!: boolean;
}

/** Datos de transferencia del profesional: solo con cobro directo y saldo pendiente. */
export class DatosPagoPortal {
  aplica!: boolean;
  @ApiProperty({ type: String, required: false })
  profesionalId?: string;
  @ApiProperty({ type: String, nullable: true, required: false })
  rut?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false })
  banco?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false })
  tipoCuenta?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false })
  numeroCuenta?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false })
  titular?: string | null;
}

/** Mensaje al profesional. El paciente ve los de su registro; el adulto responsable, los que el escribio. */
export class MensajePortal {
  id!: string;
  @ApiProperty({ required: false })
  pacienteId?: string;
  profesionalId!: string;
  contenido!: string;
  creadoEn!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, required: false })
  leidoEn?: Date | null;
}

export class SolicitudEpicrisisPortal {
  id!: string;
  pacienteId!: string;
  @ApiProperty({ type: String, nullable: true })
  motivo!: string | null;
  @ApiProperty({ enum: EstadoEpicrisis, enumName: 'EstadoEpicrisis' })
  estado!: EstadoEpicrisis;
  solicitadaEn!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resueltaEn!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  documentoRef!: string | null;
}

export class AdultoResponsablePortal {
  id!: string;
  nombre!: string;
  @ApiProperty({ type: String, nullable: true })
  parentesco!: string | null;
  @ApiProperty({ type: String, nullable: true })
  telefono!: string | null;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  /** Es la cuenta que consulta (el adulto responsable responde consentimientos con este registro). */
  esMiCuenta!: boolean;
}

/** "Mis datos": solo telefono y correo se editan desde el portal (C-9). */
export class MisDatosPortal {
  id!: string;
  nombre!: string;
  apellido!: string;
  @ApiProperty({ type: String, format: 'date' })
  fechaNacimiento!: Date;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true })
  telefono!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Lo registra el centro (texto libre, cifrado)' })
  contactoEmergencia!: string | null;
  adultosResponsables!: AdultoResponsablePortal[];
}

export class MisDatosActualizados {
  telefonoActualizado!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Vence el enlace enviado al correo nuevo' })
  correoPendienteHasta!: Date | null;
}

export class AceptacionPortal {
  id!: string;
  pacienteId!: string;
}

/** Reseña propia, con su estado de moderacion y el feedback privado que escribio. */
export class ResenaPortal {
  id!: string;
  pacienteId!: string;
  profesionalId!: string;
  calificacion!: number;
  @ApiProperty({ type: String, nullable: true })
  texto!: string | null;
  @ApiProperty({ type: String, nullable: true })
  feedbackPrivado!: string | null;
  @ApiProperty({ enum: MostrarResena, enumName: 'MostrarResena' })
  mostrarComo!: MostrarResena;
  @ApiProperty({ enum: EstadoResena, enumName: 'EstadoResena' })
  estado!: EstadoResena;
  @ApiProperty({ type: String, nullable: true })
  motivoOcultamiento!: string | null;
  creadaEn!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  editadaEn!: Date | null;
}

/** Pagina del enlace de consentimiento (no lo consume). */
export class ConsultaConsentimiento {
  @ApiProperty({ enum: ['ATENCION', 'PRACTICANTE', 'AVISO_SUPERVISOR'] })
  tipo!: 'ATENCION' | 'PRACTICANTE' | 'AVISO_SUPERVISOR';
  politica_version!: number;
  politica_texto!: string;
  vence_en!: Date;
  /** Responde el adulto responsable por un menor. */
  menor!: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Quien atiende (consentimiento de practicante o aviso)' })
  practicante!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Quien supervisa (en un aviso: el supervisor nuevo)' })
  supervisor!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Aviso de cambio: quien supervisaba' })
  supervisor_anterior!: string | null;
}

export class RespuestaConsentimientoToken {
  @ApiProperty({ enum: ['ATENCION', 'PRACTICANTE', 'AVISO_SUPERVISOR'] })
  tipo!: string;
  acepta!: boolean;
}

export class PoliticaVigentePortal {
  id!: string;
  version!: number;
  texto!: string;
  vigenteDesde!: Date;
}

export class AceptacionVigentePortal {
  version!: number;
  aceptadaEn!: Date;
  @ApiProperty({ enum: CanalAceptacion, enumName: 'CanalAceptacion' })
  canal!: CanalAceptacion;
}

/** Consentimiento informado de atencion: version vigente y la ultima aceptada por el paciente. */
export class EstadoConsentimientoAtencion {
  pacienteId!: string;
  @ApiProperty({ type: PoliticaVigentePortal, nullable: true })
  vigente!: PoliticaVigentePortal | null;
  @ApiProperty({ type: AceptacionVigentePortal, nullable: true })
  aceptada!: AceptacionVigentePortal | null;
}

/** Hora reservada desde la cuenta: CONFIRMADA, o SOLICITADA si el profesional aprueba pacientes nuevos. */
export class ReservaPortal {
  citaId!: string;
  @ApiProperty({ enum: EstadoCita, enumName: 'EstadoCita' })
  estado!: EstadoCita;
  profesionalId!: string;
}
