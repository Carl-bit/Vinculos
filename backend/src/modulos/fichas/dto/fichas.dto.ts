import {
  AlcanceAccesoTemporal,
  CanalAceptacion,
  DecisionRetencion,
  EstadoPlantillaClinica,
  EstadoTipoSesion,
  ModoEnvioDocumento,
  MotivoAccesoTemporal,
  NivelRiesgo,
  TipoPlantillaClinica,
} from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { IsRut, NormalizarRut, Recortar, TELEFONO_CL } from '../../../core/validacion/validadores';

/** Largo maximo del texto clinico libre (notas de una evolucion). */
export const MAX_TEXTO_CLINICO = 20_000;

export class CrearPacienteDto {
  @Recortar()
  @IsString()
  @Length(1, 120)
  nombre!: string;

  @Recortar()
  @IsString()
  @Length(1, 120)
  apellido!: string;

  @IsOptional()
  @NormalizarRut()
  @IsRut()
  rut?: string;

  @Type(() => Date)
  @IsDate()
  fechaNacimiento!: Date;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' })
  telefono?: string;

  /** Tratante. PROFESIONAL: se ignora (es el mismo). ADMIN/GESTION: obligatorio. */
  @IsOptional()
  @IsUUID()
  profesionalId?: string;

  @IsOptional()
  @IsUUID()
  tipoAtencionId?: string;

  /** Contacto de emergencia (nombre, relacion y telefono en texto libre; cifrado). */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 300)
  contactoEmergencia?: string;
}

/** Datos administrativos. El tratante solo cambia via derivacion. */
export class EditarPacienteDto {
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 120)
  nombre?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 120)
  apellido?: string;

  @IsOptional()
  @NormalizarRut()
  @IsRut()
  rut?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fechaNacimiento?: Date;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' })
  telefono?: string | null;

  /** null lo borra. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Recortar()
  @IsString()
  @Length(1, 300)
  contactoEmergencia?: string | null;
}

const booleano = () => Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value));

export class BuscarPacientesDto {
  /** Busqueda exacta por RUT (indice ciego rut_hmac). */
  @IsOptional()
  @NormalizarRut()
  @IsRut()
  rut?: string;

  /** 03a: tratante (selector de profesional). */
  @IsOptional()
  @IsUUID()
  profesionalId?: string;

  /** Solo menores de 18. */
  @IsOptional()
  @booleano()
  @IsBoolean()
  menores?: boolean;

  /** Solo posibles duplicados por conciliar (D-2). */
  @IsOptional()
  @booleano()
  @IsBoolean()
  duplicados?: boolean;

  /** Solo llegados por derivacion aceptada. */
  @IsOptional()
  @booleano()
  @IsBoolean()
  derivados?: boolean;

  /** Busqueda por nombre o apellido (contiene). */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 120)
  nombre?: string;
}

export class CrearAdultoResponsableDto {
  @Recortar()
  @IsString()
  @Length(1, 200)
  nombre!: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 60)
  parentesco?: string;

  @IsOptional()
  @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' })
  telefono?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @NormalizarRut()
  @IsRut()
  rut?: string;
}

export class CrearEvolucionDto {
  @Recortar()
  @IsString()
  @Length(1, MAX_TEXTO_CLINICO)
  notas!: string;

  @IsUUID()
  tipoSesionId!: string;

  @IsEnum(NivelRiesgo)
  nivelRiesgo!: NivelRiesgo;

  @IsOptional()
  @IsUUID()
  estadoAvanceId?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  intervencionIds?: string[];

  /** Correccion: fila nueva que apunta a la evolucion corregida. */
  @IsOptional()
  @IsUUID()
  corrigeAId?: string;

  /** 03a: sesion que se cierra con esta evolucion (cita del mismo paciente). */
  @IsOptional()
  @IsUUID()
  citaId?: string;

  /** 03a-2: version de plantilla EVOLUCION (publicada; en una correccion, la de la evolucion corregida). */
  @ValidateIf((o: CrearEvolucionDto) => o.valores !== undefined)
  @IsUUID()
  plantillaId?: string;

  /** 03a-2: { clave: valor } segun la plantilla; se valida contra su version (422) y se cifra como un solo valor. */
  @ValidateIf((o: CrearEvolucionDto) => o.plantillaId !== undefined)
  @IsObject()
  valores?: Record<string, unknown>;
}

export class ProponerTipoSesionDto {
  @Recortar()
  @IsString()
  @Length(2, 80)
  nombre!: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(500)
  descripcion?: string;
}

