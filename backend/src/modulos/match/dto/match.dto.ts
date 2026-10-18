import { CriterioMatch, EstadoEpicrisis, ModalidadAtencion, MostrarResena, TipoPreguntaMatch } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { IsRut, NormalizarRut, Recortar, TELEFONO_CL } from '../../../core/validacion/validadores';

export class RangoPublicoDto {
  @Type(() => Date)
  @IsDate()
  desde!: Date;

  @Type(() => Date)
  @IsDate()
  hasta!: Date;
}

/** Match: necesidad (tipo de atencion) > tiempos (huecos en el rango) > precio (tarifa maxima). */
export class MatchDto {
  /** Nombre del tipo de atencion (como lo entrega el perfil publico). */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 120)
  tipoAtencion?: string;

  @IsOptional()
  @IsEnum(ModalidadAtencion)
  modalidad?: ModalidadAtencion;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  desde?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  hasta?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tarifaMaxima?: number;
}

export class MensajeDto {
  @IsUUID()
  profesionalId!: string;

  /** Adulto responsable (03a): el menor a cargo por el que escribe. */
  @IsOptional()
  @IsUUID()
  pacienteId?: string;

  @Recortar()
  @IsString()
  @Length(1, 5000)
  contenido!: string;
}

export class SolicitarEpicrisisDto {
  /** Adulto responsable (03a): el menor a cargo. */
  @IsOptional()
  @IsUUID()
  pacienteId?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 2000)
  motivo?: string;
}

export class ResolverEpicrisisDto {
  @IsIn([EstadoEpicrisis.EN_PROCESO, EstadoEpicrisis.ENTREGADA, EstadoEpicrisis.RECHAZADA])
  estado!: 'EN_PROCESO' | 'ENTREGADA' | 'RECHAZADA';

  @ValidateIf((o: ResolverEpicrisisDto) => o.estado === 'ENTREGADA')
  @Recortar()
  @IsString()
  @Length(1, 500)
  documentoRef?: string;
}

/** Filtros del equipo publico (atencion y modalidad). */
export class FiltroPerfilesDto {
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 120)
  tipoAtencion?: string;

  @IsOptional()
  @IsEnum(ModalidadAtencion)
  modalidad?: ModalidadAtencion;
}

/** Respuestas del cuestionario: clave de la pregunta -> valor (o lista de valores; texto en TEXTO). */
export class CalcularMatchDto {
  @IsObject()
  respuestas!: Record<string, string | string[]>;
}

const minusculas = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

/**
 * Solicitud de hora sin cuenta (D-2, D-3, C-15). Retiene la hora y envia un
 * enlace de verificacion al correo. Menor de 18: quien solicita se declara
 * adulto responsable (datos del adulto obligatorios).
 */
export class SolicitudHoraDto {
  @IsUUID()
  profesionalId!: string;

  @IsEnum(ModalidadAtencion)
  modalidad!: ModalidadAtencion;

  @Type(() => Date)
  @IsDate()
  inicio!: Date;

  @Type(() => Date)
  @IsDate()
  fin!: Date;

  @Recortar()
  @IsString()
  @Length(1, 120)
  nombre!: string;

  @Recortar()
  @IsString()
  @Length(1, 120)
  apellido!: string;

  @Type(() => Date)
  @IsDate()
  fechaNacimiento!: Date;

  /** Del paciente adulto o, si es menor, del adulto responsable que solicita. */
  @minusculas()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' })
  telefono?: string;

  /** Opcional aqui; obligatorio antes o en la primera sesion (D-2). */
  @IsOptional()
  @IsRut()
  @NormalizarRut()
  rut?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 200)
  adultoNombre?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 60)
  adultoParentesco?: string;

  @IsOptional()
  @Matches(TELEFONO_CL, { message: 'adultoTelefono: formato +56XXXXXXXXX' })
  adultoTelefono?: string;

  /** Respuestas del cuestionario (se guardan cifradas solo con esta solicitud, D-6). */
  @IsOptional()
  @IsObject()
  respuestas?: Record<string, string | string[]>;

  /** Profesional recomendado por el match (metricas). */
  @IsOptional()
  @IsUUID()
  recomendadoId?: string;

  /** "Avisarme si se libera una hora antes". */
  @IsOptional()
  @IsBoolean()
  listaEspera?: boolean;

  /** Version de la politica de datos aceptada (id de GET /publico/politicas/POLITICA_DATOS). */
  @IsUUID()
  politicaId!: string;

  /** Version de los terminos de agendamiento aceptada. */
  @IsOptional()
  @IsUUID()
  terminosId?: string;

  /** Trampa para bots: debe venir vacio (campo oculto del formulario). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sitioWeb?: string;
}

export class TokenPublicoDto {
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class ResponderConsentimientoTokenDto extends TokenPublicoDto {
  @IsBoolean()
  acepta!: boolean;

  /** Version aceptada (obligatoria si acepta). */
  @ValidateIf((o: ResponderConsentimientoTokenDto) => o.acepta)
  @IsString()
  @Length(1, 40)
  version?: string;
}

export class ReporteResenaDto {
  @Recortar()
  @IsString()
  @Length(3, 500)
  motivo!: string;
}

