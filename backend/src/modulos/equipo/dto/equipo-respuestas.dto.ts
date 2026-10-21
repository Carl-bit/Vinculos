/**
 * Respuestas del modulo Equipo (03b-4): solo documentan el contrato para el
 * cliente generado del front.
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  EstadoResena,
  EstadoTipoSesion,
  Modalidad,
  ModalidadAtencion,
  MostrarResena,
  NivelRiesgo,
  Rol,
  TipoHiloInterno,
  TipoTrayectoria,
} from '@prisma/client';

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

// ---------------------------------------------------------------------------
// 03b-5.2: supervision seudonimizada y mensajeria interna.
// ---------------------------------------------------------------------------

/** Caso supervisado por codigo: nunca nombre, RUT, paciente_id ni ficha_id. */
export class CasoSupervision {
  codigo!: string;
  practicante_id!: string;
  edad_paciente!: number;
  @ApiProperty({ type: String, nullable: true })
  tipo_atencion!: string | null;
}

class PlantillaSupervisada {
  id!: string;
  nombre!: string;
  version!: number;
}

/** Evolucion vista por el supervisor: campos estructurados, notas y solo los campos de plantilla visibles en supervision. */
export class EvolucionSupervisada {
  evolucionId!: string;
  autorId!: string;
  tipoSesion!: string;
  intervenciones!: string[];
  @ApiProperty({ type: String, nullable: true })
  estadoAvance!: string | null;
  @ApiProperty({ enum: NivelRiesgo, enumName: 'NivelRiesgo' })
  nivelRiesgo!: NivelRiesgo;
  @ApiProperty({ type: String, nullable: true })
  notas!: string | null;
  @ApiProperty({ type: String, nullable: true })
  corrigeAId!: string | null;
  creadoEn!: Date;
  @ApiProperty({ type: PlantillaSupervisada, nullable: true })
  plantilla!: PlantillaSupervisada | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'Solo campos visible_en_supervision' })
  valores!: Record<string, unknown> | null;
  /** Claves de texto libre entre los valores visibles (la UI muestra el aviso). */
  camposTextoLibre!: string[];
  advertenciaTextoLibre!: string;
}

/** Comentario del supervisor (append-only). Lo leen el tratante actual y el supervisor vigente. */
export class ComentarioSupervision {
  id!: string;
  evolucionId!: string;
  supervisorId!: string;
  @ApiProperty({ type: String, nullable: true })
  texto!: string | null;
  creadoEn!: Date;
}

/** Hilo interno: GENERAL (sin pacientes) o CASO (con acceso clinico vigente). */
export class HiloVista {
  id!: string;
  @ApiProperty({ enum: TipoHiloInterno, enumName: 'TipoHiloInterno' })
  tipo!: TipoHiloInterno;
  @ApiProperty({ type: String, nullable: true })
  asunto!: string | null;
  @ApiProperty({ type: String, nullable: true })
  pacienteId!: string | null;
  creadoPorId!: string;
  creadoEn!: Date;
  ultimoMensajeEn!: Date;
}

export class HiloConNoLeidos extends HiloVista {
  noLeidos!: number;
}

export class MensajeInternoVista {
  id!: string;
  autorId!: string;
  /** Nombre via nombres_hilo(); "Ex integrante del equipo" si la cuenta se cerro. */
  autor!: string;
  @ApiProperty({ enum: Rol, enumName: 'Rol' })
  rolAutor!: Rol;
  @ApiProperty({ type: String, nullable: true, description: 'null si fue retirado' })
  contenido!: string | null;
  retirado!: boolean;
  creadoEn!: Date;
}

class LecturaHiloVista {
  usuarioId!: string;
  nombre!: string;
  leidoEn!: Date;
}

export class MensajesHilo {
  hilo!: HiloVista;
  mensajes!: MensajeInternoVista[];
  lecturas!: LecturaHiloVista[];
}

export class MensajeInternoEnviado {
  id!: string;
  hiloId!: string;
  autorId!: string;
  @ApiProperty({ enum: Rol, enumName: 'Rol' })
  rolAutor!: Rol;
  @ApiProperty({ type: String, nullable: true })
  contenido!: string | null;
  creadoEn!: Date;
}

export class MensajeRetirado {
  id!: string;
  retirado!: boolean;
}

export class ParticipanteHiloVista {
  usuarioId!: string;
  agregadoEn!: Date;
}