export class RevisarTipoSesionDto {
  @IsOptional()
  @IsIn([EstadoTipoSesion.APROBADO, EstadoTipoSesion.RECHAZADO])
  estado?: 'APROBADO' | 'RECHAZADO';

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class CatalogoDto {
  @Recortar()
  @IsString()
  @Length(2, 80)
  nombre!: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(500)
  descripcion?: string;
}

export class RevisionRetencionDto {
  @IsUUID()
  fichaId!: string;

  @IsEnum(DecisionRetencion)
  decision!: DecisionRetencion;

  @Recortar()
  @IsString()
  @Length(3, 2000)
  motivo!: string;
}

/**
 * Plantilla del documento (02i): variables nombre_paciente,
 * nombre_profesional, fecha, nombre_centro y contenido (lo que redacta el
 * profesional). Variable no permitida -> 422 (CHECK de la BD).
 */
export class TipoDocumentoDto {
  @Recortar()
  @IsString()
  @Length(2, 80)
  nombre!: string;

  @IsOptional()
  @IsString()
  @Length(1, MAX_TEXTO_CLINICO)
  plantilla?: string;
}

export class EditarTipoDocumentoDto {
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(2, 80)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, MAX_TEXTO_CLINICO)
  plantilla?: string;
}

/**
 * Documento emitido por el tratante (02i): redacta el texto en la app; el
 * servidor lo arma con la plantilla del tipo, lo guarda cifrado y genera el
 * PDF con el formato del centro al entregarlo. Sin subida de archivos.
 */
export class EmitirDocumentoDto {
  @IsUUID()
  pacienteId!: string;

  @IsUUID()
  tipoDocumentoId!: string;

  @Recortar()
  @IsString()
  @Length(1, MAX_TEXTO_CLINICO)
  contenido!: string;
}

/** ENLACE (por defecto): expira y exige iniciar sesion. ADJUNTO: solo si el paciente lo pidio. */
export class EnviarDocumentoDto {
  @IsOptional()
  @IsEnum(ModoEnvioDocumento)
  modo?: ModoEnvioDocumento;
}

/** Invitacion de cuenta (03a): al paciente (desde 14 años) o, si es menor, a su adulto responsable. */
export class InvitarPacienteDto {
  /** Por defecto el correo registrado. */
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  /** Menor de 18: la invitacion es para este adulto responsable (cuenta RESPONSABLE). */
  @IsOptional()
  @IsUUID()
  adultoResponsableId?: string;
}

/** Alta del paciente (03a): la registra el tratante; el motivo se cifra. */
export class AltaDto {
  @Type(() => Date)
  @IsDate()
  fecha!: Date;

  @Recortar()
  @IsString()
  @Length(3, 2000)
  motivo!: string;
}

/** Consentimiento informado de atencion registrado por ADMIN/GESTION (presencial, con respaldo). */
export class ConsentimientoAtencionDto {
  @Recortar()
  @IsString()
  @Length(3, 500)
  respaldoRef!: string;

  /** Menor de 18: adulto responsable que firma. */
  @IsOptional()
  @IsUUID()
  adultoResponsableId?: string;
}

/** Acceso clinico temporal (C-4, C-5): se corta solo al vencer. */
export class AccesoTemporalDto {
  @IsUUID()
  profesionalId!: string;

  @IsEnum(MotivoAccesoTemporal)
  motivo!: MotivoAccesoTemporal;

  @IsEnum(AlcanceAccesoTemporal)
  alcance!: AlcanceAccesoTemporal;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  desde?: Date;

  @Type(() => Date)
  @IsDate()
  hasta!: Date;
}

/** Borrador de evolucion (C-8): texto libre, guardado automatico. */
export class BorradorDto {
  @IsString()
  @Length(1, MAX_TEXTO_CLINICO)
  contenido!: string;

  @IsOptional()
  @IsUUID()
  citaId?: string;

  /** 03a-2: plantilla de evolucion y valores (pueden quedar incompletos hasta confirmar). */
  @ValidateIf((o: BorradorDto) => o.valores !== undefined)
  @IsUUID()
  plantillaId?: string;

  @ValidateIf((o: BorradorDto) => o.plantillaId !== undefined)
  @IsObject()
  valores?: Record<string, unknown>;
}

export class ListarBorradoresDto {
  @IsOptional()
  @IsUUID()
  fichaId?: string;
}

/** Confirmar un borrador: los campos estructurados de la evolucion (las notas son el borrador). */
export class ConfirmarBorradorDto {
  @IsUUID()
  tipoSesionId!: string;

  @IsEnum(NivelRiesgo)
  nivelRiesgo!: NivelRiesgo;

  @IsOptional()
  @IsUUID()
  estadoAvanceId?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  intervencionIds?: string[];
}

// ---------------------------------------------------------------------------
// 03a-2: plantillas clinicas por especialidad y ficha de ingreso
// ---------------------------------------------------------------------------

