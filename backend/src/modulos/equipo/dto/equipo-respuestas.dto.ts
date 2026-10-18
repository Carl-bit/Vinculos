/**
 * Respuestas del modulo Equipo (03b-4): solo documentan el contrato para el
 * cliente generado del front.
 */
import { ApiProperty } from '@nestjs/swagger';
import { EstadoResena, EstadoTipoSesion, Modalidad, ModalidadAtencion, MostrarResena, TipoTrayectoria } from '@prisma/client';

/** Tipo de atencion del catalogo (adultos, parejas, infanto-juvenil...). Nunca se borra: se desactiva. */
export class TipoAtencionVista {
  id!: string;
  nombre!: string;
  @ApiProperty({ type: String, nullable: true })
  descripcion!: string | null;
  activo!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

/** Perfil profesional (publico si perfilPublico; el resto lo ve el equipo). */
export class PerfilProfesionalVista {
  usuarioId!: string;
  especialidad!: string;
  enfoques!: string[];
  @ApiProperty({ enum: Modalidad, enumName: 'Modalidad' })
  modalidad!: Modalidad;
  cobroDirecto!: boolean;
  @ApiProperty({ type: Number, nullable: true, description: 'Minutos; nulo = el del centro' })
  margenTrasladoMin!: number | null;
  @ApiProperty({ type: String, nullable: true })
  nombrePublico!: string | null;
  @ApiProperty({ type: String, nullable: true })
  bio!: string | null;
  @ApiProperty({ type: String, nullable: true })
  fotoUrl!: string | null;
  perfilPublico!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  perfilPublicoConsentidoEn!: Date | null;
  boletaReembolsable!: boolean;
  convenios!: string[];
  idiomas!: string[];
  @ApiProperty({ type: String, nullable: true })
  citaDestacada!: string | null;
  requiereAprobacionNuevos!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

export class FotoSubida {
  imagenId!: string;
  fotoUrl!: string;
}

/** Reseña recibida (solo el propio): incluye el feedback privado y el estado de moderacion. */
export class MiResenaRecibida {
  id!: string;
  calificacion!: number;
  @ApiProperty({ type: String, nullable: true })
  texto!: string | null;
  @ApiProperty({ type: String, nullable: true })
  feedbackPrivado!: string | null;
  @ApiProperty({ enum: EstadoResena, enumName: 'EstadoResena' })
  estado!: EstadoResena;
  @ApiProperty({ enum: MostrarResena, enumName: 'MostrarResena' })
  mostrarComo!: MostrarResena;
  creadaEn!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  editadaEn!: Date | null;
}

export class TrayectoriaVista {
  id!: string;
  profesionalId!: string;
  @ApiProperty({ enum: TipoTrayectoria, enumName: 'TipoTrayectoria' })
  tipo!: TipoTrayectoria;
  titulo!: string;
  institucion!: string;
  anio!: number;
  @ApiProperty({ type: String, nullable: true })
  registroSuperintendencia!: string | null;
  @ApiProperty({ type: String, nullable: true })
  documentoRespaldoUrl!: string | null;
  verificado!: boolean;
  @ApiProperty({ type: String, nullable: true })
  verificadoPorId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  verificadoEn!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

/** Datos privados descifrados (RUT y cuenta bancaria): solo el propio y ADMIN/GESTION. */
export class DatosPrivadosVista {
  usuarioId!: string;
  @ApiProperty({ type: String, nullable: true })
  rut!: string | null;
  @ApiProperty({ type: String, nullable: true })
  banco!: string | null;
  @ApiProperty({ type: String, nullable: true })
  tipoCuenta!: string | null;
  @ApiProperty({ type: String, nullable: true })
  numeroCuenta!: string | null;
  @ApiProperty({ type: String, nullable: true })
  titular!: string | null;
  updatedAt!: Date;
}

/** Tarifa (historial: una nueva es otra fila). Sin tipo ni modalidad = tarifa general. */
export class TarifaVista {
  id!: string;
  profesionalId!: string;
  @ApiProperty({ type: String, nullable: true })
  tipoAtencionId!: string | null;
  @ApiProperty({ enum: ModalidadAtencion, enumName: 'ModalidadAtencion', nullable: true })
  modalidad!: ModalidadAtencion | null;
  monto!: number;
  vigenteDesde!: Date;
  createdAt!: Date;
}

/** Tipo de atencion del profesional: PROPUESTO por el, APROBADO o RECHAZADO por ADMIN. */
export class TipoAtencionProfesionalVista {
  profesionalId!: string;
  tipoAtencionId!: string;
  @ApiProperty({ enum: EstadoTipoSesion, enumName: 'EstadoTipoSesion' })
  estado!: EstadoTipoSesion;
  @ApiProperty({ type: String, nullable: true })
  revisadoPorId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revisadoEn!: Date | null;
  createdAt!: Date;
}

export class TrayectoriaEliminada {
  eliminados!: number;
}

export class EspecialidadVista {
  id!: string;
  nombre!: string;
  activo!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

export class EspecialidadDeclaradaVista {
  profesionalId!: string;
  especialidadId!: string;
  @ApiProperty({ enum: EstadoTipoSesion, enumName: 'EstadoTipoSesion' })
  estado!: EstadoTipoSesion;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revisadoEn!: Date | null;
  createdAt!: Date;
}

/** Supervision de un practicante (historial: hasta nulo = vigente). */
export class SupervisionVista {
  id!: string;
  practicanteId!: string;
  supervisorId!: string;
  desde!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  hasta!: Date | null;
  createdAt!: Date;
}

export class SupervisorCambiado {
  practicanteId!: string;
  supervisorId!: string;
  /** Pacientes con consentimiento vigente avisados del cambio (plazo de oposicion). */
  avisosCreados!: number;
}
