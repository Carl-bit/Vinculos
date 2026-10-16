import { AlcanceAccesoTemporal, DecisionRetencion, EstadoTipoSesion, ModoEnvioDocumento, MotivoAccesoTemporal, NivelRiesgo } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
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