const TIPOS_CAMPO = ['TEXTO', 'TEXTO_LARGO', 'NUMERO', 'FECHA', 'SELECCION_UNICA', 'SELECCION_MULTIPLE', 'SI_NO'] as const;

/** Un campo de la plantilla. La BD revalida la definicion completa (CHECK -> 422). */
export class CampoPlantillaDto {
  @Matches(/^[a-z][a-z0-9_]{0,39}$/, { message: 'clave: minusculas, digitos y _ (hasta 40)' })
  clave!: string;

  @Recortar()
  @IsString()
  @Length(1, 120)
  etiqueta!: string;

  @IsIn(TIPOS_CAMPO)
  tipo!: (typeof TIPOS_CAMPO)[number];

  @IsBoolean()
  obligatorio!: boolean;

  /** Solo (y obligatorio) en SELECCION_UNICA y SELECCION_MULTIPLE. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  opciones?: string[];

  @IsInt()
  orden!: number;

  /** Lo ve la supervision seudonimizada. */
  @IsBoolean()
  visible_en_supervision!: boolean;

  /** Texto libre: la UI advierte no escribir datos identificatorios. */
  @IsBoolean()
  es_texto_libre!: boolean;
}

export class ProponerPlantillaDto {
  @IsUUID()
  especialidadId!: string;

  @IsEnum(TipoPlantillaClinica)
  tipo!: TipoPlantillaClinica;

  @Recortar()
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => CampoPlantillaDto)
  definicion!: CampoPlantillaDto[];
}

/** Editar un borrador (una version publicada no se edita: se crea una version nueva). */
export class EditarPlantillaClinicaDto {
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(2, 120)
  nombre?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => CampoPlantillaDto)
  definicion?: CampoPlantillaDto[];
}

export class ListarPlantillasDto {
  @IsOptional()
  @IsUUID()
  especialidadId?: string;

  @IsOptional()
  @IsEnum(TipoPlantillaClinica)
  tipo?: TipoPlantillaClinica;

  @IsOptional()
  @IsEnum(EstadoPlantillaClinica)
  estado?: EstadoPlantillaClinica;
}

/** Ficha de ingreso / anamnesis con una plantilla INGRESO. */
export class CrearIngresoDto {
  @IsUUID()
  plantillaId!: string;

  @IsObject()
  valores!: Record<string, unknown>;

  /** Correccion: fila nueva con la misma version de plantilla. */
  @IsOptional()
  @IsUUID()
  corrigeAId?: string;
}

/** Resolucion de un posible duplicado (solo administracion). */
export class ResolverDuplicadoDto {
  @IsIn(['DISTINTO', 'MISMO_PACIENTE'])
  resolucion!: 'DISTINTO' | 'MISMO_PACIENTE';
}

/** Documento emitido (metadatos, sin contenido): el PDF se entrega por el enlace del correo. */
export class DocumentoClinicoVista {
  id!: string;
  pacienteId!: string;
  tipoDocumentoId!: string;
  emitidoPorId!: string;
  nombreArchivo!: string;
  tipoMime!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'El paciente pidio recibirlo adjunto' })
  adjuntoSolicitadoEn!: Date | null;
  emitidoEn!: Date;
}

/** Paciente (datos administrativos; la RLS decide quien lo ve). RUT, telefono y contacto de emergencia descifrados. */
export class PacienteVista {
  id!: string;
  nombre!: string;
  apellido!: string;
  @ApiProperty({ type: String, nullable: true })
  rut!: string | null;
  @ApiProperty({ type: String, format: 'date' })
  fechaNacimiento!: Date;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true })
  telefono!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Tratante' })
  profesionalId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Codigo para la supervision seudonimizada' })
  codigoSeudonimo!: string | null;
  @ApiProperty({ type: String, nullable: true })
  tipoAtencionId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  contactoEmergencia!: string | null;
  creadoPorSolicitud!: boolean;
  posibleDuplicado!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

export class PacienteCreado extends PacienteVista {
  @ApiProperty({ type: String, nullable: true, description: 'Ficha abierta en la misma transaccion (ADMIN o el tratante)' })
  fichaId!: string | null;
}

export class AdultoResponsableVista {
  id!: string;
  pacienteId!: string;
  nombre!: string;
  @ApiProperty({ type: String, nullable: true })
  parentesco!: string | null;
  @ApiProperty({ type: String, nullable: true })
  telefono!: string | null;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rut!: string | null;
  createdAt!: Date;
}

/** Metadata de la ficha (nunca las evoluciones). */
export class FichaVista {
  id!: string;
  pacienteId!: string;
  fechaApertura!: Date;
  createdAt!: Date;
  updatedAt!: Date;
}