/** Reseña (D-1): calificacion, texto opcional, feedback privado opcional (solo el profesional) y como mostrarse. */
export class ResenaDto {
  @IsInt()
  @Min(1)
  @Max(5)
  calificacion!: number;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 2000)
  texto?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 2000)
  feedbackPrivado?: string;

  /** Anonimo por defecto (la UI advierte antes de mostrar nombre + inicial). */
  @IsOptional()
  @IsEnum(MostrarResena)
  mostrarComo?: MostrarResena;
}

export class CrearResenaDto extends ResenaDto {
  @IsUUID()
  profesionalId!: string;

  /** Adulto responsable: el menor a cargo. */
  @IsOptional()
  @IsUUID()
  pacienteId?: string;
}

export class ModerarResenaDto {
  @IsBoolean()
  publicar!: boolean;

  @ValidateIf((o: ModerarResenaDto) => !o.publicar)
  @Recortar()
  @IsString()
  @Length(3, 500)
  motivo?: string;
}

/** C-9: el paciente cambia su telefono y su correo (el nuevo se verifica por enlace). */
export class MisDatosDto {
  @IsOptional()
  @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' })
  telefono?: string;

  @IsOptional()
  @minusculas()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

export class PacienteDelPortalDto {
  /** Adulto responsable: el menor a cargo (el paciente adulto no lo indica). */
  @IsOptional()
  @IsUUID()
  pacienteId?: string;
}

export class CitasPortalDto extends PacienteDelPortalDto {
  /** Incluye las pasadas (historial administrativo). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  todas?: boolean;
}

/** Pregunta del match (ADMIN). */
export class PreguntaMatchDto {
  @Matches(/^[a-z0-9_]{1,40}$/, { message: 'clave: minusculas, numeros y _' })
  clave!: string;

  @Recortar()
  @IsString()
  @Length(1, 300)
  texto!: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 500)
  ayuda?: string;

  @IsEnum(TipoPreguntaMatch)
  tipo!: TipoPreguntaMatch;

  @IsInt()
  @Min(0)
  orden!: number;

  @IsOptional()
  @IsBoolean()
  obligatoria?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxSelecciones?: number;
}

export class EditarPreguntaMatchDto {
  @IsOptional() @Recortar() @IsString() @Length(1, 300) texto?: string;
  @IsOptional() @Recortar() @IsString() @Length(1, 500) ayuda?: string;
  @IsOptional() @IsInt() @Min(0) orden?: number;
  @IsOptional() @IsBoolean() activa?: boolean;
  @IsOptional() @IsBoolean() obligatoria?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(20) maxSelecciones?: number;
}

/** Opcion con su regla: criterio + objetivo suman peso; estricto filtra (con advertencia). */
export class OpcionMatchDto {
  @Matches(/^[a-z0-9_-]{1,40}$/, { message: 'valor: minusculas, numeros, _ o -' })
  valor!: string;

  @Recortar()
  @IsString()
  @Length(1, 120)
  etiqueta!: string;

  @IsOptional() @Recortar() @IsString() @Length(1, 200) nota?: string;

  @IsInt()
  @Min(0)
  orden!: number;

  @IsOptional() @IsEnum(CriterioMatch) criterio?: CriterioMatch;

  @ValidateIf((o: OpcionMatchDto) => !!o.criterio)
  @Recortar()
  @IsString()
  @Length(1, 120)
  objetivo?: string;

  @IsOptional() @IsInt() @Min(-100) @Max(100) peso?: number;
  @IsOptional() @IsBoolean() estricto?: boolean;
  @IsOptional() @Recortar() @IsString() @Length(1, 500) mensaje?: string;
}

export class EditarOpcionMatchDto {
  @IsOptional() @Recortar() @IsString() @Length(1, 120) etiqueta?: string;
  @IsOptional() @Recortar() @IsString() @Length(1, 200) nota?: string;
  @IsOptional() @IsInt() @Min(0) orden?: number;
  @IsOptional() @IsBoolean() activa?: boolean;
  @IsOptional() @IsEnum(CriterioMatch) criterio?: CriterioMatch;
  @IsOptional() @Recortar() @IsString() @Length(1, 120) objetivo?: string;
  @IsOptional() @IsInt() @Min(-100) @Max(100) peso?: number;
  @IsOptional() @IsBoolean() estricto?: boolean;
  @IsOptional() @Recortar() @IsString() @Length(1, 500) mensaje?: string;
}

export class MetricasMatchDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  dias?: number;
}

/**
 * Antes de 03b-4: hora con su tratante desde la cuenta (PACIENTE adulto o
 * RESPONSABLE por un menor). Acepta la politica de datos y los terminos
 * vigentes (sus ids, como en Pedir hora).
 */
export class ReservaPortalDto extends PacienteDelPortalDto {
  @IsEnum(ModalidadAtencion)
  modalidad!: ModalidadAtencion;

  @Type(() => Date)
  @IsDate()
  inicio!: Date;

  @Type(() => Date)
  @IsDate()
  fin!: Date;

  @IsUUID()
  politicaId!: string;

  @IsUUID()
  terminosId!: string;
}

/** Horas libres de su tratante para reservar desde la cuenta. */
export class DisponibilidadPortalDto extends PacienteDelPortalDto {
  @Type(() => Date)
  @IsDate()
  desde!: Date;

  @Type(() => Date)
  @IsDate()
  hasta!: Date;
}
