/**
 * Respuestas del portal publico (03b-2): solo documentan el contrato para el
 * cliente generado del front. Los nombres en snake_case vienen tal cual de
 * las funciones de la BD (perfiles_publicos, contenido_publico_centro, ...).
 */
import { ApiProperty } from '@nestjs/swagger';
import { CriterioMatch, EstadoCita, Modalidad, ModalidadAtencion, ModeloCobro, ModuloCentro, TipoPreguntaMatch } from '@prisma/client';

export class ServicioPublico {
  @ApiProperty({ type: String, required: false, description: 'Nombre de un icono Material Symbols' })
  icono?: string;
  titulo!: string;
  texto!: string;
}

/** contenido_publico_centro(): contenido editable por ADMIN + datos del centro para los terminos. */
export class CentroPublico {
  nombre_centro!: string;
  @ApiProperty({ type: String, nullable: true })
  hero_titulo!: string | null;
  @ApiProperty({ type: String, nullable: true })
  hero_texto!: string | null;
  servicios!: ServicioPublico[];
  @ApiProperty({ type: String, nullable: true })
  contacto_correo!: string | null;
  @ApiProperty({ type: String, nullable: true })
  contacto_telefono!: string | null;
  @ApiProperty({ type: String, nullable: true })
  direccion!: string | null;
  @ApiProperty({ type: String, nullable: true })
  whatsapp!: string | null;
  @ApiProperty({ type: String, nullable: true })
  instagram!: string | null;
  @ApiProperty({ type: String, nullable: true })
  mision!: string | null;
  @ApiProperty({ type: String, nullable: true })
  vision!: string | null;
  @ApiProperty({ type: String, nullable: true })
  color_marca!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'GET publico/imagenes/{id}' })
  logo_imagen_id!: string | null;
  @ApiProperty({ enum: ModuloCentro, enumName: 'ModuloCentro', isArray: true })
  modulos!: ModuloCentro[];
  match_filtro_directo!: boolean;
  plazo_aviso_cancelacion_horas!: number;
  penalizacion_cancelacion_porcentaje!: number;
  cobro_inasistencia_porcentaje!: number;
  @ApiProperty({ enum: ModeloCobro, enumName: 'ModeloCobro' })
  modelo_cobro!: ModeloCobro;
}

export class PoliticaPublica {
  id!: string;
  version!: number;
  texto!: string;
  vigente_desde!: Date;
}

export class TarifaPublica {
  @ApiProperty({ type: String, nullable: true })
  tipo_atencion!: string | null;
  @ApiProperty({ enum: ModalidadAtencion, enumName: 'ModalidadAtencion', nullable: true })
  modalidad!: ModalidadAtencion | null;
  monto!: number;
}

export class TrayectoriaPublica {
  tipo!: string;
  titulo!: string;
  institucion!: string;
  anio!: number;
}

/** perfiles_publicos(): solo PROFESIONAL con perfil publicado; nunca practicantes, RUT ni contacto. */
export class PerfilPublico {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  nombre_publico!: string | null;
  @ApiProperty({ type: String, nullable: true })
  bio!: string | null;
  @ApiProperty({ type: String, nullable: true })
  foto_url!: string | null;
  especialidad!: string;
  enfoques!: string[];
  @ApiProperty({ enum: Modalidad, enumName: 'Modalidad' })
  modalidad!: Modalidad;
  tipos_atencion!: string[];
  verificado!: boolean;
  titulos_verificados!: string[];
  tarifas!: TarifaPublica[];
  /** Solo la trayectoria verificada por ADMIN. */
  trayectoria!: TrayectoriaPublica[];
  @ApiProperty({ type: Number, nullable: true })
  anios_experiencia!: number | null;
  boleta_reembolsable!: boolean;
  convenios!: string[];
  idiomas!: string[];
  @ApiProperty({ type: String, nullable: true })
  cita_destacada!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Promedio de reseñas publicadas (decimal como texto)' })
  calificacion!: string | null;
  resenas!: number;
}

export class Hueco {
  @ApiProperty({ enum: ModalidadAtencion, enumName: 'ModalidadAtencion' })
  modalidad!: ModalidadAtencion;
  inicio!: Date;
  fin!: Date;
}

/** Reseña publicada (D-1): autor "Nombre + inicial" o "Usuario anonimo". */
export class ResenaPublica {
  id!: string;
  calificacion!: number;
  @ApiProperty({ type: String, nullable: true })
  texto!: string | null;
  autor!: string;
  fecha!: Date;
}

export class OpcionPublica {
  valor!: string;
  etiqueta!: string;
  @ApiProperty({ type: String, nullable: true })
  nota!: string | null;
  @ApiProperty({ enum: CriterioMatch, enumName: 'CriterioMatch', nullable: true })
  criterio!: CriterioMatch | null;
  @ApiProperty({ type: String, nullable: true })
  objetivo!: string | null;
  peso!: number;
  estricto!: boolean;
  /** Aviso al elegir la opcion (p. ej. Salud Responde en intensidad alta). */
  @ApiProperty({ type: String, nullable: true })
  mensaje!: string | null;
}

export class PreguntaPublica {
  id!: string;
  clave!: string;
  texto!: string;
  @ApiProperty({ type: String, nullable: true })
  ayuda!: string | null;
  @ApiProperty({ enum: TipoPreguntaMatch, enumName: 'TipoPreguntaMatch' })
  tipo!: TipoPreguntaMatch;
  obligatoria!: boolean;
  @ApiProperty({ type: Number, nullable: true })
  max_selecciones!: number | null;
  opciones!: OpcionPublica[];
}

export class CuestionarioPublico {
  preguntas!: PreguntaPublica[];
  /** "Prefiero filtrar yo mismo" habilitado por ADMIN. */
  filtroDirecto!: boolean;
}

export class OpcionResultadoMatch {
  perfil!: PerfilPublico;
  puntaje!: number;
  /** Explicacion en lenguaje claro (por que se recomienda). */
  razones!: string[];
  @ApiProperty({ type: String, nullable: true, description: 'Criterios estrictos que no cumple' })
  advertencia!: string | null;
  @ApiProperty({ type: Date, nullable: true })
  primerHueco!: Date | null;
}

/** Resultado del match: no se guardan las respuestas (C-17). */
export class ResultadoMatch {
  @ApiProperty({ type: OpcionResultadoMatch, nullable: true })
  recomendado!: OpcionResultadoMatch | null;
  otros!: OpcionResultadoMatch[];
  avisos!: string[];
  /** Etiquetas de las opciones elegidas. */
  resumen!: string[];
}

export class SolicitudCreada {
  /** Fin de la retencion de la hora (bloqueo temporal). */
  expiraEn!: Date;
  verificacionEnviada!: boolean;
}

export class SolicitudVerificada {
  /** CONFIRMADA, o SOLICITADA si el profesional aprueba a los pacientes nuevos. */
  @ApiProperty({ enum: EstadoCita, enumName: 'EstadoCita' })
  estado!: EstadoCita;
  citaId!: string;
  profesionalId!: string;
  @ApiProperty({ enum: ModalidadAtencion, enumName: 'ModalidadAtencion' })
  modalidad!: ModalidadAtencion;
  inicio!: Date;
  fin!: Date;
  invitacionEnviada!: boolean;
  adultoResponsable!: boolean;
}