class PoliticaDeAceptacion {
  @ApiProperty({ enum: ['POLITICA_DATOS', 'CONSENTIMIENTO_ATENCION', 'TERMINOS_AGENDAMIENTO'] })
  tipo!: string;
  version!: number;
}

/** Politica o consentimiento aceptado por el paciente (version, canal y quien otorgo). */
export class AceptacionVista {
  id!: string;
  @ApiProperty({ enum: CanalAceptacion, enumName: 'CanalAceptacion' })
  canal!: CanalAceptacion;
  @ApiProperty({ enum: ['PACIENTE', 'ADULTO_RESPONSABLE'], nullable: true })
  otorgadoPor!: string | null;
  @ApiProperty({ type: String, nullable: true })
  adultoResponsableId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Respaldo del documento firmado (registro presencial)' })
  respaldoRef!: string | null;
  aceptadaEn!: Date;
  politica!: PoliticaDeAceptacion;
}

export class AceptacionRegistrada {
  id!: string;
  pacienteId!: string;
}

/** Enlace de un solo uso enviado por correo (consentimiento). */
export class EnlaceEnviado {
  referenciaId!: string;
  venceEn!: Date;
}

export class InvitacionEnviada {
  pacienteId!: string;
  invitacionVence!: Date;
}

/** Estado administrativo de cada paciente de un profesional (sin contenido clinico). */
export class EstadoFichaPaciente {
  paciente_id!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  ultima_sesion!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  proxima_sesion!: Date | null;
  /** Sesiones realizadas con este profesional sin evolucion vinculada. */
  sesiones_sin_cerrar!: number;
  @ApiProperty({ type: String, format: 'date', nullable: true })
  alta_en!: Date | null;
}

/** Lo que el paciente respondio en el match al pedir hora (solo el tratante). */
export class RespuestasMatchPaciente {
  solicitudId!: string;
  creadaEn!: Date;
  @ApiProperty({ type: 'object', additionalProperties: true, description: '{ clave de la pregunta: respuesta }' })
  respuestas!: unknown;
}

/** Version de una plantilla clinica (la definicion son sus campos). */
export class PlantillaClinicaVista {
  id!: string;
  familiaId!: string;
  especialidadId!: string;
  @ApiProperty({ enum: TipoPlantillaClinica, enumName: 'TipoPlantillaClinica' })
  tipo!: TipoPlantillaClinica;
  nombre!: string;
  version!: number;
  @ApiProperty({ enum: EstadoPlantillaClinica, enumName: 'EstadoPlantillaClinica' })
  estado!: EstadoPlantillaClinica;
  @ApiProperty({ type: [CampoPlantillaDto] })
  definicion!: unknown;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publicadaEn!: Date | null;
}

class CatalogoRef {
  id!: string;
  nombre!: string;
}

class CopiaAutoria {
  @ApiProperty({ type: String, nullable: true })
  nombre!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rut!: string | null;
  @ApiProperty({ type: String, nullable: true })
  registro!: string | null;
}

/** Evolucion (append-only; solo el tratante). Correccion = registro nuevo con corrigeAId. */
export class EvolucionVista {
  id!: string;
  fichaClinicaId!: string;
  autorId!: string;
  @ApiProperty({ type: String, nullable: true })
  notas!: string | null;
  copiaAutoria!: CopiaAutoria;
  @ApiProperty({ type: CatalogoRef, nullable: true })
  tipoSesion!: CatalogoRef | null;
  @ApiProperty({ type: CatalogoRef, nullable: true })
  estadoAvance!: CatalogoRef | null;
  intervenciones!: CatalogoRef[];
  @ApiProperty({ enum: NivelRiesgo, enumName: 'NivelRiesgo', nullable: true })
  nivelRiesgo!: NivelRiesgo | null;
  @ApiProperty({ type: String, nullable: true })
  corrigeAId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Sesion que cierra' })
  citaId!: string | null;
  createdAt!: Date;
  @ApiProperty({ type: PlantillaClinicaVista, nullable: true })
  plantilla!: PlantillaClinicaVista | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  valores!: Record<string, unknown> | null;
}

/** Acceso clinico temporal (reemplazo o interconsulta, hasta 180 dias; append-only). */
export class AccesoTemporalVista {
  id!: string;
  pacienteId!: string;
  profesionalId!: string;
  @ApiProperty({ enum: MotivoAccesoTemporal, enumName: 'MotivoAccesoTemporal' })
  motivo!: MotivoAccesoTemporal;
  @ApiProperty({ enum: AlcanceAccesoTemporal, enumName: 'AlcanceAccesoTemporal' })
  alcance!: AlcanceAccesoTemporal;
  desde!: Date;
  hasta!: Date;
  otorgadoPorId!: string;
  creadoEn!: Date;
}
