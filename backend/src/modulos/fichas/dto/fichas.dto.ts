import { DecisionRetencion, EstadoTipoSesion, NivelRiesgo } from '@prisma/client';
import { Type } from 'class-transformer';
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
}

export class BuscarPacientesDto {
  /** Busqueda exacta por RUT (indice ciego rut_hmac). */
  @IsOptional()
  @NormalizarRut()
  @IsRut()
  rut?: string;
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
